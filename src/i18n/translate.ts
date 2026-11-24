// Traduction de l'interface (Norma § 2 et § 7, VG-N01 ; même principe que Keystone, Arche et Crucible) : les chaînes de
// l'interface sont écrites en anglais (chaîne source) et rendues en français par le dictionnaire exact de ./fr.ts. Le
// français est la langue par défaut ; l'anglais se choisit par le sélecteur FR / EN de la barre latérale (cookie
// vigie-lang). Le texte saisi par les personnes ne passe jamais par t(). Module pur, sans import serveur : utilisé par le
// serveur (./server.ts), le navigateur (./client.tsx) et les tests. Les identifiants de route restent en français.
import { FR } from './fr';

export type Lang = 'fr' | 'en';
export const LANGS: readonly Lang[] = ['fr', 'en'];
export const DEFAULT_LANG: Lang = 'fr';

/** Cookie de la langue choisie (`fr` | `en`, un an), propre à Vigie. */
export const LANG_COOKIE = 'vigie-lang';
const MAX_AGE = 365 * 24 * 3600;

/** Langue d'après la valeur du cookie ; toute autre valeur (ou absence) : le français. */
export const langOf = (value: string | null | undefined): Lang => (value === 'en' ? 'en' : DEFAULT_LANG);

/** En-tête Set-Cookie (côté navigateur : `document.cookie = langCookie(lang)`). */
export const langCookie = (lang: Lang) => `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax`;

/** Traduction française exacte d'une chaîne source, sinon undefined. */
export const frExact = (s: string): string | undefined => (s && Object.hasOwn(FR, s) ? FR[s] : undefined);

export type T = (english: string) => string;

/** Traducteur d'une langue : l'anglais rend la chaîne source ; le français, son entrée du dictionnaire (sinon la source). */
export function makeT(lang: Lang): T {
  return lang === 'fr' ? (s) => frExact(s) ?? s : (s) => s;
}

/** Chaîne à compléter : `{n}` et autres paramètres remplacés après traduction (« {n} pages found » → « 3 pages trouvées »). */
export const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (Object.hasOwn(values, k) ? String(values[k]) : m));
