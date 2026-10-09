// Référentiels des documents maîtrisés (ISO 9001 §7.5), partagés par le serveur et les composants client.

import type { Tone } from '@/lib/domain';

export type DocType = 'politique' | 'procedure' | 'instruction' | 'formulaire' | 'enregistrement';

/** Types de documents : préfixe de référence, libellés et périodicité de revue proposée (mois). */
export const DOC_TYPES: Record<DocType, { label: string; plural: string; prefix: string; icon: string; reviewMonths: number }> = {
  politique: { label: 'Politique', plural: 'Politiques', prefix: 'POL', icon: 'ph-flag', reviewMonths: 12 },
  procedure: { label: 'Procédure', plural: 'Procédures', prefix: 'PR', icon: 'ph-flow-arrow', reviewMonths: 36 },
  instruction: { label: 'Instruction de travail', plural: 'Instructions', prefix: 'IT', icon: 'ph-wrench', reviewMonths: 24 },
  formulaire: { label: 'Formulaire', plural: 'Formulaires', prefix: 'FO', icon: 'ph-note-pencil', reviewMonths: 36 },
  enregistrement: { label: 'Enregistrement', plural: 'Enregistrements', prefix: 'EN', icon: 'ph-archive', reviewMonths: 36 },
};
export const DOC_TYPE_KEYS = Object.keys(DOC_TYPES) as DocType[];

/** Processus de l'entreprise : le code entre dans la référence (PR-QHSE-003, IT-MON-012…). */
export const PROCESSES: Record<string, string> = {
  QHSE: 'Management QHSE',
  DIR: 'Direction',
  COM: 'Commercial',
  BE: "Bureau d'études",
  ACH: 'Achats',
  USI: 'Usinage',
  MON: 'Montage',
  ESS: 'Essais',
  MAG: 'Magasin et logistique',
  RH: 'Ressources humaines',
};
export const PROCESS_KEYS = Object.keys(PROCESSES);
export const processLabel = (code: string) => (Object.hasOwn(PROCESSES, code) ? PROCESSES[code] : code);

export type VersionStatus = 'brouillon' | 'en_revue' | 'approuve' | 'archive';
export const VERSION_STATUS_KEYS: VersionStatus[] = ['brouillon', 'en_revue', 'approuve', 'archive'];

/** Libellé d'une version ; une version archivée sans approbation est une révision abandonnée. */
export function versionStatus(status: string, approvedOn: string | null): { label: string; tone: Tone } {
  if (status === 'brouillon') return { label: 'Brouillon', tone: 'neutral' };
  if (status === 'en_revue') return { label: 'En revue', tone: 'warn' };
  if (status === 'approuve') return { label: 'En vigueur', tone: 'ok' };
  return { label: approvedOn ? 'Archivée' : 'Abandonnée', tone: 'neutral' };
}

/** Statut d'un document, déduit de ses versions. */
export type DocStatus = 'vigueur' | 'revue' | 'brouillon' | 'obsolete';
export const DOC_STATUS: Record<DocStatus, { label: string; tone: Tone }> = {
  vigueur: { label: 'En vigueur', tone: 'ok' },
  revue: { label: 'En revue', tone: 'warn' },
  brouillon: { label: 'Brouillon', tone: 'neutral' },
  obsolete: { label: 'Obsolète', tone: 'neutral' },
};

/** Filtres de statut (paramètre « statut ») : un document peut relever de plusieurs. */
export const STATUS_FILTERS = [
  ['vigueur', 'En vigueur'],
  ['revue', 'En revue · à approuver'],
  ['retard', 'Revue en retard'],
  ['brouillon', 'Brouillon en cours'],
  ['obsolete', 'Obsolètes'],
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number][0];

/** Préfixe de référence automatique : « PR-QHSE- ». */
export const refPrefix = (type: DocType, process: string) => `${DOC_TYPES[type].prefix}-${process}-`;

/** Référence saisie librement : majuscules, chiffres et tirets (ex. PR-QHSE-003, IT-MON-012). */
export const REF_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/;

/** Ordre des indices de version : A < B < … < Z < AA < AB… */
export const compareVersions = (a: string, b: string) => a.length - b.length || a.localeCompare(b);

/** Indice suivant : A → B, Z → AA, AZ → BA. */
export function nextVersion(existing: string[]): string {
  if (!existing.length) return 'A';
  const last = [...existing].sort(compareVersions).at(-1)!.toUpperCase();
  const chars = last.split('');
  let i = chars.length - 1;
  while (i >= 0 && chars[i] === 'Z') { chars[i] = 'A'; i--; }
  if (i < 0) return `A${chars.join('')}`;
  chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
  return chars.join('');
}
