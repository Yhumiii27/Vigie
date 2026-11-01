import { describe, expect, it } from 'vitest';
import { cellLabel, inCell, matrixRows, parseCellFilter } from './matrix';

// DUE-16 : matrice G × P accessible et filtrante.

const risks = [
  { gravity: 3, probability: 2, residualGravity: 2, residualProbability: 1 },
  { gravity: 3, probability: 2, residualGravity: 1, residualProbability: 1 },
  { gravity: 4, probability: 4, residualGravity: 2, residualProbability: 1 },
];

describe('matrice gravité × probabilité (DUE-16)', () => {
  it('lignes G4 → G1, colonnes P1 → P4, comptes bruts ou résiduels', () => {
    const brut = matrixRows(risks, false);
    expect(brut.map((l) => l[0].g)).toEqual([4, 3, 2, 1]);
    expect(brut[0].map((c) => c.p)).toEqual([1, 2, 3, 4]);
    expect(brut[1][1]).toMatchObject({ g: 3, p: 2, n: 2, score: 6, level: 'Modéré' });
    expect(brut[0][3]).toMatchObject({ n: 1, level: 'Critique' });
    expect(matrixRows(risks, true)[2][0]).toMatchObject({ g: 2, p: 1, n: 2 });
    expect(brut.flat().reduce((n, c) => n + c.n, 0)).toBe(3);
  });

  it('filtre d’URL : deux valeurs de 1 à 4, sinon aucun', () => {
    expect(parseCellFilter({ gravite: '3', probabilite: '2' })).toEqual({ g: 3, p: 2 });
    expect(parseCellFilter({ gravite: '3' })).toBeNull();
    expect(parseCellFilter({ gravite: '5', probabilite: '2' })).toBeNull();
    expect(parseCellFilter({ gravite: ['3', '4'], probabilite: '2' })).toBeNull();
  });

  it('risques de la case, cotation brute ou résiduelle', () => {
    expect(risks.filter((r) => inCell(r, { g: 3, p: 2 }, false))).toHaveLength(2);
    expect(risks.filter((r) => inCell(r, { g: 2, p: 1 }, true))).toHaveLength(2);
    expect(risks.filter((r) => inCell(r, null, false))).toHaveLength(3);
  });

  it('nom accessible de la case', () => {
    expect(cellLabel(matrixRows(risks, false)[1][1])).toBe('Gravité 3 × probabilité 2 = 6 · Modéré : 2 risques');
    expect(cellLabel(matrixRows(risks, false)[0][3])).toBe('Gravité 4 × probabilité 4 = 16 · Critique : 1 risque');
  });
});
