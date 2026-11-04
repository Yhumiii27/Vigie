// Vues publiées par les autres outils et lues par Vigie (lot 0 de la convergence M-02, docs/specs/convergence-m02.md § 2).
// Hors de drizzle.config.ts (qui ne lit que src/db/schema.ts) : drizzle-kit n'en tire aucune migration. Déclarées
// `.existing()` (aucune création), l'objet pgSchema de l'autre outil jamais exporté (exporté, drizzle-kit écrirait un
// CREATE SCHEMA ; plan de Matrix, § 1.3). Colonnes, types et ordre recopiés des contrats publiés (FOREIGN_CONTRACTS,
// comparés à test/fixtures/contracts/*.json et aux substituts de démonstration par test/integration/foreign-sources.test.ts).
//
// Seuls src/lib/foreign/ (lectures) et src/db/foreign-substitutes.ts (substituts de démonstration) importent ce module :
// aucun autre fichier de Vigie ne nomme un schéma d'un autre outil (garde-fou du même test). Aucune écriture vers ces
// schémas (décision M-17 de Matrix).

import { boolean, char, date, integer, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const matrix = pgSchema('matrix');
const keystone = pgSchema('keystone');
const cursus = pgSchema('cursus');

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
} as const satisfies Record<string, ForeignContract>;

export type ForeignSourceKey = keyof typeof FOREIGN_CONTRACTS;
