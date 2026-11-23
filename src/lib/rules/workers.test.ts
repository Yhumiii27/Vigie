import { describe, expect, it } from 'vitest';
import { inductionWarning, vetoAllowed, vetoBlocker, workerCheck } from './workers';

const held = (expiresOn: string | null, extra: Partial<{ prerequisiteMissing: boolean; measure: 'suspension' | 'retrait' | null }> = {}) =>
  ({ expiresOn, usableUntil: expiresOn, prerequisiteMissing: false, measure: null, measureOn: null, ...extra });
const NOW = '2026-10-09';

describe('intervenants d’un plan de prévention (PRV-23)', () => {
  it('accueil sécurité : à jour, manquant, sans titre désigné, Cursus indisponible', () => {
    const base = { inductionTitleIds: ['formation.accueil'], required: [], heldOk: true };
    expect(workerCheck({ ...base, held: new Map([['formation.accueil', held(null)]]) }, NOW).induction).toBe('ok');
    expect(workerCheck({ ...base, held: new Map([['formation.accueil', held('2026-01-01')]]) }, NOW).induction).toBe('missing');
    expect(workerCheck({ ...base, held: new Map() }, NOW).induction).toBe('missing');
    expect(workerCheck({ ...base, inductionTitleIds: [], held: new Map() }, NOW).induction).toBe('none');
    expect(workerCheck({ ...base, held: new Map(), heldOk: false }, NOW)).toEqual({ induction: 'unknown', lapsedTitles: [], titlesValid: null });
  });

  it('titres requis : expirés, suspendus ou jamais suivis listés ; veto seulement si quelque chose n’est pas à jour', () => {
    const c = workerCheck({
      inductionTitleIds: ['formation.accueil'], heldOk: true,
      required: [{ titleId: 'habilitation.he', label: 'Habilitation électrique' }, { titleId: 'formation.sst', label: 'SST' }, { titleId: 'habilitation.atex', label: 'ATEX' }],
      held: new Map([['formation.accueil', held(null)], ['habilitation.he', held('2026-05-01')], ['formation.sst', held('2027-12-01', { measure: 'suspension' })]]),
    }, NOW);
    expect(c.lapsedTitles).toEqual(['Habilitation électrique', 'SST', 'ATEX']);
    expect(c.titlesValid).toBe(false);
    expect(vetoAllowed(c)).toBe(true);
    expect(vetoAllowed({ induction: 'ok', lapsedTitles: [], titlesValid: true })).toBe(false);
    expect(vetoAllowed({ induction: 'none', lapsedTitles: [], titlesValid: true })).toBe(false);
    expect(vetoAllowed({ induction: 'unknown', lapsedTitles: [], titlesValid: null })).toBe(true);
  });

  it('avertissement non bloquant et blocage par un veto', () => {
    const ok = { induction: 'ok' as const, lapsedTitles: [], titlesValid: true };
    expect(inductionWarning([{ name: 'A', check: ok }])).toBeNull();
    expect(inductionWarning([{ name: 'A', check: ok }, { name: '[B. Morel]', check: { ...ok, induction: 'missing' } }])).toBe('Accueil sécurité non à jour : [B. Morel].');
    expect(inductionWarning([{ name: 'A', check: { ...ok, induction: 'unknown' } }])).toMatch(/donnée indisponible/);
    expect(vetoBlocker([], 'signer le plan')).toBeNull();
    expect(vetoBlocker(['[B. Morel]'], 'délivrer le permis')).toMatch(/l'intervenant \[B. Morel\] : impossible de délivrer le permis/);
  });
});
