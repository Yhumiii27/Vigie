'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { setSite } from '@/app/actions';
import { STORED_NOTIFICATION_KEY_PREFIX } from '@/lib/domain';
import { ALL_SITES, getSession } from '@/lib/session';
import { loadTodoPage } from '@/lib/data/dashboard';
import { loadNotifications, storedNotificationId } from '@/lib/data/notifications';
import { loadVisibleTodo } from '@/lib/data/todo';

// État lu des éléments de la cloche et de la page À faire : personnel, ouvert à tous les rôles. Ce n'est pas un
// enregistrement métier tracé : pas de journal des modifications (logChange). Deux supports, choisis par la clé :
// « notification:<id> » → notifications.read_at (notification stockée, ACT-30 / ACT-31, de la personne seulement) ;
// toute autre clé (échéance calculée, rappel du mercredi « rappel-actions|… ») → table notification_reads.

const MAX_KEYS = 500;
const MAX_KEY_LENGTH = 400;

/**
 * Marque les clés comme lues pour la personne : notifications stockées (les siennes seulement, encore non lues : la date
 * de lecture n'est jamais déplacée) et autres clés dans notification_reads.
 */
async function insertReads(personId: string, keys: string[]) {
  if (!keys.length) return;
  const db = await getDb();
  const ids = [...new Set(keys.map(storedNotificationId).filter((id): id is number => id !== null))];
  // Clé « notification:… » mal formée : ignorée (jamais dans notification_reads).
  const others = keys.filter((k) => !k.startsWith(STORED_NOTIFICATION_KEY_PREFIX));
  if (ids.length) {
    await db.update(t.notifications).set({ readAt: new Date() })
      .where(and(inArray(t.notifications.id, ids), eq(t.notifications.personId, personId), isNull(t.notifications.readAt)));
  }
  if (others.length) await db.insert(t.notificationReads).values(others.map((itemKey) => ({ personId, itemKey }))).onConflictDoNothing();
}

/** Marque comme lus les éléments indiqués (clic sur une notification ; notifications stockées de la personne seulement). */
export async function markNotificationsRead(keys: string[]): Promise<void> {
  const { user } = await getSession();
  if (!Array.isArray(keys) || keys.length > MAX_KEYS || !keys.every((k) => typeof k === 'string' && k.length > 0 && k.length <= MAX_KEY_LENGTH)) return;
  await insertReads(user.id, [...new Set(keys)]);
  revalidatePath('/', 'layout');
}

/**
 * « Tout marquer comme lu » : clés recalculées côté serveur (notifications de la cloche, ou liste affichée par la page
 * À faire avec ses filtres domaine / « Mes échéances »), échéances de la personne sur les autres sites comprises (TDB-05).
 * Les clés lues absentes de la liste sont conservées : les autres échéances des autres sites (celles qui ne sont pas les
 * siennes), et celles masquées par un filtre ou sorties de l'horizon, garderaient sinon leur état lu à tort effacé.
 * Cloche : toutes les notifications stockées non lues de la personne (même au-delà des 50 affichées) et le rappel du
 * mercredi ; page À faire : échéances seulement.
 */
export async function markAllRead(scope: 'notifications' | 'todo', filter?: { domain?: string; mine?: boolean }): Promise<void> {
  const { user } = await getSession();
  const keys = scope === 'notifications'
    ? (await loadNotifications()).map((n) => n.key)
    : (await loadTodoPage({ domain: typeof filter?.domain === 'string' ? filter.domain : undefined, mine: filter?.mine === true })).items.map((x) => x.key);
  await insertReads(user.id, [...new Set(keys)]);
  if (scope === 'notifications') {
    // Notifications stockées au-delà des 50 affichées : toutes celles de la personne, encore non lues.
    const db = await getDb();
    await db.update(t.notifications).set({ readAt: new Date() }).where(and(eq(t.notifications.personId, user.id), isNull(t.notifications.readAt)));
  }
  revalidatePath('/', 'layout');
}

/**
 * Ouvre un élément de la cloche ou une échéance visible (TDB-05) : seul un élément de loadNotifications() ou de
 * loadVisibleTodo() pour la personne connectée peut être ouvert — c'est l'autorisation ; clé inconnue, élément invisible
 * (notification d'une autre personne comprise) ou sans lien : rien. Élément d'un autre site : ce site est d'abord
 * sélectionné (sinon « Tous les sites » quand il est proposé), car l'écran cible, filtré sur le site sélectionné, ne
 * trouverait pas l'élément ; site hors des choix de la personne (action dont elle est responsable sur un autre site, D19) :
 * ouvert sans changer de site. `markRead` : marque l'élément comme lu (clic dans la cloche).
 */
export async function openTodo(key: string, opts?: { markRead?: boolean }): Promise<void> {
  if (typeof key !== 'string' || !key.length || key.length > MAX_KEY_LENGTH) return;
  const { user, siteOptions } = await getSession();
  const item = (await loadNotifications()).find((x) => x.key === key) ?? (await loadVisibleTodo()).find((x) => x.key === key);
  if (!item?.href) return;
  if (opts?.markRead === true) await insertReads(user.id, [item.key]);
  const target = item.elsewhere && item.siteId
    ? siteOptions.some((s) => s.id === item.siteId) ? item.siteId : siteOptions.some((s) => s.id === ALL_SITES) ? ALL_SITES : null
    : null;
  if (target) await setSite(target);
  else if (opts?.markRead === true) revalidatePath('/', 'layout');
  redirect(item.href);
}
