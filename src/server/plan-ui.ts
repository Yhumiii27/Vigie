'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { addDays, fmtDate } from '@/lib/dates';
import { today } from '@/lib/today';
import { canManage } from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { detachAllLinks } from '@/lib/action-links';
import { requireApprover, requireInSite } from '@/lib/guard';
import { getSession } from '@/lib/session';
import { logChange } from './changelog';
import { applyActionStatus } from './plan-core';

const STATUSES = ['todo', 'doing', 'verify', 'done'] as const;
const TARGETS = ['doing', 'verify', 'done'] as const;

// Transitions ouvertes au pilote sans rôle d'encadrement (Salarié) : Démarrer, Déclarer réalisée.
const PILOT_MOVES: Partial<Record<(typeof STATUSES)[number], readonly (typeof TARGETS)[number][]>> = {
  todo: ['doing', 'verify'],
  doing: ['verify'],
};

// Transitions proposées par la fiche d'action (le statut « en retard » est calculé, il n'existe pas en base).
const ALLOWED: Record<(typeof STATUSES)[number], readonly (typeof TARGETS)[number][]> = {
  todo: ['doing', 'verify'], // Démarrer · Déclarer réalisée
  doing: ['verify'], // Déclarer réalisée
  verify: ['done', 'doing'], // Clôturer — efficacité vérifiée · Efficacité insuffisante
  done: ['doing'], // Rouvrir
};

const STALE = "Le statut de cette action a changé entre-temps : la fiche vient d'être actualisée.";

/**
 * Fait avancer une action depuis sa fiche (applyActionStatus, plan-core.ts).
 * Encadrement : toutes les transitions ; pilote salarié : Démarrer et Déclarer réalisée sur ses propres actions.
 * La fiche envoie le statut qu'elle affichait (`from`) : si l'action a changé de statut entre-temps,
 * la demande est refusée et la page actualisée (une fiche restée ouverte ne rejoue pas un choix devenu caduc).
 * « Déclarer réalisée » fixe toujours une date de vérification d'efficacité à venir (J+30 par défaut).
 * « Efficacité insuffisante » (verify → doing) exige un constat, conservé dans la fiche.
 */
export async function moveAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await getSession();
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const from = f.oneOf('from', STATUSES, { required: true });
  const to = f.oneOf('to', TARGETS, { required: true });
  const verifyDueOn = f.date('verifyDueOn');
  const note = f.str('efficacyNote', { max: 2000 });
  if (!f.ok) return f.state();

  const db = await getDb();
  const [a] = await db.select().from(t.actions).where(eq(t.actions.id, id));
  if (!a) return { error: 'Action introuvable.' };
  if (!canManage(session.role) && (a.pilotId !== session.user.id || !PILOT_MOVES[from!]?.includes(to!))) return { error: 'Votre rôle ne permet pas cette modification.' };
  if (a.status !== from || !ALLOWED[from!].includes(to!)) {
    revalidatePath('/', 'layout');
    return { error: STALE };
  }
  const blocked = await requireInSite(a.siteId);
  if (blocked) return { error: blocked };

  const now = today();
  let verify: string | null = null;
  let efficacy: string | null = null;
  if (to === 'verify') {
    // Champ vidé : J+30 plutôt que l'ancienne date, qui peut être dépassée après un retour « en cours ».
    verify = verifyDueOn ?? addDays(now, 30);
    if (verify < now) return { error: 'Certains champs sont à corriger.', fieldErrors: { verifyDueOn: 'La vérification ne peut pas être planifiée dans le passé.' } };
  }
  if (to === 'done') {
    if (!note) return { error: "Décrivez le constat d'efficacité avant de clôturer.", fieldErrors: { efficacyNote: 'Champ obligatoire.' } };
    efficacy = note;
  }
  if (to === 'doing' && from === 'verify') {
    if (!note) return { error: "Expliquez pourquoi l'efficacité est insuffisante.", fieldErrors: { efficacyNote: 'Champ obligatoire.' } };
    efficacy = `Efficacité jugée insuffisante le ${fmtDate(now)} : ${note}`;
  }
  const done = await db.transaction(async (tx) => {
    const r = await applyActionStatus(tx, session, a, to!, { note: efficacy, verifyDueOn: verify });
    // Retour « en cours » (efficacité insuffisante, réouverture) : la date de vérification de la tentative précédente
    // est caduque ; « Déclarer réalisée » proposera de nouveau J+30. « Démarrer » garde une date planifiée.
    if (r.ok && to === 'doing' && from !== 'todo') await tx.update(t.actions).set({ verifyDueOn: null }).where(eq(t.actions.id, id));
    return r;
  });
  if (done.ok) revalidatePath('/', 'layout');
  return done;
}

/**
 * Annule une action (animateur QHSE, direction) : jamais de suppression, l'action est conservée avec son motif
 * (qui, quand, pourquoi) et détachée de ses sources (risques, constats, exigences…) ; l'événement et la référence
 * d'origine restent lisibles. Une action clôturée doit d'abord être rouverte.
 */
export async function cancelAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const from = f.oneOf('from', STATUSES, { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();

  const db = await getDb();
  const [a] = await db.select().from(t.actions).where(eq(t.actions.id, id));
  if (!a) return { error: 'Action introuvable.' };
  if (a.status !== from) {
    revalidatePath('/', 'layout');
    return { error: STALE };
  }
  if (a.status === 'done') return { error: "Rouvrez l'action avant de l'annuler." };
  if (a.status !== 'todo' && a.status !== 'doing' && a.status !== 'verify') return { error: 'Action déjà annulée.' };
  const blocked = await requireInSite(a.siteId);
  if (blocked) return { error: blocked };

  await db.transaction(async (tx) => {
    // L'événement et la revue d'origine restent lisibles sur l'action annulée (keptOnCancel) : non listés.
    const detached = await detachAllLinks(tx, id);
    await tx.update(t.actions).set({ status: 'cancelled', cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason }).where(eq(t.actions.id, id));
    await logChange(tx, {
      entityType: 'action', entityId: id, action: 'cancel', summary: 'Annulée', reason, byId: session.user.id,
      details: detached.map((label) => ({ field: 'Détachée de', from: label, to: null })),
    });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id };
}
