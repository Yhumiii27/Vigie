import { describe, expect, it } from 'vitest';
import { canApprove, canSignReview } from './domain';
import { decisionFollowUpGap, reviewCloseBlockers } from './review-rules';

// Contrôles avant le visa de la revue de direction (AUD-14) et visa réservé à la direction (AUD-15).

describe('reviewCloseBlockers (AUD-14)', () => {
  const held = { status: 'tenue', participantIds: ['hmarchand'], minutes: 'Synthèse' };
  it('revue tenue, compte rendu complet, décisions pilotées : aucun blocage', () => {
    expect(reviewCloseBlockers(held, [{ text: 'Décision', pilotId: 'lmoreau' }])).toEqual([]);
    expect(reviewCloseBlockers(held, [])).toEqual([]);
  });
  it('compte rendu non saisi : seul motif', () => {
    expect(reviewCloseBlockers({ ...held, status: 'planifiee' }, [{ text: 'x', pilotId: null }])).toEqual(['Saisissez le compte rendu avant de clôturer la revue.']);
  });
  it('participants, synthèse et pilotes manquants', () => {
    expect(reviewCloseBlockers({ status: 'tenue', participantIds: [], minutes: '  ' }, [
      { text: 'Former les monteurs à l’élingage', pilotId: null }, { text: 'B'.repeat(80), pilotId: null }, { text: 'Pilotée', pilotId: 'p' },
    ])).toEqual([
      "Indiquez au compte rendu les participants de l'entreprise.",
      'Rédigez la synthèse de la séance au compte rendu.',
      `Désignez le pilote de 2 décisions (« Former les monteurs à l’élingage », « ${'B'.repeat(59)}… »).`,
    ]);
    expect(reviewCloseBlockers({ ...held, participantIds: null }, [])).toEqual(["Indiquez au compte rendu les participants de l'entreprise."]);
  });
});

describe('canSignReview (AUD-15)', () => {
  it('la direction seulement, quand l’animateur QHSE valide aussi', () => {
    expect(canSignReview('Direction')).toBe(true);
    expect(canSignReview('Animateur QHSE')).toBe(false);
    expect(canApprove('Animateur QHSE')).toBe(true);
    expect(canSignReview('Chef de service')).toBe(false);
  });
});

describe('decisionFollowUpGap (AUD-16)', () => {
  it('sans action, abandonnée, ouverte ; Vérifiée ou Terminée : suite donnée', () => {
    expect(decisionFollowUpGap(null, false)).toBe('none');
    expect(decisionFollowUpGap(null, true)).toBe('none');
    expect(decisionFollowUpGap('abandonnee', true)).toBe('abandoned');
    expect(decisionFollowUpGap('a_faire', true)).toBe('open');
    expect(decisionFollowUpGap('reportee', true)).toBe('open');
    expect(decisionFollowUpGap('terminee', true)).toBeNull();
    expect(decisionFollowUpGap('verifiee', true)).toBeNull();
  });
});
