import { boolean, date, index, integer, jsonb, numeric, pgTable, primaryKey, serial, text, timestamp, type AnyPgColumn } from 'drizzle-orm/pg-core';

// Conventions de traçabilité (jamais de suppression physique d'un enregistrement métier tracé) :
// - archivage : archivedAt / archivedById / archiveReason (élément retiré du suivi, historique conservé) ;
// - annulation : cancelledAt / cancelledById / cancelReason (saisie annulée, exclue des calculs) ;
// - historique des modifications : table change_log (src/server/changelog.ts).

// ─── Référentiels ────────────────────────────────────────────────────────────

export const sites = pgTable('sites', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  // Classement Seveso (seuil_haut | seuil_bas | null) et règle interne associée :
  // plan de prévention écrit exigé dès la première minute d'intervention d'une entreprise extérieure.
  seveso: text('seveso'),
  ppFromFirstMinute: boolean('pp_from_first_minute').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  // Archivage (site fermé ou cédé) : masqué des sélecteurs, données conservées et visibles sous « Tous les sites ».
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedById: text('archived_by_id').references((): AnyPgColumn => people.id),
  archiveReason: text('archive_reason'),
});

// Personnel — saisie manuelle pour l'instant ; Cursus deviendra la source de vérité RH.
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
});

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
  // event | action | document_version | control_record | requirement_evaluation | prevention_plan | site_map
  // | qualification | audit_plan_item | certification — droit de lecture : canReadAttachment (src/lib/uploads.ts)
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  storagePath: text('storage_path').notNull(),
  uploadedBy: text('uploaded_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
  anonymous: boolean('anonymous').notNull().default(false),
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
  // Rattachements facultatifs vers les autres modules.
  controlId: integer('control_id').references((): AnyPgColumn => controls.id), // équipement soumis à contrôle périodique
  riskId: integer('risk_id').references((): AnyPgColumn => risks.id), // risque du DUERP concerné (réévaluation)
  documentId: text('document_id').references((): AnyPgColumn => documents.id), // document maîtrisé concerné
  preventionPlanId: text('prevention_plan_id').references((): AnyPgColumn => preventionPlans.id),
  permitId: text('permit_id').references((): AnyPgColumn => permits.id),
  // « Classé sans suite » (doublon, faux signalement…) : jamais supprimé, motif obligatoire, exclu des indicateurs.
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  dismissedById: text('dismissed_by_id').references(() => people.id),
  dismissReason: text('dismiss_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
});

// ─── Plan d'actions unique ──────────────────────────────────────────────────

export const actions = pgTable('actions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  origin: text('origin').notNull(), // ev | audit | risk | watch | client | rev | skills | prevention | docs | env
  originRef: text('origin_ref').notNull(),
  eventId: text('event_id').references(() => events.id),
  reviewId: integer('review_id').references((): AnyPgColumn => reviews.id), // revue de direction d'origine (décision, objectif, préparation)
  siteId: text('site_id').references(() => sites.id), // null = tous sites
  pilotId: text('pilot_id').notNull().references(() => people.id),
  dueOn: date('due_on', { mode: 'string' }).notNull(),
  status: text('status').notNull(), // todo | doing | verify | done | cancelled — « en retard » est calculé
  kind: text('kind').notNull(), // C (corrective) | P (préventive)
  verifyDueOn: date('verify_due_on', { mode: 'string' }),
  efficacyNote: text('efficacy_note'), // constat de la vérification d'efficacité
  verifiedById: text('verified_by_id').references(() => people.id),
  closedOn: date('closed_on', { mode: 'string' }),
  // Annulation (statut « cancelled », jamais de suppression) : qui, quand, pourquoi.
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Évaluation des risques (DUERP) ─────────────────────────────────────────

export const duerpVersions = pgTable('duerp_versions', {
  version: text('version').primaryKey(),
  current: boolean('current').notNull().default(false),
  updatedOn: date('updated_on', { mode: 'string' }).notNull(),
  nextUpdateOn: date('next_update_on', { mode: 'string' }).notNull(),
  retention: text('retention').notNull(),
  validatedById: text('validated_by_id').references(() => people.id),
  cseConsultedOn: date('cse_consulted_on', { mode: 'string' }),
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
});

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
});

export const riskActions = pgTable('risk_actions', {
  riskId: integer('risk_id').notNull().references(() => risks.id),
  actionId: text('action_id').notNull().references(() => actions.id),
}, (t) => [primaryKey({ columns: [t.riskId, t.actionId] })]);

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
  actionId: text('action_id').references(() => actions.id),
  sort: integer('sort').notNull().default(0),
  // Archivage (« texte abrogé ») : jamais de suppression, motif conservé.
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedById: text('archived_by_id').references(() => people.id),
  archiveReason: text('archive_reason'),
});

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
});

// Historique des contrôles réalisés (le dernier met à jour controls.lastOn / nextOn / reserves).
export const controlRecords = pgTable('control_records', {
  id: serial('id').primaryKey(),
  controlId: integer('control_id').notNull().references(() => controls.id),
  performedOn: date('performed_on', { mode: 'string' }).notNull(),
  organization: text('organization').notNull(),
  reserves: text('reserves'),
  notes: text('notes'),
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
});

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
});

// ─── Habilitations et formations ────────────────────────────────────────────

export const trainingTitles = pgTable('training_titles', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  validityMonths: integer('validity_months').notNull().default(0), // 0 = sans échéance
  sort: integer('sort').notNull().default(0),
  // Titre retiré du suivi (historique conservé).
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedById: text('archived_by_id').references(() => people.id),
  archiveReason: text('archive_reason'),
});

export const qualificationRequirements = pgTable('qualification_requirements', {
  personId: text('person_id').notNull().references(() => people.id),
  titleId: text('title_id').notNull().references(() => trainingTitles.id),
  renewalActionId: text('renewal_action_id').references(() => actions.id), // recyclage planifié
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
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  recordedById: text('recorded_by_id').references(() => people.id),
  // Formation enregistrée par erreur : annulée avec un motif (jamais supprimée) et exclue du calcul de l'état.
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
}, (t) => [index('qualifications_person_title_idx').on(t.personId, t.titleId)]);

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
});

export const auditFindings = pgTable('audit_findings', {
  id: serial('id').primaryKey(),
  audit: text('audit').notNull(), // libellé ; recalculé depuis l'élément du programme quand planItemId est renseigné
  planItemId: integer('plan_item_id').references(() => auditPlanItems.id), // audit du programme (null = constat hors programme)
  clause: text('clause'), // exigence ou paragraphe, ex. « §8.2.3 »
  foundOn: date('found_on', { mode: 'string' }), // date du constat
  kind: text('kind').notNull(), // ecart_mineur | piste | point_fort
  text: text('text').notNull(),
  actionId: text('action_id').references(() => actions.id),
  sort: integer('sort').notNull().default(0),
  // Annulation (constat saisi par erreur ou en double) : jamais de suppression, motif conservé, l'action liée reste au plan.
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
});

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
  snapshot: jsonb('snapshot'), // dossier figé à la clôture (null pour les revues antérieures à Vigie)
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
});

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
});

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
  status: text('status').notNull(), // brouillon | a_signer | signe | clos | annule
  signedEuOn: date('signed_eu_on', { mode: 'string' }), // entreprise utilisatrice
  signedEeOn: date('signed_ee_on', { mode: 'string' }), // entreprise extérieure
  ownerId: text('owner_id').references(() => people.id),
  formData: jsonb('form_data'), // réponses du formulaire importé (voir src/lib/pp-form.ts)
  importedFromId: text('imported_from_id').references(() => attachments.id), // fichier source de l'import
  // Plan annulé (intervention n'ayant pas lieu), motif obligatoire ; seul un brouillon jamais signé peut être supprimé.
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
});

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
});

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
});

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
});

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
  bsdNumber: text('bsd_number'), // bordereau Trackdéchets (obligatoire pour les déchets dangereux)
  bsdStatus: text('bsd_status'), // brouillon | emis | collecte | traite
  transporter: text('transporter').notNull(),
  notes: text('notes'),
  // Événement à l'origine de l'enlèvement (déversement éliminé en déchet dangereux…), facultatif.
  eventId: text('event_id').references(() => events.id),
  // Annulation tracée (R. 541-43 : registre conservé 3 ans, aucune suppression physique).
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledById: text('cancelled_by_id').references(() => people.id),
  cancelReason: text('cancel_reason'),
});

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
});

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
});

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

// État « lu » des échéances calculées (clé stable todoKey), par personne. Les échéances ne sont pas stockées :
// seules les clés lues le sont ; « Tout marquer comme lu » supprime les clés qui ne correspondent plus à rien.
export const notificationReads = pgTable('notification_reads', {
  personId: text('person_id').notNull().references(() => people.id),
  itemKey: text('item_key').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.personId, t.itemKey] })]);
