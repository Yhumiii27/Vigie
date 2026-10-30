import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE, pageParams, paginate, parsePage, parsePageSize } from './pagination';

const list = Array.from({ length: 23 }, (_, i) => `EV-${i + 1}`);

describe('pagination (QUA-21)', () => {
  it('lit ?page= et ?taille= : entier positif, taille parmi les choix, sinon défaut', () => {
    expect(parsePage(undefined)).toBeNull();
    expect(parsePage('2')).toBe(2);
    expect(parsePage(['3', '4'])).toBe(3);
    for (const bad of ['0', '-1', '1.5', 'abc', '', ' ', '9999999']) expect(parsePage(bad)).toBeNull();
    expect(parsePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize('10')).toBe(10);
    expect(parsePageSize('100')).toBe(100);
    expect(parsePageSize('7')).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize('100000')).toBe(DEFAULT_PAGE_SIZE);
  });

  it('découpe la liste, borne la page demandée', () => {
    expect(paginate(list, { page: 1, size: 10 })).toMatchObject({ page: 1, pages: 3, total: 23, from: 1, to: 10 });
    expect(paginate(list, { page: 3, size: 10 }).items).toEqual(['EV-21', 'EV-22', 'EV-23']);
    expect(paginate(list, { page: 9, size: 10 })).toMatchObject({ page: 3, from: 21, to: 23 });
    expect(paginate([], { page: 2, size: 10 })).toMatchObject({ page: 1, pages: 1, total: 0, from: 0, to: 0, items: [] });
  });

  it('sans ?page= : page de la fiche demandée par lien profond, sinon la première ; ?page= explicite prévaut', () => {
    const selected = (id: string) => id === 'EV-15';
    expect(paginate(list, { page: null, size: 10, selected }).page).toBe(2);
    expect(paginate(list, { page: null, size: 10, selected: () => false }).page).toBe(1);
    expect(paginate(list, { page: 3, size: 10, selected }).page).toBe(3);
  });

  it('paramètres d’URL : valeurs par défaut omises', () => {
    expect(pageParams(1, DEFAULT_PAGE_SIZE)).toEqual({ page: undefined, taille: undefined });
    expect(pageParams(2, 10)).toEqual({ page: '2', taille: '10' });
  });
});
