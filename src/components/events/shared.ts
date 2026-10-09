// Constantes et règles de l'écran « Signalements et événements », partagées par le serveur et les composants client.

import { EVENT_STEPS, STEP_ACTIONS, STEP_CLOSED, STEP_QUALIFIED } from '@/lib/domain';

/** Étape « Efficacité vérifiée » : toutes les actions liées doivent être clôturées, jusqu'à la clôture comprise. */
export const STEP_EFFICACY = EVENT_STEPS.indexOf('Efficacité vérifiée');

/** Données de la fiche qui conditionnent le passage à l'étape suivante. */
export type AdvanceContext = { pilotId: string | null; hasAnalysis: boolean; dismissed: boolean; methodLabel: string };

/**
 * Pourquoi le passage à l'étape suivante est bloqué (null si possible) :
 * pilote désigné pour « Qualifié », analyse saisie puis au moins une action pour « Actions »,
 * actions clôturées pour « Efficacité vérifiée » et la clôture.
 */
export function advanceBlocker(step: number, allLinked: readonly { status: string }[], ctx: AdvanceContext): string | null {
  // Les actions annulées restent affichées sur la fiche mais ne comptent ni comme liées ni comme ouvertes.
  const linked = allLinked.filter((a) => a.status !== 'cancelled');
  if (ctx.dismissed) return 'Événement classé sans suite.';
  if (step >= STEP_CLOSED) return 'Événement déjà clôturé.';
  const next = step + 1;
  if (next === STEP_QUALIFIED && !ctx.pilotId) {
    return `Désignez un pilote (Modifier) avant le passage à l'étape « ${EVENT_STEPS[STEP_QUALIFIED]} ».`;
  }
  if (next === STEP_ACTIONS) {
    if (!ctx.hasAnalysis) return `Saisissez l'analyse des causes (méthode « ${ctx.methodLabel} ») avant le passage à l'étape « ${EVENT_STEPS[STEP_ACTIONS]} ».`;
    if (linked.length === 0) return `Liez au moins une action avant le passage à l'étape « ${EVENT_STEPS[STEP_ACTIONS]} ».`;
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
export function addActionBlocker(step: number, dismissed = false): string | null {
  if (dismissed) return 'Événement classé sans suite : aucune action ne peut lui être ajoutée.';
  if (step < STEP_EFFICACY) return null;
  return `Événement à l'étape « ${EVENT_STEPS[Math.min(step, STEP_CLOSED)]} » : ramenez-le à l'étape « ${EVENT_STEPS[STEP_ACTIONS]} » (animateur QHSE ou direction) pour lui ajouter une action.`;
}

/** Pourquoi la fiche est en lecture seule (classée sans suite ou clôturée), null si modifiable. */
export function eventLockReason(e: { step: number; dismissedAt: Date | string | null }): string | null {
  if (e.dismissedAt) return 'Événement classé sans suite : annulez le classement (animateur QHSE ou direction) pour le modifier.';
  if (e.step >= STEP_CLOSED) return 'Événement clôturé : rouvrez-le (animateur QHSE ou direction) pour le modifier.';
  return null;
}

/** Accident du travail à déclarer à la CPAM (sous 48 h) ; les soins sans arrêt vont au registre des accidents bénins. */
export const needsCpam = (e: { type: string; injury: string | null }) => e.type === 'AT' && e.injury !== 'soins';

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

/** Vrai si l'analyse de la méthode donnée contient au moins un élément saisi. */
export function analysisFilled(method: string, content: unknown): boolean {
  if (content == null) return false;
  if (method === '5m') return readFiveM(content).size > 0;
  if (method === 'tree') return readTree(content).length > 0;
  if (method === 'why') return readWhys(content).length > 0;
  const d8 = readD8(content);
  return d8.current > 0 || d8.notes.some(Boolean);
}

// ─── Pièces jointes et photos ───────────────────────────────────────────────

export const MAX_PHOTOS = 4;
// Constantes et vignettes communes à toutes les pièces jointes : src/lib/attachments.ts (réexportées ici).
export { ATTACH_ACCEPT, MAX_BATCH_BYTES, MAX_FILES_PER_BATCH, MAX_FILE_BYTES, fileIcon, fmtSize, type AttachmentItem } from '@/lib/attachments';

// ─── Parcours terrain ───────────────────────────────────────────────────────

/** Paramètres du QR code de poste (?poste=&site=, ou ?lieu= libre) conservés entre « Signaler » et « Mes signalements ». */
export function reportQuery(sp: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const k of ['poste', 'site', 'lieu']) {
    const v = sp[k];
    if (typeof v === 'string' && v) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
