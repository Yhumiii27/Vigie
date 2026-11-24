import { describe, expect, it } from 'vitest';
import { THEME_COOKIE, themeCookie, themeOf } from './theme';

// Thème d'affichage (Norma 1.0) : cookie epc2i-theme → attribut data-theme de <html>, sombre par défaut.
describe('thème sombre / clair', () => {
  it('nom du cookie commun à la suite', () => {
    expect(THEME_COOKIE).toBe('epc2i-theme');
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
  it('cookie posé par le navigateur : un an, tout le site', () => {
    expect(themeCookie('light')).toBe('epc2i-theme=light; path=/; max-age=31536000; samesite=lax');
    expect(themeCookie('dark')).toMatch(/^epc2i-theme=dark; path=\/; max-age=31536000/);
  });
});
