import { describe, expect, it } from 'vitest';
import { admissibleSources } from '@/lib/action-rules';
import { documentActionDefaults } from './action-defaults';

// Valeurs proposées par l'écran Documents au formulaire d'action (plan du paquet 1, flux E2) : source « Revue
// documentaire » imposée et admise pour l'élément lié (D20), domaine Qualité, version en cours ou document.

const kindOf = (link: string | undefined) => link?.split(':')[0] ?? null;
const doc = {
  id: 'PR-QHSE-003', title: 'Gestion des déchets', ownerId: 'clefevre', siteId: 'ville-a', actionTitle: 'Revue périodique de PR-QHSE-003 — gestion des déchets',
  dueSoon: false, overdue: true, nextReviewOn: '2026-09-30', pending: null,
};

describe('action de revue documentaire', () => {
  it('revue dépassée sans révision en cours : document lié, source imposée, domaine Qualité, site du document', () => {
    const d = documentActionDefaults(doc, { review: true, suggestedDueOn: '2026-11-08' });
    expect(d).toMatchObject({
      source: 'revue_documentaire', lockSource: true, link: 'document:PR-QHSE-003', linkLabel: 'Document · PR-QHSE-003', originRef: 'PR-QHSE-003',
      domain: 'qualite', pilotId: 'clefevre', siteId: 'ville-a', dueOn: '2026-11-08', verifyDueOn: '2026-12-08',
      detail: 'Revue périodique de PR-QHSE-003 — gestion des déchets',
      problem: 'Revue périodique de PR-QHSE-003 « Gestion des déchets » dépassée (prévue le 30/09/2026).',
    });
    expect(admissibleSources(kindOf(d.link), {})).toContain(d.source);
  });

  it('révision en cours sans action : la version est liée ; revue proche : date cible = prochaine revue', () => {
    const d = documentActionDefaults({ ...doc, overdue: false, dueSoon: true, nextReviewOn: '2026-10-20', pending: { id: 41, version: 'C', action: null } },
      { review: true, suggestedDueOn: '2026-11-08' });
    expect(d).toMatchObject({ link: 'docversion:41', linkLabel: 'PR-QHSE-003 · version C', dueOn: '2026-10-20', verifyDueOn: '2026-11-19' });
    expect(admissibleSources(kindOf(d.link), {})).toContain(d.source);
  });

  it('action libre, révision déjà rattachée, document commun : document lié, détail à saisir, site au choix', () => {
    const d = documentActionDefaults({ ...doc, siteId: null, pending: { id: 41, version: 'C', action: { id: 'A-1' } } }, { review: false, suggestedDueOn: '2026-11-08' });
    expect(d).toMatchObject({ link: 'document:PR-QHSE-003', detail: undefined, siteId: undefined, problem: 'PR-QHSE-003 « Gestion des déchets »' });
  });
});
