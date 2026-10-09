// Libellés des champs d'un PDF remplissable sans infobulle et au nom générique (« Case à cocher 12 », « Text5 ») :
// texte imprimé à côté du champ, titre de section au-dessus. Module pur : le texte des pages (pdf.js) est fourni par l'appelant.

import { cleanHeading, cleanLabel, isUpper, normalize } from './text';
import type { ImportField } from './types';

/** Fragment de texte d'une page (coordonnées PDF : origine en bas à gauche, y = ligne de base). */
export type TextItem = { page: number; str: string; x: number; y: number; w: number; h: number };
/** Rectangle du widget d'un champ, page comptée à partir de 1. */
export type FieldBox = { page: number; x: number; y: number; w: number; h: number };

type Segment = { page: number; text: string; x1: number; x2: number; y: number; h: number };

/** Nom technique sans valeur pour l'utilisateur. */
const GENERIC = /^(case|case a cocher|check ?box|checkbox|text|texte|champ|champ de texte|zone de texte|field|text field|untitled|sans titre|button|bouton|radio|liste|dropdown|combo ?box|date|signature)( ?\d+)*$/;
export const isGenericLabel = (label: string) => {
  const n = normalize(label);
  return !n || n.length <= 2 || GENERIC.test(n) || /^[\d ]+$/.test(n);
};

/** Regroupe les fragments en segments de ligne (mots proches sur la même ligne de base). */
export function lineSegments(items: TextItem[]): Segment[] {
  const out: Segment[] = [];
  const byPage = new Map<number, TextItem[]>();
  items.filter((i) => i.str.trim()).forEach((i) => byPage.set(i.page, [...(byPage.get(i.page) ?? []), i]));
  for (const [page, list] of byPage) {
    list.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: TextItem[][] = [];
    for (const it of list) {
      const line = lines.find((l) => Math.abs(l[0].y - it.y) <= Math.max(2, 0.35 * Math.max(l[0].h, it.h)));
      if (line) line.push(it);
      else lines.push([it]);
    }
    for (const line of lines) {
      line.sort((a, b) => a.x - b.x);
      let cur: Segment | null = null;
      for (const it of line) {
        const gap = cur ? it.x - cur.x2 : Infinity;
        if (cur && gap <= Math.max(4, 0.8 * it.h)) {
          cur.text += (gap > 0.15 * it.h && !cur.text.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
          cur.x2 = Math.max(cur.x2, it.x + it.w);
          cur.h = Math.max(cur.h, it.h);
        } else {
          if (cur) out.push(cur);
          cur = { page, text: it.str, x1: it.x, x2: it.x + it.w, y: it.y, h: it.h };
        }
      }
      if (cur) out.push(cur);
    }
  }
  return out.map((s) => ({ ...s, text: cleanLabel(s.text, 160) })).filter((s) => s.text && !/^[_.\s…]+$/.test(s.text));
}

const sameLine = (s: Segment, b: FieldBox) => {
  const center = s.y + s.h * 0.35;
  return center >= b.y - 3 && center <= b.y + b.h + 3;
};

/** Texte imprimé à côté d'un champ : à droite d'une case, à gauche (ou juste au-dessus) d'une zone de saisie. */
export function nearbyLabel(box: FieldBox, segs: Segment[], kind: ImportField['kind']): string | null {
  const page = segs.filter((s) => s.page === box.page);
  const line = page.filter((s) => sameLine(s, box));
  const right = line.filter((s) => s.x1 >= box.x + box.w - 2 && s.x1 - (box.x + box.w) <= 220).sort((a, b) => a.x1 - b.x1)[0];
  const left = line.filter((s) => s.x2 <= box.x + 2 && box.x - s.x2 <= 300).sort((a, b) => b.x2 - a.x2)[0];
  const above = page
    .filter((s) => s.y >= box.y + box.h - 1 && s.y - (box.y + box.h) <= 18 && s.x1 < box.x + box.w && s.x2 > box.x - 4)
    .sort((a, b) => a.y - b.y)[0];
  const pick = kind === 'checkbox' ? right ?? left ?? above : left ?? above ?? right;
  return pick ? pick.text : null;
}

/** Titre de section : ligne en capitales ou en plus grand corps la plus proche au-dessus du champ. */
export function nearbySection(box: FieldBox, segs: Segment[]): string | null {
  const page = segs.filter((s) => s.page === box.page);
  if (!page.length) return null;
  const heights = page.map((s) => s.h).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  const heading = page
    .filter((s) => s.y > box.y + box.h && s.text.length >= 3 && s.text.length <= 90 && (isUpper(s.text) || s.h >= median * 1.2))
    .sort((a, b) => a.y - b.y)[0];
  return heading ? cleanHeading(heading.text) : null;
}

/**
 * Complète les champs au libellé générique (sans infobulle) avec le texte voisin, et leur section si elle manque.
 * `preferText` : champs dont le libellé et la section, tirés du seul nom technique, cèdent la place au texte imprimé
 * s'il est trouvé (PDF protégé lu avec pdf.js, sans infobulle). Renvoie le nombre de champs complétés.
 */
export function enrichFromText(fields: ImportField[], boxes: Record<string, FieldBox>, items: TextItem[], preferText?: Set<string>): number {
  const segs = lineSegments(items);
  if (!segs.length) return 0;
  let n = 0;
  for (const f of fields) {
    const box = boxes[f.key];
    if (!box) continue;
    const prefer = !!preferText?.has(f.key);
    if (prefer || isGenericLabel(f.label)) {
      const label = nearbyLabel(box, segs, f.kind);
      if (label && !isGenericLabel(label)) { f.label = label; n += 1; }
    }
    if (!f.section) f.section = nearbySection(box, segs) ?? undefined;
    else if (prefer) {
      // Section tirée du nom (« Risques ») : remplacée par le titre imprimé qui la prolonge (« Risques d'interférence »),
      // pas par un titre voisin sans rapport.
      const printed = nearbySection(box, segs);
      const words = new Set(normalize(printed ?? '').split(' '));
      if (printed && normalize(f.section).split(' ').every((w) => words.has(w))) f.section = printed;
    }
  }
  return n;
}
