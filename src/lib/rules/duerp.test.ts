import { describe, expect, it } from 'vitest';
import { duerpReviewDone, duerpReviewReason, frozenVersionError } from './duerp';

const ev = (over: Partial<Parameters<typeof duerpReviewReason>[0]> = {}) => ({
  type: 'PA', severity: 1, injury: null, lostDays: null, occurredOn: '2026-10-01', dismissed: false, ...over,
});

describe('duerpReviewReason (DUE-07)', () => {
  const now = '2026-10-09';
  it('gravité potentielle élevée (G3, G4), tout type sauf MP', () => {
    expect(duerpReviewReason(ev({ severity: 3 }), now)).toBe('gravite');
    expect(duerpReviewReason(ev({ severity: 4, type: 'NC' }), now)).toBe('gravite');
    expect(duerpReviewReason(ev({ severity: 4, type: 'MP' }), now)).toBeNull();
    expect(duerpReviewReason(ev({ severity: 2 }), now)).toBeNull();
  });
  it('accident du travail avec arrêt', () => {
    expect(duerpReviewReason(ev({ type: 'AT', injury: 'arret' }), now)).toBe('arret');
    expect(duerpReviewReason(ev({ type: 'AT', injury: 'soins', lostDays: 2 }), now)).toBe('arret');
    expect(duerpReviewReason(ev({ type: 'AT', injury: 'sans_arret' }), now)).toBeNull();
  });
  it('classé sans suite, futur ou hors de la fenêtre de 12 mois : rien', () => {
    expect(duerpReviewReason(ev({ severity: 4, dismissed: true }), now)).toBeNull();
    expect(duerpReviewReason(ev({ severity: 4, occurredOn: '2025-10-09' }), now)).toBeNull();
    expect(duerpReviewReason(ev({ severity: 4, occurredOn: '2025-10-10' }), now)).toBe('gravite');
  });
});

describe('duerpReviewDone (DUE-07)', () => {
  it('version validée ou risque recoté le jour de l’événement ou après', () => {
    expect(duerpReviewDone('2026-10-01', ['2026-01-15', null], null)).toBe(false);
    expect(duerpReviewDone('2026-10-01', ['2026-10-01'], null)).toBe(true);
    expect(duerpReviewDone('2026-10-01', [], '2026-10-05')).toBe(true);
    expect(duerpReviewDone('2026-10-01', [], '2026-09-30')).toBe(false);
  });
});

describe('frozenVersionError (DUE-10)', () => {
  const v = { cseConsultedOn: '2026-02-01', validatedById: 'a', comment: 'Objet' };
  it('version non validée : modifiable', () => {
    expect(frozenVersionError({ ...v, cseConsultedOn: null }, { ...v, comment: 'Autre' })).toBeNull();
  });
  it('version validée : validateur, consultation et objet figés', () => {
    expect(frozenVersionError(v, v)).toBeNull();
    expect(frozenVersionError(v, { ...v, comment: 'Autre' })).toMatch(/figé/);
    expect(frozenVersionError(v, { ...v, cseConsultedOn: null })).toMatch(/figé/);
    expect(frozenVersionError(v, { ...v, validatedById: 'b' })).toMatch(/figé/);
  });
});
