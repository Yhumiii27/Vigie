import 'server-only';
import { cache } from 'react';
import { asc } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { daysBetween, fmtDayMonth, today } from './dates';
import {
  EVENT_STEPS, EVENT_TYPES, ORIGINS, SKILL_SOON_DAYS, STEP_CLOSED,
  columnOf, initials, type ActionColumn, type EventType, type SkillState, type Tone,
} from './domain';
import { currentSiteId, inSite } from './session';

export type Person = typeof t.people.$inferSelect;
export type EventRow = typeof t.events.$inferSelect;
export type ActionRow = typeof t.actions.$inferSelect;

export const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
export const lcfirst = (s: string) => (s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s);

// ─── Chargements de base (mémorisés par requête) ────────────────────────────

export const loadPeople = cache(async () => {
  const db = await getDb();
  return byId(await db.select().from(t.people).orderBy(asc(t.people.sort)));
});

// Les chargements ci-dessous sont filtrés sur le site sélectionné (cookie) ; « Tous les sites » consolide.

export const loadEvents = cache(async () => {
  const [db, site] = await Promise.all([getDb(), currentSiteId()]);
  const rows = (await db.select().from(t.events)).filter((e) => inSite(site, e.siteId));
  return rows.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.id.localeCompare(a.id, 'fr', { numeric: true }));
});

export const loadActions = cache(async () => {
  const [db, site] = await Promise.all([getDb(), currentSiteId()]);
  return (await db.select().from(t.actions)).filter((a) => inSite(site, a.siteId));
});

export const loadControls = cache(async () => {
  const [db, site] = await Promise.all([getDb(), currentSiteId()]);
  return (await db.select().from(t.controls).orderBy(asc(t.controls.sort))).filter((c) => inSite(site, c.siteId));
});

// ─── Règles de calcul ───────────────────────────────────────────────────────

export const isOpen = (e: EventRow) => e.step < STEP_CLOSED;

/** Colonne du plan d'actions : « en retard » est déduit de l'échéance. */
export function actionColumn(a: ActionRow, now = today()): ActionColumn {
  if (a.status === 'done' || a.status === 'verify') return a.status;
  return a.dueOn < now ? 'late' : (a.status as ActionColumn);
}

export function controlStatus(c: { nextOn: string }, now = today()): { label: string; tone: Tone; days: number } {
  const days = daysBetween(now, c.nextOn);
  if (days < 0) return { label: `Dépassé · +${-days} j`, tone: 'danger', days };
  if (days <= 30) return { label: 'Sous 30 j', tone: 'warn', days };
  return { label: 'Planifié', tone: 'neutral', days };
}

export function skillState(required: boolean, expiresOn: string | null | undefined, has: boolean, now = today()): SkillState {
  if (!required) return 'n';
  if (!has) return 'r';
  if (!expiresOn) return 'v';
  if (expiresOn < now) return 'x';
  return daysBetween(now, expiresOn) <= SKILL_SOON_DAYS ? 's' : 'v';
}

// ─── Vues partagées ─────────────────────────────────────────────────────────

export function eventView(e: EventRow, people: Map<string, Person>, now = today()) {
  const type = EVENT_TYPES[e.type as EventType];
  return {
    ...e,
    typeLabel: type.label,
    typeTone: type.tone,
    status: EVENT_STEPS[e.step],
    pilot: e.pilotId ? people.get(e.pilotId)?.name ?? '—' : '—',
    declarantLabel: e.anonymous ? 'Anonyme' : e.declarant ?? '—',
    days: daysBetween(e.occurredOn, now),
  };
}
export type EventView = ReturnType<typeof eventView>;

export function actionView(a: ActionRow, people: Map<string, Person>, now = today()) {
  const col = actionColumn(a, now);
  const c = columnOf(col);
  const pilot = people.get(a.pilotId)?.name ?? '—';
  return {
    ...a,
    col,
    statusLabel: c.status,
    tone: c.tone,
    origin: ORIGINS[a.origin] ?? { label: a.origin, icon: 'ph-circle' },
    pilot,
    pilotInitials: initials(pilot),
    due: fmtDayMonth(a.dueOn),
    late: col === 'late',
    kindLabel: a.kind === 'C' ? 'Corrective' : 'Préventive',
  };
}
export type ActionView = ReturnType<typeof actionView>;
