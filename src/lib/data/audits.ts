import 'server-only';
import { cache } from 'react';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { REVIEW_TRACK, isReviewPlanItem } from '@/components/audits/shared';
import type { ChangeEntry } from '@/components/ChangeLog';
import { isLate } from '../action-rules';
import { hasLeft } from '../people';
import { addDays, daysBetween, fmtDate, fmtDayMonth, monthName, monthOf, yearOf, parisDay } from '../dates';
import { today } from '@/lib/today';
import {
  CERT_RENEWAL_NOTICE_DAYS, CERT_SOON_DAYS, FINDING_GAP_KINDS, FINDING_KINDS, REVIEW_STATUS, TODO_HORIZON_DAYS, planTrackKind,
  type PlanItemState, type ReviewStatus, type TodoItem, type Tone,
} from '../domain';
import { actionBrief, certificationStatus, loadAllActions, loadPeople, type ActionBrief } from '../queries';
import { loadQhseLeads } from './leads';
import { loadChangeLogs } from './changelog';
import type { Option } from './options';
import { missingDetail } from '@/lib/url-state';
import { currentSiteId, getSession, inPerimeter, inSite } from '../session';
import { ALL_SITES } from '../domain';

// ─── Audits et certifications ───────────────────────────────────────────────

export type Certification = typeof t.certifications.$inferSelect;

// ActionBrief / actionBrief : déplacés dans src/lib/queries.ts (partagés avec la revue de direction).
export type { ActionBrief } from '../queries';

/** Pièce jointe affichée en lien (rapport d'audit, certificat). */
export type AttachmentBrief = { id: string; fileName: string; createdAt: string };

export type PlanItemView = {
  id: number; year: number; track: string; month: number; label: string;
  plannedOn: string | null; detail: string | null; ownerId: string | null; owner: string;
  done: boolean; doneOn: string | null; auditor: string | null; scope: string | null; certificationId: string | null;
  /** AUD-27 : auditeur interne (personne) ; `auditor` reste le texte d'un auditeur ou organisme externe. */
  auditorId: string | null; auditorName: string;
  /** Auditeur affiché : auditeur interne puis externe (« L. Moreau · [Organisme] »), vide sans auditeur. */
  auditorLabel: string;
  /** AUD-27 : auditeur interne sans titre valide d'auditeur interne à la date de l'audit (signalé, jamais refusé). */
  auditorUnqualified: boolean;
  /** AUD-22 : site audité (null : commun à l'entreprise) et son libellé (« Tous les sites »). */
  siteId: string | null; site: string;
  /** AUD-20 : audit hors programme (non planifié), enregistré réalisé ; hors échéances du programme. */
  unplanned: boolean;
  actionId: string | null; action: ActionBrief | null;
  state: PlanItemState; reports: AttachmentBrief[]; findingCount: number;
  /** Nature de l'élément selon sa ligne (Audit interne, Visite sécurité…). */
  kind: string;
  /** Échéance qui porte une revue de direction (ni auditeur ni constats). */
  isReview: boolean;
  /** Revue de direction rattachée (AUD-01) : sa date, sa réalisation et son annulation suivent la revue. */
  reviewId: number | null;
  review: { id: number; statusLabel: string; statusTone: Tone; href: string } | null;
  /** Élément verrouillé dans le programme (revue rattachée) : consultation et « Ouvrir la revue » seulement. */
  locked: boolean;
  /** Première planification (date prévue, sinon le 1er du mois) avant le premier report ; null = jamais reporté (AUD-03). */
  postponedFrom: string | null;
  /** Annulation (AUD-03) : hors grille, échéances, constats et dossier ; liste « Éléments annulés ». */
  cancelled: { on: string; by: string; reason: string } | null;
  /** « Reporter… » possible : ni réalisé, ni annulé, ni verrouillé (revue). */
  reschedulable: boolean;
  /** « Annuler l'élément » possible : reportable, sans action, constat (même annulé) ni rapport. Sinon l'audit a eu lieu. */
  cancellable: boolean;
  log: ChangeEntry[];
};

export type FindingView = {
  id: number; audit: string; planItemId: number | null; clause: string | null; foundOn: string | null;
  kind: string; text: string; sort: number;
  /** Actions du constat (AUD-28 : plusieurs par constat, table finding_actions), par numéro ; `action` null hors périmètre (numéro seul). */
  actions: FindingAction[];
  /** Réponse attendue (plan d'actions) au plus tard le (écarts, AUD-09). */
  responseDueOn: string | null;
  /** Ligne du programme de l'élément rattaché (source de l'action, D20) ; null hors programme. */
  track: string | null;
  /** Annulation (constat saisi par erreur ou en double) : hors groupes et échéances, visible avec le filtre « Annulés ». */
  cancelled: { on: string; by: string; reason: string } | null;
  /** AUD-22 : site du constat (celui de son audit ; null : commun à l'entreprise). */
  siteId: string | null;
  log: ChangeEntry[];
};
/** Action d'un constat : numéro, et résumé si la personne peut la lire (sinon null, numéro seul). */
export type FindingAction = { id: string; action: ActionBrief | null };
/** Constat annulé, avec le libellé de son audit (filtre « Annulés »). */
export type CancelledFindingView = FindingView & { cancelled: NonNullable<FindingView['cancelled']>; groupLabel: string };
/** Constats d'un même audit : élément du programme (clé p<id>) ou libellé libre hors programme (clé l<libellé>). */
export type AuditGroup = {
  key: string; label: string; planItemId: number | null; year: number | null; date: string | null; auditor: string | null;
  reports: AttachmentBrief[]; findings: FindingView[];
  /** AUD-20 : audit hors programme enregistré (élément `unplanned`), ou libellé libre d'un constat antérieur (planItemId null). */
  unplanned: boolean;
};

/** Référentiel avec son statut calculé, ses audits rattachés au programme et son certificat. */
export type CertView = Certification & {
  /** AUD-22 : site couvert (« Tous les sites » : certificat de l'entreprise). */
  site: string;
  state: { label: string; tone: Tone };
  nextAudit: { id: number; year: number; plannedOn: string } | null;
  lastAudit: { id: number; year: number; doneOn: string | null; findingCount: number } | null;
  files: AttachmentBrief[];
  /** Suppression possible : jamais certifié (ni émission ni fin de validité), sans audit au programme ni certificat. */
  removable: boolean;
  log: ChangeEntry[];
};

/** Borne de fin de mois pour les comparaisons de chaînes ISO (le « 31 » vaut pour tous les mois). */
const monthEnd = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-31`;

type PlanLike = {
  year: number; month: number; label: string; detail: string | null; plannedOn: string | null; done: boolean; doneOn?: string | null;
  cancelledAt?: Date | null;
};

/**
 * Annulé, réalisé (au plus tard à `now` : un dossier arrêté à la séance ne compte pas une réalisation postérieure),
 * échéance passée non confirmée (« à confirmer »), ou à venir.
 */
export const planItemState = (p: PlanLike, now: string): PlanItemState =>
  p.cancelledAt ? 'cancelled'
    : p.done && (!p.doneOn || p.doneOn <= now) ? 'done'
      : (p.plannedOn ?? monthEnd(p.year, p.month)) < now ? 'late' : 'upcoming';

/** Début de la planification d'un élément : date prévue, sinon le 1er du mois prévu (première planification d'un report). */
export const planStart = (p: { year: number; month: number; plannedOn: string | null }) =>
  p.plannedOn ?? `${p.year}-${String(p.month).padStart(2, '0')}-01`;

/** Libellé court qui reprend la date (« Annuelle 10/12 ») : le jour et le mois de `from` deviennent ceux de `to`. */
export const relabelDay = (label: string, from: string | null | undefined, to: string | null | undefined) =>
  from && to ? label.replace(fmtDayMonth(from), fmtDayMonth(to)) : label;

type SlotItem = {
  id: number; year: number; month: number; track: string; label: string; detail: string | null; done: boolean;
  reviewId: number | null; cancelledAt: Date | null;
};

/**
 * Place d'une revue de direction au programme annuel (AUD-01), parmi les éléments non annulés du mois de la revue :
 * - `adopt` : échéance de revue saisie au seul programme (sans revue rattachée, non réalisée), de préférence sur la ligne
 *   « Revues de direction » — la revue la reprend ;
 * - `create` : sinon, l'échéance est créée sur la ligne « Revues de direction » (AUD-21 : plusieurs éléments par ligne et
 *   par mois, un mois déjà occupé ne laisse plus la revue « hors programme »).
 */
export function reviewSlot(items: SlotItem[], reviewOn: string): { adopt: number } | { create: true } {
  const month = items.filter((p) => !p.cancelledAt && p.year === yearOf(reviewOn) && p.month === monthOf(reviewOn));
  const free = month.filter((p) => p.reviewId == null && !p.done && isReviewPlanItem(p));
  const pick = free.find((p) => p.track === REVIEW_TRACK) ?? free[0];
  return pick ? { adopt: pick.id } : { create: true };
}

/** Libellé d'audit repris par les constats rattachés à un élément du programme (« Processus Production · juin 2026 »). */
export const planItemAuditLabel = (p: Pick<PlanLike, 'year' | 'month' | 'label' | 'detail'>) => `${p.detail ?? p.label} · ${monthName(p.month)} ${p.year}`;

// isReviewPlanItem : règle partagée avec le formulaire du programme (src/components/audits/shared.ts).
export { isReviewPlanItem };

/** Date de référence d'un élément du programme (tri, constats) : réalisation, date prévue, sinon fin du mois. */
const planDate = (p: { year: number; month: number; plannedOn: string | null; doneOn: string | null }) => p.doneOn ?? p.plannedOn ?? monthEnd(p.year, p.month);

/**
 * Actions de chaque constat (finding_actions, AUD-28), par numéro d'action croissant (A-9 avant A-10) ; `brief` résume une
 * action (null hors périmètre de la personne : numéro seul).
 */
export function findingActionsBy<B extends ActionBrief | null>(rows: { findingId: number; actionId: string }[], brief: (id: string) => B) {
  const by = new Map<number, string[]>();
  rows.forEach((r) => by.set(r.findingId, [...(by.get(r.findingId) ?? []), r.actionId]));
  return (findingId: number): { id: string; action: B }[] => (by.get(findingId) ?? [])
    .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
    .map((id) => ({ id, action: brief(id) }));
}

/**
 * Programme, constats et certifications. `withLogs` : historique de chaque fiche (écran Audits) ; les échéances
 * (loadAuditSignals) s'en passent (QUA-17 : trois lectures du journal en moins par page).
 */
const readAudits = cache(async (withLogs: boolean) => {
  const db = await getDb();
  const [certs, items, findings, findingLinks, actions, people, files, reviews, sites, auditorTitles, auditorQuals, hiddenTracks] = await Promise.all([
    db.select().from(t.certifications).orderBy(asc(t.certifications.sort), asc(t.certifications.id)),
    // Éléments annulés compris (AUD-03) : hors grille, échéances et constats, ils restent consultables (« Éléments annulés »).
    db.select().from(t.auditPlanItems).orderBy(asc(t.auditPlanItems.id)),
    db.select().from(t.auditFindings).orderBy(asc(t.auditFindings.sort), asc(t.auditFindings.id)),
    db.select().from(t.findingActions),
    // Actions de tout le périmètre de la personne (pas seulement du site sélectionné) : un constat ou une échéance, communs à
    // l'entreprise, gardent leur action liée quel que soit le site affiché ; hors périmètre, la référence seule (ActionLink).
    loadAllActions('perimeter'),
    loadPeople(),
    db.select({ id: t.attachments.id, entityType: t.attachments.entityType, entityId: t.attachments.entityId, fileName: t.attachments.fileName, createdAt: t.attachments.createdAt })
      .from(t.attachments).where(inArray(t.attachments.entityType, ['audit_plan_item', 'certification'])).orderBy(asc(t.attachments.createdAt)),
    // Revues portées par les échéances du programme (AUD-01).
    db.select({ id: t.reviews.id, reviewOn: t.reviews.reviewOn, status: t.reviews.status, kind: t.reviews.kind }).from(t.reviews),
    db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites),
    // AUD-27 : titres qui qualifient un auditeur interne, et formations (non annulées) de ces titres.
    db.select({ id: t.trainingTitles.id }).from(t.trainingTitles).where(and(eq(t.trainingTitles.internalAuditor, true), isNull(t.trainingTitles.archivedAt))),
    db.select({ personId: t.qualifications.personId, titleId: t.qualifications.titleId, obtainedOn: t.qualifications.obtainedOn, expiresOn: t.qualifications.expiresOn })
      .from(t.qualifications).innerJoin(t.trainingTitles, eq(t.trainingTitles.id, t.qualifications.titleId))
      .where(and(eq(t.trainingTitles.internalAuditor, true), isNull(t.qualifications.cancelledAt))),
    // AUD-24 : lignes masquées par année.
    db.select().from(t.auditPlanTracks),
  ]);
  const none = new Map<string, ChangeEntry[]>();
  const [findingLogs, planLogs, certLogs] = withLogs ? await Promise.all([
    loadChangeLogs('audit_finding', findings.map((f) => f.id)),
    loadChangeLogs('audit_plan_item', items.map((p) => p.id)),
    loadChangeLogs('certification', certs.map((c) => c.id)),
  ]) : [none, none, none];
  const now = today();
  const actionsById = new Map(actions.map((a) => [a.id, a]));
  const reviewsById = new Map(reviews.map((r) => [r.id, r]));
  const brief = (id: string | null) => (id ? actionBrief(actionsById.get(id), people, now) : null);
  const name = (id: string | null) => (id ? people.get(id)?.name ?? '' : '');
  const filesOf = (entityType: string, id: string | number) => files
    .filter((f) => f.entityType === entityType && f.entityId === String(id))
    .map((f) => ({ id: f.id, fileName: f.fileName, createdAt: f.createdAt.toISOString() }));

  const siteLabel = new Map(sites.map((x) => [x.id, x.label.split(' — ')[0]]));
  const siteName = (id: string | null) => (id ? siteLabel.get(id) ?? id : 'Tous les sites');
  // AUD-27 : qualification d'auditeur interne valide à la date de l'audit (obtenue avant, non expirée) — signalée seulement.
  const qualifiedAuditor = (personId: string, on: string) => auditorQuals.some((q) => q.personId === personId && q.obtainedOn <= on && (!q.expiresOn || q.expiresOn >= on));
  const trackOf = new Map(items.map((p) => [p.id, p.track]));
  const actionsOf = findingActionsBy(findingLinks, brief);
  const findingViews: FindingView[] = findings.map((f) => ({
    id: f.id, audit: f.audit, planItemId: f.planItemId, clause: f.clause, foundOn: f.foundOn,
    kind: f.kind, text: f.text, sort: f.sort, actions: actionsOf(f.id), responseDueOn: f.responseDueOn,
    track: f.planItemId != null ? trackOf.get(f.planItemId) ?? null : null,
    cancelled: f.cancelledAt ? { on: parisDay(f.cancelledAt), by: name(f.cancelledById), reason: f.cancelReason ?? '' } : null,
    siteId: f.siteId,
    log: findingLogs.get(String(f.id)) ?? [],
  }));
  const active = findingViews.filter((f) => !f.cancelled);

  const allViews: PlanItemView[] = items.map((p) => {
    const reports = filesOf('audit_plan_item', p.id);
    const r = p.reviewId != null ? reviewsById.get(p.reviewId) : undefined;
    const st = r ? REVIEW_STATUS[r.status as ReviewStatus] ?? REVIEW_STATUS.planifiee : null;
    const locked = p.reviewId != null;
    const cancelled = p.cancelledAt ? { on: parisDay(p.cancelledAt), by: name(p.cancelledById), reason: p.cancelReason ?? '' } : null;
    const reschedulable = !p.done && !cancelled && !locked;
    const auditorName = name(p.auditorId);
    const hasFindings = findings.some((f) => f.planItemId === p.id);
    return {
      id: p.id, year: p.year, track: p.track, month: p.month, label: p.label, plannedOn: p.plannedOn, detail: p.detail,
      ownerId: p.ownerId, owner: name(p.ownerId),
      done: p.done, doneOn: p.doneOn, auditor: p.auditor, scope: p.scope, certificationId: p.certificationId,
      auditorId: p.auditorId, auditorName,
      auditorLabel: [auditorName, p.auditor].filter(Boolean).join(' · '),
      auditorUnqualified: !!p.auditorId && auditorTitles.length > 0 && !qualifiedAuditor(p.auditorId, p.doneOn ?? planStart(p)),
      siteId: p.siteId, site: siteName(p.siteId), unplanned: p.unplanned,
      actionId: p.actionId, action: brief(p.actionId),
      state: planItemState(p, now), reports, findingCount: active.filter((f) => f.planItemId === p.id).length,
      kind: planTrackKind(p.track), isReview: isReviewPlanItem(p),
      reviewId: p.reviewId,
      review: r && st ? { id: r.id, statusLabel: st.label, statusTone: st.tone, href: `/audits?annee=${yearOf(r.reviewOn)}&revue=${r.id}#revue` } : null,
      locked,
      postponedFrom: p.postponedFrom,
      cancelled,
      reschedulable,
      // AUD-20 : un audit hors programme saisi par erreur (sans rapport, constat ni action) s'annule aussi.
      cancellable: (reschedulable || (p.unplanned && !cancelled)) && !p.actionId && !reports.length && !hasFindings,
      log: planLogs.get(String(p.id)) ?? [],
    };
  });
  const planById = new Map(allViews.map((p) => [p.id, p]));
  // Programme en vigueur : éléments non annulés (grille, échéances, constats, certifications).
  const plan = allViews.filter((p) => !p.cancelled);

  // Constats regroupés par élément du programme, sinon par libellé libre ; le plus récent d'abord. Les annulés n'y entrent pas.
  const groups = new Map<string, AuditGroup>();
  active.forEach((f) => {
    const item = f.planItemId != null ? planById.get(f.planItemId) : undefined;
    const key = item ? `p${item.id}` : `l${f.audit}`;
    let g = groups.get(key);
    if (!g) {
      g = item
        ? { key, label: planItemAuditLabel(item), planItemId: item.id, year: item.year, date: item.doneOn ?? item.plannedOn, auditor: item.auditorLabel || null, reports: item.reports, findings: [], unplanned: item.unplanned }
        : { key, label: f.audit, planItemId: null, year: null, date: null, auditor: null, reports: [], findings: [], unplanned: true };
      groups.set(key, g);
    }
    g.findings.push(f);
  });
  const auditGroups = [...groups.values()].map((g) => {
    const lastFound = g.findings.map((f) => f.foundOn).filter((d): d is string => !!d).sort().at(-1) ?? null;
    return { ...g, date: g.date ?? lastFound };
  });
  const firstId = (g: AuditGroup) => Math.min(...g.findings.map((f) => f.id));
  auditGroups.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || firstId(b) - firstId(a));
  const cancelledFindings: CancelledFindingView[] = findingViews
    .filter((f): f is FindingView & { cancelled: NonNullable<FindingView['cancelled']> } => !!f.cancelled)
    .map((f) => {
      const item = f.planItemId != null ? planById.get(f.planItemId) : undefined;
      return { ...f, groupLabel: item ? planItemAuditLabel(item) : f.audit };
    })
    .sort((a, b) => b.cancelled.on.localeCompare(a.cancelled.on) || b.id - a.id);

  const certViews: CertView[] = certs.map((c) => {
    // Prochain et dernier audit : programme en vigueur ; retrait du référentiel : tout élément rattaché, annulé compris.
    const linked = plan.filter((p) => p.certificationId === c.id);
    const next = linked.filter((p) => !p.done)
      .map((p) => ({ id: p.id, year: p.year, plannedOn: p.plannedOn ?? monthEnd(p.year, p.month) }))
      .sort((a, b) => a.plannedOn.localeCompare(b.plannedOn))[0] ?? null;
    const last = linked.filter((p) => p.done).sort((a, b) => planDate(b).localeCompare(planDate(a)))[0];
    const files = filesOf('certification', c.id);
    return {
      ...c,
      site: siteName(c.siteId),
      state: certificationStatus(c, next?.plannedOn ?? null, now),
      nextAudit: next,
      lastAudit: last ? { id: last.id, year: last.year, doneOn: last.doneOn, findingCount: last.findingCount } : null,
      files,
      removable: !allViews.some((p) => p.certificationId === c.id) && !files.length && !c.issuedOn && !c.validUntil,
      log: certLogs.get(c.id) ?? [],
    };
  });

  return { now, people, actionsById, certs: certViews, plan, allPlan: allViews, findings: findingViews, active, auditGroups, cancelledFindings, hiddenTracks, siteName };
});

/** Lignes du programme dans l'ordre de leur première apparition. */
const tracksOf = (items: { track: string }[]) => [...new Set(items.map((p) => p.track))];

/** Paramètre d'URL numérique (?element=, ?constat=). */
const numParam = (v: string | string[] | undefined) => (typeof v === 'string' && /^\d{1,9}$/.test(v) ? +v : null);

/**
 * AUD-22 : élément visible sur l'écran — dans le périmètre de la personne et sur le site sélectionné (un élément sans site,
 * commun à l'entreprise, vaut pour tous les sites). Même règle pour le programme, les constats et les certifications.
 */
export const auditVisible = (selected: string | null, allowed: string[] | null) => (siteId: string | null) => inPerimeter(allowed, siteId) && inSite(selected, siteId);

/**
 * Lignes affichées d'une année (AUD-24) : celles de l'année précédente qui porte des éléments (programme reconduit), puis
 * celles propres à l'année ; une ligne masquée pour l'année n'est plus affichée tant qu'elle n'y porte aucun élément.
 */
export function programTracks(plan: { year: number; track: string }[], year: number, hidden: readonly string[]) {
  const prevYears = [...new Set(plan.map((p) => p.year))].filter((y) => y < year);
  const refYear = prevYears.length ? Math.max(...prevYears) : null;
  const own = tracksOf(plan.filter((p) => p.year === year));
  const inherited = refYear ? tracksOf(plan.filter((p) => p.year === refYear)).filter((tr) => !own.includes(tr) && !hidden.includes(tr)) : [];
  return { refYear, tracks: [...new Set([...inherited, ...own])], hiddenTracks: refYear ? tracksOf(plan.filter((p) => p.year === refYear)).filter((tr) => !own.includes(tr) && hidden.includes(tr)) : [] };
}

/**
 * Écran « Audits et certifications ». `year` vient du paramètre ?annee= ; `element` (élément du programme) et
 * `constat` sont les liens profonds des échéances : sans ?annee=, l'année affichée est celle de l'élément. AUD-22 : éléments
 * du site sélectionné et du périmètre de la personne (les éléments communs à l'entreprise valent pour tous les sites).
 */
export async function loadAudits({ year: askedYear, element, constat }: { year?: string | string[]; element?: string | string[]; constat?: string | string[] }) {
  const [base, selected, { allowedSiteIds }] = await Promise.all([readAudits(true), currentSiteId(), getSession()]);
  const visible = auditVisible(selected, allowedSiteIds);
  const { now, hiddenTracks: hiddenRows } = base;
  const certs = base.certs.filter((c) => visible(c.siteId));
  const allPlan = base.allPlan.filter((p) => visible(p.siteId));
  const plan = allPlan.filter((p) => !p.cancelled);
  const findings = base.findings.filter((f) => visible(f.siteId));
  const active = findings.filter((f) => !f.cancelled);
  const auditGroups = base.auditGroups
    .map((g) => ({ ...g, findings: g.findings.filter((f) => visible(f.siteId)) }))
    .filter((g) => g.findings.length);
  const cancelledFindings = base.cancelledFindings.filter((f) => visible(f.siteId));
  const nowYear = yearOf(now);
  // Années proposées : aussi celles qui ne portent que des éléments annulés (liste « Éléments annulés »).
  const years = [...new Set(allPlan.map((p) => p.year))];
  const asked = typeof askedYear === 'string' && /^\d{4}$/.test(askedYear) && +askedYear >= 2000 && +askedYear <= 2100 ? +askedYear : null;
  const elementId = numParam(element);
  const target = elementId != null ? allPlan.find((p) => p.id === elementId) : undefined;
  const year = asked ?? target?.year ?? (years.includes(nowYear) || !years.length ? nowYear : Math.max(...years));
  const yearOptions = [...new Set([...years, nowYear, nowYear + 1, year])].sort((a, b) => a - b);
  const findingId = numParam(constat);
  const openFinding = findingId != null && findings.some((f) => f.id === findingId) ? findingId : undefined;

  // Lignes affichées : celles de l'année précédente (programme reconduit) puis celles propres à l'année, sauf les lignes
  // masquées pour l'année (AUD-24).
  const hiddenOfYear = hiddenRows.filter((h) => h.year === year && h.hiddenAt).map((h) => h.track);
  const { refYear, tracks, hiddenTracks } = programTracks(plan, year, hiddenOfYear);
  const items = plan.filter((p) => p.year === year);
  const itemIds = new Set(items.map((p) => p.id));
  // Éléments annulés de l'année, le plus récemment annulé d'abord.
  const cancelledPlan = allPlan
    .filter((p): p is PlanItemView & { cancelled: NonNullable<PlanItemView['cancelled']> } => !!p.cancelled && p.year === year)
    .sort((a, b) => b.cancelled.on.localeCompare(a.cancelled.on) || b.id - a.id);

  // Audits proposés pour rattacher un constat : les audits réalisés du programme en vigueur, hors revues, le plus récent
  // d'abord (AUD-11 : pas de constat sur un audit à venir ; l'audit d'un constat existant reste proposé par FindingForm).
  const auditOptions: Option[] = plan
    .filter((p) => !p.isReview && p.done)
    .sort((a, b) => planDate(b).localeCompare(planDate(a)) || b.id - a.id)
    .map((p) => [String(p.id), `${planItemAuditLabel(p)}${p.unplanned ? ' · hors programme' : ''}`] as Option);

  return {
    now,
    certs,
    year,
    yearOptions,
    tracks,
    /** AUD-24 : lignes reprises de l'année précédente masquées pour cette année (« Afficher à nouveau »). */
    hiddenTracks,
    /** AUD-24 : reconduction possible — année précédente portant des éléments en vigueur (hors revues et audits hors programme). */
    renewFrom: refYear === year - 1 && plan.some((p) => p.year === refYear && !p.unplanned && p.reviewId == null) ? refYear : null,
    allTracks: tracksOf(plan),
    plan: items,
    cancelledPlan,
    planFindings: active.filter((f) => f.planItemId != null && itemIds.has(f.planItemId)),
    auditGroups,
    cancelledFindings,
    auditOptions,
    // Lien profond : élément en vigueur (fenêtre de l'élément) ou annulé (fiche en lecture, liste « Éléments annulés »).
    openElement: target && target.year === year ? target.id : undefined,
    openFinding,
    // UX-13 : lien profond vers un élément ou un constat inconnu (ou d'une autre année que celle demandée) : bandeau commun.
    missingElement: missingDetail(element, !!target && target.year === year),
    missingFinding: missingDetail(constat, openFinding !== undefined),
  };
}

/**
 * Programme annuel imprimable (AUD-26, ISO 9001 §9.2.2) : éléments en vigueur de l'année (site sélectionné et périmètre,
 * AUD-22), par ligne et par mois, avec l'état, l'auditeur, le périmètre et le nombre de constats ; éléments annulés comptés.
 */
export async function loadAuditProgramPrint(askedYear?: string) {
  const [base, selected, session] = await Promise.all([readAudits(false), currentSiteId(), getSession()]);
  const visible = auditVisible(selected, session.allowedSiteIds);
  const plan = base.allPlan.filter((p) => visible(p.siteId));
  const years = [...new Set(plan.map((p) => p.year))].sort((a, b) => a - b);
  const nowYear = yearOf(base.now);
  const year = askedYear && /^\d{4}$/.test(askedYear) && years.includes(+askedYear) ? +askedYear : years.includes(nowYear) || !years.length ? nowYear : years.at(-1)!;
  const items = plan.filter((p) => p.year === year && !p.cancelled)
    .sort((a, b) => a.month - b.month || (a.plannedOn ?? '').localeCompare(b.plannedOn ?? '') || a.id - b.id);
  const hidden = base.hiddenTracks.filter((h) => h.year === year && h.hiddenAt).map((h) => h.track);
  const { tracks } = programTracks(plan.filter((p) => !p.cancelled), year, hidden);
  return {
    year, years, now: base.now, items, tracks,
    cancelledCount: plan.filter((p) => p.year === year && p.cancelled).length,
    site: session.site.id === ALL_SITES ? 'Tous les sites' : session.site.label,
    certs: base.certs.filter((c) => visible(c.siteId)).map((c) => [c.id, c.standard] as const),
  };
}

// ─── Échéances du domaine (tableau de bord, À faire, notifications, badge) ──

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Échéances du domaine : programme en retard (à confirmer), à venir sous 15 jours ou prévu au mois sans date (AUD-18),
 * constats sans action,
 * certificats expirés, proches de la fin de validité ou sans audit de suivi programmé. AUD-22 : site de l'élément (null :
 * commun à l'entreprise), sur tout le périmètre de la personne ; un élément sans responsable va au responsable QHSE du site.
 */
export const loadAuditSignals = cache(async (): Promise<{ badge?: number; todo: TodoItem[] }> => {
  const [base, leads, { allowedSiteIds }] = await Promise.all([readAudits(false), loadQhseLeads(), getSession()]);
  // AUD-22 : tout le périmètre de la personne (TDB-05) ; chaque échéance porte le site de son élément (null : entreprise).
  const keep = (siteId: string | null) => inPerimeter(allowedSiteIds, siteId);
  const { now, people, actionsById } = base;
  const certs = base.certs.filter((c) => keep(c.siteId));
  const plan = base.plan.filter((p) => keep(p.siteId));
  const active = base.active.filter((f) => keep(f.siteId));
  const horizon = addDays(now, TODO_HORIZON_DAYS);
  const name = (id: string | null | undefined) => (id ? people.get(id)?.name ?? '' : '');
  const planHref = (p: { id: number; year: number }) => `/audits?annee=${p.year}&element=${p.id}`;
  const planById = new Map(plan.map((p) => [p.id, p]));
  const todo: TodoItem[] = [];

  // a) et b) Programme annuel en vigueur (annulés exclus) : échéance passée non confirmée, ou prévue dans l'horizon.
  plan.forEach((p) => {
    const who = { who: p.owner, ownerIds: p.ownerId ? [p.ownerId] : undefined, href: planHref(p), siteId: p.siteId };
    if (p.state === 'late') {
      // Échéance d'une revue rattachée (AUD-01) : « compte rendu à saisir » relève de loadReviewSignals (src/lib/data/review.ts) ;
      // sa réalisation et son annulation suivent la revue. Une échéance de revue saisie au seul programme reste « à confirmer ».
      if (p.locked) return;
      const when = p.plannedOn ? `prévu le ${fmtDayMonth(p.plannedOn)}` : `prévu en ${monthName(p.month)} ${p.year}`;
      // AUD-18 : action porteuse en retard — son retard n'est plus une échéance distincte (loadActionSignals) : son
      // responsable, encore dans l'effectif, reçoit l'échéance de l'élément.
      const carrier = p.actionId ? actionsById.get(p.actionId) : undefined;
      const pilot = carrier && isLate(carrier, now) ? people.get(carrier.pilotId) : undefined;
      const extra = pilot && !hasLeft(pilot, now) && pilot.id !== p.ownerId ? pilot : undefined;
      const owners = extra
        ? { who: [p.owner, extra.name].filter(Boolean).join(' · '), ownerIds: [...(p.ownerId ? [p.ownerId] : []), extra.id] }
        : { who: who.who, ownerIds: who.ownerIds };
      todo.push({ date: now, dueOn: planStart(p), kind: p.kind, tone: 'warn', title: `${p.detail ?? p.label} — ${when}, à confirmer`, overdue: true, ...who, ...owners });
    } else if (!p.done && p.plannedOn && p.plannedOn >= now && p.plannedOn <= horizon) {
      todo.push({ date: p.plannedOn, dueOn: p.plannedOn, kind: p.kind, tone: 'neutral', title: p.detail ?? p.label, ...who });
    } else if (!p.done && !p.plannedOn && planStart(p) <= horizon) {
      // AUD-18 : élément prévu au mois, sans date : échéance « date à fixer » dès que son mois entre dans l'horizon (datée
      // du jour une fois le mois commencé ; clé portant le 1er du mois), jusqu'à la fin du mois (puis « à confirmer »).
      const start = planStart(p);
      todo.push({
        date: start < now ? now : start, dueOn: start, kind: p.kind, tone: 'warn',
        title: `${p.detail ?? p.label} — prévu en ${monthName(p.month)} ${p.year}, date à fixer`, ...who,
      });
    }
  });

  // c) Écarts, observations et pistes de progrès sans action au plan d'actions ; un écart dont la réponse est attendue
  // à une date (AUD-09) est daté de ce délai tant qu'il n'est pas dépassé.
  active.filter((f) => f.kind !== 'point_fort' && !f.actions.length).forEach((f) => {
    // Responsable de l'élément du programme, sinon les responsables QHSE (constat commun aux sites).
    const ownerId = f.planItemId != null ? planById.get(f.planItemId)?.ownerId : null;
    const owners = ownerId ? { who: name(ownerId), ownerIds: [ownerId] } : leads.forSite(f.siteId);
    const gap = FINDING_GAP_KINDS.includes(f.kind);
    const base = { kind: "Constat d'audit", who: owners.who, ownerIds: owners.ownerIds, href: `/audits?constat=${f.id}`, siteId: f.siteId };
    const label = `${FINDING_KINDS[f.kind]?.label ?? f.kind} sans action — ${clip(f.text, 90)}`;
    if (gap && f.responseDueOn && f.responseDueOn >= now) {
      todo.push({ ...base, date: f.responseDueOn, dueOn: f.responseDueOn, tone: 'warn', title: `${label} · réponse attendue le ${fmtDayMonth(f.responseDueOn)}` });
    } else {
      todo.push({
        ...base, date: now, dueOn: f.responseDueOn ?? undefined, tone: gap ? 'danger' : 'warn', overdue: true,
        title: f.responseDueOn ? `${label} · réponse attendue depuis le ${fmtDayMonth(f.responseDueOn)}` : label,
      });
    }
  });

  // d) Certificats : expiré, fin de validité proche, audit de suivi non programmé (l'audit à venir relève du programme).
  certs.filter((c) => c.tone === 'ok').forEach((c) => {
    const { who, ownerIds } = leads.forSite(c.siteId);
    const base = { kind: 'Certification', who, ownerIds, href: '/audits', siteId: c.siteId };
    // AUD-08 : suspension par l'organisme, jusqu'à sa levée.
    if (c.suspendedOn) todo.push({ ...base, date: now, dueOn: c.suspendedOn, tone: 'danger', title: `Certificat ${c.standard} suspendu depuis le ${fmtDayMonth(c.suspendedOn)}`, overdue: true });
    if (c.validUntil && c.validUntil < now) {
      todo.push({ ...base, date: now, dueOn: c.validUntil, tone: 'danger', title: `Certificat ${c.standard} expiré`, overdue: true });
    } else if (c.validUntil && daysBetween(now, c.validUntil) <= CERT_SOON_DAYS) {
      // AUD-08 : fin de validité signalée 30 jours avant (et non plus 15).
      todo.push({ ...base, date: c.validUntil, dueOn: c.validUntil, tone: 'warn', title: `Certificat ${c.standard} · fin de validité le ${fmtDate(c.validUntil)}` });
    }
    // AUD-08 : renouvellement à préparer — fin de cycle sous 6 mois sans audit programmé avant la fin de validité.
    if (c.validUntil && c.validUntil >= now && daysBetween(now, c.validUntil) <= CERT_RENEWAL_NOTICE_DAYS && !(c.nextAudit && c.nextAudit.plannedOn <= c.validUntil)) {
      todo.push({ ...base, date: now, dueOn: c.validUntil, tone: 'warn', overdue: true, key: `certification|${c.id}|renouvellement`, title: `${c.standard} · audit de renouvellement à programmer avant le ${fmtDate(c.validUntil)}` });
    } else if (!c.nextAudit) todo.push({ ...base, date: now, tone: 'warn', title: `${c.standard} · audit de suivi à programmer`, overdue: true });
  });

  // Les contributions attendues pour la revue de direction relèvent de loadReviewSignals (src/lib/data/review.ts).
  return { todo };
});
