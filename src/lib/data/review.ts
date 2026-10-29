import 'server-only';
import { cache } from 'react';
import { asc, desc, inArray, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { addDays, addMonths, daysBetween, fmtDate, fmtDayMonth, toParisLocal, yearOf, parisDay } from '../dates';
import { today } from '@/lib/today';
import {
  ACTION_SOURCES, EVENT_STEPS, EVENT_TYPES, EVENT_TYPE_KEYS, FINDING_KINDS, NC_ORIGINS, PLAN_ITEM_STATES, REQUIREMENT_EVAL, REVIEW_AUTO_OWNER,
  REVIEW_CLOSE_DAYS, REVIEW_DECISION_KINDS, REVIEW_FOLLOW_UP, REVIEW_KINDS, REVIEW_SOURCES, REVIEW_STATUS, RISK_ACTION_THRESHOLD, SOURCE_KEYS,
  TODO_HORIZON_DAYS, canApprove, canSignReview, canEdit, canReadReviewDossier, canSee, isClosedActionStatus, isEmployee, isOpenAvancement, type ReviewDecisionKind,
  type ReviewKind, type ReviewSource, type ReviewStatus, type TodoItem, type Tone,
} from '../domain';
import {
  actionBrief, certificationStatus, controlStatus, isOpen, lastFullMonths, loadActions, loadAllActions, loadControls,
  loadEvents, loadPeople, requirementDue, safetyRates, workforceAccident, type ActionBrief, type ActionRow, type Person,
} from '../queries';
import { SOURCE_TO_COMPLETE, actionHref, actionLabel, canCreateAction, isLate } from '../action-rules';
import type { ActionFormOptions } from '../action-view';
import { clipText, decisionFollowUpGap, reviewCloseBlockers } from '../review-rules';
import { loadQhseLeads } from './leads';
import { ALL_SITES, currentSiteId, getSession, inSite } from '../session';
import { findingActionsBy, planItemAuditLabel, planItemState } from './audits';
import { loadEntityFiles } from './entity-files';
import { loadChangeLog } from './changelog';
import { loadContext } from './context';
import { loadObjectives, tf1Target } from './objectives';
import { fmtObjectiveTarget, fmtObjectiveValue } from '../objectives';
import { loadDocuments } from './documents';
import { loadEnvironment } from './environment';
import { loadFormOptions } from './options';
import { loadPrevention } from './prevention';
import { loadPreventionSignals } from './prevention-signals';
import { loadRisks } from './risks';
import { loadSkillMatrix, type SkillAlert } from './skills';
import { skillIndicators } from '@/components/skills/rules';

// ─── Revue de direction (ISO 9001 §9.3) ─────────────────────────────────────

export type Review = typeof t.reviews.$inferSelect;
export type ReviewItemRow = typeof t.reviewItems.$inferSelect;
export type ReviewDecisionRow = typeof t.reviewDecisions.$inferSelect;

/** Phase du dossier figé : sections arrêtées à la séance (saisie du compte rendu), puis dossier complet au visa (AUD-06). */
export type SnapshotPhase = 'seance' | 'cloture';

/**
 * Contenu de reviews.snapshot (version 2, AUD-06) :
 * - phase « seance » : dossier calculé à la première saisie du compte rendu, indicateurs arrêtés à la date de la séance
 *   (`asOf`) ; le compte rendu (record, check-list, décisions, actions) reste modifiable jusqu'au visa ;
 * - phase « cloture » : dossier complet figé au visa de la direction, jamais modifié ensuite (`seance` : figeage de la séance).
 * La version 1 (dossier figé au visa, avant le lot 2) se lit comme une phase « cloture ».
 */
export type ReviewSnapshot = {
  version: 2; phase: SnapshotPhase; asOf: string; takenOn: string; takenBy: string;
  seance?: { takenOn: string; takenBy: string };
  dossier: StoredDossier;
};

/** Ligne de l'ancienne section 1 (« Suivi des actions des revues précédentes », instantanés de version 1). */
export type LegacyPreviousAction = ActionBrief & { href: string; originRef: string; review: string; open: boolean };
/**
 * Section « Plan d'actions » du dossier, par source (ligne) : `open` = non closes hors Terminées (Reportée comprise), `late` =
 * en retard (§ 6.3), `verify` = Terminées — à vérifier, `closed` = Vérifiées pendant la période examinée (closed_on).
 * Clés inchangées depuis l'ancien modèle : un dossier figé avant 0005 porte `byOrigin` (même forme, colonnes d'origine).
 */
export type DossierActionRow = { key: string; label: string; open: number; late: number; verify: number; closed: number };
export type DossierActions = {
  /** Dossier courant : une ligne par source (24, plus « À compléter »). */
  bySource?: DossierActionRow[];
  /** Dossier figé avant la refonte des actions (ancien champ « origine ») : lu tel quel. */
  byOrigin?: DossierActionRow[];
  totals?: Omit<DossierActionRow, 'key' | 'label'>;
  /** Actions en retard ; `origin` = libellé de la source (clé conservée pour les dossiers figés). */
  lateActions?: (ActionBrief & { href: string; origin: string; originRef: string })[];
};
/**
 * Constat de la section « Audits » du dossier : ses actions (AUD-28, plusieurs par constat). Un dossier figé avant la
 * migration 0016 porte une seule action (`actionId`, `action`) : lu par dossierFindingActions (DossierView).
 */
export type DossierFinding = {
  id: number; kind: string; kindLabel: string; tone: Tone; text: string; clause: string | null;
  actions?: { id: string; action: (ActionBrief & { href: string }) | null }[];
  /** Dossier figé avant AUD-28 : action unique du constat. */
  actionId?: string | null; action?: (ActionBrief & { href: string }) | null;
};

/** Dossier conservé dans un instantané : format courant, ou ancien format (previousActions au lieu de previousFollowUp). */
export type StoredDossier = ReviewDossier & { previousActions?: LegacyPreviousAction[] };

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Lecture défensive de reviews.snapshot (null pour les revues antérieures à Vigie ou un format inconnu). */
export function parseReviewSnapshot(raw: unknown): ReviewSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (!s.dossier || typeof s.dossier !== 'object') return null;
  const dossier = s.dossier as StoredDossier;
  const takenOn = str(s.takenOn);
  const takenBy = str(s.takenBy);
  const headerTo = dossier.header && typeof dossier.header === 'object' ? str(dossier.header.to) : '';
  // Version 1 : dossier figé au visa, indicateurs calculés à la date de clôture (fin de la période examinée).
  if (s.version === 1) return { version: 2, phase: 'cloture', asOf: headerTo || takenOn, takenOn, takenBy, dossier };
  if (s.version !== 2 || (s.phase !== 'seance' && s.phase !== 'cloture')) return null;
  const seance = s.seance && typeof s.seance === 'object' ? s.seance as Record<string, unknown> : null;
  return {
    version: 2, phase: s.phase, asOf: str(s.asOf) || headerTo || takenOn, takenOn, takenBy,
    ...(seance ? { seance: { takenOn: str(seance.takenOn), takenBy: str(seance.takenBy) } } : {}),
    dossier,
  };
}

/** Date d'arrêt des indicateurs du dossier : la séance une fois passée, sinon la date du jour (dossier préparatoire). */
export const dossierAsOf = (reviewOn: string, now: string) => (reviewOn < now ? reviewOn : now);

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
  // Heures travaillées des 12 derniers mois complets (TDB-04 : même fenêtre que TF1 / TG, sans 13e mois).
  const months = new Set(lastFullMonths(now));
  const ready: Record<Exclude<ReviewSource, 'manuel' | 'actions'>, boolean> = {
    safety: hours.some((h) => inSite(site, h.siteId) && months.has(h.month.slice(0, 7))),
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
const participantIdsOf = (r: Pick<Review, 'participantIds'>) => (Array.isArray(r.participantIds) ? (r.participantIds as unknown[]).filter((x): x is string => typeof x === 'string') : []);

function reviewView(r: Review, people: Map<string, Person>) {
  const name = (id: string | null) => (id ? people.get(id)?.name ?? id : null);
  const ids = participantIdsOf(r);
  return {
    id: r.id, reviewOn: r.reviewOn, kind: r.kind as ReviewKind, kindLabel: kindOf(r.kind).label, kindShort: kindOf(r.kind).short,
    status: r.status as ReviewStatus, statusLabel: statusOf(r.status).label, statusTone: statusOf(r.status).tone,
    participantIds: ids, participants: ids.map((id) => name(id) ?? id),
    externalParticipants: r.externalParticipants, customerPerception: r.customerPerception, resourceNeeds: r.resourceNeeds, minutes: r.minutes,
    nextReviewOn: r.nextReviewOn, recordedBy: name(r.recordedById), closedOn: r.closedOn, closedBy: name(r.closedById),
    cancelledOn: r.cancelledAt ? parisDay(r.cancelledAt) : null, cancelledBy: name(r.cancelledById), cancelReason: r.cancelReason,
    hasSnapshot: !!parseReviewSnapshot(r.snapshot),
    /** Dossier de séance déjà figé (AUD-06) : une correction du compte rendu sans changement de date ne le recalcule pas. */
    seanceFrozen: !!parseReviewSnapshot(r.snapshot),
  };
}
export type ReviewView = ReturnType<typeof reviewView>;

const historyRow = (r: Review) => ({
  id: r.id, reviewOn: r.reviewOn, kindShort: kindOf(r.kind).short, statusLabel: statusOf(r.status).label, statusTone: statusOf(r.status).tone,
  cancelled: isCancelled(r), cancelReason: r.cancelReason,
});

export type DecisionView = {
  id: number; kind: ReviewDecisionKind; kindLabel: string; tone: Tone; text: string; pilotId: string | null; pilot: string;
  dueOn: string | null; actionId: string | null; action: ActionBrief | null; sort: number;
  /** AUD-36 : abandonnée après la séance (qui, quand, pourquoi) ; absent des dossiers figés avant le paquet 12. */
  cancelled?: { on: string; by: string; reason: string } | null;
};

/** Abandon d'une décision (AUD-36) tel qu'affiché : jour de Paris, auteur, motif. */
const decisionCancel = (d: Pick<ReviewDecisionRow, 'cancelledAt' | 'cancelledById' | 'cancelReason'>, people: Map<string, Person>) =>
  d.cancelledAt ? { on: parisDay(d.cancelledAt), by: d.cancelledById ? people.get(d.cancelledById)?.name ?? '—' : '—', reason: d.cancelReason ?? '' } : null;

/** Rectificatif d'une revue clôturée (AUD-34) : ajout daté, motivé et signé, jamais modifié. */
export type ReviewCorrectionView = { id: number; on: string; at: string; by: string; text: string; reason: string };

/** Rectificatifs des revues `ids`, du plus ancien au plus récent (AUD-34). */
export async function loadReviewCorrections(ids: number[]): Promise<Map<number, ReviewCorrectionView[]>> {
  const out = new Map<number, ReviewCorrectionView[]>();
  if (!ids.length) return out;
  const db = await getDb();
  const [rows, people] = await Promise.all([
    db.select().from(t.reviewCorrections).where(inArray(t.reviewCorrections.reviewId, ids)).orderBy(asc(t.reviewCorrections.signedAt), asc(t.reviewCorrections.id)),
    loadPeople(),
  ]);
  rows.forEach((r) => {
    const list = out.get(r.reviewId) ?? [];
    list.push({
      id: r.id, on: parisDay(r.signedAt), at: toParisLocal(r.signedAt), by: r.signedById ? people.get(r.signedById)?.name ?? '—' : '—', text: r.text, reason: r.reason,
    });
    out.set(r.reviewId, list);
  });
  return out;
}

/**
 * Préparation, décisions et actions d'une revue (partagé par la carte et le dossier). Les décisions d'une revue valent pour
 * toute l'entreprise : leurs actions (chacune sur un site, D16) sont lues sur tout le périmètre de la personne, quel que
 * soit le site sélectionné.
 */
async function readReviewRecord(review: Review, reviews: Review[]) {
  const db = await getDb();
  const now = today();
  const [people, items, decisionRows, actions, allActions] = await Promise.all([
    loadPeople(),
    db.select().from(t.reviewItems).orderBy(asc(t.reviewItems.sort), asc(t.reviewItems.id)),
    db.select().from(t.reviewDecisions).orderBy(asc(t.reviewDecisions.sort), asc(t.reviewDecisions.id)),
    loadActions('perimeter'),
    loadAllActions('perimeter'),
  ]);
  const prior = priorReviews(reviews, review);
  const ready = await autoReady(prior.length > 0);
  const byAction = new Map(allActions.map((a) => [a.id, a]));
  const decisions: DecisionView[] = decisionRows.filter((d) => d.reviewId === review.id).map((d) => {
    const k = REVIEW_DECISION_KINDS[d.kind as ReviewDecisionKind] ?? REVIEW_DECISION_KINDS.decision;
    return {
      id: d.id, kind: d.kind as ReviewDecisionKind, kindLabel: k.label, tone: k.tone, text: d.text, pilotId: d.pilotId,
      pilot: d.pilotId ? people.get(d.pilotId)?.name ?? '—' : '—', dueOn: d.dueOn, actionId: d.actionId,
      action: d.actionId ? actionBrief(byAction.get(d.actionId), people, now) : null, sort: d.sort, cancelled: decisionCancel(d, people),
    };
  });
  const linked = new Set(decisions.map((d) => d.actionId).filter(Boolean));
  const extraActions = (reviewActions(actions).get(review.id) ?? [])
    .filter((a) => !linked.has(a.id))
    .map((a) => ({ ...actionBrief(a, people, now)!, href: actionHref(a.id) }))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  return {
    now, people, prior, ready, actions, allActions, decisionRows,
    view: reviewView(review, people),
    checklist: items.filter((i) => i.reviewId === review.id).map((i) => itemView(i, ready, people, now)),
    decisions,
    extraActions,
  };
}

// ─── Carte « Revue de direction » de /audits ────────────────────────────────

/** Échéance du programme portée par une revue (AUD-01), pour la carte et « Mes contributions ». */
async function reviewProgramme(reviewId: number, now: string) {
  const db = await getDb();
  const rows = await db.select().from(t.auditPlanItems).where(isNull(t.auditPlanItems.cancelledAt));
  const p = rows.find((r) => r.reviewId === reviewId);
  return p ? { id: p.id, year: p.year, label: p.label, stateLabel: PLAN_ITEM_STATES[planItemState(p, now)].label } : null;
}

export async function loadReviewCard({ revue }: { revue?: string | string[] }) {
  const now = today();
  const [session, reviews, options] = await Promise.all([getSession(), loadReviews(), loadFormOptions()]);
  const current = pickReview(reviews, revue, now);
  const edit = canEdit(session.role, 'audits');
  // Listes des formulaires : rôles qui saisissent seulement (consultation de l'encadrement : hors de la charge de la page).
  // Formulaire d'action : service QHSE seulement (ACT-22) ; `today` : date du jour du serveur.
  const createActions = edit && canCreateAction(session.role);
  const opts: ActionFormOptions = createActions
    ? { people: options.people, sites: options.sites, today: now }
    : { people: [], sites: [], today: now };
  // Liste du personnel du formulaire de décision (pilote) : rôles qui saisissent.
  const people = edit ? options.people : [];
  // « Rattacher » une action existante à la revue ou à une décision (liens complémentaires) : service QHSE seulement.
  const linkable = createActions ? options.actions : [];
  const flags = {
    canEdit: edit,
    /** Service QHSE : création des actions des décisions et de la revue (ACT-22). */
    canCreateActions: createActions,
    canApprove: canApprove(session.role),
    /** Visa de la direction (clôture) : la direction seulement (AUD-15). */
    canSign: canSignReview(session.role),
    /** Dossier consolidé (/revue-de-direction) : animateur QHSE et direction (AUD-02). */
    canDossier: canReadReviewDossier(session.role),
    userId: session.user.id,
  };
  const history = reviews.map(historyRow);
  if (!current) {
    return { now, review: null, reviewFiles: [], corrections: [] as ReviewCorrectionView[], reviews: history, items: [], decisions: [], extraActions: [], previous: null, changes: [], options: opts, people, linkable, programme: null,
      defaults: { nextOn: addMonths(now, 1), holdNext: { on: addMonths(now, 1), kind: 'ordinaire' as ReviewKind }, originRef: '', copyFrom: null },
      flags: { ...flags, editable: false, mine: false, closeBlockers: [] as string[] } };
  }
  const [rec, changes, programme, reviewFiles, corrections] = await Promise.all([
    readReviewRecord(current, reviews), loadChangeLog('review', current.id), reviewProgramme(current.id, now), loadEntityFiles('review', [current.id]),
    loadReviewCorrections([current.id]),
  ]);
  // AUD-17 : pièces des éléments d'entrée (figées avec la revue clôturée ou annulée).
  const itemFiles = await loadEntityFiles('review_item', rec.checklist.map((i) => i.id));
  const previous = rec.prior[0] ?? null;
  const editable = isEditableReview(current);
  // Compte rendu : la prochaine revue proposée est celle déjà enregistrée, sinon celle qui suit (pas de doublon).
  const linkedNext = current.nextReviewOn ? reviews.find((r) => r.reviewOn === current.nextReviewOn && !isCancelled(r) && r.id !== current.id) : undefined;
  const next = linkedNext ?? followingReview(reviews, current);
  const fallbackNext = current.nextReviewOn ?? addMonths(current.reviewOn, 6);
  // Case « fourni » : rôles qui saisissent sur l'écran Audits, ou le contributeur lui-même (AUD-04), tant que la revue est modifiable.
  const items = rec.checklist.map((i) => ({
    ...i, canToggle: editable && !i.auto && (edit || i.ownerId === session.user.id),
    files: itemFiles.get(String(i.id)) ?? [],
    /** Pièces jointes : rôles qui saisissent, ou le contributeur, tant que la revue est modifiable (AUD-17). */
    canAttach: editable && !i.auto && (edit || i.ownerId === session.user.id),
  }));
  return {
    now,
    review: rec.view,
    /** Pièces jointes de la revue (AUD-17). */
    reviewFiles: reviewFiles.get(String(current.id)) ?? [],
    /** Rectificatifs signés après le visa (AUD-34). */
    corrections: corrections.get(current.id) ?? [],
    reviews: history,
    items,
    decisions: rec.decisions,
    extraActions: rec.extraActions,
    previous: previous && { id: previous.id, reviewOn: previous.reviewOn, kindShort: kindOf(previous.kind).short },
    changes,
    options: opts,
    people,
    linkable,
    /** Échéance au programme annuel (AUD-01) ; null : revue hors programme. */
    programme,
    defaults: {
      nextOn: fallbackNext,
      holdNext: {
        on: next?.reviewOn ?? fallbackNext,
        kind: (next?.kind ?? (current.kind === 'ordinaire' ? 'intermediaire' : 'ordinaire')) as ReviewKind,
      },
      originRef: `Revue de direction ${fmtDate(current.reviewOn)}`,
      copyFrom: current.id,
    },
    flags: {
      ...flags, editable, mine: items.some((i) => i.ownerId === session.user.id),
      /** Contrôles avant le visa (AUD-14), affichés à la place du bouton de clôture. */
      closeBlockers: current.status === 'tenue'
        ? reviewCloseBlockers({ ...current, participantIds: current.participantIds as string[] }, rec.decisions.map((d) => ({ ...d, cancelledAt: d.cancelled?.on ?? null })))
        : [],
    },
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

const eventHref = (id: string) => `/evenements?etat=tous&sel=${encodeURIComponent(id)}`;

/** En-tête et compte rendu d'une revue (aussi le seul contenu d'une revue antérieure à Vigie). */
async function buildRecordParts(review: Review, reviews: Review[], asOf = dossierAsOf(review.reviewOn, today())) {
  const [rec, session, leads] = await Promise.all([readReviewRecord(review, reviews), getSession(), loadQhseLeads()]);
  const { view } = rec;
  // Responsable QHSE du site sélectionné (ou des sites, sous « Tous les sites ») et direction (dernier rôle connu).
  const lead = leads.lead(session.site.id === ALL_SITES ? null : session.site.id);
  const director = leads.directors[0];
  return {
    rec,
    header: {
      reviewOn: review.reviewOn,
      kind: view.kindLabel,
      status: view.status,
      // Période examinée : 12 mois glissants arrêtés à la séance (AUD-06), à la date du jour avant la séance.
      from: addDays(asOf, -364),
      to: asOf,
      asOf,
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

/** Compte rendu seul (en-tête, compte rendu, check-list, décisions, actions), calculé maintenant. */
export async function reviewRecordParts(review: Review, reviews: Review[], asOf?: string): Promise<ReviewRecordOnly> {
  const { rec, header, record } = await buildRecordParts(review, reviews, asOf);
  return { header, record, checklist: rec.checklist, decisions: rec.decisions, extraActions: rec.extraActions };
}

/** Ligne du suivi des décisions et actions des revues précédentes (dossier § 1, ISO 9001 §9.3.2 a, AUD-05). */
export type FollowUpRow = {
  key: string; reviewId: number; review: string;
  /** Nature de la décision, ou « action » : action rattachée à la revue sans décision qui la porte. */
  kind: ReviewDecisionKind | 'action'; kindLabel: string; tone: Tone;
  text: string; pilot: string; dueOn: string | null;
  actionId: string | null; action: (ActionBrief & { href: string }) | null;
  cancelled: { on: string | null; reason: string } | null;
  /** Encore à suivre : action ouverte, ou décision sans action dont l'échéance tombe dans la période examinée. */
  open: boolean;
  state: 'action' | 'no_action' | 'cancelled';
};

/**
 * Suivi des revues précédentes (`prior`, la plus récente d'abord) : une ligne par décision, objectif ou besoin en
 * ressources, plus chaque action rattachée à la revue (actions.reviewId) qu'aucune décision ne porte. Action abandonnée :
 * date et motif ; décision sans action : « Sans action au plan » (warn pour une décision, neutral sinon). Encore à suivre :
 * action non close (Reportée et Terminée — à vérifier comprises).
 * Inclusion : la dernière revue et les revues tenues pendant la période examinée (reviewOn ≥ `from`) en entier ; les plus
 * anciennes pour leurs lignes encore ouvertes. Tri : ouvertes d'abord, puis par revue, puis par échéance.
 * `actions` : actions du périmètre, abandonnées comprises (une action hors du périmètre n'a pas de fiche : sa référence seule).
 */
export function reviewFollowUp({ prior, decisions, actions, people, asOf, from }: {
  prior: Pick<Review, 'id' | 'reviewOn'>[]; decisions: ReviewDecisionRow[]; actions: ActionRow[]; people: Map<string, Person>; asOf: string; from: string;
}): FollowUpRow[] {
  const byId = new Map(actions.map((a) => [a.id, a]));
  const carried = new Set(decisions.map((d) => d.actionId).filter((id): id is string => !!id));
  const name = (id: string | null) => (id ? people.get(id)?.name ?? '—' : '—');
  const brief = (a: ActionRow) => ({ ...actionBrief(a, people, asOf)!, href: actionHref(a.id) });
  const cancelOf = (a: ActionRow) => ({ on: a.cancelledAt ? toParisLocal(a.cancelledAt).slice(0, 10) : null, reason: a.cancelReason ?? '' });
  const order = new Map(prior.map((r, i) => [r.id, i]));
  const rows = prior.flatMap((r, i) => {
    const base = { reviewId: r.id, review: reviewLabel(r) };
    const fromDecisions = decisions.filter((d) => d.reviewId === r.id).sort((a, b) => a.sort - b.sort || a.id - b.id).map((d): FollowUpRow => {
      const k = REVIEW_DECISION_KINDS[d.kind as ReviewDecisionKind] ?? REVIEW_DECISION_KINDS.decision;
      const kind = (d.kind in REVIEW_DECISION_KINDS ? d.kind : 'decision') as ReviewDecisionKind;
      const common = { ...base, key: `d${d.id}`, kind, kindLabel: k.label, text: d.text, pilot: name(d.pilotId), dueOn: d.dueOn, actionId: d.actionId };
      const a = d.actionId ? byId.get(d.actionId) : undefined;
      // AUD-36 : décision abandonnée après la séance (motif) : plus à suivre.
      if (d.cancelledAt) {
        return { ...common, tone: REVIEW_FOLLOW_UP.cancelled.tone, action: null, cancelled: { on: parisDay(d.cancelledAt), reason: d.cancelReason ?? '' }, open: false, state: 'cancelled' };
      }
      if (a?.status === 'abandonnee') return { ...common, tone: REVIEW_FOLLOW_UP.cancelled.tone, action: brief(a), cancelled: cancelOf(a), open: false, state: 'cancelled' };
      if (a) { const b = brief(a); return { ...common, tone: b.tone, action: b, cancelled: null, open: !isClosedActionStatus(a.status), state: 'action' }; }
      // Action hors du périmètre (référence seule) : suivie dans le plan d'actions, considérée comme ouverte.
      if (d.actionId) return { ...common, tone: 'neutral', action: null, cancelled: null, open: true, state: 'action' };
      return {
        ...common, tone: kind === 'decision' ? REVIEW_FOLLOW_UP.no_action.tone : 'neutral', action: null, cancelled: null,
        open: !!d.dueOn && d.dueOn >= from, state: 'no_action',
      };
    });
    const extra = actions.filter((a) => a.reviewId === r.id && !carried.has(a.id)).map((a): FollowUpRow => {
      const cancelled = a.status === 'abandonnee';
      const b = brief(a);
      return {
        ...base, key: `a${a.id}`, kind: 'action', kindLabel: 'Action', tone: cancelled ? REVIEW_FOLLOW_UP.cancelled.tone : b.tone,
        text: actionLabel(a.detail), pilot: b.pilot, dueOn: a.dueOn, actionId: a.id, action: b, cancelled: cancelled ? cancelOf(a) : null,
        open: !isClosedActionStatus(a.status), state: cancelled ? 'cancelled' : 'action',
      };
    });
    const all = [...fromDecisions, ...extra];
    return i === 0 || r.reviewOn >= from ? all : all.filter((x) => x.open);
  });
  return rows.sort((a, b) => Number(b.open) - Number(a.open) || order.get(a.reviewId)! - order.get(b.reviewId)!
    || (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999'));
}

/** Couleurs de la pyramide des événements sécurité (mêmes que le tableau de bord). */
const PYRAMID_COLORS = ['var(--tone-danger-dot)', 'var(--tone-warn-dot)', 'var(--color-accent-500)', 'var(--color-accent-700)', 'var(--color-accent-800)'];
const fr = (n: number, digits: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * Dossier consolidé de la revue (ISO 9001 §9.3.2) sur le site sélectionné, arrêté à `asOf` (par défaut : la séance une
 * fois passée, sinon la date du jour) : période examinée, fenêtres d'événements, retards, programme, contrôles, statut des
 * certifications et indicateurs sécurité sont calculés à cette date (AUD-06). Les indicateurs d'état (compétences, DUERP,
 * prévention, documents, NC ouvertes) sont ceux du moment du calcul : d'où le dossier figé à la saisie du compte rendu.
 * Entièrement sérialisable : il est figé tel quel dans reviews.snapshot.
 */
export async function buildReviewDossier(review: Review, reviews: Review[], opts: { asOf?: string } = {}) {
  const db = await getDb();
  const asOf = opts.asOf ?? dossierAsOf(review.reviewOn, today());
  const [parts, events, controls, hours, siteRows, skills, risks, prevention, preventionSignals, documents, env, reqs, certs, plan, findings, findingLinks, site, allActions] = await Promise.all([
    buildRecordParts(review, reviews, asOf),
    loadEvents(),
    loadControls(),
    db.select().from(t.hoursWorked),
    db.select({ id: t.sites.id, archivedAt: t.sites.archivedAt }).from(t.sites),
    loadSkillMatrix(),
    loadRisks(),
    loadPrevention(),
    loadPreventionSignals(),
    loadDocuments(),
    loadEnvironment(yearOf(asOf)),
    db.select().from(t.requirements).orderBy(asc(t.requirements.sort), asc(t.requirements.id)),
    db.select().from(t.certifications).orderBy(asc(t.certifications.sort), asc(t.certifications.id)),
    // Éléments du programme annulés (AUD-03) : hors dossier.
    db.select().from(t.auditPlanItems).where(isNull(t.auditPlanItems.cancelledAt)).orderBy(asc(t.auditPlanItems.id)),
    // Constats annulés (saisis par erreur) : hors dossier.
    db.select().from(t.auditFindings).where(isNull(t.auditFindings.cancelledAt)).orderBy(asc(t.auditFindings.sort), asc(t.auditFindings.id)),
    db.select().from(t.findingActions),
    currentSiteId(),
    // Périmètre : le suivi des décisions des revues précédentes (communes à l'entreprise) lit leurs actions de tout site.
    loadAllActions('perimeter'),
  ]);
  const { rec, header, record } = parts;
  // AUD-13 et CNF-05 : objectifs de l'année de la date d'arrêt (cible TF1 comprise), contexte du système de management.
  const [objectiveData, contextData, target] = await Promise.all([loadObjectives(yearOf(asOf)), loadContext(), tf1Target(yearOf(asOf), site)]);
  const { now, people, prior } = rec;
  const from = header.from;
  const name = (id: string | null | undefined) => (id ? people.get(id)?.name ?? '—' : '—');
  // Actions existant à la date d'arrêt (un dossier arrêté à une séance passée ignore les actions créées depuis).
  const existed = (a: ActionRow) => asOf >= now || toParisLocal(a.createdAt).slice(0, 10) <= asOf;
  const actions = rec.actions.filter(existed);
  const byAction = new Map(allActions.map((a) => [a.id, a]));
  const brief = (a: ActionRow) => ({ ...actionBrief(a, people, asOf)!, href: actionHref(a.id) });
  const briefOf = (id: string | null) => {
    const a = id ? byAction.get(id) : undefined;
    return a ? brief(a) : null;
  };
  const eventActions = (eventId: string) => actions.filter((a) => a.eventId === eventId).map(brief);

  // 1. Suivi des décisions et actions des revues précédentes (AUD-05) : décisions sans action et actions annulées comprises.
  const previousFollowUp = reviewFollowUp({ prior, decisions: rec.decisionRows, actions: allActions, people, asOf, from });

  // Événements jusqu'à la date d'arrêt ; fenêtre de 12 mois [from, asOf].
  const known = events.filter((e) => e.occurredOn <= asOf);
  const last12 = known.filter((e) => e.occurredOn >= from);

  // 2. Indicateurs sécurité (TDB-04) : TF1 / TG sur les 12 derniers mois complets avant la date d'arrêt, sites du dossier ;
  // accidents de l'effectif seulement (workforceAccident).
  const sitesIn = siteRows.filter((s) => inSite(site, s.id)).map((s) => ({ id: s.id, archivedOn: s.archivedAt ? toParisLocal(s.archivedAt).slice(0, 10) : null }));
  const rates = safetyRates({ months: lastFullMonths(asOf), sites: sitesIn, hours: hours.filter((h) => inSite(site, h.siteId)), events: known });
  const lastArret = known.filter((e) => workforceAccident(e) && e.injury === 'arret').sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))[0];
  const pyramidRows = [
    { label: 'Accidents avec arrêt', n: last12.filter((e) => workforceAccident(e) && e.injury === 'arret').length },
    { label: 'Accidents sans arrêt', n: last12.filter((e) => workforceAccident(e) && (e.injury === 'sans_arret' || !e.injury)).length },
    { label: 'Soins', n: last12.filter((e) => workforceAccident(e) && e.injury === 'soins').length },
    { label: 'Presque-accidents', n: last12.filter((e) => e.type === 'PA').length },
    { label: 'Situations dangereuses', n: last12.filter((e) => e.type === 'SD').length },
  ];
  const pyrMax = Math.max(1, ...pyramidRows.map((p) => p.n));
  const missingMonths = new Set(rates.missing.map((m) => m.month)).size;
  const safety = {
    tf1: rates.tf1 == null ? '—' : fr(rates.tf1, 1),
    tg: rates.tg == null ? '—' : fr(rates.tg, 2),
    target,
    daysWithout: lastArret ? String(daysBetween(lastArret.occurredOn, asOf)) : '—',
    daysNote: lastArret ? `Dernier AT avec arrêt le ${fmtDate(lastArret.occurredOn)}` : 'Aucun accident avec arrêt enregistré',
    /** Mois de la fenêtre sans heures travaillées saisies (hors TF1 / TG). */
    missingMonths,
    pyramid: pyramidRows.map((p, i) => ({ ...p, w: `${Math.max(5, Math.round((p.n / pyrMax) * 100))}%`, color: PYRAMID_COLORS[i] })),
  };

  // 3. Non-conformités et événements (12 mois jusqu'à la date d'arrêt ; « ouverts » : en cours au moment du calcul)
  const byType = EVENT_TYPE_KEYS.map((k) => ({
    key: k, label: EVENT_TYPES[k].label, n12: last12.filter((e) => e.type === k).length, open: known.filter((e) => e.type === k && isOpen(e)).length,
  }));
  const ncLike = (o: string) => (e: (typeof events)[number]) => (o === 'Réclamation client' ? e.type === 'RC' || (e.type === 'NC' && e.ncOrigin === o) : e.type === 'NC' && e.ncOrigin === o);
  const ncByOrigin = [...NC_ORIGINS, 'Autre'].map((o) => {
    const match = o === 'Autre' ? (e: (typeof events)[number]) => e.type === 'NC' && (!e.ncOrigin || !NC_ORIGINS.includes(e.ncOrigin)) : ncLike(o);
    return { origin: o, n12: last12.filter(match).length, open: known.filter((e) => match(e) && isOpen(e)).length };
  }).filter((r) => r.origin !== 'Autre' || r.n12 + r.open > 0);
  const openNc = known.filter((e) => e.type === 'NC' && isOpen(e)).map((e) => ({
    id: e.id, occurredOn: e.occurredOn, title: e.title, origin: e.ncOrigin ?? '—', step: EVENT_STEPS[e.step], pilot: name(e.pilotId),
    actions: eventActions(e.id), href: eventHref(e.id),
  }));

  // 4. Réclamations clients
  const complaints = last12.filter((e) => e.type === 'RC').map((e) => ({
    id: e.id, occurredOn: e.occurredOn, title: e.title, project: e.keystoneProject, step: EVENT_STEPS[e.step], open: isOpen(e), pilot: name(e.pilotId),
    actions: eventActions(e.id), href: eventHref(e.id),
  }));

  // Programme : période examinée puis l'année suivant la revue ; état à la date d'arrêt. L'échéance de la revue elle-même
  // est réalisée dès que la revue est tenue (le dossier de séance est calculé avant l'écriture du compte rendu).
  const progFrom = from;
  const progTo = addMonths(review.reviewOn, 12);
  const held = review.status === 'tenue' || review.status === 'cloturee';
  const stateOf = (p: (typeof plan)[number]) => planItemState(p.reviewId === review.id && held ? { ...p, done: true, doneOn: p.doneOn ?? review.reviewOn } : p, asOf);
  const tracks = [...new Set(plan.map((p) => p.track))];
  const programme = plan
    .filter((p) => (p.plannedOn ? p.plannedOn >= progFrom && p.plannedOn <= progTo : monthEnd(p.year, p.month) >= progFrom && monthStart(p.year, p.month) <= progTo))
    .map((p) => {
      const key = stateOf(p);
      const linked = p.reviewId != null ? reviews.find((r) => r.id === p.reviewId) : undefined;
      return {
        id: p.id, year: p.year, month: p.month, track: p.track, label: p.label, detail: p.detail, plannedOn: p.plannedOn, doneOn: p.doneOn,
        auditor: p.auditor, owner: p.ownerId ? name(p.ownerId) : '', action: briefOf(p.actionId), postponedFrom: p.postponedFrom,
        state: { key, label: PLAN_ITEM_STATES[key].label, tone: PLAN_ITEM_STATES[key].tone as Tone },
        // Échéance d'une revue (AUD-01) : lien vers la carte de la revue.
        href: linked ? `/audits?annee=${yearOf(linked.reviewOn)}&revue=${linked.id}#revue` : `/audits?annee=${p.year}&element=${p.id}`,
      };
    })
    .sort((a, b) => a.year - b.year || a.month - b.month || tracks.indexOf(a.track) - tracks.indexOf(b.track));
  // Éléments annulés de la période (comptés seulement : ils sont hors programme).
  const cancelledCount = (await db.select({ year: t.auditPlanItems.year, month: t.auditPlanItems.month, plannedOn: t.auditPlanItems.plannedOn, cancelledAt: t.auditPlanItems.cancelledAt })
    .from(t.auditPlanItems))
    .filter((p) => p.cancelledAt && (asOf >= now || toParisLocal(p.cancelledAt).slice(0, 10) <= asOf))
    .filter((p) => (p.plannedOn ? p.plannedOn >= progFrom && p.plannedOn <= progTo : monthEnd(p.year, p.month) >= progFrom && monthStart(p.year, p.month) <= progTo)).length;
  const programmeCounts = {
    done: programme.filter((p) => p.state.key === 'done').length,
    pending: programme.filter((p) => p.state.key === 'late').length,
    upcoming: programme.filter((p) => p.state.key === 'upcoming').length,
    cancelled: cancelledCount,
    postponed: programme.filter((p) => !!p.postponedFrom).length,
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

  // 6. Audits et certifications (statut à la date d'arrêt)
  const nextAuditOf = (certId: string) => plan.filter((p) => p.certificationId === certId && stateOf(p) !== 'done')
    .map((p) => p.plannedOn ?? monthStart(p.year, p.month)).sort()[0] ?? null;
  const certViews = certs.map((c) => ({
    id: c.id, standard: c.standard, domain: c.domain, tone: c.tone, note: c.note, organization: c.organization, validUntil: c.validUntil,
    status: certificationStatus(c, nextAuditOf(c.id), asOf),
  }));
  // Libellé d'audit avec son mois (« Processus Production · juin 2026 ») : deux audits d'un même processus restent distincts.
  const planLabel = new Map(plan.map((p) => [p.id, planItemAuditLabel(p)]));
  const groups = new Map<string, { label: string; first: number; findings: DossierFinding[] }>();
  const actionsOfFinding = findingActionsBy(findingLinks, briefOf);
  findings.filter((f) => !f.foundOn || f.foundOn <= asOf).forEach((f) => {
    const label = (f.planItemId ? planLabel.get(f.planItemId) : null) ?? f.audit;
    const g = groups.get(label) ?? { label, first: f.id, findings: [] };
    const k = FINDING_KINDS[f.kind] ?? { label: f.kind, tone: 'neutral' as Tone };
    g.findings.push({ id: f.id, kind: f.kind, kindLabel: k.label, tone: k.tone, text: f.text, clause: f.clause, actions: actionsOfFinding(f.id) });
    g.first = Math.min(g.first, f.id);
    groups.set(label, g);
  });
  const auditGroups = [...groups.values()].sort((a, b) => b.first - a.first).map(({ label, findings: list }) => ({ label, findings: list }));

  // 7. Plan d'actions par source (§ 12), sur le site sélectionné : avancements actuels, retards à la date d'arrêt ; Vérifiées
  // pendant la période examinée (closed_on = date de la vérification).
  const siteActions = actions.filter((a) => inSite(site, a.siteId));
  const row = (key: string, label: string, list: ActionRow[]): DossierActionRow => ({
    key, label,
    open: list.filter((a) => isOpenAvancement(a.status) || a.status === 'reportee').length,
    late: list.filter((a) => isLate(a, asOf)).length,
    verify: list.filter((a) => a.status === 'terminee').length,
    closed: list.filter((a) => a.status === 'verifiee' && !!a.closedOn && a.closedOn >= from && a.closedOn <= asOf).length,
  });
  const bySource = [
    ...SOURCE_KEYS.map((key) => row(key, ACTION_SOURCES[key].label, siteActions.filter((a) => a.source === key))),
    row('a_completer', SOURCE_TO_COMPLETE.label, siteActions.filter((a) => !a.source)),
  ].filter((r) => r.open + r.verify + r.closed > 0);
  const totals = bySource.reduce((s, r) => ({ open: s.open + r.open, late: s.late + r.late, verify: s.verify + r.verify, closed: s.closed + r.closed }), { open: 0, late: 0, verify: 0, closed: 0 });
  const lateActions = siteActions.filter((a) => isLate(a, asOf))
    .map((a) => ({ ...brief(a), origin: a.source ? ACTION_SOURCES[a.source].label : SOURCE_TO_COMPLETE.label, originRef: a.originRef }))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const actionsSection: DossierActions = { bySource, totals, lateActions };

  // 8. Veille réglementaire et contrôles périodiques (échéances des contrôles à la date d'arrêt)
  const liveReqs = reqs.filter((r) => !r.archivedAt);
  const requirements = liveReqs.map((r) => {
    const ev = REQUIREMENT_EVAL[r.evaluation] ?? { label: r.evaluation, tone: 'neutral' as Tone };
    // VEI-03 : exigence suivie par des contrôles : échéance du prochain contrôle rattaché.
    const due = requirementDue(r, controls);
    return {
      id: r.id, text: r.text, domain: r.domain, evalLabel: ev.label, evalNote: r.evaluationNote, tone: ev.tone, lastEvaluatedOn: r.lastEvaluatedOn,
      dueOn: due.on, dueNote: due.control ? 'prochain contrôle' : r.dueNote, pilot: name(r.pilotId), action: briefOf(r.actionId), href: `/veille?exigence=${r.id}`,
    };
  });
  const requirementCounts = Object.entries(REQUIREMENT_EVAL).map(([key, ev]) => ({ key, label: ev.label, tone: ev.tone, n: liveReqs.filter((r) => r.evaluation === key).length }));
  const ctrl = controls.map((c) => ({ c, s: controlStatus(c, asOf) }));
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
    // Échéances calculées sur tout le périmètre (TDB-05) : le dossier ne garde que celles du site sélectionné.
    gaps: preventionSignals.todo.filter((s) => inSite(site, s.siteId)).map((s) => ({ date: s.date, title: s.title, tone: s.tone, href: s.href ?? '/prevention' })),
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

  // 12. Performance environnementale (année de la date d'arrêt)
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
    previousFollowUp,
    safety,
    events: { byType, ncByOrigin, openNc },
    complaints,
    suppliers,
    audits: { certs: certViews, progFrom, progTo, programme, programmeCounts, auditGroups, programmeHref: `/audits?annee=${yearOf(review.reviewOn)}` },
    actions: actionsSection,
    watch: { requirements, requirementCounts, controls: controlView },
    risks: riskView,
    prevention: preventionView,
    documents: documentView,
    environment,
    // HAB-18 : taux de conformité, formations sur 12 mois (efficacité évaluée à froid, HAB-13), recyclages en retard.
    skills: { counts: skillCounts, alerts: skillAlerts, indicators: skillIndicators(skills.rows, asOf), href: '/habilitations' },
    // §9.3.2 c (AUD-13) : degré de réalisation des objectifs ; valeurs calculées à la date d'arrêt du dossier.
    objectives: objectiveData.objectives.map((o) => ({
      label: o.label, indicator: o.indicatorLabel, target: fmtObjectiveTarget(o.indicator, o.target), value: fmtObjectiveValue(o.indicator, o.value),
      status: o.status.label, tone: o.status.tone, site: o.site,
    })),
    // §9.3.2 b et e (CNF-05) : enjeux, parties intéressées, risques et opportunités et leur traitement.
    context: contextData.groups.filter((g) => g.items.length).map((g) => ({
      kind: g.kind, label: g.plural, clause: g.clause, items: g.items.map((i) => ({ label: i.label, detail: i.detail, treatment: i.treatment })),
    })),
    checklist: rec.checklist,
    decisions: rec.decisions,
    extraActions: rec.extraActions,
  };
}
export type ReviewDossier = Awaited<ReturnType<typeof buildReviewDossier>>;

/** Compte rendu seul : revue clôturée avant Vigie, sans dossier figé ; parties du dossier qui suivent le compte rendu. */
export type ReviewRecordOnly = Pick<ReviewDossier, 'header' | 'record' | 'checklist' | 'decisions' | 'extraActions'>;

/**
 * Dossier de séance (`base`, sections arrêtées à la séance) complété du compte rendu courant (`live`) : la période et le
 * périmètre restent ceux de la séance ; compte rendu, check-list, décisions, actions de la revue et statut suivent la revue.
 */
export function withRecordParts<D extends ReviewRecordOnly>(base: D, live: ReviewRecordOnly): D {
  return {
    ...base,
    header: { ...base.header, status: live.header.status },
    record: live.record,
    checklist: live.checklist,
    decisions: live.decisions,
    extraActions: live.extraActions,
  };
}

/**
 * Page /revue-de-direction : dossier figé au visa (revue clôturée dans Vigie), compte rendu seul (revue clôturée antérieure
 * à Vigie), avis d'annulation (revue annulée), dossier de séance (revue tenue : sections figées à la saisie du compte rendu,
 * compte rendu courant), sinon dossier préparatoire calculé (arrêté à la séance une fois sa date passée).
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
    const on = review.cancelledAt ? parisDay(review.cancelledAt) : null;
    return { ...base, mode: 'cancelled' as const, dossier: null, cancel: { on, by, reason: review.cancelReason, kind: kindOf(review.kind).label } };
  }
  const snap = parseReviewSnapshot(review.snapshot);
  if (review.status === 'cloturee') {
    // AUD-34 : rectificatifs signés après le visa, affichés avec le dossier figé (qui reste inchangé).
    const corrections = (await loadReviewCorrections([review.id])).get(review.id) ?? [];
    if (snap) {
      return { ...base, mode: 'snapshot' as const, dossier: snap.dossier, asOf: snap.asOf, takenOn: snap.takenOn, takenBy: snap.takenBy, seance: snap.seance ?? null, corrections };
    }
    return { ...base, mode: 'record' as const, dossier: null, record: await reviewRecordParts(review, reviews), corrections };
  }
  if (review.status === 'tenue' && snap?.phase === 'seance') {
    const dossier = withRecordParts(snap.dossier, await reviewRecordParts(review, reviews, snap.asOf));
    return { ...base, mode: 'seance' as const, dossier, asOf: snap.asOf, takenOn: snap.takenOn, takenBy: snap.takenBy };
  }
  const dossier = await buildReviewDossier(review, reviews);
  return { ...base, mode: 'live' as const, dossier, asOf: dossier.header.asOf };
}
export type ReviewDossierPage = Awaited<ReturnType<typeof loadReviewDossierPage>>;

// ─── Échéances du domaine (tableau de bord, À faire, notifications, badge) ──

/**
 * Échéances de la revue de direction (href /audits?revue=<id>), pour chaque revue planifiée ou tenue :
 * éléments d'entrée attendus des contributeurs (en retard, ou à remettre sous 15 jours ; jamais les éléments
 * automatiques), compte rendu à saisir après la date de la revue, visa et dossier à clôturer (REVIEW_CLOSE_DAYS).
 * Communes à tous les sites (siteId null). Visibilité : visibleTodo (src/lib/todo-visibility.ts) ; un contributeur de
 * l'annuaire sans l'écran Audits (salarié) suit le lien de lecture readHref, « Mes contributions » (AUD-04, TDB-02).
 */
export const loadReviewSignals = cache(async (): Promise<{ badge?: number; todo: TodoItem[] }> => {
  const db = await getDb();
  const now = today();
  const horizon = addDays(now, TODO_HORIZON_DAYS);
  const [reviews, items, people, leads, decisions, actions] = await Promise.all([
    loadReviews(), db.select().from(t.reviewItems), loadPeople(), loadQhseLeads(),
    db.select().from(t.reviewDecisions).orderBy(asc(t.reviewDecisions.sort), asc(t.reviewDecisions.id)),
    db.select({ id: t.actions.id, status: t.actions.status }).from(t.actions),
  ]);
  // Compte rendu et visa : la direction (dernier rôle connu) et les responsables QHSE ; contributions sans contributeur
  // de l'annuaire : les responsables QHSE.
  const qhse = leads.forSite(null);
  const director = leads.directors[0];
  const closers = [...new Set([...(director ? [director.id] : []), ...qhse.ownerIds])];
  const name = (id: string | null) => (id ? people.get(id)?.name ?? '' : '');
  const kind = 'Revue de direction';
  const todo: TodoItem[] = [];
  reviews.filter(isEditableReview).forEach((r) => {
    const href = `/audits?annee=${yearOf(r.reviewOn)}&revue=${r.id}#revue`;
    const day = fmtDayMonth(r.reviewOn);
    items.filter((i) => i.reviewId === r.id && !i.done && !!i.dueOn && !REVIEW_SOURCES[sourceOf(i.source)].auto).forEach((i) => {
      const who = name(i.ownerId) || i.owner;
      const ownerIds = i.ownerId ? [i.ownerId] : qhse.ownerIds;
      const links = { href, ...(i.ownerId ? { readHref: `/audits/contributions?revue=${r.id}` } : {}) };
      if (i.dueOn! < now) {
        todo.push({ date: now, dueOn: i.dueOn!, kind, tone: 'danger', title: `${i.label} — attendu le ${fmtDayMonth(i.dueOn!)} · revue du ${day}`, who, ...links, ownerIds, overdue: true, siteId: null });
      } else if (i.dueOn! <= horizon) {
        todo.push({ date: i.dueOn!, dueOn: i.dueOn!, kind, tone: 'warn', title: `${i.label} · revue du ${day}`, who, ...links, ownerIds, siteId: null });
      }
    });
    if (r.status === 'planifiee' && r.reviewOn < now) {
      todo.push({ date: now, dueOn: r.reviewOn, kind, tone: 'danger', title: `Revue de direction du ${day} — compte rendu à saisir`, who: director?.name ?? qhse.who, href, ownerIds: closers, overdue: true, siteId: null });
    }
    if (r.status === 'tenue' && addDays(r.reviewOn, REVIEW_CLOSE_DAYS) < now) {
      todo.push({ date: now, dueOn: addDays(r.reviewOn, REVIEW_CLOSE_DAYS), kind, tone: 'warn', title: `Revue de direction du ${day} — visa de la direction et dossier à clôturer`, who: director?.name ?? qhse.who, href, ownerIds: closers, overdue: true, siteId: null });
    }
  });

  // AUD-16 : décision d'une revue tenue ou clôturée restée sans suite à son échéance — sans action au plan, action
  // abandonnée, ou action encore ouverte (une action Terminée attend sa vérification : pas d'alerte ici).
  const actionById = new Map(actions.map((a) => [a.id, a]));
  reviews.filter((r) => r.status === 'tenue' || r.status === 'cloturee').forEach((r) => {
    const href = `/audits?annee=${yearOf(r.reviewOn)}&revue=${r.id}#revue`;
    decisions.filter((d) => d.reviewId === r.id && !d.cancelledAt && !!d.dueOn && d.dueOn < now).forEach((d) => {
      const a = d.actionId ? actionById.get(d.actionId) : undefined;
      const state = decisionFollowUpGap(a?.status ?? null, !!d.actionId);
      if (!state) return;
      const label = REVIEW_DECISION_KINDS[d.kind as ReviewDecisionKind]?.label ?? 'Décision';
      todo.push({
        date: now, dueOn: d.dueOn!, kind, tone: 'danger', overdue: true, siteId: null, key: `revue-decision|${d.id}`,
        title: `${label} de la revue du ${fmtDayMonth(r.reviewOn)} sans suite — ${state === 'none' ? 'aucune action au plan' : state === 'abandoned' ? `action ${d.actionId} abandonnée` : `action ${d.actionId} non close`} (échéance ${fmtDayMonth(d.dueOn!)}) · ${clipText(d.text, 70)}`,
        who: name(d.pilotId) || qhse.who, href, ...(d.pilotId ? { readHref: `/audits/contributions?revue=${r.id}` } : {}),
        ownerIds: d.pilotId ? [...new Set([d.pilotId, ...qhse.ownerIds])] : qhse.ownerIds,
      });
    });
  });

  // AUD-16 : prochaine revue non planifiée (ISO 9001 §9.3.1, revue à intervalles planifiés) — aucune revue planifiée après
  // la dernière revue tenue ou clôturée.
  const last = reviews.filter((r) => r.status === 'tenue' || r.status === 'cloturee').sort((a, b) => b.reviewOn.localeCompare(a.reviewOn) || b.id - a.id)[0];
  if (last && !reviews.some((r) => r.status === 'planifiee' && r.reviewOn > last.reviewOn)) {
    todo.push({
      date: now, dueOn: last.reviewOn, kind, tone: 'warn', siteId: null, key: `revue-prochaine|${last.id}`,
      title: `Prochaine revue de direction à planifier (dernière revue le ${fmtDate(last.reviewOn)})`,
      who: director?.name ?? qhse.who, href: `/audits?annee=${yearOf(last.reviewOn)}&revue=${last.id}#revue`, ownerIds: closers,
    });
  }
  return { todo };
});

// ─── « Mes contributions » (/audits/contributions, AUD-04) ──────────────────

export type Involvement = 'participant' | 'contributor' | 'pilot';
export const INVOLVEMENT_LABELS: Record<Involvement, string> = {
  participant: 'Participant à la séance', contributor: 'Contributeur', pilot: 'Pilote d’une décision',
};

/**
 * Lien de la personne avec une revue : participant à la séance, contributeur d'un élément de la check-list, pilote d'une
 * décision (dans cet ordre de priorité) ; null sinon.
 */
export function involvement(
  review: Pick<Review, 'id' | 'participantIds'>, userId: string,
  items: Pick<ReviewItemRow, 'reviewId' | 'ownerId'>[], decisions: Pick<ReviewDecisionRow, 'reviewId' | 'pilotId'>[],
): Involvement | null {
  if (participantIdsOf(review).includes(userId)) return 'participant';
  if (items.some((i) => i.reviewId === review.id && i.ownerId === userId)) return 'contributor';
  if (decisions.some((d) => d.reviewId === review.id && d.pilotId === userId)) return 'pilot';
  return null;
}

/**
 * Revues de direction qui concernent la personne connectée, quel que soit son rôle (AUD-04) : les modifiables d'abord,
 * puis la plus récente. Pour chacune : ses éléments de la check-list (case « fourni » tant que la revue est modifiable),
 * l'avancement de la préparation et, une revue tenue ou clôturée, son compte rendu (lu dans le dossier figé d'une revue
 * clôturée dans Vigie). Un salarié ne voit le statut d'une action de décision que s'il en est le pilote.
 */
export async function loadMyContributions({ revue }: { revue?: string | string[] }) {
  const db = await getDb();
  const now = today();
  const [session, reviews, items, decisionRows, people, actions] = await Promise.all([
    getSession(), loadReviews(),
    db.select().from(t.reviewItems).orderBy(asc(t.reviewItems.sort), asc(t.reviewItems.id)),
    db.select().from(t.reviewDecisions).orderBy(asc(t.reviewDecisions.sort), asc(t.reviewDecisions.id)),
    loadPeople(),
    // Actions du périmètre de la personne (décisions communes à l'entreprise) : pas de fiche d'action hors périmètre.
    loadAllActions('perimeter'),
  ]);
  const { role, user } = session;
  const employee = isEmployee(role);
  const byAction = new Map(actions.map((a) => [a.id, a]));
  const name = (id: string | null) => (id ? people.get(id)?.name ?? '—' : '—');
  const mine = reviews
    .filter((r) => !isCancelled(r))
    .map((r) => ({ r, as: involvement(r, user.id, items, decisionRows) }))
    .filter((x): x is { r: Review; as: Involvement } => !!x.as)
    .sort((a, b) => Number(isEditableReview(b.r)) - Number(isEditableReview(a.r)) || b.r.reviewOn.localeCompare(a.r.reviewOn) || b.r.id - a.r.id);

  // AUD-17 : pièces jointes des éléments de la personne.
  const myItemFiles = await loadEntityFiles('review_item', items.filter((i) => i.ownerId === user.id).map((i) => i.id));
  const entries = await Promise.all(mine.map(async ({ r, as }) => {
    const ready = await autoReady(priorReviews(reviews, r).length > 0);
    const list = items.filter((i) => i.reviewId === r.id).map((i) => itemView(i, ready, people, now));
    const editable = isEditableReview(r);
    const view = reviewView(r, people);
    const held = r.status === 'tenue' || r.status === 'cloturee';
    const decisionsOf = (): DecisionView[] => decisionRows.filter((d) => d.reviewId === r.id).map((d) => {
      const k = REVIEW_DECISION_KINDS[d.kind as ReviewDecisionKind] ?? REVIEW_DECISION_KINDS.decision;
      // Salarié : statut de l'action pour ses propres décisions seulement (référence seule sinon).
      const shown = !employee || d.pilotId === user.id;
      return {
        id: d.id, kind: d.kind as ReviewDecisionKind, kindLabel: k.label, tone: k.tone, text: d.text, pilotId: d.pilotId, pilot: name(d.pilotId),
        dueOn: d.dueOn, actionId: d.actionId, action: d.actionId && shown ? actionBrief(byAction.get(d.actionId), people, now) : null, sort: d.sort,
        cancelled: decisionCancel(d, people),
      };
    });
    // Compte rendu : dossier figé au visa (revue clôturée dans Vigie), sinon la revue elle-même.
    const snap = r.status === 'cloturee' ? parseReviewSnapshot(r.snapshot) : null;
    const frozen = snap?.phase === 'cloture' ? snap.dossier : null;
    const record = !held ? null : frozen ? {
      participants: frozen.record?.participants ?? [], externalParticipants: frozen.record?.externalParticipants ?? null,
      minutes: frozen.record?.minutes ?? null, customerPerception: frozen.record?.customerPerception ?? null,
      resourceNeeds: frozen.record?.resourceNeeds ?? null, nextReviewOn: frozen.record?.nextReviewOn ?? null,
      visa: frozen.record?.closedOn ? { by: frozen.record.closedBy ?? '—', on: frozen.record.closedOn } : null,
      decisions: (frozen.decisions ?? []).map((d) => ({ ...d, action: !employee || d.pilotId === user.id ? d.action : null })),
    } : {
      participants: view.participants, externalParticipants: view.externalParticipants, minutes: view.minutes,
      customerPerception: view.customerPerception, resourceNeeds: view.resourceNeeds, nextReviewOn: view.nextReviewOn,
      visa: view.closedOn ? { by: view.closedBy ?? '—', on: view.closedOn } : null,
      decisions: decisionsOf(),
    };
    return {
      id: r.id, reviewOn: r.reviewOn, kind: view.kindLabel, kindShort: view.kindShort, status: view.status, statusLabel: view.statusLabel,
      statusTone: view.statusTone, editable, involvement: as, involvementLabel: INVOLVEMENT_LABELS[as],
      myItems: list.filter((i) => !i.auto && i.ownerId === user.id).map((i) => ({ ...i, canToggle: editable, files: myItemFiles.get(String(i.id)) ?? [] })),
      progress: { provided: list.filter((i) => i.done).length, total: list.length },
      record,
      openHref: canSee(role, 'audits') ? `/audits?annee=${yearOf(r.reviewOn)}&revue=${r.id}#revue` : null,
      dossierHref: canReadReviewDossier(role) ? `/revue-de-direction?revue=${r.id}` : null,
    };
  }));
  const asked = typeof revue === 'string' && /^\d+$/.test(revue) ? +revue : null;
  return { now, userId: user.id, reviews: entries, focus: entries.some((e) => e.id === asked) ? asked : null };
}
export type MyContributions = Awaited<ReturnType<typeof loadMyContributions>>;
export type MyContribution = MyContributions['reviews'][number];
