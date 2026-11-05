// Libellés des sources lues chez les autres outils (lot 0 de M-02) : module pur, utilisable côté navigateur (onglet
// « Connecteurs », bandeaux « source indisponible ») et par les règles. Clés stockées : src/lib/state-keys.ts.

/** Source lue : outil propriétaire, objet, vue publiée (« schéma.vue », clé de sync_runs.source). */
export const SOURCES = {
  sites: { tool: 'Matrix', label: 'Sites', view: 'matrix.pub_sites', cache: true },
  projects: { tool: 'Keystone', label: 'Projets', view: 'keystone.pub_projets', cache: false },
  assignments: { tool: 'Keystone', label: 'Affectations', view: 'keystone.pub_affectations', cache: true },
  suppliers: { tool: 'Keystone', label: 'Fournisseurs', view: 'keystone.pub_fournisseurs', cache: false },
  titles: { tool: 'Cursus', label: 'Titres', view: 'cursus.pub_titres', cache: true },
  heldTitles: { tool: 'Cursus', label: 'Titres détenus', view: 'cursus.pub_titres_detenus', cache: false },
  documents: { tool: 'Codex', label: 'Documents', view: 'codex.pub_documents', cache: false },
  revisions: { tool: 'Codex', label: 'Révisions des documents', view: 'codex.pub_revisions_document', cache: false },
  validations: { tool: 'Codex', label: 'Circuits de validation', view: 'codex.pub_validations', cache: false },
  docTypes: { tool: 'Codex', label: 'Types de document', view: 'codex.pub_types_document', cache: false },
} as const;
export type SourceKey = keyof typeof SOURCES;
export const SOURCE_KEYS = Object.keys(SOURCES) as SourceKey[];

/** État d'un site de Vigie dans la liste de Matrix au dernier rafraîchissement (sites.matrix_state). */
export const MATRIX_SITE_STATES = {
  actif: { label: 'Actif dans Matrix', tone: 'ok' },
  ferme: { label: 'Fermé dans Matrix', tone: 'warn' },
  absent: { label: 'Absent de Matrix', tone: 'warn' },
} as const;
export type MatrixSiteState = keyof typeof MATRIX_SITE_STATES;

/** État d'un titre suivi par Vigie dans le catalogue de Cursus au dernier rafraîchissement (training_titles.cursus_state, D08). */
export const CURSUS_TITLE_STATES = {
  actif: { label: 'Au catalogue de Cursus', tone: 'ok' },
  absent: { label: 'Absent du catalogue de Cursus', tone: 'warn' },
} as const;
export type CursusTitleState = keyof typeof CURSUS_TITLE_STATES;

/** Mention des données de l'écran Habilitations, tenues par Cursus (décision CV-01 du 04/11/2026). */
export const CURSUS_HELD_NOTICE = 'Données tenues par Cursus (RH) : formations, habilitations, sessions et attestations se saisissent dans Cursus ; Vigie les consulte.';

/** Mention de l'écran Documents, tenu par Codex (lot 4 de M-02, décision CV-05 du 05/11/2026). */
export const CODEX_DOCUMENTS_NOTICE = 'Documents tenus par Codex (GED) : création, révisions, circuits de validation, revues et retraits se font dans Codex ; Vigie les consulte.';

/** Issue d'un passage de rafraîchissement ou d'une lecture contrôlée (sync_runs.status). */
export const SYNC_STATUSES = {
  ok: { label: 'Lu', tone: 'ok' },
  error: { label: 'Erreur', tone: 'danger' },
  unavailable: { label: 'Source indisponible', tone: 'warn' },
} as const;
export type SyncStatus = keyof typeof SYNC_STATUSES;

/** Origine d'une affectation de Keystone (keystone_assignments.source, contrat pub_affectations). */
export const ASSIGNMENT_SOURCES = { rotation: 'Rotation de chantier', planning: 'Planning' } as const;

/** Message d'une source indisponible (bandeau, champ de formulaire) : jamais d'absence silencieuse. */
export const unavailableMessage = (key: SourceKey) =>
  `${SOURCES[key].label} de ${SOURCES[key].tool} indisponibles : la vue ${SOURCES[key].view} ne peut pas être lue (lien de lecture à demander à Matrix, ou outil pas encore sur le serveur commun).`;

/** Libellé affiché d'un projet Keystone : « code · client » d'après la vue, le code seul s'il n'y est pas, sinon l'ancien libellé saisi. */
export function projectText(code: string | null, legacy: string | null, byCode: ReadonlyMap<string, { client: string | null }> | null): string | null {
  if (!code) return legacy;
  const p = byCode?.get(code);
  return p?.client ? `${code} · ${p.client}` : code;
}
