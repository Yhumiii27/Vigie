// Règle de visibilité des échéances (« À traiter », page À faire, notifications, badges) — fonction pure, sans accès
// à la base ni à la session : partagée par src/lib/data/todo.ts et ses tests (TDB-02, TDB-05, SEC-06).

import { canEdit, canOpen, canSeeHealth, isEmployee, isMine, screenOfHref, todoKey, type Role, type ScreenKey, type TodoItem } from './domain';

/** Personne qui consulte les échéances : rôle, fiche et site sélectionné (null = « Tous les sites »). */
export type TodoViewer = { role: Role; user: { id: string; name: string }; siteId: string | null };

/** Échéance visible : clé d'état lu calculée sur le lien d'origine, écran source, élément d'un autre site que le site sélectionné. */
export type VisibleTodo = Omit<TodoItem, 'key' | 'readHref'> & {
  key: string;
  /** Écran source de l'échéance (lien d'origine) : puces de domaine de la page À faire, badges. */
  source: ScreenKey;
  /** Élément d'un autre site que le site sélectionné (échéance de la personne sur un autre site de son périmètre). */
  elsewhere: boolean;
  /** Libellé court du site, pour les échéances d'un autre site (renseigné par loadVisibleTodo). */
  siteLabel?: string;
};

/**
 * Échéances visibles par `v`, dans l'ordre reçu :
 * - une échéance qui révèle une donnée de santé est retirée pour les rôles non habilités, responsable compris (SEC-06) ;
 * - les échéances de la personne (ownerIds, strictement) restent visibles sur tous les sites de son périmètre et même
 *   quand l'écran source lui est fermé : le lien devient alors la vue en lecture (readHref) ou disparaît (TDB-02, TDB-05) ;
 * - les autres : site sélectionné, et écran que le rôle modifie (un écran en consultation seule ne montre que les
 *   échéances de la personne) ; pour un salarié, les siennes seulement (repli sur le nom, isMine), écran ouvert.
 */
export function visibleTodo(items: TodoItem[], v: TodoViewer): VisibleTodo[] {
  const health = canSeeHealth(v.role);
  const employee = isEmployee(v.role);
  return items.flatMap((item) => {
    if (item.health && !health) return [];
    const key = todoKey(item);
    const source = screenOfHref(item.href ?? '/');
    // Contournement (autre site, écran fermé) réservé aux responsables désignés : jamais par le repli sur le nom.
    const owner = !!item.ownerIds?.includes(v.user.id);
    const here = !v.siteId || !item.siteId || item.siteId === v.siteId;
    const access = canOpen(v.role, item.href);
    const actionable = !item.href || canEdit(v.role, source);
    const keep = employee ? owner || (isMine(item, v.user) && here && access) : owner || (here && actionable);
    if (!keep) return [];
    const { readHref, ...rest } = item;
    const href = access ? item.href : owner && readHref ? readHref : undefined;
    return [{ ...rest, href, key, source, elsewhere: !here }];
  });
}
