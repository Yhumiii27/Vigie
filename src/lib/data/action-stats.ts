import 'server-only';
import { cache } from 'react';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { computeActionStats, parseStatsMonth, statusTransition, type ActionStats, type StatsAction, type StatusTransition } from '../action-stats';
import { canReadPlan } from '../action-rules';
import { parisDay } from '../dates';
import { loadAllActions, loadPeople, type ActionRow } from '../queries';
import { getSession } from '../session';
import { today } from '@/lib/today';

/**
 * Onglet « Statistiques » de /actions (ACT-29, ?vue=statistiques&mois=AAAA-MM) : plan du site sélectionné (« Tous les
 * sites » : tout le périmètre), Abandonnées comprises, et journal structuré des avancements de ces actions ; calcul pur
 * (computeActionStats, src/lib/action-stats.ts), rien n'est stocké. Lecteurs du plan seulement (QHSE et encadrement,
 * canReadPlan) : null pour le Salarié, qui ne lit que ses actions.
 */
export const loadActionStats = cache(async (rawMonth: string | null): Promise<ActionStats | null> => {
  const session = await getSession();
  if (!canReadPlan(session.role)) return null;
  const now = today();
  const month = parseStatsMonth(rawMonth, now);
  const [rows, people] = await Promise.all([loadAllActions('site'), loadPeople()]);
  return computeActionStats({
    ...(await statsInput(rows)), month, today: now,
    pilotNames: new Map([...people.values()].map((p) => [p.id, p.name])),
  });
});

/**
 * Entrées du calcul des statistiques (computeActionStats) pour les actions données : champs lus et journal structuré des
 * avancements (entrées « status » et « reprise »). Repris par le bilan annuel SSCT (CNF-03).
 */
export async function statsInput(rows: readonly ActionRow[]): Promise<{ actions: StatsAction[]; transitions: StatusTransition[] }> {
  const db = await getDb();
  const ids = new Set(rows.map((a) => a.id));
  const logs = ids.size
    ? await db.select({ id: t.changeLog.id, entityId: t.changeLog.entityId, action: t.changeLog.action, at: t.changeLog.at, details: t.changeLog.details })
      .from(t.changeLog).where(and(eq(t.changeLog.entityType, 'action'), inArray(t.changeLog.action, ['status', 'reprise'])))
    : [];
  const transitions = logs
    .filter((l) => ids.has(l.entityId))
    .map((l) => statusTransition({ actionId: l.entityId, action: l.action, day: parisDay(l.at), seq: l.id, details: l.details }))
    .filter((x): x is StatusTransition => x !== null);
  return {
    actions: rows.map((a) => ({
      id: a.id, openedOn: a.openedOn, status: a.status, dueOn: a.dueOn, doneOn: a.doneOn, closedOn: a.closedOn, effective: a.effective,
      source: a.source, domain: a.domain, pilotId: a.pilotId, riskLevel: a.riskLevel, cancelledOn: a.cancelledAt ? parisDay(a.cancelledAt) : null,
    })),
    transitions,
  };
}
