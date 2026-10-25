import 'server-only';
import { cache } from 'react';
import { aliasedTable, and, desc, eq, gte, isNotNull, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { reminderFor } from '../action-reminder-job';
import { REMINDER_HREF, reminderKey, reminderTitle, reminderWeek } from '../action-reminder';
import { canReadAction } from '../action-rules';
import { inNotifyHorizon } from '../horizons';
import { addDays, fromParisLocal, parisDay } from '../dates';
import { today } from '@/lib/today';
import {
  NOTIFICATION_KINDS, NOTIFY_HORIZON_DAYS, REMINDER_KIND, STORED_NOTIFICATION_KEY_PREFIX, screenOfHref, type NotificationType,
} from '../domain';
import { currentSiteId, getSession } from '../session';
import { loadSiteDirectory, loadVisibleTodo, shortSiteLabel, type VisibleTodo } from './todo';

// Cloche de l'en-tête (docs/specs/actions-qse.md § 15) : trois familles d'éléments.
// 1. Notifications d'information stockées (table notifications, ACT-30 « Action confiée », ACT-31 commentaire ou preuve
//    du responsable, TDB-06 suite d'un signalement au déclarant, sans site : « Mes signalements ») : non lues (50 au plus) et lues depuis moins de NOTIFY_HORIZON_DAYS jours ; clé « notification:<id> »,
//    état lu dans la ligne elle-même (read_at).
// 2. Rappel du mercredi (ACT-32, D12) : élément calculé, jamais une échéance (ni À faire, ni tableau de bord, ni badges) ;
//    actions de la personne ouvertes ou Terminées sur tous les sites (D19), daté du mercredi de la semaine, clé
//    « rappel-actions|2026-W42 » (état lu dans notification_reads) ; masqué une fois lu, remplacé le mercredi suivant.
// 3. Échéances visibles (loadVisibleTodo) : dépassements et échéances des 7 prochains jours.
// Ordre : échéances urgentes, puis informations (les plus récentes d'abord), puis les autres échéances par date.

/** Famille d'un élément de la cloche : échéance calculée, notification stockée (par type) ou rappel du mercredi. */
export type NotificationFamily = 'todo' | NotificationType | 'rappel' | 'information';

export type Notification = VisibleTodo & {
  urgent: boolean; read: boolean;
  /** Famille de l'élément (icône de la cloche). */
  family: NotificationFamily;
  /** Information (notification stockée ou rappel), par opposition à une échéance. */
  info: boolean;
};

/** Notifications non lues affichées au plus (les plus récentes) ; même plafond pour les lues des 7 derniers jours. */
export const STORED_UNREAD_MAX = 50;

/** Clés des échéances déjà lues par la personne connectée (table notification_reads). */
export const loadReadKeys = cache(async (): Promise<Set<string>> => {
  const db = await getDb();
  const { user } = await getSession();
  const rows = await db.select({ key: t.notificationReads.itemKey }).from(t.notificationReads).where(eq(t.notificationReads.personId, user.id));
  return new Set(rows.map((r) => r.key));
});

/** Identifiant d'une notification stockée à partir de sa clé « notification:<id> » (null pour toute autre clé). */
export function storedNotificationId(key: string): number | null {
  if (!key.startsWith(STORED_NOTIFICATION_KEY_PREFIX)) return null;
  const id = key.slice(STORED_NOTIFICATION_KEY_PREFIX.length);
  return /^[1-9]\d{0,9}$/.test(id) && Number(id) <= 2_147_483_647 ? Number(id) : null;
}

const isNotificationType = (s: string): s is NotificationType => Object.hasOwn(NOTIFICATION_KINDS, s);

/**
 * Notifications stockées de la personne connectée : non lues (les 50 plus récentes) et lues depuis moins de 7 jours.
 * Site = site actuel de l'action (null : action sans site, « à compléter ») ; autre site que le site sélectionné :
 * libellé court du site, l'ouverture sélectionne ce site quand il est proposé (openTodo). Lien gardé tant que la personne
 * peut lire l'action (canReadAction : son responsable quel que soit le site, D19 ; sinon le plan de son périmètre) ;
 * sinon (ancien responsable après une réaffectation, action hors du périmètre) : élément sans lien, comme une échéance
 * d'un site inaccessible (todo.ts).
 */
async function loadStored(): Promise<Notification[]> {
  const db = await getDb();
  const [{ user, role, allowedSiteIds }, siteId, sites] = await Promise.all([getSession(), currentSiteId(), loadSiteDirectory()]);
  const n = t.notifications;
  const author = aliasedTable(t.people, 'author');
  const select = {
    id: n.id, type: n.type, entityType: n.entityType, title: n.title, href: n.href, createdAt: n.createdAt, readAt: n.readAt, who: author.name,
    siteId: t.actions.siteId, pilotId: t.actions.pilotId, declarantId: t.events.declarantId, anonymous: t.events.anonymous,
  };
  const base = () => db.select(select).from(n)
    .leftJoin(author, eq(author.id, n.byId))
    .leftJoin(t.actions, and(eq(n.entityType, 'action'), eq(t.actions.id, n.entityId)))
    .leftJoin(t.events, and(eq(n.entityType, 'event'), eq(t.events.id, n.entityId)));
  const since = fromParisLocal(`${addDays(today(), -NOTIFY_HORIZON_DAYS)}T00:00`) ?? new Date(0);
  const [unread, read] = await Promise.all([
    base().where(and(eq(n.personId, user.id), isNull(n.readAt))).orderBy(desc(n.createdAt), desc(n.id)).limit(STORED_UNREAD_MAX),
    base().where(and(eq(n.personId, user.id), isNotNull(n.readAt), gte(n.readAt, since))).orderBy(desc(n.createdAt), desc(n.id)).limit(STORED_UNREAD_MAX),
  ]);
  const labels = new Map(sites.map((s) => [s.id, shortSiteLabel(s.label)]));
  return [...unread, ...read].map((r): Notification => {
    const elsewhere = !!siteId && !!r.siteId && r.siteId !== siteId;
    // Suite d'un signalement (TDB-06) : « Mes signalements », tous sites, tant que la personne en est le déclarant nominatif.
    const readable = r.entityType === 'event'
      ? r.declarantId === user.id && r.anonymous === false
      : r.pilotId !== null && canReadAction(role, user.id, { pilotId: r.pilotId, siteId: r.siteId }, allowedSiteIds);
    return {
      key: `${STORED_NOTIFICATION_KEY_PREFIX}${r.id}`, date: parisDay(r.createdAt), kind: isNotificationType(r.type) ? NOTIFICATION_KINDS[r.type] : 'Information',
      tone: 'accent', title: r.title, who: r.who ?? '', href: readable ? r.href : undefined, siteId: r.siteId, source: screenOfHref(r.href),
      elsewhere, siteLabel: elsewhere && r.siteId ? labels.get(r.siteId) ?? r.siteId : undefined,
      urgent: false, read: r.readAt !== null, family: isNotificationType(r.type) ? r.type : 'information', info: true,
    };
  });
}

/**
 * Rappel du mercredi de la personne connectée (ACT-32) : null sans action ouverte ni Terminée, ou une fois lu (D12).
 * Pas de synthèse pour le QHSE : chacun ne reçoit que le rappel de ses propres actions de responsable.
 */
async function loadReminder(reads: Set<string>): Promise<Notification | null> {
  const db = await getDb();
  const { user } = await getSession();
  const day = today();
  const { day: wednesday, week } = reminderWeek(day);
  const key = reminderKey(week);
  if (reads.has(key)) return null;
  const rows = await reminderFor(db, user.id, day);
  if (!rows.count) return null;
  return {
    key, date: wednesday, kind: REMINDER_KIND, tone: rows.late ? 'warn' : 'accent', title: reminderTitle(rows.count, rows.late), who: '',
    href: REMINDER_HREF, siteId: null, source: 'actions', elsewhere: false, ownerIds: [user.id],
    urgent: false, read: false, family: 'rappel', info: true,
  };
}

/**
 * Éléments de la cloche de la personne connectée : échéances urgentes, puis informations (notifications stockées et rappel
 * du mercredi, les plus récentes d'abord), puis les autres échéances (7 prochains jours) par date. `read` : notification
 * lue (read_at), clé présente dans notification_reads pour les échéances.
 */
export const loadNotifications = cache(async (): Promise<Notification[]> => {
  const now = today();
  const [todo, reads, stored] = await Promise.all([loadVisibleTodo(), loadReadKeys(), loadStored()]);
  const reminder = await loadReminder(reads);
  const due = todo
    .filter((n) => inNotifyHorizon(n, now))
    .map((n): Notification => ({ ...n, urgent: n.tone === 'danger' || !!n.overdue, read: reads.has(n.key), family: 'todo', info: false }))
    // Retards du plus ancien au plus récent (date d'échéance réelle, TDB-07), puis par date.
    .sort((a, b) => (a.dueOn ?? a.date).localeCompare(b.dueOn ?? b.date) || a.date.localeCompare(b.date));
  const infos = [...stored, ...(reminder ? [reminder] : [])].sort((a, b) => b.date.localeCompare(a.date) || storedOrder(b) - storedOrder(a));
  return [...due.filter((n) => n.urgent), ...infos, ...due.filter((n) => !n.urgent)];
});

/** Départage des informations d'un même jour : la notification la plus récente (identifiant croissant) d'abord, le rappel en tête. */
const storedOrder = (n: Notification) => storedNotificationId(n.key) ?? Number.MAX_SAFE_INTEGER;
