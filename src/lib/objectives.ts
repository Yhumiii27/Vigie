// Objectifs QHSE mesurables (AUD-13, ISO 9001 §6.2 et §9.1) : indicateurs calculés de Vigie auxquels un objectif fixe une
// cible pour une année. Règles pures, client et serveur ; la valeur atteinte est calculée (src/lib/objective-values.ts),
// jamais stockée.

import type { Tone } from './domain';

/** Sens de la cible : `max` = ne pas dépasser (TF1 < 4), `min` = atteindre au moins (remontées ≥ 40). */
export type ObjectiveSense = 'max' | 'min';
/** Période mesurée : l'année de l'objectif (mois échus pour l'année en cours), ou l'état à la date du jour. */
export type ObjectivePeriod = 'year' | 'now';

export const OBJECTIVE_INDICATORS = {
  tf1: { label: 'TF1 · accidents du travail avec arrêt par million d’heures', short: 'TF1', sense: 'max', unit: '', decimals: 1, period: 'year' },
  tg: { label: 'TG · jours perdus par millier d’heures', short: 'TG', sense: 'max', unit: '', decimals: 2, period: 'year' },
  accidents_arret: { label: 'Accidents du travail avec arrêt de l’effectif', short: 'AT avec arrêt', sense: 'max', unit: '', decimals: 0, period: 'year' },
  remontees: { label: 'Presque-accidents et situations dangereuses signalés', short: 'Remontées PA + SD', sense: 'min', unit: '', decimals: 0, period: 'year' },
  nc: { label: 'Non-conformités enregistrées', short: 'Non-conformités', sense: 'max', unit: '', decimals: 0, period: 'year' },
  reclamations: { label: 'Réclamations client', short: 'Réclamations', sense: 'max', unit: '', decimals: 0, period: 'year' },
  cout_non_qualite: { label: 'Coût de non-qualité (NC et réclamations, € HT)', short: 'Coût de non-qualité', sense: 'max', unit: '€', decimals: 0, period: 'year' },
  actions_efficaces: { label: 'Actions jugées efficaces (% des actions vérifiées dans l’année)', short: 'Actions efficaces', sense: 'min', unit: '%', decimals: 0, period: 'year' },
  actions_retard: { label: 'Actions en retard (% des actions ouvertes, à ce jour)', short: 'Actions en retard', sense: 'max', unit: '%', decimals: 0, period: 'now' },
  controles_depasses: { label: 'Contrôles réglementaires dépassés (à ce jour)', short: 'Contrôles dépassés', sense: 'max', unit: '', decimals: 0, period: 'now' },
} as const satisfies Record<string, { label: string; short: string; sense: ObjectiveSense; unit: '' | '%' | '€'; decimals: number; period: ObjectivePeriod }>;
export type ObjectiveIndicator = keyof typeof OBJECTIVE_INDICATORS;
export const OBJECTIVE_INDICATOR_KEYS = Object.keys(OBJECTIVE_INDICATORS) as ObjectiveIndicator[];
export const isObjectiveIndicator = (k: string): k is ObjectiveIndicator => k in OBJECTIVE_INDICATORS;

/** Valeur affichée : « 3,2 », « 45 % », « 12 400 € » ; « — » sans mesure. */
export function fmtObjectiveValue(indicator: ObjectiveIndicator, v: number | null): string {
  if (v == null) return '—';
  const def = OBJECTIVE_INDICATORS[indicator];
  const n = v.toLocaleString('fr-FR', { minimumFractionDigits: def.decimals, maximumFractionDigits: def.decimals });
  return def.unit === '%' ? `${n} %` : def.unit === '€' ? `${n} €` : n;
}

/** Cible affichée : « < 4 » (ne pas dépasser) ou « ≥ 40 » (atteindre au moins). */
export function fmtObjectiveTarget(indicator: ObjectiveIndicator, target: number): string {
  return `${OBJECTIVE_INDICATORS[indicator].sense === 'max' ? '≤' : '≥'} ${fmtObjectiveValue(indicator, target)}`;
}

/**
 * État d'un objectif d'après sa valeur calculée : sans mesure (heures non saisies, année future…) ; atteint ou non. Année
 * en cours (`final` faux) : « à ce jour » — une cible « ne pas dépasser » déjà dépassée est perdue, une cible « atteindre »
 * reste à atteindre.
 */
export function objectiveStatus(value: number | null, target: number, sense: ObjectiveSense, final: boolean): { key: 'none' | 'met' | 'missed' | 'pending'; label: string; tone: Tone } {
  if (value == null) return { key: 'none', label: 'Non mesuré', tone: 'neutral' };
  const met = sense === 'max' ? value <= target : value >= target;
  if (met) return { key: 'met', label: final ? 'Atteint' : 'Atteint à ce jour', tone: 'ok' };
  if (!final && sense === 'min') return { key: 'pending', label: 'À atteindre', tone: 'warn' };
  return { key: 'missed', label: final ? 'Non atteint' : 'Dépassé', tone: 'danger' };
}

/** Longueurs maximales du libellé d'un objectif. */
export const OBJECTIVE_LABEL_MAX = 200;
