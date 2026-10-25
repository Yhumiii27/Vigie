import 'server-only';
import { cache } from 'react';
import { isNotNull, or } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import {
  inGapWindow, lacksSignedPlan, permitLacksSignedPlan, referenceNow, startGap, type SiteRule, type StartGapKind,
} from '@/components/prevention/model';
import { today } from '@/lib/today';
import { loadPeople, loadSiteRows } from '../queries';
import { currentSiteId, siteFilter, type SiteScope } from '../session';

// Lignes de la prévention (plans, permis, référentiels, règle de chaque site) et écarts R. 4512-6, partagés par l'écran
// (src/lib/data/prevention.ts) et par les échéances et l'indicateur de la veille (src/lib/data/prevention-signals.ts) —
// QUA-26.

/**
 * Lignes du site sélectionné (scope 'site') ou de tout le périmètre (scope 'perimeter' : échéances, TDB-05) — plans,
 * permis —, référentiels et règle de prévention de chaque site.
 */
export const loadRows = cache(async (scope: SiteScope = 'site') => {
  const [db, site, people, keep] = await Promise.all([getDb(), currentSiteId(), loadPeople(), siteFilter(scope)]);
  const [contractors, plans, permits, sites, activities, linkedEvents] = await Promise.all([
    db.select().from(t.contractors),
    db.select().from(t.preventionPlans),
    db.select().from(t.permits),
    loadSiteRows(),
    // Activités de la carte (tous sites) : rattachements qui empêchent de supprimer ou d'annuler un plan.
    db.select({ planId: t.siteActivities.preventionPlanId, endOn: t.siteActivities.endOn, cancelled: isNotNull(t.siteActivities.cancelledAt) }).from(t.siteActivities),
    db.select({
      id: t.events.id, planId: t.events.preventionPlanId, permitId: t.events.permitId, type: t.events.type, title: t.events.title,
      occurredOn: t.events.occurredOn, step: t.events.step, dismissedAt: t.events.dismissedAt,
    }).from(t.events).where(or(isNotNull(t.events.preventionPlanId), isNotNull(t.events.permitId))),
  ]);
  const now = today();
  const rules = new Map(sites.map((s): [string, SiteRule] => [s.id, { seveso: s.seveso, ppFromFirstMinute: s.ppFromFirstMinute }]));
  return {
    db,
    now,
    nowMs: referenceNow(now).getTime(),
    people,
    contractors: contractors.sort((a, b) => a.name.replace(/^\[/, '').localeCompare(b.name.replace(/^\[/, ''), 'fr', { sensitivity: 'base' })),
    sites,
    selectedSite: site,
    ruleOf: (siteId: string) => rules.get(siteId),
    allPlans: plans,
    allPermits: permits,
    activities,
    /** Plans cités par un événement (signalement lié à l'intervention). */
    eventPlanIds: new Set(linkedEvents.map((e) => e.planId).filter(Boolean)),
    linkedEvents,
    plans: plans.filter((p) => keep(p.siteId)),
    permits: permits.filter((p) => keep(p.siteId)),
  };
});
export type Rows = Awaited<ReturnType<typeof loadRows>>;
export type PermitRow = Rows['allPermits'][number];

/**
 * Écarts du site sélectionné (même calcul pour l'écran, le badge et les échéances) : interventions en cours sans plan
 * obligatoire signé, et permis d'entreprises extérieures (demandés ou délivrés) sans plan signé couvrant leur validité
 * sur un site « dès la première minute ». L'indicateur compte des interventions : un permis rattaché à un plan déjà en écart
 * relève de la même intervention et n'est compté qu'une fois, avec son plan (affiché « Écart · compté avec PP-… »).
 */
export function gapsOf({ now, nowMs, plans, permits, allPlans, ruleOf }: Rows) {
  const planById = new Map(allPlans.map((p) => [p.id, p]));
  const linkedPlan = (p: PermitRow) => (p.preventionPlanId ? planById.get(p.preventionPlanId) : undefined);
  const planGaps = new Set(plans.filter((p) => lacksSignedPlan(p, now, ruleOf(p.siteId))).map((p) => p.id));
  const permitGaps = new Set(permits.filter((p) => permitLacksSignedPlan(p, linkedPlan(p), ruleOf(p.siteId), nowMs)).map((p) => p.id));
  /** Permis en écart rattaché à un plan en écart → référence du plan qui porte l'écart. */
  const gapWith = new Map(permits
    .filter((p) => permitGaps.has(p.id) && p.preventionPlanId && planGaps.has(p.preventionPlanId))
    .map((p): [string, string] => [p.id, p.preventionPlanId!]));
  const countedPermitGaps = new Set([...permitGaps].filter((id) => !gapWith.has(id)));
  return { linkedPlan, planGaps, permitGaps, gapWith, countedPermitGaps };
}

export type PlanRow = Rows['allPlans'][number];

/**
 * Écarts et nombre d'interventions sans plan signé (plans en écart, permis en écart comptés à part) : même calcul pour
 * l'écran et la veille. Écarts passés (PRV-01, indicateurs seulement, ni badge ni échéance) : interventions commencées
 * dans les 12 derniers mois avec un plan obligatoire signé après leur début, ou réalisées sans plan signé, hors écarts
 * en cours ; plans annulés et permis exclus (la délivrance d'un permis exige déjà un plan signé).
 */
export function gapSummary(rows: Rows) {
  const { now, plans, ruleOf } = rows;
  const gaps = gapsOf(rows);
  const pastGaps = plans
    .filter((p) => !gaps.planGaps.has(p.id) && inGapWindow(p, now))
    .map((p) => ({ plan: p, kind: startGap(p, now, ruleOf(p.siteId)) }))
    .filter((x): x is { plan: PlanRow; kind: StartGapKind } => !!x.kind)
    .sort((a, b) => b.plan.startOn.localeCompare(a.plan.startOn));
  return { gaps, gapCount: gaps.planGaps.size + gaps.countedPermitGaps.size, pastGaps, pastGapCount: pastGaps.length };
}

/** Permis encore actifs (demandés ou délivrés, éventuellement expirés non clos). */
export const isOpenPermit = (p: { status: string }) => p.status === 'demande' || p.status === 'delivre';
export const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n > 1 ? p : s}`;
