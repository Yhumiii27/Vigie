import { describe, expect, it } from 'vitest';
import { PERMIT_FILTERS, REGISTER_FILTERS, inPeriod, pickFilter, pickPeriod } from './filters';

// Registre imprimable des permis (PRV-03) : période par année ou par mois, filtre « Tous, annulés compris ».

describe('pickPeriod : période du registre (?annee=, ?mois=)', () => {
  it('mois d’une année : du premier au dernier jour, libellé en toutes lettres', () => {
    expect(pickPeriod('2026', '10')).toEqual({ from: '2026-10-01', to: '2026-10-31', label: 'octobre 2026', annee: '2026', mois: '10' });
    expect(pickPeriod('2026', '01')).toMatchObject({ from: '2026-01-01', to: '2026-01-31', label: 'janvier 2026', mois: '1' });
    expect(pickPeriod('2028', '2')).toMatchObject({ from: '2028-02-01', to: '2028-02-29' }); // année bissextile
    expect(pickPeriod('2027', '2')?.to).toBe('2027-02-28');
  });
  it('année entière', () => {
    expect(pickPeriod('2026')).toEqual({ from: '2026-01-01', to: '2026-12-31', label: 'année 2026', annee: '2026' });
    expect(pickPeriod('2026', '')).toMatchObject({ label: 'année 2026' });
  });
  it('mois invalide ignoré (année entière) ; mois sans année valide : aucune période', () => {
    expect(pickPeriod('2026', '13')).toEqual({ from: '2026-01-01', to: '2026-12-31', label: 'année 2026', annee: '2026' });
    expect(pickPeriod('2026', '0')).toMatchObject({ label: 'année 2026' });
    expect(pickPeriod('2026', 'oct')).toMatchObject({ label: 'année 2026' });
    expect(pickPeriod(undefined, '10')).toBeNull();
    expect(pickPeriod('26', '10')).toBeNull();
    expect(pickPeriod('2026x')).toBeNull();
    expect(pickPeriod()).toBeNull();
  });
});

describe('inPeriod : validité recoupant la période (jours de Paris)', () => {
  const october = pickPeriod('2026', '10')!;
  it('permis à cheval sur deux mois : compté dans les deux', () => {
    const night = { validFrom: '2026-09-30T22:00', validTo: '2026-10-01T06:00' };
    expect(inPeriod(night, october)).toBe(true);
    expect(inPeriod(night, pickPeriod('2026', '9')!)).toBe(true);
  });
  it('permis terminé le 30/09 ou commencé en novembre : hors octobre', () => {
    expect(inPeriod({ validFrom: '2026-09-30T08:00', validTo: '2026-09-30T23:59' }, october)).toBe(false);
    expect(inPeriod({ validFrom: '2026-11-01T00:00', validTo: '2026-11-01T08:00' }, october)).toBe(false);
    expect(inPeriod({ validFrom: '2026-10-31T23:00', validTo: '2026-11-01T02:00' }, october)).toBe(true);
  });
});

describe('REGISTER_FILTERS : filtres de l’onglet Permis et « Tous, annulés compris »', () => {
  it('le registre ajoute les annulés, l’écran reste inchangé', () => {
    const all = REGISTER_FILTERS.find((f) => f.key === 'registre')!;
    expect(all.states).toContain('annule');
    expect(all.states).toHaveLength(6);
    expect(REGISTER_FILTERS.slice(0, PERMIT_FILTERS.length)).toEqual(PERMIT_FILTERS);
    expect(PERMIT_FILTERS.some((f) => f.key === 'registre')).toBe(false);
    expect(pickFilter(REGISTER_FILTERS, 'registre')).toBe(all);
    expect(pickFilter(REGISTER_FILTERS, undefined).key).toBe('ouverts');
  });
});
