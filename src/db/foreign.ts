// Vues publiées par les autres outils et lues par Vigie (lot 0 de la convergence M-02, docs/specs/convergence-m02.md § 2).
// Hors de drizzle.config.ts (qui ne lit que src/db/schema.ts) : drizzle-kit n'en tire aucune migration. Déclarées
// `.existing()` (aucune création), l'objet pgSchema de l'autre outil jamais exporté (exporté, drizzle-kit écrirait un
// CREATE SCHEMA ; plan de Matrix, § 1.3). Colonnes, types et ordre recopiés des contrats publiés (FOREIGN_CONTRACTS,
// comparés à test/fixtures/contracts/*.json et aux substituts de démonstration par test/integration/foreign-sources.test.ts).
//
// Seuls src/lib/foreign/ (lectures) et src/db/foreign-substitutes.ts (substituts de démonstration) importent ce module :
// aucun autre fichier de Vigie ne nomme un schéma d'un autre outil (garde-fou du même test). Aucune écriture vers ces
// schémas (décision M-17 de Matrix).

import { boolean, char, date, integer, jsonb, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const matrix = pgSchema('matrix');
const keystone = pgSchema('keystone');
const cursus = pgSchema('cursus');
const codex = pgSchema('codex');

/** matrix.pub_sites — contrat D14 v1 (+ filiale_code, latitude, longitude en fin de vue). Lecteur : vigie_app. */
export const pubSites = matrix.view('pub_sites', {
  code: text('code').notNull(),
  libelle: text('libelle').notNull(),
  ville: text('ville'),
  paysIso2: char('pays_iso2', { length: 2 }).notNull(),
  ordre: integer('ordre').notNull(),
  actif: boolean('actif').notNull(),
  filialeCode: text('filiale_code'),
  latitude: numeric('latitude', { precision: 9, scale: 6 }),
  longitude: numeric('longitude', { precision: 9, scale: 6 }),
}).existing();

/**
 * keystone.pub_projets — contrat D02 v1 (+ capex_code, besoin_ref, client_interne, filiale_code, categorie en fin de vue).
 * Lecteur : vigie_app. Aucune date de livraison (veille : surcharge manuelle seulement, CV-11).
 */
export const pubProjets = keystone.view('pub_projets', {
  code: text('code').notNull(),
  numero: text('numero'),
  codeAnalytique: text('code_analytique'),
  nature: text('nature').notNull(),
  nom: text('nom').notNull(),
  clientId: uuid('client_id'),
  client: text('client'),
  clientCode3: text('client_code3'),
  phaseCode: text('phase_code').notNull(),
  phase: text('phase'),
  imputable: boolean('imputable'),
  chefProjetMatricule: text('chef_projet_matricule'),
  chefProjetNom: text('chef_projet_nom'),
  ville: text('ville'),
  pays: text('pays'),
  fournisseurs: text('fournisseurs'),
  majLe: timestamp('maj_le', { withTimezone: true }).notNull(),
  capexCode: text('capex_code'),
  besoinRef: text('besoin_ref'),
  clientInterne: boolean('client_interne'),
  filialeCode: text('filiale_code'),
  categorie: text('categorie'),
}).existing();

/** keystone.pub_affectations — contrat D04 v1 (rotations et affectations du planning, matricule renseigné). Lecteur : vigie_app. */
export const pubAffectations = keystone.view('pub_affectations', {
  source: text('source'),
  affectationId: uuid('affectation_id'),
  matricule: text('matricule'),
  personneNom: text('personne_nom'),
  projetCode: text('projet_code'),
  projetNom: text('projet_nom'),
  client: text('client'),
  activiteCode: text('activite_code'),
  activite: text('activite'),
  du: date('du', { mode: 'string' }),
  au: date('au', { mode: 'string' }),
  lieu: text('lieu'),
  pays: text('pays'),
  paysIso2: char('pays_iso2', { length: 2 }),
  heuresPrevues: numeric('heures_prevues'),
}).existing();

/** keystone.pub_fournisseurs — contrat D16 v1 (sans indicateurs de performance). Lecteur : vigie_app. */
export const pubFournisseurs = keystone.view('pub_fournisseurs', {
  id: uuid('id').notNull(),
  name: text('name').notNull(),
  x3Code: text('x3_code'),
  isInternal: boolean('is_internal').notNull(),
}).existing();

/**
 * keystone.pub_articles — contrat D12 v1 (articles du catalogue, sans prix, fabricant ni contrôle export ; Keystone
 * drizzle/0035_share.sql). Lecteurs : vigie_app, matrix_app. Lot 5 de M-02 (modifications techniques).
 */
export const pubArticles = keystone.view('pub_articles', {
  ref: text('ref').notNull(),
  name: text('name').notNull(),
  revision: text('revision'),
  status: text('status').notNull(),
  partType: text('part_type').notNull(),
  makeBuy: text('make_buy').notNull(),
}).existing();

/** keystone.pub_nomenclatures — contrat D12 v1 (cas d'emploi des articles par projet, quantité totale). Lecteurs : vigie_app, matrix_app. */
export const pubNomenclatures = keystone.view('pub_nomenclatures', {
  projectCode: text('project_code').notNull(),
  stage: text('stage').notNull(),
  partRef: text('part_ref').notNull(),
  quantity: numeric('quantity'),
}).existing();

/**
 * keystone.pub_parc_machines — contrat D12 v1 + type_machine_code, livree_le, maj_le (Keystone drizzle/0040_share_installed_base.sql) :
 * parc installé, une ligne par machine et article monté (part_ref et fitted_revision nuls sans configuration enregistrée).
 * Lecteurs : vigie_app, matrix_app, arche_app.
 */
export const pubParcMachines = keystone.view('pub_parc_machines', {
  number: text('number').notNull(),
  name: text('name').notNull(),
  clientName: text('client_name').notNull(),
  siteText: text('site_text').notNull(),
  projectCode: text('project_code'),
  warrantyStatus: text('warranty_status').notNull(),
  partRef: text('part_ref'),
  fittedRevision: text('fitted_revision'),
  typeMachineCode: text('type_machine_code').notNull(),
  livreeLe: date('livree_le', { mode: 'string' }),
  majLe: timestamp('maj_le', { withTimezone: true }).notNull(),
}).existing();

/**
 * cursus.pub_titres — contrat D08 v1 (catalogue des formations et habilitations de Cursus ; validite_mois NULL = sans
 * échéance). Lecteurs : vigie_app, keystone_app, matrix_app.
 */
export const pubTitres = cursus.view('pub_titres', {
  titreId: text('titre_id'),
  nature: text('nature'),
  code: text('code'),
  libelle: text('libelle'),
  libelleCourt: text('libelle_court'),
  validiteMois: integer('validite_mois'),
}).existing();

/**
 * cursus.pub_titres_detenus — contrat D09 v1, avenant du lot 8 de Cursus (migration 0011_pub_titres_valides) : dernière
 * formation suivie non annulée, habilitations délivrées ; utilisable_jusqu_au borné par les prérequis, une suspension ou
 * un retrait ; mesure et mesure_le en fin de vue. Aucune donnée de santé (aptitude médicale non publiée, C-02). Lecteurs :
 * vigie_app, keystone_app, matrix_app.
 */
export const pubTitresDetenus = cursus.view('pub_titres_detenus', {
  cursusRef: text('cursus_ref'),
  matricule: text('matricule'),
  titreId: text('titre_id'),
  nature: text('nature'),
  code: text('code'),
  obtenuLe: date('obtenu_le', { mode: 'string' }),
  expireLe: date('expire_le', { mode: 'string' }),
  utilisableJusquAu: date('utilisable_jusqu_au', { mode: 'string' }),
  prerequisManquant: boolean('prerequis_manquant'),
  organisme: text('organisme'),
  delivrePar: text('delivre_par'),
  sessionPrevueLe: date('session_prevue_le', { mode: 'string' }),
  mesure: text('mesure'),
  mesureLe: date('mesure_le', { mode: 'string' }),
}).existing();

/**
 * codex.pub_documents — contrat D10 v1 (fiches documents de Codex, sans les « tres_confidentiel » ; le lecteur applique
 * `conf`). Lecteurs : keystone_app, vigie_app, arche_app, crucible_app, matrix_app. Lot 4 de M-02 (décision CV-05).
 */
export const pubDocuments = codex.view('pub_documents', {
  id: text('id').notNull(),
  aliases: jsonb('aliases').$type<string[]>(),
  title: text('title').notNull(),
  origin: text('origin'),
  attachment: text('attachment'),
  projectCode: text('project_code'),
  programCode: text('program_code'),
  family: text('family'),
  typeCode: text('type_code'),
  subtype: text('subtype'),
  department: text('department'),
  site: text('site'),
  ownerId: text('owner_id'),
  ownerName: text('owner_name'),
  authorId: text('author_id'),
  authorName: text('author_name'),
  conf: text('conf'),
  keywords: jsonb('keywords').$type<string[]>(),
  lang: text('lang'),
  state: text('state'),
  status: text('status'),
  revInForce: text('rev_in_force'),
  revWorking: text('rev_working'),
  issuedAt: date('issued_at', { mode: 'string' }),
  reviewDueAt: date('review_due_at', { mode: 'string' }),
  expiresAt: date('expires_at', { mode: 'string' }),
  discipline: text('discipline'),
  projectPhase: text('project_phase'),
  workPackage: text('work_package'),
  sourceOrg: text('source_org'),
  externalRef: text('external_ref'),
  legalHold: boolean('legal_hold'),
  obsoleteAt: date('obsolete_at', { mode: 'string' }),
  archivedAt: date('archived_at', { mode: 'string' }),
  createdAt: date('created_at', { mode: 'string' }),
  modifiedAt: date('modified_at', { mode: 'string' }),
  distribution: text('distribution'),
  reviewMonths: integer('review_months'),
  processCode: text('process_code'),
  ownerMatricule: text('owner_matricule'),
}).existing();

/** codex.pub_revisions_document — contrat D10 v1 (révisions et dernière version de travail). Lecteurs : idem. */
export const pubRevisionsDocument = codex.view('pub_revisions_document', {
  revisionId: integer('revision_id'),
  docId: text('doc_id'),
  letter: text('letter'),
  status: text('status'),
  createdAt: date('created_at', { mode: 'string' }),
  effectiveAt: date('effective_at', { mode: 'string' }),
  approvedAt: date('approved_at', { mode: 'string' }),
  inForceAt: date('in_force_at', { mode: 'string' }),
  supersededAt: date('superseded_at', { mode: 'string' }),
  modifierId: text('modifier_id'),
  changeRef: text('change_ref'),
  workingVersions: integer('working_versions'),
  lastVersionId: integer('last_version_id'),
  lastVersionN: integer('last_version_n'),
  lastVersionDate: date('last_version_date', { mode: 'string' }),
  lastVersionAuthorId: text('last_version_author_id'),
  lastVersionAuthorName: text('last_version_author_name'),
  lastVersionComment: text('last_version_comment'),
  fileName: text('file_name'),
  mime: text('mime'),
  size: integer('size'),
}).existing();

/** codex.pub_validations — contrat D10 v1 (circuits de validation, une ligne par étape). Lecteurs : keystone_app, vigie_app, arche_app, matrix_app. */
export const pubValidations = codex.view('pub_validations', {
  workflowId: text('workflow_id'),
  docId: text('doc_id'),
  revision: text('revision'),
  requesterId: text('requester_id'),
  due: date('due', { mode: 'string' }),
  currentStep: integer('current_step'),
  outcome: text('outcome'),
  createdAt: date('created_at', { mode: 'string' }),
  idx: integer('idx'),
  functionKey: text('function_key'),
  stepLabel: text('step_label'),
  assigneeId: text('assignee_id'),
  assigneeName: text('assignee_name'),
  doneOn: date('done_on', { mode: 'string' }),
  assigneeMatricule: text('assignee_matricule'),
}).existing();

/** codex.pub_types_document — contrat D11 v1 (registre des types de Codex). Lecteurs : keystone_app, vigie_app, arche_app, matrix_app. */
export const pubTypesDocument = codex.view('pub_types_document', {
  code: text('code'),
  labelFr: text('label_fr'),
  labelEn: text('label_en'),
  family: text('family'),
  familyLabelFr: text('family_label_fr'),
  familyLabelEn: text('family_label_en'),
  familyGroup: text('family_group'),
  familySort: integer('family_sort'),
  origins: jsonb('origins'),
  attachments: jsonb('attachments'),
  subtypes: jsonb('subtypes'),
  circuit: jsonb('circuit'),
  retentionYears: integer('retention_years'),
  retentionTrigger: text('retention_trigger'),
  retentionDisposition: text('retention_disposition'),
  retentionBasis: text('retention_basis'),
  confAllowed: jsonb('conf_allowed'),
  confDefault: text('conf_default'),
  iso: text('iso'),
  clientDeliverable: boolean('client_deliverable'),
  active: boolean('active'),
  source: text('source'),
  sort: integer('sort'),
}).existing();

/** Vue lue : schéma, nom, et colonnes du contrat dans l'ordre (nom, type SQL tel que information_schema le donne). */
export type ForeignContract = { schema: string; view: string; columns: readonly (readonly [name: string, type: string])[] };

/** Contrats des vues lues (ordre des colonnes = ordre de la vue publiée). Source des substituts de démonstration. */
export const FOREIGN_CONTRACTS = {
  sites: {
    schema: 'matrix', view: 'pub_sites', columns: [
      ['code', 'text'], ['libelle', 'text'], ['ville', 'text'], ['pays_iso2', 'character(2)'], ['ordre', 'integer'],
      ['actif', 'boolean'], ['filiale_code', 'text'], ['latitude', 'numeric(9,6)'], ['longitude', 'numeric(9,6)'],
    ],
  },
  projects: {
    schema: 'keystone', view: 'pub_projets', columns: [
      ['code', 'text'], ['numero', 'text'], ['code_analytique', 'text'], ['nature', 'text'], ['nom', 'text'], ['client_id', 'uuid'],
      ['client', 'text'], ['client_code3', 'text'], ['phase_code', 'text'], ['phase', 'text'], ['imputable', 'boolean'],
      ['chef_projet_matricule', 'text'], ['chef_projet_nom', 'text'], ['ville', 'text'], ['pays', 'text'], ['fournisseurs', 'text'],
      ['maj_le', 'timestamp with time zone'], ['capex_code', 'text'], ['besoin_ref', 'text'], ['client_interne', 'boolean'],
      ['filiale_code', 'text'], ['categorie', 'text'],
    ],
  },
  assignments: {
    schema: 'keystone', view: 'pub_affectations', columns: [
      ['source', 'text'], ['affectation_id', 'uuid'], ['matricule', 'text'], ['personne_nom', 'text'], ['projet_code', 'text'],
      ['projet_nom', 'text'], ['client', 'text'], ['activite_code', 'text'], ['activite', 'text'], ['du', 'date'], ['au', 'date'],
      ['lieu', 'text'], ['pays', 'text'], ['pays_iso2', 'character(2)'], ['heures_prevues', 'numeric'],
    ],
  },
  suppliers: {
    schema: 'keystone', view: 'pub_fournisseurs', columns: [['id', 'uuid'], ['name', 'text'], ['x3_code', 'text'], ['is_internal', 'boolean']],
  },
  // D12 (lot 5 de M-02) : effectivité proposée d'un ordre de modification, articles d'une demande.
  articles: {
    schema: 'keystone', view: 'pub_articles', columns: [
      ['ref', 'text'], ['name', 'text'], ['revision', 'text'], ['status', 'text'], ['part_type', 'text'], ['make_buy', 'text'],
    ],
  },
  bom: {
    schema: 'keystone', view: 'pub_nomenclatures', columns: [['project_code', 'text'], ['stage', 'text'], ['part_ref', 'text'], ['quantity', 'numeric']],
  },
  fleet: {
    schema: 'keystone', view: 'pub_parc_machines', columns: [
      ['number', 'text'], ['name', 'text'], ['client_name', 'text'], ['site_text', 'text'], ['project_code', 'text'], ['warranty_status', 'text'],
      ['part_ref', 'text'], ['fitted_revision', 'text'], ['type_machine_code', 'text'], ['livree_le', 'date'], ['maj_le', 'timestamp with time zone'],
    ],
  },
  titles: {
    schema: 'cursus', view: 'pub_titres', columns: [
      ['titre_id', 'text'], ['nature', 'text'], ['code', 'text'], ['libelle', 'text'], ['libelle_court', 'text'], ['validite_mois', 'integer'],
    ],
  },
  heldTitles: {
    schema: 'cursus', view: 'pub_titres_detenus', columns: [
      ['cursus_ref', 'text'], ['matricule', 'text'], ['titre_id', 'text'], ['nature', 'text'], ['code', 'text'], ['obtenu_le', 'date'],
      ['expire_le', 'date'], ['utilisable_jusqu_au', 'date'], ['prerequis_manquant', 'boolean'], ['organisme', 'text'], ['delivre_par', 'text'],
      ['session_prevue_le', 'date'], ['mesure', 'text'], ['mesure_le', 'date'],
    ],
  },
  documents: {
    schema: 'codex', view: 'pub_documents', columns: [
      ['id', 'text'], ['aliases', 'jsonb'], ['title', 'text'], ['origin', 'text'], ['attachment', 'text'], ['project_code', 'text'],
      ['program_code', 'text'], ['family', 'text'], ['type_code', 'text'], ['subtype', 'text'], ['department', 'text'], ['site', 'text'],
      ['owner_id', 'text'], ['owner_name', 'text'], ['author_id', 'text'], ['author_name', 'text'], ['conf', 'text'], ['keywords', 'jsonb'],
      ['lang', 'text'], ['state', 'text'], ['status', 'text'], ['rev_in_force', 'text'], ['rev_working', 'text'], ['issued_at', 'date'],
      ['review_due_at', 'date'], ['expires_at', 'date'], ['discipline', 'text'], ['project_phase', 'text'], ['work_package', 'text'],
      ['source_org', 'text'], ['external_ref', 'text'], ['legal_hold', 'boolean'], ['obsolete_at', 'date'], ['archived_at', 'date'],
      ['created_at', 'date'], ['modified_at', 'date'], ['distribution', 'text'], ['review_months', 'integer'], ['process_code', 'text'],
      ['owner_matricule', 'text'],
    ],
  },
  revisions: {
    schema: 'codex', view: 'pub_revisions_document', columns: [
      ['revision_id', 'integer'], ['doc_id', 'text'], ['letter', 'text'], ['status', 'text'], ['created_at', 'date'], ['effective_at', 'date'],
      ['approved_at', 'date'], ['in_force_at', 'date'], ['superseded_at', 'date'], ['modifier_id', 'text'], ['change_ref', 'text'],
      ['working_versions', 'integer'], ['last_version_id', 'integer'], ['last_version_n', 'integer'], ['last_version_date', 'date'],
      ['last_version_author_id', 'text'], ['last_version_author_name', 'text'], ['last_version_comment', 'text'], ['file_name', 'text'],
      ['mime', 'text'], ['size', 'integer'],
    ],
  },
  validations: {
    schema: 'codex', view: 'pub_validations', columns: [
      ['workflow_id', 'text'], ['doc_id', 'text'], ['revision', 'text'], ['requester_id', 'text'], ['due', 'date'], ['current_step', 'integer'],
      ['outcome', 'text'], ['created_at', 'date'], ['idx', 'integer'], ['function_key', 'text'], ['step_label', 'text'], ['assignee_id', 'text'],
      ['assignee_name', 'text'], ['done_on', 'date'], ['assignee_matricule', 'text'],
    ],
  },
  docTypes: {
    schema: 'codex', view: 'pub_types_document', columns: [
      ['code', 'text'], ['label_fr', 'text'], ['label_en', 'text'], ['family', 'text'], ['family_label_fr', 'text'], ['family_label_en', 'text'],
      ['family_group', 'text'], ['family_sort', 'integer'], ['origins', 'jsonb'], ['attachments', 'jsonb'], ['subtypes', 'jsonb'], ['circuit', 'jsonb'],
      ['retention_years', 'integer'], ['retention_trigger', 'text'], ['retention_disposition', 'text'], ['retention_basis', 'text'],
      ['conf_allowed', 'jsonb'], ['conf_default', 'text'], ['iso', 'text'], ['client_deliverable', 'boolean'], ['active', 'boolean'],
      ['source', 'text'], ['sort', 'integer'],
    ],
  },
} as const satisfies Record<string, ForeignContract>;

export type ForeignSourceKey = keyof typeof FOREIGN_CONTRACTS;
