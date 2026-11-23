// Recherche globale (TDB-18, réponse du service QHSE du 09/11/2026 : « Oui il faut une recherche tous modules ») : champ de
// la barre latérale (bureau et tiroir du téléphone), page /recherche?q=. Règles pures : normalisation, correspondance et
// classement d'un élément, limite par module. Les éléments viennent des chargements des écrans eux-mêmes (même site, même
// périmètre, mêmes droits, src/lib/data/search.ts) : la recherche ne lit jamais rien qu'un écran ne montrerait pas.

export const SEARCH_PATH = '/recherche';
/** Nombre minimal de caractères (hors espaces) d'une recherche. */
export const SEARCH_MIN = 2;
/** Longueur maximale retenue. */
export const SEARCH_MAX = 100;
/** Résultats affichés par module ; au-delà, « voir dans l'écran » quand l'écran a sa propre recherche (?q=). */
export const SEARCH_LIMIT = 20;

/** Texte comparable : minuscules, sans accents, espaces réduits. */
export function normalizeSearch(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
}

/** Recherche lue dans l'URL : texte nettoyé (≤ 100 caractères), ou null si trop courte. */
export function parseSearchQuery(raw: string | string[] | undefined): string | null {
  const v = (Array.isArray(raw) ? raw[0] : raw) ?? '';
  const q = v.replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX);
  return normalizeSearch(q).replace(/\s/g, '').length >= SEARCH_MIN ? q : null;
}

/** Élément cherchable : référence (EV-…, AC-…, PP-…), intitulé, texte secondaire facultatif, lien vers la fiche. */
export type SearchItem = { ref: string; title: string; extra?: string | null; sub?: string | null; href: string };

/**
 * Score d'un élément pour la recherche `q` (null : aucune correspondance). Tous les mots de la recherche doivent figurer
 * dans la référence, l'intitulé ou le texte secondaire. Référence exacte > début de référence > référence contenue >
 * intitulé commençant par un mot > intitulé contenant > texte secondaire.
 */
export function searchScore(q: string, item: Pick<SearchItem, 'ref' | 'title' | 'extra'>): number | null {
  const query = normalizeSearch(q);
  if (!query) return null;
  const ref = normalizeSearch(item.ref);
  const title = normalizeSearch(item.title);
  const extra = normalizeSearch(item.extra ?? '');
  const words = query.split(' ');
  const all = `${ref} ${title} ${extra}`;
  if (!words.every((w) => all.includes(w))) return null;
  if (ref === query) return 100;
  if (ref.startsWith(query)) return 80;
  if (ref.includes(query)) return 60;
  if (title.split(/[^a-z0-9]+/).some((w) => w.startsWith(words[0])) && words.every((w) => title.includes(w))) return 45;
  if (words.every((w) => title.includes(w) || ref.includes(w))) return 30;
  return 10;
}

/** Éléments correspondants, du meilleur score au moins bon (ordre d'origine à score égal), limités à `limit`. */
export function rankSearch<T extends SearchItem>(items: readonly T[], q: string, limit = SEARCH_LIMIT): { items: T[]; total: number } {
  const hits = items
    .map((item, i) => ({ item, i, score: searchScore(q, item) }))
    .filter((h): h is { item: T; i: number; score: number } => h.score !== null)
    .sort((a, b) => b.score - a.score || a.i - b.i);
  return { items: hits.slice(0, limit).map((h) => h.item), total: hits.length };
}
