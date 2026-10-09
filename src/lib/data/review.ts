import 'server-only';
import { cache } from 'react';
import { asc, desc, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { addDays, addMonths, fmtDate, fmtDayMonth, today, yearOf } from '../dates';
import {
  EVENT_STEPS, EVENT_TYPES, EVENT_TYPE_KEYS, FINDING_KINDS, NC_ORIGINS, ORIGINS, PLAN_ITEM_STATES, QHSE_LEAD, REQUIREMENT_EVAL, REVIEW_AUTO_OWNER,
  REVIEW_CLOSE_DAYS, REVIEW_DECISION_KINDS, REVIEW_KINDS, REVIEW_SOURCES, REVIEW_STATUS, RISK_ACTION_THRESHOLD, ROLES, TODO_HORIZON_DAYS,
  canApprove, canManage, canSee, isOpenActionStatus, type PlanItemState, type ReviewDecisionKind, type ReviewKind, type ReviewSource,
  type ReviewStatus, type TodoItem, type Tone,
} from '../domain';
import {
  actionBrief, actionColumn, certificationStatus, controlStatus, isOpen, loadActions, loadAllActions, loadControls, loadEvents, loadPeople,
  type ActionBrief, type ActionRow, type Person,
} from '../queries';
import { currentSiteId, getSession, inSite } from '../session';
import { planItemAuditLabel } from './audits';
import { loadChangeLog } from './changelog';
import { TF1_TARGET, loadDashboard } from './dashboard';
import { loadDocuments } from './documents';
import { loadEnvironment } from './environment';
import { loadFormOptions } from './options';
import { loadPrevention, loadPreventionSignals } from './prevention';
import { loadRisks } from './risks';
import { loadSkillMatrix, type SkillAlert } from './skills';

// ─── Revue de direction (ISO 9001 §9.3) ─────────────────────────────────────

export type Review = typeof t.reviews.$inferSelect;
export type ReviewItemRow = typeof t.reviewItems.$inferSelect;
export type ReviewDecisionRow = typeof t.reviewDecisions.$inferSelect;

/** Contenu de reviews.snapshot : dossier figé à la clôture (visa de la direction), jamais modifié ensuite. */
export type ReviewSnapshot = { version: 1; takenOn: string; takenBy: string; dossier: ReviewDossier };

/** Lecture défensive de reviews.snapshot (null pour les revues antérieures à Vigie ou un format inconnu). */
export function parseReviewSnapshot(raw: unknown): ReviewSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<ReviewSnapshot>;
  if (s.version !== 1 || !s.dossier || typeof s.dossier !== 'object') return null;
  return { version: 1, takenOn: typeof s.takenOn === 'string' ? s.takenOn : '', takenBy: typeof s.takenBy === 'string' ? s.takenBy : '', dossier: s.dossier };
}

/** Toutes les revues, la plus récente d'abord (annulées comprises). */
export const loadReviews = cache(async () => {
  const db = await getDb();
  return db.select().from(t.reviews).orderBy(desc(t.reviews.reviewOn), desc(t.reviews.id));
});

const isCancelled = (r: Pick<Review, 'status'>) => r.status === 'annulee';
/** Préparation ou compte rendu encore modifiables. */
export const isEditableReview = (r: Pick<Review, 'status'>) => r.status === 'planifiee' || r.status === 'tenue';
const reviewLabel = (r: Pick<Review, 'reviewOn'>) => `Revue du ${fmtDate(r.reviewOn)}`;

/**
 * Revue affichée : `?revue=<id>` si valide ; sinon la plus ancienne revue planifiée (compte rendu en retard,
 * puis prochaine à venir), sinon la dernière tenue, sinon la dernière non annulée.
 */
export function pickReview(reviews: Review[], param: string | string[] | undefined, now: string): Review | null {
  const asked = typeof param === 'string' && /^\d+$/.test(param) ? reviews.find((r) => r.id === +param) : undefined;
  if (asked) return asked;
  const planned = reviews.filter((r) => r.status === 'planifiee').sort((a, b) => a.reviewOn.localeCompare(b.reviewOn));
  return planned.find((r) => r.reviewOn < now) ?? planned.find((r) => r.reviewOn >= now)
    ?? reviews.find((r) => r.status === 'tenue') ?? reviews.find((r) => !isCancelled(r)) ?? null;
}

/** Revues tenues ou clôturées antérieures à `cur`, la plus récente d'abord. */
export const priorReviews = (reviews: Review[], cur: Pick<Review, 'reviewOn'>) =>
  reviews.filter((r) => (r.status === 'tenue' || r.status === 'cloturee') && r.reviewOn < cur.reviewOn).sort((a, b) => b.reviewOn.localeCompare(a.reviewOn));

/** Revue suivante : première revue non annulée datée après `cur` (prévue au compte rendu ou par « Préparer la prochaine revue »). */
export const followingReview = (reviews: Review[], cur: Pick<Review, 'id' | 'reviewOn'>): Review | undefined =>
  reviews.filter((r) => !isCancelled(r) && r.id !== cur.id && r.reviewOn > cur.reviewOn).sort((a, b) => a.reviewOn.localeCompare(b.reviewOn))[0];

/**
 * Actions par revue, d'après le seul rattachement actions.reviewId : une action détachée (« Détacher ») ne revient
 * pas par sa référence d'origine. Les actions antérieures au rattachement sont reprises une fois pour toutes par la
 * migration (drizzle/0002_traceability.sql).
 */
export function reviewActions(actions: ActionRow[]) {
  const map = new Map<number, ActionRow[]>();
  actions.forEach((a) => {
    if (a.reviewId != null) map.set(a.reviewId, [...(map.get(a.reviewId) ?? []), a]);
  });
  return map;
}

// ─── Éléments d'entrée « Vigie · automatique » ──────────────────────────────

/** Les données de chaque source automatique existent-elles ? (12 mois glissants, site sélectionné.) */
const loadAutoData = cache(async () => {
  const db = await getDb();
  const now = today();
  const from = addDays(now, -364);
  const [site, events, controls, skills, hours, plan, findings, reqs, duerp, plans, permits, docs, waste] = await Promise.all([
    currentSiteId(), loadEvents(), loadControls(), loadSkillMatrix(),
    db.select().from(t.hoursWorked),
    db.select().from(t.auditPlanItems),
    db.select({ id: t.auditFindings.id }).from(t.auditFindings).where(isNull(t.auditFindings.cancelledAt)),
    db.select({ lastEvaluatedOn: t.requirements.lastEvaluatedOn, archivedAt: t.requirements.archivedAt }).from(t.requirements),
    db.select({ current: t.duerpVersions.current }).from(t.duerpVersions),
    db.select({ siteId: t.preventionPlans.siteId }).from(t.preventionPlans),
    db.select({ siteId: t.permits.siteId }).from(t.permits),
    db.select({ siteId: t.documents.siteId }).from(t.documents),
    db.select({ siteId: t.wasteEntries.siteId, removedOn: t.wasteEntries.removedOn, cancelledAt: t.wasteEntries.cancelledAt }).from(t.wasteEntries),
  ]);
  const inPeriod = (p: (typeof plan)[number]) => {
    const on = p.plannedOn ?? `${p.year}-${String(p.month).padStart(2, '0')}-15`;
    return on >= from && on <= now;
  };
  const events12 = events.some((e) => e.occurredOn >= from);
  const ready: Record<Exclude<ReviewSource, 'manuel' | 'actions'>, boolean> = {
    safety: hours.some((h) => inSite(site, h.siteId) && h.month > from.slice(0, 7)),
    events: events12,
    complaints: events12,
    suppliers: plan.some((p) => p.track === 'Fournisseurs' && inPeriod(p)) || events.some((e) => e.type === 'NC' && e.ncOrigin === 'Fournisseurs'),
    audits: plan.some((p) => p.done && inPeriod(p)) || findings.length > 0,
    watch: reqs.some((r) => !r.archivedAt && !!r.lastEvaluatedOn) || controls.length > 0,
    risks: duerp.some((v) => v.current),
    prevention: plans.some((p) => inSite(site, p.siteId)) || permits.some((p) => inSite(site, p.siteId)),
    documents: docs.some((d) => inSite(site, d.siteId)),
    environment: waste.some((w) => !w.cancelledAt && inSite(site, w.siteId) && yearOf(w.removedOn) === yearOf(now)),
    skills: skills.rows.length > 0,
  };
  return ready;
});

/** État « fourni » de chaque source automatique ; `actions` : une revue antérieure tenue existe. */
export async function autoReady(hasPrior: boolean): Promise<Record<ReviewSource, boolean>> {
  return { manuel: false, actions: hasPrior, ...(await loadAutoData()) };
}

export type ReviewItemView = {
  id: number; label: string; source: ReviewSource; sourceLabel: string; auto: boolean; done: boolean;
  ownerId: string | null; owner: string; ownerLabel: string; dueOn: string | null; late: boolean; sort: number;
};

const sourceOf = (s: string): ReviewSource => (s in REVIEW_SOURCES ? (s as ReviewSource) : 'manuel');

/** Élément de check-list : état calculé pour une source automatique, contributeur et date de remise sinon. */
export function itemView(row: ReviewItemRow, ready: Record<ReviewSource, boolean>, people: Map<string, Person>, now: string): ReviewItemView {
  const source = sourceOf(row.source);
  const auto = REVIEW_SOURCES[source].auto;
  const done = auto ? ready[source] : row.done;
  const who = auto ? REVIEW_AUTO_OWNER : (row.ownerId ? people.get(row.ownerId)?.name : null) ?? (row.owner || '—');
  return {
    id: row.id, label: row.label, source, sourceLabel: REVIEW_SOURCES[source].label, auto, done,
    ownerId: row.ownerId, owner: row.owner, dueOn: row.dueOn, sort: row.sort,
    ownerLabel: row.dueOn && !auto ? `${who} · ${fmtDayMonth(row.dueOn)}` : who,
    late: !auto && !done && !!row.dueOn && row.dueOn < now,
  };
}

// ─── Vues communes (carte /audits, dossier) ─────────────────────────────────

const kindOf = (k: string) => REVIEW_KINDS[k as ReviewKind] ?? REVIEW_KINDS.ordinaire;
const statusOf = (s: string) => REVIEW_STATUS[s as ReviewStatus] ?? REVIEW_STATUS.planifiee;
const participantIdsOf = (r: Review) => (Array.isArray(r.participantIds) ? (r.participantIds as unknown[]).filter((x): x is string => typeof x === 'string') : []);

function reviewView(r: Review, people: Map<string, Person>) {
  const name = (id: string | null) => (id ? people.get(id)?.name ?? id : null);
  const ids = participantIdsOf(r);
  return {
    id: r.id, reviewOn: r.reviewOn, kind: r.kind as ReviewKind, kindLabel: kindOf(r.kind).label, kindShort: kindOf(r.kind).short,
    status: r.status as ReviewStatus, statusLabel: statusOf(r.status).label, statusTone: statusOf(r.status).tone,
    participantIds: ids, participants: ids.map((id) => name(id) ?? id),
    externalParticipants: r.externalParticipants, customerPerception: r.customerPerception, resourceNeeds: r.resourceNeeds, minutes: r.minutes,
    nextReviewOn: r.nextReviewOn, recordedBy: name(r.recordedById), closedOn: r.closedOn, closedBy: name(r.closedById),
    cancelledOn: r.cancelledAt ? r.cancelledAt.toISOString().slice(0, 10) : null, cancelledBy: name(r.cancelledById), cancelReason: r.cancelReason,
    hasSnapshot: !!parseReviewSnapshot(r.snapshot),
  };
}
export type ReviewView = ReturnType<typeof reviewView>;

const historyRow = (r: Review) => ({
  id: r.id, reviewOn: r.reviewOn, kindShort: kindOf(r.kind).short, statusLabel: statusOf(r.status).label, statusTone: statusOf(r.status).tone,
  cancelled: isCancelled(r), cancelReason: r.cancelReason,
});
export type ReviewHistoryRow = ReturnType<typeof historyRow>;

export type DecisionView = {
  id: number; kind: ReviewDecisionKind; kindLabel: string; tone: Tone; text: string; pilotId: string | null; pilot: string;
  dueOn: string | null; actionId: string | null; action: ActionBrief | null; sort: number;
};

/** Préparation, décisions et actions d'une revue (partagé par la carte et le dossier). */
async function readReviewRecord(review: Review, reviews: Review[]) {
  const db = await getDb();
  const now = today();
  const [people, items, decisionRows, actions, allActions] = await Promise.all([
    loadPeople(),
    db.select().from(t.reviewItems).orderBy(asc(t.reviewItems.sort), asc(t.reviewItems.id)),
    db.select().from(t.reviewDecisions).orderBy(asc(t.reviewDecisions.sort), asc(t.reviewDecisions.id)),
    loadActions(),
    loadAllActions(),
  ]);
  const prior = priorReviews(reviews, review);
  const ready = await autoReady(prior.length > 0);
  const byAction = new Map(allActions.map((a) => [a.id, a]));
  const decisions: DecisionView[] = decisionRows.filter((d) => d.reviewId === review.id).map((d) => {
    const k = REVIEW_DECISION_KINDS[d.kind as ReviewDecisionKind] ?? REVIEW_DECISION_KINDS.decision;
    return {
      id: d.id, kind: d.kind as ReviewDecisionKind, kindLabel: k.label, tone: k.tone, text: d.text, pilotId: d.pilotId,
      pilot: d.pilotId ? people.get(d.pilotId)?.name ?? '—' : '—', dueOn: d.dueOn, actionId: d.actionId,
      action: d.actionId ? actionBrief(byAction.get(d.actionId), people, now) : null, sort: d.sort,
    };
  });
  const linked = new Set(decisions.map((d) => d.actionId).filter(Boolean));
  const extraActions = (reviewActions(actions).get(review.id) ?? [])
    .filter((a) => !linked.has(a.id))
    .map((a) => ({ ...actionBrief(a, people, now)!, href: `/actions?action=${encodeURIComponent(a.id)}` }))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  return {
    now, people, prior, ready, actions,
    view: reviewView(review, people),
    checklist: items.filter((i) => i.reviewId === review.id).map((i) => itemView(i, ready, people, now)),
    decisions,
    extraActions,
  };
}

// ─── Carte « Revue de direction » de /audits ────────────────────────────────

export async function loadReviewCard({ revue }: { revue?: string | string[] }) {
  const now = today();
  const [session, reviews, options] = await Promise.all([getSession(), loadReviews(), loadFormOptions()]);
  const current = pickReview(reviews, revue, now);
  const opts = { people: options.people, origins: options.origins, sites: options.sites, actions: options.actions };
  const flags = {
    canEdit: canManage(session.role) && canSee(session.role, 'audits'),
    canApprove: canApprove(session.role),
  };
  const history = reviews.map(historyRow);
  if (!current) {
    return { now, review: null, reviews: history, items: [], decisions: [], extraActions: [], previous: null, changes: [], options: opts,
      defaults: { nextOn: addMonths(now, 1), holdNext: { on: addMonths(now, 1), kind: 'ordinaire' as ReviewKind }, originRef: '', copyFrom: null },
      flags: { ...flags, editable: false } };
  }
  const [rec, changes] = await Promise.all([readReviewRecord(current, reviews), loadChangeLog('review', current.id)]);
  const previous = rec.prior[0] ?? null;
  // Compte rendu : la prochaine revue proposée est celle déjà enregistrée, sinon celle qui suit (pas de doublon).
  const linkedNext = current.nextReviewOn ? reviews.find((r) => r.reviewOn === current.nextReviewOn && !isCancelled(r) && r.id !== current.id) : undefined;
  const next = linkedNext ?? followingReview(reviews, current);
  const fallbackNext = current.nextReviewOn ?? addMonths(current.reviewOn, 6);
  return {
    now,
    review: rec.view,
    reviews: history,
    items: rec.checklist,
    decisions: rec.decisions,
    extraActions: rec.extraActions,
    previous: previous && { id: previous.id, reviewOn: previous.reviewOn, kindShort: kindOf(previous.kind).short },
    changes,
    options: opts,
    defaults: {
      nextOn: fallbackNext,
      holdNext: {
        on: next?.reviewOn ?? fallbackNext,
        kind: (next?.kind ?? (current.kind === 'ordinaire' ? 'intermediaire' : 'ordinaire')) as ReviewKind,
      },
      originRef: `Revue de direction ${fmtDate(current.reviewOn)}`,
      copyFrom: current.id,
    },
    flags: { ...flags, editable: isEditableReview(current) },
  };
}
export type ReviewCardData = Awaited<ReturnType<typeof loadReviewCard>>;

// ─── Dossier de revue de direction (/revue-de-direction) ────────────────────

const monthStart = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-01`;
/** Borne de fin de mois pour les comparaisons de chaînes ISO (le « 31 » vaut pour tous les mois). */
const monthEnd = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-31`;

/** État d'un titre au regard de l'affectation (même formulation que les alertes de l'écran Compétences). */
function lapseState(al: SkillAlert): { label: string; tone: Tone } {
  const on = al.expiresOn ? fmtDate(al.expiresOn) : '';
  switch (al.lapse) {
    case 'missing': return { label: 'Requis, jamais suivi', tone: 'danger' };
    case 'expired': return { label: `Expiré depuis le ${on}`, tone: 'danger' };
    case 'before': return { label: `Expire le ${on}, avant l'affectation`, tone: 'danger' };
    case 'during': return { label: `Expire le ${on}, pendant l'affectation`, tone: 'warn' };
  }
}

const actionHref = (id: string) => `/actions?action=${encodeURIComponent(id)}`;
const eventHref = (id: string) => `/evenements?etat=tous&sel=${encodeURIComponent(id)}`;

/** En-tête et compte rendu d'une revue (aussi le seul contenu d'une revue antérieure à Vigie). */
async function buildRecordParts(review: Review, reviews: Review[]) {
  const [rec, session] = await Promise.all([readReviewRecord(review, reviews), getSession()]);
  const { people, now, view } = rec;
  const lead = people.get(ROLES['Animateur QHSE'].personId);
  const director = people.get(ROLES.Direction.personId);
  return {
    rec,
    header: {
      reviewOn: review.reviewOn,
      kind: view.kindLabel,
      status: view.status,
      from: addDays(now, -364),
      to: now,
      site: session.site.label,
      lead: lead ? `${lead.name} — ${lead.job}` : '—',
      director: director ? `${director.name} — ${director.job}` : '—',
      author: session.user.name,
    },
    record: {
      participants: view.participants,
      externalParticipants: view.externalParticipants,
      customerPerception: view.customerPerception,
      resourceNeeds: view.resourceNeeds,
      minutes: view.minutes,
      nextReviewOn: view.nextReviewOn,
      closedBy: view.closedBy,
      closedOn: view.closedOn,
    },
  };
}

/**
 * Dossier consolidé de la revue (ISO 9001 §9.3.2), calculé à la date du jour sur le site sélectionné.
 * Entièrement sérialisable : il est figé tel quel dans reviews.snapshot à la clôture.
 */
export async function buildReviewDossier(review: Review, reviews: Review[]) {
  const db = await getDb();
  const [parts, events, controls, dashboard, skills, risks, prevention, preventionSignals, documents, env, reqs, certs, plan, findings] = await Promise.all([
    buildRecordParts(review, reviews),
    loadEvents(),
    loadControls(),
    loadDashboard(),
    loadSkillMatrix(),
    loadRisks(),
    loadPrevention(),
    loadPreventionSignals(),
    loadDocuments(),
    loadEnvironment(yearOf(today())),
    db.select().from(t.requirements).orderBy(asc(t.requirements.sort), asc(t.requirements.id)),
    db.select().from(t.certifications).orderBy(asc(t.certifications.sort), asc(t.certifications.id)),
    db.select().from(t.auditPlanItems).orderBy(asc(t.auditPlanItems.id)),
    // Constats annulés (saisis par erreur) : hors dossier.
    db.select().from(t.auditFindings).where(isNull(t.auditFindings.cancelledAt)).orderBy(asc(t.auditFindings.sort), asc(t.auditFindings.id)),
  ]);
  const { rec, header, record } = parts;
  const { now, people, prior, actions } = rec;
  const from = header.from;
  const name = (id: string | null | undefined) => (id ? people.get(id)?.name ?? '—' : '—');
  const byAction = new Map((await loadAllActions()).map((a) => [a.id, a]));
  const brief = (a: ActionRow) => ({ ...actionBrief(a, people, now)!, href: actionHref(a.id) });
  const briefOf = (id: string | null) => {
    const a = id ? byAction.get(id) : undefined;
    return a ? brief(a) : null;
  };
  const eventActions = (eventId: string) => actions.filter((a) => a.eventId === eventId).map(brief);

  // 1. Actions des revues précédentes : toutes celles de la dernière revue tenue, les ouvertes des plus anciennes.
  const grouped = reviewActions(actions);
  const previousActions = prior.flatMap((r, i) => (grouped.get(r.id) ?? [])
    .filter((a) => i === 0 || isOpenActionStatus(a.status))
    .map((a) => ({ ...brief(a), originRef: a.originRef, review: reviewLabel(r), open: isOpenActionStatus(a.status) })))
    .sort((a, b) => Number(!a.open) - Number(!b.open) || a.dueOn.localeCompare(b.dueOn));

  // 2. Indicateurs sécurité (calculés par le tableau de bord)
  const tfKpi = dashboard.kpis.find((k) => k.label.startsWith('TF1'));
  const daysKpi = dashboard.kpis.find((k) => k.label.startsWith('Jours sans'));
  const safety = {
    tf1: tfKpi?.value ?? '—',
    tg: tfKpi?.sub.replace(/^TG\s*/, '') || '—',
    target: TF1_TARGET,
    daysWithout: daysKpi?.value ?? '—',
    daysNote: daysKpi?.note ?? '',
    pyramid: dashboard.pyramid.map((p) => ({ label: p.label, n: p.n, w: p.w, color: p.color })),
  };

  // 3. Non-conformités et événements (12 mois glissants ; « ouverts » : en cours quelle que soit la date)
  const last12 = events.filter((e) => e.occurredOn >= from);
  const byType = EVENT_TYPE_KEYS.map((k) => ({
    key: k, label: EVENT_TYPES[k].label, n12: last12.filter((e) => e.type === k).length, open: events.filter((e) => e.type === k && isOpen(e)).length,
  }));
  const ncLike = (o: string) => (e: (typeof events)[number]) => (o === 'Réclamation client' ? e.type === 'RC' || (e.type === 'NC' && e.ncOrigin === o) : e.type === 'NC' && e.ncOrigin === o);
  const ncByOrigin = [...NC_ORIGINS, 'Autre'].map((o) => {
    const match = o === 'Autre' ? (e: (typeof events)[number]) => e.type === 'NC' && (!e.ncOrigin || !NC_ORIGINS.includes(e.ncOrigin)) : ncLike(o);
    return { origin: o, n12: last12.filter(match).length, open: events.filter((e) => match(e) && isOpen(e)).length };
  }).filter((r) => r.origin !== 'Autre' || r.n12 + r.open > 0);
  const openNc = events.filter((e) => e.type === 'NC' && isOpen(e)).map((e) => ({
    id: e.id, occurredOn: e.occurredOn, title: e.title, origin: e.ncOrigin ?? '—', step: EVENT_STEPS[e.step], pilot: name(e.pilotId),
    actions: eventActions(e.id), href: eventHref(e.id),
  }));

  // 4. Réclamations clients
  const complaints = last12.filter((e) => e.type === 'RC').map((e) => ({
    id: e.id, occurredOn: e.occurredOn, title: e.title, project: e.keystoneProject, step: EVENT_STEPS[e.step], open: isOpen(e), pilot: name(e.pilotId),
    actions: eventActions(e.id), href: eventHref(e.id),
  }));

  // Programme : période examinée puis l'année suivant la revue.
  const reviewDay = review.reviewOn > now ? review.reviewOn : now;
  const progFrom = from;
  const progTo = addMonths(reviewDay, 12);
  const tracks = [...new Set(plan.map((p) => p.track))];
  const programme = plan
    .filter((p) => (p.plannedOn ? p.plannedOn >= progFrom && p.plannedOn <= progTo : monthEnd(p.year, p.month) >= progFrom && monthStart(p.year, p.month) <= progTo))
    .map((p) => {
      const key: PlanItemState = p.done ? 'done' : (p.plannedOn ?? monthEnd(p.year, p.month)) < now ? 'late' : 'upcoming';
      return {
        id: p.id, year: p.year, month: p.month, track: p.track, label: p.label, detail: p.detail, plannedOn: p.plannedOn, doneOn: p.doneOn,
        auditor: p.auditor, owner: p.ownerId ? name(p.ownerId) : '', action: briefOf(p.actionId),
        state: { key, label: PLAN_ITEM_STATES[key].label, tone: PLAN_ITEM_STATES[key].tone as Tone },
        href: `/audits?annee=${p.year}&element=${p.id}`,
      };
    })
    .sort((a, b) => a.year - b.year || a.month - b.month || tracks.indexOf(a.track) - tracks.indexOf(b.track));
  const programmeCounts = {
    done: programme.filter((p) => p.state.key === 'done').length,
    pending: programme.filter((p) => p.state.key === 'late').length,
    upcoming: programme.filter((p) => p.state.key === 'upcoming').length,
  };

  // 5. Fournisseurs : audits de la ligne « Fournisseurs » du programme, NC d'origine « Fournisseurs »
  const supplierAudits = programme.filter((p) => p.track === 'Fournisseurs');
  const supplierNcs = last12.filter((e) => e.type === 'NC' && e.ncOrigin === 'Fournisseurs').map((e) => ({
    id: e.id, occurredOn: e.occurredOn, title: e.title, step: EVENT_STEPS[e.step], open: isOpen(e), pilot: name(e.pilotId),
    actions: eventActions(e.id), href: eventHref(e.id),
  }));
  const suppliers = {
    audits: supplierAudits,
    ncs: supplierNcs,
    summary: {
      audits: supplierAudits.length, auditsDone: supplierAudits.filter((p) => p.state.key === 'done').length,
      ncs: supplierNcs.length, ncOpen: supplierNcs.filter((n) => n.open).length,
    },
  };

  // 6. Audits et certifications
  const nextAuditOf = (certId: string) => plan.filter((p) => p.certificationId === certId && !p.done)
    .map((p) => p.plannedOn ?? monthStart(p.year, p.month)).sort()[0] ?? null;
  const certViews = certs.map((c) => ({
    id: c.id, standard: c.standard, domain: c.domain, tone: c.tone, note: c.note, organization: c.organization, validUntil: c.validUntil,
    status: certificationStatus(c, nextAuditOf(c.id), now),
  }));
  // Libellé d'audit avec son mois (« Processus Production · juin 2026 ») : deux audits d'un même processus restent distincts.
  const planLabel = new Map(plan.map((p) => [p.id, planItemAuditLabel(p)]));
  const groups = new Map<string, { label: string; first: number; findings: { id: number; kind: string; kindLabel: string; tone: Tone; text: string; clause: string | null; actionId: string | null; action: ReturnType<typeof briefOf> }[] }>();
  findings.forEach((f) => {
    const label = (f.planItemId ? planLabel.get(f.planItemId) : null) ?? f.audit;
    const g = groups.get(label) ?? { label, first: f.id, findings: [] };
    const k = FINDING_KINDS[f.kind] ?? { label: f.kind, tone: 'neutral' as Tone };
    g.findings.push({ id: f.id, kind: f.kind, kindLabel: k.label, tone: k.tone, text: f.text, clause: f.clause, actionId: f.actionId, action: briefOf(f.actionId) });
    g.first = Math.min(g.first, f.id);
    groups.set(label, g);
  });
  const auditGroups = [...groups.values()].sort((a, b) => b.first - a.first).map(({ label, findings: list }) => ({ label, findings: list }));

  // 7. Plan d'actions par origine
  const cols = actions.map((a) => ({ a, col: actionColumn(a, now) }));
  const byOrigin = Object.entries(ORIGINS)
    .map(([key, o]) => {
      const list = cols.filter((x) => x.a.origin === key);
      return {
        key, label: o.label,
        open: list.filter((x) => x.col !== 'done').length,
        late: list.filter((x) => x.col === 'late').length,
        verify: list.filter((x) => x.col === 'verify').length,
        closed: list.filter((x) => x.col === 'done' && (x.a.closedOn ?? x.a.dueOn) >= from).length,
      };
    })
    .filter((r) => r.open + r.closed > 0);
  const totals = byOrigin.reduce((s, r) => ({ open: s.open + r.open, late: s.late + r.late, verify: s.verify + r.verify, closed: s.closed + r.closed }), { open: 0, late: 0, verify: 0, closed: 0 });
  const lateActions = cols.filter((x) => x.col === 'late')
    .map((x) => ({ ...brief(x.a), origin: ORIGINS[x.a.origin]?.label ?? x.a.origin, originRef: x.a.originRef }))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));

  // 8. Veille réglementaire et contrôles périodiques
  const liveReqs = reqs.filter((r) => !r.archivedAt);
  const requirements = liveReqs.map((r) => {
    const ev = REQUIREMENT_EVAL[r.evaluation] ?? { label: r.evaluation, tone: 'neutral' as Tone };
    return {
      id: r.id, text: r.text, domain: r.domain, evalLabel: ev.label, evalNote: r.evaluationNote, tone: ev.tone, lastEvaluatedOn: r.lastEvaluatedOn,
      dueOn: r.dueOn, dueNote: r.dueNote, pilot: name(r.pilotId), action: briefOf(r.actionId), href: `/veille?exigence=${r.id}`,
    };
  });
  const requirementCounts = Object.entries(REQUIREMENT_EVAL).map(([key, ev]) => ({ key, label: ev.label, tone: ev.tone, n: liveReqs.filter((r) => r.evaluation === key).length }));
  const ctrl = controls.map((c) => ({ c, s: controlStatus(c, now) }));
  const controlView = {
    overdue: ctrl.filter((x) => x.s.days < 0).length,
    soon: ctrl.filter((x) => x.s.days >= 0 && x.s.tone === 'warn').length,
    planned: ctrl.filter((x) => x.s.tone === 'neutral').length,
    withReserves: ctrl.filter((x) => !!x.c.reserves).length,
    rows: ctrl.filter((x) => x.s.tone !== 'neutral' || !!x.c.reserves)
      .sort((a, b) => a.s.days - b.s.days)
      .map(({ c, s }) => ({
        id: c.id, equipment: c.equipment, type: c.controlType, organization: c.organization, nextOn: c.nextOn,
        status: { label: s.label, tone: s.tone }, reserves: c.reserves, action: briefOf(c.actionId),
        href: `/veille?onglet=controles&controle=${c.id}`,
      })),
  };

  // 9. DUERP
  const unitLabel = new Map(risks.units.map((u) => [u.id, u.label]));
  const scored = risks.risks.map((r) => ({ r, score: r.gravity * r.probability }));
  const priorityList = scored.filter((x) => x.score >= RISK_ACTION_THRESHOLD);
  const v = risks.version;
  const riskView = {
    version: v ? { version: v.version, updatedOn: v.updatedOn, nextUpdateOn: v.nextUpdateOn, cseConsultedOn: v.cseConsultedOn, daysToUpdate: v.daysToUpdate } : null,
    priority: {
      count: priorityList.length,
      withoutAction: priorityList.filter((x) => !x.r.actions.some((a) => !a.done && !a.cancelled)).length,
      top: [...priorityList].sort((a, b) => b.score - a.score).slice(0, 8).map(({ r, score }) => ({
        id: r.id, unit: unitLabel.get(r.unitId) ?? r.unitId, hazard: r.hazard, score, residual: r.residualGravity * r.residualProbability,
        actions: r.actions.filter((a) => !a.cancelled).map((a) => ({ id: a.id, status: a.status, tone: a.tone, href: actionHref(a.id) })),
        href: `/risques?unite=${encodeURIComponent(r.unitId)}&risque=${r.id}`,
      })),
    },
  };

  // 10. Prévention des entreprises extérieures
  const preventionView = {
    kpis: prevention.kpis.map((k) => ({ label: k.label, value: k.value, sub: k.sub, note: k.note, tone: k.tone })),
    gaps: preventionSignals.todo.map((s) => ({ date: s.date, title: s.title, tone: s.tone, href: s.href ?? '/prevention' })),
  };

  // 11. Maîtrise documentaire
  const documentView = {
    kpis: documents.kpis.map((k) => ({ key: k.key, label: k.label, value: k.value, sub: k.sub, note: k.note })),
    overdue: documents.rows.filter((r) => r.overdue).sort((a, b) => (a.reviewDays ?? 0) - (b.reviewDays ?? 0)).map((r) => ({
      id: r.id, title: r.title, owner: r.owner, nextReviewOn: r.nextReviewOn, href: `/documents?doc=${encodeURIComponent(r.id)}`,
    })),
    pending: documents.rows.flatMap((r) => r.versions.filter((x) => x.status === 'en_revue').map((x) => ({
      docId: r.id, version: x.version, title: r.title, submittedOn: x.submittedOn, href: `/documents?doc=${encodeURIComponent(r.id)}`,
    }))),
  };

  // 12. Performance environnementale
  const envCert = certViews.find((c) => c.domain === 'Environnement');
  const environment = {
    year: env.year,
    kpis: {
      tonnes: env.kpis.evacuated.tonnes, entries: env.kpis.evacuated.count, prevTonnes: env.kpis.evacuated.prevTonnes,
      hazardousShare: env.kpis.hazardous.share, recoveryShare: env.kpis.recovery.share, missingBsd: env.kpis.missing.count,
      electricity: { current: env.kpis.electricity.current, previous: env.kpis.electricity.previous, delta: env.kpis.electricity.delta, period: env.kpis.electricity.period },
    },
    openEvents: env.envEvents.length,
    envClosed12: env.envClosed12,
    certification: envCert ? { standard: envCert.standard, status: envCert.status.label, engaged: envCert.tone !== 'off', note: envCert.note } : null,
  };

  // 13. Ressources et compétences
  const cells = skills.rows.flatMap((r) => r.cells);
  const skillCounts = {
    people: skills.rows.length,
    expired: cells.filter((c) => c.state === 'x').length,
    soon: cells.filter((c) => c.state === 's').length,
    never: cells.filter((c) => c.state === 'r').length,
  };
  const skillAlerts = skills.alerts.map((al) => ({
    person: al.person.name, title: al.title, state: lapseState(al),
    assignment: `${al.assignment.project} · ${al.assignment.activity}`, startOn: al.assignment.startOn, endOn: al.assignment.endOn,
    href: `/habilitations?salarie=${encodeURIComponent(al.person.id)}&titre=${encodeURIComponent(al.titleId)}`,
  }));

  return {
    header,
    record,
    previousActions,
    safety,
    events: { byType, ncByOrigin, openNc },
    complaints,
    suppliers,
    audits: { certs: certViews, progFrom, progTo, programme, programmeCounts, auditGroups, programmeHref: `/audits?annee=${yearOf(reviewDay)}` },
    actions: { byOrigin, totals, lateActions },
    watch: { requirements, requirementCounts, controls: controlView },
    risks: riskView,
    prevention: preventionView,
    documents: documentView,
    environment,
    skills: { counts: skillCounts, alerts: skillAlerts, href: '/habilitations' },
    checklist: rec.checklist,
    decisions: rec.decisions,
    extraActions: rec.extraActions,
  };
}
export type ReviewDossier = Awaited<ReturnType<typeof buildReviewDossier>>;

/** Compte rendu seul : revue clôturée avant Vigie, sans dossier figé. */
export type ReviewRecordOnly = Pick<ReviewDossier, 'header' | 'record' | 'checklist' | 'decisions' | 'extraActions'>;

/**
 * Page /revue-de-direction : dossier figé (revue clôturée dans Vigie), compte rendu seul (revue clôturée
 * antérieure à Vigie), avis d'annulation (revue annulée), sinon dossier préparatoire calculé à la date du jour.
 */
export async function loadReviewDossierPage({ revue }: { revue?: string | string[] }) {
  const now = today();
  const reviews = await loadReviews();
  const review = pickReview(reviews, revue, now);
  const switcher = reviews.filter((r) => !isCancelled(r) || r.id === review?.id).map(historyRow);
  if (!review) return { mode: 'none' as const, now, review: null, reviews: switcher };
  const base = { now, review: historyRow(review), reviews: switcher };
  // Revue annulée (lien direct ?revue=<id>) : pas de dossier, seulement l'annulation et son motif.
  if (isCancelled(review)) {
    const people = await loadPeople();
    const by = review.cancelledById ? people.get(review.cancelledById)?.name ?? review.cancelledById : null;
    const on = review.cancelledAt ? review.cancelledAt.toISOString().slice(0, 10) : null;
    return { ...base, mode: 'cancelled' as const, dossier: null, cancel: { on, by, reason: review.cancelReason, kind: kindOf(review.kind).label } };
  }
  if (review.status === 'cloturee') {
    const snap = parseReviewSnapshot(review.snapshot);
    if (snap) return { ...base, mode: 'snapshot' as const, dossier: snap.dossier, takenOn: snap.takenOn, takenBy: snap.takenBy };
    const { rec, header, record } = await buildRecordParts(review, reviews);
    const recordOnly: ReviewRecordOnly = { header, record, checklist: rec.checklist, decisions: rec.decisions, extraActions: rec.extraActions };
    return { ...base, mode: 'record' as const, dossier: null, record: recordOnly };
  }
  return { ...base, mode: 'live' as const, dossier: await buildReviewDossier(review, reviews) };
}
export type ReviewDossierPage = Awaited<ReturnType<typeof loadReviewDossierPage>>;

// ─── Échéances du domaine (tableau de bord, À faire, notifications, badge) ──

/**
 * Échéances de la revue de direction (href /audits?revue=<id>), pour chaque revue planifiée ou tenue :
 * éléments d'entrée attendus des contributeurs (en retard, ou à remettre sous 15 jours ; jamais les éléments
 * automatiques), compte rendu à saisir après la date de la revue, visa et dossier à clôturer (REVIEW_CLOSE_DAYS).
 */
export const loadReviewSignals = cache(async (): Promise<{ badge?: number; todo: TodoItem[] }> => {
  const { role } = await getSession();
  if (!canSee(role, 'audits')) return { todo: [] };
  const db = await getDb();
  const now = today();
  const horizon = addDays(now, TODO_HORIZON_DAYS);
  const [reviews, items, people] = await Promise.all([loadReviews(), db.select().from(t.reviewItems), loadPeople()]);
  const director = ROLES.Direction.personId;
  const name = (id: string | null) => (id ? people.get(id)?.name ?? '' : '');
  const kind = 'Revue de direction';
  const todo: TodoItem[] = [];
  reviews.filter(isEditableReview).forEach((r) => {
    const href = `/audits?annee=${yearOf(r.reviewOn)}&revue=${r.id}#revue`;
    const day = fmtDayMonth(r.reviewOn);
    items.filter((i) => i.reviewId === r.id && !i.done && !!i.dueOn && !REVIEW_SOURCES[sourceOf(i.source)].auto).forEach((i) => {
      const who = name(i.ownerId) || i.owner;
      const ownerIds = i.ownerId ? [i.ownerId] : [QHSE_LEAD];
      if (i.dueOn! < now) {
        todo.push({ date: now, kind, tone: 'danger', title: `${i.label} — attendu le ${fmtDayMonth(i.dueOn!)} · revue du ${day}`, who, href, ownerIds, overdue: true });
      } else if (i.dueOn! <= horizon) {
        todo.push({ date: i.dueOn!, kind, tone: 'warn', title: `${i.label} · revue du ${day}`, who, href, ownerIds });
      }
    });
    if (r.status === 'planifiee' && r.reviewOn < now) {
      todo.push({ date: now, kind, tone: 'danger', title: `Revue de direction du ${day} — compte rendu à saisir`, who: name(director), href, ownerIds: [director, QHSE_LEAD], overdue: true });
    }
    if (r.status === 'tenue' && addDays(r.reviewOn, REVIEW_CLOSE_DAYS) < now) {
      todo.push({ date: now, kind, tone: 'warn', title: `Revue de direction du ${day} — visa de la direction et dossier à clôturer`, who: name(director), href, ownerIds: [director, QHSE_LEAD], overdue: true });
    }
  });
  return { todo };
});
