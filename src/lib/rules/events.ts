// Constantes et règles de l'écran « Signalements et événements », partagées par le serveur et les composants client.

import { QHSE_ONLY_CREATE_MESSAGE } from '@/lib/action-rules';
import {
  EVENT_STEPS, QUALIFICATION_FIELDS, QUALIFICATION_LABELS, STEP_ACTIONS, STEP_CLOSED, STEP_QUALIFIED, VICTIM_KINDS,
  type EventType, type QualificationField, type VictimKind,
} from '@/lib/domain';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Étape « Efficacité vérifiée » : toutes les actions liées doivent être Vérifiées (ou Abandonnées), jusqu'à la clôture
 * comprise (EVT-15) ; une action « Terminée — à vérifier » reste ouverte pour l'événement.
 */
export const STEP_EFFICACY = EVENT_STEPS.indexOf('Efficacité vérifiée');

/** Données de la fiche qui conditionnent le passage à l'étape suivante. */
export type AdvanceContext = {
  pilotId: string | null; hasAnalysis: boolean; dismissed: boolean; methodLabel: string;
  /** Données exigées à la qualification et non saisies (missingQualification, EVT-05). */
  missing: readonly QualificationField[];
  /**
   * Le rôle crée les actions QSE (canCreateAction, ACT-22) ; `false` : le message de l'étape « Actions » rappelle que les
   * actions sont créées par le service QHSE. Absent : message seul.
   */
  canCreateActions?: boolean;
  /**
   * Accident du travail (EVT-02) : `health` = rôle habilité aux données de santé (seul à clôturer un AT) ; `cpamPending` =
   * déclaration CPAM ni saisie ni motivée (cpamPending) ; `benign` = blessure « premiers soins » (registre des accidents bénins) ;
   * `duty` = qui déclare l'accident selon la victime (declarationDuty ; absent : l'entreprise).
   */
  accident?: { health: boolean; cpamPending: boolean; benign: boolean; duty?: DeclarationDuty };
};

/** Clôture d'un AT par un rôle non habilité : message sans aucune donnée de santé (ni blessure, ni état de la déclaration). */
export const AT_CLOSE_RESTRICTED = "Clôture d'un accident du travail : réservée à l'animateur QHSE et à la direction, qui contrôlent sa déclaration.";

/**
 * Pourquoi le passage à l'étape suivante est bloqué (null si possible) :
 * pilote désigné et données propres au type saisies pour « Qualifié », analyse saisie puis au moins une action pour
 * « Actions », actions vérifiées pour « Efficacité vérifiée » et la clôture ; un accident du travail n'est clôturé que par
 * un rôle habilité, une fois sa déclaration CPAM saisie, son inscription au registre des accidents bénins, ou un motif.
 */
export function advanceBlocker(step: number, allLinked: readonly { status: string }[], ctx: AdvanceContext): string | null {
  // Les actions abandonnées restent affichées sur la fiche mais ne comptent ni comme liées ni comme ouvertes.
  const linked = allLinked.filter((a) => a.status !== 'abandonnee');
  if (ctx.dismissed) return 'Événement classé sans suite.';
  if (step >= STEP_CLOSED) return 'Événement déjà clôturé.';
  const next = step + 1;
  if (next === STEP_QUALIFIED) {
    if (!ctx.pilotId) return `Désignez un pilote (Modifier) avant le passage à l'étape « ${EVENT_STEPS[STEP_QUALIFIED]} ».`;
    if (ctx.missing.length) {
      return `Complétez la fiche (Modifier) avant le passage à l'étape « ${EVENT_STEPS[STEP_QUALIFIED]} » : ${ctx.missing.map((k) => QUALIFICATION_LABELS[k]).join(', ')}.`;
    }
  }
  if (next === STEP_ACTIONS) {
    if (!ctx.hasAnalysis) return `Saisissez l'analyse des causes (méthode « ${ctx.methodLabel} ») avant le passage à l'étape « ${EVENT_STEPS[STEP_ACTIONS]} ».`;
    if (linked.length === 0) {
      const who = ctx.canCreateActions === false ? ` ${QHSE_ONLY_CREATE_MESSAGE}` : '';
      return `Liez au moins une action avant le passage à l'étape « ${EVENT_STEPS[STEP_ACTIONS]} ».${who}`;
    }
  }
  // Revérifié à la clôture : une action a pu être ajoutée ou rouverte après « Efficacité vérifiée ».
  if (next >= STEP_EFFICACY) {
    if (linked.length === 0) return `Aucune action liée : l'efficacité ne peut pas être vérifiée.`;
    // Close pour l'événement : « Vérifiée » seulement (Terminée attend encore sa vérification d'efficacité, EVT-15).
    const open = linked.filter((a) => a.status !== 'verifiee').length;
    if (open) {
      const s = open > 1;
      return `${open} action${s ? 's' : ''} liée${s ? 's' : ''} ${s ? 'ne sont pas encore vérifiées' : "n'est pas encore vérifiée"} : vérifiez-${s ? 'les' : 'la'} (ou abandonnez-${s ? 'les' : 'la'}) dans le plan d'actions avant le passage à l'étape « ${EVENT_STEPS[next]} ».`;
    }
  }
  // EVT-11 : l'analyse reste exigée à la clôture (fiche dont l'analyse a été vidée avant le contrôle de saveAnalysis,
  // ou reprise sans analyse), après les autres contrôles de l'étape.
  const noAnalysis = next === STEP_CLOSED && !ctx.hasAnalysis
    ? `Analyse des causes (méthode « ${ctx.methodLabel} ») vide : saisissez-la avant la clôture.` : null;
  if (next === STEP_CLOSED && ctx.accident) {
    if (!ctx.accident.health) return AT_CLOSE_RESTRICTED;
    if (ctx.accident.cpamPending) {
      if (ctx.accident.duty === 'ett') {
        return "Victime intérimaire : l'entreprise de travail temporaire déclare l'accident ; indiquez quand elle a été informée (motif) avant la clôture.";
      }
      if (ctx.accident.duty === 'employer') {
        return "Victime extérieure : son employeur déclare l'accident ; indiquez-le (motif) avant la clôture.";
      }
      return ctx.accident.benign
        ? "Accident bénin : inscrivez-le au registre des accidents bénins, ou indiquez pourquoi il n'est pas déclaré, avant la clôture."
        : "Saisissez la date de déclaration à la CPAM, ou indiquez pourquoi l'entreprise ne la déclare pas, avant la clôture.";
    }
  }
  return noAnalysis;
}

/**
 * EVT-11 : à partir de l'étape « Actions », l'analyse des causes de la méthode retenue ne se vide plus et la méthode ne
 * change que pour une méthode déjà renseignée (`filled` : l'analyse qui serait retenue après la modification est saisie).
 */
export function analysisChangeBlocker(step: number, filled: boolean, change: 'clear' | 'method'): string | null {
  if (step < STEP_ACTIONS || filled) return null;
  return change === 'clear'
    ? `Événement à l'étape « ${EVENT_STEPS[Math.min(step, STEP_CLOSED)]} » : l'analyse des causes ne peut plus être vidée (modifiez-la plutôt).`
    : `Événement à l'étape « ${EVENT_STEPS[Math.min(step, STEP_CLOSED)]} » : la méthode d'analyse ne change que pour une méthode déjà renseignée (saisissez d'abord son analyse, ou ramenez l'événement à l'étape « ${EVENT_STEPS[STEP_QUALIFIED]} »).`;
}

/** Pourquoi aucune action ne peut plus être ajoutée à l'événement (null si possible). */
export function addActionBlocker(step: number, dismissed = false): string | null {
  if (dismissed) return 'Événement classé sans suite : aucune action ne peut lui être ajoutée.';
  if (step < STEP_EFFICACY) return null;
  return `Événement à l'étape « ${EVENT_STEPS[Math.min(step, STEP_CLOSED)]} » : ramenez-le à l'étape « ${EVENT_STEPS[STEP_ACTIONS]} » (animateur QHSE ou direction) pour lui ajouter une action.`;
}

/** Pourquoi la fiche est en lecture seule (classée sans suite ou clôturée), null si modifiable. */
export function eventLockReason(e: { step: number; dismissedAt: Date | string | null }): string | null {
  if (e.dismissedAt) return 'Événement classé sans suite : annulez le classement (animateur QHSE ou direction) pour le modifier.';
  if (e.step >= STEP_CLOSED) return 'Événement clôturé : rouvrez-le (animateur QHSE ou direction) pour le modifier.';
  return null;
}

/**
 * Qui déclare un AT, selon la victime :
 * - `cpam` : salarié de l'effectif (ou victime non précisée) — l'entreprise déclare à la CPAM sous 48 h (R. 441-3 CSS), ou
 *   inscrit un accident bénin au registre ;
 * - `ett` : intérimaire — l'entreprise de travail temporaire, employeur, déclare ; l'entreprise utilisatrice l'informe sous
 *   24 h, copie à la CARSAT et à l'inspection du travail (R. 412-2 CSS) ; pas d'inscription au registre de l'entreprise ;
 * - `employer` : personne extérieure (entreprise extérieure, visiteur) — son employeur déclare ; aucune obligation CPAM
 *   pour le site.
 * Hors du cas `cpam`, la clôture reste subordonnée à un motif tracé (déclaration par l'ETT ou par un tiers, EVT-02).
 */
export type DeclarationDuty = 'cpam' | 'ett' | 'employer';
export const declarationDuty = (e: { victimKind: string | null }): DeclarationDuty =>
  e.victimKind === 'interimaire' ? 'ett' : e.victimKind === 'externe' ? 'employer' : 'cpam';

/**
 * Accident du travail que l'entreprise déclare elle-même à la CPAM (sous 48 h) : victime de l'effectif (declarationDuty),
 * blessure autre que les premiers soins (qui vont au registre des accidents bénins, ou sont déclarés au choix).
 */
export const needsCpam = (e: { type: string; injury: string | null; victimKind: string | null }) =>
  e.type === 'AT' && e.injury !== 'soins' && declarationDuty(e) === 'cpam';

/**
 * Obligation de déclaration d'un AT encore ouverte (EVT-02) : ni date de déclaration CPAM, ni absence de déclaration
 * motivée (déclaration par l'ETT ou par l'employeur d'une victime extérieure comprise), sauf accident bénin (premiers soins)
 * inscrit au registre.
 */
export function cpamPending(
  e: { type: string; injury: string | null; cpamDeclaredOn: string | null; cpamWaivedAt: Date | string | null },
  registered: boolean,
): boolean {
  if (e.type !== 'AT' || e.cpamDeclaredOn || e.cpamWaivedAt) return false;
  return e.injury !== 'soins' || !registered;
}

// ─── Qualification (EVT-05) ─────────────────────────────────────────────────

/** Lieu enregistré par un signalement terrain sans lieu saisi : compte comme non renseigné à la qualification. */
export const LOCATION_UNSPECIFIED = 'Lieu non précisé';

/** Champs de la fiche lus par les règles de qualification. */
export type QualifiableEvent = {
  type: string; location: string; severity: number | null; ncOrigin: string | null;
  victimKind: string | null; victimId: string | null; victimName: string | null; circumstances: string | null;
  customer: string | null; customerRef: string | null; keystoneProject: string | null; envAspect: string | null; envMedium: string | null;
};

const filled = (v: string | null | undefined) => !!v && v.trim() !== '';

/** Données exigées à la qualification (QUALIFICATION_FIELDS du type) qui manquent à la fiche. */
export function missingQualification(e: QualifiableEvent): QualificationField[] {
  const check: Record<QualificationField, () => boolean> = {
    victim: () => filled(e.victimKind) && (e.victimKind === 'salarie' ? filled(e.victimId) : filled(e.victimId) || filled(e.victimName)),
    circumstances: () => filled(e.circumstances),
    location: () => filled(e.location) && e.location.trim() !== LOCATION_UNSPECIFIED,
    severity: () => Number.isInteger(e.severity) && e.severity! >= 1 && e.severity! <= 4,
    ncOrigin: () => filled(e.ncOrigin),
    customer: () => filled(e.customer),
    customerRef: () => filled(e.customerRef) || filled(e.keystoneProject),
    envAspect: () => filled(e.envAspect),
    envMedium: () => filled(e.envMedium),
  };
  return (QUALIFICATION_FIELDS[e.type as EventType] ?? []).filter((k) => !check[k]());
}

/** Champ du formulaire qui reçoit l'erreur d'une donnée de qualification manquante. */
export function qualificationInput(field: QualificationField, e: Pick<QualifiableEvent, 'victimKind'>): string {
  if (field === 'victim') return !e.victimKind ? 'victimKind' : e.victimKind === 'salarie' ? 'victimId' : 'victimName';
  return field;
}

// ─── Accident du travail : déclaration (EVT-01, SEC-06) ─────────────────────

/** Intitulé neutre d'un AT signalé depuis le terrain : sans la description (qui peut décrire la lésion). */
export const neutralAccidentTitle = (location: string) => clip(`Accident · ${location}`, 90);

/**
 * Le texte semble décrire une lésion ou une donnée médicale (avertissement de saisie, non bloquant) : l'intitulé et la
 * description d'un AT sont visibles de l'encadrement et dans les échéances ; les lésions ont leurs champs réservés.
 */
export const mentionsInjury = (text: string) =>
  /\b(bless|fractur|entorse|foulure|luxation|plaie|coupure|brûl|contusion|hématome|lésion|traumat|commotion|hémorrag|saign|suture|urgences|hôpital|hospitalis|arrêt de travail|médecin|infirmi|douleur)/i.test(text);

/** Victime d'un AT, telle qu'affichée sur la fiche et au registre des accidents bénins. */
export function victimLabel(
  e: { victimKind: string | null; victimId: string | null; victimName: string | null; victimCompany: string | null },
  nameOf: (personId: string) => string,
): string {
  const name = e.victimId ? nameOf(e.victimId) : e.victimName || '—';
  if (e.victimKind === 'salarie') return e.victimId ? nameOf(e.victimId) : '—';
  if (e.victimKind === 'interimaire') return `${name} · intérimaire${e.victimCompany ? ` (${e.victimCompany})` : ''}`;
  if (e.victimKind === 'externe') return `${name}${e.victimCompany ? ` (${e.victimCompany})` : ''}`;
  return '—';
}
export const victimKindLabel = (k: string | null | undefined) => (k && k in VICTIM_KINDS ? VICTIM_KINDS[k as VictimKind] : '—');

// ─── Signalement terrain anonyme (SEC-09) ───────────────────────────────────

/** Canal d'un signalement terrain (events.reported_via) : un signalement anonyme ne dit pas par où il est arrivé. */
export const REPORTED_VIA = { session: 'session', post: 'poste', anonymous: 'terrain' } as const;
export type ReportedVia = (typeof REPORTED_VIA)[keyof typeof REPORTED_VIA];

// Photos d'un signalement anonyme : renommées « photo-<n>.<ext> » par anonymousPhoto (src/lib/report-guard.ts).

// ─── Registre des accidents bénins (EVT-04) ─────────────────────────────────

/** Titre de secourisme reconnu à son libellé, tant qu'aucun titre n'est coché « secourisme » (training_titles.first_aid). */
export const FIRST_AID_TITLE_FALLBACK = /\b(sst|sauveteurs?[\s-]+secouristes?)\b/i;
/** Registre imprimable d'un site : `${BENIGN_REGISTER_PATH}?site=<id>`. */
export const BENIGN_REGISTER_PATH = '/evenements/registre-benin';
/** Synthèse imprimable de la déclaration d'un AT et feuille d'accident (EVT-10) : `${DAT_PRINT_PATH}/<id>`. */
export const DAT_PRINT_PATH = '/evenements/imprimer';

/**
 * Pourquoi l'AT ne peut pas être inscrit au registre des accidents bénins (null si possible) : accident du travail sans
 * arrêt ni soins médicaux (premiers soins), non déclaré à la CPAM, d'une victime de l'effectif — l'accident d'un intérimaire
 * est déclaré par l'ETT (R. 412-2 CSS), celui d'une personne extérieure par son employeur ; mentions du registre saisies
 * sur la fiche (victime, lieu, circonstances, nature et siège des lésions — L. 441-4 et D. 441-1 et s. CSS).
 * Message réservé aux rôles habilités aux données de santé (il nomme les lésions).
 */
export function benignRegisterBlocker(
  e: QualifiableEvent & { injury: string | null; cpamDeclaredOn: string | null; lesionNature: string | null; lesionSite: string | null },
): string | null {
  if (e.type !== 'AT') return "Seul un accident du travail s'inscrit au registre des accidents bénins.";
  if (e.injury !== 'soins') return 'Seul un accident sans arrêt ni soins médicaux (premiers soins) s’inscrit au registre des accidents bénins.';
  if (e.cpamDeclaredOn) return 'Accident déjà déclaré à la CPAM : il ne s’inscrit pas au registre.';
  const duty = declarationDuty(e);
  if (duty === 'ett') return "Victime intérimaire : l'accident ne s'inscrit pas au registre de l'entreprise ; informez l'entreprise de travail temporaire, qui le déclare (R. 412-2 CSS).";
  if (duty === 'employer') return "Victime extérieure : l'accident relève du registre ou de la déclaration de son employeur.";
  const missing = [
    ...missingQualification(e).map((k) => QUALIFICATION_LABELS[k]),
    ...(filled(e.lesionNature) ? [] : ['nature des lésions']),
    ...(filled(e.lesionSite) ? [] : ['siège des lésions']),
  ];
  return missing.length ? `Complétez la fiche (Modifier) avant l'inscription au registre : ${missing.join(', ')}.` : null;
}

// ─── Fiche événement ────────────────────────────────────────────────────────

export const INJURIES: [key: string, label: string][] = [
  ['arret', 'Avec arrêt de travail'], ['sans_arret', 'Soins médicaux sans arrêt'], ['soins', 'Premiers soins · accident bénin'],
];
export const INJURY_KEYS = INJURIES.map(([k]) => k);
export const injuryLabel = (k: string | null | undefined) => INJURIES.find(([key]) => key === k)?.[1] ?? '—';

// ─── Données de santé d'un AT (SEC-06) ──────────────────────────────────────
// Visibles et modifiables par l'animateur QHSE et la direction seulement (canSeeHealth, src/lib/domain.ts) :
// retirées des chargements des autres rôles (absentes de la charge RSC), refusées par les server actions.
// Toute nouvelle donnée médicale d'un accident s'ajoute à cette liste. Victime, circonstances et témoins ne sont pas des
// données de santé (décision du lot 2) ; les pièces médicales (attachments.health) et le registre des accidents bénins le sont.

/** Colonnes de la table events qui portent une donnée de santé, avec leur libellé (formulaire, journal des modifications). */
export const HEALTH_LABELS = {
  injury: 'Blessure', lostDays: 'Jours perdus', cpamDeclaredOn: 'Déclaration CPAM',
  // Déclaration d'accident du travail (EVT-01) et déclaration non faite par l'entreprise (EVT-02).
  lesionNature: 'Nature des lésions', lesionSite: 'Siège des lésions', careGiven: 'Soins dispensés', reservesOn: 'Réserves motivées',
  cpamWaivedAt: 'Déclaration CPAM non faite (date)', cpamWaivedById: 'Déclaration CPAM non faite (par)', cpamWaiverReason: 'Motif sans déclaration CPAM',
  // Maladie professionnelle (EVT-09, R. 461-9 CSS) : l'événement MP entier est réservé (canSeeEventType) ; ses champs aussi.
  mpTable: 'Tableau de maladie professionnelle', mpDisease: 'Maladie déclarée', mpCertificateOn: 'Certificat médical initial',
  mpInformedOn: 'Déclaration reçue de la CPAM', mpQuestionnaireReceivedOn: 'Questionnaire employeur reçu', mpQuestionnaireReturnedOn: 'Questionnaire employeur retourné',
} as const;
export type HealthField = keyof typeof HEALTH_LABELS;
/** Toutes les colonnes de santé (withoutHealth). */
export const HEALTH_FIELDS = Object.keys(HEALTH_LABELS) as HealthField[];
/**
 * Données de santé saisies dans le formulaire de la fiche (readEventForm, submitsHealth, journal de saveEvent) ; l'absence
 * de déclaration motivée (cpamWaived*) a ses propres actions (waiveCpamDeclaration, cancelCpamWaiver).
 */
export const HEALTH_FORM_FIELDS = [
  'injury', 'lostDays', 'cpamDeclaredOn', 'lesionNature', 'lesionSite', 'careGiven', 'reservesOn',
  'mpTable', 'mpDisease', 'mpCertificateOn', 'mpInformedOn', 'mpQuestionnaireReceivedOn', 'mpQuestionnaireReturnedOn',
] as const satisfies readonly HealthField[];
/** Maladie professionnelle (EVT-09) : champs propres au type MP (données de santé). */
export const MP_FIELDS = ['mpTable', 'mpDisease', 'mpCertificateOn', 'mpInformedOn', 'mpQuestionnaireReceivedOn', 'mpQuestionnaireReturnedOn'] as const satisfies readonly HealthField[];
/** Intitulé imposé d'une maladie professionnelle : ni la victime, ni la maladie (visible dans les actions liées). */
export const MP_TITLE = 'Maladie professionnelle';
/** Refus d'une maladie professionnelle saisie par un rôle non habilité (EVT-09). */
export const MP_DENIED = "Les maladies professionnelles sont réservées à l'animateur QHSE et à la direction (données de santé).";
/** Libellé du journal : pièce médicale ajoutée, retirée ou reclassée (attachments.health). */
export const HEALTH_FILE_FIELD = 'Pièce médicale';
/** Libellé du journal : inscription au registre des accidents bénins (donnée de santé : nature de l'accident). */
export const BENIGN_REGISTER_FIELD = 'Registre des accidents bénins';
/** Libellés du journal des modifications retirés pour les rôles non habilités. */
export const HEALTH_LOG_FIELDS: readonly string[] = [...Object.values(HEALTH_LABELS), HEALTH_FILE_FIELD, BENIGN_REGISTER_FIELD];

/** Texte affiché à la place des données de santé pour les rôles non habilités. */
export const HEALTH_RESTRICTED = 'Données restreintes';
export const HEALTH_RESTRICTED_HINT = "Blessure, lésions, soins, déclaration CPAM et pièces médicales : réservés à l'animateur QHSE et à la direction.";
/** Refus d'une server action qui reçoit une donnée de santé d'un rôle non habilité. */
export const HEALTH_DENIED = "Les données de santé d'un accident du travail sont réservées à l'animateur QHSE et à la direction.";

/** Copie de la ligne sans ses données de santé (valeurs à null). */
export function withoutHealth<T extends Record<HealthField, unknown>>(row: T): T {
  const copy: Record<HealthField, unknown> = { ...row };
  for (const k of HEALTH_FIELDS) copy[k] = null;
  return copy as T;
}

/** Types d'événement qui portent une origine de non-conformité. */
export const hasNcOrigin = (type: string) => type === 'NC' || type === 'RC';
/** Types d'événement qui portent le traitement d'un produit non conforme (EVT-17) : NC et réclamation client. */
export const hasNcDisposition = (type: string) => hasNcOrigin(type);

// ─── Analyse des causes ─────────────────────────────────────────────────────

export const FIVE_M = ['Matière', 'Matériel', 'Méthode', "Main-d'œuvre", 'Milieu'] as const;
export const FIVE_M_HINTS = [
  'Matières, consommables, pièces, accessoires',
  'Machines, équipements, outillage',
  'Modes opératoires, consignes, organisation',
  'Compétences, formation, effectif',
  'Environnement, encombrement, éclairage, météo',
];

/** Arbre des causes : [niveau 0–3, libellé, fait principal]. */
export type TreeLine = [level: number, text: string, isMainFact: boolean];
export const MAX_TREE_LEVEL = 3;
export const MAX_TREE_LINES = 40;
export const MAX_WHYS = 7;
export type D8Content = { current: number; notes?: string[] };

/** Chaque ligne descend au plus d'un niveau sous la précédente ; la première est le fait ultime (niveau 0). */
export function normalizeTree<T extends { level: number }>(lines: T[]): T[] {
  let prev = -1;
  return lines.map((l) => {
    const level = Math.max(0, Math.min(l.level, prev + 1, MAX_TREE_LEVEL));
    prev = level;
    return level === l.level ? l : { ...l, level };
  });
}

/** Lecture tolérante du contenu stocké en base (jsonb). */
export function readFiveM(content: unknown): Map<string, string> {
  const rows = Array.isArray(content) ? content : [];
  return new Map(rows.filter((r): r is [string, string] => Array.isArray(r) && typeof r[0] === 'string' && typeof r[1] === 'string'));
}
export function readTree(content: unknown): TreeLine[] {
  const rows = Array.isArray(content) ? content : [];
  return rows
    .filter((r) => Array.isArray(r) && typeof r[1] === 'string')
    .map((r) => [Number(r[0]) || 0, r[1] as string, !!r[2]] as TreeLine);
}
export function readWhys(content: unknown): string[] {
  return Array.isArray(content) ? content.filter((s): s is string => typeof s === 'string') : [];
}
export function readD8(content: unknown): { current: number; notes: string[] } {
  const c = (content && typeof content === 'object' && !Array.isArray(content) ? content : {}) as Partial<D8Content>;
  const current = Number.isInteger(c.current) ? Math.max(0, Math.min(8, c.current as number)) : 0;
  const notes = Array.isArray(c.notes) ? c.notes.map((n) => (typeof n === 'string' ? n : '')) : [];
  return { current, notes };
}

/** Vrai si l'analyse de la méthode donnée contient au moins un élément saisi. */
export function analysisFilled(method: string, content: unknown): boolean {
  if (content == null) return false;
  if (method === '5m') return readFiveM(content).size > 0;
  if (method === 'tree') return readTree(content).length > 0;
  if (method === 'why') return readWhys(content).length > 0;
  const d8 = readD8(content);
  return d8.current > 0 || d8.notes.some(Boolean);
}

// ─── Pièces jointes et photos ───────────────────────────────────────────────

export const MAX_PHOTOS = 4;
// Constantes et vignettes communes à toutes les pièces jointes : src/lib/attachments.ts (réexportées ici).
export { MAX_BATCH_BYTES, MAX_FILE_BYTES, type AttachmentItem } from '@/lib/attachments';

// ─── Parcours terrain ───────────────────────────────────────────────────────

/** Formulaire sans compte (QR code de poste, EVT-07) : photos moins nombreuses et plus légères qu'avec une session. */
export const MAX_PUBLIC_PHOTOS = 2;
export const MAX_PUBLIC_PHOTO_BYTES = 5 * 1024 * 1024;
/** Nom du champ piège anti-robot du formulaire sans compte (masqué : une personne ne le remplit pas). */
export const REPORT_TRAP_FIELD = 'site_web';
/** Longueur maximale du nom et de l'entreprise déclarés sans compte. */
export const DECLARANT_MAX = 120;

/** Paramètres du QR code de poste (?jeton=, ancien ?poste=&site=, ou ?lieu= libre) conservés entre « Signaler » et « Mes signalements ». */
export function reportQuery(sp: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const k of ['jeton', 'poste', 'site', 'lieu']) {
    const v = sp[k];
    if (typeof v === 'string' && v) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
