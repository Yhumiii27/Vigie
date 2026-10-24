import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AA_LARGE, AA_TEXT, blend, contrastRatio, relativeLuminance } from './contrast';

// UX-09 : mesures de contraste des couleurs de texte de l'interface (thème sombre de Nocturne). Les valeurs sont lues dans
// les feuilles de style, pour que la mesure suive toute modification des jetons.
const css = (file: string) => readFileSync(path.join(process.cwd(), 'src/app', file), 'utf8');
const nocturne = css('nocturne.css');
const vigie = css('vigie.css');
const token = (sheet: string, name: string) => {
  const m = new RegExp(`${name.replace(/[-]/g, '\\-')}:\\s*([^;]+);`).exec(sheet);
  if (!m) throw new Error(`Jeton absent : ${name}`);
  return m[1].trim();
};

const bg = token(nocturne, '--color-bg'); // #161826, fond de page
const surface = token(nocturne, '--color-surface'); // #232532, cartes et fenêtres
const text = token(nocturne, '--color-text');
const accent = token(nocturne, '--color-accent');
const n400 = token(nocturne, '--color-neutral-400');
const n500 = token(nocturne, '--color-neutral-500');
const n600 = token(nocturne, '--color-neutral-600');
const muted = token(vigie, '--vg-text-muted');
const accentText = token(vigie, '--vg-accent-text');

describe('calcul WCAG', () => {
  it('luminance et rapports de référence', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBe(1);
    expect(contrastRatio('#000', '#fff')).toBe(21);
    expect(contrastRatio('#777777', '#ffffff')).toBe(4.48);
    expect(contrastRatio('#ffffff', '#777777')).toBe(4.48);
    expect(() => contrastRatio('rouge', '#fff')).toThrow(/invalide/);
  });
  it('OKLCH et mélange', () => {
    expect(contrastRatio('oklch(1 0 0)', '#000000')).toBe(21);
    expect(contrastRatio('oklch(0 0 0)', '#ffffff')).toBe(21);
    expect(blend('#ffffff', '#000000', 0.5)).toBe('#808080');
  });
});

describe('contrastes de l’interface (AA)', () => {
  it('ancien texte tertiaire neutral-600 insuffisant sur une surface (constat UX-09)', () => {
    expect(contrastRatio(n600, surface)).toBe(3.52);
    expect(contrastRatio(n600, bg)).toBe(4.08);
  });

  it.each([
    ['--vg-text-muted / fond', () => contrastRatio(muted, bg), 5.64],
    ['--vg-text-muted / surface', () => contrastRatio(muted, surface), 4.87],
    ['neutral-500 / surface', () => contrastRatio(n500, surface), 5.25],
    ['neutral-400 / surface', () => contrastRatio(n400, surface), 7.55],
    ['texte / surface', () => contrastRatio(text, surface), 12.55],
    ['accent / surface', () => contrastRatio(accent, surface), 4.71],
    ['--vg-accent-text / entrée active (fond + 10 % d’accent)', () => contrastRatio(accentText, blend(accent, bg, 0.1)), 5.66],
    ['--vg-accent-text / puce active dans une carte', () => contrastRatio(accentText, blend(accent, surface, 0.1)), 4.82],
    ['compteur des puces (texte à 60 %) / fond', () => contrastRatio(blend(text, bg, 0.6), bg), 5.92],
  ])('%s', (_label, measure, expected) => {
    const ratio = measure();
    expect(ratio).toBe(expected);
    expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each([
    ['danger', '--tone-danger-fg', '--tone-danger-bg', 7.94],
    ['vigilance', '--tone-warn-fg', '--tone-warn-bg', 8.2],
    ['conforme', '--tone-ok-fg', '--tone-ok-bg', 8.88],
  ])('étiquette de ton %s', (_label, fg, back, expected) => {
    expect(contrastRatio(token(vigie, fg), token(vigie, back))).toBe(expected);
  });

  it('erreur de champ (danger-fg) et pastilles (dot) sur une surface', () => {
    expect(contrastRatio(token(vigie, '--tone-danger-fg'), surface)).toBeGreaterThanOrEqual(AA_TEXT);
    // Pastilles, icônes et bordures de saisie : éléments graphiques (3:1).
    expect(contrastRatio(token(vigie, '--tone-danger-dot'), surface)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(contrastRatio(n600, surface)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it('impression (fond blanc) : texte secondaire du dossier et des fiches en #444', () => {
    expect(contrastRatio('#444444', '#ffffff')).toBe(9.74);
  });
});

describe('feuilles de style de Vigie', () => {
  const sources = [vigie, css('revue-de-direction/dossier.css'), css('(app)/prevention/imprimer/print.css')];
  it('aucun texte en neutral-600 ni en neutral-700 dans vigie.css (couleur de texte)', () => {
    const lines = vigie.split('\n').filter((l) => /(^|[;{\s])color:\s*var\(--color-neutral-(600|700)\)/.test(l));
    expect(lines).toEqual([]);
  });
  it('aucune police sous 11 px', () => {
    const small = sources.flatMap((s) => s.split('\n')).filter((l) => /font-size:\s*(?:[0-9]|10)(?:\.\d+)?px/.test(l));
    expect(small).toEqual([]);
  });
});
