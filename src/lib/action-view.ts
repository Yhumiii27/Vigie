// Formes des données du plan d'actions envoyées aux composants (docs/specs/actions-qse.md § 4–16). Types seulement :
// aucune dépendance d'exécution (imports de types), utilisable par les chargements serveur et les composants client.
//
// Contrat du paquet 1 (figé pour les flux parallèles, plan § 2.3, amendé le 15/10/2026) :
//   - ActionListItem : ligne de la vue générale (Liste, Kanban, Par responsable) — jamais de fil, de preuves ni
//     d'historique (QUA-11) ;
//   - ActionDetailView / ActionDetailPayload : fiche, chargée à l'ouverture seulement, avec les droits du lecteur
//     (ActionRights, src/lib/action-rules.ts) ; la vérification n'est montrée qu'à l'état « Vérifiée » (D17) ; pas de
//     marque d'autovérification (ACT-13 : admise sans restriction) ;
//   - ActionCommentView : commentaire signé et daté ; texte d'un commentaire retiré jamais envoyé (body null, D23) ;
//     aucun commentaire automatique (recyclages hors actions QSE, réponses du 15/10/2026) ;
//   - ActionFormOptions / ActionTargetOption / ActionDefaults : listes et valeurs du formulaire d'action, vides pour qui ne
//     peut ni créer ni modifier (création réservée au QHSE, ACT-22) ; `today` toujours fourni par le serveur ; pas de
//     champ « fromScreen » (création QHSE seulement).
// Composants (signatures figées, plan § 2.13) : ActionFields / NewActionButton (src/components/ActionFormDialog.tsx,
// options: ActionFormOptions, defaults?: ActionDefaults) et ActionDetail (src/components/actions/ActionDetail.tsx,
// { detail, rights, options, currentUserId, today, verifyDefault }).

import type { ChangeEntry } from '@/lib/change-entry';
import type { ActionDomain, ActionPriority, Avancement, FollowReason, SourceKey, VerifyMethod } from './action-keys';
import type { ActionRights, ComplementaryLinkKind, KanbanKey } from './action-rules';
import type { AttachmentItem } from './attachments';
import type { AvancementGroup, Tone } from './domain';
import type { Option } from './form-options';

/** Élément lié affiché par la fiche (source, rattachements complémentaires, liens repris). */
export type PlanSource = {
  kind: string; label: string; href: string | null; detail?: string; detachOnAbandon?: boolean;
  /** Lien « kind:args » d'un lien complémentaire (ACT-02 : « Détacher » de la fiche) ; QHSE seulement, sinon absent. */
  link?: string;
};

/** Élément proposé par « Rattacher » de la fiche (ACT-02) : lien complémentaire (COMPLEMENTARY_LINK_KINDS). */
export type LinkTargetOption = { value: string; label: string; kind: ComplementaryLinkKind };

/** Ligne de la vue générale (Liste, Kanban, Par responsable) : jamais de fil, de preuves ni d'historique (QUA-11). */
export type ActionListItem = {
  id: string; label: string; openedOn: string; opened: string;
  status: Avancement; avancement: string; statusLabel: string; tone: Tone; // statusLabel/tone : « En retard »/danger si en retard
  group: AvancementGroup; kanban: KanbanKey | null; late: boolean; lateDays: number; verifyLate: boolean;
  priority: ActionPriority | null; priorityLabel: string | null; domain: ActionDomain | null; domainLabel: string | null;
  source: SourceKey | null; sourceLabel: string; sourceIcon: string; // null → « À compléter », 'ph-question'
  originRef: string;
  siteId: string | null; site: string; siteShort: string; // null → « Site à compléter »
  pilotId: string; pilot: string; pilotInitials: string; pilotLeft: boolean;
  dueOn: string; due: string; initialDueOn: string; rescheduled: boolean;
  verifyDueOn: string | null; verifyDue: string | null;
  doneOn: string | null; closedOn: string | null; cancelledOn: string | null; cancelReason: string | null;
  hours: number | null; estimatedCost: number | null; actualCost: number | null;
  followsActionId: string | null; followReason: FollowReason | null;
  missing: string[]; toComplete: boolean;
  mine: boolean; // responsable = personne connectée
  elsewhere: boolean; // site ≠ site sélectionné (ses propres actions d'autres sites du périmètre)
};

/** Commentaire du fil (ACT-24), daté et signé ; jamais modifié. */
export type ActionCommentView = {
  id: number; authorId: string; author: string; authorRole: string | null; byResponsible: boolean;
  at: string; atLabel: string; // ISO ; « 14/10/2026 à 09:12 » (heure de Paris)
  body: string | null; // null quand retiré : le texte n'est jamais envoyé au navigateur
  withdrawn: { atLabel: string; by: string; reason: string } | null;
  files: AttachmentItem[]; // retiré : vide pour qui n'est pas QHSE, signalées « commentaire retiré » pour le QHSE (D23)
};

/** Fiche (chargée à l'ouverture seulement). */
export type ActionDetailView = ActionListItem & {
  problem: string | null; detail: string; riskLevel: number | null; riskLevelLabel: string | null;
  verifyMethod: VerifyMethod | null; verifyMethodLabel: string | null; efficacyNote: string | null; effective: boolean | null; newRisk: boolean;
  verifiedById: string | null; verifiedBy: string | null; // vérification : montrée à l'état Vérifiée seulement (D17)
  previousVerification: { note: string; by: string | null } | null; // ligne non Vérifiée portant un ancien constat (reprise, D17)
  cancelledBy: string | null;
  legacyOriginLabel: string | null; // indication pour une source « à compléter » (reprise, legacy_origin, D9)
  eventId: string | null; sources: PlanSource[];
  /** Version de la fiche à son ouverture (QUA-12, src/server/versions.ts), renvoyée par le formulaire de modification. */
  version?: string;
  follows: { id: string; label: string; reason: FollowReason } | null;
  followUps: { id: string; label: string; reason: FollowReason; statusLabel: string; tone: Tone }[]; // « Suivie par A-n »
  comments: ActionCommentView[]; files: AttachmentItem[]; // preuves visibles du lecteur (celles d'un commentaire ont commentId ; D23)
  /** « Rattacher » (ACT-02) : éléments rattachables à l'action, QHSE seulement (canLink, site sélectionné) ; sinon vide. */
  linkTargets: LinkTargetOption[];
  history: ChangeEntry[];
  /** Élément lié = accident du travail (§ 4) : calculé seulement pour le QHSE (lecteur qui reçoit les listes du formulaire) ;
   *  toujours false pour les autres lecteurs, pour ne pas révéler la nature de l'événement d'un collègue. */
  healthWarning: boolean;
};
export type ActionDetailPayload = { detail: ActionDetailView; rights: ActionRights };

/** Listes du formulaire d'action ; vides pour qui ne peut ni créer ni modifier (convention isReadOnly ; création : QHSE seulement). */
export type ActionFormOptions = {
  people: readonly Option[]; // personnel actif (loadFormOptions().people)
  sites: readonly Option[]; // writableSites(), jamais « Tous les sites »
  today: string; // today() du serveur (VIGIE_TODAY en démonstration, jour de Paris) : jamais new Date() côté client
  targets?: readonly ActionTargetOption[]; // plan seulement (QHSE) : éléments liables, filtrés par la source choisie
};

/** Élément proposé par le sélecteur du plan (spec § 12, § 13). */
export type ActionTargetOption = {
  value: string; // lien « kind:args »
  label: string; // ≤ 80 caractères
  siteId: string | null; // site proposé quand l'élément est choisi (null : élément commun, le QHSE choisit)
  sources: readonly SourceKey[]; // admissibleSources(kind, facts) ; l'option n'est proposée que pour ces sources (RC / non-RC, piste d'audit…)
  healthWarning?: boolean; // événement de type AT : avertissement « aucune donnée de santé » (§ 4)
  reviewId?: number; // décision de revue : sa revue (« Rattacher » de la fiche écarte les décisions d'une autre revue, AUD-12)
};

/** Valeurs proposées par un écran (création, QHSE seulement) ou valeurs actuelles (modification). */
export type ActionDefaults = {
  id?: string; status?: Avancement; // modification : avancement affiché (envoyé en « from »)
  version?: string; // modification : version de la fiche à son ouverture (QUA-12)
  source?: SourceKey | null; lockSource?: boolean; sourceChoices?: readonly SourceKey[]; // conformes à admissibleSources (D20 révisée)
  link?: string; linkLabel?: string; // élément imposé par l'écran (création seulement)
  originRef?: string;
  domain?: ActionDomain | null; priority?: ActionPriority | null; riskLevel?: number | null;
  problem?: string; detail?: string;
  siteId?: string | null; pilotId?: string; pilotName?: string;
  dueOn?: string; verifyDueOn?: string | null; openedOn?: string;
  doneOn?: string | null; verifyMethod?: VerifyMethod | null; efficacyNote?: string | null;
  hours?: number | null; estimatedCost?: number | null; actualCost?: number | null;
  healthWarning?: boolean;
};
