import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, numeric, pgTable, primaryKey, serial, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
// Chemin relatif : drizzle-kit charge ce fichier sans les alias de tsconfig.
import {
  ACTION_AVANCEMENTS, DOMAIN_KEYS, FOLLOW_REASON_KEYS, PRIORITY_KEYS, REMINDER_SEND_STATUSES, SOURCE_KEYS, VERIFY_METHOD_KEYS, sqlList,
  type ActionDomain, type ActionPriority, type Avancement, type FollowReason, type ReminderSendStatus, type SourceKey, type VerifyMethod,
} from '../lib/action-keys';
import {
  BSD_STATUS_CODES, EVALUATION_CODES, EVENT_STEP_KINDS, EVENT_TYPE_CODES, FINDING_KIND_CODES, PERMIT_STATUS_CODES, PERMIT_TYPE_CODES, PLAN_STATUS_CODES,
  REQUIREMENT_LINK_CODES, REVIEW_DECISION_KIND_CODES, REVIEW_KIND_CODES, REVIEW_STATUS_CODES, VERSION_STATUS_CODES,
} from '../lib/state-keys';

// Conventions de traçabilité (jamais de suppression physique d'un enregistrement métier tracé) :
// - archivage : archivedAt / archivedById / archiveReason (élément retiré du suivi, historique conservé) ;
// - annulation : cancelledAt / cancelledById / cancelReason (saisie annulée, exclue des calculs) ;
// - contraintes en base (QUA-23, migration 0017) : chaque triplet est vide, ou porte une date et un motif non vide
//   (archiveState) ; colonnes d'état texte limitées à leurs valeurs connues (src/lib/state-keys.ts) ;
// - historique des modifications : table change_log (src/server/changelog.ts).

/** Contrainte CHECK « colonne in (liste) » sur des clés constantes (src/lib/action-keys.ts, jamais de saisie). */
const inList = (col: AnyPgColumn, keys: readonly string[]) => sql`${col} in (${sql.raw(sqlList(keys))})`;

/**
 * QUA-23 (migration 0017) : triplet d'archivage, d'annulation ou de classement cohérent — tous vides, ou date et motif non
 * vide (auteur facultatif : reprise, tâche du serveur, auteur anonymisé).
 */
const archiveState = (name: string, at: AnyPgColumn, by: AnyPgColumn, reason: AnyPgColumn) =>
  check(name, sql`(${at} is null and ${by} is null and ${reason} is null) or (${at} is not null and ${reason} is not null and btrim(${reason}) <> '')`);

// ─── Référentiels ────────────────────────────────────────────────────────────

export const sites = pgTable('sites', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  // Classement Seveso (seuil_haut | seuil_bas | null) et règle interne associée :
  // plan de prévention écrit exigé dès la première minute d'intervention d'une entreprise extérieure.
  seveso: text('seveso'),
  ppFromFirstMinute: boolean('pp_from_first_minute').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  // Responsable QHSE du site (« Gérer les sites ») : destinataire des alertes du site et pilote proposé des recyclages.
  // Vacant (ou sorti de l'effectif) : alertes adressées aux animateurs QHSE (people.last_role), « responsable à désigner ».
  qhseLeadId: text('qhse_lead_id').references((): AnyPgColumn => people.id),
  // Identification de l'établissement au registre chronologique des déchets (arrêté du 31 mai 2021) : SIRET, 14 chiffres sans espace.
  siret: text('siret'),
  // Droit local d'Alsace-Moselle : Vendredi saint et 26 décembre fériés (délai de déclaration des AT, EVT-03).
  alsaceMoselle: boolean('alsace_moselle').notNull().default(false),
  // Archivage (site fermé ou cédé) : masqué des sélecteurs, données conservées et visibles sous « Tous les sites ».
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedById: text('archived_by_id').references((): AnyPgColumn => people.id),
  archiveReason: text('archive_reason'),
}, (t) => [
  archiveState('sites_archive_check', t.archivedAt, t.archivedById, t.archiveReason),
]);

// Personnel — saisie manuelle pour l'instant ; Cursus deviendra la source de vérité RH.
// Identifiant généré (jamais dérivé du nom) ; rapprochement Entra ID par objectId, puis par e-mail.
export const people = pgTable('people', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  job: text('job').notNull().default(''),
  siteId: text('site_id').references(() => sites.id), // site de rattachement
  // Suivi dans la matrice des habilitations (salariés de production).
  inSkillsMatrix: boolean('in_skills_matrix').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  // Service / équipe (filtre de la matrice) — repris plus tard du connecteur Cursus.
  service: text('service').notNull().default(''),
  // Sortie de l'effectif : la personne est archivée (jamais supprimée). À partir de cette date, elle n'apparaît plus
  // dans la matrice, les signaux ni les listes de choix ; son nom reste lisible dans l'historique.
  leftOn: date('left_on', { mode: 'string' }),
  leftReason: text('left_reason'),
  // Identité (SEC-03) : objectId Entra ID (oid), e-mail professionnel (unique sans tenir compte de la casse), matricule RH.
  entraObjectId: text('entra_object_id').unique('people_entra_object_id_unique'),
  email: text('email'),
  matricule: text('matricule').unique('people_matricule_unique'),
  // Dernier rôle Vigie connu (rôle applicatif Entra à la dernière connexion) et date de cette connexion.
  lastRole: text('last_role'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
}, (t) => [uniqueIndex('people_email_lower_unique').on(sql`lower(${t.email})`)]);

// Heures travaillées par mois et par site — base du TF1 / TG (source RH).
export const hoursWorked = pgTable('hours_worked', {
  month: date('month', { mode: 'string' }).notNull(),
  siteId: text('site_id').notNull().references(() => sites.id),
  hours: integer('hours').notNull(),
}, (t) => [primaryKey({ columns: [t.month, t.siteId] })]);

// Projets lus depuis Keystone (référentiel pour les listes de choix).
export const keystoneProjects = pgTable('keystone_projects', {
  id: text('id').primaryKey(), // K-2025-042
  client: text('client').notNull(),
  title: text('title').notNull(),
  deliveryOn: date('delivery_on', { mode: 'string' }),
});

// Pièces jointes (photos de signalement, documents maîtrisés, rapports de contrôle…), stockées dans .data/uploads.
export const attachments = pgTable('attachments', {
  id: text('id').primaryKey(), // uuid
  // event | event (health) | action | document_version | control_record | requirement_evaluation | prevention_plan | site_map
  // | qualification | audit_plan_item | certification | requirement | duerp_version | risk | review | review_item | waste_entry
  // (paquet 6 : ajout et retrait motivé par src/server/entity-files.ts) — droit de lecture : canReadAttachment (src/lib/uploads.ts). Preuve
  // d'une action (ACT-25) : entity_type « action », déposée seule ou avec un commentaire (comment_id, D10).
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  storagePath: text('storage_path').notNull(),
  uploadedBy: text('uploaded_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Pièce médicale (certificat, avis d'arrêt, réserves…) : animateur QHSE et direction seulement, refusée par /fichiers aux
  // autres rôles (SEC-06).
  health: boolean('health').notNull().default(false),
  // Preuve déposée avec un commentaire du fil d'une action (ACT-25, D10) ; null : déposée seule ou autre entité.
  commentId: integer('comment_id').references((): AnyPgColumn => actionComments.id),
}, (t) => [
  index('attachments_comment_idx').on(t.commentId),
  // QUA-17 (migration 0018) : pièces d'une fiche (/fichiers, listes de pièces, échéances documentaires).
  index('attachments_entity_idx').on(t.entityType, t.entityId),
]);

// ─── Signalements et événements ─────────────────────────────────────────────

export const events = pgTable('events', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id),
  type: text('type').notNull(), // AT | PA | SD | NC | RC | ENV
  title: text('title').notNull(),
  occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
  location: text('location').notNull(),
  declarant: text('declarant'), // nom affiché (null quand anonyme) — conservé pour les déclarants externes (client…)
  declarantId: text('declarant_id').references(() => people.id), // rapprochement « Mes signalements » (null = anonyme ou externe)
  declarantCompany: text('declarant_company'), // entreprise déclarée par un déclarant externe (signalement sans compte)
  anonymous: boolean('anonymous').notNull().default(false),
  // Canal du signalement terrain (SEC-09) : « session » (personne connectée, nominatif) | « poste » (formulaire public,
  // nominatif déclaré) | « terrain » (signalement anonyme, quel que soit le canal) | null (saisie depuis l'écran Événements
  // ou événement antérieur).
  reportedVia: text('reported_via'),
  keystoneProject: text('keystone_project'),
  equipment: text('equipment'),
  pilotId: text('pilot_id').references(() => people.id),
  severity: integer('severity').notNull(), // gravité potentielle 1–4
  step: integer('step').notNull().default(0), // index dans EVENT_STEPS
  description: text('description').notNull().default(''),
  immediateMeasures: text('immediate_measures').notNull().default(''),
  analysisMethod: text('analysis_method').notNull().default('5m'), // 5m | tree | why | 8d
  ncOrigin: text('nc_origin'), // origine des non-conformités / réclamations
  injury: text('injury'), // AT : arret | sans_arret | soins
  lostDays: integer('lost_days'),
  // AT : date de déclaration à la CPAM (sous 48 h, sauf soins inscrits au registre des accidents bénins).
  cpamDeclaredOn: date('cpam_declared_on', { mode: 'string' }),
  // AT — rubriques de la déclaration d'accident du travail (EVT-01, Cerfa 14463). Données de santé : HEALTH_LABELS (src/components/events/shared.ts).
  victimKind: text('victim_kind'), // salarie | interimaire | externe (VICTIM_KINDS)
  victimId: text('victim_id').references(() => people.id), // victime de l'effectif
  victimName: text('victim_name'), // intérimaire ou personne extérieure : nom déclaré
  victimCompany: text('victim_company'), // entreprise de travail temporaire, ou employeur de la personne extérieure
  occurredTime: text('occurred_time'), // heure des faits « HH:MM » (Europe/Paris), tous types
  workSchedule: text('work_schedule'), // horaire de travail de la victime le jour de l'accident (texte libre)
  // Connaissance de l'accident par l'employeur : départ du délai de 48 h (R. 441-3 CSS) ; null = events.created_at.
  knownAt: timestamp('known_at', { withTimezone: true }),
  activity: text('activity'), // activité de la victime au moment de l'accident
  circumstances: text('circumstances'), // circonstances détaillées (faits, sans donnée médicale)
  witnesses: text('witnesses'), // témoins (nom, entreprise, coordonnées)
  thirdParty: text('third_party'), // tiers impliqué (nom, adresse, assureur) ; vide = aucun
  // Données de santé d'un AT (SEC-06 : animateur QHSE et direction seulement).
  lesionNature: text('lesion_nature'),
  lesionSite: text('lesion_site'),
  careGiven: text('care_given'), // soins dispensés, transport (poste de secours, médecin, urgences…)
  reservesOn: date('reserves_on', { mode: 'string' }), // réserves motivées adressées à la CPAM le (R. 441-6)
  // Déclaration CPAM non faite par l'entreprise (EVT-02) : motif tracé (ETT, tiers, registre papier…) — donnée de santé.
  cpamWaivedAt: timestamp('cpam_waived_at', { withTimezone: true }),
  cpamWaivedById: text('cpam_waived_by_id').references(() => people.id),
  cpamWaiverReason: text('cpam_waiver_reason'),
  // Qualification (EVT-05) : réclamation client, aspect environnemental.
  customer: text('customer'), // RC : client
  customerRef: text('customer_ref'), // RC : référence client (commande, affaire, livraison)
  envAspect: text('env_aspect'), // ENV : ENV_ASPECTS
  envMedium: text('env_medium'), // ENV : ENV_MEDIA
  // Rattachements facultatifs vers les autres modules.
  controlId: integer('control_id').references((): AnyPgColumn => controls.id), // équipement soumis à contrôle périodique
  riskId: integer('risk_id').references((): AnyPgColumn => risks.id), // risque du DUERP concerné (réévaluation)
  documentId: text('document_id').references((): AnyPgColumn => documents.id), // document maîtrisé concerné
  preventionPlanId: text('prevention_plan_id').references((): AnyPgColumn => preventionPlans.id),
  permitId: text('permit_id').references((): AnyPgColumn => permits.id),
  // EVT-19 : zone de la carte du site où l'événement s'est produit (QR code du poste ou choix du formulaire) ; le lieu en
  // texte (`location`) reste affiché. Une zone archivée reste portée par ses événements.
  zoneId: integer('zone_id').references((): AnyPgColumn => mapZones.id),
  // « Classé sans suite » (doublon, faux signalement…) : jamais supprimé, motif obligatoire, exclu des indicateurs.
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  dismissedById: text('dismissed_by_id').references(() => people.id),
  dismissReason: text('dismiss_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // EVT-09 : accident de trajet (AT, L. 411-2 CSS) — déclaré comme un AT (48 h, rubriques de la DAT), exclu du TF1/TG,
  // des jours sans accident et de la pyramide (workforceAccident, src/lib/queries.ts).
  commute: boolean('commute').notNull().default(false),
  // EVT-09 : maladie professionnelle (type MP) — déclarée par la victime à la CPAM (L. 461-5 CSS), instruite par la caisse
  // (R. 461-9) ; événement réservé aux rôles canSeeHealth (loadSiteEvents), champs listés dans HEALTH_LABELS.
  mpTable: text('mp_table'), // tableau des maladies professionnelles (« 57 », « hors tableau »)
  mpDisease: text('mp_disease'), // maladie déclarée
  mpCertificateOn: date('mp_certificate_on', { mode: 'string' }), // certificat médical initial
  mpInformedOn: date('mp_informed_on', { mode: 'string' }), // double de la déclaration reçu de la CPAM le
  mpQuestionnaireReceivedOn: date('mp_questionnaire_received_on', { mode: 'string' }), // questionnaire employeur reçu le
  mpQuestionnaireReturnedOn: date('mp_questionnaire_returned_on', { mode: 'string' }), // questionnaire retourné le (30 jours francs)
  // EVT-17 : traitement d'un produit non conforme (NC, RC ; ISO 9001 §8.7) — NC_DISPOSITIONS, quantité ; coût de non-qualité : nc_cost_keur.
  ncDisposition: text('nc_disposition'),
  ncQuantity: numeric('nc_quantity', { precision: 12, scale: 2, mode: 'number' }),
  ncDispositionNote: text('nc_disposition_note'), // dérogation : accordée par (client, autorité) et conditions
  // Partage avec Keystone (serveur commun EPC2I, Matrix partage/50-vigie.sql ; vue pub_non_conformites, migration 0009).
  // Colonnes prêtes, sans saisie dans Vigie à ce jour : code projet Keystone (D02, keystone.pub_projets.code, à la place
  // du texte libre keystone_project), volet NC de Keystone (D13), fournisseur Keystone (D16). Références croisées en
  // texte, sans clé étrangère vers un autre schéma (contrôle à la saisie, puis contrôle d'orphelins de Matrix).
  keystoneProjectCode: text('keystone_project_code'),
  ncNumber: text('nc_number'), // « NCR-029 », unique par projet Keystone
  keystoneActivityCode: text('keystone_activity_code'), // keystone.pub_activites.code
  partRef: text('part_ref'), // keystone.pub_articles.ref
  keystoneDeliverableNumber: text('keystone_deliverable_number'), // keystone.pub_livrables.number
  supplierId: uuid('supplier_id'), // keystone.pub_fournisseurs.id (origine « Fournisseurs »)
  supplierName: text('supplier_name'), // nom du fournisseur au moment de la saisie
  rootCause: text('root_cause'), // synthèse ; le détail reste dans event_analyses
  ncCostKeur: numeric('nc_cost_keur', { precision: 12, scale: 2, mode: 'number' }), // coût de non-qualité (k€)
  isoClause: text('iso_clause'), // « 8.7 Control of nonconforming outputs »
}, (t) => [
  check('events_nc_quantity_check', sql`${t.ncQuantity} >= 0`),
  check('events_nc_number_check', sql`${t.ncNumber} is null or (${t.ncNumber} ~ '^NCR-[0-9]{3,}$' and ${t.type} = 'NC' and ${t.keystoneProjectCode} is not null)`),
  check('events_nc_cost_keur_check', sql`${t.ncCostKeur} >= 0`),
  index('events_keystone_project_code_idx').on(t.keystoneProjectCode),
  index('events_zone_idx').on(t.zoneId),
  // QUA-17 (migration 0018) : chargements filtrés par site (loadSiteEvents, siteWhere).
  index('events_site_idx').on(t.siteId, t.occurredOn),
  uniqueIndex('events_nc_number_par_projet').on(t.keystoneProjectCode, t.ncNumber).where(sql`${t.ncNumber} is not null`),
  archiveState('events_dismiss_check', t.dismissedAt, t.dismissedById, t.dismissReason),
  check('events_type_check', inList(t.type, EVENT_TYPE_CODES)),
]);

// Contenu de l'analyse des causes, une ligne par méthode et par événement.
export const eventAnalyses = pgTable('event_analyses', {
  eventId: text('event_id').notNull().references(() => events.id),
  method: text('method').notNull(),
  content: jsonb('content').notNull(),
}, (t) => [primaryKey({ columns: [t.eventId, t.method] })]);

// Historique du workflow d'un événement : qui, quand, de → vers, motif (retour arrière, réouverture, classement).
// La déclaration est datée par events.createdAt ; qualification et clôture se déduisent de la dernière ligne « advance ».
export const eventSteps = pgTable('event_steps', {
  id: serial('id').primaryKey(),
  eventId: text('event_id').notNull().references(() => events.id),
  kind: text('kind').notNull(), // advance | revert | reopen | dismiss | restore
  fromStep: integer('from_step').notNull(),
  toStep: integer('to_step').notNull(), // = fromStep pour dismiss / restore
  reason: text('reason'), // obligatoire pour revert, reopen, dismiss, restore
  byId: text('by_id').references(() => people.id),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('event_steps_kind_check', inList(t.kind, EVENT_STEP_KINDS)),
]);

// Registre des accidents du travail bénins (EVT-04, art. L. 441-4 et D. 441-1 à D. 441-4 CSS) : un registre par site
// (établissement), une inscription par AT sans arrêt ni soins médicaux (events.injury = 'soins'), jamais supprimée
// (annulation motivée, numéro non réattribué). Données de santé : animateur QHSE et direction seulement (canSeeHealth).
export const benignAccidents = pgTable('benign_accidents', {
  id: serial('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id), // site du registre (fixé à l'inscription)
  number: integer('number').notNull(), // numéro d'ordre dans le registre du site
  eventId: text('event_id').notNull().references(() => events.id),
  careGivenAt: timestamp('care_given_at', { withTimezone: true }).notNull(),
  caregiverId: text('caregiver_id').references(() => people.id), // secouriste (SST valide) de l'effectif
  caregiverName: text('caregiver_name'), // professionnel de santé déclaré (hors effectif ou non suivi)
  caregiverQualification: text('caregiver_qualification').notNull(), // sst | infirmier | medecin | pharmacien
  care: text('care').notNull(), // soins dispensés
  signedOn: date('signed_on', { mode: 'string' }), // visas de la victime et du donneur de soins recueillis sur le registre papier
  // Arrêt ou soins médicaux ultérieurs connus le : bascule en déclaration CPAM (48 h à compter de cette date).
  escalatedAt: timestamp('escalated_at', { withTimezone: true }),
  escalatedById: text('escalated_by_id').references(() => people.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdById: text('created_by_id').references(() => people.id),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
}, (t) => [
  uniqueIndex('benign_accidents_site_number_unique').on(t.siteId, t.number),
  // Une seule inscription active par événement (une inscription annulée n'empêche pas de réinscrire).
  uniqueIndex('benign_accidents_event_active_unique').on(t.eventId).where(sql`cancelled_at is null`),
  index('benign_accidents_event_idx').on(t.eventId),
  archiveState('benign_accidents_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
]);

// ─── Plan d'actions unique ──────────────────────────────────────────────────

// Modèle du service QHSE (docs/specs/actions-qse.md § 4–5, migration 0005 : ACT-17, ACT-18, ACT-19, ACT-35). Les listes
// (avancement, source, domaine, priorité, nature de vérification, motif de suite) sont des clés de src/lib/action-keys.ts,
// contrôlées par des contraintes CHECK ; « en retard » et « à compléter » sont calculés (src/lib/action-rules.ts). Pas de
// CHECK dépendant de l'avancement ni des dates : les bases reprises en contiennent d'incohérentes (D22, D24), le serveur
// applique ces règles.
export const actions = pgTable('actions', {
  id: text('id').primaryKey(), // « A-n » (formatActionNumber, ACT-35) ; jamais modifié ni réattribué
  openedOn: date('opened_on', { mode: 'string' }).notNull(), // Date (ouverture) : date de Paris à la création, non modifiable
  pilotId: text('pilot_id').notNull().references(() => people.id), // « Responsable » à l'écran
  status: text('status').$type<Avancement>().notNull().default('a_faire'), // avancement (§ 5.1) ; « en retard » est calculé
  priority: text('priority').$type<ActionPriority>(), // null = à compléter (reprise)
  dueOn: date('due_on', { mode: 'string' }).notNull(), // date cible actuelle
  initialDueOn: date('initial_due_on', { mode: 'string' }).notNull(), // date cible initiale, jamais modifiée
  doneOn: date('done_on', { mode: 'string' }), // date effective (passage « Terminée »)
  source: text('source').$type<SourceKey>(), // une des 24 sources (§ 12) ; null = à compléter (reprise) ; verrouillée une fois posée
  originRef: text('origin_ref').notNull(), // référence d'origine (texte) ; libellé quand la source n'a pas de fiche
  eventId: text('event_id').references(() => events.id),
  reviewId: integer('review_id').references((): AnyPgColumn => reviews.id), // revue de direction d'origine (décision, objectif, préparation)
  // Sources d'origine portées par l'action (ACT-01), comme eventId et reviewId : une au plus par type, conservées sur une
  // action abandonnée. Posées à la création (lien explicite de l'écran, ou référence d'origine résolue une fois :
  // src/lib/origin-links.ts) et par la reprise (vigie-db reprise-liens), jamais recalculées ; les écrans sources les lisent.
  // Plans de prévention et permis : liens repris seulement (plus d'action QSE depuis la Prévention, 15/10/2026).
  preventionPlanId: text('prevention_plan_id').references((): AnyPgColumn => preventionPlans.id),
  permitId: text('permit_id').references((): AnyPgColumn => permits.id),
  documentId: text('document_id').references((): AnyPgColumn => documents.id),
  wasteStreamId: text('waste_stream_id').references((): AnyPgColumn => wasteStreams.id),
  wasteEntryId: integer('waste_entry_id').references((): AnyPgColumn => wasteEntries.id), // enlèvement du registre des déchets
  // Habilitation d'une action de recyclage reprise (HAB-04, 0007 : reprise de qualification_requirements.renewal_action_id) :
  // case de la matrice (salarié × titre), conservée sur l'action close ou abandonnée et quand le titre n'est plus requis ;
  // jamais posée par Vigie (aucune action QSE pour un recyclage, 15/10/2026).
  qualificationPersonId: text('qualification_person_id').references(() => people.id),
  qualificationTitleId: text('qualification_title_id').references((): AnyPgColumn => trainingTitles.id),
  domain: text('domain').$type<ActionDomain>(), // null = à compléter (reprise)
  problem: text('problem'), // description du problème (≤ 4 000) ; null = à compléter (reprise)
  detail: text('detail').notNull(), // détail de l'action (≤ 4 000) ; libellé = actionLabel(detail)
  verifyDueOn: date('verify_due_on', { mode: 'string' }), // vérification planifiée (obligatoire à la création)
  closedOn: date('closed_on', { mode: 'string' }), // date de vérification = date de clôture
  verifyMethod: text('verify_method').$type<VerifyMethod>(),
  efficacyNote: text('efficacy_note'), // constat de vérification
  effective: boolean('effective'), // résultat : efficace / non efficace (null tant que non vérifiée)
  newRisk: boolean('new_risk').notNull().default(false), // « Nouveau risque généré »
  verifiedById: text('verified_by_id').references(() => people.id),
  riskLevel: integer('risk_level'), // 0 à 4 (§ 5.4), échelle propre aux actions (≠ cotation G × P du DUERP)
  hours: numeric('hours', { precision: 7, scale: 2, mode: 'number' }), // pointage (h), saisi à la clôture
  estimatedCost: numeric('estimated_cost', { precision: 12, scale: 2, mode: 'number' }), // € TTC
  actualCost: numeric('actual_cost', { precision: 12, scale: 2, mode: 'number' }), // € TTC
  followsActionId: text('follows_action_id').references((): AnyPgColumn => actions.id), // action de suite (ACT-23)
  followReason: text('follow_reason').$type<FollowReason>(),
  siteId: text('site_id').references(() => sites.id), // un seul site, obligatoire à toute création et modification ; null = reprise « site à compléter »
  // Origine Vigie avant 0005 (ev, audit, risk, watch, client, rev, skills, prevention, docs, env) : écrite par la reprise
  // seulement (D9), lue par la reprise des liens (src/lib/origin-links.ts) et comme indication d'une source à compléter.
  legacyOrigin: text('legacy_origin'),
  // Abandon (avancement « abandonnee », jamais de suppression) : qui, quand, pourquoi.
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('actions_status_check', inList(t.status, ACTION_AVANCEMENTS)),
  check('actions_source_check', sql`${t.source} is null or ${inList(t.source, SOURCE_KEYS)}`),
  check('actions_domain_check', sql`${t.domain} is null or ${inList(t.domain, DOMAIN_KEYS)}`),
  check('actions_priority_check', sql`${t.priority} is null or ${inList(t.priority, PRIORITY_KEYS)}`),
  check('actions_verify_method_check', sql`${t.verifyMethod} is null or ${inList(t.verifyMethod, VERIFY_METHOD_KEYS)}`),
  check('actions_follow_reason_check', sql`${t.followReason} is null or ${inList(t.followReason, FOLLOW_REASON_KEYS)}`),
  check('actions_follow_pair_check', sql`(${t.followsActionId} is null) = (${t.followReason} is null)`),
  check('actions_risk_level_check', sql`${t.riskLevel} is null or ${t.riskLevel} between 0 and 4`),
  check('actions_amounts_check', sql`(${t.hours} is null or ${t.hours} >= 0) and (${t.estimatedCost} is null or ${t.estimatedCost} >= 0) and (${t.actualCost} is null or ${t.actualCost} >= 0)`),
  index('actions_pilot_idx').on(t.pilotId),
  // QUA-17 (migration 0018) : chargements filtrés par site (loadAllActions, siteWhere).
  index('actions_site_idx').on(t.siteId),
  index('actions_follows_idx').on(t.followsActionId),
  archiveState('actions_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
]);

// Fil de commentaires daté et signé (ACT-24) : jamais modifié ; retrait motivé, texte conservé en base mais jamais envoyé
// au navigateur (D23).
export const actionComments = pgTable('action_comments', {
  id: serial('id').primaryKey(),
  actionId: text('action_id').notNull().references(() => actions.id),
  authorId: text('author_id').notNull().references(() => people.id),
  authorRole: text('author_role'), // rôle Vigie de l'auteur au moment de l'écriture (« signé »)
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  withdrawnById: text('withdrawn_by_id').references(() => people.id),
  withdrawReason: text('withdraw_reason'),
}, (t) => [
  check('action_comments_body_check', sql`char_length(${t.body}) between 1 and 4000`),
  check('action_comments_withdraw_check', sql`(${t.withdrawnAt} is null) = (${t.withdrawReason} is null)`),
  index('action_comments_action_idx').on(t.actionId, t.createdAt),
]);

// Compteurs de numérotation (ACT-35) : portée → dernier numéro attribué, incrémenté sous verrou dans la transaction de création.
export const actionCounters = pgTable('action_counters', {
  scope: text('scope').primaryKey(),
  last: integer('last').notNull(),
});

// Notifications d'information (ACT-30, ACT-31 ; réutilisables pour TDB-06) : une ligne par destinataire ; lue au clic ou
// par « Tout marquer comme lu ». Pas un enregistrement métier tracé (pas de logChange). Purge (TDB-10,
// src/db/maintenance.ts) : notification lue depuis plus de 365 jours, jamais une non lue.
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  personId: text('person_id').notNull().references(() => people.id),
  type: text('type').notNull(), // action_confiee | action_commentaire | action_preuve | signalement_suite (TDB-06) — libellés : NOTIFICATION_KINDS (src/lib/domain.ts) ; pas de CHECK (types à venir)
  entityType: text('entity_type').notNull(), // action | event (suite d'un signalement, TDB-06)
  entityId: text('entity_id').notNull(),
  title: text('title').notNull(), // « Action A-221 confiée par [C. Lefèvre] : … »
  href: text('href').notNull(), // /actions?action=A-221
  byId: text('by_id').references(() => people.id),
  // Commentaire notifié (action_commentaire, ACT-31) : à son retrait, le titre qui en porte l'extrait est réécrit sans lui
  // (withdrawCommentNotifications, src/server/notify.ts ; D23 : le texte retiré n'est plus jamais envoyé au navigateur).
  commentId: integer('comment_id').references((): AnyPgColumn => actionComments.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (t) => [index('notifications_person_idx').on(t.personId, t.createdAt)]);

// Journal d'envoi du rappel du mercredi par e-mail (ACT-33) : un envoi par personne et par semaine ISO, même après un
// redémarrage ou avec plusieurs instances (clé primaire réclamée par insert … on conflict do nothing). Purge (TDB-10,
// src/db/maintenance.ts) : lignes de plus de 365 jours (seule la semaine en cours est consultée).
export const actionReminderSends = pgTable('action_reminder_sends', {
  personId: text('person_id').notNull().references(() => people.id),
  week: text('week').notNull(), // « 2026-W42 » (isoWeekKey)
  status: text('status').$type<ReminderSendStatus>().notNull(),
  attempts: integer('attempts').notNull().default(1),
  email: text('email'),
  actionCount: integer('action_count').notNull().default(0),
  lateCount: integer('late_count').notNull().default(0),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.personId, t.week] }),
  check('action_reminder_sends_status_check', inList(t.status, REMINDER_SEND_STATUSES)),
  check('action_reminder_sends_week_check', sql`${t.week} ~ '^[0-9]{4}-W[0-9]{2}$'`),
]);

// ─── Évaluation des risques (DUERP) ─────────────────────────────────────────

export const duerpVersions = pgTable('duerp_versions', {
  version: text('version').primaryKey(),
  current: boolean('current').notNull().default(false),
  updatedOn: date('updated_on', { mode: 'string' }).notNull(),
  nextUpdateOn: date('next_update_on', { mode: 'string' }).notNull(),
  retention: text('retention').notNull(),
  validatedById: text('validated_by_id').references(() => people.id),
  cseConsultedOn: date('cse_consulted_on', { mode: 'string' }),
  // DUE-03 : transmission de la version au service de prévention et de santé au travail (L. 4121-3 et R. 4121-4), à chaque
  // mise à jour ; dépôt sur le portail numérique (L. 4121-3-1 V), en attente de l'ouverture du portail.
  spstSentOn: date('spst_sent_on', { mode: 'string' }),
  portalDepositedOn: date('portal_deposited_on', { mode: 'string' }),
  archivedOn: date('archived_on', { mode: 'string' }),
  comment: text('comment'), // objet de la mise à jour de la version
  snapshot: jsonb('snapshot'), // risques figés à l'archivage (null pour les versions antérieures à Vigie)
});

export const workUnits = pgTable('work_units', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  siteId: text('site_id').references(() => sites.id),
  sort: integer('sort').notNull().default(0),
  // Archivage (unité retirée du document unique, sans risque en vigueur) : jamais de suppression, motif conservé.
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedById: text('archived_by_id').references(() => people.id),
  archiveReason: text('archive_reason'),
}, (t) => [
  archiveState('work_units_archive_check', t.archivedAt, t.archivedById, t.archiveReason),
]);

export const risks = pgTable('risks', {
  id: serial('id').primaryKey(),
  unitId: text('unit_id').notNull().references(() => workUnits.id),
  hazard: text('hazard').notNull(),
  situation: text('situation').notNull(),
  gravity: integer('gravity').notNull(),
  probability: integer('probability').notNull(),
  existingMeasures: text('existing_measures').notNull(),
  residualGravity: integer('residual_gravity').notNull(),
  residualProbability: integer('residual_probability').notNull(),
  sort: integer('sort').notNull().default(0),
  // Dernière recotation du risque résiduel (null = jamais recoté depuis Vigie). Comparée à la clôture des actions liées.
  residualReviewedOn: date('residual_reviewed_on', { mode: 'string' }),
  // Archivage (risque retiré du document unique en vigueur) : jamais de suppression, motif, actions et événements conservés.
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedById: text('archived_by_id').references(() => people.id),
  archiveReason: text('archive_reason'),
}, (t) => [
  archiveState('risks_archive_check', t.archivedAt, t.archivedById, t.archiveReason),
]);

export const riskActions = pgTable('risk_actions', {
  riskId: integer('risk_id').notNull().references(() => risks.id),
  actionId: text('action_id').notNull().references(() => actions.id),
}, (t) => [primaryKey({ columns: [t.riskId, t.actionId] }), index('risk_actions_action_idx').on(t.actionId)]);

// Registre des mises à disposition du DUERP (R. 4121-4, DUE-01) : demandes d'accès des salariés, anciens salariés, CSE,
// médecin du travail, inspection du travail, CARSAT…, avec la version communiquée. Jamais supprimée : annulation motivée.
export const duerpAccessRequests = pgTable('duerp_access_requests', {
  id: serial('id').primaryKey(),
  requestedOn: date('requested_on', { mode: 'string' }).notNull(),
  requesterKind: text('requester_kind').notNull(), // DUERP_REQUESTERS (src/lib/domain.ts)
  requesterName: text('requester_name').notNull(), // personne ou organisme demandeur
  siteId: text('site_id').references(() => sites.id), // établissement concerné ; null = tous les sites
  version: text('version').notNull().references(() => duerpVersions.version), // version communiquée (ou demandée)
  communicatedOn: date('communicated_on', { mode: 'string' }), // null = demande en attente
  channel: text('channel'), // DUERP_ACCESS_CHANNELS
  note: text('note'),
  createdById: text('created_by_id').references(() => people.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
}, (t) => [
  archiveState('duerp_access_requests_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
]);

// PAPRIPACT (L. 4121-3-1, DUE-02) : programme annuel de prévention issu du DUERP, un par année ; arrêté à la consultation
// du CSE (lignes figées dans `snapshot`, type ProgramSnapshot de src/lib/data/risks.ts), rouvert seulement avec un motif.
export const preventionPrograms = pgTable('prevention_programs', {
  year: integer('year').primaryKey(),
  duerpVersion: text('duerp_version').notNull().references(() => duerpVersions.version),
  comment: text('comment'), // objet du programme
  cseConsultedOn: date('cse_consulted_on', { mode: 'string' }),
  frozenAt: timestamp('frozen_at', { withTimezone: true }), // null = en préparation
  frozenById: text('frozen_by_id').references(() => people.id),
  snapshot: jsonb('snapshot'), // lignes figées à l'arrêt ; null en préparation
  createdById: text('created_by_id').references(() => people.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Actions du plan d'actions unique retenues au programme : coût estimé (€ HT), ressources et indicateur de résultat,
// pour ces actions seulement. Ligne retirable tant que le programme est en préparation (journal du programme).
export const preventionProgramActions = pgTable('prevention_program_actions', {
  year: integer('year').notNull().references(() => preventionPrograms.year),
  actionId: text('action_id').notNull().references(() => actions.id),
  estimatedCost: numeric('estimated_cost', { precision: 12, scale: 2, mode: 'number' }),
  resources: text('resources'),
  indicator: text('indicator'),
}, (t) => [primaryKey({ columns: [t.year, t.actionId] })]);

// ─── Veille réglementaire et contrôles ──────────────────────────────────────

export const requirements = pgTable('requirements', {
  id: serial('id').primaryKey(),
  text: text('text').notNull(),
  domain: text('domain').notNull(),
  summary: text('summary').notNull(),
  impact: text('impact'), // conséquence opérationnelle mise en avant sur le tableau de bord
  dueOn: date('due_on', { mode: 'string' }),
  dueNote: text('due_note'), // « Permanent », « audit de suivi »…
  evaluation: text('evaluation').notNull(), // conforme | ecart | analyse | a_evaluer
  evaluationNote: text('evaluation_note'),
  lastEvaluatedOn: date('last_evaluated_on', { mode: 'string' }),
  pilotId: text('pilot_id').references(() => people.id),
  featured: boolean('featured').notNull().default(false),
  keystoneProjects: integer('keystone_projects'), // surcharge manuelle du nombre calculé (affectsProjects)
  // L'exigence concerne les projets Keystone livrés après sa date d'application (nombre calculé : concernedCount).
  affectsProjects: boolean('affects_projects').notNull().default(false),
  linkedTo: text('linked_to'), // 'duerp' : échéance et état calculés depuis la version en vigueur du DUERP (écran /risques)
  // VEI-10 : sites où l'exigence s'applique ([] : tous les sites) et lien vers le texte sur Légifrance ; texte joint :
  // attachments 'requirement'.
  siteIds: jsonb('site_ids').$type<string[]>().notNull().default([]),
  legifranceUrl: text('legifrance_url'),
  actionId: text('action_id').references(() => actions.id),
  sort: integer('sort').notNull().default(0),
  // Archivage (« texte abrogé ») : jamais de suppression, motif conservé.
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedById: text('archived_by_id').references(() => people.id),
  archiveReason: text('archive_reason'),
}, (t) => [
  archiveState('requirements_archive_check', t.archivedAt, t.archivedById, t.archiveReason),
  check('requirements_evaluation_check', inList(t.evaluation, EVALUATION_CODES)),
  check('requirements_linked_to_check', sql`${t.linkedTo} is null or ${inList(t.linkedTo, REQUIREMENT_LINK_CODES)}`),
]);

export const controls = pgTable('controls', {
  id: serial('id').primaryKey(),
  siteId: text('site_id').references(() => sites.id),
  equipment: text('equipment').notNull(),
  controlType: text('control_type').notNull(),
  periodMonths: integer('period_months').notNull(),
  organization: text('organization').notNull(),
  responsibleId: text('responsible_id').references(() => people.id),
  lastOn: date('last_on', { mode: 'string' }).notNull(),
  nextOn: date('next_on', { mode: 'string' }).notNull(),
  reserves: text('reserves'),
  sort: integer('sort').notNull().default(0),
  requirementId: integer('requirement_id').references(() => requirements.id), // exigence dont relève le contrôle
  actionId: text('action_id').references(() => actions.id), // action de levée des réserves en cours
  // Archivage (« équipement réformé ») : historique conservé.
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedById: text('archived_by_id').references(() => people.id),
  archiveReason: text('archive_reason'),
  // Code commun de l'équipement avec les moyens d'essais de Crucible (ex. PDE-PIL), publié par la vue pub_controles
  // (migration 0014) ; facultatif, plusieurs contrôles d'un même équipement portent le même code (equipmentCodeError).
  equipmentCode: text('equipment_code'),
}, (t) => [
  // QUA-17 (migration 0018) : chargements filtrés par site (loadControls, siteWhere).
  index('controls_site_idx').on(t.siteId),
  archiveState('controls_archive_check', t.archivedAt, t.archivedById, t.archiveReason),
]);

// Historique des contrôles réalisés (le dernier met à jour controls.lastOn / nextOn / reserves).
export const controlRecords = pgTable('control_records', {
  id: serial('id').primaryKey(),
  controlId: integer('control_id').notNull().references(() => controls.id),
  performedOn: date('performed_on', { mode: 'string' }).notNull(),
  organization: text('organization').notNull(),
  reserves: text('reserves'),
  notes: text('notes'),
  // VEI-11 : résultat du contrôle (CONTROL_RESULTS) ; null pour les saisies antérieures.
  result: text('result'),
  recordedById: text('recorded_by_id').references(() => people.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // État du contrôle avant cet enregistrement (renseigné quand il est devenu le dernier), pour annuler une saisie erronée.
  prevLastOn: date('prev_last_on', { mode: 'string' }),
  prevNextOn: date('prev_next_on', { mode: 'string' }),
  prevReserves: text('prev_reserves'),
  // Annulation d'une saisie erronée (motif obligatoire), à la place d'une suppression.
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
}, (t) => [
  archiveState('control_records_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
]);

// Historique des évaluations de conformité ; la dernière est recopiée dans requirements.evaluation / evaluationNote / lastEvaluatedOn.
// Preuve facultative : attachments.entityType = 'requirement_evaluation'.
export const requirementEvaluations = pgTable('requirement_evaluations', {
  id: serial('id').primaryKey(),
  requirementId: integer('requirement_id').notNull().references(() => requirements.id),
  evaluatedOn: date('evaluated_on', { mode: 'string' }).notNull(),
  evaluation: text('evaluation').notNull(), // conforme | ecart | analyse | a_evaluer
  note: text('note'),
  evaluatedById: text('evaluated_by_id').references(() => people.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // VEI-16 (migration 0019) : évaluation saisie par erreur annulée (motif obligatoire), jamais supprimée ; l'évaluation
  // courante de l'exigence est recalculée d'après les évaluations restantes.
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
}, (t) => [
  check('requirement_evaluations_evaluation_check', inList(t.evaluation, EVALUATION_CODES)),
  archiveState('requirement_evaluations_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
]);

// ─── Habilitations et formations ────────────────────────────────────────────

export const trainingTitles = pgTable('training_titles', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  validityMonths: integer('validity_months').notNull().default(0), // 0 = sans échéance
  sort: integer('sort').notNull().default(0),
  // Titre de secourisme (SST) : ses titulaires valides peuvent donner les soins inscrits au registre des accidents bénins (EVT-04).
  firstAid: boolean('first_aid').notNull().default(false),
  // HAB-10 : titres exigés pour que celui-ci soit valide (CACES avant l'autorisation de conduite, R. 4323-56) et libellé du
  // champ « portée » de ses formations (catégories CACES, indices d'habilitation électrique).
  prerequisiteIds: jsonb('prerequisite_ids').$type<string[]>().notNull().default([]),
  scopeLabel: text('scope_label'),
  // Titre retiré du suivi (historique conservé).
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedById: text('archived_by_id').references(() => people.id),
  archiveReason: text('archive_reason'),
}, (t) => [
  archiveState('training_titles_archive_check', t.archivedAt, t.archivedById, t.archiveReason),
]);

export const qualificationRequirements = pgTable('qualification_requirements', {
  personId: text('person_id').notNull().references(() => people.id),
  titleId: text('title_id').notNull().references(() => trainingTitles.id),
  // Recyclage repris : porté par l'action (actions.qualification_person_id / qualification_title_id, HAB-04).
}, (t) => [primaryKey({ columns: [t.personId, t.titleId] })]);

// Historique des formations suivies : une ligne par formation, jamais écrasée. La qualification en cours d'une case
// de la matrice est la dernière ligne non annulée (obtainedOn desc, puis id desc). Attestation : attachments 'qualification'.
export const qualifications = pgTable('qualifications', {
  id: serial('id').primaryKey(),
  personId: text('person_id').notNull().references(() => people.id),
  titleId: text('title_id').notNull().references(() => trainingTitles.id),
  obtainedOn: date('obtained_on', { mode: 'string' }).notNull(),
  expiresOn: date('expires_on', { mode: 'string' }),
  provider: text('provider'),
  scope: text('scope'), // HAB-10 : catégories ou niveaux obtenus (« 1A, 3, 5 », « B1V, BR »)
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  recordedById: text('recorded_by_id').references(() => people.id),
  // Formation enregistrée par erreur : annulée avec un motif (jamais supprimée) et exclue du calcul de l'état.
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
}, (t) => [
  index('qualifications_person_title_idx').on(t.personId, t.titleId),
  archiveState('qualifications_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
]);

// Affectations lues depuis le planning Keystone.
export const keystoneAssignments = pgTable('keystone_assignments', {
  id: serial('id').primaryKey(),
  personId: text('person_id').notNull().references(() => people.id),
  project: text('project').notNull(),
  activity: text('activity').notNull(),
  startOn: date('start_on', { mode: 'string' }).notNull(),
  endOn: date('end_on', { mode: 'string' }).notNull(),
});

// ─── Audits et certifications ───────────────────────────────────────────────

export const certifications = pgTable('certifications', {
  id: text('id').primaryKey(),
  domain: text('domain').notNull(),
  standard: text('standard').notNull(),
  status: text('status').notNull().default(''), // précision libre (ex. « Déploiement en cours ») ; statut affiché calculé (certificationStatus)
  tone: text('tone').notNull(), // engagement : ok (certifié) | warn (en cours) | off (non engagé)
  note: text('note').notNull(),
  organization: text('organization'), // organisme certificateur
  issuedOn: date('issued_on', { mode: 'string' }), // émission du certificat
  validUntil: date('valid_until', { mode: 'string' }), // fin de validité (fin de cycle)
  sort: integer('sort').notNull().default(0),
  // AUD-08 : suspension du certificat par l'organisme (motif) ; levée par la reprise, cycles et renouvellements au journal.
  suspendedOn: date('suspended_on', { mode: 'string' }),
  suspendedById: text('suspended_by_id').references(() => people.id),
  suspendReason: text('suspend_reason'),
});
// Le prochain audit de suivi n'est pas stocké : élément du programme rattaché (certificationId) non réalisé le plus proche.

export const auditPlanItems = pgTable('audit_plan_items', {
  id: serial('id').primaryKey(),
  year: integer('year').notNull(),
  track: text('track').notNull(), // ligne du programme
  month: integer('month').notNull(), // 1–12
  label: text('label').notNull(),
  plannedOn: date('planned_on', { mode: 'string' }),
  detail: text('detail'), // intitulé repris dans les échéances
  ownerId: text('owner_id').references(() => people.id),
  actionId: text('action_id').references(() => actions.id), // échéance portée par l'action
  done: boolean('done').notNull().default(false),
  doneOn: date('done_on', { mode: 'string' }), // date de réalisation
  auditor: text('auditor'), // auditeur ou organisme (texte libre, peut être externe)
  scope: text('scope'), // périmètre audité
  certificationId: text('certification_id').references(() => certifications.id), // référentiel (audit de certification / de suivi)
  // Revue de direction portée par l'élément (AUD-01) : sa date, sa réalisation et son annulation suivent la revue ; l'élément
  // est verrouillé dans le programme (« Ouvrir la revue »). Au plus un élément par revue.
  reviewId: integer('review_id').references((): AnyPgColumn => reviews.id).unique('audit_plan_items_review_id_unique'),
  // Replanification (AUD-03, « Reporter » avec motif) : première date prévue (sinon le 1er du mois prévu) avant le premier
  // report ; null = jamais replanifié.
  postponedFrom: date('postponed_from', { mode: 'string' }),
  // Annulation (AUD-03) : jamais de suppression ; motif obligatoire ; hors grille, échéances, constats et dossier (liste « Éléments annulés »).
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
}, (t) => [
  archiveState('audit_plan_items_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
]);

export const auditFindings = pgTable('audit_findings', {
  id: serial('id').primaryKey(),
  audit: text('audit').notNull(), // libellé ; recalculé depuis l'élément du programme quand planItemId est renseigné
  planItemId: integer('plan_item_id').references(() => auditPlanItems.id), // audit du programme (null = constat hors programme)
  clause: text('clause'), // exigence ou paragraphe, ex. « §8.2.3 »
  foundOn: date('found_on', { mode: 'string' }), // date du constat
  kind: text('kind').notNull(), // FINDING_KINDS : ecart_majeur | ecart_mineur | observation | piste | point_fort
  text: text('text').notNull(),
  responseDueOn: date('response_due_on', { mode: 'string' }), // AUD-09 : réponse attendue (plan d'actions) au plus tard le
  sort: integer('sort').notNull().default(0),
  // Annulation (constat saisi par erreur ou en double) : jamais de suppression, motif conservé, les actions liées restent au plan.
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
}, (t) => [
  archiveState('audit_findings_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
  check('audit_findings_kind_check', inList(t.kind, FINDING_KIND_CODES)),
]);

// Actions d'un constat d'audit (AUD-28, migration 0016 : reprise de l'ancienne colonne audit_findings.action_id) : un constat
// porte plusieurs actions ; une action ne porte qu'un constat (un seul événement ou élément d'audit par action, posé à sa
// création : EVENT_AUDIT_LOCKED, D20). Rattachement et détachement par le registre (src/lib/action-links.ts, type « finding ») ;
// l'abandon de l'action la détache (ligne supprimée et journalisée, comme risk_actions).
export const findingActions = pgTable('finding_actions', {
  findingId: integer('finding_id').notNull().references(() => auditFindings.id),
  actionId: text('action_id').notNull().references(() => actions.id),
}, (t) => [primaryKey({ columns: [t.findingId, t.actionId] }), index('finding_actions_action_idx').on(t.actionId)]);

// ─── Revue de direction (ISO 9001 §9.3)─────────────────────────────────────

// Une revue par séance : préparation (planifiée), compte rendu (tenue), puis visa de la direction et dossier figé (clôturée).
export const reviews = pgTable('reviews', {
  id: serial('id').primaryKey(),
  reviewOn: date('review_on', { mode: 'string' }).notNull(), // date prévue, puis date de tenue
  kind: text('kind').notNull().default('ordinaire'), // ordinaire | intermediaire
  status: text('status').notNull().default('planifiee'), // planifiee | tenue | cloturee | annulee
  participantIds: jsonb('participant_ids').notNull().default([]), // identifiants de personnes (people.id)
  externalParticipants: text('external_participants'), // participants hors annuaire (CSE, organisme…)
  customerPerception: text('customer_perception'), // perception des clients (§9.3.2 c1)
  resourceNeeds: text('resource_needs'), // besoins en ressources (§9.3.3 c)
  minutes: text('minutes'), // compte rendu / conclusions de la séance
  nextReviewOn: date('next_review_on', { mode: 'string' }),
  recordedById: text('recorded_by_id').references(() => people.id), // saisie du compte rendu
  closedOn: date('closed_on', { mode: 'string' }),
  closedById: text('closed_by_id').references(() => people.id), // visa de la direction
  // Dossier figé : sections arrêtées à la date de la séance (phase « seance », écrite à la première saisie du compte rendu),
  // puis dossier complet au visa (phase « cloture ») ; null pour les revues antérieures à Vigie.
  snapshot: jsonb('snapshot'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  archiveState('reviews_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
  check('reviews_status_check', inList(t.status, REVIEW_STATUS_CODES)),
  check('reviews_kind_check', inList(t.kind, REVIEW_KIND_CODES)),
  check('reviews_cancel_status_check', sql`(${t.status} = 'annulee') = (${t.cancelledAt} is not null)`),
]);

// Éléments d'entrée de la revue (check-list) : fournis par un contributeur, ou par Vigie (source automatique, état calculé).
export const reviewItems = pgTable('review_items', {
  id: serial('id').primaryKey(),
  reviewId: integer('review_id').notNull().references(() => reviews.id),
  label: text('label').notNull(),
  source: text('source').notNull().default('manuel'), // manuel | clé de REVIEW_SOURCES (src/lib/domain.ts)
  done: boolean('done').notNull().default(false), // ignoré pour les sources automatiques (calculé)
  ownerId: text('owner_id').references(() => people.id), // contributeur
  owner: text('owner').notNull().default(''), // contributeur hors annuaire (texte libre, quand ownerId est vide)
  dueOn: date('due_on', { mode: 'string' }), // date de remise attendue
  sort: integer('sort').notNull().default(0),
});

// Décisions, objectifs et besoins en ressources issus de la revue (§9.3.3), transformables en actions.
export const reviewDecisions = pgTable('review_decisions', {
  id: serial('id').primaryKey(),
  reviewId: integer('review_id').notNull().references(() => reviews.id),
  kind: text('kind').notNull(), // decision | objectif | ressource
  text: text('text').notNull(),
  pilotId: text('pilot_id').references(() => people.id),
  dueOn: date('due_on', { mode: 'string' }),
  actionId: text('action_id').references(() => actions.id), // action du plan créée ou rattachée
  sort: integer('sort').notNull().default(0),
  // AUD-36 (migration 0019) : décision abandonnée après la séance (motif obligatoire, jamais retirée) ; affichée barrée.
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
}, (t) => [
  check('review_decisions_kind_check', inList(t.kind, REVIEW_DECISION_KIND_CODES)),
  archiveState('review_decisions_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
]);

// AUD-34 (migration 0019) : rectificatifs d'une revue clôturée. Le dossier figé au visa ne se modifie jamais : un rectificatif
// est un ajout daté, motivé et signé par la direction (mêmes droits que le visa, canSignReview), affiché avec le dossier et à
// l'historique de la revue ; jamais modifié ni supprimé (un rectificatif erroné se corrige par un nouveau rectificatif).
export const reviewCorrections = pgTable('review_corrections', {
  id: serial('id').primaryKey(),
  reviewId: integer('review_id').notNull().references(() => reviews.id),
  text: text('text').notNull(), // correction apportée au dossier (ce qui est rectifié et comment)
  reason: text('reason').notNull(), // motif du rectificatif
  signedById: text('signed_by_id').references(() => people.id),
  signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('review_corrections_review_idx').on(t.reviewId),
  check('review_corrections_text_check', sql`btrim(${t.text}) <> '' and btrim(${t.reason}) <> ''`),
]);

// Objectifs QHSE mesurables (AUD-13, ISO 9001 §6.2 et §9.1) : cible d'un indicateur calculé de Vigie (OBJECTIVE_INDICATORS,
// src/lib/objectives.ts) pour une année ; la valeur atteinte n'est jamais stockée. Décision de revue d'origine facultative.
export const qhseObjectives = pgTable('qhse_objectives', {
  id: serial('id').primaryKey(),
  year: integer('year').notNull(),
  label: text('label').notNull(),
  indicator: text('indicator').notNull(), // clé de OBJECTIVE_INDICATORS
  target: numeric('target', { precision: 12, scale: 2, mode: 'number' }).notNull(),
  siteId: text('site_id').references(() => sites.id), // null : tous les sites
  pilotId: text('pilot_id').references(() => people.id),
  reviewDecisionId: integer('review_decision_id').references(() => reviewDecisions.id),
  sort: integer('sort').notNull().default(0),
  createdById: text('created_by_id').references(() => people.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedById: text('archived_by_id').references(() => people.id),
  archiveReason: text('archive_reason'),
}, (t) => [
  check('qhse_objectives_target_check', sql`${t.target} >= 0`),
  archiveState('qhse_objectives_archive_check', t.archivedAt, t.archivedById, t.archiveReason),
]);

// Contexte du système de management (CNF-05, ISO 9001 §4.1, §4.2, §6.1) : enjeux internes et externes, parties
// intéressées et leurs attentes, risques et opportunités avec leur traitement. Élément commun à l'entreprise.
export const contextItems = pgTable('context_items', {
  id: serial('id').primaryKey(),
  kind: text('kind').notNull(), // CONTEXT_KINDS : enjeu_interne | enjeu_externe | partie_interessee | risque | opportunite
  label: text('label').notNull(),
  detail: text('detail').notNull().default(''), // description, attentes ou exigences pertinentes
  treatment: text('treatment').notNull().default(''), // actions prévues, maîtrise (risques et opportunités)
  sort: integer('sort').notNull().default(0),
  createdById: text('created_by_id').references(() => people.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedById: text('archived_by_id').references(() => people.id),
  archiveReason: text('archive_reason'),
}, (t) => [
  archiveState('context_items_archive_check', t.archivedAt, t.archivedById, t.archiveReason),
]);

// ─── Plans de prévention et permis ──────────────────────────────────────────

export const contractors = pgTable('contractors', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  trade: text('trade').notNull(), // corps de métier
  contactName: text('contact_name'),
  contactPhone: text('contact_phone'),
  contactEmail: text('contact_email'),
  // Entreprise archivée (plus référencée), historique conservé.
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedById: text('archived_by_id').references(() => people.id),
  archiveReason: text('archive_reason'),
  // D16 (Matrix partage/50-vigie.sql) : fournisseur Keystone de l'entreprise (keystone.pub_fournisseurs.id), facultatif,
  // sans unicité (deux agences d'une même société) ; sans saisie dans Vigie à ce jour.
  supplierId: uuid('supplier_id'),
}, (t) => [
  index('contractors_supplier_id_idx').on(t.supplierId),
  archiveState('contractors_archive_check', t.archivedAt, t.archivedById, t.archiveReason),
]);

// Plan de prévention (Code du travail R. 4512-6 à R. 4512-12).
export const preventionPlans = pgTable('prevention_plans', {
  id: text('id').primaryKey(), // PP-2026-014
  siteId: text('site_id').notNull().references(() => sites.id),
  contractorId: text('contractor_id').notNull().references(() => contractors.id),
  title: text('title').notNull(), // nature des travaux
  location: text('location').notNull(),
  startOn: date('start_on', { mode: 'string' }).notNull(),
  endOn: date('end_on', { mode: 'string' }).notNull(),
  estimatedHours: integer('estimated_hours').notNull(), // heures sur 12 mois
  dangerousWork: boolean('dangerous_work').notNull().default(false), // arrêté du 19 mars 1993
  keystoneProject: text('keystone_project'),
  inspectionOn: date('inspection_on', { mode: 'string' }), // inspection commune préalable
  interferenceRisks: text('interference_risks').notNull().default(''),
  measures: text('measures').notNull().default(''),
  // PRV-02 : contenu réglementaire du plan. Informations de l'entreprise extérieure (R. 4511-10), mesures du plan
  // (R. 4512-8, 1° à 5°), postes relevant du suivi individuel renforcé (R. 4512-9). Les sections libres du formulaire importé restent dans form_data.
  eeHeadcount: integer('ee_headcount'), // effectif prévisible de l'entreprise extérieure (null = non renseigné)
  eeSupervisor: text('ee_supervisor').notNull().default(''), // nom et qualification de la personne qui dirige l'intervention
  subcontracting: text('subcontracting').notNull().default(''), // sous-traitants (noms, références) et travaux sous-traités
  dangerousPhases: text('dangerous_phases').notNull().default(''), // R. 4512-8 1° phases dangereuses et moyens spécifiques
  equipment: text('equipment').notNull().default(''), // R. 4512-8 2° matériels, installations, dispositifs (prêtés), entretien
  workerInstructions: text('worker_instructions').notNull().default(''), // R. 4512-8 3° instructions aux travailleurs
  emergencyOrganisation: text('emergency_organisation').notNull().default(''), // R. 4512-8 4° premiers secours, évacuation
  coordination: text('coordination').notNull().default(''), // R. 4512-8 5° coordination, organisation du commandement
  sirPosts: text('sir_posts').notNull().default(''), // R. 4512-9 postes susceptibles de relever du suivi individuel renforcé (postes, jamais de noms)
  status: text('status').notNull(), // brouillon | a_signer | signe | clos | annule
  signedEuOn: date('signed_eu_on', { mode: 'string' }), // entreprise utilisatrice
  signedEeOn: date('signed_ee_on', { mode: 'string' }), // entreprise extérieure
  // PRV-07 : nom et qualité des signataires (R. 4512-7 : plan arrêté et signé par les deux chefs d'entreprise ou leurs représentants).
  signedEuName: text('signed_eu_name'),
  signedEuQuality: text('signed_eu_quality'),
  signedEeName: text('signed_ee_name'),
  signedEeQuality: text('signed_ee_quality'),
  // PRV-01 : date de la première signature complète (EU et EE, la plus tardive des deux). Elle est conservée quand une
  // modification efface les signatures. Null = jamais signé par les deux, ou ligne antérieure (repli dans le code sur les
  // signatures actuelles).
  firstSignedOn: date('first_signed_on', { mode: 'string' }),
  ownerId: text('owner_id').references(() => people.id),
  formData: jsonb('form_data'), // réponses du formulaire importé (voir src/lib/pp-form.ts)
  importedFromId: text('imported_from_id').references(() => attachments.id), // fichier source de l'import
  // Plan annulé (intervention n'ayant pas lieu), motif obligatoire ; seul un brouillon jamais signé peut être supprimé.
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
  // D02 (Matrix partage/50-vigie.sql) : code projet Keystone, lu par vigie.pub_hse_projet ; sans saisie dans Vigie à ce jour.
  keystoneProjectCode: text('keystone_project_code'),
}, (t) => [
  index('prevention_plans_keystone_project_code_idx').on(t.keystoneProjectCode),
  archiveState('prevention_plans_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
  check('prevention_plans_status_check', inList(t.status, PLAN_STATUS_CODES)),
  check('prevention_plans_cancel_status_check', sql`(${t.status} = 'annule') = (${t.cancelledAt} is not null)`),
]);

// Modèles d'import du formulaire de plan de prévention : correspondance entre les champs
// détectés dans le fichier (PDF remplissable, Word, scan) et les champs de Vigie.
export const ppImportTemplates = pgTable('pp_import_templates', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  format: text('format').notNull(), // pdf_form | docx | scan
  signature: text('signature'), // empreinte des champs détectés, pour reconnaître le modèle
  mapping: jsonb('mapping').notNull(), // voir PpImportMapping (src/lib/pp-form.ts)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedById: text('updated_by_id').references(() => people.id),
});

// Consommation de l'API Claude (INT-06) : une ligne par lecture d'un scan par l'import des plans de prévention, posée avant
// l'appel (« en_cours ») puis complétée (jetons, modèle qui a répondu, résultat) ; « cache » : même fichier relu sans appel.
// Plafonds (VIGIE_AI_DAILY_SCANS, VIGIE_AI_MONTHLY_TOKENS) calculés sur cette table. Ni contenu ni nom de fichier : empreinte
// SHA-256 du document seulement. Journal technique, jamais modifié hors de la ligne de l'appel ni exposé dans une vue pub_.
export const aiUsage = pgTable('ai_usage', {
  id: serial('id').primaryKey(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  personId: text('person_id').references(() => people.id),
  feature: text('feature').notNull(), // pp_scan
  model: text('model').notNull(), // modèle demandé
  servedModel: text('served_model'), // modèle qui a répondu (repli côté serveur)
  outcome: text('outcome').notNull(), // en_cours | ok | refus | erreur | cache
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  durationMs: integer('duration_ms'),
  fileHash: text('file_hash'),
}, (t) => [index('ai_usage_at_idx').on(t.at), index('ai_usage_person_idx').on(t.personId, t.at)]);

// Permis de feu, permis d'essai.
export const permits = pgTable('permits', {
  id: text('id').primaryKey(), // PF-2026-031 / PE-2026-008
  type: text('type').notNull(), // feu | essai
  siteId: text('site_id').notNull().references(() => sites.id),
  location: text('location').notNull(),
  description: text('description').notNull(),
  contractorId: text('contractor_id').references(() => contractors.id), // null = intervention interne
  performer: text('performer').notNull(), // intervenant(s)
  issuerId: text('issuer_id').references(() => people.id),
  preventionPlanId: text('prevention_plan_id').references(() => preventionPlans.id),
  keystoneProject: text('keystone_project'),
  validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
  validTo: timestamp('valid_to', { withTimezone: true }).notNull(),
  watchUntil: timestamp('watch_until', { withTimezone: true }), // surveillance après travaux par points chauds
  checklist: jsonb('checklist').notNull().default([]), // [{ label, checked }]
  status: text('status').notNull(), // demande | delivre | clos | annule
  closedAt: timestamp('closed_at', { withTimezone: true }), // instant de clôture ou d'annulation
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'), // motif d'annulation (statut annule)
  // D02 (Matrix partage/50-vigie.sql) : code projet Keystone, lu par vigie.pub_hse_projet ; sans saisie dans Vigie à ce jour.
  keystoneProjectCode: text('keystone_project_code'),
}, (t) => [
  index('permits_keystone_project_code_idx').on(t.keystoneProjectCode),
  check('permits_status_check', inList(t.status, PERMIT_STATUS_CODES)),
  check('permits_type_check', inList(t.type, PERMIT_TYPE_CODES)),
  check('permits_cancel_check', sql`(${t.status} = 'annule') = (${t.cancelReason} is not null and btrim(${t.cancelReason}) <> '') and (${t.status} = 'annule' or ${t.cancelledById} is null)`),
]);

// ─── Documents maîtrisés ────────────────────────────────────────────────────

export const documents = pgTable('documents', {
  id: text('id').primaryKey(), // PR-QHSE-003
  title: text('title').notNull(),
  type: text('type').notNull(), // politique | procedure | instruction | formulaire | enregistrement
  process: text('process').notNull(),
  ownerId: text('owner_id').notNull().references(() => people.id),
  reviewMonths: integer('review_months').notNull().default(36),
  distribution: text('distribution').notNull().default(''), // services / postes destinataires
  siteId: text('site_id').references(() => sites.id), // null = tous sites
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const documentVersions = pgTable('document_versions', {
  id: serial('id').primaryKey(),
  documentId: text('document_id').notNull().references(() => documents.id),
  version: text('version').notNull(), // A, B, C…
  status: text('status').notNull(), // brouillon | en_revue | approuve | archive
  summary: text('summary').notNull().default(''), // objet de la modification
  authorId: text('author_id').references(() => people.id),
  approverId: text('approver_id').references(() => people.id),
  submittedOn: date('submitted_on', { mode: 'string' }),
  approvedOn: date('approved_on', { mode: 'string' }),
  actionId: text('action_id').references(() => actions.id), // action à l'origine de la révision
  // Dernier renvoi en brouillon par l'approbateur (DOC-06) : date et motif, échéance de l'auteur tant que la version
  // n'est pas soumise à nouveau (remis à null à la soumission).
  returnedOn: date('returned_on', { mode: 'string' }),
  returnReason: text('return_reason'),
}, (t) => [
  check('document_versions_status_check', inList(t.status, VERSION_STATUS_CODES)),
]);

// ─── Environnement et déchets ───────────────────────────────────────────────

export const wasteStreams = pgTable('waste_streams', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id),
  label: text('label').notNull(),
  ewcCode: text('ewc_code').notNull(), // code déchet européen, « * » = dangereux
  hazardous: boolean('hazardous').notNull().default(false),
  unit: text('unit').notNull().default('kg'),
  treatmentCode: text('treatment_code').notNull(), // R1–R13 / D1–D15
  channel: text('channel').notNull(), // filière
  collector: text('collector').notNull(),
  destination: text('destination').notNull(), // installation de traitement
  // Valeurs par défaut de la filière, copiées sur chaque enlèvement à son inscription (DOC-02, arrêté du 31 mai 2021).
  // Le déchet contient des polluants organiques persistants (POP, règlement (UE) 2019/1021) : mention « le cas échéant » du registre.
  pop: boolean('pop').notNull().default(false),
  // Qualification du traitement final (hiérarchie de l'art. L. 541-1) : reutilisation | recyclage | valorisation_energetique
  // | autre_valorisation | elimination ; null = à préciser à chaque enlèvement (transit, regroupement : R12, R13, D13, D14, D15).
  qualification: text('qualification'),
  // Collecteur (transporteur proposé par défaut) : SIRET (ou n° de TVA intracommunautaire), adresse, n° de récépissé de déclaration (R. 541-50 à R. 541-53).
  collectorSiret: text('collector_siret'),
  collectorAddress: text('collector_address'),
  collectorReceipt: text('collector_receipt'),
  // Installation de destination : SIRET (ou n° de TVA intracommunautaire) et adresse.
  destinationSiret: text('destination_siret'),
  destinationAddress: text('destination_address'),
  // Filière archivée (DOC-09 : jamais supprimée) : plus proposée pour un nouvel enlèvement, registre et actions conservés.
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedById: text('archived_by_id').references(() => people.id),
  archiveReason: text('archive_reason'),
}, (t) => [
  archiveState('waste_streams_archive_check', t.archivedAt, t.archivedById, t.archiveReason),
]);

// Registre chronologique des déchets sortants.
export const wasteEntries = pgTable('waste_entries', {
  id: serial('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id),
  streamId: text('stream_id').notNull().references(() => wasteStreams.id),
  removedOn: date('removed_on', { mode: 'string' }).notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 2, mode: 'number' }).notNull(),
  // Copies figées à l'inscription : modifier la filière ne réécrit pas le registre.
  ewcCode: text('ewc_code'),
  treatmentCode: text('treatment_code'),
  destination: text('destination'),
  // Mentions de l'arrêté du 31 mai 2021. Copies figées comme ewcCode / destination : copiées de la filière à l'inscription,
  // complétées si vides à l'enregistrement suivant ; null = valeur de la filière (inscriptions antérieures).
  pop: boolean('pop'),
  qualification: text('qualification'),
  destinationSiret: text('destination_siret'),
  destinationAddress: text('destination_address'),
  // Transporteur de cet enlèvement (saisi, par défaut celui du collecteur de la filière).
  transporterSiret: text('transporter_siret'),
  transporterAddress: text('transporter_address'),
  transporterReceipt: text('transporter_receipt'),
  // Adresse de prise en charge lorsqu'elle se distingue de celle de l'établissement (chantier, autre dépôt).
  pickupAddress: text('pickup_address'),
  bsdNumber: text('bsd_number'), // bordereau Trackdéchets (obligatoire pour les déchets dangereux)
  bsdStatus: text('bsd_status'), // BSD_STATUSES : brouillon | emis | collecte | traite | refuse | accepte_partiel
  // DOC-12 : refus (total ou partiel) par l'installation de destination : quantité refusée et motif.
  bsdRefusedQuantity: numeric('bsd_refused_quantity', { precision: 12, scale: 2, mode: 'number' }),
  bsdRefusalReason: text('bsd_refusal_reason'),
  transporter: text('transporter').notNull(),
  notes: text('notes'),
  // Événement à l'origine de l'enlèvement (déversement éliminé en déchet dangereux…), facultatif.
  eventId: text('event_id').references(() => events.id),
  // Annulation tracée (R. 541-43 : registre conservé 3 ans, aucune suppression physique).
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
}, (t) => [
  archiveState('waste_entries_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
  check('waste_entries_bsd_status_check', sql`${t.bsdStatus} is null or ${inList(t.bsdStatus, BSD_STATUS_CODES)}`),
]);

export const consumptions = pgTable('consumptions', {
  siteId: text('site_id').notNull().references(() => sites.id),
  month: date('month', { mode: 'string' }).notNull(),
  kind: text('kind').notNull(), // electricite | gaz | eau
  value: numeric('value', { precision: 12, scale: 2, mode: 'number' }).notNull(),
}, (t) => [primaryKey({ columns: [t.siteId, t.month, t.kind] })]);

// ─── Carte du site et coactivité ────────────────────────────────────────────

// Plan de masse par site ; coordonnées des objets normalisées 0–1 sur l'image du plan.
export const siteMaps = pgTable('site_maps', {
  siteId: text('site_id').primaryKey().references(() => sites.id),
  attachmentId: text('attachment_id').references(() => attachments.id), // null = plan schématique par défaut
  width: integer('width').notNull(), // dimensions naturelles de l'image (px)
  height: integer('height').notNull(),
  metersPerUnit: numeric('meters_per_unit', { precision: 12, scale: 4, mode: 'number' }), // échelle : mètres pour 1 unité normalisée en largeur
  proximityMeters: integer('proximity_meters').notNull().default(15), // distance de coactivité
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mapZones = pgTable('map_zones', {
  id: serial('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id),
  name: text('name').notNull(),
  kind: text('kind').notNull(), // batiment | atelier | stockage | atex | essais | quai | parking | exterieur | autre
  polygon: jsonb('polygon').notNull(), // [[x, y], …] normalisés
  notes: text('notes'),
  // Version du QR code de poste (signée dans le jeton) : l'incrémenter révoque les QR codes déjà imprimés.
  qrVersion: integer('qr_version').notNull().default(1),
  // EVT-19 : zone archivée (jamais supprimée : ses événements la gardent, son QR code imprimé ouvre le formulaire terrain
  // avec « ce poste n'existe plus, choisissez le lieu »). Retirée de la carte, des postes et de la coactivité ; journal
  // de la carte du site (`site_map`).
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedById: text('archived_by_id').references(() => people.id),
  archiveReason: text('archive_reason'),
}, (t) => [
  archiveState('map_zones_archive_check', t.archivedAt, t.archivedById, t.archiveReason),
]);

// Voies de circulation (accès) ; « shared » = voie commune à plusieurs équipes.
export const mapRoutes = pgTable('map_routes', {
  id: serial('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id),
  name: text('name').notNull(),
  kind: text('kind').notNull(), // vehicules | pietons | mixte | engins
  polyline: jsonb('polyline').notNull(), // [[x, y], …] normalisés
  shared: boolean('shared').notNull().default(true),
  notes: text('notes'),
});

// Activités localisées (équipes internes et entreprises extérieures) servant à l'analyse de coactivité.
export const siteActivities = pgTable('site_activities', {
  id: serial('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id),
  title: text('title').notNull(),
  team: text('team').notNull(), // interne | externe
  contractorId: text('contractor_id').references(() => contractors.id),
  ownerId: text('owner_id').references(() => people.id), // responsable interne / donneur d'ordre
  preventionPlanId: text('prevention_plan_id').references(() => preventionPlans.id),
  permitId: text('permit_id').references(() => permits.id),
  keystoneProject: text('keystone_project'),
  zoneId: integer('zone_id').references(() => mapZones.id),
  geometry: jsonb('geometry'), // { type: 'point', at: [x, y] } | { type: 'polygon', points: [[x, y], …] }
  startOn: date('start_on', { mode: 'string' }).notNull(),
  endOn: date('end_on', { mode: 'string' }).notNull(),
  hours: text('hours'), // plage horaire libre, ex. « 7 h 30 – 12 h »
  routeIds: jsonb('route_ids').notNull().default([]), // voies empruntées pour accéder à la zone
  vehicles: boolean('vehicles').notNull().default(false), // véhicules ou engins en circulation
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Activité annulée (PRV-12 : jamais supprimée) : retirée de la carte et de la coactivité, historique conservé.
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
  // D02 (Matrix partage/50-vigie.sql) : code projet Keystone ; sans saisie dans Vigie à ce jour.
  keystoneProjectCode: text('keystone_project_code'),
}, (t) => [
  index('site_activities_keystone_project_code_idx').on(t.keystoneProjectCode),
  archiveState('site_activities_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
]);

// Situation de coactivité maîtrisée (PRV-10) : paire d'activités de la carte (clé « a-b » de detectConflicts, la plus
// petite d'abord) dont les mesures sont prises ; elle n'est plus signalée (badge, échéances) tant que la maîtrise n'est pas
// levée. Jamais supprimée : levée avec un motif (cancelled_*), une seule maîtrise en cours par paire. Journal : carte du
// site (`site_map`, identifiant du site). Aucune action QSE (prévention : actions immédiates, réponses du 15/10/2026).
export const coactivityControls = pgTable('coactivity_controls', {
  id: serial('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id),
  pairKey: text('pair_key').notNull(),
  activityA: integer('activity_a').notNull().references(() => siteActivities.id),
  activityB: integer('activity_b').notNull().references(() => siteActivities.id),
  measure: text('measure').notNull(), // mesure prise (balisage, décalage horaire, consignes communes…)
  controlledById: text('controlled_by_id').references(() => people.id),
  controlledAt: timestamp('controlled_at', { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
}, (t) => [
  uniqueIndex('coactivity_controls_active_pair').on(t.siteId, t.pairKey).where(sql`${t.cancelledAt} is null`),
  check('coactivity_controls_pair_check', sql`${t.activityA} < ${t.activityB}`),
  archiveState('coactivity_controls_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
]);

// ─── Traçabilité et notifications ───────────────────────────────────────────

// Journal des modifications des fiches principales (qui, quand, quoi, motif) : écrit par logChange (src/server/changelog.ts).
export const changeLog = pgTable('change_log', {
  id: serial('id').primaryKey(),
  entityType: text('entity_type').notNull(), // event | action | risk | requirement | control | prevention_plan | site | …
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(), // create | update | status | cancel | archive | restore | link | unlink | delete | …
  summary: text('summary').notNull(), // phrase affichée (« Échéance reportée au 20/10 »)
  reason: text('reason'), // motif saisi (annulation, archivage, réouverture…)
  details: jsonb('details'), // [{ field, from, to }] facultatif
  byId: text('by_id').references(() => people.id),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('change_log_entity_idx').on(t.entityType, t.entityId)]);

// Journal des consultations (SEC-11), distinct du journal des modifications : fichier servi par /fichiers (`fichier`,
// entité de la pièce), données de santé d'un accident du travail affichées (`sante`, event) et registre des accidents
// bénins ouvert (`registre_benin`, site). Écrit par logAccess (src/server/access-log.ts), une entrée par personne, nature
// et élément sur une fenêtre de quelques minutes ; lu par les seuls rôles habilités aux données de santé. Durée de
// conservation : à fixer avec le DPO (SEC-10).
export const accessLog = pgTable('access_log', {
  id: serial('id').primaryKey(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  personId: text('person_id').references(() => people.id),
  kind: text('kind').notNull(), // fichier | sante | registre_benin
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  /** Pièce consultée (attachments.id) pour un fichier ; null sinon. */
  attachmentId: text('attachment_id'),
  /** Pièce médicale (attachments.health) : consultation d'une donnée de santé. */
  health: boolean('health').notNull().default(false),
}, (t) => [index('access_log_entity_idx').on(t.entityType, t.entityId), index('access_log_person_idx').on(t.personId, t.at)]);

// État « lu » des échéances calculées (clé stable todoKey) et du rappel du mercredi, par personne. Les échéances ne sont
// pas stockées : seules les clés lues le sont (ouverture d'une échéance, « Tout marquer comme lu »). Purge (TDB-10,
// purgeReadStates de src/db/maintenance.ts, maintenance horaire) : clé lue depuis plus de 365 jours, état lu d'un rappel
// du mercredi de plus de 14 jours ; une échéance encore présente redevient alors non lue.
export const notificationReads = pgTable('notification_reads', {
  personId: text('person_id').notNull().references(() => people.id),
  itemKey: text('item_key').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.personId, t.itemKey] })]);

// Limite de débit du signalement sans compte (/signaler avec jeton de poste) : compteur par fenêtre fixe.
// `key` : identifiant haché, préfixé par sa nature (« ip:… », « jeton:… ») ; lignes anciennes purgées par window_start.
export const reportRateLimits = pgTable('report_rate_limits', {
  key: text('key').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  hits: integer('hits').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.key, t.windowStart] }), index('report_rate_limits_window_idx').on(t.windowStart)]);
