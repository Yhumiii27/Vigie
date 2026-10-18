// Valeurs calculées des objectifs QHSE (AUD-13) : jamais stockées, recalculées à chaque affichage d'après les données et
// la date du jour. Règles pures (tests : objective-values.test.ts).

import { isLate } from './action-rules';
import { isOpenAvancement } from './domain';
import { workforceAccident, safetyRates } from './queries';
import { OBJECTIVE_INDICATORS, type ObjectiveIndicator } from './objectives';

export type ObjectiveEvent = {
  type: string; injury: string | null; lostDays: number | null; occurredOn: string; siteId: string; victimKind: string | null;
  commute: boolean | null; ncCost: number | null; dismissedAt: Date | string | null;
};
export type ObjectiveAction = { siteId: string | null; status: string; dueOn: string; closedOn: string | null; effective: boolean | null };
export type ObjectiveControl = { siteId: string | null; nextOn: string; archivedAt: Date | string | null };
export type ObjectiveData = {
  events: readonly ObjectiveEvent[]; actions: readonly ObjectiveAction[]; controls: readonly ObjectiveControl[];
  hours: readonly { month: string; siteId: string; hours: number }[];
  sites: readonly { id: string; archivedOn: string | null }[];
};

/** Mois « AAAA-MM » échus de l'année (tous pour une année passée, aucun pour une année future). */
export function elapsedMonths(year: number, now: string): string[] {
  const y = +now.slice(0, 4), m = +now.slice(5, 7);
  const last = year < y ? 12 : year === y ? m - 1 : 0;
  return Array.from({ length: last }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
}

/**
 * Valeur d'un indicateur pour un objectif (année, site ou tous les sites) : TF1 et TG sur les mois échus de l'année
 * (safetyRates : accidents de l'effectif, hors trajet, mois sans heures écartés ; null sans heures) ; comptages de l'année
 * (événements non classés sans suite) ; taux d'efficacité des actions vérifiées dans l'année ; retards et contrôles
 * dépassés à la date du jour (année en cours seulement, null sinon). null : non mesurable.
 */
export function objectiveValue(indicator: ObjectiveIndicator, data: ObjectiveData, opts: { year: number; now: string; siteId: string | null }): number | null {
  const { year, now, siteId } = opts;
  const inScope = (s: string | null) => !siteId || s === siteId;
  const yearOf = (d: string) => +d.slice(0, 4);
  if (OBJECTIVE_INDICATORS[indicator].period === 'now' && year !== yearOf(now)) return null;
  if (year > yearOf(now)) return null;
  const events = data.events.filter((e) => !e.dismissedAt && inScope(e.siteId) && yearOf(e.occurredOn) === year && e.occurredOn <= now);
  switch (indicator) {
    case 'tf1':
    case 'tg': {
      const months = elapsedMonths(year, now);
      if (!months.length) return null;
      const sites = data.sites.filter((s) => inScope(s.id));
      const r = safetyRates({ months, sites, hours: data.hours.filter((h) => inScope(h.siteId)), events: data.events.filter((e) => !e.dismissedAt && inScope(e.siteId)) });
      return indicator === 'tf1' ? r.tf1 : r.tg;
    }
    case 'accidents_arret': return events.filter((e) => workforceAccident(e) && e.injury === 'arret').length;
    case 'remontees': return events.filter((e) => e.type === 'PA' || e.type === 'SD').length;
    case 'nc': return events.filter((e) => e.type === 'NC').length;
    case 'reclamations': return events.filter((e) => e.type === 'RC').length;
    case 'cout_non_qualite': return events.filter((e) => e.type === 'NC' || e.type === 'RC').reduce((n, e) => n + (e.ncCost ?? 0), 0);
    case 'actions_efficaces': {
      const verified = data.actions.filter((a) => inScope(a.siteId) && a.status === 'verifiee' && a.closedOn && yearOf(a.closedOn) === year);
      return verified.length ? (verified.filter((a) => a.effective).length * 100) / verified.length : null;
    }
    case 'actions_retard': {
      const open = data.actions.filter((a) => inScope(a.siteId) && isOpenAvancement(a.status));
      return open.length ? (open.filter((a) => isLate(a, now)).length * 100) / open.length : null;
    }
    case 'controles_depasses': return data.controls.filter((c) => !c.archivedAt && inScope(c.siteId) && c.nextOn < now).length;
  }
}
