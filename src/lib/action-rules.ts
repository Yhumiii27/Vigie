// Règles pures du plan d'actions (docs/specs/actions-qse.md § 4–16), partagées par le serveur, les chargements et les
// composants client. Aucune dépendance serveur : imports limités à domain, action-keys et dates.
//
// Contrat du paquet 1 (figé pour les flux parallèles, plan § 2.2) :
//   - libellé court actionLabel(detail), numéros formatActionNumber / parseActionNumber (« A-n », ACT-35), lien de la
//     fiche actionHref(id), libellés « à compléter » (SOURCE_TO_COMPLETE, SITE_TO_COMPLETE_LABEL) ; longueur de la référence
//     d'origine : ORIGIN_REF_MAX (src/lib/action-keys.ts, réexporté par domain) ;
//   - retard : isLate / lateDays (ouvertes seulement, date cible passée), vérification : isVerificationLate /
//     isVerificationDueSoon (Terminée) ; l'autovérification est admise sans restriction ni marque (ACT-13, 15/10/2026) ;
//   - Kanban en six colonnes (kanbanColumn, Abandonnée hors Kanban), affichage ?etat= (inPlanScope), vues ?vue= ;
//   - transitions (transitionKind : matrice du § 6.2, faites par le QHSE seulement), résumés du journal, choix proposés ;
//   - « à compléter » calculé, jamais stocké (missingFields, D8) ; source verrouillée une fois posée (sourceEditable) ;
//   - dates (actionDateOrderErrors, actionDateErrors : règles des seuls champs saisis ou modifiés, D24 ; textTooLong) ;
//   - droits (D19, ACT-22 tranché le 15/10/2026) : canCreateAction(role) (service QHSE seulement, depuis le plan comme
//     depuis un écran source), canReadPlan, canReadAction, actionRights (dont canLink / canUnlink : liens complémentaires,
//     QHSE seulement), canRemoveProof, canWithdrawComment ;
//   - source imposée par l'élément lié (admissibleSources(kind | null, facts) : liste, jamais null ; [] = élément qui ne
//     permet pas de créer une action ; null = sans élément, les 24 sources ; cohérente avec SOURCE_LINK_KINDS, testé) ;
//     éléments qui ne donnent pas lieu à une action QSE (NON_QSE_LINK_KINDS : habilitations, plans de prévention,
//     permis — refusés à la création et au rattachement, jamais déplacés ni copiés vers une action de suite :
//     followUpLinkMode, D21) ;
//   - filtres de la vue générale portés par l'URL (parseActionFilters, actionFiltersParams, matchesActionFilters) et tri
//     par défaut (compareActions).
// Reste du contrat de la fondation (serveur) :
//   - src/lib/queries.ts : ActionRow / ActionInsert, loadActions (hors Abandonnées), actionView (label, avancement,
//     statusLabel / tone « En retard », group, kanban, late, lateDays, verifyLate, closed, sourceDef, missing…),
//     actionBrief (clés inchangées : title = libellé) ; plus d'actionColumn ;
//   - src/server/action-core.ts (dans la transaction de l'appelant, byId explicite) : nextActionNumber, writeAvancement
//     (transition obligatoire, garde d'avancement → StaleActionError, journal « status » structuré D11), insertComment ;
//   - src/server/notify.ts : notify (commentId facultatif), qhseAnimatorIds (ACT-31), actionConfieeTitle, actionCommentTitle,
//     actionProofTitle, actionCommentWithdrawnTitle, withdrawCommentNotifications (retrait d'un commentaire, D23) ;
//   - src/server/action-core.ts : insertComment n'écrit au journal que « Commentaire ajouté », sans extrait (D23 ; écart
//     au plan § 2.10) ; nextActionNumber toujours au-delà du plus grand numéro vu ;
//   - src/lib/uploads.ts : saveUpload(…, { health, db, commentId }), canReadAttachment (responsable : tous sites, D19 ;
//     preuve d'un commentaire retiré : QHSE seulement, D23) ; src/lib/data/options.ts : loadFormOptions().actions ;
//   - jeu de démonstration : src/db/seeds/actions.ts (DEMO_ACTIONS, RETIRED_DEMO_ACTIONS, seedActions, upgradeDemoActions).

import type { ActionPriority, Avancement, SourceKey } from './action-keys';
import { addDays, daysBetween, fmtDate } from './dates';
import {
  ACTION_AVANCEMENTS, ACTION_TEXT_MAX, AVANCEMENT, PRIORITY_KEYS, SOURCE_KEYS, TODO_HORIZON_DAYS, canApprove, canSee, isAvancement, isClosedActionStatus,
  isEmployee, isOpenAvancement, type Role, type Tone,
} from './domain';

// ─── Libellé, numéro ────────────────────────────────────────────────────────

export const ACTION_LABEL_MAX = 90;
/** Libellé court (§ 4) : première ligne non vide du détail, espaces réduits, 90 caractères au plus (89 + « … »). */
export function actionLabel(detail: string | null | undefined): string {
  const line = (detail ?? '').split(/\r\n|\r|\n/).map((l) => l.replace(/\s+/g, ' ').trim()).find(Boolean);
  if (!line) return 'Action sans détail';
  return line.length > ACTION_LABEL_MAX ? `${line.slice(0, ACTION_LABEL_MAX - 1).trimEnd()}…` : line;
}
/** Numéro affiché d'une action (ACT-35) ; ACT-36 changera ce format (AC-AA####). */
export const formatActionNumber = (n: number) => `A-${n}`;
/** Numéro d'un identifiant « A-n » ; null pour tout autre format (même borne de 9 chiffres que la reprise 0005, R8). */
export const parseActionNumber = (id: string): number | null => {
  const m = /^A-(\d{1,9})$/.exec(id);
  return m ? Number(m[1]) : null;
};
/** Lien vers la fiche d'une action (plan d'actions, ?action=) : notifications, échéances, écrans sources. */
export const actionHref = (id: string) => `/actions?action=${encodeURIComponent(id)}`;
/** Source vide (« à compléter » : reprise) : libellé et icône des listes, de la fiche et des filtres. */
export const SOURCE_TO_COMPLETE = { label: 'À compléter', icon: 'ph-question' } as const;
/** Site vide (reprise d'une action « Tous les sites ») : libellé des listes et de la fiche. */
export const SITE_TO_COMPLETE_LABEL = 'Site à compléter';
/** Problème pré-rempli d'une action de suite non efficace (§ 7). */
export const followUpProblem = (id: string, closedOn: string, note: string) => `Action ${id} jugée non efficace le ${fmtDate(closedOn)} : ${note}`.slice(0, ACTION_TEXT_MAX);

// ─── Retards et vérifications (§ 6.3) ───────────────────────────────────────
// Règle unique pour la vue générale, les échéances, le tableau de bord, le rappel du mercredi et les autres écrans.

/** En retard : avancement ouvert (À faire → 80 %) et date cible passée (date du jour de Paris). */
export const isLate = (a: { status: string; dueOn: string }, today: string) => isOpenAvancement(a.status) && a.dueOn < today;
/** Jours de retard, comptés depuis la date cible actuelle (0 si l'action n'est pas en retard). */
export const lateDays = (a: { status: string; dueOn: string }, today: string) => (isLate(a, today) ? daysBetween(a.dueOn, today) : 0);
/** Vérification en retard : action Terminée dont la vérification planifiée est passée (échéance du QHSE). */
export const isVerificationLate = (a: { status: string; verifyDueOn: string | null }, today: string) =>
  a.status === 'terminee' && !!a.verifyDueOn && a.verifyDueOn < today;
/** Vérification à venir : action Terminée, vérification planifiée dans les `days` jours (aujourd'hui compris). */
export const isVerificationDueSoon = (a: { status: string; verifyDueOn: string | null }, today: string, days = TODO_HORIZON_DAYS) =>
  a.status === 'terminee' && !!a.verifyDueOn && a.verifyDueOn >= today && a.verifyDueOn <= addDays(today, days);

// ─── Kanban (§ 16) ──────────────────────────────────────────────────────────

/** Six colonnes ; Abandonnée hors Kanban. */
export type KanbanKey = 'a_faire' | 'en_cours' | 'en_retard' | 'reportee' | 'terminee' | 'verifiee';
export const KANBAN_COLUMNS: { key: KanbanKey; label: string; tone: Tone }[] = [
  { key: 'a_faire', label: 'À faire', tone: 'neutral' },
  { key: 'en_cours', label: 'En cours', tone: 'accent' },
  { key: 'en_retard', label: 'En retard', tone: 'danger' },
  { key: 'reportee', label: 'Reportée', tone: 'neutral' },
  { key: 'terminee', label: 'Terminée — à vérifier', tone: 'warn' },
  { key: 'verifiee', label: 'Vérifiées · 30 j', tone: 'ok' },
];
/** Libellé de la colonne Vérifiées en « Historique complet ». */
export const VERIFIED_ALL_LABEL = 'Vérifiées · toutes';
/** Colonne d'une action : en retard d'abord, Budgétée ou initiée à 80 % → En cours ; Abandonnée (ou inconnue) : null. */
export function kanbanColumn(a: { status: string; dueOn: string }, today: string): KanbanKey | null {
  if (isLate(a, today)) return 'en_retard';
  switch (a.status) {
    case 'a_faire': return 'a_faire';
    case 'initiee': case 'p20': case 'p40': case 'p60': case 'p80': return 'en_cours';
    case 'reportee': return 'reportee';
    case 'terminee': return 'terminee';
    case 'verifiee': return 'verifiee';
    default: return null;
  }
}

// ─── Affichage du plan (?etat=) et vues (?vue=) ─────────────────────────────

export const PLAN_SCOPES = [['', 'Plan en cours', 'ph-kanban'], ['historique', 'Historique complet', 'ph-clock-counter-clockwise'], ['abandonnees', 'Abandonnées', 'ph-prohibit']] as const;
export type PlanScope = (typeof PLAN_SCOPES)[number][0];
/** Vues de /actions ; « Statistiques » (ACT-29) : lecteurs du plan seulement (canReadPlan), jamais le Salarié. */
export const PLAN_VIEWS = [
  ['liste', 'Liste', 'ph-list'], ['kanban', 'Kanban', 'ph-kanban'], ['responsable', 'Par responsable', 'ph-users'], ['statistiques', 'Statistiques', 'ph-chart-bar'],
] as const;
export type PlanView = (typeof PLAN_VIEWS)[number][0];
export const VERIFIED_WINDOW_DAYS = 30;
/**
 * Plan en cours : tout sauf Abandonnées, Vérifiées depuis 30 jours seulement (date de vérification ; à défaut, reprise sans
 * date de vérification : date cible) ; historique : tout sauf Abandonnées ; abandonnees : Abandonnées seulement.
 */
export function inPlanScope(a: { status: string; closedOn: string | null; dueOn: string }, scope: PlanScope, today: string): boolean {
  if (scope === 'abandonnees') return a.status === 'abandonnee';
  if (a.status === 'abandonnee') return false;
  if (scope === 'historique' || a.status !== 'verifiee') return true;
  return (a.closedOn ?? a.dueOn) >= addDays(today, -VERIFIED_WINDOW_DAYS);
}

// ─── Transitions (§ 6.2), faites par le QHSE seulement ─────────────────────

export type TransitionKind = 'step' | 'report' | 'resume' | 'finish' | 'unfinish' | 'verify' | 'reopen' | 'abandon';
/**
 * Transition de `from` vers `to` (§ 6.2) : ouverte → autre ouverte : step ; ouverte → Reportée : report ; Reportée →
 * ouverte : resume ; ouverte ou Reportée → Terminée : finish ; Terminée → ouverte : unfinish ; Terminée → Vérifiée :
 * verify ; Vérifiée → Terminée : reopen ; ouverte, Reportée ou Terminée → Abandonnée : abandon. Tout le reste (même
 * valeur, Terminée → Reportée, Vérifiée → Abandonnée, toute sortie d'Abandonnée…) : null.
 */
export function transitionKind(from: Avancement, to: Avancement): TransitionKind | null {
  if (from === to) return null;
  const open = (s: Avancement) => isOpenAvancement(s);
  if (open(from) && open(to)) return 'step';
  if (open(from) && to === 'reportee') return 'report';
  if (from === 'reportee' && open(to)) return 'resume';
  if ((open(from) || from === 'reportee') && to === 'terminee') return 'finish';
  if (from === 'terminee' && open(to)) return 'unfinish';
  if (from === 'terminee' && to === 'verifiee') return 'verify';
  if (from === 'verifiee' && to === 'terminee') return 'reopen';
  if ((open(from) || from === 'reportee' || from === 'terminee') && to === 'abandonnee') return 'abandon';
  return null;
}
/** Transitions de moveAction (les autres ont leur propre server action : verifyAction, reopenAction, abandonAction). */
export const MOVE_KINDS: readonly TransitionKind[] = ['step', 'report', 'resume', 'finish', 'unfinish'];
/** Transitions dont le motif est obligatoire (formReader(fd).reason()). */
export const REASON_REQUIRED: readonly TransitionKind[] = ['reopen', 'abandon'];
/** Résumé du journal : « Avancement : À faire → 40 % », « Reportée », « Reprise : 40 % », « Terminée le 20/09/2026 », … */
export function transitionSummary(kind: TransitionKind, from: Avancement, to: Avancement, extra: { doneOn?: string; effective?: boolean } = {}): string {
  const label = (s: Avancement) => AVANCEMENT[s].label;
  switch (kind) {
    case 'step': return `Avancement : ${label(from)} → ${label(to)}`;
    case 'report': return 'Reportée';
    case 'resume': return `Reprise : ${label(to)}`;
    case 'finish': return extra.doneOn ? `Terminée le ${fmtDate(extra.doneOn)}` : 'Terminée';
    case 'unfinish': return `Retour à ${label(to)} : date effective effacée`;
    case 'verify': return extra.effective === undefined ? 'Vérifiée' : `Vérifiée : ${extra.effective ? 'efficace' : 'non efficace'}`;
    case 'reopen': return 'Vérification rouverte : retour à Terminée — à vérifier';
    case 'abandon': return 'Abandonnée';
  }
}
/** Choix proposés par la fenêtre « Changer l'avancement » depuis `from` (transitions de MOVE_KINDS, ordre du § 5.1). */
export function moveTargets(from: Avancement): Avancement[] {
  return ACTION_AVANCEMENTS.filter((to) => {
    const kind = transitionKind(from, to);
    return !!kind && MOVE_KINDS.includes(kind);
  });
}

// ─── À compléter (D8) : calculé, jamais stocké ──────────────────────────────

export type MissingField = 'source' | 'problem' | 'domain' | 'priority' | 'siteId' | 'verifyDueOn' | 'doneOn' | 'closedOn' | 'verifyMethod' | 'efficacyNote' | 'effective';
export const MISSING_LABELS: Record<MissingField, string> = {
  source: 'Source', problem: 'Description du problème', domain: 'Domaine', priority: 'Priorité', siteId: 'Site',
  verifyDueOn: 'Vérification planifiée', doneOn: 'Date effective', closedOn: 'Date de vérification', verifyMethod: 'Nature de la vérification',
  efficacyNote: 'Constat de vérification', effective: 'Résultat',
};
/** Champs d'une action lus par missingFields (même forme que Pick<ActionRow, …> de src/lib/queries.ts). */
export type ActionCompletion = {
  status: string; source: string | null; problem: string | null; domain: string | null; priority: string | null; siteId: string | null;
  verifyDueOn: string | null; doneOn: string | null; closedOn: string | null; verifyMethod: string | null; efficacyNote: string | null; effective: boolean | null;
};
const blank = (v: string | null | undefined) => !v || !v.trim();
/**
 * Champs obligatoires manquants selon l'avancement (reprise, import) : toute action non abandonnée : source, problème,
 * domaine, priorité, site ; ouverte, Reportée, Terminée : + vérification planifiée ; Terminée : + date effective ;
 * Vérifiée : + date effective, date de vérification, nature, constat, résultat. Abandonnée : aucun.
 */
export function missingFields(a: ActionCompletion): MissingField[] {
  if (a.status === 'abandonnee') return [];
  const out: MissingField[] = [];
  if (blank(a.source)) out.push('source');
  if (blank(a.problem)) out.push('problem');
  if (blank(a.domain)) out.push('domain');
  if (blank(a.priority)) out.push('priority');
  if (blank(a.siteId)) out.push('siteId');
  const verifiee = a.status === 'verifiee';
  if (!verifiee && blank(a.verifyDueOn)) out.push('verifyDueOn');
  if ((a.status === 'terminee' || verifiee) && blank(a.doneOn)) out.push('doneOn');
  if (verifiee) {
    if (blank(a.closedOn)) out.push('closedOn');
    if (blank(a.verifyMethod)) out.push('verifyMethod');
    if (blank(a.efficacyNote)) out.push('efficacyNote');
    if (a.effective === null || a.effective === undefined) out.push('effective');
  }
  return out;
}
export const isToComplete = (a: ActionCompletion) => missingFields(a).length > 0;
/** Source posée une fois, puis verrouillée (ACT-01) : modifiable seulement tant qu'elle est vide (reprise). */
export const sourceEditable = (a: { source: string | null }) => a.source === null;

// ─── Contrôles de dates (§ 4, D24) ──────────────────────────────────────────
// Partagés par saveAction / moveAction / verifyAction et par les formulaires (avertissement côté client).

type ActionDates = { openedOn: string; dueOn?: string | null; verifyDueOn?: string | null; doneOn?: string | null; closedOn?: string | null };
const BEFORE_OPENING = (what: string, openedOn: string) => `${what} ne peut pas précéder la date d'ouverture (${fmtDate(openedOn)}).`;
/** Règles d'ordre seules (sans « aujourd'hui ») : dueOn/verifyDueOn ≥ openedOn ; openedOn ≤ doneOn ; (doneOn ?? openedOn) ≤ closedOn. */
export function actionDateOrderErrors(v: ActionDates): Record<string, string> {
  const errors: Record<string, string> = {};
  if (v.dueOn && v.dueOn < v.openedOn) errors.dueOn = BEFORE_OPENING('La date cible', v.openedOn);
  if (v.verifyDueOn && v.verifyDueOn < v.openedOn) errors.verifyDueOn = BEFORE_OPENING('La vérification planifiée', v.openedOn);
  if (v.doneOn && v.doneOn < v.openedOn) errors.doneOn = BEFORE_OPENING('La date effective', v.openedOn);
  if (v.closedOn && v.closedOn < (v.doneOn ?? v.openedOn)) {
    errors.closedOn = v.doneOn
      ? `La date de vérification ne peut pas précéder la date effective (${fmtDate(v.doneOn)}).`
      : BEFORE_OPENING('La date de vérification', v.openedOn);
  }
  return errors;
}
/** Avertissement (non bloquant) d'une vérification planifiée avant la date cible. */
export const VERIFY_BEFORE_DUE_WARNING = 'Vérification planifiée avant la date cible.';
/**
 * Contrôle d'une demande : chaque règle ne porte que sur un champ saisi ou modifié par la demande (`changed`) ; création :
 * tout à true. dueOn / verifyDueOn modifiés : ≥ date d'ouverture et ≥ aujourd'hui ; doneOn modifiée : entre la date
 * d'ouverture et aujourd'hui (et pas après une date de vérification déjà portée) ; closedOn modifiée : entre
 * (date effective ?? date d'ouverture) et aujourd'hui. Vérification planifiée avant la date cible (l'une des deux
 * modifiée) : avertissement. Une valeur reprise incohérente non modifiée n'est jamais refusée (D24).
 */
export function actionDateErrors(v: ActionDates, today: string, changed: { dueOn?: boolean; verifyDueOn?: boolean; doneOn?: boolean; closedOn?: boolean }): { fieldErrors: Record<string, string>; warnings: string[] } {
  const order = actionDateOrderErrors(v);
  const fieldErrors: Record<string, string> = {};
  const warnings: string[] = [];
  const set = (name: string, msg: string) => { fieldErrors[name] ??= msg; };
  if (changed.dueOn && v.dueOn) {
    if (order.dueOn) set('dueOn', order.dueOn);
    else if (v.dueOn < today) set('dueOn', 'La date cible ne peut pas être dans le passé.');
  }
  if (changed.verifyDueOn && v.verifyDueOn) {
    if (order.verifyDueOn) set('verifyDueOn', order.verifyDueOn);
    else if (v.verifyDueOn < today) set('verifyDueOn', 'La vérification planifiée ne peut pas être dans le passé.');
  }
  if (changed.doneOn && v.doneOn) {
    if (order.doneOn) set('doneOn', order.doneOn);
    else if (v.doneOn > today) set('doneOn', 'La date effective ne peut pas être dans le futur.');
    else if (!changed.closedOn && v.closedOn && v.doneOn > v.closedOn) set('doneOn', `La date effective ne peut pas suivre la date de vérification (${fmtDate(v.closedOn)}).`);
  }
  if (changed.closedOn && v.closedOn) {
    if (order.closedOn) set('closedOn', order.closedOn);
    else if (v.closedOn > today) set('closedOn', 'La date de vérification ne peut pas être dans le futur.');
  }
  if ((changed.dueOn || changed.verifyDueOn) && v.dueOn && v.verifyDueOn && v.verifyDueOn < v.dueOn) warnings.push(VERIFY_BEFORE_DUE_WARNING);
  return { fieldErrors, warnings };
}
/** Texte modifié trop long (D24) : la limite de 4 000 caractères ne vaut que pour une valeur changée. */
export const textTooLong = (next: string | null, stored: string | null | undefined) => next !== (stored ?? null) && (next?.length ?? 0) > ACTION_TEXT_MAX;

// ─── Droits (ACT-22, D19) : règles pures, appliquées par le serveur et par les pages ───

/** « QHSE » des actions : animateur QHSE et direction (canApprove, § 22.17). */
export const isQhse = (role: Role) => canApprove(role);
/**
 * Création d'une action (ACT-22, réponse du service QHSE du 15/10/2026 : « les actions QSE sont créées uniquement par le
 * service QHSE ») : QHSE seulement, depuis le plan comme depuis un écran source. Les autres rôles n'ont aucun bouton de
 * création ; là où une étape attend une action (étape « Actions » d'un événement), ils lisent QHSE_ONLY_CREATE_MESSAGE.
 */
export const canCreateAction = (role: Role): boolean => isQhse(role);
/** Message affiché à qui n'est pas QHSE là où une action serait attendue (ACT-22). */
export const QHSE_ONLY_CREATE_MESSAGE = 'Les actions QSE sont créées par le service QHSE.';
/** Consultation du plan de son périmètre : QHSE et encadrement (lecture seule, ACT-22) ; le Salarié ne lit que ses actions. */
export const canReadPlan = (role: Role) => canSee(role, 'actions') && !isEmployee(role);
/** D19 : ses propres actions, quel que soit leur site ; les autres : plan du périmètre (inPerimeter, appliqué par l'appelant). */
export const canReadAction = (role: Role, userId: string, a: { pilotId: string; siteId: string | null }, allowedSiteIds: readonly string[] | null) =>
  a.pilotId === userId || (canReadPlan(role) && (!allowedSiteIds || !a.siteId || allowedSiteIds.includes(a.siteId)));

// ─── Source imposée par l'élément lié (D20) ─────────────────────────────────

/** Faits de l'élément lié qui décident de la source : type d'événement, ligne du programme d'audit, nature de la décision. */
export type LinkFacts = { eventType?: string | null; track?: string | null; decisionKind?: string | null };
const AUDIT_SOURCES = ['audit_certification', 'audit_fournisseur', 'audit_interne', 'audit_terrain'] as const satisfies readonly SourceKey[];
/** Ligne du programme d'audit (clés de PLAN_TRACK_KINDS, src/lib/domain.ts) → source imposée. */
const TRACK_SOURCES: Record<string, readonly SourceKey[]> = {
  Certification: ['audit_certification'], 'Visites sécurité': ['audit_terrain'], 'Audits internes': ['audit_interne'],
  Fournisseurs: ['audit_fournisseur'],
};
/**
 * Sources d'un constat ou d'un élément du programme selon sa ligne ; ligne absente ou inconnue (clé héritée d'Object
 * comprise) : les quatre sources d'audit. « Revues de direction » : Revue de direction pour l'élément du programme
 * seulement — une revue n'a pas de constat (src/server/audits.ts) ; un constat de cette ligne (base reprise) garde les
 * sources d'audit, comme la reprise 0005 (R3).
 */
const trackSources = (kind: 'finding' | 'plan', track: string | null | undefined): readonly SourceKey[] => {
  if (kind === 'plan' && track === 'Revues de direction') return ['revue_direction'];
  return track && Object.hasOwn(TRACK_SOURCES, track) ? TRACK_SOURCES[track] : AUDIT_SOURCES;
};
/**
 * Éléments qui ne donnent pas lieu à une action QSE (réponses du service QHSE du 15/10/2026) : les recyclages et formations
 * relèvent des RH (Habilitations), les plans de prévention et permis donnent lieu à des actions immédiates non enregistrées
 * au plan (Prévention). Refusés pour tout nouveau lien, à la création comme au rattachement ; les liens repris restent
 * lisibles.
 */
export const NON_QSE_LINK_KINDS = ['qualification', 'preventionplan', 'permit'] as const;
export const NON_QSE_LINK_MESSAGE = 'Ce type d\'élément ne donne pas lieu à une action QSE.';
export const isNonQseLinkKind = (kind: string) => (NON_QSE_LINK_KINDS as readonly string[]).includes(kind);
/**
 * Sources admises pour un lien de création (D20 révisée le 15/10/2026) ; vide : ce type d'élément ne permet pas de créer
 * une action (NON_QSE_LINK_KINDS, ou type inconnu). Sans élément (`kind` null) : les 24 sources (référence d'origine
 * obligatoire). Événement : Réclamation client (RC) ou Évènement QSE ; constat ou élément du programme : selon la ligne
 * (Certification, Visites sécurité, Audits internes, Fournisseurs ; élément de la ligne Revues de direction : Revue de
 * direction ; sans ligne ou ligne inconnue : les quatre sources d'audit) ; risque : DUERP ; exigence : Veille
 * réglementaire ou Déchets (action BSD de l'écran Environnement) ; contrôle : Contrôle réglementaire ; document ou
 * version : Revue documentaire ; revue : Revue de direction ; décision : Objectif QSE (nature « objectif ») ou Revue de
 * direction ; filière ou enlèvement de déchets : Déchets. Il n'y a plus de source libre pour un élément lié. Cohérence
 * (testée) : pour toute source admise, `kind` ∈ SOURCE_LINK_KINDS de sa cible. Utilisée par saveAction, les sélecteurs
 * du plan et les écrans.
 */
export function admissibleSources(kind: string | null, facts: LinkFacts = {}): readonly SourceKey[] {
  if (kind === null) return SOURCE_KEYS;
  switch (kind) {
    case 'event': return facts.eventType === 'RC' ? ['reclamation_client'] : ['evenement'];
    case 'finding': case 'plan': return trackSources(kind, facts.track);
    case 'risk': return ['duerp'];
    case 'requirement': return ['veille', 'dechets'];
    case 'control': return ['controle_reglementaire'];
    case 'document': case 'docversion': return ['revue_documentaire'];
    case 'review': return ['revue_direction'];
    case 'reviewdecision': return facts.decisionKind === 'objectif' ? ['objectif'] : ['revue_direction'];
    case 'wastestream': case 'wasteentry': return ['dechets'];
    default: return [];
  }
}

/**
 * Reprise d'un lien de l'action vérifiée par une action de suite (D21, réponses du service QHSE du 15/10/2026) :
 *   - 'source' : événement, constat, élément du programme — repris seulement s'il est l'élément de la source de l'action
 *     vérifiée (SOURCE_LINK_KINDS de sa cible) : l'événement est rattaché aussi à la suite, le constat ou l'élément du
 *     programme lui est déplacé ; sinon (ligne reprise à plusieurs éléments, D22) ni copié ni déplacé ;
 *   - 'multi' : risque, revue, document, filière, enlèvement (plusieurs actions possibles) : rattaché aussi à la suite,
 *     l'action vérifiée le garde ;
 *   - 'single' : exigence, contrôle, version de document, décision de revue (une action à la fois) : déplacé vers la
 *     première suite (non efficace d'abord) ;
 *   - 'none' : habilitation, plan de prévention, permis (NON_QSE_LINK_KINDS) et type inconnu : jamais repris — ni déplacé
 *     ni copié — l'action vérifiée garde son lien repris (lecture seule).
 */
export type FollowUpLinkMode = 'source' | 'multi' | 'single' | 'none';
const FOLLOW_UP_LINK_MODES: Record<string, FollowUpLinkMode> = {
  event: 'source', finding: 'source', plan: 'source',
  risk: 'multi', review: 'multi', document: 'multi', wastestream: 'multi', wasteentry: 'multi',
  requirement: 'single', control: 'single', docversion: 'single', reviewdecision: 'single',
};
export const followUpLinkMode = (kind: string): FollowUpLinkMode =>
  !isNonQseLinkKind(kind) && Object.hasOwn(FOLLOW_UP_LINK_MODES, kind) ? FOLLOW_UP_LINK_MODES[kind] : 'none';

/**
 * Liens complémentaires (ACT-02, décidé le 15/10/2026) : rattachés et détachés après la création, depuis la fiche de
 * l'action comme depuis l'écran de l'élément (linkAction / unlinkAction, QHSE seulement) — risque du DUERP, exigence,
 * contrôle, version de document, revue, décision de revue. Jamais l'événement ni l'audit (EVENT_AUDIT_LINK_KINDS), ni une
 * source d'origine (document, filière, enlèvement : fixés à la création), ni un élément sans action QSE (NON_QSE_LINK_KINDS).
 */
export const COMPLEMENTARY_LINK_KINDS = ['risk', 'requirement', 'control', 'docversion', 'review', 'reviewdecision'] as const;
export type ComplementaryLinkKind = (typeof COMPLEMENTARY_LINK_KINDS)[number];
export const isComplementaryLinkKind = (kind: string): kind is ComplementaryLinkKind => (COMPLEMENTARY_LINK_KINDS as readonly string[]).includes(kind);
/** Libellé d'un type de lien complémentaire (liste « Type d'élément » de « Rattacher »). */
export const COMPLEMENTARY_LINK_LABELS: Record<ComplementaryLinkKind, string> = {
  risk: 'Risque du DUERP', requirement: 'Exigence de veille', control: 'Contrôle périodique', docversion: 'Version de document en révision',
  review: 'Revue de direction', reviewdecision: 'Décision de revue',
};

/** Droits d'un lecteur sur une action (fiche, boutons) ; le serveur applique les mêmes règles. */
export type ActionRights = {
  qhse: boolean; responsible: boolean;
  canEdit: boolean; // saveAction (modification) : QHSE, sauf Abandonnée (D17)
  canMove: boolean; // moveAction : QHSE, avancement ouvert, Reportée ou Terminée
  canVerify: boolean; // QHSE, Terminée
  canReopen: boolean; // QHSE, Vérifiée
  canAbandon: boolean; // QHSE, ouverte, Reportée ou Terminée
  canComment: boolean; // QHSE ou responsable, tout avancement (§ 9)
  canAttach: boolean; // QHSE ou responsable, sauf Abandonnée (§ 10)
  canLink: boolean; // linkAction (rattachement complémentaire, ACT-22 : QHSE seulement) : action non close (ni Vérifiée ni Abandonnée)
  canUnlink: boolean; // unlinkAction (détachement d'un lien complémentaire) : QHSE, sauf Abandonnée (lecture seule, D17)
  /** Libellé du site de l'action quand il diffère du site sélectionné : écritures du QHSE refusées par requireInSite (la fiche
   *  propose de changer de site) ; commentaires et preuves du responsable admis sans changer de site (D19). */
  elsewhere: string | null;
};
export function actionRights(role: Role, userId: string, a: { pilotId: string; status: string }, opts: { elsewhere?: string | null } = {}): ActionRights {
  const qhse = isQhse(role);
  const responsible = a.pilotId === userId;
  const movable = isOpenAvancement(a.status) || a.status === 'reportee' || a.status === 'terminee';
  return {
    qhse, responsible,
    canEdit: qhse && isAvancement(a.status) && a.status !== 'abandonnee',
    canMove: qhse && movable,
    canVerify: qhse && a.status === 'terminee',
    canReopen: qhse && a.status === 'verifiee',
    canAbandon: qhse && movable,
    canComment: qhse || responsible,
    canAttach: (qhse || responsible) && a.status !== 'abandonnee',
    canLink: qhse && isAvancement(a.status) && !isClosedActionStatus(a.status),
    canUnlink: qhse && isAvancement(a.status) && a.status !== 'abandonnee',
    elsewhere: opts.elsewhere ?? null,
  };
}
/** § 8 : QHSE, ou le responsable actuel pour sa propre preuve ; jamais après « Vérifiée » (ni encadrement, ni ancien responsable). */
export const canRemoveProof = (r: ActionRights, status: string, uploadedById: string | null | undefined, userId: string) =>
  status !== 'verifiee' && status !== 'abandonnee' && (r.qhse || (r.responsible && !!uploadedById && uploadedById === userId));
/** Retrait motivé d'un commentaire : son auteur ou le QHSE, une seule fois (§ 9). */
export const canWithdrawComment = (r: ActionRights, c: { authorId: string; withdrawn: boolean }, userId: string) =>
  !c.withdrawn && (r.qhse || c.authorId === userId);

// ─── Filtres de la vue générale (§ 16), portés par l'URL et communs aux trois vues ───

export type ActionFilters = {
  vue: PlanView; etat: PlanScope;
  avancement: Avancement | 'ouvertes' | 'en_retard' | null;
  retard: boolean; // ?retard=1 (identique à avancement=en_retard ; conservé pour les liens profonds)
  responsable: string | null; // ?responsable=<personId> (alias accepté : ?pilote=)
  mes: boolean; // ?mes=1 : responsable = personne connectée
  source: SourceKey | null; priorite: ActionPriority | null;
  completer: boolean; // ?completer=1 : actions à compléter
  q: string; // ≤ 100 caractères
  action: string | null; // ?action=<id> : fiche ouverte
  mois: string | null; // ?mois=AAAA-MM : mois des statistiques (ACT-29), validé par parseStatsMonth
};
export const ACTION_FILTER_QUERY_MAX = 100;
type SearchParams = Record<string, string | string[] | undefined>;
const first = (sp: SearchParams, key: string) => {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? '';
};
const pick = <T extends string>(value: string, allowed: readonly T[]): T | null => ((allowed as readonly string[]).includes(value) ? (value as T) : null);
/** Lecture des paramètres de /actions : première valeur d'un paramètre répété ; valeur invalide → défaut ; alias etat=annulees, vue=pilote. */
export function parseActionFilters(sp: SearchParams): ActionFilters {
  const vue = first(sp, 'vue');
  const etat = first(sp, 'etat');
  const avancement = first(sp, 'avancement');
  const responsable = first(sp, 'responsable') || first(sp, 'pilote');
  const action = first(sp, 'action');
  return {
    vue: pick(vue === 'pilote' ? 'responsable' : vue, PLAN_VIEWS.map((v) => v[0])) ?? 'liste',
    etat: pick(etat === 'annulees' ? 'abandonnees' : etat, PLAN_SCOPES.map((s) => s[0])) ?? '',
    avancement: avancement === 'ouvertes' || avancement === 'en_retard' ? avancement : isAvancement(avancement) ? avancement : null,
    retard: first(sp, 'retard') === '1',
    responsable: responsable && responsable.length <= 100 ? responsable : null,
    mes: first(sp, 'mes') === '1',
    source: pick(first(sp, 'source'), SOURCE_KEYS),
    priorite: pick(first(sp, 'priorite'), PRIORITY_KEYS),
    completer: first(sp, 'completer') === '1',
    q: first(sp, 'q').slice(0, ACTION_FILTER_QUERY_MAX),
    action: action && action.length <= 64 ? action : null,
    mois: /^\d{4}-\d{2}$/.test(first(sp, 'mois')) ? first(sp, 'mois') : null,
  };
}
/** Paramètres d'URL des filtres (pour hrefWith) : valeurs par défaut omises (vue liste, etat '', faux, vide). */
export function actionFiltersParams(f: Partial<ActionFilters>): Record<string, string | undefined> {
  return {
    vue: f.vue && f.vue !== 'liste' ? f.vue : undefined,
    etat: f.etat || undefined,
    avancement: f.avancement ?? undefined,
    retard: f.retard ? '1' : undefined,
    responsable: f.responsable ?? undefined,
    mes: f.mes ? '1' : undefined,
    source: f.source ?? undefined,
    priorite: f.priorite ?? undefined,
    completer: f.completer ? '1' : undefined,
    q: f.q || undefined,
    action: f.action ?? undefined,
    mois: f.mois ?? undefined,
  };
}
/** Action telle que les filtres la lisent (ligne de la vue générale). */
export type FilterableAction = {
  id: string; status: string; dueOn: string; pilotId: string; source: string | null; priority: string | null; problem: string | null;
  detail: string; originRef: string; cancelReason: string | null; missing: readonly string[];
};
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr');
/**
 * Filtres de la vue générale (sauf etat, appliqué par inPlanScope) : avancement (une valeur, « ouvertes », « en_retard »),
 * retard, responsable, mes actions, source, priorité, à compléter, texte libre sans accents ni casse sur le numéro, la
 * description du problème, le détail, la référence d'origine et le motif d'abandon (jamais les commentaires, § 9).
 */
export function matchesActionFilters(a: FilterableAction, f: ActionFilters, ctx: { userId: string; today: string }): boolean {
  if (f.avancement === 'ouvertes' && !isOpenAvancement(a.status)) return false;
  if (f.avancement === 'en_retard' && !isLate(a, ctx.today)) return false;
  if (f.avancement && f.avancement !== 'ouvertes' && f.avancement !== 'en_retard' && a.status !== f.avancement) return false;
  if (f.retard && !isLate(a, ctx.today)) return false;
  if (f.responsable && a.pilotId !== f.responsable) return false;
  if (f.mes && a.pilotId !== ctx.userId) return false;
  if (f.source && a.source !== f.source) return false;
  if (f.priorite && a.priority !== f.priorite) return false;
  if (f.completer && a.missing.length === 0) return false;
  const needle = fold(f.q.trim());
  if (needle && ![a.id, a.problem ?? '', a.detail, a.originRef, a.cancelReason ?? ''].some((v) => fold(v).includes(needle))) return false;
  return true;
}
/** Tri par défaut : retards d'abord (jours de retard décroissants), puis date cible, puis numéro décroissant. */
export function compareActions(a: { id: string; status: string; dueOn: string }, b: { id: string; status: string; dueOn: string }, today: string): number {
  const late = lateDays(b, today) - lateDays(a, today);
  if (late) return late;
  if (a.dueOn !== b.dueOn) return a.dueOn < b.dueOn ? -1 : 1;
  const [na, nb] = [parseActionNumber(a.id), parseActionNumber(b.id)];
  if (na !== null && nb !== null && na !== nb) return nb - na;
  return b.id.localeCompare(a.id, 'fr', { numeric: true });
}
