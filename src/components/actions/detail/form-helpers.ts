// Règles d'affichage pures de la fiche et du formulaire d'action (docs/specs/actions-qse.md § 4–13 ; plan du paquet 1,
// flux B, amendé le 15/10/2026) : sans React ni dépendance serveur, partagées par ActionFormDialog.tsx, ActionDetail.tsx
// et les fenêtres du dossier detail/, testées dans form-helpers.test.ts.
//
// Le serveur (src/server/plan.ts, plan-ui.ts, action-comments.ts) applique les mêmes règles (action-rules.ts) : ces
// aides ne décident d'aucun droit, elles choisissent ce que la fiche propose et ce que les formulaires pré-remplissent.

import {
  MISSING_LABELS, actionDateErrors, admissibleSources, followUpProblem, moveTargets, transitionKind, type ActionRights, type LinkFacts,
  type MissingField, type TransitionKind,
} from '@/lib/action-rules';
import type { ActionDefaults, ActionDetailView, ActionFormOptions, ActionTargetOption } from '@/lib/action-view';
import { fileBatchError } from '@/lib/attachments';
import {
  ACTION_AVANCEMENTS, ACTION_DOMAINS, ACTION_PRIORITIES, ACTION_RISK_LEVELS, ACTION_SOURCES, EVENT_AUDIT_LINK_KINDS, SOURCE_KEYS,
  VERIFY_METHODS, isOpenAvancement, type Avancement, type FollowReason, type SourceKey,
} from '@/lib/domain';
import { ARCHIVED_SITE_SUFFIX, LEFT_SUFFIX, withCurrent, type Option } from '@/lib/form-options';

// ─── Source et élément lié (§ 12, D20) ──────────────────────────────────────

const isSourceKey = (s: string | null | undefined): s is SourceKey => !!s && (SOURCE_KEYS as readonly string[]).includes(s);

/** Choix de la liste « Source » : les 24 sources dans l'ordre du QHSE, ou les seules sources admises par l'écran. */
export function sourceOptions(choices?: readonly SourceKey[] | null): Option[] {
  const keys = choices?.length ? SOURCE_KEYS.filter((k) => choices.includes(k)) : SOURCE_KEYS;
  return keys.map((k) => [k, ACTION_SOURCES[k].label] as Option);
}
/** Précision affichée sous la liste des sources (AST-EST, Réserves). */
export const sourceHint = (source: string | null | undefined): string | undefined => (isSourceKey(source) ? ACTION_SOURCES[source].hint : undefined);
/** Source proposée à l'ouverture : celle de l'écran, sinon la seule admise, sinon à choisir (''). */
export function initialSource(d: Pick<ActionDefaults, 'source' | 'sourceChoices'>): SourceKey | '' {
  if (isSourceKey(d.source) && (!d.sourceChoices?.length || d.sourceChoices.includes(d.source))) return d.source;
  return d.sourceChoices?.length === 1 ? d.sourceChoices[0] : '';
}
/** Source imposée (texte affiché + champ caché) : écran qui la verrouille, ou une seule source admise. */
export function lockedSource(d: Pick<ActionDefaults, 'source' | 'lockSource' | 'sourceChoices'>): SourceKey | null {
  if (d.lockSource && isSourceKey(d.source)) return d.source;
  return d.sourceChoices?.length === 1 ? d.sourceChoices[0] : null;
}
/** La source désigne un élément de Vigie (événement, audit, risque…) : le plan propose le sélecteur d'élément. */
export const sourceHasElement = (source: string | null | undefined) => isSourceKey(source) && ACTION_SOURCES[source].target !== 'free';
/**
 * Éléments proposés par le sélecteur du plan pour la source choisie (D20) : seulement ceux dont `sources` contient la
 * source (événements RC sous « Réclamation client », autres événements sous « Évènement QSE », constats selon la ligne
 * du programme…) ; aucune source choisie : aucun élément.
 */
export function targetChoices(targets: readonly ActionTargetOption[] | undefined, source: string | null | undefined): ActionTargetOption[] {
  if (!targets || !isSourceKey(source)) return [];
  return targets.filter((t) => t.sources.includes(source));
}
// Faits d'un élément que le navigateur ne connaît pas (type d'événement, ligne du programme, nature d'une décision) :
// toutes leurs variantes, pour borner la liste des sources d'après le seul type d'élément.
const FACT_VARIANTS: readonly LinkFacts[] = [
  {}, { eventType: 'RC' }, { decisionKind: 'objectif' },
  ...['Certification', 'Visites sécurité', 'Audits internes', 'Fournisseurs', 'Revues de direction'].map((track) => ({ track })),
];
/** Type d'un lien « kind:args ». */
export const linkKind = (link: string) => link.split(':')[0] ?? '';
/**
 * Sources que peut admettre un élément d'après son seul type (union de admissibleSources sur les variantes de ses faits) ;
 * vide : élément qui ne donne pas lieu à une action QSE (habilitation, plan de prévention, permis, type inconnu). Jamais
 * une source libre pour un élément lié (amendements du 15/10/2026) ; le serveur tranche avec les faits de l'élément.
 */
export function kindSources(kind: string): SourceKey[] {
  const admitted = new Set<SourceKey>();
  for (const facts of FACT_VARIANTS) admissibleSources(kind, facts).forEach((s) => admitted.add(s));
  return SOURCE_KEYS.filter((k) => admitted.has(k));
}
/**
 * Sources proposées à la création : celles de l'écran (`sourceChoices`, `lockSource`) ; élément imposé sans indication de
 * l'écran : les sources que son type admet (jamais les 24) ; sans élément : celles de l'écran ou les 24 (undefined).
 */
export function creationSourceChoices(d: Pick<ActionDefaults, 'link' | 'lockSource' | 'source' | 'sourceChoices'>): readonly SourceKey[] | undefined {
  if (d.sourceChoices?.length) return d.sourceChoices;
  if (d.lockSource && isSourceKey(d.source)) return [d.source];
  return d.link ? kindSources(linkKind(d.link)) : undefined;
}
/**
 * Sources proposées pour compléter la source vide d'une action reprise : bornées par son événement et ses éléments
 * d'audit (le serveur les contrôle, D20) ; sans élément d'événement ni d'audit : les 24 (undefined).
 */
export function editSourceChoices(d: Pick<ActionDetailView, 'source' | 'eventId' | 'sources'>): SourceKey[] | undefined {
  if (d.source !== null) return undefined;
  const kinds = new Set<string>(d.eventId ? ['event'] : []);
  for (const s of d.sources) if ((EVENT_AUDIT_LINK_KINDS as readonly string[]).includes(s.kind) && s.kind !== 'event') kinds.add(s.kind);
  if (!kinds.size) return undefined;
  const admitted = new Set([...kinds].flatMap(kindSources));
  return SOURCE_KEYS.filter((k) => admitted.has(k));
}
/** L'élément choisi est encore admis par la nouvelle source (sinon le sélecteur revient à « Aucun »). */
export const linkStillAdmitted = (targets: readonly ActionTargetOption[] | undefined, source: string, link: string) =>
  !link || targetChoices(targets, source).some((t) => t.value === link);

// ─── Site (§ 13) ────────────────────────────────────────────────────────────

/**
 * Site proposé : celui de l'élément lié quand il en a un et qu'il fait partie des sites proposés (writableSites) ; sinon
 * le site de l'écran ou de l'action ; sinon le seul site proposé ; sinon à choisir (''). Jamais « Tous les sites ».
 */
export function defaultSiteId(sites: readonly Option[], prefs: { elementSiteId?: string | null; siteId?: string | null }): string {
  const has = (id: string | null | undefined): id is string => !!id && sites.some(([v]) => v === id);
  if (has(prefs.elementSiteId)) return prefs.elementSiteId;
  if (has(prefs.siteId)) return prefs.siteId;
  return sites.length === 1 ? sites[0][0] : '';
}
/** Site de l'élément choisi dans le sélecteur du plan (null : élément commun à l'entreprise, ou aucun élément). */
export const targetSiteId = (targets: readonly ActionTargetOption[] | undefined, link: string) =>
  (link && targets?.find((t) => t.value === link)?.siteId) || null;

// ─── Modification depuis la fiche ──────────────────────────────────────────

/** Valeurs actuelles d'une action pour le formulaire de modification (ActionFields en mode modification). */
export function editDefaults(d: ActionDetailView): ActionDefaults {
  return {
    id: d.id, version: d.version, status: d.status, source: d.source, sourceChoices: editSourceChoices(d), originRef: d.originRef,
    domain: d.domain, priority: d.priority, riskLevel: d.riskLevel, problem: d.problem ?? '', detail: d.detail,
    siteId: d.siteId, pilotId: d.pilotId, pilotName: d.pilot,
    dueOn: d.dueOn, verifyDueOn: d.verifyDueOn, openedOn: d.openedOn,
    doneOn: d.doneOn, verifyMethod: d.verifyMethod, efficacyNote: d.efficacyNote,
    hours: d.hours, estimatedCost: d.estimatedCost, actualCost: d.actualCost,
    healthWarning: d.healthWarning,
  };
}
/**
 * Listes du formulaire de modification : la personne et le site encore portés par l'action restent des choix quand ils
 * ne sont plus proposés (personne sortie de l'effectif, site archivé), signalés, jamais proposés pour un nouveau choix.
 */
export function editOptions(options: ActionFormOptions, d: Pick<ActionDetailView, 'pilotId' | 'pilot' | 'siteId' | 'site'>): ActionFormOptions {
  return {
    ...options,
    people: withCurrent(options.people, d.pilotId, `${d.pilot}${LEFT_SUFFIX}`),
    sites: d.siteId ? withCurrent(options.sites, d.siteId, `${d.site}${ARCHIVED_SITE_SUFFIX}`) : options.sites,
  };
}

// ─── Boutons de la fiche (droits : actionRights, src/lib/action-rules.ts) ──

export type DetailButton = 'edit' | 'move' | 'verify' | 'reopen' | 'abandon';
/** Boutons d'écriture proposés par la fiche, dans l'ordre d'affichage ; aucun pour qui n'est pas QHSE. */
export function detailButtons(r: ActionRights): DetailButton[] {
  const out: DetailButton[] = [];
  if (r.canEdit) out.push('edit');
  if (r.canAbandon) out.push('abandon');
  if (r.canReopen) out.push('reopen');
  if (r.canMove) out.push('move');
  if (r.canVerify) out.push('verify');
  return out;
}
/**
 * Écritures du QHSE refusées tant que le site sélectionné n'est pas celui de l'action (requireInSite) : la fiche les
 * désactive et propose de sélectionner ce site.
 */
export const writesBlocked = (r: ActionRights) => !!r.elsewhere;
/** Fil et preuves ouverts au lecteur ici : QHSE sur le site de l'action, ou responsable quel que soit le site (D19). */
export const threadWritable = (r: ActionRights) => r.canComment && (!r.elsewhere || r.responsible);
export const RESPONSIBLE_READ_ONLY = 'Lecture seule : l’avancement est géré par le service QHSE.';
export const READER_READ_ONLY = 'Consultation seule : le plan d’actions est géré par le service QHSE.';
export const ABANDONED_READ_ONLY = 'Action abandonnée : consultation seule ; le fil de commentaires reste ouvert.';
/** Action abandonnée, lecteur qui ne commente pas (encadrement) : consultation seule, sans mention du fil. */
export const ABANDONED_READER_READ_ONLY = 'Action abandonnée : consultation seule.';
/** Mention de lecture seule de la fiche (null : QHSE sur une action modifiable). */
export function readOnlyNotice(r: ActionRights, status: string): string | null {
  if (status === 'abandonnee') return r.canComment ? ABANDONED_READ_ONLY : ABANDONED_READER_READ_ONLY;
  if (r.qhse) return null;
  return r.responsible ? RESPONSIBLE_READ_ONLY : READER_READ_ONLY;
}

// ─── Vérification (D17) ─────────────────────────────────────────────────────

/** Bloc Vérification : à l'état « Vérifiée » seulement (une ligne reprise rouverte porte encore un ancien constat). */
export const showVerification = (status: string) => status === 'verifiee';
/** « Constat d'une vérification précédente » : ligne non Vérifiée qui porte encore le constat d'une vérification (reprise). */
export const showPreviousVerification = (d: Pick<ActionDetailView, 'status' | 'previousVerification'>) =>
  d.status !== 'verifiee' && !!d.previousVerification;

// ─── Changer l'avancement (moveAction, § 6.2) ──────────────────────────────

/**
 * Avancement proposé à l'ouverture de la fenêtre : palier suivant pour une action ouverte (80 % → Terminée) ; Reportée
 * ou Terminée : à choisir ('').
 */
export function defaultMoveTarget(from: Avancement): Avancement | '' {
  if (!isOpenAvancement(from)) return '';
  const targets = moveTargets(from);
  const next = ACTION_AVANCEMENTS.slice(ACTION_AVANCEMENTS.indexOf(from) + 1).find((s) => isOpenAvancement(s) && targets.includes(s));
  return next ?? (targets.includes('terminee') ? 'terminee' : '');
}
export type MoveFields = { kind: TransitionKind | null; doneOn: boolean; verifyDueOn: boolean; dueOn: boolean; notice: string | null };
/**
 * Champs de la fenêtre selon la transition : Terminée → date effective (et vérification planifiée si l'action n'en a
 * pas) ; reprise d'une Reportée → date cible proposée ; commentaire facultatif toujours.
 */
export function moveFields(from: Avancement, to: Avancement | '', a: { verifyDueOn: string | null }): MoveFields {
  const kind = to ? transitionKind(from, to) : null;
  const notices: Partial<Record<TransitionKind, string>> = {
    report: 'L’action sort des retards et du rappel du mercredi jusqu’à sa reprise.',
    resume: 'L’action reprend le suivi des retards : revoyez sa date cible au besoin.',
    finish: 'La vérification d’efficacité est ensuite suivie par le responsable QHSE du site.',
    unfinish: 'La date effective est effacée (elle reste dans l’historique).',
  };
  return {
    kind,
    doneOn: kind === 'finish',
    verifyDueOn: kind === 'finish' && !a.verifyDueOn,
    dueOn: kind === 'resume',
    notice: kind ? notices[kind] ?? null : null,
  };
}

// ─── Actions de suite (§ 7, verifyAction) ──────────────────────────────────

export type FollowUpPrefill = { problem: string; pilotId: string; priority: string; domain: string; riskLevel: string; siteId: string };
/**
 * Section « Nouvelle action » de la fenêtre de vérification, pré-remplie d'après l'action vérifiée : domaine, priorité,
 * niveau de risque, site (s'il est encore proposé) et responsable (s'il est encore à l'effectif) ; problème « Action A-n
 * jugée non efficace le JJ/MM/AAAA : <constat> » (non efficace) ou vide (nouveau risque : description saisie). Source,
 * élément lié et référence d'origine sont repris de l'action vérifiée par le serveur, jamais lus du formulaire.
 */
export function followUpPrefill(
  d: Pick<ActionDetailView, 'id' | 'pilotId' | 'priority' | 'domain' | 'riskLevel' | 'siteId'>,
  reason: FollowReason,
  ctx: { closedOn: string; note: string; people: readonly Option[]; sites: readonly Option[] },
): FollowUpPrefill {
  return {
    problem: reason === 'non_efficace' && ctx.closedOn ? followUpProblem(d.id, ctx.closedOn, ctx.note.trim()) : '',
    pilotId: ctx.people.some(([v]) => v === d.pilotId) ? d.pilotId : '',
    priority: d.priority ?? '',
    domain: d.domain ?? '',
    riskLevel: d.riskLevel == null ? '' : String(d.riskLevel),
    siteId: defaultSiteId(ctx.sites, { siteId: d.siteId }),
  };
}
/** Préfixe des champs d'une section de suite (FormData de verifyAction, plan § 2.14). */
export const FOLLOW_UP_PREFIX: Record<FollowReason, 'ne_' | 'nr_'> = { non_efficace: 'ne_', nouveau_risque: 'nr_' };

// ─── Dates (avertissements côté client, D24) ───────────────────────────────

/**
 * Avertissements non bloquants du formulaire (vérification planifiée avant la date cible), calculés avec la date du jour
 * du serveur (ActionFormOptions.today) ; les refus restent ceux du serveur.
 */
export function planningWarnings(v: { openedOn: string; dueOn: string; verifyDueOn: string }, today: string): string[] {
  if (!v.dueOn || !v.verifyDueOn) return [];
  return actionDateErrors({ openedOn: v.openedOn, dueOn: v.dueOn, verifyDueOn: v.verifyDueOn }, today, { dueOn: true, verifyDueOn: true }).warnings;
}

// ─── À compléter (D8) ───────────────────────────────────────────────────────

/** « À compléter : Source, Site » (champs obligatoires manquants d'une action reprise). */
export function missingSummary(missing: readonly string[]): string | null {
  const labels = missing.map((m) => MISSING_LABELS[m as MissingField] ?? m);
  return labels.length ? `À compléter : ${labels.join(', ')}` : null;
}

// ─── Fil et preuves (§ 9, § 10) ─────────────────────────────────────────────

/** Signature d'un commentaire : « 14/10/2026 à 09:12 · T. Nguyen · Salarié · responsable ». */
export function commentMeta(c: { atLabel: string; author: string; authorRole: string | null; byResponsible: boolean }): string {
  return [c.atLabel, c.author, c.authorRole, c.byResponsible ? 'responsable' : null].filter(Boolean).join(' · ');
}
/** Ancre d'un commentaire dans la fiche (lien d'une preuve vers son commentaire). */
export const commentAnchor = (id: number) => `commentaire-${id}`;
/** Fichiers choisis avant l'envoi : mêmes limites que le serveur (taille, nombre, volume d'un envoi). */
export function pickedFilesError(files: readonly { name: string; size: number }[]): string | null {
  return fileBatchError(files);
}

// ─── Pointage et coûts (§ 11) ──────────────────────────────────────────────

const number2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const euros = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** « 3,5 h » ; vide : « — ». */
export const fmtHours = (n: number | null | undefined) => (n == null ? '—' : `${number2.format(n)} h`);
/** « 1 200,00 € TTC » ; vide : « — ». */
export const fmtEuros = (n: number | null | undefined) => (n == null ? '—' : `${euros.format(n)} € TTC`);
/** Valeur d'un champ numérique du formulaire (vide pour null). */
export const numberField = (n: number | null | undefined) => (n == null ? '' : String(n));

// ─── Données de santé (§ 4, ACT-24) ────────────────────────────────────────

/** Aide de saisie du fil, montrée à tout lecteur qui peut commenter (ACT-24). */
export const NO_HEALTH_REMINDER = 'Aucune donnée de santé ni information médicale : l’action est visible du responsable et de l’encadrement.';
/** Élément lié = accident du travail : même avertissement que la fiche AT (EventEditButton, « Sans détail médical »). */
export const AT_HEALTH_WARNING = 'Action liée à un accident du travail. Sans détail médical : l’action est visible du responsable, de l’encadrement et dans les échéances.';

// ─── Listes des formulaires (clé stockée, libellé) ─────────────────────────

export const PRIORITY_OPTIONS: Option[] = Object.entries(ACTION_PRIORITIES).map(([k, v]) => [k, v.label]);
export const DOMAIN_OPTIONS: Option[] = Object.entries(ACTION_DOMAINS);
export const RISK_LEVEL_OPTIONS: Option[] = ACTION_RISK_LEVELS.map((l, i) => [String(i), l]);
export const VERIFY_METHOD_OPTIONS: Option[] = Object.entries(VERIFY_METHODS);
