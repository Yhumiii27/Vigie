import 'server-only';
import { cache } from 'react';
import { asc } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { daysBetween, fmtDate, fmtDayMonth, today } from './dates';
import {
  CERT_SOON_DAYS, CONTROL_HORIZON_DAYS, EVENT_DISMISSED, EVENT_STEPS, EVENT_TYPES, ORIGINS, SKILL_SOON_DAYS, STEP_CLOSED,
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

/** Tous les événements du site, classés sans suite compris (liste « Classés sans suite », fiche). */
export const loadSiteEvents = cache(async () => {
  const [db, site] = await Promise.all([getDb(), currentSiteId()]);
  const rows = (await db.select().from(t.events)).filter((e) => inSite(site, e.siteId));
  return rows.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.id.localeCompare(a.id, 'fr', { numeric: true }));
});

/** Événements du site hors classés sans suite : base des indicateurs (TF1/TG, pyramide, NC ouvertes…). */
export const loadEvents = cache(async () => (await loadSiteEvents()).filter((e) => !e.dismissedAt));

/** Toutes les actions du site, annulées comprises (filtre « Annulées », historique). */
export const loadAllActions = cache(async () => {
  const [db, site] = await Promise.all([getDb(), currentSiteId()]);
  return (await db.select().from(t.actions)).filter((a) => inSite(site, a.siteId));
});

/** Actions du site hors annulées : base de tous les calculs transverses (retards, échéances, revues…). */
export const loadActions = cache(async () => (await loadAllActions()).filter((a) => a.status !== 'cancelled'));

/** Contrôles périodiques actifs du site (les équipements réformés, archivés, sont exclus). */
export const loadControls = cache(async () => {
  const [db, site] = await Promise.all([getDb(), currentSiteId()]);
  return (await db.select().from(t.controls).orderBy(asc(t.controls.sort))).filter((c) => !c.archivedAt && inSite(site, c.siteId));
});

// ─── Règles de calcul ───────────────────────────────────────────────────────

export const isOpen = (e: EventRow) => e.step < STEP_CLOSED && !e.dismissedAt;

/** Colonne du plan d'actions : « en retard » est déduit de l'échéance. */
export function actionColumn(a: ActionRow, now = today()): ActionColumn {
  if (a.status === 'done' || a.status === 'verify' || a.status === 'cancelled') return a.status;
  return a.dueOn < now ? 'late' : (a.status as ActionColumn);
}

export function controlStatus(c: { nextOn: string }, now = today()): { label: string; tone: Tone; days: number } {
  const days = daysBetween(now, c.nextOn);
  if (days < 0) return { label: `Dépassé · +${-days} j`, tone: 'danger', days };
  if (days <= CONTROL_HORIZON_DAYS) return { label: `Sous ${CONTROL_HORIZON_DAYS} j`, tone: 'warn', days };
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
    dismissed: !!e.dismissedAt,
    status: e.dismissedAt ? EVENT_DISMISSED : EVENT_STEPS[e.step],
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
    origin: ORIGINS[a.origin] ?? { label: a.origin, icon: 'ph-circle', path: '/actions' },
    pilot,
    pilotInitials: initials(pilot),
    due: fmtDayMonth(a.dueOn),
    late: col === 'late',
    kindLabel: a.kind === 'C' ? 'Corrective' : 'Préventive',
  };
}
export type ActionView = ReturnType<typeof actionView>;

/** Action du plan d'actions rattachée à un élément (audit, revue…), statut calculé. */
export type ActionBrief = { id: string; title: string; status: string; tone: Tone; pilot: string; dueOn: string; closedOn: string | null; efficacyNote: string | null };

export function actionBrief(a: ActionRow | undefined, people: Map<string, Person>, now: string): ActionBrief | null {
  if (!a) return null;
  const c = columnOf(actionColumn(a, now));
  return { id: a.id, title: a.title, status: c.status, tone: c.tone, pilot: people.get(a.pilotId)?.name ?? '—', dueOn: a.dueOn, closedOn: a.closedOn, efficacyNote: a.efficacyNote };
}

// ─── Veille : projets Keystone concernés ────────────────────────────────────

type ConcernReq = { dueOn: string | null; affectsProjects: boolean; keystoneProjects: number | null };

/** Projets Keystone livrés après la date d'application d'une exigence qui les concerne (affectsProjects), par livraison. */
export const concernedProjects = <P extends { deliveryOn: string | null }>(req: Omit<ConcernReq, 'keystoneProjects'>, projects: P[]) =>
  req.affectsProjects && req.dueOn
    ? projects.filter((p) => !!p.deliveryOn && p.deliveryOn > req.dueOn!).sort((a, b) => a.deliveryOn!.localeCompare(b.deliveryOn!))
    : [];

/** Nombre de projets concernés : le champ manuel `keystoneProjects` reste une surcharge du calcul (null = non applicable). */
export const concernedCount = (req: ConcernReq, projects: { deliveryOn: string | null }[]) =>
  req.keystoneProjects ?? (req.affectsProjects && req.dueOn ? concernedProjects(req, projects).length : null);

// ─── Audits : statut calculé d'une certification ────────────────────────────

/** Statut affiché d'un référentiel : engagement, validité du certificat et prochain audit au programme. */
export function certificationStatus(c: { tone: string; status: string; validUntil: string | null }, nextAuditOn: string | null, now: string): { label: string; tone: Tone } {
  const audit = nextAuditOn && (nextAuditOn < now ? `audit du ${fmtDate(nextAuditOn)} à confirmer` : `${c.tone === 'ok' ? 'suivi' : 'audit'} le ${fmtDate(nextAuditOn)}`);
  if (c.tone === 'off') return { label: c.status || 'Non engagé', tone: 'neutral' };
  if (c.tone === 'warn') return { label: [c.status || 'Certification en cours', audit].filter(Boolean).join(' · '), tone: 'warn' };
  if (c.validUntil && c.validUntil < now) return { label: `Certificat expiré depuis le ${fmtDate(c.validUntil)}`, tone: 'danger' };
  if (c.validUntil && daysBetween(now, c.validUntil) <= CERT_SOON_DAYS) return { label: `Certifié · valable jusqu'au ${fmtDate(c.validUntil)}`, tone: 'warn' };
  if (!nextAuditOn) return { label: 'Certifié · prochain audit à programmer', tone: 'warn' };
  return { label: `Certifié · ${audit}`, tone: nextAuditOn < now || daysBetween(now, nextAuditOn) <= CERT_SOON_DAYS ? 'warn' : 'ok' };
}
