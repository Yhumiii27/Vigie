import { boolean, date, integer, jsonb, numeric, pgTable, primaryKey, serial, text, timestamp } from 'drizzle-orm/pg-core';

// ─── Référentiels ────────────────────────────────────────────────────────────

export const sites = pgTable('sites', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  // Classement Seveso (seuil_haut | seuil_bas | null) et règle interne associée :
  // plan de prévention écrit exigé dès la première minute d'intervention d'une entreprise extérieure.
  seveso: text('seveso'),
  ppFromFirstMinute: boolean('pp_from_first_minute').notNull().default(false),
  sort: integer('sort').notNull().default(0),
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
  entityType: text('entity_type').notNull(), // event | document_version | control_record | …
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
  declarant: text('declarant'), // null quand anonyme
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Contenu de l'analyse des causes, une ligne par méthode et par événement.
export const eventAnalyses = pgTable('event_analyses', {
  eventId: text('event_id').notNull().references(() => events.id),
  method: text('method').notNull(),
  content: jsonb('content').notNull(),
}, (t) => [primaryKey({ columns: [t.eventId, t.method] })]);

// ─── Plan d'actions unique ──────────────────────────────────────────────────

export const actions = pgTable('actions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  origin: text('origin').notNull(), // ev | audit | risk | watch | client | rev | skills | prevention | docs | env
  originRef: text('origin_ref').notNull(),
  eventId: text('event_id').references(() => events.id),
  siteId: text('site_id').references(() => sites.id), // null = tous sites
  pilotId: text('pilot_id').notNull().references(() => people.id),
  dueOn: date('due_on', { mode: 'string' }).notNull(),
  status: text('status').notNull(), // todo | doing | verify | done — « en retard » est calculé
  kind: text('kind').notNull(), // C (corrective) | P (préventive)
  verifyDueOn: date('verify_due_on', { mode: 'string' }),
  efficacyNote: text('efficacy_note'), // constat de la vérification d'efficacité
  verifiedById: text('verified_by_id').references(() => people.id),
  closedOn: date('closed_on', { mode: 'string' }),
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
  keystoneProjects: integer('keystone_projects'),
  actionId: text('action_id').references(() => actions.id),
  sort: integer('sort').notNull().default(0),
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
});

// ─── Habilitations et formations ────────────────────────────────────────────

export const trainingTitles = pgTable('training_titles', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  validityMonths: integer('validity_months').notNull().default(0), // 0 = sans échéance
  sort: integer('sort').notNull().default(0),
});

export const qualificationRequirements = pgTable('qualification_requirements', {
  personId: text('person_id').notNull().references(() => people.id),
  titleId: text('title_id').notNull().references(() => trainingTitles.id),
  renewalActionId: text('renewal_action_id').references(() => actions.id), // recyclage planifié
}, (t) => [primaryKey({ columns: [t.personId, t.titleId] })]);

export const qualifications = pgTable('qualifications', {
  personId: text('person_id').notNull().references(() => people.id),
  titleId: text('title_id').notNull().references(() => trainingTitles.id),
  obtainedOn: date('obtained_on', { mode: 'string' }).notNull(),
  expiresOn: date('expires_on', { mode: 'string' }),
  provider: text('provider'),
}, (t) => [primaryKey({ columns: [t.personId, t.titleId] })]);

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
  status: text('status').notNull(),
  tone: text('tone').notNull(), // ok | warn | off
  note: text('note').notNull(),
  sort: integer('sort').notNull().default(0),
});

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
});

export const auditFindings = pgTable('audit_findings', {
  id: serial('id').primaryKey(),
  audit: text('audit').notNull(),
  kind: text('kind').notNull(), // ecart_mineur | piste | point_fort
  text: text('text').notNull(),
  actionId: text('action_id').references(() => actions.id),
  sort: integer('sort').notNull().default(0),
});

export const reviewItems = pgTable('review_items', {
  id: serial('id').primaryKey(),
  reviewOn: date('review_on', { mode: 'string' }).notNull(),
  label: text('label').notNull(),
  done: boolean('done').notNull().default(false),
  owner: text('owner').notNull(),
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
  status: text('status').notNull(), // brouillon | a_signer | signe | clos
  signedEuOn: date('signed_eu_on', { mode: 'string' }), // entreprise utilisatrice
  signedEeOn: date('signed_ee_on', { mode: 'string' }), // entreprise extérieure
  ownerId: text('owner_id').references(() => people.id),
  formData: jsonb('form_data'), // réponses du formulaire importé (voir src/lib/pp-form.ts)
  importedFromId: text('imported_from_id').references(() => attachments.id), // fichier source de l'import
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
  closedAt: timestamp('closed_at', { withTimezone: true }),
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
