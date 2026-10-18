import 'server-only';
import { cache } from 'react';
import { and, asc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import type { ChangeEntry } from '@/components/ChangeLog';
import {
  PERMIT_DELIVERED, PERMIT_STATE, PERMIT_TYPES, PLAN_STATUS, SIGNAL_HORIZON_DAYS, START_GAP_LABEL,
  firstFullSignatureOn, firstMinuteReason, firstMinuteRule, fmtLocalLong, fmtLocalRange, fmtLocalShort, inGapWindow, inspectionDone, isFullySigned,
  isInProgress, isMandatory, isPlanEnded, lacksSignedPlan, legalMandatory, legalReason, mandatoryReason, missingPlanContent, parseChecklist, permitDays,
  permitLacksSignedPlan, permitNeedsSignedPlan, permitPlanCheck, permitState, planContentStats, planEndIssue, planPhase, planStatus, referenceNow,
  ruleBasis, sevesoLabel, startGap, toParisLocal,
  type ChecklistItem, type PermitPlanIssueKind, type PermitState, type PermitType, type PlanContent, type PlanPhase, type PlanStatus, type SiteRule,
  type StartGapKind,
} from '@/components/prevention/model';
import type { PpFormData, PpImportFormat } from '@/lib/pp-form';
import { addDays, fmtDate, fmtDayMonth } from '../dates';
import { today } from '@/lib/today';
import { EVENT_DISMISSED, EVENT_STEPS, EVENT_TYPES, SCREEN_PROCEDURES, STEP_CLOSED, byUrgency, type EventType, type TodoItem, type Tone } from '../domain';
import { actionView, loadPeople } from '../queries';
import { loadChangeLogs } from './changelog';
import type { Option } from './options';
import { currentSiteId, siteFilter, type SiteScope } from '../session';
import { attachmentUrl } from '../uploads';

// ─── Plans de prévention et permis ──────────────────────────────────────────

/** Type d'entité des pièces jointes d'un plan (exemplaire signé, compte rendu d'inspection commune…). */
export const PLAN_ATTACHMENT = 'prevention_plan';

/** Règle de prévention d'un site (classement Seveso, plan « dès la première minute »). */
export type SiteRuleView = {
  id: string;
  label: string;
  seveso: string | null;
  ppFromFirstMinute: boolean;
  /** « Établissement Seveso seuil haut » */
  classLabel: string;
  /** « plan de prévention dès la première minute », ou rappel de la règle légale. */
  ruleLabel: string;
};

/** Plan proposé au rattachement d'un permis (filtré dans le formulaire selon le site, l'entreprise et les dates). */
export type PlanChoice = {
  id: string; siteId: string; contractorId: string; contractor: string; title: string;
  startOn: string; endOn: string; period: string; mandatory: boolean; signed: boolean;
  /** Plan clos (les plans annulés ne sont pas proposés). */
  closed: boolean;
};

/** Procédure de référence de l'écran (SCREEN_PROCEDURES), si le document existe dans la gestion documentaire. */
export type ProcedureLink = { id: string; title: string; href: string };

/** Annulation d'un plan ou d'un permis : date, auteur, motif. */
export type CancelInfo = { on: string; by: string | null; reason: string };

/** Formulaire importé, conservé sur le plan (lecture seule). */
export type PlanFormView = {
  fileName: string;
  format: PpImportFormat;
  formatLabel: string;
  /** 07/10/2026 */
  importedOn: string | null;
  /** Fichier source (/fichiers/<id>), null s'il n'est plus disponible. */
  fileUrl: string | null;
  sections: PpFormData['sections'];
};

export type PlanView = {
  id: string;
  siteId: string;
  site: string;
  contractorId: string;
  contractor: string;
  contractorTrade: string;
  /** Interlocuteur de l'entreprise extérieure (document imprimable). */
  contractorContact: { name: string | null; phone: string | null; email: string | null };
  title: string;
  location: string;
  startOn: string;
  endOn: string;
  /** 05/10 → 09/10/2026 */
  period: string;
  estimatedHours: number;
  dangerousWork: boolean;
  keystoneProject: string | null;
  inspectionOn: string | null;
  inspectionDone: boolean;
  interferenceRisks: string;
  measures: string;
  signedEuOn: string | null;
  signedEeOn: string | null;
  /** Signataires (PRV-07) : nom et qualité, null pour une signature antérieure. */
  signedEu: { name: string; quality: string | null } | null;
  signedEe: { name: string; quality: string | null } | null;
  /** Première signature complète (EU et EE), conservée quand une modification a effacé les signatures. */
  firstSignedOn: string | null;
  /**
   * Écart R. 4512-6 constaté au démarrage (plan obligatoire signé après le début, ou intervention sans plan signé), null
   * sinon ; past : écart qui n'est plus en cours (plan signé depuis, ou intervention terminée), compté dans les indicateurs.
   */
  startGap: { kind: StartGapKind; label: string; past: boolean; signedOn: string | null } | null;
  ownerId: string | null;
  owner: string | null;
  status: PlanStatus;
  statusLabel: string;
  tone: Tone;
  phase: PlanPhase;
  /** Site soumis à la règle « plan dès la première minute » (établissement Seveso). */
  firstMinute: boolean;
  /** Fondement de la règle du site (« Établissement Seveso seuil haut »), null hors règle. */
  ruleBasis: string | null;
  /** Plan écrit obligatoire selon la règle du site du plan. */
  mandatory: boolean;
  mandatoryReason: string;
  /** Motif court (étiquettes) : « Seveso seuil haut · dès la première minute » ou « 140 h sur 12 mois et travaux dangereux ». */
  mandatoryShort: string;
  /** Obligation légale R. 4512-7 (≥ 400 h sur 12 mois ou travaux dangereux), indépendamment de la règle du site. */
  legalMandatory: boolean;
  legalReason: string;
  inProgress: boolean;
  /** Intervention en cours sans plan obligatoire signé (écart R. 4512-6, règle du site). */
  missingSignature: boolean;
  /** Période échue sans clôture du plan. */
  overdue: boolean;
  /** Motif empêchant la clôture du plan (mêmes règles que l'action serveur), null si le plan peut être clos. */
  closeBlock: string | null;
  /** Motif empêchant l'annulation (mêmes règles que la clôture, plus les activités de la carte en cours ou à venir). */
  cancelBlock: string | null;
  /** Brouillon saisi par erreur : sans signature ni inspection réalisée, sans permis, action, activité ni événement rattachés. */
  deletable: boolean;
  cancelled: CancelInfo | null;
  /** gap : permis sans plan signé (écart compté avec ce plan quand le plan est lui-même en écart). */
  permits: { id: string; type: PermitType; stateLabel: string; tone: Tone; validity: string; requested: boolean; gap: boolean }[];
  /**
   * Actions reprises rattachées au plan (actions.preventionPlanId, ACT-01), consultation seule : la Prévention ne crée
   * plus d'action QSE (réponses du service QHSE du 15/10/2026) ; abandonnées exclues.
   */
  actions: { id: string; label: string; statusLabel: string; tone: Tone; due: string; pilot: string }[];
  /** Événements rattachés au plan (accident, presque-accident… survenu pendant l'intervention). */
  events: LinkedEvent[];
  /** Pièces jointes (exemplaire signé…), hors fichier source d'un formulaire importé (voir form). */
  attachments: { id: string; name: string; url: string; isImage: boolean; icon: string }[];
  form: PlanFormView | null;
  /** Sections exigées pour signer un plan obligatoire qui restent vides (libellés courts) ; vide si le plan n'est pas obligatoire. */
  contentMissing: string[];
  /** Sections du contenu réglementaire renseignées (8 sections et l'effectif prévisible). */
  contentStats: { filled: number; total: number };
} & PlanContent;

export type PermitView = {
  id: string;
  type: PermitType;
  typeLabel: string;
  icon: string;
  siteId: string;
  site: string;
  location: string;
  description: string;
  contractorId: string | null;
  contractor: string | null;
  performer: string;
  issuerId: string | null;
  issuer: string | null;
  preventionPlanId: string | null;
  /** Plan rattaché : signature des deux entreprises et période. */
  plan: { id: string; signed: boolean; period: string } | null;
  /** Site soumis à la règle « plan dès la première minute ». */
  firstMinute: boolean;
  /** Motif de la règle du site (« Établissement Seveso seuil haut : plan écrit et signé dès la première minute d'intervention »), null hors règle. */
  ruleReason: string | null;
  /** Plan signé couvrant la validité exigé pour délivrer (entreprise extérieure sur un site « dès la première minute », ou permis de feu d'une entreprise extérieure). */
  planRequired: boolean;
  /** Permis demandé ou délivré dont le plan de prévention n'est pas en règle (règle du site), null sinon. */
  planIssue: string | null;
  planIssueKind: PermitPlanIssueKind | null;
  /** Demande : motif bloquant la délivrance au regard du plan de prévention. */
  planBlocker: string | null;
  /** Écart : entreprise extérieure demandant à intervenir ou intervenant sans plan signé couvrant la validité (site « dès la première minute »). */
  planGap: boolean;
  /** Écart compté avec le plan rattaché, lui-même en écart (même intervention) : référence du plan, null sinon. */
  planGapWith: string | null;
  keystoneProject: string | null;
  /** Dates-heures locales (Paris) « AAAA-MM-JJTHH:mm ». */
  validFrom: string;
  validTo: string;
  watchUntil: string | null;
  validity: string;
  watchLabel: string | null;
  checklist: ChecklistItem[];
  allChecked: boolean;
  status: string;
  state: PermitState;
  stateLabel: string;
  tone: Tone;
  /** Validité terminée, surveillance après travaux en cours. */
  watching: boolean;
  closedAt: string | null;
  closedLabel: string | null;
  /** Délivrance (dernière entrée « Permis délivré » du journal) : date-heure locale (Paris), null si le permis n'a pas été délivré. */
  deliveredAt: string | null;
  /** 06/10/2026 à 07:15 */
  deliveredLabel: string | null;
  /** Motif d'annulation (statut annule). */
  cancelReason: string | null;
  cancelledBy: string | null;
  /** Actions reprises rattachées au permis (actions.permitId, ACT-01), consultation seule (voir PlanView.actions). */
  actions: PlanView['actions'];
  /** Nombre d'actions rattachées au plan du permis (renvoi vers la fiche du plan). */
  planActions: number;
  /** Événements rattachés au permis. */
  events: LinkedEvent[];
  history: ChangeEntry[];
};

/** Événement rattaché à un plan ou à un permis (lien /evenements?sel=…). */
export type LinkedEvent = { id: string; title: string; typeLabel: string; date: string; stepLabel: string; tone: Tone };

export type ContractorView = {
  id: string;
  name: string;
  trade: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  plans: number;
  activePlans: number;
  permits: number;
  activePermits: number;
  archived: boolean;
  /** « Archivée le 31/03/2026 par [C. Lefèvre] » */
  archivedLabel: string | null;
  archiveReason: string | null;
  /** Plans et permis de l'entreprise sur le site sélectionné. */
  planList: { id: string; title: string; period: string; statusLabel: string; tone: Tone; site: string }[];
  permitList: { id: string; typeLabel: string; icon: string; validity: string; stateLabel: string; tone: Tone }[];
  /** Motif empêchant l'archivage (plans ou permis en cours sur un site quelconque), null sinon. */
  archiveBlock: string | null;
};

/**
 * Lignes du site sélectionné (scope 'site') ou de tout le périmètre (scope 'perimeter' : échéances, TDB-05) — plans,
 * permis —, référentiels et règle de prévention de chaque site.
 */
const loadRows = cache(async (scope: SiteScope = 'site') => {
  const [db, site, people, keep] = await Promise.all([getDb(), currentSiteId(), loadPeople(), siteFilter(scope)]);
  const [contractors, plans, permits, sites, activities, linkedEvents] = await Promise.all([
    db.select().from(t.contractors),
    db.select().from(t.preventionPlans),
    db.select().from(t.permits),
    db.select().from(t.sites).orderBy(asc(t.sites.sort)),
    // Activités de la carte (tous sites) : rattachements qui empêchent de supprimer ou d'annuler un plan.
    db.select({ planId: t.siteActivities.preventionPlanId, endOn: t.siteActivities.endOn, cancelled: isNotNull(t.siteActivities.cancelledAt) }).from(t.siteActivities),
    db.select({
      id: t.events.id, planId: t.events.preventionPlanId, permitId: t.events.permitId, type: t.events.type, title: t.events.title,
      occurredOn: t.events.occurredOn, step: t.events.step, dismissedAt: t.events.dismissedAt,
    }).from(t.events).where(or(isNotNull(t.events.preventionPlanId), isNotNull(t.events.permitId))),
  ]);
  const now = today();
  const rules = new Map(sites.map((s): [string, SiteRule] => [s.id, { seveso: s.seveso, ppFromFirstMinute: s.ppFromFirstMinute }]));
  return {
    db,
    now,
    nowMs: referenceNow(now).getTime(),
    people,
    contractors: contractors.sort((a, b) => a.name.replace(/^\[/, '').localeCompare(b.name.replace(/^\[/, ''), 'fr', { sensitivity: 'base' })),
    sites,
    selectedSite: site,
    ruleOf: (siteId: string) => rules.get(siteId),
    allPlans: plans,
    allPermits: permits,
    activities,
    /** Plans cités par un événement (signalement lié à l'intervention). */
    eventPlanIds: new Set(linkedEvents.map((e) => e.planId).filter(Boolean)),
    linkedEvents,
    plans: plans.filter((p) => keep(p.siteId)),
    permits: permits.filter((p) => keep(p.siteId)),
  };
});
type Rows = Awaited<ReturnType<typeof loadRows>>;
type PermitRow = Rows['allPermits'][number];

/**
 * Écarts du site sélectionné (même calcul pour l'écran, le badge et les échéances) : interventions en cours sans plan
 * obligatoire signé, et permis d'entreprises extérieures (demandés ou délivrés) sans plan signé couvrant leur validité
 * sur un site « dès la première minute ». L'indicateur compte des interventions : un permis rattaché à un plan déjà en écart
 * relève de la même intervention et n'est compté qu'une fois, avec son plan (affiché « Écart · compté avec PP-… »).
 */
function gapsOf({ now, nowMs, plans, permits, allPlans, ruleOf }: Rows) {
  const planById = new Map(allPlans.map((p) => [p.id, p]));
  const linkedPlan = (p: PermitRow) => (p.preventionPlanId ? planById.get(p.preventionPlanId) : undefined);
  const planGaps = new Set(plans.filter((p) => lacksSignedPlan(p, now, ruleOf(p.siteId))).map((p) => p.id));
  const permitGaps = new Set(permits.filter((p) => permitLacksSignedPlan(p, linkedPlan(p), ruleOf(p.siteId), nowMs)).map((p) => p.id));
  /** Permis en écart rattaché à un plan en écart → référence du plan qui porte l'écart. */
  const gapWith = new Map(permits
    .filter((p) => permitGaps.has(p.id) && p.preventionPlanId && planGaps.has(p.preventionPlanId))
    .map((p): [string, string] => [p.id, p.preventionPlanId!]));
  const countedPermitGaps = new Set([...permitGaps].filter((id) => !gapWith.has(id)));
  return { linkedPlan, planGaps, permitGaps, gapWith, countedPermitGaps };
}

type PlanRow = Rows['allPlans'][number];

/**
 * Écarts et nombre d'interventions sans plan signé (plans en écart, permis en écart comptés à part) : même calcul pour
 * l'écran et la veille. Écarts passés (PRV-01, indicateurs seulement, ni badge ni échéance) : interventions commencées
 * dans les 12 derniers mois avec un plan obligatoire signé après leur début, ou réalisées sans plan signé, hors écarts
 * en cours ; plans annulés et permis exclus (la délivrance d'un permis exige déjà un plan signé).
 */
function gapSummary(rows: Rows) {
  const { now, plans, ruleOf } = rows;
  const gaps = gapsOf(rows);
  const pastGaps = plans
    .filter((p) => !gaps.planGaps.has(p.id) && inGapWindow(p, now))
    .map((p) => ({ plan: p, kind: startGap(p, now, ruleOf(p.siteId)) }))
    .filter((x): x is { plan: PlanRow; kind: StartGapKind } => !!x.kind)
    .sort((a, b) => b.plan.startOn.localeCompare(a.plan.startOn));
  return { gaps, gapCount: gaps.planGaps.size + gaps.countedPermitGaps.size, pastGaps, pastGapCount: pastGaps.length };
}

/** Permis encore actifs (demandés ou délivrés, éventuellement expirés non clos). */
const isOpenPermit = (p: { status: string }) => p.status === 'demande' || p.status === 'delivre';
const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n > 1 ? p : s}`;
/** Instant → « 31/03/2026 » (jour à Paris). */
const fmtInstant = (d: Date) => fmtDate(toParisLocal(d).slice(0, 10));

const sevesoShort = (seveso: string | null) => (seveso === 'seuil_haut' ? 'Seveso seuil haut' : seveso === 'seuil_bas' ? 'Seveso seuil bas' : 'Règle du site');

/** Sous-titre de l'indicateur des écarts, selon la règle des sites où ils se trouvent. */
function gapRuleLabel(rules: (SiteRule | undefined)[]) {
  const strict = rules.filter((r) => firstMinuteRule(r));
  if (!strict.length) return 'écart R. 4512-6';
  if (strict.length < rules.length) return 'écart · règle de chaque site';
  const seveso = strict[0]?.seveso ?? null;
  return seveso && strict.every((r) => r?.seveso === seveso) ? `écart · ${sevesoShort(seveso)}` : 'écart · règle interne du site';
}

/** Icône d'une pièce jointe selon son type. */
const fileIcon = (mime: string, name: string) =>
  (mime === 'application/pdf' || /\.pdf$/i.test(name) ? 'ph-file-pdf'
    : /word|officedocument\.wordprocessing/.test(mime) || /\.docx?$/i.test(name) ? 'ph-file-doc'
      : mime.startsWith('image/') ? 'ph-file-image' : 'ph-file');

function siteRuleView(s: Rows['sites'][number]): SiteRuleView {
  return {
    id: s.id,
    label: s.label,
    seveso: s.seveso,
    ppFromFirstMinute: s.ppFromFirstMinute,
    classLabel: sevesoLabel(s.seveso),
    ruleLabel: s.ppFromFirstMinute ? 'plan de prévention dès la première minute' : 'plan écrit dès 400 h sur 12 mois ou travaux dangereux (R. 4512-7)',
  };
}

const FORMAT_LABEL: Record<PpImportFormat, string> = { pdf_form: 'PDF remplissable', docx: 'Document Word', scan: 'Document numérisé' };
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Lecture tolérante de la colonne jsonb `form_data` (voir PpFormData). */
function parseFormData(raw: unknown): PpFormData | null {
  if (!isObj(raw) || !Array.isArray(raw.sections)) return null;
  const src = isObj(raw.source) ? raw.source : {};
  const format = (Object.keys(FORMAT_LABEL) as PpImportFormat[]).find((k) => k === src.format) ?? 'pdf_form';
  const sections = raw.sections.filter(isObj).map((sec) => ({
    title: String(sec.title ?? '').trim(),
    items: (Array.isArray(sec.items) ? sec.items : []).filter(isObj)
      .map((i) => ({
        label: String(i.label ?? '').trim(),
        checked: typeof i.checked === 'boolean' ? i.checked : undefined,
        value: i.value == null || String(i.value).trim() === '' ? undefined : String(i.value).trim(),
      }))
      .filter((i) => i.label),
  })).filter((sec) => sec.title || sec.items.length);
  return {
    source: {
      fileName: String(src.fileName ?? '').trim() || 'Formulaire importé',
      format,
      templateId: typeof src.templateId === 'number' ? src.templateId : null,
      importedOn: String(src.importedOn ?? ''),
    },
    sections,
  };
}

const periodLabel = (start: string, end: string) => (start.slice(0, 4) === end.slice(0, 4) ? `${fmtDayMonth(start)} → ${fmtDate(end)}` : `${fmtDate(start)} → ${fmtDate(end)}`);
const byIdDesc = (a: { id: string }, b: { id: string }) => b.id.localeCompare(a.id, 'fr', { numeric: true });

/** Procédure de référence de l'écran (domain.ts : SCREEN_PROCEDURES), résolue dans la gestion documentaire. */
async function loadProcedure(db: Rows['db']): Promise<ProcedureLink | null> {
  const id = SCREEN_PROCEDURES.prevention;
  if (!id) return null;
  const [doc] = await db.select({ id: t.documents.id, title: t.documents.title }).from(t.documents).where(eq(t.documents.id, id));
  if (!doc) return null;
  const [version] = await db.select({ version: t.documentVersions.version }).from(t.documentVersions)
    .where(and(eq(t.documentVersions.documentId, id), eq(t.documentVersions.status, 'approuve')));
  return { id: doc.id, title: version ? `${doc.title} · version ${version.version}` : doc.title, href: `/documents?doc=${encodeURIComponent(doc.id)}` };
}

/** Écran Plans de prévention et permis : vues sérialisables, indicateurs, écarts et règle des sites. */
export async function loadPrevention() {
  const rows = await loadRows();
  const { db, now, nowMs, people, contractors, sites, selectedSite, ruleOf, allPlans, allPermits, activities, eventPlanIds, linkedEvents, plans, permits } = rows;
  const { gaps, pastGaps } = gapSummary(rows);
  const name = (id: string | null) => (id ? people.get(id)?.name ?? null : null);
  const contractorOf = new Map(contractors.map((c) => [c.id, c]));
  const siteOf = new Map(sites.map((s) => [s.id, s.label]));
  const planIds = plans.map((p) => p.id);
  const permitIds = permits.map((p) => p.id);
  const importIds = plans.map((p) => p.importedFromId).filter((id): id is string => !!id);

  const [preventionActions, attachments, imported, permitLogs, procedure] = await Promise.all([
    // Actions reprises (bases antérieures au 15/10/2026), abandonnées comprises : elles restent rattachées (un plan qui en
    // a une n'est plus un brouillon supprimable). Source par les colonnes posées à la création (ACT-01).
    planIds.length || permitIds.length ? db.select().from(t.actions).where(or(isNotNull(t.actions.preventionPlanId), isNotNull(t.actions.permitId))) : [],
    planIds.length ? db.select().from(t.attachments).where(eq(t.attachments.entityType, PLAN_ATTACHMENT)).orderBy(asc(t.attachments.createdAt)) : [],
    importIds.length ? db.select({ id: t.attachments.id }).from(t.attachments).where(inArray(t.attachments.id, importIds)) : [],
    // Historique des plans et des entreprises : chargé à l'ouverture de leur fiche (QUA-11, LazyChangeLog) ; celui des
    // permis reste chargé ici, il porte la date de délivrance affichée (PRV-04).
    loadChangeLogs('permit', permitIds),
    loadProcedure(db),
  ]);
  const linkedActions = preventionActions.filter((a) => a.status !== 'abandonnee');
  const importedIds = new Set(imported.map((f) => f.id));
  const actionsOf = (key: 'preventionPlanId' | 'permitId', id: string) => linkedActions
    .filter((a) => a[key] === id)
    .sort(byIdDesc)
    .map((a) => {
      const v = actionView(a, people, now);
      return { id: a.id, label: v.label, statusLabel: v.statusLabel, tone: v.tone, due: fmtDate(a.dueOn), pilot: v.pilot };
    });

  // Événements rattachés, le plus récent d'abord ; un événement classé sans suite reste listé avec ce statut.
  const eventsOf = (key: 'planId' | 'permitId', id: string): LinkedEvent[] => linkedEvents
    .filter((e) => e[key] === id)
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
    .map((e) => ({
      id: e.id, title: e.title, typeLabel: EVENT_TYPES[e.type as EventType]?.label ?? e.type, date: fmtDate(e.occurredOn),
      stepLabel: e.dismissedAt ? EVENT_DISMISSED : EVENT_STEPS[e.step] ?? '',
      tone: e.dismissedAt || e.step >= STEP_CLOSED ? 'neutral' : 'warn',
    }));

  const permitViews: PermitView[] = permits.map((p) => {
    const type: PermitType = p.type === 'essai' ? 'essai' : 'feu';
    const state = permitState(p, nowMs);
    const checklist = parseChecklist(p.checklist);
    const from = toParisLocal(p.validFrom), to = toParisLocal(p.validTo);
    const watch = p.watchUntil ? toParisLocal(p.watchUntil) : null;
    const rule = ruleOf(p.siteId);
    const plan = gaps.linkedPlan(p);
    const check = isOpenPermit(p) ? permitPlanCheck(p, plan, rule) : null;
    const planIssue = check?.message ?? null;
    const planRequired = permitNeedsSignedPlan(p, rule);
    const history = permitLogs.get(p.id) ?? [];
    // Journal le plus récent d'abord : dernière délivrance (la date de délivrance n'a pas de colonne, voir PRV-04).
    const delivery = p.status === 'demande' ? null : history.find((e) => e.action === 'status' && e.summary === PERMIT_DELIVERED);
    const deliveredAt = delivery ? toParisLocal(new Date(delivery.at)) : null;
    return {
      id: p.id,
      type,
      typeLabel: PERMIT_TYPES[type].label,
      icon: PERMIT_TYPES[type].icon,
      siteId: p.siteId,
      site: siteOf.get(p.siteId) ?? p.siteId,
      location: p.location,
      description: p.description,
      contractorId: p.contractorId,
      contractor: p.contractorId ? contractorOf.get(p.contractorId)?.name ?? null : null,
      performer: p.performer,
      issuerId: p.issuerId,
      issuer: name(p.issuerId),
      preventionPlanId: p.preventionPlanId,
      plan: plan ? { id: plan.id, signed: isFullySigned(plan), period: periodLabel(plan.startOn, plan.endOn) } : null,
      firstMinute: firstMinuteRule(rule),
      ruleReason: firstMinuteRule(rule) ? firstMinuteReason(rule) : null,
      planRequired,
      planIssue,
      planIssueKind: check?.kind ?? null,
      planBlocker: p.status === 'demande' ? planIssue : null,
      planGap: gaps.permitGaps.has(p.id),
      planGapWith: gaps.gapWith.get(p.id) ?? null,
      keystoneProject: p.keystoneProject,
      validFrom: from,
      validTo: to,
      watchUntil: watch,
      validity: fmtLocalRange(from, to),
      watchLabel: watch ? (watch.slice(0, 10) === to.slice(0, 10) ? watch.slice(11, 16) : fmtLocalShort(watch)) : null,
      checklist,
      allChecked: checklist.length > 0 && checklist.every((c) => c.checked),
      status: p.status,
      state,
      stateLabel: PERMIT_STATE[state].label,
      tone: PERMIT_STATE[state].tone,
      watching: state === 'en_cours' && p.validTo.getTime() < nowMs,
      closedAt: p.closedAt ? toParisLocal(p.closedAt) : null,
      closedLabel: p.closedAt ? fmtLocalLong(toParisLocal(p.closedAt)) : null,
      deliveredAt,
      deliveredLabel: deliveredAt ? fmtLocalLong(deliveredAt) : null,
      cancelReason: p.status === 'annule' ? p.cancelReason : null,
      cancelledBy: p.status === 'annule' ? name(p.cancelledById) : null,
      actions: actionsOf('permitId', p.id),
      planActions: p.preventionPlanId ? linkedActions.filter((a) => a.preventionPlanId === p.preventionPlanId).length : 0,
      events: eventsOf('permitId', p.id),
      history,
    };
  });
  const PERMIT_ORDER: PermitState[] = ['en_cours', 'expire', 'delivre', 'demande', 'clos', 'annule'];
  permitViews.sort((a, b) => PERMIT_ORDER.indexOf(a.state) - PERMIT_ORDER.indexOf(b.state) || b.validFrom.localeCompare(a.validFrom));

  const planViews: PlanView[] = plans.map((p) => {
    const status = planStatus(p, now);
    const ended = isPlanEnded(p);
    const rule = ruleOf(p.siteId);
    const firstMinute = firstMinuteRule(rule);
    const mandatory = isMandatory(p, rule);
    const contractor = contractorOf.get(p.contractorId);
    const actions = actionsOf('preventionPlanId', p.id);
    const openPermitIds = allPermits.filter((x) => x.preventionPlanId === p.id && isOpenPermit(x)).map((x) => x.id);
    const endCheck = { mandatory, now, openPermitIds };
    const liveActivities = activities.filter((a) => a.planId === p.id && !a.cancelled && a.endOn >= now).length;
    const form = parseFormData(p.formData);
    const gapKind = startGap(p, now, rule);
    return {
      id: p.id,
      siteId: p.siteId,
      site: siteOf.get(p.siteId) ?? p.siteId,
      contractorId: p.contractorId,
      contractor: contractor?.name ?? p.contractorId,
      contractorTrade: contractor?.trade ?? '',
      contractorContact: { name: contractor?.contactName ?? null, phone: contractor?.contactPhone ?? null, email: contractor?.contactEmail ?? null },
      title: p.title,
      location: p.location,
      startOn: p.startOn,
      endOn: p.endOn,
      period: periodLabel(p.startOn, p.endOn),
      estimatedHours: p.estimatedHours,
      dangerousWork: p.dangerousWork,
      keystoneProject: p.keystoneProject,
      inspectionOn: p.inspectionOn,
      inspectionDone: inspectionDone(p, now),
      interferenceRisks: p.interferenceRisks,
      measures: p.measures,
      signedEuOn: p.signedEuOn,
      signedEeOn: p.signedEeOn,
      signedEu: p.signedEuOn && p.signedEuName ? { name: p.signedEuName, quality: p.signedEuQuality } : null,
      signedEe: p.signedEeOn && p.signedEeName ? { name: p.signedEeName, quality: p.signedEeQuality } : null,
      firstSignedOn: p.firstSignedOn,
      startGap: gapKind && {
        kind: gapKind, label: START_GAP_LABEL[gapKind], past: !gaps.planGaps.has(p.id),
        signedOn: gapKind === 'signe_apres' ? firstFullSignatureOn(p) : null,
      },
      eeHeadcount: p.eeHeadcount,
      eeSupervisor: p.eeSupervisor,
      subcontracting: p.subcontracting,
      dangerousPhases: p.dangerousPhases,
      equipment: p.equipment,
      workerInstructions: p.workerInstructions,
      emergencyOrganisation: p.emergencyOrganisation,
      coordination: p.coordination,
      sirPosts: p.sirPosts,
      contentMissing: mandatory ? missingPlanContent(p) : [],
      contentStats: planContentStats(p),
      ownerId: p.ownerId,
      owner: name(p.ownerId),
      status,
      statusLabel: PLAN_STATUS[status].label,
      tone: PLAN_STATUS[status].tone,
      phase: planPhase(p, now),
      firstMinute,
      ruleBasis: firstMinute ? ruleBasis(rule) : null,
      mandatory,
      mandatoryReason: mandatoryReason(p, rule),
      mandatoryShort: firstMinute ? `${sevesoShort(rule?.seveso ?? null)} · dès la première minute` : legalReason(p),
      legalMandatory: legalMandatory(p),
      legalReason: legalReason(p),
      inProgress: isInProgress(p, now),
      missingSignature: gaps.planGaps.has(p.id),
      overdue: !ended && p.endOn < now,
      closeBlock: ended ? null : planEndIssue(p, { ...endCheck, verb: 'clore' }),
      cancelBlock: ended ? null : planEndIssue(p, { ...endCheck, verb: 'annuler' })
        ?? (liveActivities ? `${plural(liveActivities, 'activité de la carte en cours ou à venir rattachée', 'activités de la carte en cours ou à venir rattachées')} au plan : retirez-les ou modifiez-les avant d'annuler le plan.` : null),
      deletable: status === 'brouillon' && !p.signedEuOn && !p.signedEeOn
        && !allPermits.some((x) => x.preventionPlanId === p.id)
        && !preventionActions.some((a) => a.preventionPlanId === p.id)
        && !activities.some((a) => a.planId === p.id) && !eventPlanIds.has(p.id),
      cancelled: p.status === 'annule'
        ? { on: p.cancelledAt ? fmtInstant(p.cancelledAt) : '—', by: name(p.cancelledById), reason: p.cancelReason ?? '' }
        : null,
      permits: permitViews.filter((x) => x.preventionPlanId === p.id)
        .map((x) => ({ id: x.id, type: x.type, stateLabel: x.stateLabel, tone: x.tone, validity: x.validity, requested: x.status === 'demande', gap: x.planGap })),
      actions,
      events: eventsOf('planId', p.id),
      // Le fichier source d'un formulaire importé figure dans « Formulaire importé », pas dans les pièces jointes.
      attachments: attachments
        .filter((f) => f.entityId === p.id && f.id !== p.importedFromId)
        .map((f) => ({ id: f.id, name: f.fileName, url: attachmentUrl(f.id), isImage: f.mimeType.startsWith('image/'), icon: fileIcon(f.mimeType, f.fileName) })),
      form: form && {
        fileName: form.source.fileName,
        format: form.source.format,
        formatLabel: FORMAT_LABEL[form.source.format],
        importedOn: /^\d{4}-\d{2}-\d{2}/.test(form.source.importedOn) ? fmtDate(form.source.importedOn.slice(0, 10)) : null,
        fileUrl: p.importedFromId && importedIds.has(p.importedFromId) ? attachmentUrl(p.importedFromId) : null,
        sections: form.sections,
      },
    };
  });
  const PHASE_ORDER: PlanPhase[] = ['en_cours', 'a_clore', 'a_venir', 'clos', 'annule'];
  planViews.sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase)
    || Number(b.missingSignature) - Number(a.missingSignature)
    || (a.phase === 'clos' || a.phase === 'annule' ? b.endOn.localeCompare(a.endOn) : a.startOn.localeCompare(b.startOn)));

  const contractorViews: ContractorView[] = contractors.map((c) => {
    const cp = planViews.filter((p) => p.contractorId === c.id);
    const cr = permitViews.filter((p) => p.contractorId === c.id);
    // Plans et permis en cours sur un site quelconque (pas seulement le site sélectionné).
    const busy = [
      ...allPlans.filter((p) => p.contractorId === c.id && !isPlanEnded(p)),
      ...allPermits.filter((p) => p.contractorId === c.id && isOpenPermit(p)),
    ].map((p) => p.id);
    const archivedBy = name(c.archivedById);
    return {
      id: c.id,
      name: c.name,
      trade: c.trade,
      contactName: c.contactName,
      contactPhone: c.contactPhone,
      contactEmail: c.contactEmail,
      plans: cp.length,
      activePlans: cp.filter((p) => p.inProgress).length,
      permits: cr.length,
      activePermits: cr.filter((p) => p.state === 'en_cours' || p.state === 'delivre').length,
      archived: !!c.archivedAt,
      archivedLabel: c.archivedAt ? `Archivée le ${fmtInstant(c.archivedAt)}${archivedBy ? ` par ${archivedBy}` : ''}` : null,
      archiveReason: c.archiveReason,
      planList: cp.map((p) => ({ id: p.id, title: p.title, period: p.period, statusLabel: p.statusLabel, tone: p.tone, site: p.site })),
      permitList: cr.map((p) => ({ id: p.id, typeLabel: p.typeLabel, icon: p.icon, validity: p.validity, stateLabel: p.stateLabel, tone: p.tone })),
      archiveBlock: busy.length ? `Plans ou permis en cours (${busy.join(', ')}) : clôturez-les ou annulez-les avant d'archiver.` : null,
    };
  });
  const activeContractors = contractors.filter((c) => !c.archivedAt);

  // Règle des sites affichés (site sélectionné, ou tous les sites actifs) ; les sites archivés ne gardent que leurs libellés.
  const siteRules = sites.filter((s) => (selectedSite ? s.id === selectedSite : !s.archivedAt)).map(siteRuleView);
  const ruleSites = siteRules.filter((r) => r.ppFromFirstMinute);
  const ruleNote = !ruleSites.length ? 'Plan écrit obligatoire (R. 4512-7) dès 400 h sur 12 mois ou travaux dangereux'
    : ruleSites.length < siteRules.length ? 'Plan signé dès la première minute ou dès 400 h / travaux dangereux, selon le site'
      : `${ruleSites.every((r) => r.seveso === ruleSites[0].seveso) ? sevesoShort(ruleSites[0].seveso) : 'Règle des sites'} : plan signé dès la première minute, permis compris`;

  // Indicateurs (les plans annulés n'en font pas partie : ni en cours, ni à signer)
  const inProgress = planViews.filter((p) => p.inProgress);
  const missing = planViews.filter((p) => p.missingSignature);
  const permitAlerts = permitViews.filter((p) => gaps.countedPermitGaps.has(p.id));
  const gapCount = missing.length + permitAlerts.length;
  const lateSigned = pastGaps.filter((g) => g.kind === 'signe_apres').length;
  const unsignedPast = pastGaps.length - lateSigned;
  const pastRefs = pastGaps.slice(0, 3).map((g) => g.plan.id).join(', ') + (pastGaps.length > 3 ? '…' : '');
  const gapSites = [...new Set([...missing, ...permitAlerts].map((p) => p.siteId))];
  const toSign = planViews.filter((p) => p.status === 'a_signer');
  const active = permitViews.filter((p) => p.state === 'en_cours' || p.state === 'delivre');
  const expired = permitViews.filter((p) => p.state === 'expire');
  const onSite = new Set(inProgress.map((p) => p.contractorId)).size;
  const kpis: { label: string; value: string; sub: string; note: string; tone: Tone }[] = [
    {
      label: 'Interventions en cours',
      value: String(inProgress.length),
      sub: `dont ${inProgress.filter((p) => p.mandatory).length} à plan obligatoire`,
      note: `${plural(onSite, 'entreprise extérieure', 'entreprises extérieures')} sur site`,
      tone: 'neutral',
    },
    {
      label: 'Plans à signer',
      value: String(toSign.length),
      sub: `dont ${toSign.filter((p) => p.phase === 'a_venir').length} avant démarrage`,
      note: 'Inspection commune réalisée, signatures attendues',
      tone: toSign.length ? 'warn' : 'neutral',
    },
    {
      label: 'Interventions sans plan signé',
      value: String(gapCount),
      sub: !gapCount ? 'conforme' : gapRuleLabel(gapSites.map(ruleOf)),
      note: ruleNote,
      tone: gapCount ? 'danger' : 'ok',
    },
    {
      // Écarts R. 4512-6 en cours et passés (interventions commencées depuis 12 mois) : indicateur seulement, hors badge.
      label: 'Écarts R. 4512-6 sur 12 mois',
      value: String(gapCount + pastGaps.length),
      sub: gapCount ? `dont ${gapCount} en cours` : pastGaps.length ? 'aucun en cours' : 'conforme',
      note: pastGaps.length
        ? `${[
          lateSigned && plural(lateSigned, 'plan signé après le démarrage', 'plans signés après le démarrage'),
          unsignedPast && plural(unsignedPast, 'intervention réalisée sans plan signé', 'interventions réalisées sans plan signé'),
        ].filter(Boolean).join(' · ')} (${pastRefs})`
        : 'Aucun plan signé après le démarrage ni intervention réalisée sans plan signé',
      tone: gapCount ? 'danger' : pastGaps.length ? 'warn' : 'ok',
    },
    {
      label: 'Permis actifs',
      value: String(active.length),
      sub: `${active.filter((p) => p.type === 'feu').length} feu · ${active.filter((p) => p.type === 'essai').length} essai`,
      note: expired.length ? `${plural(expired.length, 'permis expiré non clos', 'permis expirés non clos')}` : 'Aucun permis expiré non clos',
      tone: expired.length ? 'danger' : 'neutral',
    },
  ];

  // Un site sélectionné : les nouveaux plans et permis y sont saisis (sinon ils disparaîtraient de l'écran filtré).
  const defaultSiteId = selectedSite ?? siteRules[0]?.id ?? '';
  const recordSites = siteRules.map((s): Option => [s.id, s.label]);
  return {
    now,
    plans: planViews,
    permits: permitViews,
    contractors: contractorViews,
    kpis,
    /** Interventions en cours sans plan signé (plans). */
    alerts: missing,
    /** Permis d'entreprises extérieures sans plan signé, hors permis d'un plan déjà en écart. */
    permitAlerts,
    /** Écarts R. 4512-6 passés sur 12 mois (indicateur), le plus récent d'abord. */
    pastGaps: pastGaps.map(({ plan: p, kind }) => ({
      id: p.id, title: p.title, contractor: contractorOf.get(p.contractorId)?.name ?? p.contractorId, startOn: p.startOn, kind,
      label: START_GAP_LABEL[kind], href: `/prevention?plan=${encodeURIComponent(p.id)}`,
    })),
    siteRules,
    procedure,
    counts: { inProgress: inProgress.length, activePermits: active.length, contractors: activeContractors.length },
    choices: {
      // Entreprises archivées exclues (un formulaire de modification ajoute l'entreprise déjà choisie).
      contractors: activeContractors.map((c): Option => [c.id, `${c.name} — ${c.trade}`]),
      plans: planViews.filter((p) => p.status !== 'annule').map((p): PlanChoice => ({
        id: p.id, siteId: p.siteId, contractorId: p.contractorId, contractor: p.contractor, title: p.title,
        startOn: p.startOn, endOn: p.endOn, period: p.period, mandatory: p.mandatory, signed: !!(p.signedEuOn && p.signedEeOn), closed: p.status === 'clos',
      })),
      defaultSiteId,
      recordSites,
      siteLocked: !!selectedSite,
    },
  };
}
export type PreventionData = Awaited<ReturnType<typeof loadPrevention>>;

/**
 * Indicateur calculé pour la veille réglementaire (exigence du domaine PREVENTION_REQUIREMENT_DOMAIN, R. 4512-6) :
 * interventions sans plan signé en cours et écarts passés sur 12 mois (PRV-01), sur tout le périmètre de la personne
 * (VEI-06 : l'exigence vaut pour l'entreprise, quel que soit le site sélectionné), même calcul que l'écran. gapCount compte
 * les deux ; l'évaluation de conformité reste un jugement du pilote, affiché à côté.
 */
export const loadPreventionCompliance = cache(async (): Promise<{
  gapCount: number; currentGapCount: number; pastGapCount: number; label: string; tone: Tone; href: string;
}> => {
  const { gapCount: current, pastGapCount: past } = gapSummary(await loadRows('perimeter'));
  const pastLabel = `${plural(past, 'écart passé', 'écarts passés')} sur 12 mois`;
  return {
    gapCount: current + past,
    currentGapCount: current,
    pastGapCount: past,
    label: current
      ? `${plural(current, 'intervention sans plan signé', 'interventions sans plan signé')}${past ? ` · ${pastLabel}` : ''}`
      : past ? `Aucune intervention en cours sans plan signé · ${pastLabel}` : 'Aucun écart R. 4512-6 sur 12 mois',
    tone: current ? 'danger' : past ? 'warn' : 'ok',
    href: '/prevention',
  };
});

/**
 * Échéances du domaine (tableau de bord, notifications, badge), sur tous les sites du périmètre (TDB-05, siteId du plan
 * ou du permis) ; plans clos ou annulés exclus :
 * - plans : intervention en cours sans plan signé (écart) ; plan obligatoire à signer avant un démarrage sous l'horizon ;
 *   période échue, plan à clore ; sinon inspection commune prévue sous l'horizon pour un plan non signé ;
 * - permis : écart (entreprise extérieure sans plan signé, compté avec son plan s'il est lui-même en écart) ;
 *   permis expiré non clos ou demande échue ; demande à délivrer dont la validité commence sous l'horizon.
 * Les échéances ouvrent directement la fiche concernée (/prevention?plan=… ou ?onglet=permis&permis=…).
 * Les écarts R. 4512-6 passés (PRV-01 : plan signé après le début, intervention réalisée sans plan signé) restent des
 * indicateurs (écran, veille, revue de direction) : ni échéance ni badge ; aucune action QSE n'est exigée à la clôture
 * (actions immédiates hors actions QSE, réponses du service QHSE du 15/10/2026).
 */
export const loadPreventionSignals = cache(async (): Promise<{ badge: number; todo: TodoItem[] }> => {
  const rows = await loadRows('perimeter');
  const { now, nowMs, people, contractors, plans, permits, ruleOf } = rows;
  const { gaps } = gapSummary(rows);
  const horizon = addDays(now, SIGNAL_HORIZON_DAYS);
  const contractorName = (id: string | null) => (id ? contractors.find((c) => c.id === id)?.name ?? id : 'Intervention interne');
  const owner = (id: string | null) => (id ? people.get(id)?.name ?? '' : '');
  const todo: TodoItem[] = [];

  plans.forEach((p) => {
    if (isPlanEnded(p)) return;
    const href = `/prevention?plan=${p.id}`;
    const who = [contractorName(p.contractorId), owner(p.ownerId)].filter(Boolean).join(' · ');
    const ownerIds = p.ownerId ? [p.ownerId] : undefined;
    const kind = 'Plan de prévention';
    const siteId = p.siteId;
    if (gaps.planGaps.has(p.id)) {
      todo.push({ date: now, dueOn: p.startOn, kind, tone: 'danger', title: `${p.id} · intervention en cours sans plan signé — ${p.title}`, who, href, ownerIds, siteId, overdue: true });
      return;
    }
    if (p.endOn < now) {
      todo.push({ date: p.endOn, dueOn: p.endOn, kind, tone: 'warn', title: `${p.id} · période échue, plan à clore — ${p.title}`, who, href, ownerIds, siteId, overdue: true });
      return;
    }
    const toSignBeforeStart = p.startOn > now && p.startOn <= horizon && isMandatory(p, ruleOf(p.siteId)) && !isFullySigned(p);
    if (toSignBeforeStart) {
      todo.push({ date: p.startOn, dueOn: p.startOn, kind, tone: 'warn', title: `${p.id} · plan à signer avant le démarrage — ${p.title}`, who, href, ownerIds, siteId });
    } else if (!isFullySigned(p) && p.inspectionOn && p.inspectionOn > now && p.inspectionOn <= horizon) {
      todo.push({ date: p.inspectionOn, dueOn: p.inspectionOn, kind, tone: 'neutral', title: `${p.id} · inspection commune prévue le ${fmtDate(p.inspectionOn)} — ${p.title}`, who, href, ownerIds, siteId });
    }
  });
  permits.forEach((p) => {
    const type: PermitType = p.type === 'essai' ? 'essai' : 'feu';
    const label = PERMIT_TYPES[type].label.toLowerCase();
    const who = [contractorName(p.contractorId), owner(p.issuerId)].filter(Boolean).join(' · ');
    const href = `/prevention?onglet=permis&permis=${p.id}`;
    const ownerIds = p.issuerId ? [p.issuerId] : undefined;
    const siteId = p.siteId;
    // Permis en écart : compté à part, sauf s'il est rattaché à un plan déjà en écart (échéance du plan).
    if (gaps.permitGaps.has(p.id)) {
      if (!gaps.countedPermitGaps.has(p.id)) return;
      const what = p.status === 'demande' ? `demande de ${label}` : label;
      todo.push({ date: now, kind: 'Permis', tone: 'danger', title: `${p.id} · ${what} d'une entreprise extérieure sans plan de prévention signé — ${p.location}`, who, href, ownerIds, siteId, overdue: true });
      return;
    }
    if (permitState(p, nowMs) === 'expire') {
      todo.push({
        date: now, kind: 'Permis', tone: 'danger',
        title: p.status === 'demande'
          ? `${p.id} · demande de ${label} échue, jamais délivrée — ${p.location}`
          : `${p.id} · ${label} expiré non clos — ${p.location}`,
        who, href, ownerIds, siteId, overdue: true,
      });
      return;
    }
    const { from } = permitDays(p);
    if (p.status === 'demande' && from <= horizon) {
      const validity = fmtLocalRange(toParisLocal(p.validFrom), toParisLocal(p.validTo));
      todo.push({ date: from > now ? from : now, dueOn: from, kind: 'Permis', tone: 'warn', title: `${p.id} · ${label} à délivrer (validité ${validity}) — ${p.location}`, who, href, ownerIds, siteId });
    }
  });

  return { badge: todo.length, todo: todo.sort(byUrgency) };
});
