import 'server-only';
import { cache } from 'react';
import { asc, eq, inArray } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import {
  PERMIT_STATE, PERMIT_TYPES, PLAN_STATUS, SIGNAL_HORIZON_DAYS,
  firstMinuteReason, firstMinuteRule, fmtLocalLong, fmtLocalRange, fmtLocalShort, inspectionDone, isFullySigned, isInProgress, isMandatory,
  lacksSignedPlan, legalMandatory, legalReason, mandatoryReason, parseChecklist, permitLacksSignedPlan, permitNeedsSignedPlan, permitPlanCheck,
  permitState, planPhase, planStatus, referenceNow, ruleBasis, sevesoLabel, toParisLocal,
  type ChecklistItem, type PermitPlanIssueKind, type PermitState, type PermitType, type PlanPhase, type PlanStatus, type SiteRule,
} from '@/components/prevention/model';
import type { PpFormData, PpImportFormat } from '@/lib/pp-form';
import { addDays, fmtDate, fmtDayMonth, today } from '../dates';
import type { TodoItem, Tone } from '../domain';
import { actionView, loadPeople } from '../queries';
import type { Option } from './options';
import { currentSiteId, inSite } from '../session';
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
  startOn: string; endOn: string; period: string; mandatory: boolean; signed: boolean; closed: boolean;
};

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
  /** gap : permis sans plan signé (écart compté avec ce plan quand le plan est lui-même en écart). */
  permits: { id: string; type: PermitType; stateLabel: string; tone: Tone; validity: string; requested: boolean; gap: boolean }[];
  actions: { id: string; title: string; statusLabel: string; tone: Tone; due: string; pilot: string }[];
  /** Pièces jointes (exemplaire signé…), hors fichier source d'un formulaire importé (voir form). */
  attachments: { id: string; name: string; url: string; isImage: boolean; icon: string }[];
  form: PlanFormView | null;
};

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
};

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
};

/** Lignes du site sélectionné (plans, permis), référentiels et règle de prévention de chaque site. */
const loadRows = cache(async () => {
  const [db, site, people] = await Promise.all([getDb(), currentSiteId(), loadPeople()]);
  const [contractors, plans, permits, sites] = await Promise.all([
    db.select().from(t.contractors),
    db.select().from(t.preventionPlans),
    db.select().from(t.permits),
    db.select().from(t.sites).orderBy(asc(t.sites.sort)),
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
    plans: plans.filter((p) => inSite(site, p.siteId)),
    permits: permits.filter((p) => inSite(site, p.siteId)),
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

/** Écran Plans de prévention et permis : vues sérialisables, indicateurs, écarts et règle des sites. */
export async function loadPrevention() {
  const rows = await loadRows();
  const { db, now, nowMs, people, contractors, sites, selectedSite, ruleOf, allPermits, plans, permits } = rows;
  const gaps = gapsOf(rows);
  const name = (id: string | null) => (id ? people.get(id)?.name ?? null : null);
  const contractorOf = new Map(contractors.map((c) => [c.id, c]));
  const siteOf = new Map(sites.map((s) => [s.id, s.label]));
  const planIds = plans.map((p) => p.id);
  const importIds = plans.map((p) => p.importedFromId).filter((id): id is string => !!id);

  const [linkedActions, attachments, imported] = await Promise.all([
    planIds.length ? db.select().from(t.actions).where(eq(t.actions.origin, 'prevention')) : [],
    planIds.length ? db.select().from(t.attachments).where(eq(t.attachments.entityType, PLAN_ATTACHMENT)).orderBy(asc(t.attachments.createdAt)) : [],
    importIds.length ? db.select({ id: t.attachments.id }).from(t.attachments).where(inArray(t.attachments.id, importIds)) : [],
  ]);
  const importedIds = new Set(imported.map((f) => f.id));

  const permitViews: PermitView[] = permits.map((p) => {
    const type: PermitType = p.type === 'essai' ? 'essai' : 'feu';
    const state = permitState(p, nowMs);
    const checklist = parseChecklist(p.checklist);
    const from = toParisLocal(p.validFrom), to = toParisLocal(p.validTo);
    const watch = p.watchUntil ? toParisLocal(p.watchUntil) : null;
    const rule = ruleOf(p.siteId);
    const plan = gaps.linkedPlan(p);
    const check = p.status === 'demande' || p.status === 'delivre' ? permitPlanCheck(p, plan, rule) : null;
    const planIssue = check?.message ?? null;
    const planRequired = permitNeedsSignedPlan(p, rule);
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
    };
  });
  const PERMIT_ORDER: PermitState[] = ['en_cours', 'expire', 'delivre', 'demande', 'clos', 'annule'];
  permitViews.sort((a, b) => PERMIT_ORDER.indexOf(a.state) - PERMIT_ORDER.indexOf(b.state) || b.validFrom.localeCompare(a.validFrom));

  const planViews: PlanView[] = plans.map((p) => {
    const status = planStatus(p, now);
    const rule = ruleOf(p.siteId);
    const firstMinute = firstMinuteRule(rule);
    const mandatory = isMandatory(p, rule);
    const unsigned = mandatory && !isFullySigned(p);
    const contractor = contractorOf.get(p.contractorId);
    const actions = linkedActions.filter((a) => a.originRef === p.id);
    const openPermits = allPermits.filter((x) => x.preventionPlanId === p.id && (x.status === 'demande' || x.status === 'delivre'));
    const closeBlock = status === 'clos' ? null
      : unsigned && p.startOn <= now && p.endOn >= now
        ? 'Intervention en cours avec un plan obligatoire non signé : enregistrez les signatures des deux entreprises avant de clore le plan.'
        : unsigned && p.startOn <= now && !actions.length
          ? "Intervention réalisée sans plan signé : créez l'action qui trace l'écart avant de clore le plan."
          : openPermits.length ? `Permis rattachés encore actifs (${openPermits.map((x) => x.id).join(', ')}) : clôturez-les ou annulez-les avant de clore le plan.` : null;
    const form = parseFormData(p.formData);
    return {
      id: p.id,
      siteId: p.siteId,
      site: siteOf.get(p.siteId) ?? p.siteId,
      contractorId: p.contractorId,
      contractor: contractor?.name ?? p.contractorId,
      contractorTrade: contractor?.trade ?? '',
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
      overdue: status !== 'clos' && p.endOn < now,
      closeBlock,
      permits: permitViews.filter((x) => x.preventionPlanId === p.id)
        .map((x) => ({ id: x.id, type: x.type, stateLabel: x.stateLabel, tone: x.tone, validity: x.validity, requested: x.status === 'demande', gap: x.planGap })),
      actions: actions
        .sort(byIdDesc)
        .map((a) => {
          const v = actionView(a, people, now);
          return { id: a.id, title: a.title, statusLabel: v.statusLabel, tone: v.tone, due: fmtDate(a.dueOn), pilot: v.pilot };
        }),
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
  const PHASE_ORDER: PlanPhase[] = ['en_cours', 'a_clore', 'a_venir', 'clos'];
  planViews.sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase)
    || Number(b.missingSignature) - Number(a.missingSignature)
    || (a.phase === 'clos' ? b.endOn.localeCompare(a.endOn) : a.startOn.localeCompare(b.startOn)));

  const contractorViews: ContractorView[] = contractors.map((c) => {
    const cp = planViews.filter((p) => p.contractorId === c.id);
    const cr = permitViews.filter((p) => p.contractorId === c.id);
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
    };
  });

  // Règle des sites affichés (site sélectionné, ou tous les sites).
  const siteRules = sites.filter((s) => !selectedSite || s.id === selectedSite).map(siteRuleView);
  const ruleSites = siteRules.filter((r) => r.ppFromFirstMinute);
  const ruleNote = !ruleSites.length ? 'Plan écrit obligatoire (R. 4512-7) dès 400 h sur 12 mois ou travaux dangereux'
    : ruleSites.length < siteRules.length ? 'Plan signé dès la première minute ou dès 400 h / travaux dangereux, selon le site'
      : `${ruleSites.every((r) => r.seveso === ruleSites[0].seveso) ? sevesoShort(ruleSites[0].seveso) : 'Règle des sites'} : plan signé dès la première minute, permis compris`;

  // Indicateurs
  const inProgress = planViews.filter((p) => p.inProgress);
  const missing = planViews.filter((p) => p.missingSignature);
  const permitAlerts = permitViews.filter((p) => gaps.countedPermitGaps.has(p.id));
  const gapCount = missing.length + permitAlerts.length;
  const gapSites = [...new Set([...missing, ...permitAlerts].map((p) => p.siteId))];
  const toSign = planViews.filter((p) => p.status === 'a_signer');
  const active = permitViews.filter((p) => p.state === 'en_cours' || p.state === 'delivre');
  const expired = permitViews.filter((p) => p.state === 'expire');
  const onSite = new Set(inProgress.map((p) => p.contractorId)).size;
  const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n > 1 ? p : s}`;
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
      label: 'Permis actifs',
      value: String(active.length),
      sub: `${active.filter((p) => p.type === 'feu').length} feu · ${active.filter((p) => p.type === 'essai').length} essai`,
      note: expired.length ? `${plural(expired.length, 'permis expiré non clos', 'permis expirés non clos')}` : 'Aucun permis expiré non clos',
      tone: expired.length ? 'danger' : 'neutral',
    },
  ];

  // Un site sélectionné : les nouveaux plans et permis y sont saisis (sinon ils disparaîtraient de l'écran filtré).
  const defaultSiteId = selectedSite ?? sites[0]?.id ?? '';
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
    siteRules,
    counts: { inProgress: inProgress.length, activePermits: active.length, contractors: contractors.length },
    choices: {
      contractors: contractors.map((c): Option => [c.id, `${c.name} — ${c.trade}`]),
      plans: planViews.map((p): PlanChoice => ({
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
 * Badge de navigation et échéances du domaine (tableau de bord, notifications), sur le site sélectionné.
 * badge = plans à signer + interventions sans plan signé (plans en cours et permis d'entreprises extérieures, comme les indicateurs de l'écran).
 * Les échéances ouvrent directement la fiche concernée (/prevention?plan=… ou ?onglet=permis&permis=…).
 */
export async function loadPreventionSignals(): Promise<{ badge: number; todo: TodoItem[] }> {
  const rows = await loadRows();
  const { now, nowMs, people, contractors, plans, permits, ruleOf } = rows;
  const gaps = gapsOf(rows);
  const horizon = addDays(now, SIGNAL_HORIZON_DAYS);
  const contractorName = (id: string | null) => (id ? contractors.find((c) => c.id === id)?.name ?? id : 'Intervention interne');
  const owner = (id: string | null) => (id ? people.get(id)?.name ?? '' : '');
  const todo: TodoItem[] = [];
  let toSign = 0;
  let missing = 0;

  plans.forEach((p) => {
    if (p.status === 'clos') return;
    if (planStatus(p, now) === 'a_signer') toSign += 1;
    const href = `/prevention?plan=${p.id}`;
    const who = [contractorName(p.contractorId), owner(p.ownerId)].filter(Boolean).join(' · ');
    if (gaps.planGaps.has(p.id)) {
      missing += 1;
      todo.push({ date: now, kind: 'Plan de prévention', tone: 'danger', title: `${p.id} · intervention en cours sans plan signé — ${p.title}`, who, href });
    } else if (p.startOn > now && p.startOn <= horizon && isMandatory(p, ruleOf(p.siteId)) && !isFullySigned(p)) {
      todo.push({ date: p.startOn, kind: 'Plan de prévention', tone: 'warn', title: `${p.id} · plan à signer avant le démarrage — ${p.title}`, who, href });
    }
  });
  permits.forEach((p) => {
    const type: PermitType = p.type === 'essai' ? 'essai' : 'feu';
    const label = PERMIT_TYPES[type].label.toLowerCase();
    const who = [contractorName(p.contractorId), owner(p.issuerId)].filter(Boolean).join(' · ');
    const href = `/prevention?onglet=permis&permis=${p.id}`;
    // Permis en écart : compté à part, sauf s'il est rattaché à un plan déjà en écart (échéance du plan).
    if (gaps.permitGaps.has(p.id)) {
      if (!gaps.countedPermitGaps.has(p.id)) return;
      missing += 1;
      const what = p.status === 'demande' ? `demande de ${label}` : label;
      todo.push({ date: now, kind: 'Permis', tone: 'danger', title: `${p.id} · ${what} d'une entreprise extérieure sans plan de prévention signé — ${p.location}`, who, href });
      return;
    }
    if (permitState(p, nowMs) === 'expire') {
      todo.push({
        date: now, kind: 'Permis', tone: 'danger',
        title: p.status === 'demande'
          ? `${p.id} · demande de ${label} échue, jamais délivrée — ${p.location}`
          : `${p.id} · ${label} expiré non clos — ${p.location}`,
        who, href,
      });
    }
  });

  return { badge: toSign + missing, todo: todo.sort((a, b) => a.date.localeCompare(b.date)) };
}
