import 'server-only';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { schema as t, type DbOrTx } from '@/db';
import { workerCheck, type WorkerCheck } from '@/lib/rules/workers';
import type { HeldFacts } from '@/lib/rules/skills';
import { readPeopleHeldTitles } from './held-titles';

// Intervenants des plans de prévention (PRV-23) : lecture commune à la fiche du plan, aux server actions (veto, signature,
// délivrance d'un permis) et aux échéances. Sans contrôle de session (l'appelant filtre les plans par site et périmètre).

export type PlanWorker = {
  id: number;
  planId: string;
  personId: string;
  name: string;
  /** Entreprise ou agence (Cursus) et matricule de site (« E… », « I… »). */
  company: string | null;
  siteMatricule: string | null;
  left: boolean;
  check: WorkerCheck;
  /** Veto en cours (service QHSE), null sinon. */
  veto: { id: number; reason: string; by: string | null; at: Date } | null;
};

/** Intervenants en cours (non retirés) des plans `planIds` (tous les plans sans argument), avec leurs contrôles à `now`. */
export async function readPlanWorkers(db: DbOrTx, now: string, planIds?: readonly string[]): Promise<{ workers: PlanWorker[]; heldOk: boolean }> {
  if (planIds && !planIds.length) return { workers: [], heldOk: true };
  const rows = await db.select({
    id: t.preventionPlanWorkers.id, planId: t.preventionPlanWorkers.planId, personId: t.preventionPlanWorkers.personId,
    name: t.people.name, company: t.people.company, siteMatricule: t.people.siteMatricule, leftOn: t.people.leftOn,
  }).from(t.preventionPlanWorkers)
    .innerJoin(t.people, eq(t.people.id, t.preventionPlanWorkers.personId))
    .where(and(isNull(t.preventionPlanWorkers.cancelledAt), planIds ? inArray(t.preventionPlanWorkers.planId, [...planIds]) : undefined))
    .orderBy(asc(t.preventionPlanWorkers.id));
  if (!rows.length) return { workers: [], heldOk: true };
  const personIds = [...new Set(rows.map((r) => r.personId))];
  const [vetoes, induction, required, held] = await Promise.all([
    db.select().from(t.preventionWorkerVetoes).where(and(isNull(t.preventionWorkerVetoes.liftedAt), inArray(t.preventionWorkerVetoes.workerId, rows.map((r) => r.id)))),
    db.select({ id: t.trainingTitles.id }).from(t.trainingTitles).where(and(eq(t.trainingTitles.safetyInduction, true), isNull(t.trainingTitles.archivedAt))),
    db.select({ personId: t.qualificationRequirements.personId, titleId: t.qualificationRequirements.titleId, label: t.trainingTitles.label })
      .from(t.qualificationRequirements).innerJoin(t.trainingTitles, eq(t.trainingTitles.id, t.qualificationRequirements.titleId))
      .where(and(inArray(t.qualificationRequirements.personId, personIds), isNull(t.trainingTitles.archivedAt))),
    readPeopleHeldTitles(db),
  ]);
  const vetoNames = await db.select({ id: t.people.id, name: t.people.name }).from(t.people)
    .where(inArray(t.people.id, [...new Set(vetoes.map((v) => v.vetoedById).filter((x): x is string => !!x)), '__none__']));
  const nameOf = new Map(vetoNames.map((p) => [p.id, p.name]));
  const inductionIds = induction.map((x) => x.id);
  const workers = rows.map((r): PlanWorker => {
    const heldOf = new Map<string, HeldFacts>(held.list.filter((h) => h.personId === r.personId).map((h) => [h.titleId, h]));
    const v = vetoes.find((x) => x.workerId === r.id);
    return {
      id: r.id, planId: r.planId, personId: r.personId, name: r.name, company: r.company, siteMatricule: r.siteMatricule,
      left: !!r.leftOn && r.leftOn <= now,
      check: workerCheck({ inductionTitleIds: inductionIds, required: required.filter((q) => q.personId === r.personId), held: heldOf, heldOk: held.ok }, now),
      veto: v ? { id: v.id, reason: v.reason, by: v.vetoedById ? nameOf.get(v.vetoedById) ?? null : null, at: v.vetoedAt } : null,
    };
  });
  return { workers, heldOk: held.ok };
}

/** Noms des intervenants sous veto en cours d'un plan (blocage de la signature et de la délivrance des permis). */
export async function vetoedWorkerNames(db: DbOrTx, planId: string): Promise<string[]> {
  const rows = await db.select({ name: t.people.name }).from(t.preventionWorkerVetoes)
    .innerJoin(t.preventionPlanWorkers, eq(t.preventionPlanWorkers.id, t.preventionWorkerVetoes.workerId))
    .innerJoin(t.people, eq(t.people.id, t.preventionPlanWorkers.personId))
    .where(and(eq(t.preventionPlanWorkers.planId, planId), isNull(t.preventionPlanWorkers.cancelledAt), isNull(t.preventionWorkerVetoes.liftedAt)));
  return rows.map((r) => r.name);
}
