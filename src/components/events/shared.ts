// Constantes et règles de l'écran « Signalements et événements », partagées par le serveur et les composants client.

import { EVENT_STEPS, STEP_ACTIONS, STEP_CLOSED } from '@/lib/domain';

/** Étape « Efficacité vérifiée » : toutes les actions liées doivent être clôturées, jusqu'à la clôture comprise. */
export const STEP_EFFICACY = EVENT_STEPS.indexOf('Efficacité vérifiée');

/** Pourquoi le passage à l'étape suivante est bloqué (null si possible). */
export function advanceBlocker(step: number, linked: readonly { status: string }[]): string | null {
  if (step >= STEP_CLOSED) return 'Événement déjà clôturé.';
  const next = step + 1;
  if (next === STEP_ACTIONS && linked.length === 0) {
    return `Liez au moins une action avant le passage à l'étape « ${EVENT_STEPS[STEP_ACTIONS]} ».`;
  }
  // Revérifié à la clôture : une action a pu être ajoutée ou rouverte après « Efficacité vérifiée ».
  if (next >= STEP_EFFICACY) {
    if (linked.length === 0) return `Aucune action liée : l'efficacité ne peut pas être vérifiée.`;
    const open = linked.filter((a) => a.status !== 'done').length;
    if (open) {
      const s = open > 1;
      return `${open} action${s ? 's' : ''} liée${s ? 's' : ''} ${s ? 'restent' : 'reste'} à clôturer après vérification d'efficacité avant le passage à l'étape « ${EVENT_STEPS[next]} ».`;
    }
  }
  return null;
}

/** Pourquoi aucune action ne peut plus être ajoutée à l'événement (null si possible). */
export function addActionBlocker(step: number): string | null {
  if (step < STEP_EFFICACY) return null;
  return `Événement à l'étape « ${EVENT_STEPS[Math.min(step, STEP_CLOSED)]} » : ramenez-le à l'étape « ${EVENT_STEPS[STEP_ACTIONS]} » (animateur QHSE ou direction) pour lui ajouter une action.`;
}

// ─── Fiche événement ────────────────────────────────────────────────────────

export const INJURIES: [key: string, label: string][] = [['arret', 'Avec arrêt'], ['sans_arret', 'Sans arrêt'], ['soins', 'Soins sans arrêt']];
export const INJURY_KEYS = INJURIES.map(([k]) => k);
export const injuryLabel = (k: string | null | undefined) => INJURIES.find(([key]) => key === k)?.[1] ?? '—';

/** Types d'événement qui portent une origine de non-conformité. */
export const hasNcOrigin = (type: string) => type === 'NC' || type === 'RC';

// ─── Analyse des causes ─────────────────────────────────────────────────────

export const FIVE_M = ['Matière', 'Matériel', 'Méthode', "Main-d'œuvre", 'Milieu'] as const;
export const FIVE_M_HINTS = [
  'Matières, consommables, pièces, accessoires',
  'Machines, équipements, outillage',
  'Modes opératoires, consignes, organisation',
  'Compétences, formation, effectif',
  'Environnement, encombrement, éclairage, météo',
];

/** Arbre des causes : [niveau 0–3, libellé, fait principal]. */
export type TreeLine = [level: number, text: string, isMainFact: boolean];
export const MAX_TREE_LEVEL = 3;
export const MAX_TREE_LINES = 40;
export const MAX_WHYS = 7;
export type D8Content = { current: number; notes?: string[] };

/** Chaque ligne descend au plus d'un niveau sous la précédente ; la première est le fait ultime (niveau 0). */
export function normalizeTree<T extends { level: number }>(lines: T[]): T[] {
  let prev = -1;
  return lines.map((l) => {
    const level = Math.max(0, Math.min(l.level, prev + 1, MAX_TREE_LEVEL));
    prev = level;
    return level === l.level ? l : { ...l, level };
  });
}

/** Lecture tolérante du contenu stocké en base (jsonb). */
export function readFiveM(content: unknown): Map<string, string> {
  const rows = Array.isArray(content) ? content : [];
  return new Map(rows.filter((r): r is [string, string] => Array.isArray(r) && typeof r[0] === 'string' && typeof r[1] === 'string'));
}
export function readTree(content: unknown): TreeLine[] {
  const rows = Array.isArray(content) ? content : [];
  return rows
    .filter((r) => Array.isArray(r) && typeof r[1] === 'string')
    .map((r) => [Number(r[0]) || 0, r[1] as string, !!r[2]] as TreeLine);
}
export function readWhys(content: unknown): string[] {
  return Array.isArray(content) ? content.filter((s): s is string => typeof s === 'string') : [];
}
export function readD8(content: unknown): { current: number; notes: string[] } {
  const c = (content && typeof content === 'object' && !Array.isArray(content) ? content : {}) as Partial<D8Content>;
  const current = Number.isInteger(c.current) ? Math.max(0, Math.min(8, c.current as number)) : 0;
  const notes = Array.isArray(c.notes) ? c.notes.map((n) => (typeof n === 'string' ? n : '')) : [];
  return { current, notes };
}

// ─── Pièces jointes et photos ───────────────────────────────────────────────

export const MAX_PHOTOS = 4;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Volume maximal d'un envoi (les server actions acceptent 11 Mo, marge multipart comprise). */
export const MAX_BATCH_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_BATCH = 10;
export const ATTACH_ACCEPT = 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.pptx,.txt,.csv';

export const fmtSize = (n: number) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;

export function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return 'ph-image';
  if (mime === 'application/pdf') return 'ph-file-pdf';
  if (/word/.test(mime)) return 'ph-file-doc';
  if (/sheet|excel/.test(mime)) return 'ph-file-xls';
  if (/presentation/.test(mime)) return 'ph-file-ppt';
  if (mime === 'text/csv') return 'ph-file-csv';
  if (mime.startsWith('text/')) return 'ph-file-text';
  return 'ph-file';
}

/** Pièce jointe telle que la fiche l'affiche. */
export type AttachmentItem = { id: string; name: string; mime: string; size: number; url: string; isImage: boolean };
