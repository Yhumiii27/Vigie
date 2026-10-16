import { describe, expect, it } from 'vitest';
import {
  addDays, addMonths, daysBetween, fmtDate, fmtDay, fmtDayMonth, fmtLong, fmtMonthAbbr, fmtParisDateTime, isoWeek, isoWeekKey, isoWeekday, lastWednesday,
  monthName, monthOf, parisDay, yearOf,
} from './dates';

describe('addMonths (borné au mois d’arrivée, QUA-07)', () => {
  it('reste dans le mois d’arrivée en fin de mois', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });
  it('conserve le jour quand il existe et change d’année', () => {
    expect(addMonths('2026-10-09', 12)).toBe('2027-10-09');
    expect(addMonths('2026-10-15', -12)).toBe('2025-10-15');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  });
});

describe('jours et mises en forme (QUA-03)', () => {
  it('daysBetween et addDays : jours calendaires, changements d’heure sans effet', () => {
    expect(daysBetween('2026-10-09', '2026-10-12')).toBe(3);
    expect(daysBetween('2026-10-12', '2026-10-09')).toBe(-3);
    // Passage à l'heure d'hiver le 25/10/2026, à l'heure d'été le 29/03/2026.
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });
  it('formats français', () => {
    expect(fmtDayMonth('2026-10-03')).toBe('03/10');
    expect(fmtDate('2026-10-03')).toBe('03/10/2026');
    expect(fmtLong('2026-10-06')).toBe('6 octobre 2026');
    expect(fmtDay('2026-10-09')).toBe('09');
    expect(fmtMonthAbbr('2026-02-01')).toBe('fév');
    expect(monthName(8)).toBe('août');
    expect([monthOf('2026-10-09'), yearOf('2026-10-09')]).toEqual([10, 2026]);
  });
  it('isoWeek : numéro de semaine ISO 8601, y compris en début et fin d’année', () => {
    expect(isoWeek('2026-10-09')).toBe(41);
    expect(isoWeek('2026-01-01')).toBe(1); // jeudi : semaine 1 de 2026
    expect(isoWeek('2025-12-29')).toBe(1); // lundi de la semaine 1 de 2026
    expect(isoWeek('2026-12-31')).toBe(53); // 2026 compte 53 semaines
    expect(isoWeek('2027-01-03')).toBe(53);
    expect(isoWeek('2027-01-04')).toBe(1);
    expect(isoWeek('2021-01-03')).toBe(53); // dimanche, semaine 53 de 2020
  });
});

describe('semaines ISO et mercredi du rappel (ACT-32)', () => {
  it('isoWeekday : 1 = lundi … 7 = dimanche', () => {
    expect(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'].map(isoWeekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(isoWeekday('2026-10-09')).toBe(5);
  });
  it('isoWeekKey : semaine et année ISO (fin et début d’année)', () => {
    expect(isoWeekKey('2025-01-01')).toBe('2025-W01');
    expect(isoWeekKey('2025-12-31')).toBe('2026-W01');
    expect(isoWeekKey('2026-10-14')).toBe('2026-W42');
    expect(isoWeekKey('2026-12-31')).toBe('2026-W53');
    expect(isoWeekKey('2027-01-03')).toBe('2026-W53');
    expect(isoWeekKey('2027-01-04')).toBe('2027-W01');
    expect(isoWeekKey('2021-01-03')).toBe('2020-W53');
    expect(isoWeekKey('2026-10-05')).toBe('2026-W41');
  });
  it('lastWednesday : mercredi le plus récent, le jour même compris', () => {
    expect(lastWednesday('2026-10-09')).toBe('2026-10-07');
    expect(lastWednesday('2026-10-14')).toBe('2026-10-14');
    expect(lastWednesday('2026-10-20')).toBe('2026-10-14');
    expect(lastWednesday('2026-10-13')).toBe('2026-10-07');
    expect(lastWednesday('2027-01-01')).toBe('2026-12-30');
  });
});

describe('jour et heure de Paris d’un instant', () => {
  it('parisDay : la date de Paris, pas celle d’UTC', () => {
    expect(parisDay(new Date('2026-10-03T23:30:00Z'))).toBe('2026-10-04'); // heure d'été : UTC+2
    expect(parisDay(new Date('2026-10-03T21:59:59Z'))).toBe('2026-10-03');
    expect(parisDay(new Date('2026-12-31T23:00:00Z'))).toBe('2027-01-01'); // heure d'hiver : UTC+1
    expect(parisDay(new Date('2026-12-31T22:59:00Z'))).toBe('2026-12-31');
  });
  it('parisDay : jours de changement d’heure', () => {
    // 29/03/2026 : 02:00 → 03:00 (UTC+1 → UTC+2) ; 25/10/2026 : 03:00 → 02:00 (UTC+2 → UTC+1).
    expect(parisDay(new Date('2026-03-28T23:30:00Z'))).toBe('2026-03-29');
    expect(parisDay(new Date('2026-03-29T21:59:00Z'))).toBe('2026-03-29');
    expect(parisDay(new Date('2026-03-29T22:00:00Z'))).toBe('2026-03-30');
    expect(parisDay(new Date('2026-10-24T22:00:00Z'))).toBe('2026-10-25');
    expect(parisDay(new Date('2026-10-25T22:59:00Z'))).toBe('2026-10-25');
    expect(parisDay(new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
  });
  it('fmtParisDateTime : « JJ/MM/AAAA à HH:mm », heure de Paris', () => {
    expect(fmtParisDateTime(new Date('2026-10-14T07:12:00Z'))).toBe('14/10/2026 à 09:12');
    expect(fmtParisDateTime(new Date('2026-12-14T08:05:00Z'))).toBe('14/12/2026 à 09:05');
    expect(fmtParisDateTime(new Date('2026-10-03T23:30:00Z'))).toBe('04/10/2026 à 01:30');
    expect(fmtParisDateTime(new Date('2026-10-25T00:30:00Z'))).toBe('25/10/2026 à 02:30');
    expect(fmtParisDateTime(new Date('2026-10-25T01:30:00Z'))).toBe('25/10/2026 à 02:30'); // heure répétée au passage à l'heure d'hiver
  });
});
