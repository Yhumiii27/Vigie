// Règles pures de la veille réglementaire (client et serveur).

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
