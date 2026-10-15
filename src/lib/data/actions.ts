import 'server-only';
import { cache } from 'react';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import type { ChangeEntry } from '@/components/ChangeLog';
import { ACTION_LINKS, loadLinkSources } from '../action-links';
import { toAttachmentItem, type AttachmentItem } from '../attachments';
import { addDays, daysBetween, fmtDate, fmtDayMonth } from '../dates';
import { today } from '@/lib/today';
import {
  ACTION_COLUMNS, EVENT_ORIGINS, ORIGINS, TODO_HORIZON_DAYS, canOpen, isEmployee,
  type ActionColumn, type TodoItem, type Tone,
} from '../domain';
import { actionColumn, actionView, loadActions, loadAllActions, loadPeople, type ActionView } from '../queries';
import { loadQhseLeads } from './leads';
import { getSession, inPerimeter } from '../session';
import { loadChangeLogs } from './changelog';

// ─── Plan d'actions ─────────────────────────────────────────────────────────

/**
 * Source d'une action (fiche, colonne Origine) ; href null = écran non ouvert au rôle.
 * `detachOnCancel` : rattachement retiré si l'action est annulée (ni l'événement, ni la revue, ni la référence d'origine).
 */
export type PlanSource = { label: string; href: string | null; detail?: string; detachOnCancel?: boolean };

/** Action du plan, sérialisable pour les composants client (carte Kanban, fiche). */
export type PlanAction = {
  id: string;
  title: string;
  description: string | null;
  origin: { key: string; label: string; icon: string };
  originRef: string;
  eventId: string | null;
  /** Sources de l'action, la plus précise d'abord ; jamais vide (repli : écran de l'origine). */
  sources: PlanSource[];
  /** Le premier élément de `sources` est le simple repli sur l'écran d'origine (aucune source précise). */
  sourcesFallback: boolean;
  siteId: string | null;
  /** Libellé complet du site (« Tous les sites » si l'action n'est pas rattachée à un site). */
  site: string;
  /** Libellé court pour les tableaux (« Site de [Ville A] »). */
  siteShort: string;
  pilotId: string;
  pilot: string;
  pilotInitials: string;
  dueOn: string;
  /** 03/10 */
  due: string;
  /** 03/10/2026 */
  dueLabel: string;
  late: boolean;
  lateDays: number;
  status: 'todo' | 'doing' | 'verify' | 'done' | 'cancelled';
  col: ActionColumn;
  statusLabel: string;
  tone: Tone;
  kind: 'C' | 'P';
  kindLabel: string;
  verifyDueOn: string | null;
  /** 02/10 */
  verifyDue: string | null;
  verifyDueLabel: string | null;
  /** Vérification d'efficacité attendue et dépassée. */
  verifyLate: boolean;
  efficacyNote: string | null;
  verifiedBy: string | null;
  closedOn: string | null;
  closedLabel: string | null;
  /** Annulation : date (AAAA-MM-JJ), libellé, auteur, motif. */
  cancelledOn: string | null;
  cancelledLabel: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  /** Preuves de réalisation ou d'efficacité (pièces jointes, entityType 'action'). */
  files: AttachmentItem[];
  history: ChangeEntry[];
};

const ALL_SITES_LABEL = 'Tous les sites';

// actionView remplace la clé d'origine par sa définition (libellé, icône) : on la retrouve par identité.
const originKey = (a: ActionView) => Object.entries(ORIGINS).find(([, o]) => o === a.origin)?.[0] ?? a.origin.label;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

type Context = Awaited<ReturnType<typeof loadContext>>;

function toPlanAction(a: ActionView, ctx: Context): PlanAction {
  const { people, sites, now } = ctx;
  const site = a.siteId ? sites.get(a.siteId) ?? a.siteId : ALL_SITES_LABEL;
  const src = ctx.sourcesOf(a);
  const cancelledOn = a.cancelledAt ? isoDay(a.cancelledAt) : null;
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    origin: { key: originKey(a), label: a.origin.label, icon: a.origin.icon },
    originRef: a.originRef,
    eventId: a.eventId,
    sources: src.sources,
    sourcesFallback: src.fallback,
    siteId: a.siteId,
    site,
    siteShort: site.split(' — ')[0],
    pilotId: a.pilotId,
    pilot: a.pilot,
    pilotInitials: a.pilotInitials,
    dueOn: a.dueOn,
    due: a.due,
    dueLabel: fmtDate(a.dueOn),
    late: a.late,
    lateDays: a.late ? daysBetween(a.dueOn, now) : 0,
    status: a.status as PlanAction['status'],
    col: a.col,
    statusLabel: a.statusLabel,
    tone: a.tone,
    kind: a.kind === 'P' ? 'P' : 'C',
    kindLabel: a.kindLabel,
    verifyDueOn: a.verifyDueOn,
    verifyDue: a.verifyDueOn ? fmtDayMonth(a.verifyDueOn) : null,
    verifyDueLabel: a.verifyDueOn ? fmtDate(a.verifyDueOn) : null,
    verifyLate: a.col === 'verify' && !!a.verifyDueOn && a.verifyDueOn < now,
    efficacyNote: a.efficacyNote,
    verifiedBy: a.verifiedById ? people.get(a.verifiedById)?.name ?? null : null,
    closedOn: a.closedOn,
    closedLabel: a.closedOn ? fmtDate(a.closedOn) : null,
    cancelledOn,
    cancelledLabel: cancelledOn ? fmtDate(cancelledOn) : null,
    cancelledBy: a.cancelledById ? people.get(a.cancelledById)?.name ?? null : null,
    cancelReason: a.cancelReason,
    files: ctx.files.get(a.id) ?? [],
    history: ctx.history.get(a.id) ?? [],
  };
}

async function loadContext() {
  const db = await getDb();
  const [people, actions, sites, links, session, files, events] = await Promise.all([
    loadPeople(), loadAllActions(),
    // Tous les sites, archivés compris : une action d'un site archivé garde son libellé (« Tous les sites » sélectionné).
    db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites),
    loadLinkSources(), getSession(),
    db.select().from(t.attachments).where(eq(t.attachments.entityType, 'action')),
    db.select({ id: t.events.id, title: t.events.title, declarantId: t.events.declarantId, anonymous: t.events.anonymous }).from(t.events),
  ]);
  const history = await loadChangeLogs('action', actions.map((a) => a.id));

  const filesOf = new Map<string, AttachmentItem[]>();
  files.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).forEach((r) => {
    filesOf.set(r.entityId, [...(filesOf.get(r.entityId) ?? []), toAttachmentItem(r, r.uploadedBy ? people.get(r.uploadedBy)?.name : undefined)]);
  });

  const eventTitles = new Map(events.map((e) => [e.id, e.title]));
  // Salarié : /evenements ne montre que ses propres signalements (non anonymes).
  const ownEvents = new Set(events.filter((e) => e.declarantId === session.user.id && !e.anonymous).map((e) => e.id));
  const enc = encodeURIComponent;

  /** Événement source : référence, titre et lien ; Salarié : simple référence pour un événement qu'il n'a pas déclaré. */
  const eventSource = (id: string): PlanSource => (isEmployee(session.role) && !ownEvents.has(id)
    ? { label: id, href: null }
    : { label: id, detail: eventTitles.get(id), href: `/evenements?sel=${enc(id)}` });

  /**
   * Lien déduit de la référence d'origine quand elle ne désigne pas de fiche source : événement saisi librement
   * (« EV-2026-131 ») sans événement lié, registre annuel des déchets. Les plans, permis, documents, filières et
   * enlèvements ne sont plus déduits du texte : ils sont rattachés par leur colonne (ACT-01, registre action-links).
   */
  const originSource = (key: string, ref: string): PlanSource | null => {
    const first = ref.split(/[\s·,]+/)[0] ?? '';
    if (EVENT_ORIGINS.includes(key)) {
      const id = eventTitles.has(ref) ? ref : eventTitles.has(first) ? first : null;
      if (id) return { ...eventSource(id), label: ref };
    }
    if (key === 'env') {
      const year = /^Registre des déchets (\d{4})$/.exec(ref)?.[1];
      if (year) return { label: ref, href: `/environnement?vue=bsd-manquants&annee=${year}` };
    }
    return null;
  };

  /**
   * Sources d'une action : événement lié, rattachements (registre action-links), référence d'origine, repli.
   * Chaque rattachement est listé, même s'il mène à la même page qu'un autre (décision de revue et sa revue) ;
   * la référence d'origine n'est ajoutée que si elle ne double pas une source déjà listée.
   */
  const sourcesOf = (a: ActionView): { sources: PlanSource[]; fallback: boolean } => {
    const key = originKey(a);
    const list: PlanSource[] = [];
    if (a.eventId) list.push(eventSource(a.eventId));
    // L'événement lié (type « event » du registre) est celui de a.eventId, déjà listé.
    // Source d'origine sur un écran fermé au rôle (plan de prévention pour le Salarié…) : référence seule, sans intitulé.
    const closed = new Set<PlanSource>();
    (links.get(a.id) ?? []).filter((s) => s.kind !== 'event').forEach((s) => {
      const source: PlanSource = { label: s.label, href: s.href, detail: s.detail, detachOnCancel: !ACTION_LINKS[s.kind]?.keptOnCancel };
      if (ACTION_LINKS[s.kind]?.origin && !canOpen(session.role, s.href)) closed.add(source);
      list.push(source);
    });
    const fromOrigin = originSource(key, a.originRef);
    const target = (s: PlanSource) => s.href ?? s.label;
    if (fromOrigin && !list.some((s) => target(s) === target(fromOrigin))) list.push(fromOrigin);
    const fallback = list.length === 0;
    if (fallback) list.push({ label: a.originRef, href: ORIGINS[key]?.path ?? null });
    const sources = list.map((s) => ({
      ...s, href: s.href && canOpen(session.role, s.href) ? s.href : null, ...(closed.has(s) ? { detail: undefined } : {}),
    }));
    return { sources, fallback };
  };

  return {
    people, actions, session, sourcesOf, files: filesOf, history,
    sites: new Map(sites.map((s) => [s.id, s.label])), now: today(),
  };
}

export type PlanScope = '' | 'historique' | 'annulees';

/**
 * Actions du site sélectionné (Salarié : celles dont il est pilote), selon le filtre d'affichage :
 * - '' (plan en cours) : ouvertes, et clôturées depuis moins de 30 jours (colonne « Clôturées · 30 j ») ;
 * - 'historique' : toutes les actions non annulées ;
 * - 'annulees' : les actions annulées, de la plus récemment annulée à la plus ancienne.
 * `counts` alimente les libellés du filtre.
 */
export async function loadActionPlan({ scope = '' }: { scope?: PlanScope } = {}) {
  const ctx = await loadContext();
  const { people, actions, session, now } = ctx;
  const recentCut = addDays(now, -30);
  const views = actions
    .filter((a) => !isEmployee(session.role) || a.pilotId === session.user.id)
    .map((a) => actionView(a, people, now));
  const recent = (a: ActionView) => a.col !== 'done' || (a.closedOn ?? a.dueOn) >= recentCut;
  const counts = {
    olderClosed: views.filter((a) => a.col !== 'cancelled' && !recent(a)).length,
    cancelled: views.filter((a) => a.col === 'cancelled').length,
  };
  const all = views
    .filter((a) => (scope === 'annulees' ? a.col === 'cancelled' : a.col !== 'cancelled' && (scope === 'historique' || recent(a))))
    .sort((a, b) => (scope === 'annulees' ? (b.cancelledAt?.getTime() ?? 0) - (a.cancelledAt?.getTime() ?? 0) : 0) || b.id.localeCompare(a.id, 'fr', { numeric: true }))
    .map((a) => toPlanAction(a, ctx));
  const pilots = [...new Map(all.map((a) => [a.pilotId, a.pilot])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  return { all, pilots, columns: ACTION_COLUMNS, now, counts };
}

/**
 * Action ouverte par lien direct (/actions?action=A-214), y compris une action annulée ou clôturée depuis plus de 30 jours.
 * `elsewhere` donne le site de l'action quand elle n'appartient pas au site sélectionné.
 * Salarié : une action dont il n'est pas pilote est traitée comme introuvable.
 */
export async function loadLinkedAction(id: string): Promise<{ action: PlanAction | null; elsewhere: string | null }> {
  const ctx = await loadContext();
  const { people, actions, sites, session, now } = ctx;
  const employee = isEmployee(session.role);
  const row = actions.find((a) => a.id === id);
  if (row) {
    if (employee && row.pilotId !== session.user.id) return { action: null, elsewhere: null };
    return { action: toPlanAction(actionView(row, people, now), ctx), elsewhere: null };
  }
  const db = await getDb();
  const [other] = await db.select({ siteId: t.actions.siteId, pilotId: t.actions.pilotId }).from(t.actions).where(eq(t.actions.id, id));
  // Action d'un site hors du périmètre : introuvable (aucune fuite de son site, SEC-02).
  if (!other || !inPerimeter(session.allowedSiteIds, other.siteId) || (employee && other.pilotId !== session.user.id)) return { action: null, elsewhere: null };
  return { action: null, elsewhere: other.siteId ? sites.get(other.siteId) ?? other.siteId : ALL_SITES_LABEL };
}

// ─── Filtres ────────────────────────────────────────────────────────────────

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('fr');

export type PlanFilter = { origin?: string; pilotId?: string; q?: string };

/** Filtres communs aux trois vues : origine, pilote, recherche (référence, titre, référence d'origine, motif d'annulation). */
export function filterPlan(all: PlanAction[], { origin, pilotId, q }: PlanFilter) {
  const needle = q ? fold(q) : '';
  return all.filter((a) =>
    (!origin || a.origin.key === origin)
    && (!pilotId || a.pilotId === pilotId)
    && (!needle || [a.id, a.title, a.originRef, a.cancelReason ?? ''].some((v) => fold(v).includes(needle))));
}

// ─── Échéances du domaine (tableau de bord, À faire, notifications, badge) ──

/**
 * Échéances du plan d'actions (actions annulées exclues par loadActions) :
 * actions en retard, actions à échéance sous 15 jours (hors celles portées par le programme d'audit),
 * vérifications d'efficacité à venir et dépassées (datées du jour, urgentes). Les vérifications concernent aussi
 * l'animateur QHSE, qui les mène. Tous les sites du périmètre (TDB-05) : siteId de l'action (null = tous les sites).
 */
export const loadActionSignals = cache(async (): Promise<{ badge?: number; todo: TodoItem[] }> => {
  const db = await getDb();
  const now = today();
  const horizon = addDays(now, TODO_HORIZON_DAYS);
  const inWindow = (d: string | null | undefined): d is string => !!d && d >= now && d <= horizon;
  const [actions, people, plan, leads] = await Promise.all([
    loadActions('perimeter'), loadPeople(), db.select({ actionId: t.auditPlanItems.actionId }).from(t.auditPlanItems), loadQhseLeads(),
  ]);
  const planActions = new Set(plan.map((p) => p.actionId).filter(Boolean));
  const todo: TodoItem[] = [];
  actions.forEach((a) => {
    const col = actionColumn(a, now);
    const base = { who: people.get(a.pilotId)?.name ?? '', href: `/actions?action=${a.id}`, ownerIds: [a.pilotId], siteId: a.siteId };
    // La vérification d'efficacité concerne aussi le responsable QHSE du site, qui la mène.
    const verify = { ...base, ownerIds: [...new Set([a.pilotId, ...leads.forSite(a.siteId).ownerIds])] };
    if (col === 'late') todo.push({ ...base, date: now, kind: 'Action en retard', tone: 'danger', overdue: true, title: `${a.id} · ${a.title} — échéance dépassée depuis le ${fmtDayMonth(a.dueOn)}` });
    if ((col === 'todo' || col === 'doing') && inWindow(a.dueOn) && !planActions.has(a.id)) todo.push({ ...base, date: a.dueOn, kind: 'Action', tone: 'accent', title: `${a.id} · ${a.title}` });
    if (col === 'verify' && inWindow(a.verifyDueOn)) todo.push({ ...verify, date: a.verifyDueOn, kind: 'Efficacité', tone: 'accent', title: `${a.eventId ?? a.originRef} · vérification d'efficacité de ${a.id}` });
    if (col === 'verify' && a.verifyDueOn && a.verifyDueOn < now) todo.push({ ...verify, date: now, kind: 'Efficacité', tone: 'danger', overdue: true, title: `${a.eventId ?? a.originRef} · vérification d'efficacité de ${a.id} — dépassée depuis le ${fmtDayMonth(a.verifyDueOn)}` });
  });
  return { todo };
});
