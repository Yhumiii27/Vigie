import { describe, expect, it } from 'vitest';
import { PAGE_HITS_MAX, foldText, isPageSearchShortcut, matchPages, type PageSection } from './page-search';

const NAV: PageSection[] = [
  { label: 'Pilotage', items: [{ key: 'dashboard', href: '/', label: 'Tableau de bord', icon: 'ph-x' }, { key: 'todo', href: '/a-faire', label: 'À faire', icon: 'ph-x' }] },
  { label: 'Terrain', items: [{ key: 'events', href: '/evenements', label: 'Événements', icon: 'ph-x' }, { key: 'prevention', href: '/prevention', label: 'Prévention', icon: 'ph-x' }] },
  { label: 'Prévention', items: [{ key: 'risks', href: '/risques', label: 'Évaluation des risques', icon: 'ph-x' }] },
];

describe('recherche de pages ⌘K (VG-N07)', () => {
  it('sans accent ni casse ; recherche vide : rien', () => {
    expect(foldText('  Évènements  À faire ')).toBe('evenements a faire');
    expect(matchPages(NAV, '')).toEqual([]);
    expect(matchPages(NAV, '   ')).toEqual([]);
    expect(matchPages(NAV, 'evene').map((h) => h.key)).toEqual(['events']);
    expect(matchPages(NAV, 'A FAIRE').map((h) => h.href)).toEqual(['/a-faire']);
  });

  it('libellé de section compris ; libellé qui commence par la recherche en tête', () => {
    expect(matchPages(NAV, 'prev').map((h) => h.key)).toEqual(['prevention', 'risks']);
    expect(matchPages(NAV, 'risques prev').map((h) => h.key)).toEqual(['risks']);
    expect(matchPages(NAV, 'terrain')[0].section).toBe('Terrain');
  });

  it('au plus PAGE_HITS_MAX pages', () => {
    const many: PageSection[] = [{ label: 'S', items: Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, href: `/${i}`, label: `Page ${i}`, icon: 'ph-x' })) }];
    expect(matchPages(many, 'page')).toHaveLength(PAGE_HITS_MAX);
  });

  it('raccourci ⌘K ou Ctrl+K, pas Alt', () => {
    expect(isPageSearchShortcut({ key: 'k', metaKey: true, ctrlKey: false, altKey: false })).toBe(true);
    expect(isPageSearchShortcut({ key: 'K', metaKey: false, ctrlKey: true, altKey: false })).toBe(true);
    expect(isPageSearchShortcut({ key: 'k', metaKey: false, ctrlKey: false, altKey: false })).toBe(false);
    expect(isPageSearchShortcut({ key: 'k', metaKey: true, ctrlKey: false, altKey: true })).toBe(false);
  });
});
