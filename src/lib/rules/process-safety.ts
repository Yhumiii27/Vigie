// Études de sécurité des procédés (VG-01 à VG-05, demande d'Arche du 01/11/2026 ; CNF-12 à CNF-14, INT-18) — règles pures,
// sans accès serveur (composants client, chargements, server actions, tests). Méthode DIG-PRODI v4.0 du groupe : une étude
// par jalon de sécurité d'un CAPEX de filiale (code « CPX-… » d'Arche) ou d'un projet EPC2i (code Keystone) — HazID (HS 2),
// HazOp ou AMDEC (HS 3), contrôle chantier (HS 4), PSSR avec la RSPDI (PSSR), audit ASPD (HS 6). Ses recommandations sont des
// actions QSE rattachées à l'étude (actions.safety_study_id, réserve bloquante : actions.safety_study_blocking). Statut
// « annulée », décomptes, retard et franchissement du jalon : calculés, jamais stockés.
import { isLate } from '../action-rules';
import { isClosedActionStatus, type Tone } from '../domain';
import {
  STUDY_CONCLUSION_CODES, STUDY_MILESTONE_CODES, STUDY_STATUS_CODES, STUDY_TYPE_CODES,
} from '../state-keys';

export type StudyMilestone = (typeof STUDY_MILESTONE_CODES)[number];
export type StudyType = (typeof STUDY_TYPE_CODES)[number];
/** Statut stocké (process_safety_studies.status) ; « annulee » est calculé (triplet cancelled_*). */
export type StoredStudyStatus = (typeof STUDY_STATUS_CODES)[number];
export type StudyStatus = StoredStudyStatus | 'annulee';
export type StudyConclusion = (typeof STUDY_CONCLUSION_CODES)[number];

/** Jalons de sécurité de la méthode DIG-PRODI (ordre du cycle). */
export const STUDY_MILESTONES: Record<StudyMilestone, { label: string; hint: string }> = {
  HS2: { label: 'HS 2', hint: 'Identification des dangers (HazID), avant G1' },
  HS3: { label: 'HS 3', hint: 'Analyse détaillée (HazOp ou AMDEC), avant G2' },
  HS4: { label: 'HS 4', hint: 'Contrôle chantier, avant K3' },
  PSSR: { label: 'PSSR', hint: 'Revue de sécurité avant démarrage (PSSR, RSPDI), avant G3' },
  HS6: { label: 'HS 6', hint: 'Audit ASPD après démarrage' },
};
export const STUDY_MILESTONE_KEYS = Object.keys(STUDY_MILESTONES) as StudyMilestone[];

/** Types d'étude et jalon qu'ils servent (un type → un jalon). */
export const STUDY_TYPES: Record<StudyType, { label: string; milestone: StudyMilestone }> = {
  hazid: { label: 'HazID', milestone: 'HS2' },
  hazop: { label: 'HazOp', milestone: 'HS3' },
  amdec: { label: 'AMDEC', milestone: 'HS3' },
  controle_chantier: { label: 'Contrôle chantier', milestone: 'HS4' },
  pssr: { label: 'PSSR', milestone: 'PSSR' },
  rspdi: { label: 'RSPDI', milestone: 'PSSR' },
  aspd: { label: 'Audit ASPD', milestone: 'HS6' },
};
export const STUDY_TYPE_KEYS = Object.keys(STUDY_TYPES) as StudyType[];

/** Types admis pour un jalon. */
export const typesOfMilestone = (m: StudyMilestone): StudyType[] => STUDY_TYPE_KEYS.filter((k) => STUDY_TYPES[k].milestone === m);

export const STUDY_STATUS: Record<StudyStatus, { label: string; tone: Tone }> = {
  planifiee: { label: 'Planifiée', tone: 'neutral' },
  realisee: { label: 'Réalisée', tone: 'accent' },
  validee: { label: 'Validée', tone: 'ok' },
  annulee: { label: 'Annulée', tone: 'neutral' },
};
/** Statuts stockés, dans l'ordre du cycle (annulation : triplet cancelled_*). */
export const STORED_STUDY_STATUS_KEYS: StoredStudyStatus[] = ['planifiee', 'realisee', 'validee'];

export const STUDY_CONCLUSIONS: Record<StudyConclusion, { label: string; tone: Tone }> = {
  favorable: { label: 'Favorable', tone: 'ok' },
  reserves: { label: 'Favorable avec réserves', tone: 'warn' },
  defavorable: { label: 'Défavorable', tone: 'danger' },
};
export const STUDY_CONCLUSION_KEYS = Object.keys(STUDY_CONCLUSIONS) as StudyConclusion[];

/** Code CAPEX d'Arche (« CPX-APM-2026-01 ») : « CPX- » puis majuscules, chiffres et tirets. */
export const CAPEX_CODE = /^CPX-[A-Z0-9][A-Z0-9-]{0,39}$/;
/** Code projet Keystone (keystone.pub_projets.code, saisi : pas de lecture d'un autre outil) : comme une référence courte. */
export const PROJECT_CODE = /^[A-Z0-9][A-Z0-9._/-]{1,39}$/;
/** Référence Codex du rapport (texte libre, longueur bornée). */
export const REPORT_REF_MAX = 120;
/** Animateur extérieur (bureau d'études, prestataire) : nom et organisme. */
export const FACILITATOR_EXTERNAL_MAX = 160;

/** Message d'erreur d'un code CAPEX saisi (vide admis), ou null. */
export function capexCodeError(code: string | null | undefined): string | null {
  if (!code) return null;
  return CAPEX_CODE.test(code) ? null : 'Code CAPEX attendu au format « CPX-APM-2026-01 » (majuscules, chiffres et tirets).';
}
/** Message d'erreur d'un code projet Keystone saisi (vide admis), ou null. */
export function projectCodeError(code: string | null | undefined): string | null {
  if (!code) return null;
  return PROJECT_CODE.test(code) ? null : 'Code projet attendu en majuscules, chiffres, points, tirets ou barres (2 à 40 caractères).';
}
/** Une étude porte au moins un rattachement : un CAPEX ou un projet EPC2i. */
export const LINK_REQUIRED = 'Indiquez le code CAPEX ou le code du projet EPC2i (au moins un).';

/** Type incompatible avec le jalon (HazID → HS 2 ; HazOp, AMDEC → HS 3 ; contrôle chantier → HS 4 ; PSSR, RSPDI → PSSR ; ASPD → HS 6). */
export function studyTypeError(milestone: StudyMilestone, type: StudyType): string | null {
  return STUDY_TYPES[type].milestone === milestone ? null
    : `Une étude ${STUDY_TYPES[type].label} relève du jalon ${STUDY_MILESTONES[STUDY_TYPES[type].milestone].label}.`;
}

/** Valeurs d'une étude contrôlées par studyFieldErrors. */
export type StudyDates = {
  status: StoredStudyStatus; sessionOn: string | null; validatedOn: string | null; conclusion: StudyConclusion | null;
};

/**
 * Cohérence du statut, des dates et de la conclusion (champ → message) :
 * - séance : obligatoire ; une étude réalisée ou validée a eu lieu (séance au plus aujourd'hui) ;
 * - validation : date et conclusion obligatoires pour une étude validée, absentes sinon ; validée au plus aujourd'hui et pas
 *   avant la séance.
 * Appliquée aux seules valeurs modifiées (`changed`, AUD-31) pour les bornes de dates ; la présence des champs exigés par
 * le statut est toujours contrôlée.
 */
export function studyFieldErrors(v: StudyDates, today: string, changed: Partial<Record<keyof StudyDates, boolean>> = { sessionOn: true, validatedOn: true }): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v.sessionOn) out.sessionOn = 'Indiquez la date de séance (prévue ou tenue).';
  else if (v.status !== 'planifiee' && v.sessionOn > today && changed.sessionOn) out.sessionOn = 'Séance à venir : l’étude reste planifiée.';
  if (v.status === 'validee') {
    if (!v.validatedOn) out.validatedOn = 'Indiquez la date de validation.';
    else if (changed.validatedOn && v.validatedOn > today) out.validatedOn = 'Date postérieure à aujourd’hui.';
    else if (changed.validatedOn && v.sessionOn && v.validatedOn < v.sessionOn) out.validatedOn = 'Validation antérieure à la séance.';
    if (!v.conclusion) out.conclusion = 'Choisissez la conclusion de l’étude.';
  } else {
    if (v.validatedOn) out.validatedOn = 'Date de validation réservée à une étude validée.';
    if (v.conclusion) out.conclusion = 'Conclusion réservée à une étude validée.';
  }
  return out;
}

/** Statut affiché d'une étude : « annulee » pour une étude annulée (triplet cancelled_*), sinon le statut stocké. */
export const studyStatus = (s: { status: StoredStudyStatus; cancelled: boolean }): StudyStatus => (s.cancelled ? 'annulee' : s.status);

/** Recommandation d'une étude (action QSE rattachée) lue pour les décomptes. */
export type Recommendation = { status: string; dueOn: string; blocking: boolean };
export type RecommendationCounts = { total: number; open: number; late: number; blocking: number };

/**
 * Décomptes des recommandations (contrat `pub_etudes_securite` : recommandations, recommandations_ouvertes,
 * recommandations_en_retard, reserves_bloquantes) : ouverte = ni Vérifiée ni Abandonnée (isClosedActionStatus) ; en retard
 * = règle isLate du plan (avancement ouvert, date cible passée) ; réserve bloquante = marquée bloquante et ouverte (une
 * réserve bloquante abandonnée compte comme levée).
 */
export function recommendationCounts(rows: readonly Recommendation[], today: string): RecommendationCounts {
  return {
    total: rows.length,
    open: rows.filter((r) => !isClosedActionStatus(r.status)).length,
    late: rows.filter((r) => isLate(r, today)).length,
    blocking: rows.filter((r) => r.blocking && !isClosedActionStatus(r.status)).length,
  };
}

/**
 * Règle d'Arche (contrat § 2.5) : l'étude fait franchir son jalon quand elle est validée, sans conclusion défavorable ni
 * réserve bloquante ouverte ; une étude annulée ne compte pas.
 */
export const studyClearsMilestone = (s: { status: StudyStatus; conclusion: StudyConclusion | null }, blocking: number) =>
  s.status === 'validee' && s.conclusion !== 'defavorable' && blocking === 0;

/** Lien profond d'une étude (VG-04) : vue « Études de sécurité des procédés » de l'écran « Évaluation des risques ». */
export const studyHref = (ref: string) => `/risques?vue=etudes&etude=${encodeURIComponent(ref)}`;
/** Préfixe des références (nextEntityReference, 3 chiffres : « ES-001 »). */
export const STUDY_REF_PREFIX = 'ES-';
export const STUDY_REF = /^ES-\d{3,}$/;

/** Libellé court d'une étude : « HazOp · CPX-APM-2026-01 » (CAPEX, sinon projet). */
export const studyLabel = (s: { type: StudyType; capexCode: string | null; projectCode: string | null }) =>
  `${STUDY_TYPES[s.type].label} · ${s.capexCode ?? s.projectCode ?? '—'}`;

// ─── Sites (VG-05) ──────────────────────────────────────────────────────────

/**
 * Code commun du site (matrix.sites.code, décision D14 de Matrix) : minuscules, chiffres et soulignés, une lettre en
 * premier, 2 à 32 caractères, jamais « all » (contrainte sites_code_check de Matrix, reprise par sites.code).
 */
export const SITE_CODE = /^[a-z][a-z0-9_]{1,31}$/;
export function siteCodeError(code: string | null | undefined): string | null {
  if (!code) return null;
  if (code === 'all') return '« all » est réservé à « Tous les sites ».';
  return SITE_CODE.test(code) ? null : 'Code attendu en minuscules, chiffres et soulignés, une lettre en premier (2 à 32 caractères), comme dans Matrix.';
}
