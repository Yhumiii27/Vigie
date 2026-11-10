import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, numeric, pgTable, primaryKey, serial, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
// Chemin relatif : drizzle-kit charge ce fichier sans les alias de tsconfig.
import {
  ACTION_AVANCEMENTS, DOMAIN_KEYS, FOLLOW_REASON_KEYS, PRIORITY_KEYS, REMINDER_SEND_STATUSES, SOURCE_KEYS, VERIFY_METHOD_KEYS, sqlList,
  type ActionDomain, type ActionPriority, type Avancement, type FollowReason, type ReminderSendStatus, type SourceKey, type VerifyMethod,
} from '../lib/action-keys';
import {
  AUDIT_KIND_CODES, BSD_STATUS_CODES, CONTROL_CATEGORY_CODES, EVALUATION_CODES, EVENT_STEP_KINDS, EVENT_TYPE_CODES, FINDING_KIND_CODES,
  MEASURE_LINK_KIND_CODES, PERMIT_STATUS_CODES, PERMIT_TYPE_CODES, PLAN_MEETING_KIND_CODES, PLAN_STATUS_CODES, REQUIREMENT_LINK_CODES,
  REVIEW_DECISION_KIND_CODES, REVIEW_KIND_CODES, REVIEW_STATUS_CODES, SAFETY_NOTICE_KIND_CODES,
  CHANGE_KIND_CODES, CHANGE_STATUS_CODES, STUDY_CONCLUSION_CODES, STUDY_MILESTONE_CODES, STUDY_STATUS_CODES, STUDY_TYPE_CODES,
  ASSIGNMENT_SOURCE_CODES, CURSUS_PERSON_STATE_CODES, CURSUS_TITLE_STATE_CODES, MATRIX_STATE_CODES, PERSON_CATEGORY_CODES, SYNC_STATUS_CODES,
  INBOUND_KIND_CODES, INBOUND_RESULT_CODES, INBOUND_STATUS_CODES,
  ENGINEERING_INBOUND_KIND_CODES, ECO_TYPE_CODES, ECO_STATUS_CODES, ENGINEERING_SOURCE_CODES, ECR_KIND_CODES, ECR_SUBJECT_CODES, ECR_STATUS_CODES,
  ECO_APPROVAL_KEY_CODES, ECO_DECISION_CODES, ECO_APPROVAL_VIA_CODES, EFFECTIVITY_TARGET_CODES, EFFECTIVITY_DISPOSITION_CODES,
  OUTBOUND_STATUS_CODES, OUTBOUND_TARGET_CODES, OUTBOUND_KIND_CODES,
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
  // D14 de Matrix, décision CV-09 (03/11/2026, migration 0024) : l'identifiant d'un site EST son code commun
  // (matrix.sites.code, motif ^[a-z][a-z0-9_]{1,31}$, jamais « all ») ; plus de colonne code distincte. La table est un
  // cache de matrix.pub_sites (src/server/foreign-sync.ts) : libellé et ordre rafraîchis depuis la vue, attributs ci-dessus
  // propres à Vigie. Un site n'est créé qu'en choisissant un site de la vue non encore suivi (src/server/sites.ts).
  // État lu dans Matrix au dernier rafraîchissement : actif | ferme (actif = false) | absent (plus dans la vue) ; null =
  // jamais lu (base antérieure, source indisponible). Signal « fermé dans Matrix » : loadSiteSignals.
  matrixState: text('matrix_state'),
}, (t) => [
  archiveState('sites_archive_check', t.archivedAt, t.archivedById, t.archiveReason),
  check('sites_matrix_state_check', inList(t.matrixState, MATRIX_STATE_CODES)),
]);

// Personnel — cache de cursus.pub_salaries (D01, décision CV-10) : Cursus est la source de vérité RH.
// Identifiant généré (jamais dérivé du nom) ; rapprochement Entra ID par objectId, puis par e-mail.
export const people = pgTable('people', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  job: text('job').notNull().default(''),
  siteId: text('site_id').references(() => sites.id, { onUpdate: 'cascade' }), // site de rattachement
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
  // D01 de Matrix, décision CV-10 (03/11/2026, migration 0030) : une fiche qui porte un matricule est un cache de
  // cursus.pub_salaries (src/server/foreign-sync.ts : nom, poste, site, sortie et, contrat D01 v2, catégorie, entreprise,
  // e-mail), jamais saisi dans Vigie. Fiche sans matricule (saisie avant D01, ou créée à la première connexion Entra) :
  // « à rattacher » par le QHSE (attachPerson, src/server/people.ts). État lu au dernier rafraîchissement : actif | absent
  // (plus dans la vue : jamais supprimée, signal au QHSE) ; null = jamais lu (pas de matricule, source indisponible).
  cursusState: text('cursus_state'),
  // Catégorie publiée par Cursus (salarie | interimaire | exterieur ; PERSON_CATEGORIES) et agence ou entreprise extérieure.
  category: text('category'),
  company: text('company'),
  // Adresse professionnelle publiée par Cursus (donnée personnelle : jamais au journal du serveur ni dans sync_runs) ;
  // rapprochement d'un compte Entra à la première connexion (src/lib/auth/person.ts), avant l'e-mail de la fiche.
  cursusEmail: text('cursus_email'),
  // Matricule de site publié par Cursus (lot 14 de Cursus, colonne `matricule_site` en fin du contrat D01 v2, migration
  // 0031) : « I… » pour un intérimaire, « E… » pour un salarié d'entreprise extérieure, permanent, jamais réattribué ; null
  // pour un salarié. Clé de rapprochement des présences prévues (poste de garde) quand Cursus les publie par ce matricule.
  // Jamais effacé par le rafraîchissement (valeur publiée vide ou colonne absente : valeur gardée).
  siteMatricule: text('site_matricule'),
  // Fiche créée par le rafraîchissement, sans historique propre, dont le matricule a été repris par la fiche ancienne de la
  // même personne (attachPerson) : sortie de l'effectif, conservée (jamais supprimée), hors des fiches « à rattacher ».
  replacedById: text('replaced_by_id').references((): AnyPgColumn => people.id),
}, (t) => [
  uniqueIndex('people_email_lower_unique').on(sql`lower(${t.email})`),
  check('people_cursus_state_check', inList(t.cursusState, CURSUS_PERSON_STATE_CODES)),
  check('people_category_check', inList(t.category, PERSON_CATEGORY_CODES)),
  uniqueIndex('people_site_matricule_unique').on(t.siteMatricule).where(sql`${t.siteMatricule} is not null`),
  check('people_site_matricule_check', sql`${t.siteMatricule} ~ '^[IE][0-9]+$'`),
]);

// Heures travaillées par mois et par site — base du TF1 / TG (source RH).
export const hoursWorked = pgTable('hours_worked', {
  month: date('month', { mode: 'string' }).notNull(),
  siteId: text('site_id').notNull().references(() => sites.id, { onUpdate: 'cascade' }),
  hours: integer('hours').notNull(),
}, (t) => [primaryKey({ columns: [t.month, t.siteId] })]);


// Pièces jointes (photos de signalement, documents maîtrisés, rapports de contrôle…), stockées dans .data/uploads.
export const attachments = pgTable('attachments', {
  id: text('id').primaryKey(), // uuid
  // event | event (health) | action | document_version (fichiers d'avant Codex, migration 0028 : gardés, non servis) | control_record | requirement_evaluation | prevention_plan | site_map
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
  siteId: text('site_id').notNull().references(() => sites.id, { onUpdate: 'cascade' }),
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
  // AT — rubriques de la déclaration d'accident du travail (EVT-01, Cerfa 14463). Données de santé : HEALTH_LABELS (src/lib/rules/events.ts).
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
  // Document de Codex concerné (identifiant de Codex, lot 4 de M-02 : sans clé étrangère, contrôlé contre codex.pub_documents à la saisie).
  documentId: text('document_id'),
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
  // Numéro de la NC vu par Keystone (décision CV-07 du 04/11/2026) : la référence EV-… de l'événement, recopiée en base
  // (déclencheur events_nc_number, migration 0026) pour toute NC portant un code projet, null sinon ; lue par la vue
  // pub_non_conformites (colonne number, qui ne publie que les NC numérotées). Jamais saisie ni écrite par le code.
  ncNumber: text('nc_number'),
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
  check('events_nc_number_check', sql`${t.ncNumber} is null or (${t.ncNumber} = ${t.id} and ${t.type} = 'NC' and ${t.keystoneProjectCode} is not null)`),
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
  // D13 (CV-08) : étape franchie à la demande d'un autre outil (Keystone), traitée par Vigie ; by_id vide.
  inboundRequestId: integer('inbound_request_id').references((): AnyPgColumn => inboundRequests.id),
}, (t) => [
  check('event_steps_kind_check', inList(t.kind, EVENT_STEP_KINDS)),
]);

// Registre des accidents du travail bénins (EVT-04, art. L. 441-4 et D. 441-1 à D. 441-4 CSS) : un registre par site
// (établissement), une inscription par AT sans arrêt ni soins médicaux (events.injury = 'soins'), jamais supprimée
// (annulation motivée, numéro non réattribué). Données de santé : animateur QHSE et direction seulement (canSeeHealth).
export const benignAccidents = pgTable('benign_accidents', {
  id: serial('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onUpdate: 'cascade' }), // site du registre (fixé à l'inscription)
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
  id: text('id').primaryKey(), // « AC-AANNNN » (formatActionNumber, ACT-36) ; anciens « A-n » (ACT-35) gardés ; jamais modifié ni réattribué
  openedOn: date('opened_on', { mode: 'string' }).notNull(), // Date (ouverture) : date de Paris à la création, non modifiable
  pilotId: text('pilot_id').notNull().references(() => people.id), // « Responsable » à l'écran
  status: text('status').$type<Avancement>().notNull().default('a_faire'), // avancement (§ 5.1) ; « en retard » est calculé
  priority: text('priority').$type<ActionPriority>(), // null = à compléter (reprise)
  dueOn: date('due_on', { mode: 'string' }).notNull(), // date cible actuelle
  initialDueOn: date('initial_due_on', { mode: 'string' }).notNull(), // date cible initiale, jamais modifiée
  doneOn: date('done_on', { mode: 'string' }), // date effective (passage « Terminée »)
  source: text('source').$type<SourceKey>(), // une des 25 sources (§ 12) ; null = à compléter (reprise) ; verrouillée une fois posée
  originRef: text('origin_ref').notNull(), // référence d'origine (texte) ; libellé quand la source n'a pas de fiche
  eventId: text('event_id').references(() => events.id),
  reviewId: integer('review_id').references((): AnyPgColumn => reviews.id), // revue de direction d'origine (décision, objectif, préparation)
  // Sources d'origine portées par l'action (ACT-01), comme eventId et reviewId : une au plus par type, conservées sur une
  // action abandonnée. Posées à la création (lien explicite de l'écran, ou référence d'origine résolue une fois :
  // src/lib/origin-links.ts) et par la reprise (vigie-db reprise-liens), jamais recalculées ; les écrans sources les lisent.
  // Plans de prévention et permis : liens repris seulement (plus d'action QSE depuis la Prévention, 15/10/2026).
  preventionPlanId: text('prevention_plan_id').references((): AnyPgColumn => preventionPlans.id),
  permitId: text('permit_id').references((): AnyPgColumn => permits.id),
  // Document de Codex d'origine (identifiant de Codex depuis le lot 4 de M-02, sans clé étrangère).
  documentId: text('document_id'),
  wasteStreamId: text('waste_stream_id').references((): AnyPgColumn => wasteStreams.id),
  wasteEntryId: integer('waste_entry_id').references((): AnyPgColumn => wasteEntries.id), // enlèvement du registre des déchets
  // VG-02 (migration 0023) : étude de sécurité des procédés dont l'action est une recommandation (source « HAZOP »), posée à
  // la création seulement, comme les autres sources d'origine ; réserve bloquante du jalon (modifiable par le QHSE depuis la
  // fiche de l'étude, journalisée sur l'étude et l'action). Une réserve bloquante ouverte empêche le franchissement du jalon.
  safetyStudyId: text('safety_study_id').references((): AnyPgColumn => processSafetyStudies.id),
  safetyStudyBlocking: boolean('safety_study_blocking').notNull().default(false),
  // Habilitation d'une action de recyclage reprise (HAB-04, 0007 : reprise de qualification_requirements.renewal_action_id) :
  // case de la matrice (salarié × titre), conservée sur l'action close ou abandonnée et quand le titre n'est plus requis ;
  // jamais posée par Vigie (aucune action QSE pour un recyclage, 15/10/2026).
  qualificationPersonId: text('qualification_person_id').references(() => people.id),
  qualificationTitleId: text('qualification_title_id').references((): AnyPgColumn => trainingTitles.id, { onUpdate: 'cascade' }),
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
  siteId: text('site_id').references(() => sites.id, { onUpdate: 'cascade' }), // un seul site, obligatoire à toute création et modification ; null = reprise « site à compléter »
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
  index('actions_safety_study_idx').on(t.safetyStudyId),
  check('actions_safety_study_blocking_check', sql`not ${t.safetyStudyBlocking} or ${t.safetyStudyId} is not null`),
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
  // Risques figés à la validation de la version (consultation du CSE, DUE-10, réponse du service QHSE du 09/11/2026), sinon à
  // son archivage ; null pour la version en vigueur non validée et pour les versions antérieures à Vigie.
  snapshot: jsonb('snapshot'),
});

// DUE-10 (migration 0032) : commentaires ajoutés à une version du DUERP, notamment après sa validation par le CSE (contenu
// alors figé) ; jamais modifiés ni supprimés, journal de la version (`duerp_version`, action « comment »).
export const duerpVersionComments = pgTable('duerp_version_comments', {
  id: serial('id').primaryKey(),
  version: text('version').notNull().references(() => duerpVersions.version),
  body: text('body').notNull(),
  authorId: text('author_id').references(() => people.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('duerp_version_comments_version_idx').on(t.version),
  check('duerp_version_comments_body_check', sql`length(btrim(${t.body})) > 0`),
]);

export const workUnits = pgTable('work_units', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  siteId: text('site_id').references(() => sites.id, { onUpdate: 'cascade' }),
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

// DUE-19 (migration 0020) : mesures de maîtrise d'un risque liées à un élément de Vigie — contrôle périodique, document
// maîtrisé ou titre d'habilitation (une seule cible par ligne, celle de `kind`). La validité est calculée à l'affichage
// (riskMeasureState, src/lib/risk-measures.ts), jamais stockée : une mesure qui n'est plus valide (contrôle dépassé ou
// défavorable, document sans version approuvée ou à revoir, habilitation expirée sur le site) est signalée. Retrait motivé
// (removed_*), jamais supprimé ; une seule liaison en cours par risque et par élément. Journal du risque (`risk`).
export const riskMeasureLinks = pgTable('risk_measure_links', {
  id: serial('id').primaryKey(),
  riskId: integer('risk_id').notNull().references(() => risks.id),
  kind: text('kind').notNull(), // MEASURE_LINK_KINDS : control | document | title
  controlId: integer('control_id').references((): AnyPgColumn => controls.id),
  documentId: text('document_id'), // identifiant de Codex (lot 4 de M-02), sans clé étrangère
  titleId: text('title_id').references((): AnyPgColumn => trainingTitles.id, { onUpdate: 'cascade' }),
  createdById: text('created_by_id').references(() => people.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  removedAt: timestamp('removed_at', { withTimezone: true }),
  removedById: text('removed_by_id').references(() => people.id),
  removeReason: text('remove_reason'),
}, (t) => [
  check('risk_measure_links_kind_check', inList(t.kind, MEASURE_LINK_KIND_CODES)),
  check('risk_measure_links_target_check', sql`(${t.kind} = 'control') = (${t.controlId} is not null) and (${t.kind} = 'document') = (${t.documentId} is not null) and (${t.kind} = 'title') = (${t.titleId} is not null)`),
  archiveState('risk_measure_links_remove_check', t.removedAt, t.removedById, t.removeReason),
  index('risk_measure_links_risk_idx').on(t.riskId),
  uniqueIndex('risk_measure_links_control_active').on(t.riskId, t.controlId).where(sql`${t.removedAt} is null and ${t.controlId} is not null`),
  uniqueIndex('risk_measure_links_document_active').on(t.riskId, t.documentId).where(sql`${t.removedAt} is null and ${t.documentId} is not null`),
  uniqueIndex('risk_measure_links_title_active').on(t.riskId, t.titleId).where(sql`${t.removedAt} is null and ${t.titleId} is not null`),
]);

// Situations d'urgence (CNF-08, migration 0021, ISO 45001 §8.2, ISO 14001 §8.2) : situation identifiée par site (incendie,
// déversement, accident grave…), scénario, moyens et consignes, périodicité des exercices et responsable ; prochain exercice
// planifié facultatif. Archivage motivé (jamais supprimée). Journal `emergency_situation`. Échéance : exercice à organiser
// (loadEmergencySignals).
export const emergencySituations = pgTable('emergency_situations', {
  id: serial('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onUpdate: 'cascade' }),
  label: text('label').notNull(),
  scenario: text('scenario').notNull().default(''),
  response: text('response').notNull().default(''), // moyens d'intervention et consignes
  drillMonths: integer('drill_months').notNull(), // périodicité des exercices (mois)
  nextDrillOn: date('next_drill_on', { mode: 'string' }), // exercice planifié le (facultatif)
  ownerId: text('owner_id').references(() => people.id),
  createdById: text('created_by_id').references(() => people.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedById: text('archived_by_id').references(() => people.id),
  archiveReason: text('archive_reason'),
}, (t) => [
  check('emergency_situations_drill_months_check', sql`${t.drillMonths} between 1 and 60`),
  archiveState('emergency_situations_archive_check', t.archivedAt, t.archivedById, t.archiveReason),
  index('emergency_situations_site_idx').on(t.siteId),
]);

// Études de sécurité des procédés (VG-01 à VG-05, demande d'Arche du 01/11/2026, migration 0023 ; CNF-12 à CNF-14) : une
// étude par jalon DIG-PRODI d'un CAPEX de filiale (code « CPX-… » d'Arche) ou d'un projet EPC2i (code Keystone), sur le site
// de l'usine. Référence « ES-001 » (nextEntityReference). Statut stocké planifiee | realisee | validee ; « annulee » calculé
// (annulation motivée, jamais supprimée). Validée : date de validation et conclusion obligatoires (contrainte). Animateur :
// une personne (facilitator_id) ou un intervenant extérieur (facilitator_external). Rapport : référence Codex (texte).
// Recommandations : actions QSE rattachées (actions.safety_study_id). Journal `process_safety_study`. Aucune vue `pub_` ici :
// Matrix définit `vigie.pub_etudes_securite` sur ces tables (décision M-18), d'après la requête de référence de
// docs/specs/etudes-securite.md. Échéance : séance passée d'une étude encore planifiée (loadProcessSafetySignals).
export const processSafetyStudies = pgTable('process_safety_studies', {
  id: text('id').primaryKey(), // « ES-001 », jamais réattribué
  siteId: text('site_id').notNull().references(() => sites.id, { onUpdate: 'cascade' }),
  capexCode: text('capex_code'), // code CAPEX d'Arche (arche.pub_capex.code), saisi
  keystoneProjectCode: text('keystone_project_code'), // code projet Keystone (keystone.pub_projets.code), saisi
  milestone: text('milestone').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull().default('planifiee'),
  sessionOn: date('session_on', { mode: 'string' }).notNull(), // séance prévue (planifiée) ou tenue
  validatedOn: date('validated_on', { mode: 'string' }),
  conclusion: text('conclusion'),
  facilitatorId: text('facilitator_id').references(() => people.id),
  facilitatorExternal: text('facilitator_external'),
  reportRef: text('report_ref'), // référence Codex du rapport
  scope: text('scope').notNull().default(''), // périmètre et objet de l'étude
  createdById: text('created_by_id').references(() => people.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
}, (t) => [
  check('process_safety_studies_milestone_check', inList(t.milestone, STUDY_MILESTONE_CODES)),
  check('process_safety_studies_type_check', inList(t.type, STUDY_TYPE_CODES)),
  check('process_safety_studies_status_check', inList(t.status, STUDY_STATUS_CODES)),
  check('process_safety_studies_conclusion_check', sql`${t.conclusion} is null or ${inList(t.conclusion, STUDY_CONCLUSION_CODES)}`),
  // Un type → un jalon (studyTypeError, src/lib/rules/process-safety.ts).
  check('process_safety_studies_type_milestone_check', sql`(${t.type} = 'hazid' and ${t.milestone} = 'HS2') or (${t.type} in ('hazop', 'amdec') and ${t.milestone} = 'HS3') or (${t.type} = 'controle_chantier' and ${t.milestone} = 'HS4') or (${t.type} in ('pssr', 'rspdi') and ${t.milestone} = 'PSSR') or (${t.type} = 'aspd' and ${t.milestone} = 'HS6')`),
  check('process_safety_studies_link_check', sql`${t.capexCode} is not null or ${t.keystoneProjectCode} is not null`),
  check('process_safety_studies_capex_code_check', sql`${t.capexCode} is null or ${t.capexCode} ~ '^CPX-[A-Z0-9][A-Z0-9-]{0,39}$'`),
  check('process_safety_studies_validated_check', sql`(${t.status} = 'validee' and ${t.validatedOn} is not null and ${t.conclusion} is not null) or (${t.status} <> 'validee' and ${t.validatedOn} is null and ${t.conclusion} is null)`),
  check('process_safety_studies_facilitator_check', sql`${t.facilitatorId} is null or ${t.facilitatorExternal} is null`),
  archiveState('process_safety_studies_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
  index('process_safety_studies_site_idx').on(t.siteId),
  index('process_safety_studies_capex_idx').on(t.capexCode),
  index('process_safety_studies_project_idx').on(t.keystoneProjectCode),
]);

// Exercices d'une situation d'urgence (CNF-08) : date, participants, déroulement et enseignements. Annulation motivée.
export const emergencyDrills = pgTable('emergency_drills', {
  id: serial('id').primaryKey(),
  situationId: integer('situation_id').notNull().references(() => emergencySituations.id),
  heldOn: date('held_on', { mode: 'string' }).notNull(),
  participants: text('participants').notNull().default(''),
  findings: text('findings').notNull().default(''), // déroulement, écarts et enseignements
  createdById: text('created_by_id').references(() => people.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
}, (t) => [
  index('emergency_drills_situation_idx').on(t.situationId, t.heldOn),
  archiveState('emergency_drills_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
]);

// Registre des mises à disposition du DUERP (R. 4121-4, DUE-01) : demandes d'accès des salariés, anciens salariés, CSE,
// médecin du travail, inspection du travail, CARSAT…, avec la version communiquée. Jamais supprimée : annulation motivée.
export const duerpAccessRequests = pgTable('duerp_access_requests', {
  id: serial('id').primaryKey(),
  requestedOn: date('requested_on', { mode: 'string' }).notNull(),
  requesterKind: text('requester_kind').notNull(), // DUERP_REQUESTERS (src/lib/domain.ts)
  requesterName: text('requester_name').notNull(), // personne ou organisme demandeur
  siteId: text('site_id').references(() => sites.id, { onUpdate: 'cascade' }), // établissement concerné ; null = tous les sites
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
  // VEI-18 (migration 0020) : périodicité de réévaluation de la conformité propre à l'exigence (mois) ; null = 12 mois
  // (REQUIREMENT_REVIEW_MONTHS, requirementReviewMonths de src/lib/domain.ts).
  reviewMonths: integer('review_months'),
  // VEI-12 (migration 0020) : certification dont l'exigence reprend l'état (linkedTo 'certification' seulement).
  certificationId: text('certification_id').references((): AnyPgColumn => certifications.id),
  // Archivage (« texte abrogé ») : jamais de suppression, motif conservé.
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedById: text('archived_by_id').references(() => people.id),
  archiveReason: text('archive_reason'),
}, (t) => [
  archiveState('requirements_archive_check', t.archivedAt, t.archivedById, t.archiveReason),
  check('requirements_evaluation_check', inList(t.evaluation, EVALUATION_CODES)),
  check('requirements_linked_to_check', sql`${t.linkedTo} is null or ${inList(t.linkedTo, REQUIREMENT_LINK_CODES)}`),
  check('requirements_review_months_check', sql`${t.reviewMonths} is null or ${t.reviewMonths} between 1 and 60`),
  check('requirements_certification_check', sql`(${t.certificationId} is null) = (${t.linkedTo} is null or ${t.linkedTo} <> 'certification')`),
]);

export const controls = pgTable('controls', {
  id: serial('id').primaryKey(),
  siteId: text('site_id').references(() => sites.id, { onUpdate: 'cascade' }),
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
  // VEI-14 (migration 0020) : nature du contrôle (CONTROL_CATEGORIES) — vérification réglementaire, ou étalonnage d'un
  // équipement de mesure (métrologie, ISO 9001 §7.1.5) ; tolérance (erreur maximale tolérée) saisie librement. Hors de la
  // vue pub_controles (contrat Crucible v1 inchangé).
  category: text('category').notNull().default('reglementaire'),
  tolerance: text('tolerance'),
}, (t) => [
  // QUA-17 (migration 0018) : chargements filtrés par site (loadControls, siteWhere).
  index('controls_site_idx').on(t.siteId),
  archiveState('controls_archive_check', t.archivedAt, t.archivedById, t.archiveReason),
  check('controls_category_check', inList(t.category, CONTROL_CATEGORY_CODES)),
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
  // VEI-14 (migration 0020) : non-conformité ouverte par un étalonnage hors tolérance (événement NC créé avec l'enregistrement).
  eventId: text('event_id').references((): AnyPgColumn => events.id),
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

// Registre de sécurité (VEI-15, L. 4711-1 et L. 4711-2, migration 0020) : observations et mises en demeure reçues de
// l'inspection du travail, de la CARSAT ou d'un organisme de contrôle, par site, avec le délai de mise en conformité et la
// réponse apportée (date et texte). Imprimé avec les vérifications du site (/veille/registre-securite). Jamais supprimée :
// annulation motivée (saisie erronée). Journal : `safety_notice`. Échéance : réponse attendue (loadWatchSignals).
export const safetyNotices = pgTable('safety_notices', {
  id: serial('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onUpdate: 'cascade' }),
  kind: text('kind').notNull(), // SAFETY_NOTICE_KINDS : observation | mise_en_demeure
  receivedOn: date('received_on', { mode: 'string' }).notNull(),
  authority: text('authority').notNull(), // inspection du travail, CARSAT, organisme agréé…
  reference: text('reference'), // référence du courrier ou du rapport
  text: text('text').notNull(), // objet : observations ou prescriptions
  dueOn: date('due_on', { mode: 'string' }), // délai de mise en conformité ou de réponse
  controlId: integer('control_id').references((): AnyPgColumn => controls.id), // équipement concerné (facultatif)
  answeredOn: date('answered_on', { mode: 'string' }), // réponse apportée (mise en conformité, courrier) le
  answer: text('answer'),
  answeredById: text('answered_by_id').references(() => people.id),
  createdById: text('created_by_id').references(() => people.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
}, (t) => [
  check('safety_notices_kind_check', inList(t.kind, SAFETY_NOTICE_KIND_CODES)),
  check('safety_notices_answer_check', sql`(${t.answeredOn} is null) = (${t.answer} is null)`),
  archiveState('safety_notices_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
  index('safety_notices_site_idx').on(t.siteId, t.receivedOn),
]);

// ─── Habilitations et formations ────────────────────────────────────────────

// D08 de Matrix (migration 0025, décision CV-01 du 04/11/2026) : cache du catalogue des titres de Cursus (vue
// cursus.pub_titres), une ligne = titre suivi par Vigie dans sa matrice ; `id` = titre_id de Cursus (« habilitation.he »,
// « formation.sst »…). Intitulé et validité rafraîchis par src/server/foreign-sync.ts seulement (jamais saisis) ; suivi,
// « ne plus suivre » (archivage motivé) et attributs propres au QHSE (CV-03) saisis dans Vigie.
export const trainingTitles = pgTable('training_titles', {
  id: text('id').primaryKey(),
  // libelle_court de Cursus.
  label: text('label').notNull(),
  // validite_mois de Cursus ; 0 = sans échéance (NULL dans la vue).
  validityMonths: integer('validity_months').notNull().default(0),
  sort: integer('sort').notNull().default(0),
  // Titre de secourisme (SST) : ses titulaires valides peuvent donner les soins inscrits au registre des accidents bénins (EVT-04).
  firstAid: boolean('first_aid').notNull().default(false),
  // Libellé de l'ancienne « portée » des formations (HAB-10) : gardé en attendant la confirmation de CV-04 (portée non
  // publiée par Cursus, plus affichée ni saisie).
  scopeLabel: text('scope_label'),
  // HAB-13 (migration 0020) : action de sensibilisation (ISO 45001 §7.3 : accueil sécurité, causerie, consignes) plutôt
  // qu'une formation qualifiante.
  awareness: boolean('awareness').notNull().default(false),
  // AUD-27 (migration 0021) : titre qui qualifie un auditeur interne (formation d'auditeur ISO 19011…) ; l'auditeur interne
  // d'un audit du programme sans titre valide de ce type est signalé (jamais refusé).
  internalAuditor: boolean('internal_auditor').notNull().default(false),
  // État du titre dans le catalogue de Cursus au dernier rafraîchissement (null : jamais lu).
  cursusState: text('cursus_state'),
  // Titre qui n'est plus suivi (historique conservé).
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedById: text('archived_by_id').references(() => people.id),
  archiveReason: text('archive_reason'),
}, (t) => [
  archiveState('training_titles_archive_check', t.archivedAt, t.archivedById, t.archiveReason),
  check('training_titles_cursus_state_check', inList(t.cursusState, CURSUS_TITLE_STATE_CODES)),
]);

// Titres requis par salarié (HAB-03), saisis dans Vigie ; les titres détenus sont lus dans cursus.pub_titres_detenus
// (D09, jointure par people.matricule et training_titles.id, src/lib/foreign/cursus.ts) : plus de table qualifications ni
// training_sessions depuis la migration 0025.
export const qualificationRequirements = pgTable('qualification_requirements', {
  personId: text('person_id').notNull().references(() => people.id),
  titleId: text('title_id').notNull().references(() => trainingTitles.id, { onUpdate: 'cascade' }),
  // Recyclage repris : porté par l'action (actions.qualification_person_id / qualification_title_id, HAB-04).
}, (t) => [primaryKey({ columns: [t.personId, t.titleId] })]);

// D04 de Matrix (migration 0024) : cache de keystone.pub_affectations (rotations de chantier et affectations du planning),
// rafraîchi par src/server/foreign-sync.ts seulement (jamais saisi) ; une ligne par affectation de la vue (affectation_id,
// clé de la vue) dont le salarié est rattaché par people.matricule et qui finit il y a moins d'un an. `project` recomposé
// « code · client » pour l'affichage ; `project_code` = keystone.pub_projets.code. Lu par loadSkillMatrix (alerte
// d'habilitation sur une affectation). Lignes d'une base antérieure (affectation_id vide) : remplacées au rafraîchissement.
export const keystoneAssignments = pgTable('keystone_assignments', {
  id: serial('id').primaryKey(),
  personId: text('person_id').notNull().references(() => people.id),
  project: text('project').notNull(),
  activity: text('activity').notNull(),
  startOn: date('start_on', { mode: 'string' }).notNull(),
  endOn: date('end_on', { mode: 'string' }).notNull(),
  affectationId: text('affectation_id').unique('keystone_assignments_affectation_id_unique'),
  source: text('source'),
  projectCode: text('project_code'),
}, (t) => [
  check('keystone_assignments_source_check', inList(t.source, ASSIGNMENT_SOURCE_CODES)),
]);

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
  // AUD-22 (migration 0021) : site couvert par le certificat ; null = commun à l'entreprise (certificat multisite).
  siteId: text('site_id').references((): AnyPgColumn => sites.id, { onUpdate: 'cascade' }),
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
  auditor: text('auditor'), // auditeur ou organisme externe (texte libre) ; auditeur interne : auditorId
  // AUD-27 (migration 0021) : auditeur interne (personne de l'annuaire) ; `auditor` reste le texte d'un auditeur externe.
  auditorId: text('auditor_id').references(() => people.id),
  scope: text('scope'), // périmètre audité
  // AUD-22 (migration 0021) : site audité ; null = commun à l'entreprise (lu et écrit selon la règle de site, requireInSite).
  siteId: text('site_id').references(() => sites.id, { onUpdate: 'cascade' }),
  // AUD-20 (migration 0021) : audit hors programme (non planifié : audit client, inopiné…) enregistré comme un vrai audit,
  // déjà réalisé (date, auditeur, rapport, constats) ; hors échéances du programme.
  unplanned: boolean('unplanned').notNull().default(false),
  // D08-5 (migration 0032) : type d'audit (AUDIT_KIND_CODES) — terrain, ISO de certification, ISO blanc, revue de processus,
  // revue de direction (déduite de ses mots), autre ; éléments existants : type déduit par la migration (inferAuditKind).
  auditKind: text('audit_kind').notNull().default('autre'),
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
  check('audit_plan_items_audit_kind_check', inList(t.auditKind, AUDIT_KIND_CODES)),
  check('audit_plan_items_unplanned_check', sql`not ${t.unplanned} or (${t.done} and ${t.doneOn} is not null and ${t.reviewId} is null)`),
]);

// AUD-24 (migration 0021) : ligne du programme masquée pour une année (ligne reprise de l'année précédente, sans élément en
// vigueur cette année) ; motif obligatoire, « Afficher à nouveau » motivé (journal `audit_plan_track`). Les lignes restent
// déduites des éléments (audit_plan_items.track) ; une ligne renommée l'est sur les éléments de l'année.
export const auditPlanTracks = pgTable('audit_plan_tracks', {
  id: serial('id').primaryKey(),
  year: integer('year').notNull(),
  track: text('track').notNull(),
  hiddenAt: timestamp('hidden_at', { withTimezone: true }),
  hiddenById: text('hidden_by_id').references(() => people.id),
  hideReason: text('hide_reason'),
}, (t) => [
  uniqueIndex('audit_plan_tracks_year_track').on(t.year, t.track),
  archiveState('audit_plan_tracks_hide_check', t.hiddenAt, t.hiddenById, t.hideReason),
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
  // AUD-22 (migration 0021) : site du constat — celui de son audit (imposé quand planItemId est renseigné), sinon choisi ;
  // null = commun à l'entreprise.
  siteId: text('site_id').references(() => sites.id, { onUpdate: 'cascade' }),
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
  siteId: text('site_id').references(() => sites.id, { onUpdate: 'cascade' }), // null : tous les sites
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

// Gestion des changements (CNF-11, migration 0021, ISO 9001 §6.3 et §8.5.6, ISO 45001 §8.1.3) : demande de changement
// (organisation, procédé, équipement, produit, exigence), motif, effets évalués (risques, ressources, exigences), décision
// motivée du service QHSE (acceptée ou refusée), puis mise en œuvre constatée. Site concerné, ou null pour l'entreprise.
// Jamais supprimée : annulation motivée. Journal `change_request` ; échéances (loadChangeSignals).
export const changeRequests = pgTable('change_requests', {
  id: text('id').primaryKey(), // MC-001 (nextEntityReference, portée « ref:MC- »)
  siteId: text('site_id').references(() => sites.id, { onUpdate: 'cascade' }),
  kind: text('kind').notNull(), // CHANGE_KINDS
  title: text('title').notNull(),
  description: text('description').notNull(),
  rationale: text('rationale').notNull().default(''), // motif du changement
  impacts: text('impacts').notNull().default(''), // effets évalués : risques et opportunités, ressources, exigences, documents
  pilotId: text('pilot_id').references(() => people.id),
  plannedOn: date('planned_on', { mode: 'string' }), // mise en œuvre prévue le
  status: text('status').notNull().default('demandee'), // CHANGE_STATUS : demandee | acceptee | refusee | realisee
  decidedOn: date('decided_on', { mode: 'string' }),
  decidedById: text('decided_by_id').references(() => people.id),
  decisionNote: text('decision_note'),
  doneOn: date('done_on', { mode: 'string' }),
  doneNote: text('done_note'),
  createdById: text('created_by_id').references(() => people.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
}, (t) => [
  check('change_requests_kind_check', inList(t.kind, CHANGE_KIND_CODES)),
  check('change_requests_status_check', inList(t.status, CHANGE_STATUS_CODES)),
  check('change_requests_decision_check', sql`(${t.status} = 'demandee') = (${t.decidedOn} is null)`),
  check('change_requests_done_check', sql`(${t.status} = 'realisee') = (${t.doneOn} is not null)`),
  archiveState('change_requests_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
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
  siteId: text('site_id').notNull().references(() => sites.id, { onUpdate: 'cascade' }),
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
  // PRV-17 (migration 0020) : périodicité (jours) des inspections et réunions de coordination pendant l'intervention
  // (R. 4513-2) ; null = non fixée. Séances : prevention_plan_meetings.
  meetingPeriodDays: integer('meeting_period_days'),
  // PRV-21 (migration 0032) : mesures immédiates prises après un écart R. 4512-6, saisies à la clôture du plan (exigées
  // quand un écart est constaté, startGap) ; null = clos sans écart ou avant la règle.
  gapMeasures: text('gap_measures'),
}, (t) => [
  index('prevention_plans_keystone_project_code_idx').on(t.keystoneProjectCode),
  check('prevention_plans_meeting_period_check', sql`${t.meetingPeriodDays} is null or ${t.meetingPeriodDays} between 1 and 365`),
  archiveState('prevention_plans_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
  check('prevention_plans_status_check', inList(t.status, PLAN_STATUS_CODES)),
  check('prevention_plans_cancel_status_check', sql`(${t.status} = 'annule') = (${t.cancelledAt} is not null)`),
]);

// PRV-17 (migration 0020) : inspections et réunions périodiques de coordination tenues pendant l'intervention (R. 4513-2),
// pour les interventions longues (contrat annuel). Annulation motivée d'une saisie erronée, jamais supprimée ; journal du
// plan (`prevention_plan`). Prochaine séance due : nextPeriodicMeeting (src/lib/rules/prevention.ts), calculée.
export const preventionPlanMeetings = pgTable('prevention_plan_meetings', {
  id: serial('id').primaryKey(),
  planId: text('plan_id').notNull().references(() => preventionPlans.id),
  kind: text('kind').notNull(), // PLAN_MEETING_KINDS : inspection | reunion
  heldOn: date('held_on', { mode: 'string' }).notNull(),
  participants: text('participants').notNull().default(''), // participants des deux entreprises (texte libre)
  notes: text('notes').notNull().default(''), // constats, mesures décidées
  recordedById: text('recorded_by_id').references(() => people.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
}, (t) => [
  check('prevention_plan_meetings_kind_check', inList(t.kind, PLAN_MEETING_KIND_CODES)),
  archiveState('prevention_plan_meetings_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
  index('prevention_plan_meetings_plan_idx').on(t.planId, t.heldOn),
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
  siteId: text('site_id').notNull().references(() => sites.id, { onUpdate: 'cascade' }),
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

// ─── Documents (Codex) ──────────────────────────────────────────────────────

// Lot 4 de M-02 (D10, décision CV-05 du 05/11/2026, migration 0028) : les documents sont tenus par Codex et lus dans ses
// vues publiées (src/lib/foreign/codex.ts) ; les tables documents, document_versions et document_reviews sont supprimées.
// Reste à Vigie le rattachement d'une action du plan à une révision d'un document de Codex (lien complémentaire
// « docversion » du registre src/lib/action-links.ts, ancienne colonne document_versions.action_id) : une action par
// révision (élément à action unique), identifiant de Codex en texte, sans clé étrangère vers un autre outil.
export const documentActions = pgTable('document_actions', {
  codexId: text('codex_id').notNull(),
  revision: text('revision').notNull(), // lettre de la révision (A, B…)
  actionId: text('action_id').notNull().references(() => actions.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.codexId, t.revision] }),
  index('document_actions_action_idx').on(t.actionId),
  check('document_actions_revision_check', sql`btrim(${t.revision}) <> ''`),
]);

// ─── Environnement et déchets ───────────────────────────────────────────────

export const wasteStreams = pgTable('waste_streams', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onUpdate: 'cascade' }),
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
  siteId: text('site_id').notNull().references(() => sites.id, { onUpdate: 'cascade' }),
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
  siteId: text('site_id').notNull().references(() => sites.id, { onUpdate: 'cascade' }),
  month: date('month', { mode: 'string' }).notNull(),
  kind: text('kind').notNull(), // electricite | gaz | eau
  value: numeric('value', { precision: 12, scale: 2, mode: 'number' }).notNull(),
}, (t) => [primaryKey({ columns: [t.siteId, t.month, t.kind] })]);

// ─── Carte du site et coactivité ────────────────────────────────────────────

// Plan de masse par site ; coordonnées des objets normalisées 0–1 sur l'image du plan.
export const siteMaps = pgTable('site_maps', {
  siteId: text('site_id').primaryKey().references(() => sites.id, { onUpdate: 'cascade' }),
  attachmentId: text('attachment_id').references(() => attachments.id), // null = plan schématique par défaut
  width: integer('width').notNull(), // dimensions naturelles de l'image (px)
  height: integer('height').notNull(),
  metersPerUnit: numeric('meters_per_unit', { precision: 12, scale: 4, mode: 'number' }), // échelle : mètres pour 1 unité normalisée en largeur
  proximityMeters: integer('proximity_meters').notNull().default(15), // distance de coactivité
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mapZones = pgTable('map_zones', {
  id: serial('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onUpdate: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind').notNull(), // batiment | atelier | stockage | atex | essais | quai | parking | exterieur | autre
  polygon: jsonb('polygon').notNull(), // [[x, y], …] normalisés
  notes: text('notes'),
  // Version du QR code de poste (signée dans le jeton) : l'incrémenter révoque les QR codes déjà imprimés.
  qrVersion: integer('qr_version').notNull().default(1),
  // DUE-20 (migration 0020) : unité de travail du DUERP couverte par la zone (une unité par zone, plusieurs zones par unité) ;
  // ses risques sont proposés au signalement par le QR code du poste. Choisie dans la fiche de l'unité (/risques).
  workUnitId: text('work_unit_id').references((): AnyPgColumn => workUnits.id),
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
  siteId: text('site_id').notNull().references(() => sites.id, { onUpdate: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind').notNull(), // vehicules | pietons | mixte | engins
  polyline: jsonb('polyline').notNull(), // [[x, y], …] normalisés
  shared: boolean('shared').notNull().default(true),
  notes: text('notes'),
});

// Activités localisées (équipes internes et entreprises extérieures) servant à l'analyse de coactivité.
export const siteActivities = pgTable('site_activities', {
  id: serial('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onUpdate: 'cascade' }),
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
  siteId: text('site_id').notNull().references(() => sites.id, { onUpdate: 'cascade' }),
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

// Lot 0 de M-02 (migration 0024) : journal des rafraîchissements des caches lus chez les autres outils (sites de Matrix,
// affectations de Keystone) et des lectures directes contrôlées (projets, fournisseurs). Une ligne par source et par
// passage (démarrage, tâche planifiée, bouton « Actualiser ») ; aucune donnée personnelle (nombres et message technique).
// Lu par l'onglet « Connecteurs » de « Gérer les sites » (src/lib/data/connectors.ts).
export const syncRuns = pgTable('sync_runs', {
  id: serial('id').primaryKey(),
  source: text('source').notNull(), // matrix.pub_sites | keystone.pub_affectations …
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull(), // ok | error | unavailable
  read: integer('read').notNull().default(0), // lignes lues dans la vue
  added: integer('added').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  removed: integer('removed').notNull().default(0), // retirées du cache, ou marquées « absentes » (sites)
  message: text('message'),
}, (t) => [
  check('sync_runs_status_check', inList(t.status, SYNC_STATUS_CODES)),
  index('sync_runs_source_idx').on(t.source, t.startedAt),
]);

// ─── Demandes reçues des autres outils (D13, décision CV-08 du 04/11/2026) ──
//
// Un autre outil n'écrit jamais dans les tables de Vigie (M-17, M-18) : il appelle une fonction vigie.pub_<verbe>_<objet>
// (migration 0026 : pub_signaler_avancement_nc, SECURITY DEFINER), qui contrôle l'appelant (session_user parmi
// inbound_callers) et la forme des arguments, puis dépose seulement une ligne dans inbound_requests. Vigie la traite
// ensuite avec ses propres règles et son journal (src/server/inbound.ts : tâche planifiée « Demandes reçues » et bouton
// « Traiter maintenant » de l'onglet « Connecteurs ») ; état et motif lisibles par l'appelant quand Matrix les publiera.

/** Rôles PostgreSQL admis à déposer une demande (session_user) ; la migration y inscrit keystone_app. */
export const inboundCallers = pgTable('inbound_callers', {
  role: text('role').primaryKey(), // keystone_app
  tool: text('tool').notNull(), // keystone
  label: text('label').notNull(), // Keystone
});

export const inboundRequests = pgTable('inbound_requests', {
  id: serial('id').primaryKey(),
  caller: text('caller').notNull(), // session_user de l'appel (keystone_app)
  tool: text('tool').notNull(), // outil de l'appelant (inbound_callers.tool)
  kind: text('kind').notNull(), // INBOUND_KIND_CODES
  externalId: text('external_id').notNull(), // identifiant de la demande chez l'appelant (keystoneId) : idempotence
  // Élément visé : numéro de la NC transmis (référence EV-…, CV-07) ; ECO-… (avancement d'un ordre de modification, D12) ;
  // ECR-… réservé par la fonction de Codex à la création d'une demande de modification (D12).
  targetRef: text('target_ref').notNull(),
  // Code projet Keystone transmis (NC de projet) ; vide pour les demandes de D12 (migration 0029).
  projectCode: text('project_code'),
  payload: jsonb('payload').notNull(), // contenu contrôlé (ncPayloadSchema, src/lib/rules/inbound.ts)
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status').notNull().default('received'), // INBOUND_STATUS_CODES
  processedAt: timestamp('processed_at', { withTimezone: true }),
  resultCode: text('result_code'), // INBOUND_RESULT_CODES, demande refusée seulement
  result: text('result'), // message du traitement (appliquée ou refusée)
  eventId: text('event_id').references(() => events.id), // NC visée, si elle est une NC de projet de Vigie
  // Refus pris en compte par le QHSE (fin de l'échéance) : motif obligatoire (QUA-22).
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  acknowledgedById: text('acknowledged_by_id').references(() => people.id),
  acknowledgeReason: text('acknowledge_reason'),
  // D12 (lot 5 de M-02, migration 0029) : demande de modification créée (Codex) ou ordre de modification visé (Keystone).
  ecrId: text('ecr_id').references((): AnyPgColumn => ecrs.id),
  ecoId: text('eco_id').references((): AnyPgColumn => ecos.id),
}, (t) => [
  uniqueIndex('inbound_requests_external_idx').on(t.caller, t.externalId),
  index('inbound_requests_status_idx').on(t.status, t.receivedAt),
  index('inbound_requests_event_idx').on(t.eventId),
  check('inbound_requests_status_check', inList(t.status, INBOUND_STATUS_CODES)),
  check('inbound_requests_kind_check', inList(t.kind, [...INBOUND_KIND_CODES, ...ENGINEERING_INBOUND_KIND_CODES])),
  check('inbound_requests_project_check', sql`${t.kind} not in (${sql.raw(sqlList(INBOUND_KIND_CODES))}) or ${t.projectCode} is not null`),
  index('inbound_requests_ecr_idx').on(t.ecrId),
  index('inbound_requests_eco_idx').on(t.ecoId),
  check('inbound_requests_result_code_check', sql`${t.resultCode} is null or ${t.resultCode} in (${sql.raw(sqlList(INBOUND_RESULT_CODES))})`),
  check('inbound_requests_processed_check', sql`(${t.status} = 'received') = (${t.processedAt} is null) and (${t.status} = 'rejected') = (${t.resultCode} is not null)`),
  check('inbound_requests_ack_check', sql`${t.acknowledgedAt} is null or ${t.status} = 'rejected'`),
  archiveState('inbound_requests_ack_state_check', t.acknowledgedAt, t.acknowledgedById, t.acknowledgeReason),
]);

// ─── Édition depuis Matrix (demande M-19 de Matrix, décision du 05/11/2026) ──
//
// Matrix n'écrit jamais dans les tables de Vigie (M-18) : la DSI corrige depuis la visionneuse de Matrix en appelant
// vigie.pub_editer (migration 0027, SECURITY DEFINER), qui n'ouvre que les tables et colonnes inscrites ci-dessous, applique
// les contrôles que Vigie fait à la saisie (longueur, obligatoire, liste de valeurs, bornes, format) et écrit le journal de
// Vigie (change_log) dans la même transaction. Registre rempli par la migration seulement (jamais par l'interface) ;
// phase 1 : référentiels et registres sans circuit (docs/specs/edition-matrix-m19.md). Jamais une donnée de santé,
// une référence, un état, un triplet d'archivage, une clé d'un autre outil (refus inscrits aussi dans la fonction).

/** Tables ouvertes à l'édition depuis Matrix. */
export const externalEditTables = pgTable('external_edit_tables', {
  tableName: text('table_name').primaryKey(),
  label: text('label').notNull(), // nom affiché (« Situation d'urgence »)
  entityType: text('entity_type').notNull(), // change_log.entity_type de la fiche (historique de Vigie, version QUA-12)
  keyColumn: text('key_column').notNull(), // clé primaire attendue dans p_cle
  // Fiche du journal portée par une autre colonne (zones : journal de la carte du site, entity_id = site_id) ; null = la clé.
  entityIdColumn: text('entity_id_column'),
  canAdd: boolean('can_add').notNull().default(false), // « ajouter » : création sans référence, notification ni circuit
  canRemove: boolean('can_remove').notNull().default(false), // « retirer » = archivage motivé, sans autre règle à l'archivage
});

/** Colonnes ouvertes, avec les contrôles de la saisie dans Vigie. */
export const externalEditColumns = pgTable('external_edit_columns', {
  tableName: text('table_name').notNull().references(() => externalEditTables.tableName),
  columnName: text('column_name').notNull(),
  label: text('label').notNull(), // libellé du journal de Vigie pour ce champ
  maxLength: integer('max_length'), // texte : longueur maximale (après suppression des espaces de début et de fin)
  required: boolean('required').notNull().default(false), // texte non vide exigé
  choices: jsonb('choices').$type<Record<string, string>>(), // valeurs admises (clé → libellé du journal)
  minValue: integer('min_value'), // entier : bornes incluses
  maxValue: integer('max_value'),
  pattern: text('pattern'), // texte : expression régulière (POSIX) à respecter
}, (t) => [primaryKey({ columns: [t.tableName, t.columnName] })]);

// ─── Modifications techniques : demandes (ECR) et ordres (ECO) de modification ─
//
// D12 de Matrix (lot 5 de M-02, décision CV-06 du 05/11/2026, migration 0029 ; docs/specs/modifications-techniques.md) :
// Vigie numérote, instruit, approuve et libère les demandes et ordres de modification, venus de Codex, de Keystone ou de
// Vigie. Tables de la spécification de Matrix (infra/postgres/partage/60-vigie-ecr-eco.sql) avec EXACTEMENT les colonnes
// que lisent les publications définies par Matrix (data/publications-depot.json : pub_ordres_modification,
// pub_eco_approbations, pub_eco_effectivite, pub_demandes_modification ; requêtes de référence du document) : une colonne
// publiée ne se supprime, ne se renomme ni ne change de type qu'après évolution de la publication par Matrix. Colonnes
// propres à Vigie en fin de table (jamais publiées). Valeurs calculées, jamais stockées : dispositions à décider et
// verrouillage (« locked ») d'un ordre. La table external_progress de la spécification n'est pas créée : les écritures
// reçues passent par inbound_requests (décision CV-08, fonctions pub_ de la migration 0029).

/** Ordres de modification (ECO-AAAA-NNN). */
export const ecos = pgTable('ecos', {
  id: text('id').primaryKey(), // « ECO-2026-015 » (nextEntityReference, portée « ref:ECO-2026- »)
  title: text('title').notNull(),
  ecoType: text('eco_type').notNull(), // ECO_TYPE_CODES
  status: text('status').notNull().default('draft'), // ECO_STATUS_CODES
  interchangeability: text('interchangeability'), // yes | no ; null = non évaluée (soumission à l'approbation refusée)
  fromRevision: text('from_revision').notNull(),
  toRevision: text('to_revision').notNull(),
  costEur: numeric('cost_eur', { precision: 12, scale: 2, mode: 'number' }).notNull().default(0),
  scheduleDays: integer('schedule_days').notNull().default(0),
  stockImpact: text('stock_impact').notNull().default(''),
  requestedByName: text('requested_by_name').notNull(),
  requestedByMatricule: text('requested_by_matricule'), // D01 : matricule Cursus du demandeur
  raisedOn: date('raised_on', { mode: 'string' }).notNull(),
  pilotId: text('pilot_id').references(() => people.id), // pilote dans Vigie (plan d'actions, échéances)
  siteId: text('site_id').references(() => sites.id, { onUpdate: 'cascade' }), // null = tous les sites
  source: text('source').notNull().default('vigie'), // ENGINEERING_SOURCE_CODES
  releasedAt: timestamp('released_at', { withTimezone: true }),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Propres à Vigie (non publiées).
  description: text('description').notNull().default(''),
  approvalRequestedOn: date('approval_requested_on', { mode: 'string' }), // passage à « en approbation » (échéances)
  createdById: text('created_by_id').references(() => people.id),
  // Annulation motivée (saisie par erreur, ordre abandonné) : l'ordre est publié « rejected » (rejected_at), jamais supprimé.
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
}, (t) => [
  index('ecos_status_idx').on(t.status),
  index('ecos_pilot_id_idx').on(t.pilotId),
  check('ecos_id_check', sql`${t.id} ~ '^ECO-[0-9]{4}-[0-9]{3,}$'`),
  check('ecos_eco_type_check', inList(t.ecoType, ECO_TYPE_CODES)),
  check('ecos_status_check', inList(t.status, ECO_STATUS_CODES)),
  check('ecos_interchangeability_check', sql`${t.interchangeability} in ('yes', 'no')`),
  check('ecos_requested_by_matricule_check', sql`${t.requestedByMatricule} ~ '^EMP-[0-9]{4,}$'`),
  check('ecos_source_check', inList(t.source, ENGINEERING_SOURCE_CODES)),
  check('ecos_released_check', sql`${t.releasedAt} is null or ${t.status} = 'released'`),
  check('ecos_rejected_check', sql`${t.rejectedAt} is null or ${t.status} = 'rejected'`),
  check('ecos_cost_check', sql`${t.costEur} >= 0`),
  check('ecos_cancelled_rejected_check', sql`${t.cancelledAt} is null or ${t.status} = 'rejected'`),
  archiveState('ecos_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
]);

/** Demandes de modification (ECR-AAAA-NNN), nées dans Codex, Keystone ou Vigie. */
export const ecrs = pgTable('ecrs', {
  id: text('id').primaryKey(), // « ECR-2026-004 »
  kind: text('kind').notNull(), // ECR_KIND_CODES
  subject: text('subject').notNull(), // ECR_SUBJECT_CODES
  title: text('title').notNull(),
  reason: text('reason').notNull(),
  description: text('description').notNull().default(''),
  source: text('source').notNull(), // ENGINEERING_SOURCE_CODES
  codexDocId: text('codex_doc_id'), // D10 : codex.pub_documents.id
  keystoneProjectCode: text('keystone_project_code'), // D02 : keystone.pub_projets.code
  partRef: text('part_ref'), // keystone.pub_articles.ref
  eventId: text('event_id').references(() => events.id, { onUpdate: 'cascade' }), // NC à l'origine de la demande
  requesterName: text('requester_name').notNull(),
  requesterMatricule: text('requester_matricule'), // D01
  requesterRef: text('requester_ref'), // identifiant dans l'outil émetteur (codex.users.id : « jwagner »)
  status: text('status').notNull().default('submitted'), // ECR_STATUS_CODES
  ecoId: text('eco_id').references(() => ecos.id),
  modifierRef: text('modifier_ref'), // codex.users.id du rédacteur désigné (modifierId du webhook)
  decisionNote: text('decision_note'),
  decidedById: text('decided_by_id').references(() => people.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  implementedAt: timestamp('implemented_at', { withTimezone: true }), // réponse 200 du webhook de Codex
  codexRevision: text('codex_revision'), // lettre de révision ouverte par Codex
  notifyStatus: text('notify_status'), // pending | sent | failed (dernier envoi à Codex, outbound_messages)
  notifyAttempts: integer('notify_attempts').notNull().default(0),
  notifyError: text('notify_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Propres à Vigie (non publiées).
  siteId: text('site_id').references(() => sites.id, { onUpdate: 'cascade' }), // null = toute l'entreprise
  createdById: text('created_by_id').references(() => people.id),
  // Annulation motivée d'une demande saisie par erreur dans Vigie : publiée « rejected », jamais supprimée.
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
}, (t) => [
  // Une seule demande en cours par document (règle change_requests_pending de Codex).
  uniqueIndex('ecrs_one_open_per_document').on(t.codexDocId).where(sql`${t.codexDocId} is not null and ${t.status} in ('submitted', 'accepted')`),
  index('ecrs_eco_id_idx').on(t.ecoId),
  index('ecrs_event_id_idx').on(t.eventId),
  check('ecrs_id_check', sql`${t.id} ~ '^ECR-[0-9]{4}-[0-9]{3,}$'`),
  check('ecrs_kind_check', inList(t.kind, ECR_KIND_CODES)),
  check('ecrs_subject_check', inList(t.subject, ECR_SUBJECT_CODES)),
  check('ecrs_objet_check', sql`(${t.subject} = 'document' and ${t.codexDocId} is not null) or (${t.subject} = 'part' and ${t.partRef} is not null) or (${t.subject} = 'project' and ${t.keystoneProjectCode} is not null) or (${t.subject} = 'event' and ${t.eventId} is not null)`),
  check('ecrs_source_check', inList(t.source, ENGINEERING_SOURCE_CODES)),
  check('ecrs_requester_matricule_check', sql`${t.requesterMatricule} ~ '^EMP-[0-9]{4,}$'`),
  check('ecrs_status_check', inList(t.status, ECR_STATUS_CODES)),
  check('ecrs_decision_check', sql`${t.status} = 'submitted' or ${t.decidedAt} is not null`),
  check('ecrs_implemented_check', sql`${t.status} <> 'implemented' or ${t.implementedAt} is not null`),
  check('ecrs_notify_status_check', inList(t.notifyStatus, OUTBOUND_STATUS_CODES)),
  check('ecrs_notify_attempts_check', sql`${t.notifyAttempts} >= 0`),
  check('ecrs_cancelled_rejected_check', sql`${t.cancelledAt} is null or ${t.status} = 'rejected'`),
  archiveState('ecrs_cancel_check', t.cancelledAt, t.cancelledById, t.cancelReason),
]);

/** Approbations d'un ordre (trois clés : ingénierie, qualité, chefs des projets visés). */
export const ecoApprovals = pgTable('eco_approvals', {
  ecoId: text('eco_id').notNull().references(() => ecos.id, { onDelete: 'cascade' }),
  approvalKey: text('approval_key').notNull(), // ECO_APPROVAL_KEY_CODES
  approverText: text('approver_text').notNull(), // « Antoine Girard » ; PM : « R. Aubert, C. Moreau »
  decision: text('decision').notNull().default('pending'), // ECO_DECISION_CODES
  decidedByName: text('decided_by_name'),
  decidedByMatricule: text('decided_by_matricule'), // D01
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  comment: text('comment'),
  via: text('via'), // vigie | keystone
  // Propres à Vigie (non publiées) : approbateur désigné dans Vigie (il décide de sa clé), auteur d'une décision saisie dans Vigie.
  approverId: text('approver_id').references(() => people.id),
  decidedById: text('decided_by_id').references(() => people.id),
}, (t) => [
  primaryKey({ columns: [t.ecoId, t.approvalKey] }),
  check('eco_approvals_approval_key_check', inList(t.approvalKey, ECO_APPROVAL_KEY_CODES)),
  check('eco_approvals_decision_check', inList(t.decision, ECO_DECISION_CODES)),
  check('eco_approvals_matricule_check', sql`${t.decidedByMatricule} ~ '^EMP-[0-9]{4,}$'`),
  check('eco_approvals_via_check', inList(t.via, ECO_APPROVAL_VIA_CODES)),
]);

/** Articles Keystone visés par un ordre (référence texte de keystone.pub_articles). */
export const ecoParts = pgTable('eco_parts', {
  ecoId: text('eco_id').notNull().references(() => ecos.id, { onDelete: 'cascade' }),
  partRef: text('part_ref').notNull(),
  position: integer('position').notNull(),
}, (t) => [primaryKey({ columns: [t.ecoId, t.partRef] })]);

/** Projets Keystone visés par un ordre (code de keystone.pub_projets). */
export const ecoProjects = pgTable('eco_projects', {
  ecoId: text('eco_id').notNull().references(() => ecos.id, { onDelete: 'cascade' }),
  keystoneProjectCode: text('keystone_project_code').notNull(),
  position: integer('position').notNull(),
}, (t) => [primaryKey({ columns: [t.ecoId, t.keystoneProjectCode] })]);

/** Effectivité : disposition de chaque cible (projet, ou machine du parc installé). */
export const ecoEffectivity = pgTable('eco_effectivity', {
  ecoId: text('eco_id').notNull().references(() => ecos.id, { onDelete: 'cascade' }),
  targetType: text('target_type').notNull(), // EFFECTIVITY_TARGET_CODES
  targetRef: text('target_ref').notNull(), // code projet, ou numéro de machine de keystone.pub_parc_machines
  label: text('label').notNull(),
  disposition: text('disposition'), // update | pinned | retrofit | na ; null = à décider
  isAutomatic: boolean('is_automatic').notNull().default(false), // proposée d'après keystone.pub_nomenclatures ou pub_parc_machines
  note: text('note'),
  fittedPartRef: text('fitted_part_ref'),
  fittedRevision: text('fitted_revision'),
  position: integer('position').notNull(),
  // Propres à Vigie (non publiées) : échéance et réalisation d'une mise à jour ou d'un rétrofit (échéances de l'ordre libéré).
  dueOn: date('due_on', { mode: 'string' }),
  doneOn: date('done_on', { mode: 'string' }),
}, (t) => [
  primaryKey({ columns: [t.ecoId, t.targetType, t.targetRef] }),
  check('eco_effectivity_target_type_check', inList(t.targetType, EFFECTIVITY_TARGET_CODES)),
  check('eco_effectivity_disposition_check', inList(t.disposition, EFFECTIVITY_DISPOSITION_CODES)),
  check('eco_effectivity_retrofit_check', sql`${t.disposition} is distinct from 'retrofit' or ${t.targetType} = 'machine'`),
]);

/** Documents cités par un ordre, avec l'identifiant de Codex quand le document y est. */
export const ecoDocuments = pgTable('eco_documents', {
  ecoId: text('eco_id').notNull().references(() => ecos.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  refLabel: text('ref_label').notNull(), // « DWG-AS-9000 C »
  codexDocId: text('codex_doc_id'), // D10 : codex.pub_documents.id
  ecrId: text('ecr_id').references(() => ecrs.id), // demande transmise à Codex pour ce document
}, (t) => [
  primaryKey({ columns: [t.ecoId, t.position] }),
  index('eco_documents_ecr_id_idx').on(t.ecrId),
]);

/** Actions du plan d'actions liées à un ordre (source « Modification technique », lien `eco:<numéro>` du registre). */
export const ecoActions = pgTable('eco_actions', {
  ecoId: text('eco_id').notNull().references(() => ecos.id, { onDelete: 'cascade' }),
  actionId: text('action_id').notNull().references(() => actions.id),
}, (t) => [
  primaryKey({ columns: [t.ecoId, t.actionId] }),
  index('eco_actions_action_id_idx').on(t.actionId),
]);

// ─── Envois aux autres outils (D12, lot 5 de M-02, migration 0029) ──────────
//
// File d'envoi : un message par décision à transmettre (ex. décision sur une demande de modification de Codex, envoyée à
// son webhook POST <VIGIE_CODEX_URL>/api/integrations/vigie), écrit dans la transaction de la décision, envoyé par la tâche
// planifiée « Envois aux outils » (src/server/outbound.ts) avec reprises espacées. Jamais supprimé ; lu par l'onglet
// « Connecteurs ». Aucune donnée personnelle hors du corps attendu par le destinataire.
export const outboundMessages = pgTable('outbound_messages', {
  id: serial('id').primaryKey(),
  target: text('target').notNull(), // OUTBOUND_TARGET_CODES
  kind: text('kind').notNull(), // OUTBOUND_KIND_CODES
  entityType: text('entity_type').notNull(), // fiche de Vigie (ecr)
  entityId: text('entity_id').notNull(),
  payload: jsonb('payload').notNull(), // corps envoyé tel quel
  status: text('status').notNull().default('pending'), // pending (à envoyer, reprises comprises) | sent | failed (refus définitif)
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  lastError: text('last_error'), // message technique court (statut HTTP, code d'erreur du destinataire), jamais le corps
  lastStatus: integer('last_status'), // dernier statut HTTP reçu
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
}, (t) => [
  index('outbound_messages_status_idx').on(t.status, t.nextAttemptAt),
  index('outbound_messages_entity_idx').on(t.entityType, t.entityId),
  check('outbound_messages_status_check', inList(t.status, OUTBOUND_STATUS_CODES)),
  check('outbound_messages_target_check', inList(t.target, OUTBOUND_TARGET_CODES)),
  check('outbound_messages_kind_check', inList(t.kind, OUTBOUND_KIND_CODES)),
  check('outbound_messages_sent_check', sql`(${t.status} = 'sent') = (${t.sentAt} is not null)`),
  check('outbound_messages_attempts_check', sql`${t.attempts} >= 0`),
]);
