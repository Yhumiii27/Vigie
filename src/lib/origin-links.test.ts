import { describe, expect, it } from 'vitest';
import { coactivityOriginHref, formatBackfillReport, originLink, resolveOriginRef, type OriginCatalog } from './origin-links';

// Règle de résolution des références d'origine (ACT-01) : création d'une action et reprise des actions existantes.

const catalog: OriginCatalog = {
  plans: new Set(['PP-2026-012', 'PP-2026-008']),
  permits: new Set(['PF-2026-031', 'PE-2026-008']),
  documents: new Set(['PR-QHSE-002', 'IT-MON-012']),
  streams: new Set(['FD-04', 'FD-11']),
  entries: [
    { id: 7, streamId: 'FD-11', removedOn: '2026-08-19' },
    { id: 3, streamId: 'FD-11', removedOn: '2026-07-08' },
    { id: 9, streamId: 'FD-11', removedOn: '2026-07-08' },
    { id: 12, streamId: 'FD-04', removedOn: '2026-09-02' },
  ],
};
const resolve = (origin: string, ref: string) => resolveOriginRef(origin, ref, catalog);

describe('resolveOriginRef', () => {
  it('Prévention : plan ou permis de la référence, à défaut de son premier mot', () => {
    expect(resolve('prevention', 'PP-2026-012')).toEqual({ column: 'preventionPlanId', target: 'PP-2026-012' });
    expect(resolve('prevention', ' PF-2026-031 ')).toEqual({ column: 'permitId', target: 'PF-2026-031' });
    expect(resolve('prevention', 'PP-2026-008 · écart R. 4512-6')).toEqual({ column: 'preventionPlanId', target: 'PP-2026-008' });
    expect(resolve('prevention', 'PE-2026-008, banc BE-1')).toEqual({ column: 'permitId', target: 'PE-2026-008' });
    expect(resolve('prevention', 'PP-2026-099')).toEqual({ column: null, reason: 'Aucun plan de prévention ni permis de cette référence.' });
    expect(resolve('prevention', 'Coactivité 09/10/2026')).toMatchObject({ column: null, reason: expect.stringMatching(/^Coactivité sans plan/) });
    // Le plan d'un autre type d'origine n'est jamais retenu.
    expect(resolve('docs', 'PP-2026-012')).toMatchObject({ column: null });
  });

  it('Documents : document de la référence ou de son premier mot', () => {
    expect(resolve('docs', 'PR-QHSE-002')).toEqual({ column: 'documentId', target: 'PR-QHSE-002' });
    expect(resolve('docs', 'IT-MON-012 révision C')).toEqual({ column: 'documentId', target: 'IT-MON-012' });
    expect(resolve('docs', 'Procédure accueil')).toEqual({ column: null, reason: 'Aucun document maîtrisé de cette référence.' });
  });

  it('Environnement : filière, enlèvement (premier inscrit du jour, n° explicite), repli sur la filière', () => {
    expect(resolve('env', 'FD-04')).toEqual({ column: 'wasteStreamId', target: 'FD-04' });
    expect(resolve('env', 'FD-11 · 19/08/2026')).toEqual({ column: 'wasteEntryId', target: 7 });
    // Deux enlèvements le même jour : le premier inscrit, comme le registre l'affichait.
    expect(resolve('env', 'FD-11 · 08/07/2026')).toEqual({ column: 'wasteEntryId', target: 3, note: expect.stringContaining('premier inscrit (n° 3)') });
    expect(resolve('env', 'FD-11 · 08/07/2026 · n° 9')).toEqual({ column: 'wasteEntryId', target: 9 });
    // Enlèvement modifié depuis (date ou filière) : retrouvé par son numéro.
    expect(resolve('env', 'FD-11 · 01/09/2026 · n° 12')).toEqual({ column: 'wasteEntryId', target: 12, note: 'Enlèvement n° 12 modifié depuis (FD-04 · 02/09/2026).' });
    // Date sans enlèvement : la filière, que l'écran affichait.
    expect(resolve('env', 'FD-11 · 20/08/2026')).toEqual({ column: 'wasteStreamId', target: 'FD-11', note: 'Aucun enlèvement FD-11 le 20/08/2026 : rattachée à la filière FD-11.' });
    expect(resolve('env', 'FD-11 · 20/08/2026 · n° 99')).toMatchObject({ column: 'wasteStreamId', target: 'FD-11' });
    expect(resolve('env', 'FD-04 · contrôle ICPE')).toEqual({ column: 'wasteStreamId', target: 'FD-04' });
    expect(resolve('env', 'Registre des déchets 2026')).toEqual({ column: null, reason: 'Registre annuel des déchets : aucune fiche source.' });
    expect(resolve('env', 'FD-99 · 19/08/2026')).toEqual({ column: null, reason: 'Aucune filière ni enlèvement de cette référence.' });
  });

  it('origines sans fiche source : null', () => {
    for (const origin of ['ev', 'audit', 'risk', 'watch', 'client', 'rev', 'skills']) expect(resolve(origin, 'PP-2026-012')).toBeNull();
  });

  it('lien du registre', () => {
    expect(originLink('preventionPlanId', 'PP-2026-012')).toBe('preventionplan:PP-2026-012');
    expect(originLink('wasteEntryId', 7)).toBe('wasteentry:7');
  });
});

describe('formatBackfillReport', () => {
  it('essai : liens à poser, références sans fiche source', () => {
    const lines = formatBackfillReport({
      applied: false, examined: 4, alreadyLinked: 1,
      linked: [{ actionId: 'A-206', column: 'preventionPlanId', target: 'PP-2026-012', label: 'plan de prévention PP-2026-012' }],
      unresolved: [{ actionId: 'A-178', origin: 'env', originRef: 'Registre des déchets 2026', reason: 'Registre annuel des déchets : aucune fiche source.' }],
    });
    expect(lines).toEqual([
      'Reprise des liens d’origine des actions (ACT-01) : essai, aucune écriture (--appliquer pour enregistrer).',
      '  4 actions Prévention, Documents ou Environnement examinées, 1 déjà rattachée (inchangées).',
      '  À rattacher (1) :',
      '    A-206 → plan de prévention PP-2026-012',
      '  Sans fiche source, référence conservée telle quelle (1) :',
      '    A-178 « Registre des déchets 2026 » : Registre annuel des déchets : aucune fiche source.',
    ]);
  });
  it('appliquée sans lien restant', () => {
    expect(formatBackfillReport({ applied: true, examined: 1, alreadyLinked: 1, linked: [], unresolved: [] })).toEqual([
      'Reprise des liens d’origine des actions (ACT-01) : liens enregistrés.',
      '  1 action Prévention, Documents ou Environnement examinée, 1 déjà rattachée (inchangées).',
      '  Aucun lien posé.',
    ]);
  });
});

describe('coactivityOriginHref (ACT-12)', () => {
  it('« Coactivité JJ/MM/AAAA » : carte du site de l’action à cette date', () => {
    expect(coactivityOriginHref('Coactivité 09/10/2026', 'ville-a')).toBe('/prevention/carte?site=ville-a&date=2026-10-09');
    expect(coactivityOriginHref(' Coactivité 28/09/2026 · voie de livraison', 'ville-b')).toBe('/prevention/carte?site=ville-b&date=2026-09-28');
    expect(coactivityOriginHref('Coactivité 09/10/2026', null)).toBe('/prevention/carte?date=2026-10-09');
  });
  it('autre référence ou date inexistante : aucun lien', () => {
    expect(coactivityOriginHref('Coactivité 31/02/2026', 'ville-a')).toBeNull();
    expect(coactivityOriginHref('Coactivité', 'ville-a')).toBeNull();
    expect(coactivityOriginHref('PP-2026-012', 'ville-a')).toBeNull();
    expect(coactivityOriginHref('Coactivité 2026-10-09', 'ville-a')).toBeNull();
  });
});
