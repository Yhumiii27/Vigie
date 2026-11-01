import { describe, expect, it } from 'vitest';
import { duerpOverview, type OverviewRisk } from './overview';

// DUE-17 : vue d'ensemble du DUERP toutes unités (matrice globale, risques prioritaires, résiduels ≥ 8).

const risk = (id: number, unitId: string, g: number, p: number, rg: number, rp: number, flag: OverviewRisk['flag'] = null): OverviewRisk =>
  ({ id, unitId, hazard: `Danger ${id}`, situation: '', gravity: g, probability: p, residualGravity: rg, residualProbability: rp, flag });
const units = [{ id: 'a', label: 'Atelier', site: 'Ville A' }, { id: 'b', label: 'Magasin', site: 'Ville A' }];

describe('duerpOverview', () => {
  const risks = [
    risk(1, 'a', 4, 3, 2, 2), // brut 12, résiduel 4
    risk(2, 'a', 3, 3, 3, 3, 'residualHigh'), // résiduel 9
    risk(3, 'b', 2, 4, 2, 4, 'toDefine'), // brut 8 sans action, résiduel 8
    risk(4, 'b', 1, 1, 1, 1),
    risk(5, 'z', 4, 4, 4, 4), // unité hors du site : ignorée
  ];

  it('matrice globale brute et résiduelle, toutes unités du site', () => {
    const brut = duerpOverview(units, risks, false);
    expect(brut.matrix[0]).toEqual([0, 0, 1, 0]); // G4 : P3
    expect(brut.matrix[3]).toEqual([1, 0, 0, 0]); // G1 : P1
    expect(brut.matrix.flat().reduce((n, v) => n + v, 0)).toBe(4);
    const res = duerpOverview(units, risks, true);
    expect(res.matrix[1]).toEqual([0, 0, 1, 0]); // G3 P3
    expect(res.matrix[2]).toEqual([0, 1, 0, 1]); // G2 P2, G2 P4
  });

  it('totaux et risques prioritaires triés par résiduel décroissant', () => {
    const o = duerpOverview(units, risks, false);
    expect(o.totals).toEqual({ risks: 4, units: 2, high: 3, residualHigh: 2, toDefine: 1, residualStillHigh: 1, toReview: 0 });
    expect(o.priority.map((r) => r.id)).toEqual([2, 3]);
    expect(o.priority[0]).toMatchObject({ unit: 'Atelier', residual: 9, gross: 9 });
  });

  it('synthèse par unité', () => {
    const o = duerpOverview(units, risks, false);
    expect(o.byUnit).toEqual([
      { id: 'a', label: 'Atelier', site: 'Ville A', count: 2, high: 2, residualHigh: 1, alerts: 1, top: 3 },
      { id: 'b', label: 'Magasin', site: 'Ville A', count: 2, high: 1, residualHigh: 1, alerts: 1, top: 2 },
    ]);
  });

  it('sans unité ni risque', () => {
    const o = duerpOverview([], [], false);
    expect(o.priority).toEqual([]);
    expect(o.totals.risks).toBe(0);
    expect(o.matrix.flat().every((n) => n === 0)).toBe(true);
  });
});
