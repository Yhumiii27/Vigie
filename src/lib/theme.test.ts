import { describe, expect, it } from 'vitest';
import { LEGACY_THEME_COOKIE, THEME_COOKIE, THEME_COOKIES_READ, themeCookie, themeFromCookies, themeOf } from './theme';

// Thème d'affichage (Norma 1.0 ; nom du cookie de Norma 3.0, suite Atrium) : cookie atrium-theme → attribut data-theme de
// <html>, sombre par défaut ; l'ancien nom (d'avant Norma 3.0) est lu à défaut du nouveau, jamais écrit.
describe('thème sombre / clair', () => {
  it('nom du cookie commun à la suite, ancien nom lu en second', () => {
    expect(THEME_COOKIE).toBe('atrium-theme');
    expect(THEME_COOKIES_READ).toEqual([THEME_COOKIE, LEGACY_THEME_COOKIE]);
    expect(LEGACY_THEME_COOKIE).not.toBe(THEME_COOKIE);
  });
  it('cookie → thème : clair seulement sur « light », sombre sinon', () => {
    expect(themeOf('light')).toBe('light');
    expect(themeOf('dark')).toBe('dark');
    expect(themeOf(undefined)).toBe('dark');
    expect(themeOf(null)).toBe('dark');
    expect(themeOf('')).toBe('dark');
    expect(themeOf('LIGHT')).toBe('dark');
    expect(themeOf('sepia')).toBe('dark');
  });
  it('lecture : le nouveau nom d’abord, l’ancien à défaut, sombre sinon', () => {
    const jar = (c: Record<string, string>) => (n: string) => c[n];
    expect(themeFromCookies(jar({ [THEME_COOKIE]: 'light' }))).toBe('light');
    expect(themeFromCookies(jar({ [LEGACY_THEME_COOKIE]: 'light' }))).toBe('light');
    expect(themeFromCookies(jar({ [THEME_COOKIE]: 'dark', [LEGACY_THEME_COOKIE]: 'light' }))).toBe('dark');
    expect(themeFromCookies(jar({}))).toBe('dark');
  });
  it('cookie posé par le navigateur : un an, tout le site, toujours le nouveau nom', () => {
    expect(themeCookie('light')).toBe('atrium-theme=light; path=/; max-age=31536000; samesite=lax');
    expect(themeCookie('dark')).toMatch(/^atrium-theme=dark; path=\/; max-age=31536000/);
  });
});
