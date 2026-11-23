import { describe, expect, it } from 'vitest';
import { SEARCH_LIMIT, normalizeSearch, parseSearchQuery, rankSearch, searchScore } from './search';

describe('recherche globale (TDB-18)', () => {
  it('normalisation : casse, accents et espaces ignorés', () => {
    expect(normalizeSearch('  Échafaudage   Mobile ')).toBe('echafaudage mobile');
  });

  it('requête de l’URL : 2 caractères au moins, 100 au plus', () => {
    expect(parseSearchQuery(' a ')).toBeNull();
    expect(parseSearchQuery(undefined)).toBeNull();
    expect(parseSearchQuery(['EV', 'x'])).toBe('EV');
    expect(parseSearchQuery('x'.repeat(150))).toHaveLength(100);
  });

  it('classement : référence exacte, début de référence, intitulé, texte secondaire ; tous les mots exigés', () => {
    const exact = searchScore('ev-2026-119', { ref: 'EV-2026-119', title: 'Chute' })!;
    const prefix = searchScore('ev-2026', { ref: 'EV-2026-119', title: 'Chute' })!;
    const title = searchScore('chute', { ref: 'EV-2026-119', title: 'Chute de plain-pied' })!;
    const extra = searchScore('magasin', { ref: 'PP-1', title: 'Soudage', extra: 'Magasin · mezzanine' })!;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(title);
    expect(title).toBeGreaterThan(extra);
    expect(searchScore('chute hauteur', { ref: 'EV-1', title: 'Chute de plain-pied' })).toBeNull();
    expect(searchScore('chute hauteur', { ref: 'EV-1', title: 'Chute de hauteur' })).not.toBeNull();
  });

  it('limite par module et total', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ ref: `AC-26${String(i).padStart(4, '0')}`, title: 'Garde-corps', href: `/actions?action=${i}` }));
    const r = rankSearch([{ ref: 'AC-1', title: 'Autre', href: '/x' }, ...items], 'garde');
    expect(r.total).toBe(30);
    expect(r.items).toHaveLength(SEARCH_LIMIT);
    expect(r.items[0].ref).toBe('AC-260000');
  });
});
