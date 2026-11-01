// Matrice gravité × probabilité d'une unité de travail (DUE-16) — règles pures : comptes par case et filtre d'URL
// `?gravite=<1-4>&probabilite=<1-4>` (une case de la matrice, cotation brute ou résiduelle selon `?mode=`).

import { RISK_LEVELS, riskLevel } from '@/lib/domain';

type Rated = { gravity: number; probability: number; residualGravity: number; residualProbability: number };
export type MatrixCell = { g: number; p: number; n: number; score: number; level: string };
export type CellFilter = { g: number; p: number } | null;

const LEVELS = [1, 2, 3, 4] as const;
const ofScale = (v: string | string[] | undefined) => (typeof v === 'string' && /^[1-4]$/.test(v) ? Number(v) : null);

/** Cotation retenue d'un risque : brute, ou résiduelle. */
export const ratingOf = (r: Rated, residual: boolean) => (residual ? { g: r.residualGravity, p: r.residualProbability } : { g: r.gravity, p: r.probability });

/** Lignes de la matrice, de G4 à G1, chacune de P1 à P4, avec le nombre de risques de la case et son niveau. */
export function matrixRows(rows: readonly Rated[], residual: boolean): MatrixCell[][] {
  return [...LEVELS].reverse().map((g) => LEVELS.map((p) => ({
    g, p, score: g * p, level: RISK_LEVELS[riskLevel(g * p)].label.replace(/\s.*$/, ''),
    n: rows.filter((r) => { const c = ratingOf(r, residual); return c.g === g && c.p === p; }).length,
  })));
}

/** Case demandée par l'URL (les deux paramètres valides), sinon aucune. */
export function parseCellFilter(sp: { gravite?: string | string[]; probabilite?: string | string[] }): CellFilter {
  const g = ofScale(sp.gravite);
  const p = ofScale(sp.probabilite);
  return g != null && p != null ? { g, p } : null;
}

/** Risque de la case retenue (toujours vrai sans filtre). */
export const inCell = (r: Rated, f: CellFilter, residual: boolean) => {
  if (!f) return true;
  const c = ratingOf(r, residual);
  return c.g === f.g && c.p === f.p;
};

/** Nom accessible d'une case : « Gravité 3 × probabilité 2 = 6 · Élevé : 2 risques ». */
export const cellLabel = (c: MatrixCell) => `Gravité ${c.g} × probabilité ${c.p} = ${c.score} · ${c.level} : ${c.n} risque${c.n > 1 ? 's' : ''}`;
