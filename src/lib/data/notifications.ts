import 'server-only';
import { cache } from 'react';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { addDays, today } from '../dates';
import { NOTIFY_HORIZON_DAYS, todoKey, type TodoItem } from '../domain';
import { getSession } from '../session';
import { loadVisibleTodo } from './todo';

export type Notification = TodoItem & { urgent: boolean; key: string; read: boolean };

/** Clés des échéances déjà lues par la personne connectée (table notification_reads). */
export const loadReadKeys = cache(async (): Promise<Set<string>> => {
  const db = await getDb();
  const { user } = await getSession();
  const rows = await db.select({ key: t.notificationReads.itemKey }).from(t.notificationReads).where(eq(t.notificationReads.personId, user.id));
  return new Set(rows.map((r) => r.key));
});

/**
 * Notifications de l'en-tête : dépassements et échéances des 7 prochains jours, parmi les échéances visibles
 * de la personne connectée. `read` : clé présente dans notification_reads pour cette personne.
 */
export const loadNotifications = cache(async (): Promise<Notification[]> => {
  const week = addDays(today(), NOTIFY_HORIZON_DAYS);
  const [todo, reads] = await Promise.all([loadVisibleTodo(), loadReadKeys()]);
  return todo
    .filter((n) => n.overdue || n.date <= week)
    .map((n) => {
      const key = todoKey(n);
      return { ...n, key, urgent: n.tone === 'danger' || !!n.overdue, read: reads.has(key) };
    })
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.date.localeCompare(b.date));
});
