import 'server-only';
import { cache } from 'react';
import { asc, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { toParisLocal } from '../dates';
import type { Tone } from '../domain';
import { today } from '@/lib/today';
import { OBJECTIVE_INDICATORS, isObjectiveIndicator, objectiveStatus, type ObjectiveIndicator } from '../objectives';
import { objectiveValue, type ObjectiveData } from '../objective-values';
import { loadPeople } from '../queries';
import { getSession, inPerimeter } from '../session';
import type { Option } from './options';

// ─── Objectifs QHSE mesurables (AUD-13) ─────────────────────────────────────

export type ObjectiveView = {
  id: number; year: number; label: string; indicator: ObjectiveIndicator; indicatorLabel: string; target: number;
  siteId: string | null; site: string; pilotId: string | null; pilot: string;
  reviewDecisionId: number | null; reviewDecision: string | null;
  value: number | null; status: { key: string; label: string; tone: Tone };
  archived: { on: string; by: string; reason: string } | null;
};

/**
 * Données des indicateurs, lues sur toute l'entreprise (un objectif vaut pour son site ou pour tous les sites, quel que
 * soit le site sélectionné) : les objectifs n'en montrent que des agrégats. Maladies professionnelles exclues (aucun
 * indicateur ne les compte).
 */
export const loadObjectiveData = cache(async (): Promise<ObjectiveData> => {
  const db = await getDb();
  const [events, actions, controls, hours, sites] = await Promise.all([
    db.select({
      type: t.events.type, injury: t.events.injury, lostDays: t.events.lostDays, occurredOn: t.events.occurredOn, siteId: t.events.siteId,
      victimKind: t.events.victimKind, commute: t.events.commute, ncCost: t.events.ncCost, dismissedAt: t.events.dismissedAt,
    }).from(t.events),
    db.select({ siteId: t.actions.siteId, status: t.actions.status, dueOn: t.actions.dueOn, closedOn: t.actions.closedOn, effective: t.actions.effective }).from(t.actions),
    db.select({ siteId: t.controls.siteId, nextOn: t.controls.nextOn, archivedAt: t.controls.archivedAt }).from(t.controls),
    db.select().from(t.hoursWorked),
    db.select({ id: t.sites.id, archivedAt: t.sites.archivedAt }).from(t.sites),
  ]);
  return {
    events: events.filter((e) => e.type !== 'MP'), actions, controls, hours,
    sites: sites.map((s) => ({ id: s.id, archivedOn: s.archivedAt ? toParisLocal(s.archivedAt).slice(0, 10) : null })),
  };
});

/**
 * Objectifs QHSE de l'année (tous les objectifs, archivés compris), avec leur valeur calculée et leur état : objectifs de
 * tous les sites et des sites du périmètre de la personne. `year` : année demandée (par défaut l'année en cours).
 */
export const loadObjectives = cache(async (year?: number) => {
  const db = await getDb();
  const now = today();
  const y = year ?? +now.slice(0, 4);
  const [{ allowedSiteIds }, rows, data, people, sites, decisions] = await Promise.all([
    getSession(),
    db.select().from(t.qhseObjectives).orderBy(asc(t.qhseObjectives.year), asc(t.qhseObjectives.sort), asc(t.qhseObjectives.id)),
    loadObjectiveData(),
    loadPeople(),
    db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites),
    db.select({ id: t.reviewDecisions.id, text: t.reviewDecisions.text, reviewOn: t.reviews.reviewOn })
      .from(t.reviewDecisions).innerJoin(t.reviews, eq(t.reviews.id, t.reviewDecisions.reviewId)).where(eq(t.reviewDecisions.kind, 'objectif')),
  ]);
  const siteLabel = new Map(sites.map((s) => [s.id, s.label.split(' — ')[0]]));
  const decisionText = new Map(decisions.map((d) => [d.id, d.text]));
  const name = (id: string | null) => (id ? people.get(id)?.name ?? id : '—');
  const views: ObjectiveView[] = rows
    .filter((o) => o.year === y && inPerimeter(allowedSiteIds, o.siteId) && isObjectiveIndicator(o.indicator))
    .map((o) => {
      const indicator = o.indicator as ObjectiveIndicator;
      const def = OBJECTIVE_INDICATORS[indicator];
      const value = objectiveValue(indicator, data, { year: o.year, now, siteId: o.siteId });
      const final = o.year < +now.slice(0, 4);
      return {
        id: o.id, year: o.year, label: o.label, indicator, indicatorLabel: def.label, target: o.target,
        siteId: o.siteId, site: o.siteId ? siteLabel.get(o.siteId) ?? o.siteId : 'Tous les sites', pilotId: o.pilotId, pilot: name(o.pilotId),
        reviewDecisionId: o.reviewDecisionId, reviewDecision: o.reviewDecisionId ? decisionText.get(o.reviewDecisionId) ?? null : null,
        value, status: objectiveStatus(value, o.target, def.sense, final),
        archived: o.archivedAt ? { on: toParisLocal(o.archivedAt).slice(0, 10), by: name(o.archivedById), reason: o.archiveReason ?? '' } : null,
      };
    });
  const years = [...new Set([...rows.map((o) => o.year), +now.slice(0, 4), +now.slice(0, 4) + 1])].sort((a, b) => a - b);
  return {
    year: y, years, objectives: views.filter((o) => !o.archived), archived: views.filter((o) => o.archived),
    /** Décisions de revue de nature « objectif » (rattachement facultatif). */
    decisionOptions: decisions.sort((a, b) => b.reviewOn.localeCompare(a.reviewOn)).map((d) => [String(d.id), `${d.reviewOn.slice(0, 4)} · ${d.text}`] as Option),
  };
});
export type ObjectivesData = Awaited<ReturnType<typeof loadObjectives>>;

/**
 * Cible TF1 de l'année (tableau de bord, dossier de revue) : objectif « TF1 » en vigueur du site, sinon de tous les sites ;
 * null sans objectif (plus de cible codée en dur, AUD-13).
 */
export async function tf1Target(year: number, siteId: string | null): Promise<number | null> {
  const db = await getDb();
  const rows = (await db.select().from(t.qhseObjectives).where(eq(t.qhseObjectives.indicator, 'tf1')))
    .filter((o) => o.year === year && !o.archivedAt);
  return (rows.find((o) => siteId && o.siteId === siteId) ?? rows.find((o) => !o.siteId))?.target ?? null;
}
