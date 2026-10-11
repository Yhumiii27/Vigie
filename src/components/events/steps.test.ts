import { describe, expect, it } from 'vitest';
import { addActionBlocker, advanceBlocker, analysisFilled, eventLockReason, needsCpam, normalizeTree, readD8 } from './shared';

// Parcours d'un événement (règles de src/components/events/shared.ts, QUA-03) : passage d'étape, ajout d'action, verrou.

const ctx = { pilotId: 'sbenali' as string | null, hasAnalysis: true, dismissed: false, methodLabel: 'Arbre des causes' };
const done = { status: 'done' }, open = { status: 'doing' }, cancelled = { status: 'cancelled' };

describe('advanceBlocker : passage à l’étape suivante', () => {
  it('« Qualifié » exige un pilote', () => {
    expect(advanceBlocker(0, [], { ...ctx, pilotId: null })).toBe("Désignez un pilote (Modifier) avant le passage à l'étape « Qualifié ».");
    expect(advanceBlocker(0, [], ctx)).toBeNull();
  });
  it('« Actions » exige l’analyse des causes puis une action liée (annulées non comptées)', () => {
    expect(advanceBlocker(2, [done], { ...ctx, hasAnalysis: false })).toBe("Saisissez l'analyse des causes (méthode « Arbre des causes ») avant le passage à l'étape « Actions ».");
    expect(advanceBlocker(2, [cancelled], ctx)).toBe("Liez au moins une action avant le passage à l'étape « Actions ».");
    expect(advanceBlocker(2, [open], ctx)).toBeNull();
  });
  it('« Efficacité vérifiée » et clôture : toutes les actions liées clôturées', () => {
    expect(advanceBlocker(3, [done, open, open, cancelled], ctx)).toBe(
      "2 actions liées restent à clôturer après vérification d'efficacité avant le passage à l'étape « Efficacité vérifiée ».",
    );
    expect(advanceBlocker(4, [done, { status: 'verify' }], ctx)).toBe(
      "1 action liée reste à clôturer après vérification d'efficacité avant le passage à l'étape « Clôturé ».",
    );
    expect(advanceBlocker(4, [cancelled], ctx)).toBe("Aucune action liée : l'efficacité ne peut pas être vérifiée.");
    expect(advanceBlocker(4, [done, cancelled], ctx)).toBeNull();
  });
  it('classé sans suite ou déjà clôturé', () => {
    expect(advanceBlocker(1, [], { ...ctx, dismissed: true })).toBe('Événement classé sans suite.');
    expect(advanceBlocker(5, [done], ctx)).toBe('Événement déjà clôturé.');
  });
});

describe('ajout d’action et verrou de la fiche', () => {
  it('plus d’action à partir de « Efficacité vérifiée », ni sur un classé sans suite', () => {
    expect(addActionBlocker(3)).toBeNull();
    expect(addActionBlocker(4)).toMatch(/^Événement à l'étape « Efficacité vérifiée » : ramenez-le à l'étape « Actions »/);
    expect(addActionBlocker(1, true)).toBe('Événement classé sans suite : aucune action ne peut lui être ajoutée.');
  });
  it('fiche en lecture seule : classée sans suite ou clôturée', () => {
    expect(eventLockReason({ step: 3, dismissedAt: null })).toBeNull();
    expect(eventLockReason({ step: 5, dismissedAt: null })).toMatch(/^Événement clôturé/);
    expect(eventLockReason({ step: 2, dismissedAt: '2026-10-01T00:00:00Z' })).toMatch(/^Événement classé sans suite/);
  });
  it('déclaration CPAM : accident du travail, hors soins sans arrêt', () => {
    expect(needsCpam({ type: 'AT', injury: 'arret' })).toBe(true);
    expect(needsCpam({ type: 'AT', injury: null })).toBe(true);
    expect(needsCpam({ type: 'AT', injury: 'soins' })).toBe(false);
    expect(needsCpam({ type: 'PA', injury: 'arret' })).toBe(false);
  });
});

describe('analyse des causes', () => {
  it('arbre des causes : un niveau au plus sous la ligne précédente, fait ultime au niveau 0', () => {
    expect(normalizeTree([{ level: 2 }, { level: 3 }, { level: 1 }, { level: 9 }]).map((l) => l.level)).toEqual([0, 1, 1, 2]);
  });
  it('analyse saisie selon la méthode', () => {
    expect(analysisFilled('5m', [['Matière', 'Élingue usée']])).toBe(true);
    expect(analysisFilled('5m', [])).toBe(false);
    expect(analysisFilled('tree', [[0, 'Charge basculée', true]])).toBe(true);
    expect(analysisFilled('why', ['Pourquoi ?'])).toBe(true);
    expect(analysisFilled('8d', { current: 0, notes: ['', ''] })).toBe(false);
    expect(analysisFilled('8d', { current: 2 })).toBe(true);
    expect(analysisFilled('why', null)).toBe(false);
    expect(readD8({ current: 12, notes: ['a', 3] })).toEqual({ current: 8, notes: ['a', ''] });
  });
});
