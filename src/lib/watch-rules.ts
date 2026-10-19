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
