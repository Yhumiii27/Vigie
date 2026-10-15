// Listes de choix des formulaires : helpers sans accès serveur (composants client et serveur). Les listes elles-mêmes sont
// chargées par loadFormOptions (src/lib/data/options.ts, serveur).

export type Option = readonly [value: string, label: string];

/** Libellé d'une valeur enregistrée absente des listes de choix : personne sortie de l'effectif (formulaires de modification). */
export const LEFT_SUFFIX = " — sorti de l'effectif";
/** Libellé d'une valeur enregistrée absente des listes de choix : site archivé. */
export const ARCHIVED_SITE_SUFFIX = ' (archivé)';

/** Ajoute à une liste de choix la valeur déjà enregistrée si elle n'y figure plus (personne sortie, site archivé…). */
export const withCurrent = (options: readonly Option[], value: string | null | undefined, label: string | undefined) =>
  value && !options.some(([v]) => v === value) ? [...options, [value, label ?? value] as Option] : options;
