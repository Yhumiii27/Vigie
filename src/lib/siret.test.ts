import { describe, expect, it } from 'vitest';
import { fmtSiret, isEuVatNumber, isSiret, normalizeSiret } from './siret';

describe('SIRET (registre des déchets, DOC-02)', () => {
  it('clé de Luhn sur 14 chiffres', () => {
    expect(isSiret('00000000000018')).toBe(true);
    expect(isSiret('00000000000026')).toBe(true);
    expect(isSiret('12345678901234')).toBe(false);
    expect(isSiret('0000000000018')).toBe(false); // 13 chiffres
    expect(isSiret('0000000000001A')).toBe(false);
  });
  it('établissements de La Poste : somme des chiffres multiple de 5', () => {
    expect(isSiret('35600000000010')).toBe(true);
    expect(isSiret('35600000000048')).toBe(true); // siège, clé de Luhn
    expect(isSiret('35600000000011')).toBe(false);
  });
  it('saisie normalisée et affichage', () => {
    expect(normalizeSiret(' 000 000 000-000.18 ')).toBe('00000000000018');
    expect(normalizeSiret('de 123456789')).toBe('DE123456789');
    expect(fmtSiret('00000000000018')).toBe('000 000 000 00018');
    expect(fmtSiret('DE123456789')).toBe('DE123456789');
  });
  it('numéro de TVA intracommunautaire étranger', () => {
    expect(isEuVatNumber('DE123456789')).toBe(true);
    expect(isEuVatNumber('BE0123456789')).toBe(true);
    expect(isEuVatNumber('FR12345678901')).toBe(false);
    expect(isEuVatNumber('D1')).toBe(false);
  });
});
