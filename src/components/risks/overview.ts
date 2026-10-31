import { RISK_ACTION_THRESHOLD, riskLevel, type RiskFlag } from '@/lib/domain';

// Vue d'ensemble du DUERP toutes unités (DUE-17) : règles pures, calculées à l'affichage, jamais stockées — matrice
// gravité × probabilité de toutes les unités du site sélectionné, risques prioritaires, synthèse par unité.

export type OverviewRisk = {
  id: number; unitId: string; hazard: string; situation: string;
  gravity: number; probability: number; residualGravity: number; residualProbability: number; flag: RiskFlag | null;
};
export type OverviewUnit = { id: string; label: string; site: string };

export type DuerpOverview = {
  /** Comptes de la matrice : ligne = gravité 4 → 1, colonne = probabilité 1 → 4 (cotation brute ou résiduelle). */
  matrix: number[][];
  totals: { risks: number; units: number; high: number; residualHigh: number; toDefine: number; residualStillHigh: number; toReview: number };
  /**
   * Risques prioritaires : résiduel ≥ seuil, ou alerte « À définir » / « Résiduel encore élevé » ; triés par cotation
   * résiduelle décroissante, puis brute décroissante, puis unité.
   */
  priority: (OverviewRisk & { unit: string; gross: number; residual: number })[];
  /** Synthèse par unité (ordre des unités) : risques, élevés en brut, résiduels ≥ seuil, niveau brut le plus élevé. */
  byUnit: (OverviewUnit & { count: number; high: number; residualHigh: number; alerts: number; top: number })[];
};

const gross = (r: OverviewRisk) => r.gravity * r.probability;
const residualOf = (r: OverviewRisk) => r.residualGravity * r.residualProbability;

/** Vue d'ensemble des risques en vigueur des unités données (`residual` : matrice des cotations résiduelles). */
export function duerpOverview(units: readonly OverviewUnit[], risks: readonly OverviewRisk[], residual: boolean): DuerpOverview {
  const unitIds = new Set(units.map((u) => u.id));
  const mine = risks.filter((r) => unitIds.has(r.unitId));
  const matrix = [4, 3, 2, 1].map((g) => [1, 2, 3, 4].map((p) => mine.filter((r) =>
    (residual ? r.residualGravity : r.gravity) === g && (residual ? r.residualProbability : r.probability) === p).length));
  const unitLabel = new Map(units.map((u) => [u.id, u.label]));
  const order = new Map(units.map((u, i) => [u.id, i]));
  const priority = mine
    .filter((r) => residualOf(r) >= RISK_ACTION_THRESHOLD || r.flag === 'toDefine' || r.flag === 'residualHigh')
    .map((r) => ({ ...r, unit: unitLabel.get(r.unitId) ?? r.unitId, gross: gross(r), residual: residualOf(r) }))
    .sort((a, b) => b.residual - a.residual || b.gross - a.gross || (order.get(a.unitId)! - order.get(b.unitId)!) || a.id - b.id);
  return {
    matrix,
    totals: {
      risks: mine.length,
      units: units.length,
      high: mine.filter((r) => gross(r) >= RISK_ACTION_THRESHOLD).length,
      residualHigh: mine.filter((r) => residualOf(r) >= RISK_ACTION_THRESHOLD).length,
      toDefine: mine.filter((r) => r.flag === 'toDefine').length,
      residualStillHigh: mine.filter((r) => r.flag === 'residualHigh').length,
      toReview: mine.filter((r) => r.flag === 'toReview').length,
    },
    priority,
    byUnit: units.map((u) => {
      const ur = mine.filter((r) => r.unitId === u.id);
      return {
        ...u,
        count: ur.length,
        high: ur.filter((r) => gross(r) >= RISK_ACTION_THRESHOLD).length,
        residualHigh: ur.filter((r) => residualOf(r) >= RISK_ACTION_THRESHOLD).length,
        alerts: ur.filter((r) => r.flag === 'toDefine' || r.flag === 'residualHigh').length,
        top: Math.max(0, ...ur.map((r) => riskLevel(gross(r)))),
      };
    }),
  };
}
