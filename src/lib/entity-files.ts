// Pièces jointes génériques des fiches (paquet 6) : types d'entité, libellés et règles pures, partagés par le serveur
// (src/server/entity-files.ts, src/lib/uploads.ts : canReadAttachment) et les composants (src/components/EntityFiles.tsx).
// Sans dépendance serveur.

/**
 * Types d'entité dont les pièces jointes s'ajoutent et se retirent après la saisie par addEntityFiles / removeEntityFile :
 * - `duerp_version` (DUE-09) : DUERP signé d'une version (identifiant = numéro de version) ;
 * - `risk` (DUE-09) : justificatifs d'un risque du DUERP ;
 * - `requirement` (VEI-10, VEI-08) : texte réglementaire joint à une exigence ;
 * - `requirement_evaluation` (VEI-08) : preuves d'une évaluation de conformité ;
 * - `control_record` (VEI-08) : rapport d'un contrôle réalisé ;
 * - `review` / `review_item` (AUD-17) : pièces de la revue de direction et d'un élément d'entrée ;
 * - `waste_entry` (DOC-11) : bordereau, certificat d'acceptation ou de traitement d'un enlèvement.
 */
export const ENTITY_FILE_KINDS = {
  duerp_version: { label: 'DUERP signé', journal: 'duerp_version' },
  risk: { label: 'Justificatif', journal: 'risk' },
  requirement: { label: 'Texte joint', journal: 'requirement' },
  requirement_evaluation: { label: "Preuve d'évaluation", journal: 'requirement' },
  control_record: { label: 'Rapport de contrôle', journal: 'control' },
  review: { label: 'Pièce de la revue', journal: 'review' },
  review_item: { label: "Pièce d'un élément d'entrée", journal: 'review' },
  waste_entry: { label: "Pièce de l'enlèvement", journal: 'waste_entry' },
} as const satisfies Record<string, { label: string; journal: string }>;

export type EntityFileKind = keyof typeof ENTITY_FILE_KINDS;
export const ENTITY_FILE_KIND_KEYS = Object.keys(ENTITY_FILE_KINDS) as EntityFileKind[];
export const isEntityFileKind = (v: unknown): v is EntityFileKind => typeof v === 'string' && v in ENTITY_FILE_KINDS;

/** Identifiant d'entité reçu du navigateur : numérique pour les tables à clé serial, numéro de version pour le DUERP. */
export function validEntityId(kind: EntityFileKind, id: string): boolean {
  if (kind === 'duerp_version') return /^[\w.\-]{1,40}$/.test(id);
  return /^[1-9]\d{0,9}$/.test(id);
}

/** Phrase du journal à l'ajout : « 2 justificatifs ajoutés », « DUERP signé ajouté ». */
export function attachSummary(kind: EntityFileKind, count: number, context?: string): string {
  const label = ENTITY_FILE_KINDS[kind].label;
  const head = count > 1 ? `${count} fichiers ajoutés (${label.toLowerCase()})` : `${label} ajouté`;
  return context ? `${head} · ${context}` : head;
}

/** Phrase du journal au retrait : « Justificatif « bon.pdf » retiré ». */
export function detachSummary(kind: EntityFileKind, fileName: string, context?: string): string {
  const head = `${ENTITY_FILE_KINDS[kind].label} « ${fileName} » retiré`;
  return context ? `${head} · ${context}` : head;
}
