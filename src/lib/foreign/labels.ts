// Libellés des sources lues chez les autres outils (lot 0 de M-02) : module pur, utilisable côté navigateur (onglet
// « Connecteurs », bandeaux « source indisponible ») et par les règles. Clés stockées : src/lib/state-keys.ts.

/** Source lue : outil propriétaire, objet, vue publiée (« schéma.vue », clé de sync_runs.source). */
export const SOURCES = {
  sites: { tool: 'Matrix', label: 'Sites', view: 'matrix.pub_sites', cache: true },
  projects: { tool: 'Keystone', label: 'Projets', view: 'keystone.pub_projets', cache: false },
  assignments: { tool: 'Keystone', label: 'Affectations', view: 'keystone.pub_affectations', cache: true },
  suppliers: { tool: 'Keystone', label: 'Fournisseurs', view: 'keystone.pub_fournisseurs', cache: false },
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
