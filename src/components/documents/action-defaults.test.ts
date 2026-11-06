import { describe, expect, it } from 'vitest';
import { admissibleSources } from '@/lib/action-rules';
import { documentActionDefaults } from './action-defaults';

// Valeurs proposées par l'écran Documents au formulaire d'action (plan du paquet 1, flux E2) : source « Revue
// documentaire » imposée et admise pour l'élément lié (D20), domaine Qualité, version en cours ou document.

const kindOf = (link: string | undefined) => link?.split(':')[0] ?? null;
const doc = {
  id: 'PRO-QUA-0003', title: 'Gestion des déchets', ownerId: 'clefevre', siteId: 'site_a', actionTitle: 'Revue périodique de PRO-QUA-0003 — gestion des déchets',
  dueSoon: false, overdue: true, nextReviewOn: '2026-09-30', pending: null,
};

describe('action de revue documentaire', () => {
  it('revue dépassée sans révision en cours : document lié, source imposée, domaine Qualité, site du document', () => {
    const d = documentActionDefaults(doc, { review: true, suggestedDueOn: '2026-11-08' });
    expect(d).toMatchObject({
      source: 'revue_documentaire', lockSource: true, link: 'document:PRO-QUA-0003', linkLabel: 'Document · PRO-QUA-0003', originRef: 'PRO-QUA-0003',
      domain: 'qualite', pilotId: 'clefevre', siteId: 'site_a', dueOn: '2026-11-08', verifyDueOn: '2026-12-08',
      detail: 'Revue périodique de PRO-QUA-0003 — gestion des déchets',
      problem: 'Revue périodique de PRO-QUA-0003 « Gestion des déchets » dépassée (prévue le 30/09/2026).',
    });
    expect(admissibleSources(kindOf(d.link), {})).toContain(d.source);
  });

  it('révision ouverte dans Codex sans action : la révision est liée ; revue proche : date cible = prochaine revue', () => {
    const d = documentActionDefaults({ ...doc, overdue: false, dueSoon: true, nextReviewOn: '2026-10-20', pending: { letter: 'C', action: null } },
      { review: true, suggestedDueOn: '2026-11-08' });
    expect(d).toMatchObject({ link: 'docversion:PRO-QUA-0003:C', linkLabel: 'PRO-QUA-0003 · révision C', dueOn: '2026-10-20', verifyDueOn: '2026-11-19' });
    expect(admissibleSources(kindOf(d.link), {})).toContain(d.source);
  });

  it('propriétaire sans fiche dans Vigie : pilote à choisir', () => {
    expect(documentActionDefaults({ ...doc, ownerId: null }, { review: true, suggestedDueOn: '2026-11-08' }).pilotId).toBeUndefined();
  });

  it('action libre, révision déjà rattachée, document commun : document lié, détail à saisir, site au choix', () => {
    const d = documentActionDefaults({ ...doc, siteId: null, pending: { letter: 'C', action: { id: 'A-1' } } }, { review: false, suggestedDueOn: '2026-11-08' });
    expect(d).toMatchObject({ link: 'document:PRO-QUA-0003', detail: undefined, siteId: undefined, problem: 'PRO-QUA-0003 « Gestion des déchets »' });
  });
});
