// Libellé composé par src/lib (VG-N01) : chaîne source anglaise et ses paramètres, rendus par t() à l'affichage. Le module
// qui le compose garde aussi son libellé français (`msgFr`, valeur des règles, des échéances et des essais), calculé par le
// même dictionnaire : le français affiché reste donc mot pour mot celui d'avant la traduction. Un paramètre peut être
// lui-même un libellé composé (ex. l'échéance « avant le … à … » d'une déclaration). Jamais pour un texte saisi : il passe
// en paramètre, tel quel.
import { fill, makeT, type T } from './translate';

/**
 * `lower` : première lettre en minuscule au rendu, comme `lcfirst` de src/lib/queries.ts (« À faire » → « à faire », sigle
 * conservé), pour un libellé de table cité au milieu d'une phrase.
 */
export type Msg = { en: string; values?: Record<string, string | number | Msg>; lower?: boolean };

const lowerFirst = (s: string) => (s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s);

/** Libellé composé dans la langue du traducteur. */
export const msgT = (t: T) => (m: Msg): string => {
  const text = fill(t(m.en), Object.fromEntries(Object.entries(m.values ?? {}).map(([k, v]) => [k, typeof v === 'object' ? msgT(t)(v) : v])));
  return m.lower ? lowerFirst(text) : text;
};

/** Libellé français d'un libellé composé (celui que gardent les règles et le serveur). */
export const msgFr = msgT(makeT('fr'));

/**
 * Intitulé d'une échéance (TodoItem) : `title` = français (clé d'état lu, règles, essais), `titleText` = libellé composé
 * rendu à l'affichage. À étaler dans l'échéance : `{ ...titled('{id} · plan to sign', { id }), … }`.
 */
export const titled = (en: string, values?: Msg['values']) => {
  const titleText: Msg = { en, values };
  return { title: msgFr(titleText), titleText };
};

/** Libellé composé avec son français : `{ label, text }` (label = français, text = à rendre par msgT). */
export const composed = (en: string, values?: Msg['values']) => {
  const text: Msg = { en, values };
  return { label: msgFr(text), text };
};
