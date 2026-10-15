import 'server-only';
import { cache } from 'react';
import { NAV, canSee, type ScreenKey } from '../domain';
import { getSession } from '../session';
import { loadVisibleTodo } from './todo';

// ─── Badges de navigation ───────────────────────────────────────────────────

/**
 * Badge d'un écran = nombre d'éléments de ce domaine parmi les échéances visibles du site sélectionné (même règle que
 * « À traiter »), l'écran étant déduit du lien de l'échéance (source) ; `count` d'une échéance regroupée vaut plusieurs
 * éléments. Les échéances d'un autre site et celles sans lien (écran fermé, TDB-02) ne comptent pas : l'écran ne les
 * montrerait pas. « À faire » : nombre d'échéances de la page (compteur « Toutes », autres sites compris).
 */
const NAV_SCREENS = new Set<ScreenKey>(NAV.flatMap((s) => s.items));

export const loadCounters = cache(async () => {
  const [{ role }, todo] = await Promise.all([getSession(), loadVisibleTodo()]);
  const badges: Partial<Record<ScreenKey, number>> = { todo: todo.length };
  todo.forEach((t) => {
    if (t.elsewhere || !t.href) return;
    const s = t.source;
    // Écrans de la navigation seulement (pas « Mes contributions », hors navigation), ouverts au rôle.
    if (s !== 'dashboard' && s !== 'todo' && NAV_SCREENS.has(s) && canSee(role, s)) badges[s] = (badges[s] ?? 0) + (t.count ?? 1);
  });
  return { badges };
});
