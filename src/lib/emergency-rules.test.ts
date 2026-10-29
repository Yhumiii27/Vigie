import { describe, expect, it } from 'vitest';
import { drillDue } from './emergency-rules';

describe('CNF-08 : échéance des exercices d’une situation d’urgence', () => {
  const s = { drillMonths: 12, nextDrillOn: null, createdOn: '2026-01-15' };
  it('sans exercice : premier exercice attendu dans la périodicité suivant l’identification', () => {
    expect(drillDue(s, null)).toEqual({ dueOn: '2027-01-15', planned: false, plannedLate: false, first: true });
  });
  it('dernier exercice tenu + périodicité', () => {
    expect(drillDue({ ...s, drillMonths: 6 }, '2026-08-31')).toEqual({ dueOn: '2027-02-28', planned: false, plannedLate: false, first: false });
  });
  it('exercice planifié plus tôt : échéance au jour planifié ; planifié trop tard : signalé, échéance inchangée', () => {
    expect(drillDue({ ...s, nextDrillOn: '2026-11-05' }, '2026-03-01')).toEqual({ dueOn: '2026-11-05', planned: true, plannedLate: false, first: false });
    expect(drillDue({ ...s, nextDrillOn: '2027-06-01' }, '2026-03-01')).toEqual({ dueOn: '2027-03-01', planned: false, plannedLate: true, first: false });
  });
});
