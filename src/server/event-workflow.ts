import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { schema as t, type DbOrTx } from '@/db';
import { METHODS } from '@/lib/domain';
import { advanceBlocker, analysisFilled, cpamPending, declarationDuty, missingQualification } from '@/lib/rules/events';

// Passage d'un événement à l'étape suivante, commun à la server action advanceEvent (src/server/events.ts) et au
// traitement des demandes reçues de Keystone (src/server/inbound.ts, D13) : une seule règle (advanceBlocker) et une seule
// écriture (étape et historique du workflow). Ne lit jamais la session.

type EventRow = typeof t.events.$inferSelect;

/**
 * Blocage du passage à l'étape suivante (advanceBlocker) d'après les actions liées, l'analyse de la méthode retenue et,
 * pour un AT, l'inscription au registre des accidents bénins. `role` : droits de la personne qui fait avancer (données de
 * santé, création d'actions) ; null pour une demande d'un autre outil (aucun droit propre).
 */
export async function eventAdvanceBlocker(db: DbOrTx, ev: EventRow, rights: { health: boolean; canCreateActions?: boolean }): Promise<string | null> {
  const [linked, [analysis], entry] = await Promise.all([
    db.select({ status: t.actions.status }).from(t.actions).where(eq(t.actions.eventId, ev.id)),
    db.select({ content: t.eventAnalyses.content }).from(t.eventAnalyses).where(and(eq(t.eventAnalyses.eventId, ev.id), eq(t.eventAnalyses.method, ev.analysisMethod))),
    ev.type === 'AT'
      ? db.select({ id: t.benignAccidents.id }).from(t.benignAccidents).where(and(eq(t.benignAccidents.eventId, ev.id), isNull(t.benignAccidents.cancelledAt))).then((r) => r[0])
      : undefined,
  ]);
  return advanceBlocker(ev.step, linked, {
    pilotId: ev.pilotId, hasAnalysis: analysisFilled(ev.analysisMethod, analysis?.content), dismissed: !!ev.dismissedAt,
    methodLabel: METHODS.find(([k]) => k === ev.analysisMethod)?.[1] ?? ev.analysisMethod,
    missing: missingQualification(ev),
    canCreateActions: rights.canCreateActions,
    accident: ev.type === 'AT' ? { health: rights.health, cpamPending: cpamPending(ev, !!entry), benign: ev.injury === 'soins', duty: declarationDuty(ev) } : undefined,
  });
}

/**
 * Écrit le passage de `ev.step` à l'étape suivante dans la transaction, si l'étape n'a pas changé entre-temps et que
 * l'événement n'est pas classé sans suite ; trace la transition (auteur `byId`, ou demande reçue `inboundRequestId`).
 * Rend false si l'événement a changé (écriture concurrente).
 */
export async function writeAdvance(tx: DbOrTx, ev: Pick<EventRow, 'id' | 'step'>, by: { byId: string | null; inboundRequestId?: number }): Promise<boolean> {
  const [row] = await tx.update(t.events).set({ step: ev.step + 1 })
    .where(and(eq(t.events.id, ev.id), eq(t.events.step, ev.step), isNull(t.events.dismissedAt))).returning({ id: t.events.id });
  if (!row) return false;
  await tx.insert(t.eventSteps).values({ eventId: ev.id, kind: 'advance', fromStep: ev.step, toStep: ev.step + 1, byId: by.byId, inboundRequestId: by.inboundRequestId ?? null });
  return true;
}
