import { describe, expect, it } from 'vitest';
import { canReadGateHouse, gatePersonResolver, gateHouseList, matchInterventions, parseHorizon, type GatePresence } from './gate-house';

// PRV-25 : liste du poste de garde d'après les présences prévues de Cursus.

const p = (ref: string, from: string, to: string, extra: Partial<GatePresence> = {}): GatePresence => ({
  ref, matricule: `E-${ref}`, siteCode: 'site_a', company: '[Entreprise Levage Ouest]', from, to, purpose: 'Maintenance', status: 'validee', ...extra,
});
const plans = [
  { id: 'PP-1', siteId: 'site_a', company: 'Entreprise levage ouest', from: '2026-10-08', to: '2026-10-12' },
  { id: 'PP-2', siteId: 'site_b', company: '[Entreprise Levage Ouest]', from: '2026-10-08', to: '2026-10-12' },
  { id: 'PP-3', siteId: 'site_a', company: '[Entreprise Levage]', from: '2026-10-08', to: '2026-10-12' },
  { id: 'PP-4', siteId: 'site_a', company: '[Entreprise Levage Ouest]', from: '2026-11-01', to: '2026-11-02' },
];

describe('rapprochement d’un plan ou d’un permis', () => {
  it('même site, même entreprise (exacte après normalisation), dates recoupées', () => {
    expect(matchInterventions(p('1', '2026-10-10', '2026-10-10'), plans)).toEqual(['PP-1']);
    expect(matchInterventions(p('2', '2026-10-10', '2026-10-10', { company: null }), plans)).toEqual([]);
    expect(matchInterventions(p('3', '2026-10-10', '2026-10-10', { siteCode: null }), plans)).toEqual([]);
  });
});

describe('gateHouseList', () => {
  const sites = new Map([['site_a', 'Site A — ateliers']]);
  const people = [{ matricule: 'E-1', siteMatricule: null, name: '[F. Rousseau]' }, { matricule: 'E-2', siteMatricule: null, name: '[B. Morel]' }];
  it('arrivées et départs de la période, triés par date ; annulées à part ; autre site et site non suivi écartés', () => {
    const list = gateHouseList({
      today: '2026-10-09', to: '2026-10-16', sites, people, plans, permits: [],
      presences: [
        p('2', '2026-10-06', '2026-10-16'),
        p('1', '2026-10-10', '2026-10-11'),
        p('3', '2026-10-20', '2026-10-22'),
        p('4', '2026-10-12', '2026-10-12', { status: 'annulee' }),
        p('5', '2026-10-12', '2026-10-12', { siteCode: 'site_b' }),
        p('6', '2026-10-12', '2026-10-12', { matricule: null }),
      ],
    });
    expect(list.arrivals.map((r) => r.ref)).toEqual(['1', '6']);
    expect(list.departures.map((r) => r.ref)).toEqual(['1', '6', '2']);
    expect(list.cancelled.map((r) => r.ref)).toEqual(['4']);
    expect(list.arrivals[0]).toMatchObject({ name: '[F. Rousseau]', plans: ['PP-1'], siteLabel: 'Site A — ateliers' });
    // Personne inconnue de Vigie : nom vide (« Personne inconnue de Vigie » à l'affichage).
    expect(list.arrivals[1]).toMatchObject({ name: null, matricule: null, siteMatricule: null });
    expect(list.cancelled[0].plans).toEqual([]);
  });
});

describe('personne d’une présence : matricule Cursus, puis matricule de site (lot 14 de Cursus)', () => {
  const resolve = gatePersonResolver([
    { matricule: 'EMP-9101', siteMatricule: 'I00101', name: '[D. Garnier]' },
    { matricule: 'EMP-9001', siteMatricule: null, name: '[T. Nguyen]' },
    { matricule: null, siteMatricule: 'E00201', name: '[F. Rousseau]' },
  ]);
  it('proposition principale : matricule EMP-…, matricule de site en fin de vue', () => {
    expect(resolve({ matricule: 'EMP-9101', siteMatricule: 'I00101' })).toEqual({ name: '[D. Garnier]', matricule: 'EMP-9101', siteMatricule: 'I00101' });
    // Vue sans matricule_site : celui de la fiche.
    expect(resolve({ matricule: 'EMP-9101' })).toEqual({ name: '[D. Garnier]', matricule: 'EMP-9101', siteMatricule: 'I00101' });
    expect(resolve({ matricule: 'EMP-9001', siteMatricule: null })).toEqual({ name: '[T. Nguyen]', matricule: 'EMP-9001', siteMatricule: null });
  });
  it('variante : la présence porte le matricule de site', () => {
    expect(resolve({ matricule: 'I00101' })).toEqual({ name: '[D. Garnier]', matricule: 'EMP-9101', siteMatricule: 'I00101' });
    expect(resolve({ matricule: 'E00201' })).toEqual({ name: '[F. Rousseau]', matricule: null, siteMatricule: 'E00201' });
  });
  it('matricule Cursus inconnu mais matricule de site connu ; personne inconnue', () => {
    expect(resolve({ matricule: 'EMP-7777', siteMatricule: 'E00201' })).toEqual({ name: '[F. Rousseau]', matricule: 'EMP-7777', siteMatricule: 'E00201' });
    expect(resolve({ matricule: 'EMP-9299', siteMatricule: 'E00299' })).toEqual({ name: null, matricule: 'EMP-9299', siteMatricule: 'E00299' });
    expect(resolve({ matricule: 'E00299' })).toEqual({ name: null, matricule: null, siteMatricule: 'E00299' });
  });
});

describe('lecteurs et horizon', () => {
  it('QHSE, direction et encadrement ; jamais le Salarié', () => {
    expect(['Animateur QHSE', 'Direction', 'Chef de service', 'Chef de projet', 'Salarié'].map((r) => canReadGateHouse(r as never))).toEqual([true, true, true, true, false]);
  });
  it('horizon parmi 1, 7, 14, 30 ; défaut 7', () => {
    expect([parseHorizon('1'), parseHorizon('14'), parseHorizon('30'), parseHorizon('3'), parseHorizon(undefined)]).toEqual([1, 14, 30, 7, 7]);
  });
});
