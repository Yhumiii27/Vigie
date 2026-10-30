import { describe, expect, it } from 'vitest';
import { REVIEW_TRACK } from '@/lib/rules/audits';
import { planItemState, planStart, relabelDay, reviewSlot } from './audits';

// Règles du programme annuel (QUA-03) : état calculé d'un élément (annulé, reporté, AUD-03), première planification d'un
// report, libellé court qui reprend la date, place d'une revue de direction au programme (AUD-01).

const item = (over: Partial<Parameters<typeof planItemState>[0]> = {}) => ({
  year: 2026, month: 10, label: 'BE · 17/10', detail: 'Processus Conception BE', plannedOn: '2026-10-17', done: false, doneOn: null, cancelledAt: null, ...over,
});

describe('planItemState : état calculé d’un élément du programme', () => {
  it('annulé avant tout', () => {
    expect(planItemState(item({ cancelledAt: new Date('2026-09-01T10:00:00Z'), done: true }), '2026-10-09')).toBe('cancelled');
  });
  it('réalisé : seulement à la date d’arrêt (dossier arrêté à une séance antérieure)', () => {
    expect(planItemState(item({ done: true, doneOn: '2026-10-05' }), '2026-10-09')).toBe('done');
    expect(planItemState(item({ done: true, doneOn: null }), '2026-10-09')).toBe('done');
    // Réalisé après la date d'arrêt : encore à venir (ou à confirmer) à cette date.
    expect(planItemState(item({ done: true, doneOn: '2026-10-20' }), '2026-10-09')).toBe('upcoming');
  });
  it('échéance passée non confirmée : à confirmer ; sans date, la fin du mois compte', () => {
    expect(planItemState(item({ plannedOn: '2026-10-01' }), '2026-10-09')).toBe('late');
    expect(planItemState(item({ plannedOn: null, month: 9 }), '2026-10-09')).toBe('late');
    expect(planItemState(item({ plannedOn: null, month: 10 }), '2026-10-09')).toBe('upcoming');
    expect(planItemState(item(), '2026-10-09')).toBe('upcoming');
  });
});

describe('planStart et relabelDay', () => {
  it('première planification : date prévue, sinon le 1er du mois', () => {
    expect(planStart({ year: 2026, month: 9, plannedOn: null })).toBe('2026-09-01');
    expect(planStart({ year: 2026, month: 9, plannedOn: '2026-09-17' })).toBe('2026-09-17');
  });
  it('le jour et le mois de l’ancienne date deviennent ceux de la nouvelle', () => {
    expect(relabelDay('Annuelle 10/12', '2026-12-10', '2027-01-14')).toBe('Annuelle 14/01');
    expect(relabelDay('[Fourn. G]', '2026-09-17', '2027-02-10')).toBe('[Fourn. G]');
    expect(relabelDay('BE · 17/10', null, '2026-11-05')).toBe('BE · 17/10');
    expect(relabelDay('BE · 17/10', '2026-10-17', null)).toBe('BE · 17/10');
  });
});

describe('reviewSlot : place d’une revue de direction au programme annuel', () => {
  let id = 0;
  const slot = (over: Partial<Parameters<typeof reviewSlot>[0][number]> = {}) => ({
    id: ++id, year: 2027, month: 3, track: REVIEW_TRACK, label: 'Interm. mars', detail: 'Revue de direction intermédiaire', done: false,
    reviewId: null, cancelledAt: null, ...over,
  });

  it('mois libre : création sur la ligne des revues', () => {
    expect(reviewSlot([], '2027-03-18')).toEqual({ create: true });
    // Éléments d'un autre mois ou d'une autre ligne : sans effet.
    expect(reviewSlot([slot({ month: 4 }), slot({ track: 'Audits internes', label: 'Achats', detail: 'Processus Achats' })], '2027-03-18')).toEqual({ create: true });
  });
  it('échéance de revue saisie au seul programme : reprise, de préférence sur la ligne des revues', () => {
    const other = slot({ track: 'Audits internes', label: 'Revue de direction', detail: null });
    const own = slot();
    expect(reviewSlot([other, own], '2027-03-18')).toEqual({ adopt: own.id });
    expect(reviewSlot([other], '2027-03-18')).toEqual({ adopt: other.id });
  });
  it('éléments annulés ignorés ; échéance réalisée ou déjà rattachée : nouvelle échéance sur la ligne des revues (AUD-21)', () => {
    expect(reviewSlot([slot({ cancelledAt: new Date() })], '2027-03-18')).toEqual({ create: true });
    // AUD-21 (paquet 13) : plusieurs éléments par ligne et par mois — le mois occupé ne laisse plus la revue hors programme.
    expect(reviewSlot([slot({ done: true, label: 'Interm. 04/03' })], '2027-03-18')).toEqual({ create: true });
    expect(reviewSlot([slot({ reviewId: 99, label: 'Annuelle 04/03' })], '2027-03-18')).toEqual({ create: true });
  });
  it('sur la ligne des revues, tout élément libre est une échéance de revue (isReviewPlanItem) : repris', () => {
    const prep = slot({ label: 'Préparation', detail: null });
    expect(reviewSlot([prep], '2027-03-18')).toEqual({ adopt: prep.id });
  });
});
