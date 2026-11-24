import { describe, expect, it } from 'vitest';
import { navClosedOf, navCookie } from './nav-state';

describe('sections repliées de la barre latérale (cookie vigie-nav)', () => {
  it('aller-retour du cookie, valeurs vides ignorées', () => {
    const header = navCookie(['Système', 'Terrain']);
    expect(header).toMatch(/^vigie-nav=[^;]+; Path=\/; Max-Age=\d+; SameSite=Lax$/);
    expect(navClosedOf(header.split(';')[0].split('=')[1])).toEqual(['Système', 'Terrain']);
    expect(navClosedOf(undefined)).toEqual([]);
    expect(navClosedOf('')).toEqual([]);
    expect(navClosedOf('%7C%7C')).toEqual([]);
  });
});
