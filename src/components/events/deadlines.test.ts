import { describe, expect, it } from 'vitest';
import { cpamBasis, cpamDeadline, easterSunday, ettDeadline, fmtDeadline, frenchHolidays, isExcludedDay, reservesDeadline } from './deadlines';

// Délais d'un accident du travail (EVT-03) : 48 h hors dimanches et jours fériés pour la déclaration CPAM (R. 441-3 CSS),
// 10 jours francs pour les réserves motivées (R. 441-6), fériés d'Alsace-Moselle en option.

describe('jours fériés', () => {
  it('Pâques (algorithme grégorien)', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(easterSunday(2024)).toBe('2024-03-31');
  });
  it('fériés nationaux 2026, et Alsace-Moselle', () => {
    expect([...frenchHolidays(2026)].sort()).toEqual([
      '2026-01-01', '2026-04-06', '2026-05-01', '2026-05-08', '2026-05-14', '2026-05-25',
      '2026-07-14', '2026-08-15', '2026-11-01', '2026-11-11', '2026-12-25',
    ]);
    const am = frenchHolidays(2026, true);
    expect(am.has('2026-04-03')).toBe(true);
    expect(am.has('2026-12-26')).toBe(true);
    expect(am.size).toBe(13);
    expect(frenchHolidays(2026).has('2026-04-03')).toBe(false);
  });
  it('jours non décomptés : dimanche et férié, pas le samedi', () => {
    expect(isExcludedDay('2026-10-11')).toBe(true); // dimanche
    expect(isExcludedDay('2026-10-10')).toBe(false); // samedi
    expect(isExcludedDay('2026-07-14')).toBe(true);
    expect(isExcludedDay('2026-12-26')).toBe(false);
    expect(isExcludedDay('2026-12-26', true)).toBe(true);
  });
});

describe('déclaration CPAM : 48 h hors dimanches et jours fériés', () => {
  it('en semaine', () => {
    expect(cpamDeadline('2026-10-13T10:00')).toEqual({ date: '2026-10-15', minutes: 600 }); // mardi → jeudi
  });
  it('le week-end : samedi décompté, dimanche non', () => {
    expect(cpamDeadline('2026-10-09T15:00')).toEqual({ date: '2026-10-12', minutes: 900 }); // vendredi → lundi 15 h
    expect(cpamDeadline('2026-10-10T10:00')).toEqual({ date: '2026-10-13', minutes: 600 }); // samedi → mardi 10 h
    expect(cpamDeadline('2026-10-11T09:00')).toEqual({ date: '2026-10-13', minutes: 1440 }); // dimanche → fin du mardi
  });
  it('jours fériés', () => {
    expect(cpamDeadline('2026-07-13T09:00')).toEqual({ date: '2026-07-16', minutes: 540 }); // 14 juillet non décompté
    expect(cpamDeadline('2026-04-02T10:00')).toEqual({ date: '2026-04-04', minutes: 600 });
    expect(cpamDeadline('2026-04-02T10:00', { alsaceMoselle: true })).toEqual({ date: '2026-04-07', minutes: 600 }); // Vendredi saint, Pâques
  });
  it('point de départ : bascule depuis le registre, puis connaissance, puis enregistrement (heure de Paris)', () => {
    const createdAt = new Date('2026-10-09T07:00:00Z');
    expect(cpamBasis({ knownAt: null, createdAt })).toBe('2026-10-09T09:00');
    expect(cpamBasis({ knownAt: new Date('2026-10-08T14:30:00Z'), createdAt })).toBe('2026-10-08T16:30');
    expect(cpamBasis({ knownAt: new Date('2026-10-08T14:30:00Z'), createdAt }, new Date('2026-10-12T08:00:00Z'))).toBe('2026-10-12T10:00');
  });
  it('affichage', () => {
    expect(fmtDeadline({ date: '2026-10-12', minutes: 900 })).toBe('avant le 12/10/2026 à 15 h 00');
    expect(fmtDeadline({ date: '2026-10-13', minutes: 545 })).toBe('avant le 13/10/2026 à 09 h 05');
    expect(fmtDeadline({ date: '2026-10-13', minutes: 1440 })).toBe('avant la fin du 13/10/2026');
  });
});

describe('réserves motivées : 10 jours francs', () => {
  it('jour ouvrable', () => {
    expect(reservesDeadline('2026-09-09')).toBe('2026-09-21'); // + 10 = samedi 19 → lundi 21
    expect(reservesDeadline('2026-09-08')).toBe('2026-09-18'); // vendredi
  });
  it('samedi, dimanche ou férié : reporté au jour ouvrable suivant', () => {
    expect(reservesDeadline('2026-09-10')).toBe('2026-09-21'); // dimanche 20 → lundi 21
    expect(reservesDeadline('2026-11-01')).toBe('2026-11-12'); // mercredi 11 novembre → jeudi 12
    expect(reservesDeadline('2026-12-16')).toBe('2026-12-28'); // samedi 26 → lundi 28
    expect(reservesDeadline('2026-12-15', { alsaceMoselle: true })).toBe('2026-12-28'); // 25 et 26 fériés, 27 dimanche
  });
});

describe("AT d'un intérimaire : information de l'ETT sous 24 h (R. 412-2)", () => {
  it("d'heure à heure, dimanches et jours fériés compris", () => {
    expect(ettDeadline('2026-10-13T10:00')).toEqual({ date: '2026-10-14', minutes: 600 }); // mardi → mercredi 10 h
    expect(ettDeadline('2026-10-10T15:30')).toEqual({ date: '2026-10-11', minutes: 930 }); // samedi → dimanche 15 h 30
    expect(ettDeadline('2026-07-13T09:00')).toEqual({ date: '2026-07-14', minutes: 540 }); // 14 juillet compté
    expect(ettDeadline('2026-10-13T00:00')).toEqual({ date: '2026-10-13', minutes: 1440 }); // minuit → fin du jour
    expect(fmtDeadline(ettDeadline('2026-10-13T10:00'))).toBe('avant le 14/10/2026 à 10 h 00');
  });
});
