// Lecture d'un formulaire Word (.docx) : contrôles de contenu (cases w14:checkbox, texte, date, liste),
// champs de formulaire hérités (FORMCHECKBOX, FORMTEXT, FORMDROPDOWN), cases dessinées par des caractères
// (☐ ☑ ☒ ✓ ✔ ✗ ■ □ ⊠, symboles Wingdings) et lignes « Libellé : valeur » des tableaux et paragraphes.
// Module pur (fflate + fast-xml-parser), testable avec node.

import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { cleanHeading, cleanLabel, cleanValue, humanize, isUpper, normalize, slug, squash } from './text';
import { ImportError, type ImportField, type ParseResult } from './types';

type XNode = Record<string, unknown>;
type Attrs = Record<string, string>;

const tagOf = (n: XNode) => Object.keys(n).find((k) => k !== ':@') ?? '';
const kids = (n: XNode): XNode[] => {
  const v = n[tagOf(n)];
  return Array.isArray(v) ? (v as XNode[]) : [];
};
const attr = (n: XNode | undefined, name: string) => (n?.[':@'] as Attrs | undefined)?.[name];
const child = (n: XNode | undefined, tag: string) => (n ? kids(n).find((c) => tagOf(c) === tag) : undefined);
const children = (n: XNode | undefined, tag: string) => (n ? kids(n).filter((c) => tagOf(c) === tag) : []);
const textOf = (n: XNode) => kids(n).map((c) => (typeof c['#text'] === 'string' ? (c['#text'] as string) : '')).join('');
/** Propriété booléenne OOXML (<w:b/>, <w:b w:val="0"/>…). */
const onOff = (n: XNode | undefined, valAttr = 'w:val') => {
  if (!n) return false;
  const v = attr(n, valAttr);
  return v === undefined || !['0', 'false', 'off'].includes(v.toLowerCase());
};

function findAll(n: XNode, tag: string, out: XNode[] = []): XNode[] {
  for (const c of kids(n)) {
    if (tagOf(c) === tag) out.push(c);
    else findAll(c, tag, out);
  }
  return out;
}
const findFirst = (n: XNode, tag: string): XNode | undefined => findAll(n, tag)[0];

// ─── Cases dessinées par des caractères ─────────────────────────────────────

/** Caractères de case : true = cochée, false = vide. */
const GLYPHS: Record<string, boolean> = {
  '☐': false, '□': false, '❑': false, '❏': false, '◻': false, '⬜': false,
  '☑': true, '☒': true, '✓': true, '✔': true, '✗': true, '✘': true, '■': true, '⊠': true, '⌧': true, '▣': true,
};
/** Symboles Wingdings / Wingdings 2 (police de symboles, code du caractère dans la plage privée F0xx ou 00xx). */
const SYMBOL_FONTS: Record<string, Record<number, boolean>> = {
  wingdings: { 0x6f: false, 0x71: false, 0xa8: false, 0x6e: true, 0x78: true, 0xfe: true, 0xfd: true, 0xfc: true, 0xfb: true },
  'wingdings 2': { 0xa3: false, 0x2a: false, 0x52: true, 0x54: true, 0x51: true, 0x50: true, 0x4f: true },
};
const symbolState = (font: string | undefined, code: number): boolean | undefined => {
  if (!font) return undefined;
  const table = SYMBOL_FONTS[font.trim().toLowerCase()];
  return table?.[code & 0xff];
};
/** Une case dessinée doit être en début de paragraphe ou de mot (pas au milieu d'un texte). */
const glyphAllowed = (prev: string) => !prev || /[\s:;(|/\-–—]$/.test(prev);

// ─── Modèle intermédiaire ───────────────────────────────────────────────────

type RawField = {
  kind: ImportField['kind'];
  checked?: boolean;
  value?: string;
  /** Nom technique : étiquette (w:tag), titre (w:alias) ou nom du champ hérité. */
  name?: string;
  /** Titre lisible donné par l'auteur du formulaire (alias, texte d'aide). */
  alias?: string;
  source: 'sdt' | 'legacy' | 'glyph' | 'layout';
};
type Inline = { t: 'text'; text: string } | { t: 'field'; f: RawField };
type Para = { type: 'p'; style: string; bold: boolean; inl: Inline[] };
type Cell = { col: number; blocks: Block[]; shaded: boolean; continued: boolean };
type Row = { header: boolean; cells: Cell[] };
type Table = { type: 'tbl'; rows: Row[] };
type Block = Para | Table;

type LegacyFrame = { ff: XNode | undefined; instr: string; phase: 'instr' | 'result'; result: string };

/** Lecture des éléments de niveau paragraphe (runs, contrôles, champs hérités). */
class ParaReader {
  inl: Inline[] = [];
  floating: Block[] = [];
  private stack: LegacyFrame[] = [];
  private chars = 0;
  private boldChars = 0;
  private flat = '';

  private readBlocks: (nodes: XNode[]) => Block[];

  constructor(readBlocks: (nodes: XNode[]) => Block[]) {
    this.readBlocks = readBlocks;
  }

  get bold() { return this.chars > 0 && this.boldChars / this.chars > 0.8; }

  private pushText(text: string, bold: boolean) {
    if (!text) return;
    const last = this.inl[this.inl.length - 1];
    if (last?.t === 'text') last.text += text;
    else this.inl.push({ t: 'text', text });
    const visible = text.replace(/\s/g, '').length;
    this.chars += visible;
    if (bold) this.boldChars += visible;
    this.flat += text;
  }

  private pushField(f: RawField) {
    this.inl.push({ t: 'field', f });
    this.flat += ' ';
  }

  /** Texte d'un run : cases dessinées détectées, symboles de police remplacés. */
  private text(text: string, bold: boolean, symbolFont?: string) {
    const frame = this.stack[this.stack.length - 1];
    if (frame) {
      // Résultat d'un champ hérité : valeur d'un champ texte, ou texte ordinaire pour les autres champs (PAGE, REF…).
      if (frame.phase === 'instr') return;
      if (isFormField(frame)) { frame.result += text; return; }
    }
    let buf = '';
    for (const ch of text) {
      const state = symbolFont ? symbolState(symbolFont, ch.codePointAt(0) ?? 0) : GLYPHS[ch];
      if (state !== undefined && glyphAllowed(this.flat + buf)) {
        this.pushText(buf, bold);
        buf = '';
        this.pushField({ kind: 'checkbox', checked: state, source: 'glyph' });
      } else if (!symbolFont) {
        buf += ch;
      }
    }
    this.pushText(buf, bold);
  }

  private run(r: XNode) {
    const rPr = child(r, 'w:rPr');
    const bold = onOff(child(rPr, 'w:b'));
    const fonts = child(rPr, 'w:rFonts');
    const font = [attr(fonts, 'w:ascii'), attr(fonts, 'w:hAnsi'), attr(fonts, 'w:cs')].find((f) => f && /wingdings/i.test(f));
    for (const c of kids(r)) {
      switch (tagOf(c)) {
        case 'w:t':
          this.text(textOf(c), bold, font);
          break;
        case 'w:tab':
        case 'w:br':
        case 'w:cr':
          this.text(' ', bold);
          break;
        case 'w:noBreakHyphen':
          this.text('-', bold);
          break;
        case 'w:sym': {
          const code = parseInt(attr(c, 'w:char') ?? '', 16);
          const state = Number.isFinite(code) ? symbolState(attr(c, 'w:font'), code) : undefined;
          if (state !== undefined && !this.stack.length && glyphAllowed(this.flat)) this.pushField({ kind: 'checkbox', checked: state, source: 'glyph' });
          break;
        }
        case 'w:fldChar':
          this.fldChar(c);
          break;
        case 'w:instrText': {
          const frame = this.stack[this.stack.length - 1];
          if (frame) frame.instr += textOf(c);
          break;
        }
        case 'w:drawing':
        case 'w:pict':
        case 'w:object':
        case 'mc:AlternateContent':
          // Zones de texte : lues comme des blocs placés après le paragraphe.
          for (const box of findAll(c, 'w:txbxContent')) this.floating.push(...this.readBlocks(kids(box)));
          break;
        default:
          break;
      }
    }
  }

  private fldChar(c: XNode) {
    const type = attr(c, 'w:fldCharType');
    if (type === 'begin') {
      this.stack.push({ ff: child(c, 'w:ffData'), instr: '', phase: 'instr', result: '' });
    } else if (type === 'separate') {
      const frame = this.stack[this.stack.length - 1];
      if (frame) frame.phase = 'result';
    } else if (type === 'end') {
      const frame = this.stack.pop();
      if (frame && isFormField(frame)) this.pushField(legacyField(frame));
    }
  }

  private sdt(n: XNode) {
    const pr = child(n, 'w:sdtPr');
    const content = child(n, 'w:sdtContent');
    const field = sdtField(pr, content);
    if (field) this.pushField(field);
    else if (content) this.walk(kids(content));
  }

  walk(nodes: XNode[]) {
    for (const n of nodes) {
      switch (tagOf(n)) {
        case 'w:r':
          this.run(n);
          break;
        case 'w:sdt':
          this.sdt(n);
          break;
        case 'w:hyperlink':
        case 'w:ins':
        case 'w:moveTo':
        case 'w:smartTag':
        case 'w:customXml':
        case 'w:fldSimple':
        case 'w:dir':
        case 'w:bdo':
          this.walk(kids(n));
          break;
        case 'mc:AlternateContent': {
          const choice = child(n, 'mc:Choice');
          if (choice) this.walk(kids(choice));
          break;
        }
        default:
          break; // w:pPr, w:del, w:moveFrom, signets, commentaires…
      }
    }
  }

  /** Champ hérité resté ouvert en fin de paragraphe (rare) : émis tel quel. */
  finish() {
    while (this.stack.length) {
      const frame = this.stack.pop()!;
      if (isFormField(frame)) this.pushField(legacyField(frame));
    }
  }
}

const isFormField = (f: LegacyFrame) => !!f.ff || /\bFORM(CHECKBOX|TEXT|DROPDOWN)\b/.test(f.instr);

function legacyField(frame: LegacyFrame): RawField {
  const ff = frame.ff;
  const name = attr(child(ff, 'w:name'), 'w:val') || undefined;
  const alias = attr(child(ff, 'w:statusText'), 'w:val') || attr(child(ff, 'w:helpText'), 'w:val') || undefined;
  const checkBox = child(ff, 'w:checkBox');
  if (checkBox || /\bFORMCHECKBOX\b/.test(frame.instr)) {
    const explicit = child(checkBox, 'w:checked');
    const checked = explicit ? onOff(explicit) : onOff(child(checkBox, 'w:default')) && attr(child(checkBox, 'w:default'), 'w:val') !== undefined;
    return { kind: 'checkbox', checked, name, alias, source: 'legacy' };
  }
  const dd = child(ff, 'w:ddList');
  if (dd || /\bFORMDROPDOWN\b/.test(frame.instr)) {
    const entries = children(dd, 'w:listEntry').map((e) => attr(e, 'w:val') ?? '');
    const index = Number(attr(child(dd, 'w:result'), 'w:val') ?? attr(child(dd, 'w:default'), 'w:val') ?? 0);
    return { kind: 'choice', value: cleanValue(entries[index] ?? frame.result), name, alias, source: 'legacy' };
  }
  const type = attr(child(child(ff, 'w:textInput'), 'w:type'), 'w:val');
  return { kind: type === 'date' ? 'date' : 'text', value: cleanValue(frame.result), name, alias, source: 'legacy' };
}

/** Contrôle de contenu : champ (case, texte, date, liste) ou simple conteneur (null). */
function sdtField(pr: XNode | undefined, content: XNode | undefined): RawField | null {
  const tag = attr(child(pr, 'w:tag'), 'w:val')?.trim() || undefined;
  const alias = attr(child(pr, 'w:alias'), 'w:val')?.trim() || undefined;
  const name = tag || alias;
  const placeholder = onOff(child(pr, 'w:showingPlcHdr'));
  const checkbox = child(pr, 'w14:checkbox') ?? child(pr, 'w15:checkbox');
  if (checkbox) {
    const checked = child(checkbox, 'w14:checked') ?? child(checkbox, 'w15:checked');
    return { kind: 'checkbox', checked: checked ? onOff(checked, attr(checked, 'w14:val') !== undefined ? 'w14:val' : 'w15:val') : false, name, alias, source: 'sdt' };
  }
  if (!content) return null;
  // Conteneurs (sections répétées, groupes, tables des matières) : leur contenu est lu normalement.
  if (child(pr, 'w:docPartObj') || child(pr, 'w:group') || child(pr, 'w15:repeatingSection') || child(pr, 'w15:repeatingSectionItem')
    || child(pr, 'w:picture') || child(pr, 'w:citation') || child(pr, 'w:bibliography') || child(pr, 'w:equation')) return null;
  if (findFirst(content, 'w:sdt') || findAll(content, 'w:fldChar').some((f) => child(f, 'w:ffData')) || findFirst(content, 'w:tbl')) return null;
  const value = placeholder ? '' : contentText(content);
  const date = child(pr, 'w:date');
  if (date) {
    const full = attr(date, 'w:fullDate');
    return { kind: 'date', value: cleanValue(value || (placeholder ? '' : full?.slice(0, 10) ?? '')), name, alias, source: 'sdt' };
  }
  const choice = child(pr, 'w:dropDownList') ?? child(pr, 'w:comboBox');
  return { kind: choice ? 'choice' : 'text', value: cleanValue(value), name, alias, source: 'sdt' };
}

/** Texte affiché d'un contenu (paragraphes séparés par des retours à la ligne). */
function contentText(n: XNode): string {
  const parts: string[] = [];
  const walk = (x: XNode) => {
    for (const c of kids(x)) {
      const tag = tagOf(c);
      if (tag === 'w:t') parts.push(textOf(c));
      else if (tag === 'w:tab' || tag === 'w:br') parts.push(' ');
      else if (tag === 'w:p') { if (parts.length) parts.push('\n'); walk(c); }
      else if (tag !== 'w:del' && tag !== 'w:instrText' && tag !== 'w:rPr' && tag !== 'w:pPr') walk(c);
    }
  };
  walk(n);
  return parts.join('').split('\n').map(squash).filter(Boolean).join('\n');
}

// ─── Blocs (paragraphes, tableaux) ──────────────────────────────────────────

function readBlocks(nodes: XNode[]): Block[] {
  const out: Block[] = [];
  for (const n of nodes) {
    const tag = tagOf(n);
    if (tag === 'w:p') {
      const reader = new ParaReader(readBlocks);
      reader.walk(kids(n));
      reader.finish();
      const pPr = child(n, 'w:pPr');
      out.push({ type: 'p', style: attr(child(pPr, 'w:pStyle'), 'w:val') ?? '', bold: reader.bold, inl: reader.inl }, ...reader.floating);
    } else if (tag === 'w:tbl') {
      out.push(readTable(n));
    } else if (tag === 'w:sdt') {
      const pr = child(n, 'w:sdtPr');
      const content = child(n, 'w:sdtContent');
      const field = sdtField(pr, content);
      if (field) out.push({ type: 'p', style: '', bold: false, inl: [{ t: 'field', f: field }] });
      else if (content) out.push(...readBlocks(kids(content)));
    } else if (tag === 'mc:AlternateContent') {
      const choice = child(n, 'mc:Choice');
      if (choice) out.push(...readBlocks(kids(choice)));
    } else if (tag && !['w:sectPr', 'w:tblPr', 'w:tblGrid', 'w:bookmarkStart', 'w:bookmarkEnd', 'w:del', 'w:moveFrom'].includes(tag) && !tag.startsWith('#')) {
      out.push(...readBlocks(kids(n))); // w:body, w:customXml, w:ins…
    }
  }
  return out;
}

/** Lignes d'un tableau, y compris celles enveloppées dans un contrôle de contenu ou du XML personnalisé. */
function tableRows(n: XNode): XNode[] {
  return kids(n).flatMap((c) => {
    const tag = tagOf(c);
    if (tag === 'w:tr') return [c];
    if (tag === 'w:sdt') return tableRows(child(c, 'w:sdtContent') ?? {});
    if (tag === 'w:customXml' || tag === 'w:ins') return tableRows(c);
    return [];
  });
}
function rowCells(n: XNode): XNode[] {
  return kids(n).flatMap((c) => {
    const tag = tagOf(c);
    if (tag === 'w:tc') return [c];
    if (tag === 'w:sdt') return rowCells(child(c, 'w:sdtContent') ?? {});
    if (tag === 'w:customXml') return rowCells(c);
    return [];
  });
}

function readTable(n: XNode): Table {
  const rows = tableRows(n).map((tr): Row => {
    const trPr = child(tr, 'w:trPr');
    let col = Number(attr(child(trPr, 'w:gridBefore'), 'w:val') ?? 0) || 0;
    const cells = rowCells(tr).map((tc): Cell => {
      const tcPr = child(tc, 'w:tcPr');
      const span = Number(attr(child(tcPr, 'w:gridSpan'), 'w:val') ?? 1) || 1;
      const vMerge = child(tcPr, 'w:vMerge');
      const fill = attr(child(tcPr, 'w:shd'), 'w:fill');
      const cell = {
        col,
        blocks: readBlocks(kids(tc)),
        shaded: !!fill && !/^(auto|ffffff)$/i.test(fill),
        continued: !!vMerge && attr(vMerge, 'w:val') !== 'restart',
      };
      col += span;
      return cell;
    });
    return { header: !!child(trPr, 'w:tblHeader'), cells };
  });
  return { type: 'tbl', rows };
}

// ─── Libellés et sections ───────────────────────────────────────────────────

const paraText = (p: Para) => squash(p.inl.map((i) => (i.t === 'text' ? i.text : ' ')).join(''));
const paraFields = (p: Para) => p.inl.filter((i): i is { t: 'field'; f: RawField } => i.t === 'field').map((i) => i.f);
const blockFields = (b: Block): RawField[] => (b.type === 'p' ? paraFields(b) : b.rows.flatMap((r) => r.cells.flatMap((c) => c.blocks.flatMap(blockFields))));
const cellFields = (c: Cell) => c.blocks.flatMap(blockFields);
const cellText = (c: Cell) => squash(c.blocks.map((b) => (b.type === 'p' ? paraText(b) : '')).join(' '));
const cellBold = (c: Cell) => c.blocks.some((b) => b.type === 'p' && b.bold);

const HEADING_STYLE = /^(heading|titre|title|berschrift|kop|titolo|título)\s*\d*$|heading|titre/i;
/** Libellé d'un générique « Case à cocher 3 », « Text1 » : sans valeur pour l'utilisateur. */
const GENERIC_NAME = /^(case( a cocher)?|check ?box|text|texte|champ|field|zone de texte|liste deroulante|dropdown|date|controle)\s*\d*$/;

function isHeadingText(text: string, bold: boolean, style = '') {
  if (text.length < 2 || text.length > 100) return false;
  if (/_{3,}|\.{4,}/.test(text)) return false;
  if (style && HEADING_STYLE.test(style)) return true;
  const words = text.split(' ').length;
  return (bold || isUpper(text)) && words <= 14 && !/[.;]$/.test(text);
}

/** « Libellé : valeur » sur une ligne sans champ (formulaire Word rempli au clavier). */
const LAYOUT_PAIR = /^([^:]{2,60}?)\s*:\s*(.*)$/;

type Found = RawField & { label: string; section: string };

/** Voisinage d'un champ placé dans une cellule de tableau. */
type CellCtx = { left: string; right: string; column: string; multi: boolean };

const usefulAlias = (f: RawField) => (f.alias && !GENERIC_NAME.test(normalize(f.alias)) ? f.alias : '');

/** Attribue un libellé et une section à chaque champ, dans l'ordre du document. */
class Labeler {
  section = '';
  private prevText = '';
  /** Le dernier bloc lu est un titre (le tableau qui suit lui appartient). */
  private freshHeading = false;
  out: Found[] = [];

  private add(f: RawField, label: string) {
    const named = f.name && !GENERIC_NAME.test(normalize(f.name)) ? humanize(f.name) : '';
    const final = cleanLabel(label) || cleanLabel(usefulAlias(f)) || named || `Champ ${this.out.length + 1}`;
    this.out.push({ ...f, label: final, section: this.section });
  }

  /** Libellés des champs d'un paragraphe, d'après le texte qui les entoure. */
  private para(p: Para, cell?: CellCtx) {
    const fields = paraFields(p);
    const text = paraText(p);
    if (!fields.length) {
      if (!text) return;
      if (!cell && isHeadingText(text, p.bold, p.style)) {
        this.section = cleanHeading(text);
        this.prevText = text;
        this.freshHeading = true;
        return;
      }
      this.freshHeading = false;
      const pair = LAYOUT_PAIR.exec(text);
      if (!cell && pair && pair[1].split(' ').length <= 8 && !/\d$/.test(pair[1].trim()) && pair[2].length <= 400) {
        this.add({ kind: 'text', value: cleanValue(pair[2]), source: 'layout' }, pair[1]);
      }
      this.prevText = text;
      return;
    }
    this.freshHeading = false;
    const idx = p.inl.map((x, i) => (x.t === 'field' ? i : -1)).filter((i) => i >= 0);
    const between = (a: number, b: number) => cleanLabel(p.inl.slice(a, b).map((x) => (x.t === 'text' ? x.text : '')).join(''));
    const segs = idx.map((i, n) => ({
      before: between(n === 0 ? 0 : idx[n - 1] + 1, i),
      after: between(i + 1, n === idx.length - 1 ? p.inl.length : idx[n + 1]),
    }));
    const lead = segs[0].before;
    const boxes = fields.filter((f) => f.kind === 'checkbox').length;
    // Cases suivies de leur libellé (« ☐ Hauteur ☐ ATEX ») ou précédées (« Hauteur ☐ ATEX ☐ »).
    const labelAfter = !!segs[segs.length - 1].after || !lead;
    const above = this.prevText.length <= 120 ? this.prevText : '';
    idx.forEach((i, n) => {
      const f = (p.inl[i] as { t: 'field'; f: RawField }).f;
      const { before, after } = segs[n];
      let label: string;
      if (f.kind === 'checkbox') {
        label = labelAfter ? after : before;
        if (label && boxes > 1 && labelAfter && lead) label = `${lead} : ${label}`;
        if (!label) label = labelAfter ? before : after;
        if (!label && cell) label = cellLabel(cell, 'right');
      } else {
        label = usefulAlias(f) || before || above;
        if (!label && cell) label = cellLabel(cell, 'left');
        if (!label) label = after;
      }
      this.add(f, label);
    });
    this.prevText = text;
  }

  blocks(blocks: Block[], cell?: CellCtx) {
    for (const b of blocks) {
      if (b.type === 'p') this.para(b, cell);
      else this.table(b);
    }
  }

  private table(t: Table) {
    let columns: Map<number, string> | null = null;
    // Titre de la première cellule d'en-tête : section du tableau, sauf si un titre le précède immédiatement.
    const outer = this.section;
    const fresh = this.freshHeading;
    let scoped: string | null = null;
    t.rows.forEach((row, ri) => {
      const info = row.cells.filter((c) => !c.continued).map((c) => ({ c, text: cellText(c), fields: cellFields(c).length, bold: cellBold(c) || c.shaded }));
      const filled = info.filter((x) => x.text || x.fields);
      if (!filled.length) return;
      if (!info.some((x) => x.fields)) {
        // Ligne de titre : une seule cellule renseignée (souvent fusionnée, en gras ou grisée).
        if (filled.length === 1) {
          if (isHeadingText(filled[0].text, filled[0].bold || ri === 0 || row.header)) {
            this.section = cleanHeading(filled[0].text);
            columns = null;
          }
          return;
        }
        const colon = filled.some((x) => /:\s*$/.test(x.text));
        const headerLike = row.header || filled.every((x) => x.bold) || (ri === 0 && filled.every((x) => x.text.length <= 40));
        if (headerLike && !colon) {
          // En-têtes de colonnes : complètent le libellé des cases placées seules dans leur cellule (« Hauteur — Oui »).
          columns = new Map(filled.map((x) => [x.c.col, cleanLabel(x.text)]));
          if ((!this.section || !fresh) && !scoped && filled[0].c.col === 0 && filled[0].text.length >= 3 && filled[0].text.length <= 80) {
            this.section = scoped = cleanHeading(filled[0].text);
          }
          return;
        }
        // Paires « Libellé | valeur » saisies directement dans les cellules.
        for (let i = 0; i < info.length - 1; i++) {
          const label = info[i].text;
          if (label && label.length <= 60 && (/:\s*$/.test(label) || info[i].bold) && !(info[i + 1].bold && info[i + 1].text)) {
            this.add({ kind: 'text', value: cleanValue(info[i + 1].text), source: 'layout' }, label);
            i += 1;
          }
        }
        return;
      }
      // Ligne « cadre » (une seule cellule renseignée) : son contenu se lit comme le corps du document.
      if (filled.length === 1) {
        this.prevText = '';
        this.blocks(filled[0].c.blocks);
        return;
      }
      const fieldCells = info.filter((x) => x.fields).length;
      info.forEach((x, i) => {
        if (!x.fields) return;
        let right = '';
        for (let j = i + 1; j < info.length; j++) {
          if (info[j].fields) break;
          if (info[j].text) { right = info[j].text; break; }
        }
        let left = '';
        for (let j = i - 1; j >= 0; j--) {
          if (!info[j].fields && info[j].text) { left = info[j].text; break; }
        }
        this.prevText = '';
        this.blocks(x.c.blocks, { left, right, column: columns?.get(x.c.col) ?? '', multi: fieldCells > 1 });
      });
      this.prevText = '';
    });
    if (scoped && this.section === scoped) this.section = outer;
    this.freshHeading = false;
  }
}

/** Libellé d'un champ seul dans sa cellule : cellule voisine, complétée par l'en-tête de colonne (« Hauteur — Oui »). */
function cellLabel(cell: CellCtx, prefer: 'left' | 'right'): string {
  const near = prefer === 'right' ? cell.right || cell.left : cell.left || cell.right;
  const usedLeft = near && near === cell.left && near !== cell.right;
  if (usedLeft && cell.column && cell.multi) return `${cleanLabel(near)} — ${cell.column}`;
  return near || cell.column;
}

// ─── Lecture du fichier ─────────────────────────────────────────────────────

const MAX_XML_BYTES = 40 * 1024 * 1024;
const MAX_FIELDS = 800;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

/** Extrait word/document.xml d'un .docx (archive ZIP), avec des messages clairs pour les fichiers protégés ou anciens. */
export function readDocumentXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new ImportError('Document Word protégé par mot de passe ou au format .doc : enregistrez-le en .docx, sans mot de passe, puis importez-le à nouveau.');
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new ImportError("Ce fichier n'est pas un document Word (.docx) valide.");
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' && f.originalSize <= MAX_XML_BYTES });
  } catch {
    throw new ImportError('Document Word endommagé : ouvrez-le dans Word, enregistrez-le à nouveau puis importez-le.');
  }
  const xml = files['word/document.xml'];
  if (!xml) throw new ImportError('Document Word illisible : contenu principal absent ou trop volumineux.');
  return new TextDecoder('utf-8').decode(xml);
}

/** Lit un formulaire Word et renvoie ses champs, avec des clés stables pour un même modèle de formulaire. */
export function parseDocx(bytes: Uint8Array): ParseResult {
  const xml = readDocumentXml(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml.slice(0, 2000))) throw new ImportError('Document Word non conforme (déclarations XML non autorisées).');
  let tree: XNode[];
  try {
    tree = parser.parse(xml) as XNode[];
  } catch {
    throw new ImportError('Document Word endommagé : contenu XML illisible.');
  }
  const doc = tree.find((n) => tagOf(n) === 'w:document');
  const body = doc ? child(doc, 'w:body') : undefined;
  if (!body) throw new ImportError('Document Word vide ou non conforme.');

  const labeler = new Labeler();
  labeler.blocks(readBlocks(kids(body)));
  const warnings: string[] = [];
  let found = labeler.out;
  if (found.length > MAX_FIELDS) {
    warnings.push(`Document très long : seuls les ${MAX_FIELDS} premiers champs sont repris.`);
    found = found.slice(0, MAX_FIELDS);
  }

  // Clés : étiquette ou nom du contrôle, sinon section + libellé + rang d'apparition.
  const seen = new Map<string, number>();
  const fields: ImportField[] = found.map((f) => {
    const base = f.name && !GENERIC_NAME.test(normalize(f.name))
      ? f.name.slice(0, 120)
      : `${slug(f.section) || 'document'}/${slug(f.label) || 'champ'}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const key = n > 1 ? `${base}#${n}` : base;
    const out: ImportField = { key, label: f.label, kind: f.kind, section: f.section || undefined };
    if (f.kind === 'checkbox') out.checked = !!f.checked;
    else out.value = f.value ?? '';
    return out;
  });

  if (!fields.length) warnings.push('Aucune case à cocher ni aucun champ détecté dans ce document Word : saisissez le plan à partir du fichier.');
  else if (!fields.some((f) => f.kind === 'checkbox')) warnings.push('Aucune case à cocher détectée : vérifiez que les cases du formulaire sont des contrôles Word ou des caractères ☐ / ☒.');
  return { format: 'docx', fields, warnings };
}
