import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// QUA-14 : les règles métier vivent dans src/lib (règles pures : src/lib/rules/*), jamais dans src/components. Le serveur
// (server actions, chargements, base, scripts) n'importe rien de src/components, et les règles pures n'importent ni React
// ni un composant : elles restent utilisables des deux côtés et testées à côté.

const ROOT = process.cwd();
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? files(p) : /\.(ts|tsx|mts|mjs)$/.test(e.name) ? [p] : [];
});
const IMPORT = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
/** Chemin absolu (sans extension) visé par un import, ou null pour un paquet. */
function target(file: string, spec: string): string | null {
  if (spec.startsWith('@/')) return path.join(ROOT, 'src', spec.slice(2));
  if (spec.startsWith('.')) return path.resolve(path.dirname(file), spec);
  return null;
}
function importsOf(file: string): { spec: string; abs: string | null }[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(IMPORT)].map((m) => ({ spec: m[1], abs: target(file, m[1]) }));
}
const COMPONENTS = path.join(ROOT, 'src', 'components') + path.sep;

describe('couches (QUA-14)', () => {
  it('src/server, src/lib, src/db et scripts n’importent rien de src/components', () => {
    const offenders = ['src/server', 'src/lib', 'src/db', 'scripts']
      .flatMap((d) => files(path.join(ROOT, d)))
      .flatMap((f) => importsOf(f)
        .filter((i) => i.abs && (i.abs + path.sep).startsWith(COMPONENTS))
        .map((i) => `${path.relative(ROOT, f)} → ${i.spec}`));
    expect(offenders).toEqual([]);
  });

  it('les règles pures de src/lib/rules n’importent ni React, ni Next, ni la base, ni le serveur', () => {
    const offenders = files(path.join(ROOT, 'src', 'lib', 'rules'))
      .filter((f) => !f.endsWith('.test.ts'))
      .flatMap((f) => importsOf(f)
        .filter((i) => /^(react|next|server-only|drizzle-orm)(\/|$)/.test(i.spec) || /^@\/(db|server)\//.test(i.spec) || /^@\/lib\/data\//.test(i.spec))
        .map((i) => `${path.relative(ROOT, f)} → ${i.spec}`));
    expect(offenders).toEqual([]);
  });
});
