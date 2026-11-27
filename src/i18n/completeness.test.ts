import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAV, SCREENS, type ScreenKey } from '@/lib/domain';
import { NAV_SECTION_EN, SCREEN_LABEL_EN, SCREEN_TITLE_EN } from './nav';
import { TACHES_FR } from '@norma/charte/ds/taches-fr';
import { FR, SAME_IN_FRENCH, conflictingEntries, normaOverrides } from './fr';
import { fill, frExact, langCookie, langOf, makeT } from './translate';

// VG-N01 : toute chaîne passée à t() dans un fichier qui traduit (useI18n / getI18n) a son entrée française, différente de
// l'anglais (sauf relue dans SAME_IN_FRENCH) ; la navigation traduite redonne exactement les libellés de src/lib/domain.ts.

const ROOT = process.cwd();
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? files(p) : /\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : [];
});
// Composants de la coque commune (norma/charte/ds) compris : leurs chaînes passent par le dictionnaire de Vigie.
const translating = [...files(path.join(ROOT, 'src')), ...files(path.join(ROOT, 'norma/charte/ds'))].filter((f) => /\b(useI18n|getI18n)\(/.test(readFileSync(f, 'utf8')));
const LITERAL = /\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*\)/g;
const literals = translating.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(LITERAL)].map((m) => ({ file: path.relative(ROOT, f), text: m[2].replace(/\\(['"])/g, '$1') })));

describe('traduction de l’interface (VG-N01)', () => {
  it('chaque t("…") des fichiers traduits a son entrée française', () => {
    expect(translating.length).toBeGreaterThan(3);
    expect(literals.length).toBeGreaterThan(20);
    const missing = literals.filter((l) => frExact(l.text) == null).map((l) => `${l.file} : ${l.text}`);
    expect(missing).toEqual([]);
  });

  it('une entrée qui recopie l’anglais est relue (SAME_IN_FRENCH)', () => {
    const same = Object.entries(FR).filter(([en, fr]) => en === fr && !SAME_IN_FRENCH.includes(en)).map(([en]) => en);
    expect(same).toEqual([]);
  });

  it('une chaîne définie dans deux dictionnaires y a la même traduction', () => {
    expect(conflictingEntries()).toEqual([]);
  });

  it('les composants communs de Norma se lisent comme dans les autres outils (TACHES_FR)', () => {
    expect(normaOverrides()).toEqual([]);
    for (const [en, fr] of Object.entries(TACHES_FR)) expect(frExact(en), en).toBe(fr);
    const t = makeT('fr');
    expect([t('Open'), t('Open#plural'), t('All'), t('All#mplural'), t('Source'), t('Source#origin')]).toEqual(['Ouvrir', 'Ouverts', 'Toutes', 'Tous', 'Outil', 'Source']);
  });

  it('les titres de page traduits en français redonnent SCREENS.title', () => {
    const t = makeT('fr');
    for (const [k, en] of Object.entries(SCREEN_TITLE_EN)) expect(t(en!), k).toBe(SCREENS[k as ScreenKey].title);
  });

  it('la navigation traduite en français redonne les libellés de domain.ts', () => {
    const t = makeT('fr');
    for (const sec of NAV) {
      expect(NAV_SECTION_EN[sec.label], sec.label).toBeDefined();
      expect(t(NAV_SECTION_EN[sec.label])).toBe(sec.label);
      for (const k of sec.items) {
        const en = SCREEN_LABEL_EN[k as ScreenKey];
        expect(en, k).toBeDefined();
        expect(t(en!), k).toBe(SCREENS[k].label);
      }
    }
  });

  it('français par défaut ; anglais = chaîne source ; cookie vigie-lang ; paramètres', () => {
    expect(langOf(undefined)).toBe('fr');
    expect(langOf('de')).toBe('fr');
    expect(langOf('en')).toBe('en');
    expect(langCookie('en')).toMatch(/^vigie-lang=en; Path=\/; Max-Age=\d+; SameSite=Lax$/);
    expect(makeT('en')('Sign out')).toBe('Sign out');
    expect(makeT('fr')('Sign out')).toBe('Se déconnecter');
    expect(makeT('fr')('Texte inconnu')).toBe('Texte inconnu');
    expect(makeT('en')('Closed#plural')).toBe('Closed');
    expect(makeT('fr')('Closed#plural')).toBe('Clos');
    expect(fill(makeT('fr')('{n} pages found'), { n: 3 })).toBe('3 pages trouvées');
  });
});
