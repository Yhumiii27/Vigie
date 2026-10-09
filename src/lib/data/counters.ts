import 'server-only';
import { cache } from 'react';
import { screenOfHref, type ScreenKey } from '../domain';
import { loadVisibleTodo } from './todo';

// ─── Badges de navigation ───────────────────────────────────────────────────

/**
 * Badge d'un écran = nombre d'éléments de ce domaine présents dans les échéances visibles (même règle que « À traiter »),
 * l'écran étant déduit du lien de l'échéance (screenOfHref). `count` d'une échéance regroupée vaut plusieurs éléments.
 * « À faire » : nombre d'échéances de la page (compteur « Toutes »).
 */
export const loadCounters = cache(async () => {
  const todo = await loadVisibleTodo();
  const badges: Partial<Record<ScreenKey, number>> = { todo: todo.length };
  todo.forEach((t) => {
    const s = screenOfHref(t.href ?? '/');
    if (s !== 'dashboard' && s !== 'todo') badges[s] = (badges[s] ?? 0) + (t.count ?? 1);
  });
  return { badges };
});
