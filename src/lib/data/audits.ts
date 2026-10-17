import 'server-only';
import { cache } from 'react';
import { asc, inArray } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { REVIEW_TRACK, isReviewPlanItem } from '@/components/audits/shared';
import type { ChangeEntry } from '@/components/ChangeLog';
import { addDays, fmtDate, fmtDayMonth, monthName, monthOf, yearOf, parisDay } from '../dates';
import { today } from '@/lib/today';
import {
  FINDING_KINDS, REVIEW_STATUS, TODO_HORIZON_DAYS, planTrackKind, type PlanItemState, type ReviewStatus, type TodoItem, type Tone,
} from '../domain';
import { actionBrief, certificationStatus, loadAllActions, loadPeople, type ActionBrief } from '../queries';
import { loadQhseLeads } from './leads';
import { loadChangeLogs } from './changelog';
import type { Option } from './options';

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
  kind: string; text: string; sort: number; actionId: string | null; action: ActionBrief | null;
  /** Ligne du programme de l'élément rattaché (source de l'action, D20) ; null hors programme. */
  track: string | null;
  /** Annulation (constat saisi par erreur ou en double) : hors groupes et échéances, visible avec le filtre « Annulés ». */
  cancelled: { on: string; by: string; reason: string } | null;
  log: ChangeEntry[];
};
/** Constat annulé, avec le libellé de son audit (filtre « Annulés »). */
export type CancelledFindingView = FindingView & { cancelled: NonNullable<FindingView['cancelled']>; groupLabel: string };
/** Constats d'un même audit : élément du programme (clé p<id>) ou libellé libre hors programme (clé l<libellé>). */
export type AuditGroup = {
  key: string; label: string; planItemId: number | null; year: number | null; date: string | null; auditor: string | null;
  reports: AttachmentBrief[]; findings: FindingView[];
};

/** Référentiel avec son statut calculé, ses audits rattachés au programme et son certificat. */
export type CertView = Certification & {
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
 * - `taken` : la ligne « Revues de direction » porte déjà un élément ce mois-là (la revue reste « hors programme ») ;
 * - `create` : mois libre, l'échéance est créée sur la ligne « Revues de direction ».
 */
export function reviewSlot(items: SlotItem[], reviewOn: string): { adopt: number } | { create: true } | { taken: string } {
  const month = items.filter((p) => !p.cancelledAt && p.year === yearOf(reviewOn) && p.month === monthOf(reviewOn));
  const free = month.filter((p) => p.reviewId == null && !p.done && isReviewPlanItem(p));
  const pick = free.find((p) => p.track === REVIEW_TRACK) ?? free[0];
  if (pick) return { adopt: pick.id };
  const taken = month.find((p) => p.track === REVIEW_TRACK);
  return taken ? { taken: taken.label } : { create: true };
}

/** Libellé d'audit repris par les constats rattachés à un élément du programme (« Processus Production · juin 2026 »). */
export const planItemAuditLabel = (p: Pick<PlanLike, 'year' | 'month' | 'label' | 'detail'>) => `${p.detail ?? p.label} · ${monthName(p.month)} ${p.year}`;

// isReviewPlanItem : règle partagée avec le formulaire du programme (src/components/audits/shared.ts).
export { isReviewPlanItem };

/** Date de référence d'un élément du programme (tri, constats) : réalisation, date prévue, sinon fin du mois. */
const planDate = (p: { year: number; month: number; plannedOn: string | null; doneOn: string | null }) => p.doneOn ?? p.plannedOn ?? monthEnd(p.year, p.month);

const readAudits = cache(async () => {
  const db = await getDb();
  const [certs, items, findings, actions, people, files, reviews] = await Promise.all([
    db.select().from(t.certifications).orderBy(asc(t.certifications.sort), asc(t.certifications.id)),
    // Éléments annulés compris (AUD-03) : hors grille, échéances et constats, ils restent consultables (« Éléments annulés »).
    db.select().from(t.auditPlanItems).orderBy(asc(t.auditPlanItems.id)),
    db.select().from(t.auditFindings).orderBy(asc(t.auditFindings.sort), asc(t.auditFindings.id)),
    // Actions de tout le périmètre de la personne (pas seulement du site sélectionné) : un constat ou une échéance, communs à
    // l'entreprise, gardent leur action liée quel que soit le site affiché ; hors périmètre, la référence seule (ActionLink).
    loadAllActions('perimeter'),
    loadPeople(),
    db.select({ id: t.attachments.id, entityType: t.attachments.entityType, entityId: t.attachments.entityId, fileName: t.attachments.fileName, createdAt: t.attachments.createdAt })
      .from(t.attachments).where(inArray(t.attachments.entityType, ['audit_plan_item', 'certification'])).orderBy(asc(t.attachments.createdAt)),
    // Revues portées par les échéances du programme (AUD-01).
    db.select({ id: t.reviews.id, reviewOn: t.reviews.reviewOn, status: t.reviews.status, kind: t.reviews.kind }).from(t.reviews),
  ]);
  const [findingLogs, planLogs, certLogs] = await Promise.all([
    loadChangeLogs('audit_finding', findings.map((f) => f.id)),
    loadChangeLogs('audit_plan_item', items.map((p) => p.id)),
    loadChangeLogs('certification', certs.map((c) => c.id)),
  ]);
  const now = today();
  const actionsById = new Map(actions.map((a) => [a.id, a]));
  const reviewsById = new Map(reviews.map((r) => [r.id, r]));
  const brief = (id: string | null) => (id ? actionBrief(actionsById.get(id), people, now) : null);
  const name = (id: string | null) => (id ? people.get(id)?.name ?? '' : '');
  const filesOf = (entityType: string, id: string | number) => files
    .filter((f) => f.entityType === entityType && f.entityId === String(id))
    .map((f) => ({ id: f.id, fileName: f.fileName, createdAt: f.createdAt.toISOString() }));

  const trackOf = new Map(items.map((p) => [p.id, p.track]));
  const findingViews: FindingView[] = findings.map((f) => ({
    id: f.id, audit: f.audit, planItemId: f.planItemId, clause: f.clause, foundOn: f.foundOn,
    kind: f.kind, text: f.text, sort: f.sort, actionId: f.actionId, action: brief(f.actionId),
    track: f.planItemId != null ? trackOf.get(f.planItemId) ?? null : null,
    cancelled: f.cancelledAt ? { on: parisDay(f.cancelledAt), by: name(f.cancelledById), reason: f.cancelReason ?? '' } : null,
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
    return {
      id: p.id, year: p.year, track: p.track, month: p.month, label: p.label, plannedOn: p.plannedOn, detail: p.detail,
      ownerId: p.ownerId, owner: name(p.ownerId),
      done: p.done, doneOn: p.doneOn, auditor: p.auditor, scope: p.scope, certificationId: p.certificationId,
      actionId: p.actionId, action: brief(p.actionId),
      state: planItemState(p, now), reports, findingCount: active.filter((f) => f.planItemId === p.id).length,
      kind: planTrackKind(p.track), isReview: isReviewPlanItem(p),
      reviewId: p.reviewId,
      review: r && st ? { id: r.id, statusLabel: st.label, statusTone: st.tone, href: `/audits?annee=${yearOf(r.reviewOn)}&revue=${r.id}#revue` } : null,
      locked,
      postponedFrom: p.postponedFrom,
      cancelled,
      reschedulable,
      cancellable: reschedulable && !p.actionId && !reports.length && !findings.some((f) => f.planItemId === p.id),
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
        ? { key, label: planItemAuditLabel(item), planItemId: item.id, year: item.year, date: item.doneOn ?? item.plannedOn, auditor: item.auditor, reports: item.reports, findings: [] }
        : { key, label: f.audit, planItemId: null, year: null, date: null, auditor: null, reports: [], findings: [] };
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
      state: certificationStatus(c, next?.plannedOn ?? null, now),
      nextAudit: next,
      lastAudit: last ? { id: last.id, year: last.year, doneOn: last.doneOn, findingCount: last.findingCount } : null,
      files,
      removable: !allViews.some((p) => p.certificationId === c.id) && !files.length && !c.issuedOn && !c.validUntil,
      log: certLogs.get(c.id) ?? [],
    };
  });

  return { now, people, certs: certViews, plan, allPlan: allViews, findings: findingViews, active, auditGroups, cancelledFindings };
});

/** Lignes du programme dans l'ordre de leur première apparition. */
const tracksOf = (items: { track: string }[]) => [...new Set(items.map((p) => p.track))];

/** Paramètre d'URL numérique (?element=, ?constat=). */
const numParam = (v: string | string[] | undefined) => (typeof v === 'string' && /^\d{1,9}$/.test(v) ? +v : null);

/**
 * Écran « Audits et certifications ». `year` vient du paramètre ?annee= ; `element` (élément du programme) et
 * `constat` sont les liens profonds des échéances : sans ?annee=, l'année affichée est celle de l'élément.
 */
export async function loadAudits({ year: askedYear, element, constat }: { year?: string | string[]; element?: string | string[]; constat?: string | string[] }) {
  const { now, certs, plan, allPlan, findings, active, auditGroups, cancelledFindings } = await readAudits();
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

  // Lignes affichées : celles de l'année précédente (programme reconduit) puis celles propres à l'année (éléments en vigueur).
  const prevYears = [...new Set(plan.map((p) => p.year))].filter((y) => y < year);
  const refYear = prevYears.length ? Math.max(...prevYears) : null;
  const items = plan.filter((p) => p.year === year);
  const tracks = [...new Set([...(refYear ? tracksOf(plan.filter((p) => p.year === refYear)) : []), ...tracksOf(items)])];
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
    .map((p) => [String(p.id), planItemAuditLabel(p)] as Option);

  return {
    now,
    certs,
    year,
    yearOptions,
    tracks,
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
  };
}

// ─── Échéances du domaine (tableau de bord, À faire, notifications, badge) ──

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Échéances du domaine : programme en retard (à confirmer) ou à venir sous 15 jours, constats sans action,
 * certificats expirés, proches de la fin de validité ou sans audit de suivi programmé. Communs à tous les sites (siteId null).
 */
export const loadAuditSignals = cache(async (): Promise<{ badge?: number; todo: TodoItem[] }> => {
  const [{ now, people, certs, plan, active }, leads] = await Promise.all([readAudits(), loadQhseLeads()]);
  const horizon = addDays(now, TODO_HORIZON_DAYS);
  const name = (id: string | null | undefined) => (id ? people.get(id)?.name ?? '' : '');
  const planHref = (p: { id: number; year: number }) => `/audits?annee=${p.year}&element=${p.id}`;
  const planById = new Map(plan.map((p) => [p.id, p]));
  const todo: TodoItem[] = [];

  // a) et b) Programme annuel en vigueur (annulés exclus) : échéance passée non confirmée, ou prévue dans l'horizon.
  plan.forEach((p) => {
    const who = { who: p.owner, ownerIds: p.ownerId ? [p.ownerId] : undefined, href: planHref(p), siteId: null };
    if (p.state === 'late') {
      // Échéance d'une revue rattachée (AUD-01) : « compte rendu à saisir » relève de loadReviewSignals (src/lib/data/review.ts) ;
      // sa réalisation et son annulation suivent la revue. Une échéance de revue saisie au seul programme reste « à confirmer ».
      if (p.locked) return;
      const when = p.plannedOn ? `prévu le ${fmtDayMonth(p.plannedOn)}` : `prévu en ${monthName(p.month)} ${p.year}`;
      todo.push({ date: now, dueOn: p.plannedOn ?? `${p.year}-${String(p.month).padStart(2, '0')}-01`, kind: p.kind, tone: 'warn', title: `${p.detail ?? p.label} — ${when}, à confirmer`, overdue: true, ...who });
    } else if (!p.done && p.plannedOn && p.plannedOn >= now && p.plannedOn <= horizon) {
      todo.push({ date: p.plannedOn, dueOn: p.plannedOn, kind: p.kind, tone: 'neutral', title: p.detail ?? p.label, ...who });
    }
  });

  // c) Écarts et pistes de progrès sans action au plan d'actions.
  active.filter((f) => f.kind !== 'point_fort' && !f.actionId).forEach((f) => {
    // Responsable de l'élément du programme, sinon les responsables QHSE (constat commun aux sites).
    const ownerId = f.planItemId != null ? planById.get(f.planItemId)?.ownerId : null;
    const owners = ownerId ? { who: name(ownerId), ownerIds: [ownerId] } : leads.forSite(null);
    todo.push({
      date: now, kind: "Constat d'audit", tone: f.kind === 'ecart_mineur' ? 'danger' : 'warn', overdue: true,
      title: `${FINDING_KINDS[f.kind]?.label ?? f.kind} sans action — ${clip(f.text, 90)}`,
      who: owners.who, ownerIds: owners.ownerIds, href: `/audits?constat=${f.id}`, siteId: null,
    });
  });

  // d) Certificats : expiré, fin de validité proche, audit de suivi non programmé (l'audit à venir relève du programme).
  certs.filter((c) => c.tone === 'ok').forEach((c) => {
    const { who, ownerIds } = leads.forSite(null);
    const base = { kind: 'Certification', who, ownerIds, href: '/audits', siteId: null };
    if (c.validUntil && c.validUntil < now) {
      todo.push({ ...base, date: now, dueOn: c.validUntil, tone: 'danger', title: `Certificat ${c.standard} expiré`, overdue: true });
    } else if (c.validUntil && c.validUntil <= horizon) {
      todo.push({ ...base, date: c.validUntil, dueOn: c.validUntil, tone: 'warn', title: `Certificat ${c.standard} · fin de validité le ${fmtDate(c.validUntil)}` });
    }
    if (!c.nextAudit) todo.push({ ...base, date: now, tone: 'warn', title: `${c.standard} · audit de suivi à programmer`, overdue: true });
  });

  // Les contributions attendues pour la revue de direction relèvent de loadReviewSignals (src/lib/data/review.ts).
  return { todo };
});
