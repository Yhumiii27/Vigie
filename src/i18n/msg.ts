// Libellé composé par src/lib (VG-N01) : chaîne source anglaise et ses paramètres, rendus par t() à l'affichage. Le module
// qui le compose garde aussi son libellé français (`msgFr`, valeur des règles, des échéances et des essais), calculé par le
// même dictionnaire : le français affiché reste donc mot pour mot celui d'avant la traduction. Un paramètre peut être
// lui-même un libellé composé (ex. l'échéance « avant le … à … » d'une déclaration). Jamais pour un texte saisi : il passe
// en paramètre, tel quel.
import { fill, makeT, type T } from './translate';

export type Msg = { en: string; values?: Record<string, string | number | Msg> };

/** Libellé composé dans la langue du traducteur. */
export const msgT = (t: T) => (m: Msg): string =>
  fill(t(m.en), Object.fromEntries(Object.entries(m.values ?? {}).map(([k, v]) => [k, typeof v === 'object' ? msgT(t)(v) : v])));

/** Libellé français d'un libellé composé (celui que gardent les règles et le serveur). */
export const msgFr = msgT(makeT('fr'));

/** Libellé composé avec son français : `{ label, text }` (label = français, text = à rendre par msgT). */
export const composed = (en: string, values?: Msg['values']) => {
  const text: Msg = { en, values };
  return { label: msgFr(text), text };
};
