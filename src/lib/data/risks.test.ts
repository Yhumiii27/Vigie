import { describe, expect, it } from 'vitest';
import { nextVersion } from '@/components/documents/meta';
import { levelName, parseVersion, riskFlag, suggestNextVersion, versionConflict } from './risks';

// Règles du DUERP (QUA-03) : alerte calculée d'un risque, numéros de version ; indices de version des documents maîtrisés.

describe('riskFlag : alerte calculée d’un risque', () => {
  const risk = (g: number, p: number, rg: number, rp: number, residualReviewedOn: string | null = null) =>
    ({ gravity: g, probability: p, residualGravity: rg, residualProbability: rp, residualReviewedOn });
  it('cotation brute ≥ 8 sans action : à définir', () => {
    expect(riskFlag(risk(4, 2, 4, 2), [])).toEqual({ flag: 'toDefine', lastClosedOn: null });
    expect(riskFlag(risk(3, 2, 3, 2), [])).toEqual({ flag: null, lastClosedOn: null });
  });
  it('actions en cours : aucune alerte', () => {
    expect(riskFlag(risk(4, 4, 4, 4), [{ done: true, closedOn: '2026-09-01' }, { done: false, closedOn: null }]).flag).toBeNull();
  });
  it('toutes les actions clôturées : résiduel encore élevé, ou à recoter depuis la dernière clôture', () => {
    const closed = [{ done: true, closedOn: '2026-09-01' }, { done: true, closedOn: '2026-09-20' }];
    expect(riskFlag(risk(4, 4, 3, 3), closed)).toEqual({ flag: 'residualHigh', lastClosedOn: '2026-09-20' });
    expect(riskFlag(risk(4, 4, 2, 2), closed)).toEqual({ flag: 'toReview', lastClosedOn: '2026-09-20' });
    expect(riskFlag(risk(4, 4, 2, 2, '2026-09-10'), closed).flag).toBe('toReview');
    expect(riskFlag(risk(4, 4, 2, 2, '2026-09-20'), closed).flag).toBeNull();
  });
  it('libellé du niveau', () => {
    expect([2, 4, 9, 16].map(levelName)).toEqual(['Faible', 'Modéré', 'Élevé', 'Critique']);
  });
});

describe('versions du DUERP (AAAA.n)', () => {
  it('format canonique, version suivante, conflits', () => {
    expect(parseVersion('2026.2')).toEqual([2026, 2]);
    expect(parseVersion('2026.02')).toBeNull();
    expect(parseVersion('2027.0')).toBeNull();
    expect(versionConflict(['2025.1', '2026.1'], '2026.2')).toBeNull();
    expect(versionConflict(['2026.1'], '2026.1')).toBe('Ce numéro de version existe déjà.');
    expect(versionConflict(['2026.2'], '2026.1')).toBe('Doit suivre la dernière version (2026.2).');
    expect(versionConflict([], 'v3')).toBe('Format attendu : AAAA.n (ex. 2026.2).');
    expect(suggestNextVersion(['2026.1', '2026.3', '2025.4'], '2026-10-09')).toBe('2026.4');
    expect(suggestNextVersion(['2026.3'], '2027-01-05')).toBe('2027.1');
  });
});

describe('indices de version des documents maîtrisés', () => {
  it('A → B, Z → AA, AZ → BA', () => {
    expect(nextVersion([])).toBe('A');
    expect(nextVersion(['A', 'C', 'B'])).toBe('D');
    expect(nextVersion(['Y', 'Z'])).toBe('AA');
    expect(nextVersion(['AZ', 'B'])).toBe('BA');
  });
});
