// Pagination d'une liste (QUA-21, d'abord la liste des événements) — règles pures, sans import.
//
// URL (convention de src/lib/url-state.ts) : `?page=<n>` (à partir de 1, 1 omis) et `?taille=<n>` (éléments par page, parmi
// PAGE_SIZES, DEFAULT_PAGE_SIZE omis). Valeur illisible : défaut ; page au-delà de la dernière : la dernière. Sans `?page=`,
// une fiche demandée par lien profond (`?sel=`, échéances, notifications) ouvre la page qui la contient : aucun lien
// existant ne change. Un changement d'onglet, de filtre ou de recherche revient à la première page (paramètre retiré).

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

type Param = string | string[] | undefined;
const first = (v: Param) => (Array.isArray(v) ? v[0] : v);
const positiveInt = (v: Param): number | null => {
  const s = first(v)?.trim();
  if (!s || !/^\d{1,6}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 ? n : null;
};

/** Taille de page demandée (`?taille=`), parmi PAGE_SIZES, sinon DEFAULT_PAGE_SIZE. */
export function parsePageSize(v: Param): number {
  const n = positiveInt(v);
  return n && (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}

/** Page demandée (`?page=`), ou null si absente ou illisible. */
export const parsePage = (v: Param): number | null => positiveInt(v);

export type Page<T> = {
  items: T[];
  /** Page affichée (1 à pages). */
  page: number;
  /** Nombre de pages (au moins 1, même pour une liste vide). */
  pages: number;
  total: number;
  /** Rang (à partir de 1) du premier et du dernier élément affichés ; 0 pour une liste vide. */
  from: number;
  to: number;
  size: number;
};

/**
 * Page d'une liste. `page` null : page de l'élément `selected` s'il figure dans la liste (lien profond), sinon la première ;
 * page au-delà de la dernière : la dernière.
 */
export function paginate<T>(list: readonly T[], opts: { page: number | null; size: number; selected?: (item: T) => boolean }): Page<T> {
  const size = Math.max(1, Math.floor(opts.size));
  const pages = Math.max(1, Math.ceil(list.length / size));
  let page = opts.page;
  if (page == null) {
    const at = opts.selected ? list.findIndex(opts.selected) : -1;
    page = at >= 0 ? Math.floor(at / size) + 1 : 1;
  }
  page = Math.min(Math.max(1, page), pages);
  const start = (page - 1) * size;
  const items = list.slice(start, start + size);
  return { items, page, pages, total: list.length, from: items.length ? start + 1 : 0, to: start + items.length, size };
}

/** Paramètres d'URL de la pagination (valeurs par défaut omises). */
export const pageParams = (page: number, size: number): { page?: string; taille?: string } => ({
  page: page > 1 ? String(page) : undefined,
  taille: size !== DEFAULT_PAGE_SIZE ? String(size) : undefined,
});
