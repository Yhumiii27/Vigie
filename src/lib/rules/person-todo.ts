// Échéances par personne, calculées hors requête (PRD-12) : règle pure, sans base ni session (src/lib/data/person-todo.ts
// fournit les échéances de tout le périmètre et l'annuaire). Réutilisable par un futur canal sortant (e-mail, Teams…) :
// rien n'est envoyé ni stocké ici.

import { inNotifyHorizon, isTodoLate } from '../horizons';
import { ROLE_KEYS, type Role, type TodoItem } from '../domain';
import { visibleTodo, type VisibleTodo } from '../todo-visibility';

/** Personne de l'annuaire : rôle = dernier rôle connu (people.last_role) ; inconnu → Salarié (le plus restreint). */
export type PersonTodoPerson = { id: string; name: string; email: string | null; lastRole: string | null; leftOn: string | null };

/** Échéances d'une personne : celles dont elle est responsable désignée (ownerIds), telles que son rôle les voit. */
export type PersonTodo = {
  personId: string; name: string; email: string | null; role: Role;
  items: VisibleTodo[];
  /** Dépassées ou en retard. */
  late: number;
  /** Sous l'horizon des notifications (NOTIFY_HORIZON_DAYS), retards compris : contenu d'un futur rappel. */
  notify: number;
};

/** Rôle retenu hors session : dernier rôle connu, sinon Salarié (aucune donnée de santé, aucun écran de saisie). */
export const backgroundRole = (lastRole: string | null): Role => (lastRole && (ROLE_KEYS as string[]).includes(lastRole) ? lastRole as Role : 'Salarié');

/**
 * Échéances de chaque personne présente (non sortie au `today`) : échéances dont elle est responsable désignée (ownerIds,
 * strictement — jamais le repli sur le nom), comme la page À faire (horizons des domaines), filtrées par visibleTodo avec son
 * rôle (donnée de santé retirée pour un rôle non habilité, lien remplacé par la vue en lecture ou retiré sur un écran fermé),
 * tous sites (site sélectionné : « Tous les sites »). Personnes sans échéance omises ; ordre de l'annuaire reçu ; échéances
 * dans l'ordre reçu (byUrgency).
 */
export function todoByPerson(items: readonly TodoItem[], people: readonly PersonTodoPerson[], today: string): PersonTodo[] {
  return people.flatMap((p) => {
    if (p.leftOn && p.leftOn <= today) return [];
    const own = items.filter((i) => i.ownerIds?.includes(p.id));
    if (!own.length) return [];
    const role = backgroundRole(p.lastRole);
    const visible = visibleTodo(own, { role, user: { id: p.id, name: p.name }, siteId: null });
    if (!visible.length) return [];
    return [{
      personId: p.id, name: p.name, email: p.email, role, items: visible,
      late: visible.filter((i) => isTodoLate(i, today)).length,
      notify: visible.filter((i) => inNotifyHorizon(i, today)).length,
    }];
  });
}
