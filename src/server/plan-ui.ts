'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { addDays, fmtDate, today } from '@/lib/dates';
import { formReader, type FormState } from '@/lib/forms';
import { requireManager } from '@/lib/guard';
import { setActionStatus } from './plan';

const STATUSES = ['todo', 'doing', 'verify', 'done'] as const;
const TARGETS = ['doing', 'verify', 'done'] as const;

// Transitions proposées par la fiche d'action (le statut « en retard » est calculé, il n'existe pas en base).
const ALLOWED: Record<(typeof STATUSES)[number], readonly (typeof TARGETS)[number][]> = {
  todo: ['doing', 'verify'], // Démarrer · Déclarer réalisée
  doing: ['verify'], // Déclarer réalisée
  verify: ['done', 'doing'], // Clôturer — efficacité vérifiée · Efficacité insuffisante
  done: ['doing'], // Rouvrir
};

const STALE = "Le statut de cette action a changé entre-temps : la fiche vient d'être actualisée.";

/**
 * Fait avancer une action depuis sa fiche, puis délègue à setActionStatus.
 * La fiche envoie le statut qu'elle affichait (`from`) : si l'action a changé de statut entre-temps,
 * la demande est refusée et la page actualisée (une fiche restée ouverte ne rejoue pas un choix devenu caduc).
 * « Déclarer réalisée » fixe toujours une date de vérification d'efficacité à venir (J+30 par défaut).
 * « Efficacité insuffisante » (verify → doing) exige un constat, conservé dans la fiche.
 */
export async function moveAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const from = f.oneOf('from', STATUSES, { required: true });
  const to = f.oneOf('to', TARGETS, { required: true });
  const verifyDueOn = f.date('verifyDueOn');
  const note = f.str('efficacyNote', { max: 2000 });
  if (!f.ok) return f.state();

  const db = await getDb();
  const [a] = await db.select({ status: t.actions.status }).from(t.actions).where(eq(t.actions.id, id));
  if (!a) return { error: 'Action introuvable.' };
  if (a.status !== from || !ALLOWED[from!].includes(to!)) {
    revalidatePath('/', 'layout');
    return { error: STALE };
  }

  const now = today();
  const next = new FormData();
  next.set('id', id);
  next.set('to', to!);
  if (to === 'verify') {
    // Champ vidé : J+30 plutôt que l'ancienne date, qui peut être dépassée après un retour « en cours ».
    const due = verifyDueOn ?? addDays(now, 30);
    if (due < now) return { error: 'Certains champs sont à corriger.', fieldErrors: { verifyDueOn: 'La vérification ne peut pas être planifiée dans le passé.' } };
    next.set('verifyDueOn', due);
  }
  if (to === 'done') {
    if (!note) return { error: "Décrivez le constat d'efficacité avant de clôturer.", fieldErrors: { efficacyNote: 'Champ obligatoire.' } };
    next.set('efficacyNote', note);
  }
  if (to === 'doing' && from === 'verify') {
    if (!note) return { error: "Expliquez pourquoi l'efficacité est insuffisante.", fieldErrors: { efficacyNote: 'Champ obligatoire.' } };
    next.set('efficacyNote', `Efficacité jugée insuffisante le ${fmtDate(now)} : ${note}`);
  }
  const done = await setActionStatus({}, next);
  // Retour « en cours » (efficacité insuffisante, réouverture) : la date de vérification de la tentative précédente
  // est caduque ; « Déclarer réalisée » proposera de nouveau J+30. « Démarrer » garde une date planifiée.
  if (done.ok && to === 'doing' && from !== 'todo') {
    await db.update(t.actions).set({ verifyDueOn: null }).where(eq(t.actions.id, id));
    revalidatePath('/', 'layout');
  }
  return done;
}
