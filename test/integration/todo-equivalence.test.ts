import '../next-mocks';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadCounters } from '@/lib/data/counters';
import { loadTodo, loadVisibleTodo } from '@/lib/data/todo';
import { ROLE_KEYS } from '@/lib/domain';
import { actAs, freezeClock, freshDemoDatabase } from '../helpers';

// QUA-17 : les échéances et les badges ne changent pas avec l'optimisation de leurs chargements (filtrage SQL par périmètre
// et par site, chargements partagés mémorisés par requête, index). Référence enregistrée avant l'optimisation
// (test/fixtures/todo-golden.json, jeu de démonstration au 09/10/2026) : pour chaque rôle et chaque site sélectionné
// (ville-a, ville-b, « Tous les sites »), toutes les échéances du périmètre (loadTodo), les échéances visibles
// (loadVisibleTodo) et les badges (loadCounters), par empreinte SHA-256 de leur JSON (avec le nombre d'échéances et les badges
// en clair). VIGIE_GOLDEN_UPDATE=1 la réécrit (changement volontaire, à justifier).

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const GOLDEN = new URL('../fixtures/todo-golden.json', import.meta.url);
freshDemoDatabase();
// Heure figée : l'état des permis dépend de l'heure (referenceNow).
freezeClock('2026-10-09T08:30:00Z');

describe('Échéances et badges : équivalence (QUA-17)', () => {
  it('résultats identiques à la référence, par rôle et par site', async () => {
    const out: Record<string, unknown> = {};
    for (const role of ROLE_KEYS) {
      for (const site of ['ville-a', 'ville-b', 'all']) {
        actAs(role, site);
        const [todo, visible, counters] = [await loadTodo(), await loadVisibleTodo(), await loadCounters()];
        out[`${role}|${site}`] = { todo: todo.length, visible: visible.length, badges: counters.badges, todoHash: hash(todo), visibleHash: hash(visible) };
      }
    }
    const actual = JSON.parse(JSON.stringify(out));
    if (process.env.VIGIE_GOLDEN_UPDATE === '1' || !existsSync(GOLDEN)) writeFileSync(GOLDEN, `${JSON.stringify(actual, null, 1)}\n`);
    expect(actual).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
  }, 120_000);
});
