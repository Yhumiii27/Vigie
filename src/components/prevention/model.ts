// Règles métier des plans de prévention et des permis (partagées serveur / client, sans dépendance serveur).
// Code du travail R. 4512-6 à R. 4512-12 · arrêté du 19 mars 1993 (liste des travaux dangereux).
// Règle interne par site (établissement Seveso seuil haut) : plan écrit et signé dès la première minute d'intervention.

import type { Tone } from '@/lib/domain';

/** Seuil d'heures (sur 12 mois) au-delà duquel le plan de prévention écrit est obligatoire (R. 4512-7). */
export const MANDATORY_HOURS = 400;
/** Surveillance recommandée après des travaux par points chauds. */
export const FIRE_WATCH_HOURS = 2;
/** Horizon des échéances « à traiter » (tableau de bord, notifications). */
export const SIGNAL_HORIZON_DAYS = 15;

export const DANGEROUS_WORK_HINT =
  'Arrêté du 19 mars 1993 : chute de hauteur de plus de 3 m, pièces nues sous tension (> TBT), soudage avec permis de feu, atmosphère confinée ou explosive, agents CMR, rayonnements ionisants…';

// ─── Plans de prévention ────────────────────────────────────────────────────

export type PlanStatus = 'brouillon' | 'a_signer' | 'signe' | 'clos' | 'annule';
export const PLAN_STATUS: Record<PlanStatus, { label: string; tone: Tone }> = {
  brouillon: { label: 'Brouillon', tone: 'neutral' },
  a_signer: { label: 'À signer', tone: 'warn' },
  signe: { label: 'Signé', tone: 'ok' },
  clos: { label: 'Clos', tone: 'neutral' },
  annule: { label: 'Annulé', tone: 'neutral' },
};

/** Pièces jointes ajoutées en une fois sur un plan (dans la limite de MAX_BATCH_BYTES au total). */
export const MAX_PLAN_FILES = 5;

/** Plan terminé : clos, ou annulé avec motif (intervention n'ayant pas lieu). Il ne se modifie plus. */
export const isPlanEnded = (p: { status: string }) => p.status === 'clos' || p.status === 'annule';

type PlanLike = {
  status: string;
  startOn: string;
  endOn: string;
  estimatedHours: number;
  dangerousWork: boolean;
  inspectionOn: string | null;
  signedEuOn: string | null;
  signedEeOn: string | null;
};

// ─── Règle du site : classement Seveso et plan « dès la première minute » ───

export type SevesoLevel = 'seuil_haut' | 'seuil_bas';
export const SEVESO_LEVELS: [SevesoLevel, string][] = [['seuil_haut', 'Seuil haut'], ['seuil_bas', 'Seuil bas']];

/** Règle de prévention d'un site (colonnes sites.seveso et sites.ppFromFirstMinute). */
export type SiteRule = { seveso: string | null; ppFromFirstMinute: boolean };

/** « Établissement Seveso seuil haut », « Établissement Seveso seuil bas », « Établissement non classé Seveso ». */
export const sevesoLabel = (seveso: string | null | undefined) =>
  seveso === 'seuil_haut' ? 'Établissement Seveso seuil haut' : seveso === 'seuil_bas' ? 'Établissement Seveso seuil bas' : 'Établissement non classé Seveso';

/** Règle interne active : plan de prévention écrit et signé exigé dès la première minute d'intervention d'une entreprise extérieure. */
export const firstMinuteRule = (rule: SiteRule | null | undefined) => !!rule?.ppFromFirstMinute;

/** Fondement de la règle « dès la première minute » : « Établissement Seveso seuil haut », « Établissement Seveso seuil bas » ou « Règle interne du site ». */
export const ruleBasis = (rule: SiteRule | null | undefined) =>
  (rule?.seveso === 'seuil_haut' || rule?.seveso === 'seuil_bas' ? sevesoLabel(rule.seveso) : 'Règle interne du site');

/** Motif de l'obligation sur un site soumis à la règle interne. */
export const firstMinuteReason = (rule: SiteRule | null | undefined) => `${ruleBasis(rule)} : plan écrit et signé dès la première minute d'intervention`;

/** Première lettre en minuscule (« Établissement Seveso… » → « établissement Seveso… »), sigles et références conservés. */
export const lcfirst = (s: string) => (/^\p{Lu}\p{Ll}/u.test(s) ? s[0].toLocaleLowerCase('fr') + s.slice(1) : s);

/** Obligation légale (R. 4512-7) : ≥ 400 h sur 12 mois ou travaux dangereux. */
export const legalMandatory = (p: Pick<PlanLike, 'estimatedHours' | 'dangerousWork'>) => p.estimatedHours >= MANDATORY_HOURS || p.dangerousWork;

export function legalReason(p: Pick<PlanLike, 'estimatedHours' | 'dangerousWork'>) {
  const reasons = [];
  if (p.estimatedHours >= MANDATORY_HOURS) reasons.push(`${p.estimatedHours} h sur 12 mois`);
  if (p.dangerousWork) reasons.push('travaux dangereux');
  return reasons.join(' et ');
}

/**
 * Plan écrit obligatoire selon la règle du site du plan : toujours sur un site « dès la première minute »
 * (établissement Seveso seuil haut), sinon règle légale R. 4512-7.
 */
export const isMandatory = (p: Pick<PlanLike, 'estimatedHours' | 'dangerousWork'>, rule: SiteRule | null | undefined) => firstMinuteRule(rule) || legalMandatory(p);

export const mandatoryReason = (p: Pick<PlanLike, 'estimatedHours' | 'dangerousWork'>, rule: SiteRule | null | undefined) =>
  (firstMinuteRule(rule) ? firstMinuteReason(rule) : legalReason(p));

export const isFullySigned = (p: Pick<PlanLike, 'signedEuOn' | 'signedEeOn'>) => !!(p.signedEuOn && p.signedEeOn);

/** Inspection commune préalable réalisée à la date `now`. */
export const inspectionDone = (p: Pick<PlanLike, 'inspectionOn'>, now: string) => !!p.inspectionOn && p.inspectionOn <= now;

/** Statut dérivé : brouillon → à signer (inspection commune réalisée) → signé (EU et EE) → clos ; ou annulé. */
export function planStatus(p: PlanLike, now: string): PlanStatus {
  if (p.status === 'annule') return 'annule';
  if (p.status === 'clos') return 'clos';
  if (isFullySigned(p)) return 'signe';
  if (inspectionDone(p, now)) return 'a_signer';
  return 'brouillon';
}

/** Intervention en cours : période commencée et non terminée, plan ni clos ni annulé. */
export const isInProgress = (p: PlanLike, now: string) => !isPlanEnded(p) && p.startOn <= now && now <= p.endOn;

/** Écart R. 4512-6 (ou règle Seveso du site) : intervention en cours sans plan obligatoire signé par les deux entreprises. */
export const lacksSignedPlan = (p: PlanLike, now: string, rule: SiteRule | null | undefined) => isInProgress(p, now) && isMandatory(p, rule) && !isFullySigned(p);

/**
 * Motif empêchant de clore ou d'annuler un plan (même règle à l'écran et côté serveur), null sinon :
 * jamais pendant une intervention sans le plan obligatoire signé ; après une intervention réalisée sans plan signé,
 * seulement une fois l'écart tracé par une action ; jamais avec des permis rattachés encore actifs.
 */
export function planEndIssue(
  p: PlanLike,
  { mandatory, now, openPermitIds, actionCount, verb }: { mandatory: boolean; now: string; openPermitIds: string[]; actionCount: number; verb: 'clore' | 'annuler' },
): string | null {
  const unsigned = mandatory && !isFullySigned(p);
  const what = verb === 'clore' ? 'de clore le plan' : "d'annuler le plan";
  if (unsigned && p.startOn <= now && p.endOn >= now) return `Intervention en cours avec un plan obligatoire non signé : enregistrez les signatures des deux entreprises avant ${what}.`;
  if (unsigned && p.startOn <= now && !actionCount) return `Intervention réalisée sans plan signé : créez l'action qui trace l'écart avant ${what}.`;
  if (openPermitIds.length) return `Permis rattachés encore actifs (${openPermitIds.join(', ')}) : clôturez-les ou annulez-les avant ${what}.`;
  return null;
}

export type PlanPhase ='en_cours' | 'a_venir' | 'a_clore' | 'clos' | 'annule';
/** Regroupement des filtres : en cours (début ≤ aujourd'hui ≤ fin, comme l'indicateur), à venir, à clore (période échue non close), clos, annulé. */
export function planPhase(p: PlanLike, now: string): PlanPhase {
  if (p.status === 'annule') return 'annule';
  if (p.status === 'clos') return 'clos';
  if (p.startOn > now) return 'a_venir';
  return p.endOn < now ? 'a_clore' : 'en_cours';
}

// ─── Permis de feu et permis d'essai ────────────────────────────────────────

export type PermitType = 'feu' | 'essai';
export const PERMIT_TYPE_KEYS: PermitType[] = ['feu', 'essai'];

export const PERMIT_TYPES: Record<PermitType, { label: string; short: string; icon: string; prefix: string; checklist: string[] }> = {
  feu: {
    label: 'Permis de feu',
    short: 'Feu',
    icon: 'ph-fire',
    prefix: 'PF',
    checklist: [
      'Extincteur adapté à proximité',
      'Matières combustibles évacuées ou protégées',
      'Détection incendie neutralisée puis rétablie',
      'Ouvertures et gaines obturées',
      'Surveillance 2 h après la fin des travaux',
      'Intervenant formé',
    ],
  },
  essai: {
    label: "Permis d'essai",
    short: 'Essai',
    icon: 'ph-flask',
    prefix: 'PE',
    checklist: [
      "Zone d'essais balisée et accès restreint",
      'Matériel ATEX vérifié',
      'Produits inertes uniquement',
      "Consignes d'essai communiquées",
      "Arrêt d'urgence testé",
      'Liaison avec le chef de zone',
    ],
  },
};

export type ChecklistItem = { label: string; checked: boolean };

/** Lecture tolérante de la colonne jsonb `checklist`. */
export function parseChecklist(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is { label: unknown; checked?: unknown } => !!x && typeof x === 'object' && 'label' in x)
    .map((x) => ({ label: String(x.label).trim(), checked: x.checked === true }))
    .filter((x) => x.label);
}

export type PermitState = 'demande' | 'delivre' | 'en_cours' | 'expire' | 'clos' | 'annule';
export const PERMIT_STATE: Record<PermitState, { label: string; tone: Tone }> = {
  demande: { label: 'Demandé', tone: 'warn' },
  delivre: { label: 'Délivré', tone: 'accent' },
  en_cours: { label: 'En cours', tone: 'ok' },
  expire: { label: 'Expiré', tone: 'danger' },
  clos: { label: 'Clos', tone: 'neutral' },
  annule: { label: 'Annulé', tone: 'neutral' },
};

/**
 * Statut calculé d'un permis à l'instant `now` (ms) :
 * demande expirée dès la fin de validité (elle ne peut plus être délivrée) ;
 * permis délivré en cours pendant la validité et la surveillance qui suit, expiré au-delà s'il n'a pas été clos.
 */
export function permitState(p: { status: string; validFrom: Date; validTo: Date; watchUntil: Date | null }, now: number): PermitState {
  if (p.status === 'clos' || p.status === 'annule') return p.status;
  if (p.status === 'demande') return validityOver(p, now) ? 'expire' : 'demande';
  const end = Math.max(p.validTo.getTime(), p.watchUntil?.getTime() ?? 0);
  if (end < now) return 'expire';
  return p.validFrom.getTime() <= now ? 'en_cours' : 'delivre';
}

/** Fin de validité atteinte : une demande ne peut plus être délivrée (même règle côté serveur). */
export const validityOver = (p: { validTo: Date }, now: number) => p.validTo.getTime() <= now;

/** Points de la check-list type absents d'une check-list saisie. */
export const missingPresets = (type: PermitType, items: ChecklistItem[]) =>
  PERMIT_TYPES[type].checklist.filter((label) => !items.some((i) => i.label === label));

// ─── Permis et plan de prévention ───────────────────────────────────────────

type PermitPlanLike = { type: string; contractorId: string | null; preventionPlanId: string | null; validFrom: Date; validTo: Date };
type LinkedPlan = PlanLike & { id: string };

const dayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** « du 05/10 au 09/10/2026 » */
export const fmtPeriod = (start: string, end: string) =>
  `du ${start.slice(0, 4) === end.slice(0, 4) ? dayMonth(start) : `${dayMonth(start)}/${start.slice(0, 4)}`} au ${dayMonth(end)}/${end.slice(0, 4)}`;

/** Jours de validité d'un permis (heure de Paris) « AAAA-MM-JJ ». */
export const permitDays = (p: { validFrom: Date; validTo: Date }) => ({ from: toParisLocal(p.validFrom).slice(0, 10), to: toParisLocal(p.validTo).slice(0, 10) });

/** La période du plan couvre les jours `from` à `to`. */
export const planCovers = (plan: Pick<PlanLike, 'startOn' | 'endOn'>, from: string, to: string) => plan.startOn <= from && to <= plan.endOn;

/** Nature du défaut de plan d'un permis : aucun plan, plan clos ou annulé, période ne couvrant pas la validité, plan non signé. */
export type PermitPlanIssueKind = 'missing' | 'closed' | 'dates' | 'unsigned';

/**
 * Permis de feu d'une entreprise extérieure : travaux par points chauds, au nombre des travaux dangereux
 * (arrêté du 19 mars 1993, soudage avec permis de feu) ; le plan écrit est donc obligatoire (R. 4512-7).
 */
export const hotWorkByContractor = (permit: Pick<PermitPlanLike, 'type' | 'contractorId'>) => permit.type === 'feu' && !!permit.contractorId;

/** Plan écrit et signé exigé pour délivrer le permis : entreprise extérieure sur un site « dès la première minute », ou permis de feu d'une entreprise extérieure. */
export const permitNeedsSignedPlan = (permit: Pick<PermitPlanLike, 'type' | 'contractorId'>, rule: SiteRule | null | undefined) =>
  !!permit.contractorId && (firstMinuteRule(rule) || hotWorkByContractor(permit));

/**
 * Défaut du plan de prévention d'un permis (null s'il est en règle), selon la règle du site du permis :
 * - site « dès la première minute » : une entreprise extérieure doit avoir un plan rattaché, ni clos ni annulé, couvrant la validité et signé (EU et EE) ;
 * - sinon : le permis de feu d'une entreprise extérieure (travaux dangereux) exige de même un plan signé couvrant la validité ;
 *   pour les autres permis, un plan rattaché doit être non clos et couvrir la validité, et signé s'il est obligatoire (R. 4512-7).
 */
export function permitPlanCheck(permit: PermitPlanLike, plan: LinkedPlan | null | undefined, rule: SiteRule | null | undefined): { kind: PermitPlanIssueKind; message: string } | null {
  const required = permitNeedsSignedPlan(permit, rule);
  const hotWork = !firstMinuteRule(rule) && hotWorkByContractor(permit);
  if (!plan) {
    if (permit.preventionPlanId) return { kind: 'missing', message: `Le plan de prévention ${permit.preventionPlanId} est introuvable.` };
    if (!required) return null;
    return {
      kind: 'missing',
      message: hotWork
        ? "Aucun plan de prévention n'est rattaché au permis de feu de l'entreprise extérieure (travaux dangereux, arrêté du 19 mars 1993 : plan écrit obligatoire)."
        : "Aucun plan de prévention n'est rattaché à l'intervention de l'entreprise extérieure.",
    };
  }
  if (isPlanEnded(plan)) return { kind: 'closed', message: `Le plan de prévention ${plan.id} est ${plan.status === 'annule' ? 'annulé' : 'clos'}.` };
  const { from, to } = permitDays(permit);
  if (!planCovers(plan, from, to)) return { kind: 'dates', message: `Le plan de prévention ${plan.id} (${fmtPeriod(plan.startOn, plan.endOn)}) ne couvre pas la validité du permis.` };
  if ((required || isMandatory(plan, rule)) && !isFullySigned(plan)) {
    return {
      kind: 'unsigned',
      message: `Le plan de prévention ${plan.id} n'est pas signé par les deux entreprises${hotWork && !isMandatory(plan, rule) ? ' (permis de feu : travaux dangereux, plan écrit obligatoire)' : ''}.`,
    };
  }
  return null;
}

/** Message du défaut de plan d'un permis, null si le plan est en règle (voir permitPlanCheck). */
export const permitPlanIssue = (permit: PermitPlanLike, plan: LinkedPlan | null | undefined, rule: SiteRule | null | undefined) =>
  permitPlanCheck(permit, plan, rule)?.message ?? null;

type ActivePermitLike = PermitPlanLike & { status: string; watchUntil: Date | null };

/**
 * Écart « dès la première minute » : permis d'une entreprise extérieure sur un site soumis à la règle,
 * demandé (validité non échue) ou délivré (non clos, non expiré), sans plan signé couvrant sa validité.
 */
export function permitLacksSignedPlan(permit: ActivePermitLike, plan: LinkedPlan | null | undefined, rule: SiteRule | null | undefined, nowMs: number) {
  if (!firstMinuteRule(rule) || !permit.contractorId) return false;
  const state = permitState(permit, nowMs);
  if (state !== 'demande' && state !== 'delivre' && state !== 'en_cours') return false;
  return permitPlanIssue(permit, plan, rule) !== null;
}

// ─── Dates et heures (fuseau Europe/Paris) ──────────────────────────────────

const PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/** Instant → « AAAA-MM-JJTHH:mm » à l'heure de Paris (valeur d'un champ datetime-local). */
export function toParisLocal(d: Date): string {
  const p = Object.fromEntries(PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

const wallMs = (local: string) => {
  const m = LOCAL.exec(local);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
};

/** « AAAA-MM-JJTHH:mm » (heure de Paris) → instant ; null si la saisie est invalide. */
export function fromParisLocal(local: string): Date | null {
  const wall = wallMs(local);
  if (wall == null) return null;
  const offset = (d: Date) => wallMs(toParisLocal(d))! - Math.floor(d.getTime() / 60_000) * 60_000;
  let d = new Date(wall - offset(new Date(wall)));
  d = new Date(wall - offset(d));
  return d;
}

/** Ajoute des heures à une date-heure locale (calcul « horloge murale »). */
export function addHoursLocal(local: string, hours: number): string {
  const wall = wallMs(local);
  if (wall == null) return local;
  return new Date(wall + hours * 3_600_000).toISOString().slice(0, 16);
}

/** Instant de référence : date du jour Vigie (VIGIE_TODAY le cas échéant) à l'heure courante de Paris. */
export function referenceNow(todayIso: string): Date {
  return fromParisLocal(`${todayIso}T${toParisLocal(new Date()).slice(11)}`) ?? new Date();
}

/** 07/10 08:00 */
export const fmtLocalShort = (local: string) => `${local.slice(8, 10)}/${local.slice(5, 7)} ${local.slice(11, 16)}`;
/** 07/10/2026 à 08:00 */
export const fmtLocalLong = (local: string) => `${local.slice(8, 10)}/${local.slice(5, 7)}/${local.slice(0, 4)} à ${local.slice(11, 16)}`;

/** « 07/10 07:30 → 18:00 » ou « 06/10 08:00 → 09/10 18:00 ». */
export function fmtLocalRange(from: string, to: string) {
  return from.slice(0, 10) === to.slice(0, 10) ? `${fmtLocalShort(from)} → ${to.slice(11, 16)}` : `${fmtLocalShort(from)} → ${fmtLocalShort(to)}`;
}
