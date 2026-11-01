import 'server-only';
import { cache } from 'react';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { addActionBlocker } from '@/lib/rules/events';
import { entryRef } from '@/lib/rules/environment';
import { ACTION_LINKS, loadActionSources } from '../action-links';
import {
  SITE_TO_COMPLETE_LABEL, SOURCE_TO_COMPLETE, actionHref, isComplementaryLinkKind, actionLabel, actionRights, admissibleSources, canCreateAction, canReadAction,
  canReadPlan, compareActions, inPlanScope, isLate, isQhse, isToComplete, isVerificationDueSoon, isVerificationLate,
  matchesActionFilters, type ActionFilters, type LinkFacts,
} from '../action-rules';
import type {
  ActionCommentView, ActionDetailPayload, ActionDetailView, ActionFormOptions, ActionListItem, ActionTargetOption, LinkTargetOption, PlanSource,
} from '../action-view';
import { toAttachmentItem, type AttachmentItem } from '../attachments';
import { addDays, fmtDate, fmtDayMonth, fmtParisDateTime, parisDay } from '../dates';
import {
  ACTION_DOMAINS, ACTION_PRIORITIES, ACTION_RISK_LEVELS, ACTION_SOURCES, ALL_SITES, LEGACY_ORIGIN_LABELS, TODO_HORIZON_DAYS,
  VERIFY_METHODS, canOpen, canSee, canSeeHealth, isClosedActionStatus, isEmployee, isOpenAvancement, type TodoItem,
} from '../domain';
import type { Option } from '../form-options';
import { hasLeft, type Person } from '../people';
import { coactivityOriginHref } from '../origin-links';
import { actionView, loadActions, loadAllActions, loadPeople, type ActionRow } from '../queries';
import { getSession, inPerimeter, inSite, siteFilter, type Session } from '../session';
import { today } from '@/lib/today';
import { planItemState } from './audits';
import { loadChangeLogs } from './changelog';
import { loadQhseLeads } from './leads';
import { loadFormOptions } from './options';
import { entityVersion } from '@/server/versions';

// Plan d'actions QSE (docs/specs/actions-qse.md § 8, § 12, § 15.3, § 16 ; plan du paquet 1, flux C) :
//   - loadActionPlan(filters) : lignes de la vue générale (Liste, Kanban, Par responsable), jamais de fil, de preuves ni
//     d'historique (QUA-11) ; plan du site sélectionné pour qui le lit (QHSE, encadrement en lecture seule, ACT-22), plus
//     ses propres actions sur tous les sites (D19, TDB-05) ; le Salarié : ses actions seulement ;
//   - loadActionDetail(id) : fiche chargée à l'ouverture (?action=), avec fil, preuves, historique et droits du lecteur ;
//   - loadActionFormOptions / loadActionTargets : listes du formulaire, réservées au QHSE (seul à créer et modifier) ;
//   - loadActionSignals : échéances du § 15.3 (À faire, tableau de bord, cloche, badges), plus l'échéance du § 22.12 (D6).

const enc = encodeURIComponent;
const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const name = (people: Map<string, Person>, id: string | null | undefined) => (id ? people.get(id)?.name ?? id : null);
/** Libellé court d'un site (« Site de [Ville B] » pour « Site de [Ville B] — zone d'essais »). */
const shortSite = (label: string) => label.split(' — ')[0];

/** Site sélectionné, ou null pour « Tous les sites ». */
const selectedSite = (s: Session) => (s.site.id === ALL_SITES ? null : s.site.id);

/** Tous les sites, archivés compris : une action d'un site archivé garde son libellé. */
async function siteLabels() {
  const db = await getDb();
  return new Map((await db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites)).map((s) => [s.id, s.label]));
}

type ItemContext = { people: Map<string, Person>; sites: Map<string, string>; now: string; userId: string; selected: string | null };

/** Ligne de la vue générale (calculée : avancement affiché, retard, à compléter… ; rien n'est stocké). */
function listItem(a: ActionRow, ctx: ItemContext): ActionListItem {
  const v = actionView(a, ctx.people, ctx.now);
  const site = a.siteId ? ctx.sites.get(a.siteId) ?? a.siteId : SITE_TO_COMPLETE_LABEL;
  const pilot = ctx.people.get(a.pilotId);
  return {
    id: a.id, label: v.label, openedOn: a.openedOn, opened: fmtDate(a.openedOn),
    status: a.status, avancement: v.avancement, statusLabel: v.statusLabel, tone: v.tone,
    group: v.group, kanban: v.kanban, late: v.late, lateDays: v.lateDays, verifyLate: v.verifyLate,
    priority: a.priority, priorityLabel: a.priority ? ACTION_PRIORITIES[a.priority]?.label ?? null : null,
    domain: a.domain, domainLabel: a.domain ? ACTION_DOMAINS[a.domain] ?? null : null,
    source: a.source, sourceLabel: v.sourceDef?.label ?? SOURCE_TO_COMPLETE.label, sourceIcon: v.sourceDef?.icon ?? SOURCE_TO_COMPLETE.icon,
    originRef: a.originRef,
    siteId: a.siteId, site, siteShort: a.siteId ? shortSite(site) : site,
    pilotId: a.pilotId, pilot: v.pilot, pilotInitials: v.pilotInitials, pilotLeft: !!pilot && hasLeft(pilot, ctx.now),
    dueOn: a.dueOn, due: fmtDate(a.dueOn), initialDueOn: a.initialDueOn, rescheduled: a.initialDueOn !== a.dueOn,
    verifyDueOn: a.verifyDueOn, verifyDue: a.verifyDueOn ? fmtDate(a.verifyDueOn) : null,
    // Date de vérification : celle de la vérification en cours seulement (une ligne reprise rouverte garde l'ancienne, D17).
    doneOn: a.doneOn, closedOn: a.status === 'verifiee' ? a.closedOn : null,
    cancelledOn: a.cancelledAt ? parisDay(a.cancelledAt) : null, cancelReason: a.cancelReason,
    hours: a.hours, estimatedCost: a.estimatedCost, actualCost: a.actualCost,
    followsActionId: a.followsActionId, followReason: a.followReason,
    missing: [...v.missing], toComplete: v.toComplete,
    mine: a.pilotId === ctx.userId,
    elsewhere: !inSite(ctx.selected, a.siteId),
  };
}

// ─── Vue générale ───────────────────────────────────────────────────────────

/** Actions que la personne peut lire dans la vue générale (avant l'affichage ?etat= et les filtres). */
async function readableActions(session: Session): Promise<ActionRow[]> {
  const db = await getDb();
  // Ses propres actions, sur tous les sites (D19 : le responsable consulte ses actions quel que soit leur site).
  const own = await db.select().from(t.actions).where(eq(t.actions.pilotId, session.user.id));
  if (!canReadPlan(session.role)) return own;
  // Plan du site sélectionné (« Tous les sites » consolide le périmètre), plus ses actions des autres sites.
  const plan = await loadAllActions('site');
  const ids = new Set(plan.map((a) => a.id));
  return [...plan, ...own.filter((a) => !ids.has(a.id))];
}

const sum = (items: ActionListItem[], key: 'hours' | 'estimatedCost' | 'actualCost') =>
  Math.round(items.reduce((n, a) => n + (a[key] ?? 0), 0) * 100) / 100;

/**
 * Vue générale du plan d'actions (§ 16) : lignes lisibles par la personne, affichage `etat` (inPlanScope), filtres de l'URL
 * (matchesActionFilters), tri par défaut (compareActions : retards d'abord, puis date cible ; Abandonnées : les plus
 * récemment abandonnées d'abord).
 * - `responsables` : responsables des actions lisibles (Salarié : lui-même au plus, jamais la liste du personnel) ;
 * - `counts` : ouvertes et en retard (en-tête), actions de la personne (« Mes actions »), Abandonnées et Vérifiées de
 *   plus de 30 jours (libellés de l'affichage), actions à compléter de l'affichage courant (filtre « À compléter ») ;
 * - `totals` : pointage et coûts des actions affichées (pied de la vue Liste).
 */
export async function loadActionPlan(filters: ActionFilters) {
  const session = await getSession();
  const [rows, people, sites] = await Promise.all([readableActions(session), loadPeople(), siteLabels()]);
  const now = today();
  const ctx: ItemContext = { people, sites, now, userId: session.user.id, selected: selectedSite(session) };
  const all = rows.map((a) => listItem(a, ctx));
  const raw = new Map(rows.map((a) => [a.id, a]));
  const scoped = all.filter((a) => inPlanScope(a.status === 'verifiee' ? { ...a, closedOn: raw.get(a.id)!.closedOn } : a, filters.etat, now));
  const items = scoped
    .filter((a) => matchesActionFilters({ ...a, problem: raw.get(a.id)!.problem, detail: raw.get(a.id)!.detail }, filters, { userId: session.user.id, today: now }))
    .sort((a, b) => (filters.etat === 'abandonnees'
      ? (raw.get(b.id)!.cancelledAt?.getTime() ?? 0) - (raw.get(a.id)!.cancelledAt?.getTime() ?? 0)
      : 0) || compareActions(a, b, now));
  const responsables: Option[] = [...new Map(all.map((a) => [a.pilotId, a.pilot])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'fr'))
    .map(([id, label]) => [id, label] as const);
  const counts = {
    open: all.filter((a) => isOpenAvancement(a.status)).length,
    late: all.filter((a) => a.late).length,
    // « Mes actions » : actions de la personne dans l'affichage et les autres filtres (compteur de la puce).
    mine: scoped.filter((a) => a.mine && matchesActionFilters({ ...a, problem: raw.get(a.id)!.problem, detail: raw.get(a.id)!.detail }, { ...filters, responsable: null, mes: true }, { userId: session.user.id, today: now })).length,
    abandoned: all.filter((a) => a.status === 'abandonnee').length,
    olderVerified: rows.filter((a) => a.status === 'verifiee' && !inPlanScope(a, '', now)).length,
    toComplete: scoped.filter((a) => a.toComplete).length,
  };
  const totals = { hours: sum(items, 'hours'), estimatedCost: sum(items, 'estimatedCost'), actualCost: sum(items, 'actualCost') };
  return { items, responsables, counts, totals, now };
}

// ─── Listes du formulaire (QHSE seulement) ──────────────────────────────────

/**
 * Listes du formulaire d'action (§ 2.3 du plan) : personnel actif, sites inscriptibles (writableSites, jamais « Tous les
 * sites »), date du jour du serveur ; `targets` (sélecteur d'élément du plan) sur demande. Vides pour qui n'est pas QHSE :
 * seul le service QHSE crée et modifie une action (ACT-22, convention isReadOnly).
 */
export async function loadActionFormOptions(opts: { targets?: boolean } = {}): Promise<ActionFormOptions> {
  const session = await getSession();
  const now = today();
  if (!canCreateAction(session.role)) return { people: [], sites: [], today: now };
  const [options, targets] = await Promise.all([loadFormOptions(), opts.targets ? loadActionTargets() : null]);
  return { people: options.people, sites: options.sites, today: now, ...(targets ? { targets } : {}) };
}

const fmtReview = (iso: string) => `Revue de direction du ${fmtDate(iso)}`;

/**
 * Éléments proposés par le sélecteur du formulaire du plan (spec § 12, § 13 ; QHSE seulement, sinon liste vide) : éléments
 * du site sélectionné (« Tous les sites » : du périmètre) ou communs à l'entreprise, qui acceptent encore une action :
 * événements ouverts aux actions (ACT-07, addActionBlocker), constats non annulés (hors points forts) et éléments du
 * programme de l'année et de la précédente, risques en vigueur, contrôles actifs, exigences en vigueur, revues non closes et
 * leurs décisions, documents, filières et enlèvements de l'année et de la précédente ; jamais un élément d'un site archivé
 * ni le risque d'une unité de travail archivée. Un élément à action unique (élément du programme, exigence, contrôle,
 * décision) déjà porté par une action ouverte n'est pas proposé (il serait refusé) ; un constat, qui porte plusieurs actions
 * (AUD-28), l'est toujours. Chaque option porte le site de l'élément (null : élément commun, le QHSE choisit) et ses sources admises
 * (admissibleSources, D20 révisée) ; un élément qui ne permet aucune action QSE n'est jamais proposé.
 */
export const loadActionTargets = cache(async (): Promise<ActionTargetOption[]> => {
  const session = await getSession();
  if (!canCreateAction(session.role)) return [];
  const db = await getDb();
  const inScope = await siteFilter('site');
  // Élément d'un site archivé : jamais proposé (l'action prend le site de son élément, et un site archivé est refusé à la
  // création : requireInSite(…, { create: true })).
  const active = new Set(session.siteOptions.map((s) => s.id));
  const keep = (siteId: string | null) => inScope(siteId) && (!siteId || active.has(siteId));
  const year = Number(today().slice(0, 4));
  const [events, findings, planItems, risks, controls, requirements, reviews, decisions, documents, streams, entries, statuses] = await Promise.all([
    db.select({ id: t.events.id, title: t.events.title, type: t.events.type, step: t.events.step, dismissedAt: t.events.dismissedAt, siteId: t.events.siteId, occurredOn: t.events.occurredOn }).from(t.events),
    db.select({ id: t.auditFindings.id, audit: t.auditFindings.audit, clause: t.auditFindings.clause, text: t.auditFindings.text, kind: t.auditFindings.kind, planItemId: t.auditFindings.planItemId, cancelledAt: t.auditFindings.cancelledAt }).from(t.auditFindings).orderBy(asc(t.auditFindings.sort), asc(t.auditFindings.id)),
    db.select({ id: t.auditPlanItems.id, year: t.auditPlanItems.year, track: t.auditPlanItems.track, label: t.auditPlanItems.label, detail: t.auditPlanItems.detail, month: t.auditPlanItems.month, actionId: t.auditPlanItems.actionId, cancelledAt: t.auditPlanItems.cancelledAt }).from(t.auditPlanItems),
    db.select({ id: t.risks.id, hazard: t.risks.hazard, archivedAt: t.risks.archivedAt, unitArchivedAt: t.workUnits.archivedAt, unit: t.workUnits.label, siteId: t.workUnits.siteId, sort: t.risks.sort, unitSort: t.workUnits.sort })
      .from(t.risks).innerJoin(t.workUnits, eq(t.risks.unitId, t.workUnits.id)),
    db.select({ id: t.controls.id, equipment: t.controls.equipment, controlType: t.controls.controlType, siteId: t.controls.siteId, actionId: t.controls.actionId, archivedAt: t.controls.archivedAt }).from(t.controls).orderBy(asc(t.controls.sort)),
    db.select({ id: t.requirements.id, text: t.requirements.text, actionId: t.requirements.actionId, archivedAt: t.requirements.archivedAt }).from(t.requirements).orderBy(asc(t.requirements.sort)),
    db.select({ id: t.reviews.id, reviewOn: t.reviews.reviewOn, status: t.reviews.status }).from(t.reviews).orderBy(asc(t.reviews.reviewOn)),
    db.select({ id: t.reviewDecisions.id, reviewId: t.reviewDecisions.reviewId, kind: t.reviewDecisions.kind, text: t.reviewDecisions.text, actionId: t.reviewDecisions.actionId }).from(t.reviewDecisions).orderBy(asc(t.reviewDecisions.sort)),
    db.select({ id: t.documents.id, title: t.documents.title, siteId: t.documents.siteId }).from(t.documents).orderBy(asc(t.documents.id)),
    db.select({ id: t.wasteStreams.id, label: t.wasteStreams.label, siteId: t.wasteStreams.siteId }).from(t.wasteStreams).orderBy(asc(t.wasteStreams.id)),
    db.select({ id: t.wasteEntries.id, streamId: t.wasteEntries.streamId, removedOn: t.wasteEntries.removedOn, siteId: t.wasteEntries.siteId, cancelledAt: t.wasteEntries.cancelledAt }).from(t.wasteEntries),
    db.select({ id: t.actions.id, status: t.actions.status }).from(t.actions),
  ]);
  const openActions = new Set(statuses.filter((a) => !isClosedActionStatus(a.status)).map((a) => a.id));
  /** Élément à action unique encore libre (l'action qui le porte est close, ou aucune). */
  const free = (actionId: string | null) => !actionId || !openActions.has(actionId);
  const recent = (y: number) => y >= year - 1;
  const tracks = new Map(planItems.map((p) => [p.id, p.track]));
  const openReviews = new Map(reviews.filter((r) => r.status !== 'cloturee' && r.status !== 'annulee').map((r) => [r.id, r]));
  const streamLabels = new Map(streams.map((s) => [s.id, s.label]));

  const out: ActionTargetOption[] = [];
  const add = (kind: string, args: string | number, label: string, siteId: string | null, facts: LinkFacts = {}, extra: Partial<ActionTargetOption> = {}) => {
    const sources = admissibleSources(kind, facts);
    if (sources.length) out.push({ value: `${kind}:${args}`, label: clip(label), siteId, sources, ...extra });
  };
  events
    .filter((e) => addActionBlocker(e.step, !!e.dismissedAt) === null && keep(e.siteId))
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.id.localeCompare(a.id, 'fr', { numeric: true }))
    .forEach((e) => add('event', e.id, `${e.id} · ${e.title}`, e.siteId, { eventType: e.type }, e.type === 'AT' ? { healthWarning: true } : {}));
  findings
    // Un constat porte plusieurs actions (AUD-28) : proposé même s'il en porte déjà.
    .filter((f) => !f.cancelledAt && f.kind !== 'point_fort')
    .forEach((f) => add('finding', f.id, `Constat${f.clause ? ` ${f.clause}` : ''} · ${f.audit} — ${f.text}`, null, { track: f.planItemId ? tracks.get(f.planItemId) ?? null : null }));
  planItems
    .filter((p) => !p.cancelledAt && recent(p.year) && free(p.actionId))
    .sort((a, b) => a.year - b.year || a.month - b.month || a.id - b.id)
    .forEach((p) => add('plan', p.id, `Programme ${p.year} · ${p.detail ?? p.label}`, null, { track: p.track }));
  risks
    .filter((r) => !r.archivedAt && !r.unitArchivedAt && keep(r.siteId))
    .sort((a, b) => a.unitSort - b.unitSort || a.sort - b.sort)
    .forEach((r) => add('risk', r.id, `${r.unit} · ${r.hazard}`, r.siteId));
  controls
    .filter((c) => !c.archivedAt && keep(c.siteId) && free(c.actionId))
    .forEach((c) => add('control', c.id, `${c.controlType} · ${c.equipment}`, c.siteId));
  requirements
    .filter((r) => !r.archivedAt && free(r.actionId))
    .forEach((r) => add('requirement', r.id, `Exigence · ${r.text}`, null));
  [...openReviews.values()].forEach((r) => add('review', r.id, fmtReview(r.reviewOn), null));
  decisions
    .filter((d) => openReviews.has(d.reviewId) && free(d.actionId))
    .forEach((d) => add('reviewdecision', d.id, `Décision · ${fmtReview(openReviews.get(d.reviewId)!.reviewOn)} — ${d.text}`, null, { decisionKind: d.kind }, { reviewId: d.reviewId }));
  documents.filter((d) => keep(d.siteId)).forEach((d) => add('document', d.id, `${d.id} · ${d.title}`, d.siteId));
  streams.filter((s) => keep(s.siteId)).forEach((s) => add('wastestream', s.id, `${s.id} · ${s.label}`, s.siteId));
  entries
    .filter((e) => !e.cancelledAt && recent(Number(e.removedOn.slice(0, 4))) && keep(e.siteId))
    .sort((a, b) => b.removedOn.localeCompare(a.removedOn) || b.id - a.id)
    .forEach((e) => add('wasteentry', e.id, `${entryRef(e.streamId, e.removedOn)} · ${streamLabels.get(e.streamId) ?? e.streamId}`, e.siteId));
  return out;
});

// ─── Fiche ──────────────────────────────────────────────────────────────────

type Reader = { role: Session['role']; userId: string; restricted: boolean };

/**
 * Éléments liés affichés par la fiche : événement (event_id), rattachements du registre (src/lib/action-links.ts), sinon
 * la référence d'origine (avec le lien de l'événement qu'elle nomme, ou du registre annuel des déchets) ; protections :
 * - Salarié : un événement qu'il n'a pas déclaré (nominativement) → référence seule, sans intitulé ni lien ;
 * - source sur un écran fermé au rôle (canOpen) → référence seule, sans intitulé ni lien ;
 * - action de la personne hors de son périmètre (D19) → toutes les sources en référence seule : rien d'autre de ce site.
 */
async function sourcesOf(a: ActionRow, reader: Reader): Promise<PlanSource[]> {
  const db = await getDb();
  const links = await loadActionSources(a.id);
  const qhse = isQhse(reader.role);
  const first = a.originRef.split(/[\s·,]+/)[0] ?? '';
  const eventIds = [...new Set([a.eventId, a.originRef, first].filter((x): x is string => !!x))];
  const events = new Map((eventIds.length
    ? await db.select({ id: t.events.id, title: t.events.title, declarantId: t.events.declarantId, anonymous: t.events.anonymous }).from(t.events).where(inArray(t.events.id, eventIds))
    : []).map((e) => [e.id, e]));
  const employee = isEmployee(reader.role);
  const eventSource = (id: string, label = id): PlanSource => {
    const e = events.get(id);
    const own = !!e && e.declarantId === reader.userId && !e.anonymous;
    return !e || reader.restricted || (employee && !own)
      ? { kind: 'event', label, href: null }
      : { kind: 'event', label, detail: e.title, href: `/evenements?sel=${enc(id)}` };
  };

  const list: PlanSource[] = [];
  if (a.eventId) list.push(eventSource(a.eventId));
  // L'événement lié (type « event » du registre) est celui de event_id, déjà listé.
  for (const s of links) {
    if (s.kind === 'event') continue;
    const readable = !reader.restricted && canOpen(reader.role, s.href);
    list.push({
      kind: s.kind, label: s.label, href: readable ? s.href : null, ...(readable && s.detail ? { detail: s.detail } : {}),
      detachOnAbandon: !ACTION_LINKS[s.kind]?.keptOnCancel,
      // « Détacher » de la fiche (ACT-02) : lien complémentaire, QHSE seulement.
      ...(qhse && !reader.restricted && isComplementaryLinkKind(s.kind) ? { link: s.link } : {}),
    });
  }
  if (!list.length) {
    // Repli : référence d'origine (source sans fiche, action de suite d'un événement clos, reprise).
    const target = a.source ? ACTION_SOURCES[a.source]?.target : null;
    const eventId = events.has(a.originRef) ? a.originRef : events.has(first) ? first : null;
    const year = /^Registre des déchets (\d{4})$/.exec(a.originRef)?.[1];
    // ACT-12 : action reprise d'une situation de coactivité sans plan (« Coactivité JJ/MM/AAAA ») → carte du site à cette date.
    const coactivity = a.legacyOrigin === 'prevention' ? coactivityOriginHref(a.originRef, a.siteId) : null;
    if (eventId && (target === 'event' || (!a.source && (a.legacyOrigin === 'ev' || a.legacyOrigin === 'client')))) list.push(eventSource(eventId, a.originRef));
    else if (coactivity) list.push({ kind: 'reference', label: a.originRef, href: reader.restricted ? null : coactivity });
    else if (year && (a.source === 'dechets' || (!a.source && a.legacyOrigin === 'env'))) {
      list.push({ kind: 'reference', label: a.originRef, href: reader.restricted ? null : `/environnement?vue=bsd-manquants&annee=${year}` });
    } else {
      list.push({ kind: 'reference', label: a.originRef, href: reader.restricted || !a.source ? null : ACTION_SOURCES[a.source]?.path ?? null });
    }
  }
  return list.map((s) => (s.href && !canOpen(reader.role, s.href) ? { ...s, href: null, detail: undefined } : s));
}

/**
 * « Rattacher » de la fiche (ACT-02, QHSE) : liens complémentaires (COMPLEMENTARY_LINK_KINDS) que linkAction accepterait —
 * éléments du sélecteur du plan (loadActionTargets : site sélectionné ou commun, en vigueur, élément à action unique libre)
 * du site de l'action ou communs, plus les versions de document en révision (brouillon, en revue) libres ; jamais un
 * élément déjà lié à l'action, ni une autre revue que celle de l'action (AUD-12 : une action relève d'une seule revue).
 */
async function complementaryTargets(a: ActionRow, sources: PlanSource[]): Promise<LinkTargetOption[]> {
  const db = await getDb();
  const [targets, versions, statuses, decisionReviews] = await Promise.all([
    loadActionTargets(),
    db.select({ id: t.documentVersions.id, documentId: t.documentVersions.documentId, version: t.documentVersions.version, status: t.documentVersions.status, actionId: t.documentVersions.actionId, siteId: t.documents.siteId, title: t.documents.title })
      .from(t.documentVersions).innerJoin(t.documents, eq(t.documentVersions.documentId, t.documents.id)).orderBy(asc(t.documentVersions.documentId), asc(t.documentVersions.id)),
    db.select({ id: t.actions.id, status: t.actions.status }).from(t.actions),
    db.select({ reviewId: t.reviewDecisions.reviewId }).from(t.reviewDecisions).where(eq(t.reviewDecisions.actionId, a.id)),
  ]);
  const linked = new Set(sources.map((s) => s.link).filter(Boolean));
  const reviewId = a.reviewId ?? decisionReviews[0]?.reviewId ?? null;
  const open = new Set(statuses.filter((s) => !isClosedActionStatus(s.status)).map((s) => s.id));
  const keep = await siteFilter('site');
  const out: LinkTargetOption[] = [];
  for (const o of targets) {
    const kind = o.value.split(':')[0];
    if (!isComplementaryLinkKind(kind) || linked.has(o.value) || !inSite(o.siteId, a.siteId)) continue;
    if (kind === 'review' && reviewId != null) continue; // une seule revue par action (déjà rattachée)
    if (kind === 'reviewdecision' && reviewId != null && o.reviewId !== reviewId) continue;
    out.push({ value: o.value, label: o.label, kind });
  }
  for (const v of versions) {
    const value = `docversion:${v.id}`;
    if ((v.status !== 'brouillon' && v.status !== 'en_revue') || linked.has(value) || (v.actionId && open.has(v.actionId))) continue;
    if (!keep(v.siteId) || !inSite(v.siteId, a.siteId)) continue;
    out.push({ value, label: clip(`${v.documentId} · version ${v.version} (${v.status === 'brouillon' ? 'brouillon' : 'en revue'}) — ${v.title}`), kind: 'docversion' });
  }
  return out;
}

/** Nom d'une preuve jointe à un commentaire retiré, à la place du nom réel dans l'historique lu par qui n'est pas QHSE (D23). */
const WITHDRAWN_PROOF_NAME = '(preuve d’un commentaire retiré)';

/**
 * Fiche d'une action (?action=A-214), y compris abandonnée ou vérifiée depuis plus de 30 jours. Règles :
 * - sa propre action (responsable) : lisible quel que soit son site (D19) ; `rights.elsewhere` nomme son site quand il
 *   diffère du site sélectionné (écritures du QHSE refusées par requireInSite) ;
 * - sinon (QHSE, encadrement en lecture) : action du site sélectionné ; d'un autre site du périmètre : pas de fiche,
 *   `elsewhere` = libellé du site (« sélectionnez ce site ») ; hors périmètre : introuvable, son site n'est jamais nommé
 *   (SEC-02) ; Salarié : ses actions seulement ;
 * - fil de cette action seulement : texte d'un commentaire retiré jamais renvoyé (ni même lu), ses preuves au QHSE seulement,
 *   signalées (D23) ; preuves de cette action ; historique (sans donnée de santé : aucune n'est portée par une action ;
 *   le nom d'une preuve d'un commentaire retiré y est masqué à qui n'est pas QHSE) ;
 * - vérification (méthode, constat, résultat, vérificateur, date) seulement à l'état Vérifiée ; ancien constat d'une ligne
 *   reprise non Vérifiée en `previousVerification` (D17) ;
 * - `healthWarning` (événement lié de type AT) calculé pour le QHSE seulement : jamais la nature de l'événement d'un collègue.
 */
export const loadActionDetail = cache(async (id: string): Promise<{ payload: ActionDetailPayload | null; elsewhere: string | null }> => {
  const none = { payload: null, elsewhere: null };
  const session = await getSession();
  const { role, user, allowedSiteIds } = session;
  if (!canSee(role, 'actions')) return none;
  const db = await getDb();
  const [a] = await db.select().from(t.actions).where(eq(t.actions.id, id));
  if (!a) return none;
  const own = a.pilotId === user.id;
  if (!canReadAction(role, user.id, a, allowedSiteIds)) return none;
  const [people, sites] = await Promise.all([loadPeople(), siteLabels()]);
  const selected = selectedSite(session);
  const siteLabel = a.siteId ? sites.get(a.siteId) ?? a.siteId : SITE_TO_COMPLETE_LABEL;
  const here = inSite(selected, a.siteId);
  // Action d'un autre site du périmètre (hors les siennes) : pas de fiche, son site est nommé pour le sélectionner.
  if (!own && !here) return { payload: null, elsewhere: siteLabel };

  const qhse = isQhse(role);
  const now = today();
  const ctx: ItemContext = { people, sites, now, userId: user.id, selected };
  const reader: Reader = { role, userId: user.id, restricted: !inPerimeter(allowedSiteIds, a.siteId) };

  const [sources, commentRows, fileRows, history, followUpRows, predecessor, event] = await Promise.all([
    sourcesOf(a, reader),
    db.select({
      id: t.actionComments.id, authorId: t.actionComments.authorId, authorRole: t.actionComments.authorRole, createdAt: t.actionComments.createdAt,
      // Texte d'un commentaire retiré : jamais lu (D23), donc jamais renvoyé.
      body: sql<string | null>`case when ${t.actionComments.withdrawnAt} is null then ${t.actionComments.body} end`,
      withdrawnAt: t.actionComments.withdrawnAt, withdrawnById: t.actionComments.withdrawnById, withdrawReason: t.actionComments.withdrawReason,
    }).from(t.actionComments).where(eq(t.actionComments.actionId, a.id)).orderBy(asc(t.actionComments.createdAt), asc(t.actionComments.id)),
    db.select().from(t.attachments).where(sql`${t.attachments.entityType} = 'action' and ${t.attachments.entityId} = ${a.id}`)
      .orderBy(asc(t.attachments.createdAt), asc(t.attachments.id)),
    loadChangeLogs('action', [a.id]),
    db.select().from(t.actions).where(eq(t.actions.followsActionId, a.id)).orderBy(asc(t.actions.createdAt), asc(t.actions.id)),
    a.followsActionId ? db.select().from(t.actions).where(eq(t.actions.id, a.followsActionId)).then((r) => r[0]) : undefined,
    qhse && a.eventId ? db.select({ type: t.events.type }).from(t.events).where(eq(t.events.id, a.eventId)).then((r) => r[0]) : undefined,
  ]);

  // Preuves visibles du lecteur : celles d'un commentaire retiré au QHSE seulement, signalées (D23) ; pièce médicale : jamais.
  const withdrawn = new Set(commentRows.filter((c) => c.withdrawnAt).map((c) => c.id));
  const visibleFiles = fileRows.filter((f) => (!f.health || canSeeHealth(role)) && (qhse || f.commentId == null || !withdrawn.has(f.commentId)));
  const files: AttachmentItem[] = visibleFiles.map((f) => toAttachmentItem(f, name(people, f.uploadedBy) ?? undefined, { commentWithdrawn: f.commentId != null && withdrawn.has(f.commentId) }));
  const comments: ActionCommentView[] = commentRows.map((c) => ({
    id: c.id, authorId: c.authorId, author: name(people, c.authorId) ?? c.authorId, authorRole: c.authorRole, byResponsible: c.authorId === a.pilotId,
    at: c.createdAt.toISOString(), atLabel: fmtParisDateTime(c.createdAt),
    body: c.withdrawnAt ? null : c.body,
    withdrawn: c.withdrawnAt ? { atLabel: fmtParisDateTime(c.withdrawnAt), by: name(people, c.withdrawnById) ?? '—', reason: c.withdrawReason ?? '' } : null,
    files: files.filter((f) => f.commentId === c.id),
  }));
  const hiddenNames = qhse ? new Set<string>() : new Set(fileRows.filter((f) => f.commentId != null && withdrawn.has(f.commentId)).map((f) => f.fileName));
  const entries = (history.get(a.id) ?? []).map((e) => (e.action === 'attach' && hiddenNames.size
    ? { ...e, details: e.details.map((d) => (d.to && hiddenNames.has(d.to) ? { ...d, to: WITHDRAWN_PROOF_NAME } : d)) }
    : e));

  const verified = a.status === 'verifiee';
  const readable = (r: ActionRow) => canReadAction(role, user.id, r, allowedSiteIds);
  const detail: ActionDetailView = {
    ...listItem(a, ctx),
    version: await entityVersion(await getDb(), 'action', a.id),
    problem: a.problem, detail: a.detail,
    riskLevel: a.riskLevel, riskLevelLabel: a.riskLevel != null ? ACTION_RISK_LEVELS[a.riskLevel] ?? null : null,
    verifyMethod: verified ? a.verifyMethod : null, verifyMethodLabel: verified && a.verifyMethod ? VERIFY_METHODS[a.verifyMethod] ?? null : null,
    efficacyNote: verified ? a.efficacyNote : null, effective: verified ? a.effective : null, newRisk: verified && a.newRisk,
    verifiedById: verified ? a.verifiedById : null, verifiedBy: verified ? name(people, a.verifiedById) : null,
    previousVerification: !verified && a.efficacyNote?.trim() ? { note: a.efficacyNote, by: name(people, a.verifiedById) } : null,
    cancelledBy: name(people, a.cancelledById),
    legacyOriginLabel: a.source === null && a.legacyOrigin ? LEGACY_ORIGIN_LABELS[a.legacyOrigin] ?? a.legacyOrigin : null,
    eventId: a.eventId, sources,
    // Action précédente : son libellé seulement si le lecteur peut la lire (sinon le numéro seul, déjà cité par le problème).
    follows: a.followsActionId && a.followReason
      ? { id: a.followsActionId, label: predecessor && readable(predecessor) ? actionLabel(predecessor.detail) : '', reason: a.followReason }
      : null,
    followUps: followUpRows.filter((f) => f.followReason && readable(f)).map((f) => {
      const v = actionView(f, people, now);
      return { id: f.id, label: v.label, reason: f.followReason!, statusLabel: v.statusLabel, tone: v.tone };
    }),
    comments, files, history: entries, linkTargets: [],
    healthWarning: qhse && event?.type === 'AT',
  };
  const elsewhere = here ? null : siteLabel;
  const rights = actionRights(role, user.id, a, { elsewhere });
  detail.linkTargets = rights.canLink && !elsewhere ? await complementaryTargets(a, sources) : [];
  return { payload: { detail, rights }, elsewhere: null };
});

// ─── Échéances du domaine (tableau de bord, À faire, notifications, badges) ──

/** Type des échéances de vérification d'efficacité (§ 15.3). */
const VERIFY_KIND = "Vérification d'efficacité";
/** Type de l'échéance groupée des actions à compléter (§ 15.3, D8). */
export const TO_COMPLETE_KIND = 'Actions à compléter';
/** Lien de l'échéance « à compléter » : filtre ?completer=1 sur l'historique complet. */
export const TO_COMPLETE_HREF = '/actions?completer=1&etat=historique';
/** Type de l'échéance du § 22.12 (D6) : action de suite d'un événement qui n'accepte plus d'action. */
export const CLOSED_EVENT_KIND = 'Événement clos — action de suite ouverte';

/**
 * Échéances du plan d'actions (§ 15.3), sur tout le périmètre (TDB-05), portant le site de l'action (null : site à
 * compléter) ; Reportée et Abandonnée n'en produisent aucune :
 * - « Action en retard » (isLate) et « Action » à échéance sous 15 jours (avancement ouvert ; actions portées par le
 *   programme d'audit exclues, comme avant) : responsable de l'action ; retard d'une action portée par un élément du
 *   programme lui-même en retard « à confirmer » : signalé par cet élément seul (AUD-18, loadAuditSignals), qui ajoute le
 *   responsable de l'action à ses destinataires ;
 * - « Vérification d'efficacité » à venir sous 15 jours et dépassée (Terminée) : responsable QHSE du site seulement
 *   (loadQhseLeads, ACT-14), pas le responsable de l'action, qui ne peut pas la faire ;
 * - « Actions à compléter » (champs obligatoires manquants, D8) : une échéance par site, au responsable QHSE du site, clé
 *   portant le nombre (elle réapparaît non lue quand il change) ;
 * - § 22.12 (D6) : action de suite non close, sans événement lié, dont l'action précédente (ou la première de la chaîne qui
 *   en a un) porte un événement qui n'accepte plus d'action (addActionBlocker) : « décider d'une réouverture », au
 *   responsable QHSE du site de l'événement, lien vers l'événement.
 * Intitulés : numéro, puis libellé court (actionLabel) ; jamais de donnée de santé (aucune n'est portée par une action).
 */
export const loadActionSignals = cache(async (): Promise<{ badge?: number; todo: TodoItem[] }> => {
  const db = await getDb();
  const now = today();
  const horizon = addDays(now, TODO_HORIZON_DAYS);
  const [actions, people, plan, leads, chain] = await Promise.all([
    loadActions('perimeter'), loadPeople(),
    db.select({
      actionId: t.auditPlanItems.actionId, year: t.auditPlanItems.year, month: t.auditPlanItems.month, label: t.auditPlanItems.label,
      detail: t.auditPlanItems.detail, plannedOn: t.auditPlanItems.plannedOn, done: t.auditPlanItems.done, doneOn: t.auditPlanItems.doneOn,
      cancelledAt: t.auditPlanItems.cancelledAt, reviewId: t.auditPlanItems.reviewId,
    }).from(t.auditPlanItems),
    loadQhseLeads(),
    db.select({ id: t.actions.id, eventId: t.actions.eventId, followsActionId: t.actions.followsActionId }).from(t.actions),
  ]);
  const planActions = new Set(plan.map((p) => p.actionId).filter(Boolean));
  // AUD-18 : actions portées par un élément du programme en retard « à confirmer » (ni annulé, ni rattaché à une revue).
  const lateCarried = new Set(plan.filter((p) => p.actionId && p.reviewId == null && planItemState(p, now) === 'late').map((p) => p.actionId));
  const links = new Map(chain.map((r) => [r.id, r]));
  /** Événement de la première action de la chaîne des précédentes qui en porte un (au plus 20 maillons). */
  const ancestorEvent = (id: string | null): string | null => {
    for (let i = 0, cur = id; cur && i < 20; i++) {
      const r = links.get(cur);
      if (!r) return null;
      if (r.eventId) return r.eventId;
      cur = r.followsActionId;
    }
    return null;
  };
  const followUps = actions.filter((a) => a.status !== 'reportee' && a.followsActionId && !a.eventId && !isClosedActionStatus(a.status))
    .map((a) => ({ a, eventId: ancestorEvent(a.followsActionId) }))
    .filter((f): f is { a: ActionRow; eventId: string } => !!f.eventId);
  const events = new Map((followUps.length
    ? await db.select({ id: t.events.id, siteId: t.events.siteId, step: t.events.step, dismissedAt: t.events.dismissedAt }).from(t.events)
      .where(inArray(t.events.id, [...new Set(followUps.map((f) => f.eventId))]))
    : []).map((e) => [e.id, e]));

  const todo: TodoItem[] = [];
  const toComplete = new Map<string | null, number>();
  for (const a of actions) {
    if (a.status === 'reportee') continue; // Reportée : aucune échéance (§ 15.3)
    const label = actionLabel(a.detail);
    const href = actionHref(a.id);
    const pilot = { who: people.get(a.pilotId)?.name ?? '', href, ownerIds: [a.pilotId], siteId: a.siteId };
    const qhse = leads.forSite(a.siteId);
    const lead = { who: qhse.who, href, ownerIds: qhse.ownerIds, siteId: a.siteId };
    if (isLate(a, now) && !lateCarried.has(a.id)) {
      todo.push({ ...pilot, date: now, dueOn: a.dueOn, kind: 'Action en retard', tone: 'danger', overdue: true, title: `${a.id} · ${label} — échéance dépassée depuis le ${fmtDayMonth(a.dueOn)}` });
    } else if (isOpenAvancement(a.status) && a.dueOn >= now && a.dueOn <= horizon && !planActions.has(a.id)) {
      todo.push({ ...pilot, date: a.dueOn, dueOn: a.dueOn, kind: 'Action', tone: 'accent', title: `${a.id} · ${label}` });
    }
    if (isVerificationDueSoon(a, now)) {
      todo.push({ ...lead, date: a.verifyDueOn!, dueOn: a.verifyDueOn!, kind: VERIFY_KIND, tone: 'accent', title: `${a.id} · ${label} — vérification d'efficacité` });
    }
    if (isVerificationLate(a, now)) {
      todo.push({ ...lead, date: now, dueOn: a.verifyDueOn!, kind: VERIFY_KIND, tone: 'danger', overdue: true, title: `${a.id} · ${label} — vérification d'efficacité dépassée depuis le ${fmtDayMonth(a.verifyDueOn!)}` });
    }
    if (isToComplete(a)) toComplete.set(a.siteId, (toComplete.get(a.siteId) ?? 0) + 1);
  }
  for (const [siteId, n] of toComplete) {
    const r = leads.forSite(siteId);
    todo.push({
      date: now, kind: TO_COMPLETE_KIND, tone: 'warn', siteId, who: r.who, ownerIds: r.ownerIds, href: TO_COMPLETE_HREF, count: n,
      key: `${TO_COMPLETE_KIND}|${siteId ?? 'sans-site'}|${n}`,
      title: `Plan d'actions · ${n} action${n > 1 ? 's' : ''} à compléter (champs obligatoires manquants)`,
    });
  }
  for (const { a, eventId } of followUps) {
    const ev = events.get(eventId);
    if (!ev || addActionBlocker(ev.step, !!ev.dismissedAt) === null) continue;
    const r = leads.forSite(ev.siteId);
    todo.push({
      date: now, kind: CLOSED_EVENT_KIND, tone: 'warn', siteId: ev.siteId, who: r.who, ownerIds: r.ownerIds, href: `/evenements?sel=${enc(ev.id)}`,
      title: `${ev.id} · action de suite ${a.id} — décider d'une réouverture`,
    });
  }
  return { todo };
});
