import { describe, expect, it } from 'vitest';
import { declaredRecently, featuredApplicability, mostOverdue, ncBars, ncOriginOf, ncTopNote } from './dashboard-rules';

const today = '2026-10-09';
/** Horodatage à midi, heure de Paris (été). */
const at = (day: string, time = '12:00') => new Date(`${day}T${time}:00+02:00`);

describe('KPI du tableau de bord (TDB-13)', () => {
  it('« déclarés sur les 7 derniers jours » : date de déclaration (jour de Paris), aujourd’hui et les 6 jours précédents', () => {
    const events = [
      { createdAt: at('2026-10-09') }, // aujourd'hui
      { createdAt: at('2026-10-03') }, // 6 jours avant : compté
      { createdAt: at('2026-10-02') }, // 7 jours avant : hors fenêtre
      { createdAt: new Date('2026-10-02T22:30:00Z') }, // 3 octobre 0 h 30 à Paris : compté
    ];
    expect(declaredRecently(events, today)).toBe(3);
  });

  it('note des contrôles : le plus en retard, pas le premier', () => {
    const list = [{ id: 1, s: { days: -3 } }, { id: 2, s: { days: 10 } }, { id: 3, s: { days: -40 } }, { id: 4, s: { days: -40 } }];
    expect(mostOverdue(list)?.id).toBe(3);
    expect(mostOverdue([{ id: 1, s: { days: 0 } }])).toBeNull();
  });

  it('barres des NC : sans origine comptée, NC d’origine client distincte des réclamations client', () => {
    const open = [
      { type: 'NC', ncOrigin: 'Fabrication' }, { type: 'NC', ncOrigin: 'Fabrication' },
      { type: 'NC', ncOrigin: 'Réclamation client' }, { type: 'RC', ncOrigin: 'Réclamation client' }, { type: 'RC', ncOrigin: null },
      { type: 'NC', ncOrigin: null }, { type: 'NC', ncOrigin: 'Ancienne origine' },
    ];
    const bars = ncBars(open);
    expect(bars.map((b) => [b.label, b.n])).toEqual([
      ['Fournisseurs', 0], ['Fabrication', 2], ['Conception BE', 0], ['Mise en service', 0],
      ['NC · origine client', 1], ['Réclamations client', 2], ['Origine non renseignée', 2],
    ]);
    expect(bars.find((b) => b.key === 'aucune')?.href).toBe('/evenements?type=NC&origine=aucune');
    expect(bars.find((b) => b.key === 'nc-client')?.href).toBe('/evenements?type=NC&origine=R%C3%A9clamation%20client');
    expect(bars.find((b) => b.key === 'rc')?.href).toBe('/evenements?type=RC');
    expect(ncTopNote(bars)).toBe('Fabrication 2 · Réclamations client 2');
    // Barres facultatives absentes quand elles ne comptent rien ; note « — » sans NC.
    expect(ncBars([]).map((b) => b.label)).toEqual(['Fournisseurs', 'Fabrication', 'Conception BE', 'Mise en service', 'Réclamations client']);
    expect(ncTopNote(ncBars([]))).toBe('—');
    expect(ncOriginOf({ ncOrigin: 'Ancienne origine' })).toBeNull();
  });
});

describe('carte « Veille réglementaire » (TDB-14)', () => {
  it('avant la date d’application : « Applicable au », jours restants, pas d’état', () => {
    expect(featuredApplicability('2027-01-20', today, 'analyse')).toEqual({ applied: false, daysLeft: 103, prefix: 'Applicable au', state: null });
  });
  it('à partir de la date : « Applicable depuis le » et état de conformité évalué', () => {
    expect(featuredApplicability('2026-10-09', today, 'conforme')).toMatchObject({ applied: true, prefix: 'Applicable depuis le', state: { label: 'Conforme', tone: 'ok' } });
    expect(featuredApplicability('2026-09-01', today, 'ecart')).toMatchObject({ applied: true, state: { label: 'Écart', tone: 'danger' } });
  });
});
