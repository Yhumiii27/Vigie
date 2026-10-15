'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb, schema as t } from '@/db';
import { setSite } from '@/app/actions';
import { ALL_SITES, getSession } from '@/lib/session';
import { loadTodoPage } from '@/lib/data/dashboard';
import { loadNotifications } from '@/lib/data/notifications';
import { loadVisibleTodo } from '@/lib/data/todo';

// État lu des échéances (cloche et page À faire) : personnel, ouvert à tous les rôles. Ce n'est pas un enregistrement
// métier tracé : pas de journal des modifications (logChange).

const MAX_KEYS = 500;
const MAX_KEY_LENGTH = 400;

async function insertReads(personId: string, keys: string[]) {
  if (!keys.length) return;
  const db = await getDb();
  await db.insert(t.notificationReads).values(keys.map((itemKey) => ({ personId, itemKey }))).onConflictDoNothing();
}

/** Marque comme lues les échéances indiquées (clic sur une notification). */
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
 */
export async function markAllRead(scope: 'notifications' | 'todo', filter?: { domain?: string; mine?: boolean }): Promise<void> {
  const { user } = await getSession();
  const keys = scope === 'notifications'
    ? (await loadNotifications()).map((n) => n.key)
    : (await loadTodoPage({ domain: typeof filter?.domain === 'string' ? filter.domain : undefined, mine: filter?.mine === true })).items.map((x) => x.key);
  await insertReads(user.id, [...new Set(keys)]);
  revalidatePath('/', 'layout');
}

/**
 * Ouvre une échéance visible (TDB-05) : seule une échéance de loadVisibleTodo() pour la personne connectée peut être
 * ouverte — c'est l'autorisation ; clé inconnue, échéance invisible ou sans lien : rien. Échéance d'un autre site : ce site
 * est d'abord sélectionné (sinon « Tous les sites » quand il est proposé), car l'écran cible, filtré sur le site
 * sélectionné, ne trouverait pas l'élément. `markRead` : marque l'échéance comme lue (clic dans la cloche).
 */
export async function openTodo(key: string, opts?: { markRead?: boolean }): Promise<void> {
  if (typeof key !== 'string' || !key.length || key.length > MAX_KEY_LENGTH) return;
  const { user, siteOptions } = await getSession();
  const item = (await loadVisibleTodo()).find((x) => x.key === key);
  if (!item?.href) return;
  if (opts?.markRead === true) await insertReads(user.id, [item.key]);
  if (item.elsewhere && item.siteId) {
    const target = siteOptions.some((s) => s.id === item.siteId) ? item.siteId : siteOptions.some((s) => s.id === ALL_SITES) ? ALL_SITES : null;
    if (target) await setSite(target);
  } else if (opts?.markRead === true) {
    revalidatePath('/', 'layout');
  }
  redirect(item.href);
}
