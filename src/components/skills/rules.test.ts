import { describe, expect, it } from 'vitest';
import { coversNeed, heldState, isBlocking, lapseFor, period, renewalDue } from './rules';

// Règles des habilitations (QUA-03) : manque au regard d'une affectation Keystone, recyclage à planifier.

const NOW = '2026-10-09';
const span = (startOn: string, endOn: string) => ({ startOn, endOn });

describe('période d’une affectation', () => {
  it('même mois, deux mois, un seul jour', () => {
    expect(period('2026-10-13', '2026-10-17')).toBe('du 13 au 17 octobre');
    expect(period('2026-09-28', '2026-10-02')).toBe('du 28 septembre au 2 octobre');
    expect(period('2026-10-13', '2026-10-13')).toBe('le 13 octobre');
  });
});

describe('lapseFor : manque du titre pour une affectation', () => {
  const a = span('2026-10-20', '2026-10-30');
  it('non requis ou couvrant toute l’affectation : aucun manque', () => {
    expect(lapseFor('n', null, a, NOW)).toBeNull();
    expect(lapseFor('v', null, a, NOW)).toBeNull();
    expect(lapseFor('v', '2026-10-30', a, NOW)).toBeNull(); // valide jusqu'au dernier jour inclus
    expect(lapseFor('s', '2026-11-30', a, NOW)).toBeNull();
  });
  it('jamais suivi, déjà expiré, expire avant le début, expire pendant', () => {
    expect(lapseFor('r', null, a, NOW)).toBe('missing');
    expect(lapseFor('x', '2026-10-01', a, NOW)).toBe('expired');
    expect(lapseFor('s', '2026-10-15', a, NOW)).toBe('before');
    expect(lapseFor('s', '2026-10-25', a, NOW)).toBe('during');
  });
  it('seul un manque « pendant » laisse intervenir le salarié au début de l’affectation', () => {
    expect([null, 'during', 'before', 'expired', 'missing'].map((l) => isBlocking(l as Parameters<typeof isBlocking>[0]))).toEqual([false, false, true, true, true]);
  });
});

describe('heldState', () => {
  it('même règle que la matrice : expiré, sous 60 jours, valide', () => {
    expect(heldState(null, NOW)).toBe('v');
    expect(heldState('2026-10-08', NOW)).toBe('x');
    expect(heldState('2026-12-08', NOW)).toBe('s');
    expect(heldState('2026-12-09', NOW)).toBe('v');
  });
});

describe('renewalDue : échéance proposée pour le recyclage à prévoir', () => {
  it('rien à planifier pour un titre valide sans affectation non couverte, ou non requis', () => {
    expect(renewalDue('v', '2027-06-01', [], NOW)).toBeNull();
    expect(renewalDue('v', '2027-06-01', [span('2026-11-02', '2026-11-06')], NOW)).toBeNull();
    expect(renewalDue('n', null, [span('2026-11-02', '2026-11-06')], NOW)).toBeNull();
  });
  it('échéance du titre, ou dans 30 jours pour une formation initiale', () => {
    expect(renewalDue('s', '2026-11-15', [], NOW)).toBe('2026-11-15');
    expect(renewalDue('r', null, [], NOW)).toBe('2026-11-08');
  });
  it('la veille de la première affectation non couverte, jamais avant aujourd’hui', () => {
    expect(renewalDue('v', '2026-12-31', [span('2026-12-20', '2027-01-10')], NOW)).toBe('2026-12-19');
    // Première affectation couverte, seconde non : l'échéance suit la seconde.
    expect(renewalDue('v', '2026-12-01', [span('2026-10-15', '2026-10-20'), span('2026-11-25', '2026-12-05')], NOW)).toBe('2026-11-24');
    expect(renewalDue('r', null, [span('2026-10-20', '2026-10-22')], NOW)).toBe('2026-10-19');
    expect(renewalDue('r', null, [span(NOW, '2026-10-12')], NOW)).toBe(NOW);
    expect(renewalDue('x', '2026-10-01', [], NOW)).toBe(NOW);
  });
});

describe('coversNeed : la formation règle-t-elle le besoin ?', () => {
  it('valide au-delà de 60 jours et couvrant les affectations à venir', () => {
    expect(coversNeed('2027-10-08', [], NOW)).toBe(true);
    expect(coversNeed(null, [], NOW)).toBe(true); // titre sans échéance
    expect(coversNeed('2026-11-30', [], NOW)).toBe(false); // expire sous 60 jours
    expect(coversNeed('2027-06-01', [span('2027-05-25', '2027-07-01')], NOW)).toBe(false);
    expect(coversNeed('2027-06-01', [span('2027-05-01', '2027-05-10')], NOW)).toBe(true);
  });
});
