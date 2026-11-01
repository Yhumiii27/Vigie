// Règles pures de la veille réglementaire (client et serveur).

import { REQUIREMENT_NEEDS_ACTION, isClosedActionStatus } from './domain';

/** Sites officiels de publication des textes cités par une exigence de veille (VEI-10). */
export const LEGAL_TEXT_HOSTS = ['legifrance.gouv.fr', 'eur-lex.europa.eu'] as const;

/**
 * Lien vers le texte d'une exigence (VEI-10) : adresse https d'un site officiel (Légifrance, EUR-Lex pour les règlements
 * européens) ; message d'erreur, ou null si l'adresse est admise.
 */
export function legalTextUrlError(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Adresse invalide : collez le lien complet du texte (https://www.legifrance.gouv.fr/…).';
  }
  if (url.protocol !== 'https:') return 'Adresse https attendue.';
  const host = url.hostname.toLowerCase();
  if (!LEGAL_TEXT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return 'Lien attendu vers Légifrance (legifrance.gouv.fr) ou EUR-Lex (eur-lex.europa.eu).';
  return null;
}

/** L'exigence s'applique-t-elle au site (VEI-10) ? `siteIds` vide : tous les sites ; sans site sélectionné : oui. */
export const appliesToSite = (siteIds: readonly string[] | null | undefined, siteId: string | null) => !siteId || !siteIds?.length || siteIds.includes(siteId);

/**
 * Code commun d'un équipement avec les moyens d'essais de Crucible (`controls.equipment_code`, vue `pub_controles`) :
 * majuscules, chiffres et tirets, 2 à 32 caractères, commençant et finissant par une lettre ou un chiffre (ex. `PDE-PIL`,
 * `LAB67`). Format des codes de Crucible (`/^[A-Z0-9][A-Z0-9-]{1,19}$/`, src/domain/admin.ts) admis tel quel, sauf un
 * tiret final. Non unique : un même équipement porte plusieurs contrôles (VGP levage, vérification électrique…).
 */
export const EQUIPMENT_CODE = /^[A-Z0-9](?:[A-Z0-9-]{0,30}[A-Z0-9])$/;

/** Saisie d'un code d'équipement mise en forme : espaces retirés aux bords, majuscules ; null si vide. */
export function normalizeEquipmentCode(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toUpperCase();
  return v || null;
}

/** Message d'erreur d'un code d'équipement déjà mis en forme, ou null s'il est admis (vide compris). */
export function equipmentCodeError(code: string | null): string | null {
  if (!code) return null;
  if (code.length < 2 || code.length > 32) return 'Code de 2 à 32 caractères.';
  if (!EQUIPMENT_CODE.test(code)) return 'Lettres majuscules, chiffres et tirets seulement, sans tiret au début ni à la fin (ex. PDE-PIL).';
  return null;
}

/** Évaluation de conformité de l'historique d'une exigence (requirement_evaluations). */
export type EvaluationEntry = { id: number; evaluatedOn: string; evaluation: string; note: string | null; cancelled: boolean };

/**
 * Évaluation courante d'une exigence d'après son historique (VEI-16) : la plus récente non annulée (date, puis saisie la
 * plus récente) ; sans évaluation restante : « À évaluer », sans date ni précision.
 */
export function currentEvaluation(entries: readonly EvaluationEntry[]): { evaluation: string; evaluationNote: string | null; lastEvaluatedOn: string | null } {
  const [last] = entries.filter((e) => !e.cancelled)
    .sort((a, b) => b.evaluatedOn.localeCompare(a.evaluatedOn) || b.id - a.id);
  return last ? { evaluation: last.evaluation, evaluationNote: last.note, lastEvaluatedOn: last.evaluatedOn } : { evaluation: 'a_evaluer', evaluationNote: null, lastEvaluatedOn: null };
}

/**
 * Boucle à fermer (VEI-05) : l'action du plan d'actions liée à un écart ou à des réserves est close alors que l'écart ou
 * les réserves restent ouverts — vérifiée « Efficace » (une vérification « Non efficace » ouvre une action de suite, qui
 * prend le relais du lien), ou abandonnée. L'écart se ferme par une nouvelle évaluation de l'exigence (« Réévaluer »),
 * les réserves par un nouveau contrôle sans réserve (« Enregistrer le contrôle ») ou par une nouvelle action ; rien n'est
 * modifié d'office.
 */
export type LoopBack = { actionId: string; abandoned: boolean };

/** Action liée : avancement et résultat de la vérification (null : action introuvable). */
type LinkedAction = { status: string; effective?: boolean | null } | null | undefined;

const loopBack = (open: boolean, actionId: string | null, action: LinkedAction): LoopBack | null => {
  if (!open || !actionId || !action || !isClosedActionStatus(action.status)) return null;
  const abandoned = action.status === 'abandonnee';
  // Vérifiée non efficace (ou sans résultat, reprise) : l'action de suite prend le relais, pas de relance.
  if (!abandoned && action.effective !== true) return null;
  return { actionId, abandoned };
};

/** Exigence en vigueur évaluée en écart (ou analyse d'écart) dont l'action liée est close. */
export function requirementLoopBack(r: { evaluation: string; actionId: string | null; archived: boolean }, action: LinkedAction): LoopBack | null {
  return loopBack(!r.archived && (REQUIREMENT_NEEDS_ACTION as readonly string[]).includes(r.evaluation), r.actionId, action);
}

/** Équipement en service dont les réserves restent inscrites alors que l'action de levée est close. */
export function controlLoopBack(c: { reserves: string | null; actionId: string | null; archived: boolean }, action: LinkedAction): LoopBack | null {
  return loopBack(!c.archived && !!c.reserves, c.actionId, action);
}
