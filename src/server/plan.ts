'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { addDays, today } from '@/lib/dates';
import { ORIGINS, canApprove } from '@/lib/domain';
import { formReader, nextRef, type FormState } from '@/lib/forms';
import { requireManager } from '@/lib/guard';
import { ALL_SITES } from '@/lib/session';

const ORIGIN_KEYS = Object.keys(ORIGINS);
const STATUSES = ['todo', 'doing', 'verify', 'done'] as const;

/**
 * Crée ou modifie une action du plan d'actions unique.
 * Champ caché `link` pour rattacher la nouvelle action à son origine :
 * risk:<id> · finding:<id> · requirement:<id> · plan:<id> · docversion:<id> · qualification:<personId>:<titleId>
 */
export async function saveAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const title = f.str('title', { required: true, max: 200 });
  const description = f.opt('description');
  const origin = f.oneOf('origin', ORIGIN_KEYS, { required: true });
  const eventId = f.opt('eventId');
  const pilotId = f.str('pilotId', { required: true });
  const dueOn = f.date('dueOn', { required: true });
  const kind = f.oneOf('kind', ['C', 'P'] as const, { required: true });
  const verifyDueOn = f.date('verifyDueOn');
  let originRef = f.str('originRef', { max: 120 });
  let siteId = f.opt('siteId');
  const link = f.opt('link');
  if (!f.ok) return f.state();

  const db = await getDb();
  if (eventId) {
    const [ev] = await db.select({ id: t.events.id, siteId: t.events.siteId }).from(t.events).where(eq(t.events.id, eventId));
    if (!ev) return { error: 'Événement lié introuvable.' };
    siteId ??= ev.siteId;
    originRef ||= ev.id;
  }
  if (!originRef) return { error: "Précisez la référence d'origine (événement, audit, exigence…).", fieldErrors: { originRef: 'Champ obligatoire.' } };
  if (!siteId && !id && session.site.id !== ALL_SITES && origin === 'ev') siteId = session.site.id;

  const values = { title, description, origin: origin!, originRef, eventId, pilotId, dueOn: dueOn!, kind: kind!, verifyDueOn, siteId };

  if (id) {
    const [cur] = await db.select({ status: t.actions.status }).from(t.actions).where(eq(t.actions.id, id));
    if (cur?.status === 'done' && !canApprove(session.role)) return { error: "Seuls l'animateur QHSE et la direction modifient une action clôturée." };
    const [row] = await db.update(t.actions).set(values).where(eq(t.actions.id, id)).returning({ id: t.actions.id });
    if (!row) return { error: 'Action introuvable.' };
    revalidatePath('/', 'layout');
    return { ok: true, id };
  }

  const ids = (await db.select({ id: t.actions.id }).from(t.actions)).map((r) => r.id);
  const newId = nextRef(ids, 'A-');
  await db.transaction(async (tx) => {
    await tx.insert(t.actions).values({ id: newId, ...values, status: 'todo' });
    if (!link) return;
    const [kindOfLink, a, b] = link.split(':');
    if (kindOfLink === 'risk') await tx.insert(t.riskActions).values({ riskId: Number(a), actionId: newId }).onConflictDoNothing();
    if (kindOfLink === 'finding') await tx.update(t.auditFindings).set({ actionId: newId }).where(eq(t.auditFindings.id, Number(a)));
    if (kindOfLink === 'requirement') await tx.update(t.requirements).set({ actionId: newId }).where(eq(t.requirements.id, Number(a)));
    if (kindOfLink === 'plan') await tx.update(t.auditPlanItems).set({ actionId: newId }).where(eq(t.auditPlanItems.id, Number(a)));
    if (kindOfLink === 'docversion') await tx.update(t.documentVersions).set({ actionId: newId }).where(eq(t.documentVersions.id, Number(a)));
    if (kindOfLink === 'qualification') {
      // Ne remplace pas un recyclage déjà planifié et encore ouvert.
      const [req] = await tx.select({ renewal: t.qualificationRequirements.renewalActionId }).from(t.qualificationRequirements)
        .where(and(eq(t.qualificationRequirements.personId, a), eq(t.qualificationRequirements.titleId, b)));
      const [prev] = req?.renewal ? await tx.select({ status: t.actions.status }).from(t.actions).where(eq(t.actions.id, req.renewal)) : [];
      if (!prev || prev.status === 'done') {
        await tx.update(t.qualificationRequirements).set({ renewalActionId: newId })
          .where(and(eq(t.qualificationRequirements.personId, a), eq(t.qualificationRequirements.titleId, b)));
      }
    }
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: newId };
}

/**
 * Fait avancer une action : à lancer → en cours → efficacité à vérifier → clôturée.
 * La clôture exige le constat d'efficacité et un rôle de validation (animateur QHSE, direction).
 */
export async function setActionStatus(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const to = f.oneOf('to', STATUSES, { required: true });
  const note = f.opt('efficacyNote');
  const verifyDueOn = f.date('verifyDueOn');
  if (!f.ok) return f.state();

  const db = await getDb();
  const [a] = await db.select().from(t.actions).where(eq(t.actions.id, id));
  if (!a) return { error: 'Action introuvable.' };
  const now = today();

  if (to === 'done') {
    if (!canApprove(session.role)) return { error: "La clôture après vérification d'efficacité est réservée à l'animateur QHSE et à la direction." };
    if (!note) return { error: "Décrivez le constat d'efficacité avant de clôturer.", fieldErrors: { efficacyNote: 'Champ obligatoire.' } };
    await db.update(t.actions).set({ status: 'done', efficacyNote: note, verifiedById: session.user.id, closedOn: now }).where(eq(t.actions.id, id));
  } else if (to === 'verify') {
    await db.update(t.actions).set({ status: 'verify', verifyDueOn: verifyDueOn ?? a.verifyDueOn ?? addDays(now, 30), closedOn: null }).where(eq(t.actions.id, id));
  } else {
    // Retour en cours après une efficacité jugée insuffisante, ou réouverture : le constat est conservé.
    if (a.status === 'done' && !canApprove(session.role)) return { error: "Seuls l'animateur QHSE et la direction rouvrent une action clôturée." };
    await db.update(t.actions).set({ status: to!, closedOn: null, efficacyNote: note ?? a.efficacyNote }).where(eq(t.actions.id, id));
  }
  revalidatePath('/', 'layout');
  return { ok: true, id };
}
