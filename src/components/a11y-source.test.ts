import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Garde-fous d'accessibilité sur le code source des écrans (paquet 9) : icônes décoratives masquées aux lecteurs d'écran
// (UX-10), pas de texte sous 11 px ni de texte tertiaire au contraste insuffisant (UX-09). Mesures des couleurs :
// src/lib/contrast.test.ts.

const ROOT = path.join(process.cwd(), 'src');
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
});
const sources = files(ROOT).map((f) => ({ file: path.relative(process.cwd(), f), text: readFileSync(f, 'utf8') }));

/** Balise ouvrante complète (accolades JSX comprises) à partir de `<`. */
function openingTag(s: string, at: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let j = at + 1; j < s.length; j++) {
    const c = s[j];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { if (depth > 0 || c === '"') quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return s.slice(at, j + 1);
  }
  return s.slice(at);
}
const lineOf = (s: string, at: number) => s.slice(0, at).split('\n').length;

describe('icônes (UX-10)', () => {
  it('toute icône Phosphor <i className="ph …"> est décorative (aria-hidden) : le nom vient du texte ou d’aria-label', () => {
    const missing: string[] = [];
    for (const { file, text } of sources) {
      for (let at = text.indexOf('<i '); at !== -1; at = text.indexOf('<i ', at + 3)) {
        const tag = openingTag(text, at);
        if (/className/.test(tag) && !/aria-hidden/.test(tag)) missing.push(`${file}:${lineOf(text, at)}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('texte lisible (UX-09)', () => {
  const ICON_LINE = /<i |<Icon|Icon name|Dot |certDot|box ===|vg-dot/;
  it('aucune police sous 11 px pour du texte (icônes exceptées)', () => {
    const small = sources.flatMap(({ file, text }) => text.split('\n').flatMap((l, i) =>
      /fontSize: (?:[0-9]|10)(?:\.\d+)?\b(?!\s*\*)/.test(l) && !ICON_LINE.test(l) ? [`${file}:${i + 1}`] : []));
    expect(small).toEqual([]);
  });
  it('aucun texte en neutral-600 ou neutral-700 (contraste insuffisant) : jeton --vg-text-muted', () => {
    const low = sources.flatMap(({ file, text }) => text.split('\n').flatMap((l, i) =>
      /\bcolor: [^;]*'var\(--color-neutral-(?:600|700)\)'/.test(l) && !/background|border|boxShadow/.test(l) && !ICON_LINE.test(l) ? [`${file}:${i + 1}`] : []));
    expect(low).toEqual([]);
  });
});
