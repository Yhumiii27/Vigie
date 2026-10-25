import { describe, expect, it } from 'vitest';
import { canApprove, canSignReview } from './domain';
import { decisionDueError, decisionFollowUpGap, duplicateLabel, plannedReviewTwin, reviewCloseBlockers, reviewItemDueError } from './review-rules';

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

describe('contrôles de dates et de doublons (AUD-31)', () => {
  const today = '2026-10-09';
  it('remise d’un élément : au plus tard le jour de la séance, jamais passée ; revue dépassée', () => {
    expect(reviewItemDueError(null, '2026-12-10', today)).toBeNull();
    expect(reviewItemDueError('2026-11-20', '2026-12-10', today)).toBeNull();
    expect(reviewItemDueError('2026-12-10', '2026-12-10', today)).toBeNull();
    expect(reviewItemDueError('2026-12-11', '2026-12-10', today)).toBe('Remise attendue au plus tard le jour de la séance (10/12/2026).');
    expect(reviewItemDueError('2026-10-08', '2026-12-10', today)).toBe('Date de remise déjà passée.');
    expect(reviewItemDueError('2026-10-01', '2026-10-05', today)).toMatch(/^Revue du 05\/10\/2026 dépassée/);
  });
  it('échéance d’une décision : pas avant la revue, jamais passée', () => {
    expect(decisionDueError(null, '2026-06-18', today)).toBeNull();
    expect(decisionDueError('2026-12-31', '2026-06-18', today)).toBeNull();
    expect(decisionDueError('2026-06-01', '2026-06-18', today)).toBe('Échéance antérieure à la revue du 18/06/2026.');
    expect(decisionDueError('2026-09-30', '2026-06-18', today)).toBe('Échéance déjà passée.');
  });
  it('libellé en double : casse, accents et espaces indifférents ; l’élément modifié exclu', () => {
    const others = [{ id: 1, label: 'Performance des fournisseurs' }, { id: 2, label: 'Satisfaction  client' }];
    expect(duplicateLabel('performance des Fournisseurs ', others)).toBe(true);
    expect(duplicateLabel('Satisfaction client', others)).toBe(true);
    expect(duplicateLabel('Performance des fournisseurs', others, 1)).toBe(false);
    expect(duplicateLabel('Résultats des audits', others)).toBe(false);
    expect(duplicateLabel('Résultats des audits', [{ id: 3, label: 'Resultats des AUDITS' }])).toBe(true);
  });
  it('revue du même type déjà planifiée la même année', () => {
    const reviews = [
      { id: 1, reviewOn: '2026-12-10', kind: 'ordinaire', status: 'planifiee' },
      { id: 2, reviewOn: '2026-06-18', kind: 'intermediaire', status: 'cloturee' },
      { id: 3, reviewOn: '2025-12-11', kind: 'ordinaire', status: 'planifiee' },
    ];
    expect(plannedReviewTwin(reviews, { reviewOn: '2026-03-18', kind: 'ordinaire' })?.id).toBe(1);
    expect(plannedReviewTwin(reviews, { reviewOn: '2027-03-18', kind: 'ordinaire' })).toBeNull();
    expect(plannedReviewTwin(reviews, { reviewOn: '2026-09-18', kind: 'intermediaire' })).toBeNull();
    expect(plannedReviewTwin(reviews, { id: 1, reviewOn: '2026-11-10', kind: 'ordinaire' })).toBeNull();
  });
  it('décision abandonnée : plus de pilote exigé au visa (AUD-36)', () => {
    const held = { status: 'tenue', participantIds: ['hmarchand'], minutes: 'Synthèse' };
    expect(reviewCloseBlockers(held, [{ text: 'Abandonnée', pilotId: null, cancelledAt: new Date() }])).toEqual([]);
  });
});
