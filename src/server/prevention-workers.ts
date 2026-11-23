'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { isQhse } from '@/lib/action-rules';
import { QHSE_ONLY } from '@/lib/edit-rights';
import { formReader, type FormState } from '@/lib/forms';
import { requireEditor, requireInSite } from '@/lib/guard';
import { hasLeft } from '@/lib/people';
import { isPlanEnded } from '@/lib/rules/prevention';
import { INDUCTION_LABELS, VETO_NOT_ALLOWED, inductionWarning, vetoAllowed } from '@/lib/rules/workers';
import { readPlanWorkers } from '@/lib/data/plan-workers';
import { loadPeople } from '@/lib/queries';
import { today } from '@/lib/today';
import { logChange } from './changelog';

// Intervenants d'un plan de prévention (PRV-23) : ajout et retrait (motif) par l'encadrement qui saisit la prévention, sur
// un plan en cours (ni clos ni annulé) du site sélectionné ; veto motivé du service QHSE (animateur QHSE) sur un intervenant
// dont les titres requis ou l'accueil sécurité ne sont pas à jour, levé avec un motif. Journal du plan (`prevention_plan`)
// dans la transaction de l'écriture. Avertissement (non bloquant) à l'ajout : accueil sécurité non à jour, ou donnée de
// Cursus indisponible ; jamais de refus pour ce seul motif.

const PLAN_MISSING = 'Plan de prévention introuvable.';
const WORKER_MISSING = 'Intervenant introuvable.';

/** Plan modifiable par la personne : existant, du site sélectionné et du périmètre, ni clos ni annulé. */
async function editablePlan(planId: string) {
  const db = await getDb();
  const [plan] = await db.select().from(t.preventionPlans).where(eq(t.preventionPlans.id, planId));
  if (!plan) return { db, plan: null, error: PLAN_MISSING };
  const siteError = await requireInSite(plan.siteId);
  if (siteError) return { db, plan: null, error: siteError };
  if (isPlanEnded(plan)) return { db, plan: null, error: plan.status === 'annule' ? 'Ce plan est annulé.' : 'Ce plan est clos.' };
  return { db, plan, error: null };
}

/** Intervenant en cours (non retiré) et son plan modifiable. */
async function editableWorker(workerId: number) {
  const db = await getDb();
  const [worker] = await db.select().from(t.preventionPlanWorkers).where(eq(t.preventionPlanWorkers.id, workerId));
  if (!worker || worker.cancelledAt) return { worker: null, error: WORKER_MISSING } as const;
  const { plan, error } = await editablePlan(worker.planId);
  if (!plan) return { worker: null, error } as const;
  return { worker, plan, error: null } as const;
}

const personName = async (id: string) => (await loadPeople()).get(id)?.name ?? id;

/** Ajoute un intervenant (personne de l'effectif lue dans Cursus) au plan ; avertit si son accueil sécurité n'est pas à jour. */
export async function addPlanWorker(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireEditor('prevention');
  if (error) return { error };
  const f = formReader(fd);
  const planId = f.str('planId', { required: true });
  const personId = f.str('personId', { required: true });
  if (!f.ok) return f.state();
  const { db, plan, error: planError } = await editablePlan(planId);
  if (!plan) return { error: planError };
  const person = (await loadPeople()).get(personId);
  if (!person || hasLeft(person, today())) return { error: 'Certains champs sont à corriger.', fieldErrors: { personId: 'Personne inconnue ou sortie de l’effectif.' } };
  const [dup] = await db.select({ id: t.preventionPlanWorkers.id }).from(t.preventionPlanWorkers)
    .where(and(eq(t.preventionPlanWorkers.planId, plan.id), eq(t.preventionPlanWorkers.personId, personId), isNull(t.preventionPlanWorkers.cancelledAt)));
  if (dup) return { error: 'Certains champs sont à corriger.', fieldErrors: { personId: 'Intervenant déjà inscrit sur ce plan.' } };
  const id = await db.transaction(async (tx) => {
    const [row] = await tx.insert(t.preventionPlanWorkers).values({ planId: plan.id, personId, addedById: session.user.id }).returning({ id: t.preventionPlanWorkers.id });
    await logChange(tx, { entityType: 'prevention_plan', entityId: plan.id, action: 'worker', byId: session.user.id, summary: `Intervenant ajouté : ${person.name}` });
    return row.id;
  });
  const { workers } = await readPlanWorkers(db, today(), [plan.id]);
  const added = workers.find((w) => w.id === id);
  const warning = added ? inductionWarning([added]) : null;
  revalidatePath('/', 'layout');
  return { ok: true, id: String(id), message: warning ? `Intervenant ajouté. ${warning}` : `Intervenant ajouté (${INDUCTION_LABELS[added?.check.induction ?? 'none'].label.toLowerCase()}).` };
}

/** Retire un intervenant du plan (motif ; jamais supprimé). Refusé tant qu'un veto est en cours : seul le QHSE le lève. */
export async function removePlanWorker(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireEditor('prevention');
  if (error) return { error };
  const f = formReader(fd);
  const workerId = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const loaded = await editableWorker(workerId!);
  if (!loaded.worker) return { error: loaded.error };
  const db = await getDb();
  const [veto] = await db.select({ id: t.preventionWorkerVetoes.id }).from(t.preventionWorkerVetoes)
    .where(and(eq(t.preventionWorkerVetoes.workerId, loaded.worker.id), isNull(t.preventionWorkerVetoes.liftedAt)));
  if (veto) return { error: 'Veto du service QHSE en cours : il doit être levé avant de retirer l’intervenant.' };
  const name = await personName(loaded.worker.personId);
  await db.transaction(async (tx) => {
    await tx.update(t.preventionPlanWorkers).set({ cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason }).where(eq(t.preventionPlanWorkers.id, loaded.worker.id));
    await logChange(tx, { entityType: 'prevention_plan', entityId: loaded.worker.planId, action: 'worker', byId: session.user.id, reason, summary: `Intervenant retiré : ${name}` });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(loaded.worker.id), message: 'Intervenant retiré du plan.' };
}

/** Garde du veto : écran Prévention modifiable et animateur QHSE (service QHSE, réponse du 09/11/2026). */
async function requireVetoRight() {
  const { session, error } = await requireEditor('prevention');
  if (error) return { session, error };
  return { session, error: isQhse(session.role) ? null : QHSE_ONLY };
}

/**
 * Veto du service QHSE sur un intervenant (motif) : titres requis ou accueil sécurité non à jour, ou Cursus indisponible.
 * Tant qu'il est en cours, le plan ne se signe pas et ses permis ne se délivrent pas (vetoBlocker).
 */
export async function vetoPlanWorker(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireVetoRight();
  if (error) return { error };
  const f = formReader(fd);
  const workerId = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const loaded = await editableWorker(workerId!);
  if (!loaded.worker) return { error: loaded.error };
  const db = await getDb();
  const { workers } = await readPlanWorkers(db, today(), [loaded.worker.planId]);
  const w = workers.find((x) => x.id === loaded.worker.id);
  if (!w) return { error: WORKER_MISSING };
  if (w.veto) return { error: 'Un veto est déjà en cours sur cet intervenant.' };
  if (!vetoAllowed(w.check)) return { error: VETO_NOT_ALLOWED };
  await db.transaction(async (tx) => {
    await tx.insert(t.preventionWorkerVetoes).values({ workerId: w.id, reason, vetoedById: session.user.id });
    await logChange(tx, { entityType: 'prevention_plan', entityId: w.planId, action: 'veto', byId: session.user.id, reason, summary: `Veto du service QHSE sur l'intervenant ${w.name}` });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(w.id), message: 'Veto enregistré : signature du plan et délivrance des permis bloquées.' };
}

/** Lève le veto en cours sur un intervenant (motif) : animateur QHSE. */
export async function liftPlanWorkerVeto(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireVetoRight();
  if (error) return { error };
  const f = formReader(fd);
  const workerId = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const loaded = await editableWorker(workerId!);
  if (!loaded.worker) return { error: loaded.error };
  const db = await getDb();
  const [veto] = await db.select().from(t.preventionWorkerVetoes)
    .where(and(eq(t.preventionWorkerVetoes.workerId, loaded.worker.id), isNull(t.preventionWorkerVetoes.liftedAt)));
  if (!veto) return { error: 'Aucun veto en cours sur cet intervenant.' };
  const name = await personName(loaded.worker.personId);
  await db.transaction(async (tx) => {
    await tx.update(t.preventionWorkerVetoes).set({ liftedAt: new Date(), liftedById: session.user.id, liftReason: reason }).where(eq(t.preventionWorkerVetoes.id, veto.id));
    await logChange(tx, { entityType: 'prevention_plan', entityId: loaded.worker.planId, action: 'veto', byId: session.user.id, reason, summary: `Veto levé sur l'intervenant ${name}` });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(loaded.worker.id), message: 'Veto levé.' };
}
