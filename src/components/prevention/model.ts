// Règles métier des plans de prévention et des permis (partagées serveur / client, sans dépendance serveur).
// Code du travail R. 4512-6 à R. 4512-12 · arrêté du 19 mars 1993 (liste des travaux dangereux).
// Règle interne par site (établissement Seveso seuil haut) : plan écrit et signé dès la première minute d'intervention.

import { addMonths, toParisLocal } from '@/lib/dates';
import type { Tone } from '@/lib/domain';

export { addHoursLocal, fromParisLocal, referenceNow, toParisLocal } from '@/lib/dates';

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
  /** Première signature complète (EU et EE), conservée quand une modification efface les signatures (PRV-01). */
  firstSignedOn?: string | null;
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

/** Date de la signature complète actuelle (la plus tardive des signatures EU et EE), null si le plan n'est pas signé par les deux. */
export const fullSignatureOn = (p: Pick<PlanLike, 'signedEuOn' | 'signedEeOn'>) =>
  (p.signedEuOn && p.signedEeOn ? (p.signedEuOn > p.signedEeOn ? p.signedEuOn : p.signedEeOn) : null);

/** Première signature complète du plan : conservée quand une modification a effacé les signatures, sinon la signature actuelle. */
export const firstFullSignatureOn = (p: Pick<PlanLike, 'signedEuOn' | 'signedEeOn' | 'firstSignedOn'>) => p.firstSignedOn ?? fullSignatureOn(p);

/** Plan signé par les deux entreprises au plus tard le jour du début de l'intervention (même jour admis), d'après les dates déclarées. */
export const signedBeforeStart = (p: Pick<PlanLike, 'startOn' | 'signedEuOn' | 'signedEeOn' | 'firstSignedOn'>) => {
  const first = firstFullSignatureOn(p);
  return !!first && first <= p.startOn;
};

/** Écart R. 4512-6 au démarrage : plan signé après le début de l'intervention, ou intervention commencée (ou réalisée) sans plan signé. */
export type StartGapKind = 'signe_apres' | 'non_signe';
export const START_GAP_LABEL: Record<StartGapKind, string> = {
  signe_apres: "plan signé après le début de l'intervention",
  non_signe: 'intervention réalisée sans plan signé',
};

/**
 * Écart R. 4512-6 (ou règle du site) constaté au démarrage d'une intervention commencée, null sinon : plan obligatoire
 * dont la première signature complète est postérieure au début ('signe_apres'), ou jamais signé par les deux entreprises
 * ('non_signe'). Les plans annulés n'en comptent pas (le motif dit si l'intervention a eu lieu ; une annulation après le
 * démarrage exige déjà l'action qui trace l'écart). En cours, l'écart 'non_signe' est l'écart courant (lacksSignedPlan).
 */
export function startGap(p: PlanLike, now: string, rule: SiteRule | null | undefined): StartGapKind | null {
  if (p.status === 'annule' || !isMandatory(p, rule) || p.startOn > now || signedBeforeStart(p)) return null;
  return firstFullSignatureOn(p) ? 'signe_apres' : 'non_signe';
}

/** Fenêtre des écarts passés comptés dans les indicateurs : interventions commencées dans les 12 derniers mois. */
export const GAP_WINDOW_MONTHS = 12;
export const inGapWindow = (p: Pick<PlanLike, 'startOn'>, now: string) => p.startOn > addMonths(now, -GAP_WINDOW_MONTHS) && p.startOn <= now;

/**
 * Motif empêchant de clore ou d'annuler un plan (même règle à l'écran et côté serveur), null sinon :
 * jamais pendant une intervention sans le plan obligatoire signé ; jamais avec des permis rattachés encore actifs.
 * Une intervention réalisée sans plan signé, ou avec un plan signé après son début, n'exige plus d'action du plan
 * d'actions QSE avant la clôture (réponses du service QHSE du 15/10/2026 : les plans de prévention donnent lieu à des
 * actions immédiates, non enregistrées dans les actions QSE) ; l'écart R. 4512-6 reste tracé par les indicateurs
 * (startGap, fenêtre GAP_WINDOW_MONTHS) et le journal du plan.
 */
export function planEndIssue(
  p: PlanLike,
  { mandatory, now, openPermitIds, verb }: { mandatory: boolean; now: string; openPermitIds: string[]; verb: 'clore' | 'annuler' },
): string | null {
  const unsigned = mandatory && !isFullySigned(p);
  const what = verb === 'clore' ? 'de clore le plan' : "d'annuler le plan";
  if (unsigned && p.startOn <= now && p.endOn >= now) return `Intervention en cours avec un plan obligatoire non signé : enregistrez les signatures des deux entreprises avant ${what}.`;
  if (openPermitIds.length) return `Permis rattachés encore actifs (${openPermitIds.join(', ')}) : clôturez-les ou annulez-les avant ${what}.`;
  return null;
}

// ─── Contenu réglementaire du plan (PRV-02) ─────────────────────────────────

export type PlanContentGroup = 'ee' | 'measures' | 'sir';
export const PLAN_CONTENT_GROUPS: Record<PlanContentGroup, { label: string; ref: string }> = {
  ee: { label: "Informations de l'entreprise extérieure", ref: 'R. 4511-10' },
  measures: { label: 'Mesures du plan', ref: 'R. 4512-8' },
  sir: { label: 'Suivi individuel renforcé', ref: 'R. 4512-9' },
};

/** Effectif prévisible de l'entreprise extérieure (colonne ee_headcount, entier ou non renseigné). */
export const EE_HEADCOUNT = { label: 'Effectif prévisible', ref: 'R. 4511-10' } as const;
export const EE_HEADCOUNT_MAX = 10_000;

export type PlanContentKey =
  | 'eeSupervisor' | 'subcontracting' | 'dangerousPhases' | 'equipment' | 'workerInstructions' | 'emergencyOrganisation' | 'coordination' | 'sirPosts';

export type PlanContentField = {
  key: PlanContentKey;
  group: PlanContentGroup;
  label: string;
  /** Libellé court des messages (« premiers secours et évacuation »). */
  short: string;
  ref: string;
  hint: string;
  placeholder: string;
  max: number;
  /** Section exigée pour signer un plan obligatoire (« Aucun » ou « Sans objet » quand elle ne s'applique pas). */
  requiredToSign: boolean;
};

/** Sections du contenu réglementaire, dans l'ordre du formulaire et du document imprimable. */
export const PLAN_CONTENT: PlanContentField[] = [
  {
    key: 'eeSupervisor', group: 'ee', label: "Responsable de l'intervention (nom et qualification)", short: "responsable de l'intervention", ref: 'R. 4511-10',
    hint: "Personne chargée de diriger l'intervention pour l'entreprise extérieure.", placeholder: "Ex. [M. Lebrun], chef d'équipe maintenance levage",
    max: 200, requiredToSign: false,
  },
  {
    key: 'subcontracting', group: 'ee', label: 'Sous-traitants et travaux sous-traités (« Aucun » sinon)', short: 'sous-traitance', ref: 'R. 4511-10',
    hint: 'Noms et références des sous-traitants, identification des travaux sous-traités.', placeholder: 'Ex. Aucun sous-traitant',
    max: 2000, requiredToSign: false,
  },
  {
    key: 'dangerousPhases', group: 'measures', label: "Phases d'activité dangereuses et moyens de prévention spécifiques", short: 'phases dangereuses', ref: 'R. 4512-8, 1°',
    hint: "Phases dangereuses de l'intervention et moyens de prévention correspondants.",
    placeholder: 'Ex. Travail en nacelle sur le chemin de roulement : harnais, zone balisée au sol', max: 4000, requiredToSign: true,
  },
  {
    key: 'equipment', group: 'measures', label: 'Matériels, installations et dispositifs : adaptation, prêt, entretien', short: 'matériels et installations', ref: 'R. 4512-8, 2°',
    hint: "Adaptation aux opérations, matériel prêté par l'entreprise utilisatrice, conditions d'entretien.",
    placeholder: "Ex. Nacelle de l'entreprise extérieure (VGP à jour) ; pont 5 t prêté par l'atelier", max: 4000, requiredToSign: true,
  },
  {
    key: 'workerInstructions', group: 'measures', label: 'Instructions données aux travailleurs', short: 'instructions aux travailleurs', ref: 'R. 4512-8, 3°',
    hint: 'Accueil sécurité, consignes du site, consignations, EPI.',
    placeholder: 'Ex. Accueil sécurité du site ; pont consigné par le chargé de consignation', max: 4000, requiredToSign: true,
  },
  {
    key: 'emergencyOrganisation', group: 'measures', label: "Premiers secours et évacuation (dispositif de l'EU)", short: 'premiers secours et évacuation', ref: 'R. 4512-8, 4°',
    hint: "Organisation des premiers secours en cas d'urgence et dispositif mis en place par l'entreprise utilisatrice (alarme, évacuation, SST).",
    placeholder: "Ex. SST de l'atelier, point de rassemblement parking nord ; secours 18/112", max: 4000, requiredToSign: true,
  },
  {
    key: 'coordination', group: 'measures', label: 'Coordination et organisation du commandement', short: 'coordination et commandement', ref: 'R. 4512-8, 5°',
    hint: "Participation des travailleurs d'une entreprise aux travaux de l'autre, coordination, organisation du commandement.",
    placeholder: "Ex. Point quotidien 7 h 30 avec le chef d'atelier", max: 4000, requiredToSign: true,
  },
  {
    key: 'sirPosts', group: 'sir',
    label: 'Postes susceptibles de relever du suivi individuel renforcé (postes, aucune donnée nominative ou médicale ; « Aucun » sinon)',
    short: 'suivi individuel renforcé', ref: 'R. 4512-9',
    hint: 'Intitulés des postes seulement : jamais de nom ni de donnée médicale.', placeholder: 'Ex. Aucun poste', max: 4000, requiredToSign: true,
  },
];

export const PLAN_CONTENT_KEYS = PLAN_CONTENT.map((c) => c.key);

/** Contenu réglementaire d'un plan (colonnes de prevention_plans). */
export type PlanContent = Record<PlanContentKey, string> & { eeHeadcount: number | null };

/** Sections exigées pour signer qui restent vides (libellés courts). */
export const missingPlanContent = (p: Pick<PlanContent, PlanContentKey>) =>
  PLAN_CONTENT.filter((c) => c.requiredToSign && !(p[c.key] ?? '').trim()).map((c) => c.short);

/** Sections renseignées : les 8 sections de texte et l'effectif prévisible. */
export function planContentStats(p: PlanContent) {
  const filled = PLAN_CONTENT.filter((c) => (p[c.key] ?? '').trim()).length + (p.eeHeadcount != null ? 1 : 0);
  return { filled, total: PLAN_CONTENT.length + 1 };
}

/**
 * Motif empêchant de signer le plan (signature EU) ou d'enregistrer la signature de l'entreprise extérieure, null sinon
 * (même règle à l'écran et côté serveur) : inspection commune préalable réalisée, mesures de prévention renseignées et,
 * pour un plan obligatoire, contenu R. 4512-8 et R. 4512-9 complet.
 */
export function planSignIssue(
  p: Pick<PlanLike, 'inspectionOn'> & { measures: string } & Pick<PlanContent, PlanContentKey>,
  { now, mandatory, verb }: { now: string; mandatory: boolean; verb: 'signer' | 'recueillir' },
): string | null {
  const before = verb === 'signer' ? 'avant de signer le plan' : 'avant de recueillir les signatures';
  if (!inspectionDone(p, now)) return `Réalisez l'inspection commune préalable ${before}.`;
  if (!p.measures.trim()) return `Complétez les mesures de prévention ${before}.`;
  const missing = mandatory ? missingPlanContent(p) : [];
  if (missing.length) return `Complétez le contenu du plan (R. 4512-8 et R. 4512-9) ${before} : ${missing.join(', ')}.`;
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
/** Résumé du journal à la délivrance (deliverPermit) : date de délivrance de la fiche imprimable. */
export const PERMIT_DELIVERED = 'Permis délivré';

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

// toParisLocal, fromParisLocal, addHoursLocal, referenceNow : src/lib/dates.ts (partagés avec les événements, EVT-03/04).

/** 07/10 08:00 */
export const fmtLocalShort = (local: string) => `${local.slice(8, 10)}/${local.slice(5, 7)} ${local.slice(11, 16)}`;
/** 07/10/2026 à 08:00 */
export const fmtLocalLong = (local: string) => `${local.slice(8, 10)}/${local.slice(5, 7)}/${local.slice(0, 4)} à ${local.slice(11, 16)}`;

/** « 07/10 07:30 → 18:00 » ou « 06/10 08:00 → 09/10 18:00 ». */
export function fmtLocalRange(from: string, to: string) {
  return from.slice(0, 10) === to.slice(0, 10) ? `${fmtLocalShort(from)} → ${to.slice(11, 16)}` : `${fmtLocalShort(from)} → ${fmtLocalShort(to)}`;
}
