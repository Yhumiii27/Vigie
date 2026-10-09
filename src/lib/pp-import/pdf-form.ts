// Lecture d'un PDF remplissable (formulaire AcroForm) avec pdf-lib : cases, textes, boutons radio, listes.
// Un PDF sans champ (aplati, imprimé puis numérisé) est classé « scan ». Module pur, testable avec node.

import {
  PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFHexString, PDFName, PDFOptionList, PDFRadioGroup, PDFRef, PDFSignature, PDFString, PDFTextField,
  type PDFField,
} from 'pdf-lib';
import type { FieldBox } from './pdf-text';
import { cleanHeading, cleanLabel, cleanValue, humanize, normalize } from './text';
import { ImportError, type ImportField, type ParseResult } from './types';

/**
 * Résultat de la lecture d'un PDF : champs, et rectangle du premier widget de chaque champ (libellés voisins).
 * `encrypted` : PDF chiffré, que pdf-lib ne sait pas déchiffrer (ses champs se lisent avec pdf.js, voir fieldsFromWidgets).
 * `preferText` : champs dont le libellé et la section ne viennent que du nom technique (texte imprimé voisin préféré).
 */
export type PdfParseResult = ParseResult & { boxes: Record<string, FieldBox>; encrypted?: boolean; preferText?: string[] };

const MAX_FIELDS = 800;
/** Sous-formulaires génériques des PDF issus de LiveCycle / Acrobat : sans valeur comme titre de section. */
const GENERIC_PARENT = /^(topmostsubform|form\d*|formulaire\d*|page\d*|subform\d*|sous formulaire\d*|untitled)$/;

const decodeText = (v: unknown): string | undefined =>
  v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined;

/** Infobulle (/TU) d'un champ, libellé lisible donné par l'auteur du formulaire. */
function tooltip(dict: PDFDict): string | undefined {
  try {
    return decodeText(dict.lookup(PDFName.of('TU')))?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Le champ porte un format de date Acrobat (AFDate_FormatEx) dans ses actions de formatage. */
function hasDateFormat(dict: PDFDict): boolean {
  try {
    const aa = dict.lookup(PDFName.of('AA'));
    if (!(aa instanceof PDFDict)) return false;
    const f = aa.lookup(PDFName.of('F'));
    if (!(f instanceof PDFDict)) return false;
    return /AFDate_/.test(decodeText(f.lookup(PDFName.of('JS'))) ?? '');
  } catch {
    return false;
  }
}

/** Dernier segment du nom complet (« risques.hauteur[0] » → « hauteur »). */
const lastSegment = (name: string) => name.replace(/\[\d+\]/g, '').split('.').filter(Boolean).pop() ?? name;

/** Section d'un champ : infobulle ou nom de son champ parent (champs hiérarchiques « risques.hauteur »). */
function sectionOf(field: PDFField): string | undefined {
  try {
    const parent = field.acroField.getParent();
    if (!parent) return undefined;
    const tu = tooltip(parent.dict);
    if (tu) return cleanHeading(tu);
    const partial = parent.getPartialName()?.replace(/\[\d+\]/g, '') ?? '';
    if (!partial || GENERIC_PARENT.test(normalize(partial))) return undefined;
    return humanize(partial);
  } catch {
    return undefined;
  }
}

/** Numéro de page (à partir de 1) du premier widget du champ. */
function pageOf(field: PDFField, doc: PDFDocument, pages: { ref: PDFRef; annots: Set<PDFRef> }[]): number | undefined {
  try {
    const widget = field.acroField.getWidgets()[0];
    if (!widget) return undefined;
    const p = widget.P();
    let index = p ? pages.findIndex((x) => x.ref === p) : -1;
    if (index < 0) {
      const ref = doc.context.getObjectRef(widget.dict);
      if (ref) index = pages.findIndex((x) => x.annots.has(ref));
    }
    return index >= 0 ? index + 1 : undefined;
  } catch {
    return undefined;
  }
}

/** Rectangle du premier widget du champ. */
function rectOf(field: PDFField): { x: number; y: number; w: number; h: number } | undefined {
  try {
    const r = field.acroField.getWidgets()[0]?.getRectangle();
    return r && [r.x, r.y, r.width, r.height].every(Number.isFinite) ? { x: r.x, y: r.y, w: Math.abs(r.width), h: Math.abs(r.height) } : undefined;
  } catch {
    return undefined;
  }
}

/** Case cochée : valeur /V du champ, à défaut état d'apparence /AS de ses widgets. */
function checkBoxState(field: PDFCheckBox): boolean {
  try {
    const v = field.acroField.dict.lookup(PDFName.of('V'));
    if (v instanceof PDFName) return field.isChecked();
    return field.acroField.getWidgets().some((w) => {
      const as = w.getAppearanceState();
      return !!as && as !== PDFName.of('Off');
    });
  } catch {
    return false;
  }
}

/** Lit un PDF ; renvoie format « pdf_form » et ses champs, ou « scan » s'il ne contient aucun champ lisible. */
export async function parsePdfForm(bytes: Uint8Array): Promise<PdfParseResult> {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 1024));
  if (!head.includes('%PDF-')) throw new ImportError("Ce fichier n'est pas un PDF valide.");
  const damaged = 'PDF endommagé ou illisible : ouvrez-le puis enregistrez-le à nouveau (ou imprimez-le en PDF) avant de l’importer.';
  let doc: PDFDocument;
  let pageCount: number;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    pageCount = doc.getPageCount();
  } catch {
    throw new ImportError(damaged);
  }
  if (!pageCount) throw new ImportError(damaged);
  if (doc.isEncrypted) {
    // Souvent un formulaire « protégé contre la modification » (mot de passe propriétaire seul) : l'appelant
    // relit ses champs avec pdf.js (fieldsFromWidgets) avant de le traiter comme un scan.
    return { format: 'scan', fields: [], pageCount, boxes: {}, encrypted: true, warnings: [ENCRYPTED_WARNING] };
  }

  let form;
  let raw: PDFField[] = [];
  try {
    form = doc.getForm();
    raw = form.getFields();
  } catch {
    return { format: 'scan', fields: [], pageCount, boxes: {}, warnings: ['Formulaire PDF non standard : ses champs ne peuvent pas être lus directement.'] };
  }
  const warnings: string[] = [];
  const signed = raw.filter((f) => f instanceof PDFSignature && !!f.acroField.dict.lookup(PDFName.of('V'))).length;
  const inputs = raw.filter((f) => f instanceof PDFCheckBox || f instanceof PDFTextField || f instanceof PDFRadioGroup || f instanceof PDFDropdown || f instanceof PDFOptionList);
  if (!inputs.length) {
    let xfa = false;
    try { xfa = form.hasXFA(); } catch { /* formulaire illisible */ }
    return {
      format: 'scan', fields: [], pageCount, boxes: {},
      warnings: xfa ? ['Formulaire PDF dynamique (XFA, Adobe LiveCycle) : imprimez-le en PDF ou enregistrez-le en PDF standard pour en lire les champs.'] : [],
    };
  }
  if (inputs.length > MAX_FIELDS) warnings.push(`Formulaire très long : seuls les ${MAX_FIELDS} premiers champs sont repris.`);
  if (signed) warnings.push(`${signed > 1 ? `${signed} signatures électroniques présentes` : 'Signature électronique présente'} dans le PDF : vérifiez-la dans le fichier source, elle n'est pas reprise.`);

  const pages = doc.getPages().map((p) => {
    const annots = new Set<PDFRef>();
    try {
      p.node.Annots()?.asArray().forEach((a) => { if (a instanceof PDFRef) annots.add(a); });
    } catch { /* annotations illisibles */ }
    return { ref: p.ref, annots };
  });

  const fields: ImportField[] = [];
  const boxes: Record<string, FieldBox> = {};
  const seen = new Set<string>();
  for (const field of inputs.slice(0, MAX_FIELDS)) {
    let name: string;
    try {
      name = field.getName();
    } catch {
      continue;
    }
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const dict = field.acroField.dict;
    const label = cleanLabel(tooltip(dict) ?? '') || humanize(lastSegment(name));
    const base = { key: name, label, section: sectionOf(field), page: pageOf(field, doc, pages) };
    const rect = rectOf(field);
    if (rect && base.page) boxes[name] = { page: base.page, ...rect };
    try {
      if (field instanceof PDFCheckBox) {
        fields.push({ ...base, kind: 'checkbox', checked: checkBoxState(field) });
      } else if (field instanceof PDFTextField) {
        const value = cleanValue(field.getText() ?? '');
        const isDate = hasDateFormat(dict) || /\bdate\b/.test(normalize(`${label} ${lastSegment(name)}`));
        fields.push({ ...base, kind: isDate ? 'date' : 'text', value });
      } else if (field instanceof PDFRadioGroup) {
        fields.push({ ...base, kind: 'choice', value: cleanValue(field.getSelected() ?? '') });
      } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
        fields.push({ ...base, kind: 'choice', value: cleanValue(field.getSelected().join(', ')) });
      }
    } catch {
      warnings.push(`Champ « ${label} » illisible : ignoré.`);
    }
  }
  return { format: 'pdf_form', fields, warnings, pageCount, boxes };
}

// ─── PDF protégé : champs lus avec pdf.js ───────────────────────────────────

export const ENCRYPTED_WARNING = 'PDF protégé (chiffré) : ses champs ne peuvent pas être lus directement. Enregistrez une copie sans protection pour une lecture exacte des champs.';
export const PASSWORD_WARNING = "PDF protégé par un mot de passe d'ouverture : il ne peut pas être lu. Importez une copie enregistrée sans mot de passe, ou saisissez le plan à partir du fichier.";

/**
 * Widget de formulaire tel que pdf.js le décrit (page.getAnnotations()) ; page comptée à partir de 1.
 * pdf.js déchiffre les PDF protégés par un simple mot de passe propriétaire, ce que pdf-lib ne fait pas.
 */
export type PdfWidget = {
  page: number;
  fieldName?: string;
  fieldType?: string | null; // Tx, Btn, Ch, Sig
  fieldValue?: unknown;
  alternativeText?: string;
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  datetimeFormat?: string;
  rect?: number[];
};

const widgetText = (v: unknown): string => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').join(', ') : typeof v === 'string' ? v : '');

/** Section d'un champ d'après son nom hiérarchique (« risques.hauteur » → « Risques »). */
function sectionFromName(name: string): string | undefined {
  const parts = name.replace(/\[\d+\]/g, '').split('.').filter(Boolean);
  const parent = parts.length > 1 ? parts[parts.length - 2] : '';
  if (!parent || GENERIC_PARENT.test(normalize(parent))) return undefined;
  return humanize(parent);
}

/**
 * Champs d'un PDF remplissable à partir de ses widgets lus par pdf.js (PDF chiffré) : mêmes clés que parsePdfForm
 * (nom complet du champ), donc même empreinte et même modèle que la version non protégée du formulaire.
 */
export function fieldsFromWidgets(widgets: PdfWidget[], pageCount: number): PdfParseResult {
  const groups = new Map<string, PdfWidget[]>();
  for (const w of widgets) {
    const name = w.fieldName?.trim();
    if (!name || w.pushButton || !['Tx', 'Btn', 'Ch'].includes(w.fieldType ?? '')) continue;
    groups.set(name, [...(groups.get(name) ?? []), w]);
  }
  const warnings: string[] = [];
  if (groups.size > MAX_FIELDS) warnings.push(`Formulaire très long : seuls les ${MAX_FIELDS} premiers champs sont repris.`);
  const fields: ImportField[] = [];
  const boxes: Record<string, FieldBox> = {};
  const preferText: string[] = [];
  for (const [name, list] of [...groups].slice(0, MAX_FIELDS)) {
    const first = list[0];
    // pdf.js ne lit l'infobulle (/TU) que sur le widget : sans elle, le libellé imprimé à côté sera préféré au nom technique.
    const tooltipText = cleanLabel(list.find((w) => w.alternativeText?.trim())?.alternativeText ?? '');
    if (!tooltipText) preferText.push(name);
    const label = tooltipText || humanize(lastSegment(name));
    const page = Number.isInteger(first.page) && first.page >= 1 ? first.page : undefined;
    const base = { key: name, label, section: sectionFromName(name), page };
    const r = first.rect;
    if (page && r?.length === 4 && r.every(Number.isFinite)) {
      boxes[name] = { page, x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]), w: Math.abs(r[2] - r[0]), h: Math.abs(r[3] - r[1]) };
    }
    if (first.fieldType === 'Btn' && first.checkBox) {
      // Valeur « Off » (ou absente) : case vide ; toute autre valeur est l'état coché d'un de ses widgets.
      fields.push({ ...base, kind: 'checkbox', checked: list.some((w) => typeof w.fieldValue === 'string' && w.fieldValue !== 'Off') });
    } else if (first.fieldType === 'Btn') {
      const v = widgetText(list.find((w) => typeof w.fieldValue === 'string' && w.fieldValue !== 'Off')?.fieldValue);
      fields.push({ ...base, kind: 'choice', value: cleanValue(v) });
    } else if (first.fieldType === 'Ch') {
      fields.push({ ...base, kind: 'choice', value: cleanValue(widgetText(first.fieldValue)) });
    } else {
      // Format de date Acrobat (AFDate_FormatEx « dd/mm/yyyy ») ; un format d'heure (« HH:MM ») n'en est pas un.
      const isDate = /[dy]/i.test(first.datetimeFormat ?? '') ||/\bdate\b/.test(normalize(`${label} ${lastSegment(name)}`));
      fields.push({ ...base, kind: isDate ? 'date' : 'text', value: cleanValue(widgetText(first.fieldValue)) });
    }
  }
  return { format: fields.length ? 'pdf_form' : 'scan', fields, warnings, pageCount, boxes, preferText };
}
