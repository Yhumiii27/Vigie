// Sections repliées de la barre latérale (Norma 2.1, COQUE.md § 2 : « repliables, état gardé par l'outil (cookie) ») :
// cookie vigie-nav relu par la mise en page au rendu (pas de saut au chargement). Module pur, sans import.

export const NAV_COOKIE = 'vigie-nav';
const MAX_AGE = 365 * 24 * 3600;
const SEP = '|';

/** Sections repliées d'après la valeur du cookie (libellés séparés par « | », 20 au plus). */
export const navClosedOf = (value: string | null | undefined): string[] =>
  value ? decodeURIComponent(value).split(SEP).map((s) => s.trim()).filter(Boolean).slice(0, 20) : [];

/** En-tête Set-Cookie (côté navigateur : `document.cookie = navCookie(sections)`). */
export const navCookie = (closed: readonly string[]) =>
  `${NAV_COOKIE}=${encodeURIComponent(closed.join(SEP))}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax`;
