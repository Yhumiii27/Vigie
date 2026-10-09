import 'server-only';
import { cache } from 'react';
import { byUrgency, canOpen, isEmployee, isMine, type TodoItem } from '../domain';
import { getSession } from '../session';
import { loadActionSignals } from './actions';
import { loadAuditSignals } from './audits';
import { loadDocumentSignals } from './documents';
import { loadEnvironmentSignals } from './environment';
import { loadEventSignals } from './events';
import { loadPreventionSignals } from './prevention';
import { loadReviewSignals } from './review';
import { loadRiskSignals } from './risks';
import { loadSkillSignals } from './skills';
import { loadCoactivitySignals } from './sitemap';
import { loadWatchSignals } from './watch';

// Source unique des échéances : « À traiter » du tableau de bord, page À faire, notifications et badges.
// Chaque domaine fournit `load<Domaine>Signals(): Promise<{ todo: TodoItem[] }>` (mémorisé avec cache()) ;
// son horizon est TODO_HORIZON_DAYS (CONTROL_HORIZON_DAYS pour les contrôles), dépassements compris.

/** Toutes les échéances du site sélectionné, avant filtre par rôle : dépassements d'abord, puis par date. */
export const loadTodo = cache(async (): Promise<TodoItem[]> => {
  const signals = await Promise.all([
    loadEventSignals(), loadActionSignals(), loadWatchSignals(), loadSkillSignals(), loadRiskSignals(),
    loadAuditSignals(), loadReviewSignals(), loadPreventionSignals(), loadCoactivitySignals(),
    loadDocumentSignals(), loadEnvironmentSignals(),
  ]);
  return signals.flatMap((s) => s.todo).sort(byUrgency);
});

/** Échéances visibles par la personne connectée : écrans ouverts à son rôle ; pour un salarié, les siennes seulement. */
export const loadVisibleTodo = cache(async (): Promise<TodoItem[]> => {
  const [{ role, user }, todo] = await Promise.all([getSession(), loadTodo()]);
  const reach = todo.filter((t) => canOpen(role, t.href));
  return isEmployee(role) ? reach.filter((t) => isMine(t, user)) : reach;
});
