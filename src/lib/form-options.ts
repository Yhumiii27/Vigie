// Listes de choix des formulaires : helpers sans accès serveur (composants client et serveur). Les listes elles-mêmes sont
// chargées par loadFormOptions (src/lib/data/options.ts, serveur).

export type Option = readonly [value: string, label: string];

/** Libellé d'une valeur enregistrée absente des listes de choix : personne sortie de l'effectif (formulaires de modification). */
export const LEFT_SUFFIX = " — sorti de l'effectif";
/** Libellé d'une valeur enregistrée absente des listes de choix : site archivé. */
export const ARCHIVED_SITE_SUFFIX = ' (archivé)';

/**
 * Ajoute à une liste de choix la valeur déjà enregistrée si elle n'y figure plus (personne sortie, site archivé, projet
 * Keystone clos…), avec son libellé (la valeur à défaut), en fin de liste ou en tête (`at: 'start'`). Seule copie (QUA-25).
 */
export const withCurrent = (options: readonly Option[], value: string | null | undefined, label?: string | null, at: 'end' | 'start' = 'end') => {
  if (!value || options.some(([v]) => v === value)) return options;
  const current: Option = [value, label ?? value];
  return at === 'start' ? [current, ...options] : [...options, current];
};

/**
 * Valeur proposée par défaut pour un nouveau choix : `value` si la liste la propose encore, sinon `fallback` — jamais une
 * personne sortie ni un site archivé (DUE-15 : validateur de la version précédente sorti de l'effectif).
 */
export const offeredOr = (options: readonly Option[], value: string | null | undefined, fallback: string | null) =>
  value && options.some(([v]) => v === value) ? value : fallback;
