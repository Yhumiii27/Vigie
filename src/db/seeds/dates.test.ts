import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMO_REFERENCE_DAY, rel } from './dates';

// QUA-20 : dates du jeu de démonstration relatives à la date de référence (rel), jamais écrites en dur.

describe('dates du jeu de démonstration (QUA-20)', () => {
  it('rel : écart en jours à la date de référence (vendredi 09/10/2026, VIGIE_TODAY des tests)', () => {
    expect(DEMO_REFERENCE_DAY).toBe('2026-10-09');
    expect(new Date(`${DEMO_REFERENCE_DAY}T12:00:00Z`).getUTCDay()).toBe(5);
    expect(rel(0)).toBe('2026-10-09');
    expect(rel(-9)).toBe('2026-09-30');
    expect(rel(23)).toBe('2026-11-01');
    expect(rel(-365)).toBe('2025-10-09');
  });

  it('aucune date « AAAA-MM-JJ » en dur dans le code du jeu (hors commentaires)', () => {
    const dir = path.join(process.cwd(), 'src', 'db');
    const files = ['seed.ts', ...readdirSync(path.join(dir, 'seeds')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'dates.ts').map((f) => path.join('seeds', f))];
    const hits = files.flatMap((f) => readFileSync(path.join(dir, f), 'utf8').split('\n').flatMap((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/^\s*\*/.test(line)) return [];
      // Bascules d'heure d'été 2026 (calcul du décalage horaire de paris(), src/db/seeds/actions.ts) : des repères, pas des dates du jeu.
      if (/^(export )?const paris = /.test(line)) return [];
      return /'20\d\d-\d\d-\d\d/.test(code) ? [`${f}:${i + 1}`] : [];
    }));
    expect(hits).toEqual([]);
  });
});
