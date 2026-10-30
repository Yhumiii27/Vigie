import { describe, expect, it } from 'vitest';
import { parseEventFilters } from './event-filters';
import {
  DETAIL_PARAMS, canonicalHref, firstParam, hrefWith, legacySkillFilters, missingDetail, parseSkillFilters, searchWith,
  parseSkillTitle, skillFiltersParams, wantsArchives,
} from './url-state';

describe('convention d’URL (UX-12)', () => {
  it('hrefWith : valeurs vides retirées, patch prioritaire', () => {
    expect(hrefWith('/veille', { onglet: 'controles', statut: 'depasses' }, { statut: undefined })).toBe('/veille?onglet=controles');
    expect(hrefWith('/veille', {}, {})).toBe('/veille');
    expect(hrefWith('/evenements', { etat: 'tous' }, { sel: 'EV-2026-131' })).toBe('/evenements?etat=tous&sel=EV-2026-131');
  });

  it('firstParam, wantsArchives, missingDetail', () => {
    expect(firstParam(['a', 'b'])).toBe('a');
    expect(firstParam(undefined)).toBeUndefined();
    expect(wantsArchives({ etat: 'archives' })).toBe(true);
    expect(wantsArchives({ etat: ['archives', 'x'] })).toBe(true);
    expect(wantsArchives({ archives: '1' })).toBe(false);
    expect(missingDetail('12', false)).toBe(true);
    expect(missingDetail('12', true)).toBe(false);
    expect(missingDetail(undefined, false)).toBe(false);
    expect(missingDetail('', false)).toBe(false);
  });

  it('veille : anciens paramètres réécrits en ?etat=archives, les autres conservés', () => {
    expect(canonicalHref('/veille', { archives: '1' })).toBe('/veille?etat=archives');
    expect(canonicalHref('/veille', { archives: '1', exigence: '4' })).toBe('/veille?exigence=4&etat=archives');
    expect(canonicalHref('/veille', { onglet: 'controles', statut: 'archives' })).toBe('/veille?onglet=controles&etat=archives');
    expect(canonicalHref('/veille', { onglet: 'controles', statut: 'archives', controle: '7' })).toBe('/veille?onglet=controles&controle=7&etat=archives');
    // ?archives= sans valeur 1 : retiré, liste en vigueur.
    expect(canonicalHref('/veille', { archives: '0' })).toBe('/veille');
    // Déjà canonique : rien à réécrire.
    expect(canonicalHref('/veille', { onglet: 'controles', statut: 'depasses' })).toBeNull();
    expect(canonicalHref('/veille', { etat: 'archives' })).toBeNull();
    expect(canonicalHref('/veille', {})).toBeNull();
  });

  it('DUERP : ?archives=1 → ?etat=archives', () => {
    expect(canonicalHref('/risques', { archives: '1', unite: 'essais' })).toBe('/risques?unite=essais&etat=archives');
    expect(canonicalHref('/risques', { etat: 'archives' })).toBeNull();
    expect(canonicalHref('/risques', { risque: '3' })).toBeNull();
  });

  it('prévention : entreprises archivées ?filtre=archivees → ?etat=archives, filtres de phase inchangés', () => {
    expect(canonicalHref('/prevention', { onglet: 'entreprises', filtre: 'archivees' })).toBe('/prevention?onglet=entreprises&etat=archives');
    expect(canonicalHref('/prevention', { onglet: 'permis', filtre: 'annules' })).toBeNull();
    expect(canonicalHref('/prevention', { filtre: 'en-cours' })).toBeNull();
  });

  it('écrans sans ancien paramètre : jamais réécrits (liens des échéances, notifications, EVT-13, DOC-08)', () => {
    expect(canonicalHref('/evenements', { etat: 'tous', type: 'AT', effectif: '1', blessure: 'arret', du: '2025-10-10' })).toBeNull();
    expect(canonicalHref('/environnement', { enlevement: '12' })).toBeNull();
    expect(canonicalHref('/environnement', { onglet: 'filieres', filiere: '3' })).toBeNull();
    expect(canonicalHref('/actions', { etat: 'annulees', vue: 'pilote' })).toBeNull();
    expect(canonicalHref('/documents', { doc: 'PR-QHSE-003' })).toBeNull();
  });

  it('filtres EVT-13 inchangés par la convention (étape, période, effectif)', () => {
    expect(parseEventFilters({ etape: '2', du: '2026-01-01', effectif: '1' }, { health: true })).toMatchObject({ etape: 2, du: '2026-01-01', effectif: true });
  });

  it('paramètres de fiche : un par type d’élément, exceptions sel et doc conservées', () => {
    expect(DETAIL_PARAMS['/evenements'].evenement).toBe('sel');
    expect(DETAIL_PARAMS['/documents'].document).toBe('doc');
    const all = Object.values(DETAIL_PARAMS).flatMap((m) => Object.values(m));
    expect(all.every((p) => /^[a-z]+$/.test(p))).toBe(true);
  });

  it('searchWith : patch d’une recherche existante', () => {
    expect(searchWith('?vue=a-prevoir&q=x', { q: undefined, etat: 'sortis' })).toBe('?vue=a-prevoir&etat=sortis');
    expect(searchWith('', { doc: 'PR-1' })).toBe('?doc=PR-1');
    expect(searchWith('?doc=PR-1', { doc: undefined })).toBe('');
  });
});

describe('filtres de la matrice des habilitations', () => {
  it('lecture : valeurs connues, sinon défaut ; longueur bornée', () => {
    expect(parseSkillFilters({ etat: 'a-traiter', service: 'Montage', q: ' dur ' })).toEqual({ etat: 'a-traiter', service: 'Montage', q: 'dur' });
    expect(parseSkillFilters({ etat: 'inconnu' })).toEqual({ etat: 'tous', service: '', q: '' });
    expect(parseSkillFilters(new URLSearchParams('etat=sortis&q=a'))).toEqual({ etat: 'sortis', service: '', q: 'a' });
    expect(parseSkillFilters({ q: 'x'.repeat(300) }).q).toHaveLength(100);
  });
  it('écriture : valeurs par défaut omises', () => {
    expect(skillFiltersParams({ etat: 'tous', service: '', q: '' })).toEqual({ etat: undefined, service: undefined, q: undefined });
    expect(skillFiltersParams({ etat: 'sortis', service: 'Usinage', q: 'm' })).toEqual({ etat: 'sortis', service: 'Usinage', q: 'm' });
  });
  it('ancien filtre mémorisé dans le navigateur repris une fois', () => {
    expect(legacySkillFilters(JSON.stringify({ chip: 'a_traiter', service: 'Montage' }))).toEqual({ etat: 'a-traiter', service: 'Montage' });
    expect(legacySkillFilters(JSON.stringify({ chip: 'sortis', service: '' }))).toEqual({ etat: 'sortis', service: '' });
    expect(legacySkillFilters(JSON.stringify({ chip: 'tous', service: '' }))).toBeNull();
    expect(legacySkillFilters('{pas du json')).toBeNull();
    expect(legacySkillFilters(null)).toBeNull();
  });

  it('parseSkillTitle : filtre par titre suivi (HAB-16), titre en vigueur de la liste seulement', () => {
    expect(parseSkillTitle({ habilitation: 'caces-r489' }, ['caces-r489', 'sst'])).toBe('caces-r489');
    expect(parseSkillTitle(new URLSearchParams('habilitation=sst'), ['caces-r489', 'sst'])).toBe('sst');
    expect(parseSkillTitle({ habilitation: 'archive' }, ['sst'])).toBe('');
    expect(parseSkillTitle({ titre: 'sst' }, ['sst'])).toBe('');
  });
});
