import { describe, expect, it } from 'vitest';
import { fmtEuro } from './risk-format';

// Montants du programme annuel de prévention : même rendu côté serveur et navigateur (pas d'Intl).
describe('fmtEuro', () => {
  it('milliers en espace fine insécable, centimes seulement s’il y en a', () => {
    expect(fmtEuro(0)).toBe('0 €');
    expect(fmtEuro(950)).toBe('950 €');
    expect(fmtEuro(12000)).toBe('12 000 €');
    expect(fmtEuro(950.5)).toBe('950,50 €');
    expect(fmtEuro(1234567.891)).toBe('1 234 567,89 €');
    expect(fmtEuro(-1500)).toBe('−1 500 €');
  });
});
