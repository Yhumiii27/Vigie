import { describe, expect, it } from 'vitest';
import { addDays, addMonths, daysBetween, fmtDate, fmtDay, fmtDayMonth, fmtLong, fmtMonthAbbr, isoWeek, monthName, monthOf, yearOf } from './dates';

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
