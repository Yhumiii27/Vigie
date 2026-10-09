'use server';

import { revalidatePath } from 'next/cache';
import { getDb, schema as t } from '@/db';
import { getSession } from '@/lib/session';
import { loadTodoPage } from '@/lib/data/dashboard';
import { loadNotifications } from '@/lib/data/notifications';

// État lu des échéances (cloche et page À faire) : personnel, ouvert à tous les rôles.

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
 * À faire avec ses filtres domaine / « Mes échéances »). Les clés lues absentes de la liste sont conservées :
 * les échéances ne couvrent que le site sélectionné, une purge effacerait l'état lu des autres sites.
 */
export async function markAllRead(scope: 'notifications' | 'todo', filter?: { domain?: string; mine?: boolean }): Promise<void> {
  const { user } = await getSession();
  const keys = scope === 'notifications'
    ? (await loadNotifications()).map((n) => n.key)
    : (await loadTodoPage({ domain: typeof filter?.domain === 'string' ? filter.domain : undefined, mine: filter?.mine === true })).items.map((x) => x.key);
  await insertReads(user.id, [...new Set(keys)]);
  revalidatePath('/', 'layout');
}
