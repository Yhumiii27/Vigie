// Recherche de pages ⌘K de la barre latérale (Norma § 7, VG-N07 ; comme Arche et Keystone) : filtre les entrées de la
// navigation déjà ouvertes au rôle (NAV de src/lib/domain.ts, filtrée par la mise en page), sans accent ni casse.
// Module pur, sans import : utilisé par la barre latérale (navigateur) et testé à côté.

export type PageEntry = { key: string; href: string; label: string; icon: string };
export type PageSection = { label: string; items: readonly PageEntry[] };
export type PageHit = PageEntry & { section: string };

/** Nombre de pages proposées au plus. */
export const PAGE_HITS_MAX = 12;

/** Texte comparé : minuscules, sans accents, espaces réduits. */
export const foldText = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Pages dont le libellé (ou celui de leur section) contient chaque mot de la recherche ; celles dont le libellé commence par
 * la recherche d'abord, puis l'ordre de la navigation. Recherche vide : aucune page (la navigation reste affichée).
 */
export function matchPages(sections: readonly PageSection[], query: string): PageHit[] {
  const words = foldText(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const q = words.join(' ');
  const hits = sections.flatMap((sec) => sec.items.map((it) => ({ ...it, section: sec.label })))
    .filter((h) => {
      const text = `${foldText(h.label)} ${foldText(h.section)}`;
      return words.every((w) => text.includes(w));
    });
  const starts = (h: PageHit) => (foldText(h.label).startsWith(q) ? 0 : 1);
  return hits.map((h, i) => ({ h, i })).sort((a, b) => starts(a.h) - starts(b.h) || a.i - b.i).map((x) => x.h).slice(0, PAGE_HITS_MAX);
}

/** Raccourci ⌘K (macOS) ou Ctrl+K (autres systèmes). */
export const isPageSearchShortcut = (e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }) =>
  (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K');
