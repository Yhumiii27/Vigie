// Type réel d'un fichier d'après ses octets (SEC-08, PRD-13) et retrait des métadonnées d'une photo (SEC-09).
// Règles pures, sans dépendance serveur : testées dans file-type.test.ts.
//
// Le type annoncé par le navigateur (File.type) n'est pas fiable : une pièce jointe n'est enregistrée que si son contenu
// correspond à un format admis, et c'est le type tiré du contenu qui est enregistré puis servi par /fichiers.

import { unzipSync } from 'fflate';

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, Math.min(to, bytes.length)));

/**
 * Type d'image d'après les premiers octets : JPEG, PNG, GIF, WebP, HEIC/HEIF ; null pour tout autre contenu (SVG compris,
 * jamais admis : il peut porter du script).
 */
export function sniffImage(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)) return 'image/heic';
    if (['mif1', 'msf1'].includes(brand)) return 'image/heif';
  }
  return null;
}

export const OOXML_TYPES = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
} as const;
/** Anciens formats Office (conteneur OLE) : Word 97-2003 et Excel 97-2003, encore admis (§ 19 : à reconsidérer). */
export const LEGACY_OFFICE_TYPES = ['application/msword', 'application/vnd.ms-excel'] as const;
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Document Office récent (archive ZIP) : type d'après ses parties ; null si ce n'en est pas un ou s'il porte des macros. */
function ooxmlType(bytes: Uint8Array): string | null {
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) return null;
  const names: string[] = [];
  try {
    // Lecture du répertoire central seulement : aucune partie n'est décompressée.
    unzipSync(bytes, { filter: (f) => { names.push(f.name); return false; } });
  } catch {
    return null;
  }
  if (!names.includes('[Content_Types].xml')) return null;
  // Macros (vbaProject.bin) : refusé, même sous une extension .docx / .xlsx.
  if (names.some((n) => /(^|\/)vbaProject\.bin$/i.test(n))) return null;
  if (names.some((n) => n.startsWith('word/'))) return OOXML_TYPES.docx;
  if (names.some((n) => n.startsWith('xl/'))) return OOXML_TYPES.xlsx;
  if (names.some((n) => n.startsWith('ppt/'))) return OOXML_TYPES.pptx;
  return null;
}

/** Texte brut : aucun octet nul ni caractère de contrôle binaire dans les 64 premiers Ko (UTF-8 ou Latin-1). */
function isPlainText(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 64 * 1024);
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0 || (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x0c)) return false;
  }
  return true;
}

/**
 * Type admis d'un fichier d'après son contenu, rapproché du type annoncé : image (le type réel l'emporte), PDF, Word, Excel,
 * PowerPoint récents (sans macros), Word et Excel 97-2003 (conteneur OLE, type annoncé gardé), texte et CSV (sans octet
 * binaire). null : contenu non reconnu ou contraire au type annoncé (refusé).
 */
export function detectFileType(bytes: Uint8Array, declared: string): string | null {
  const image = sniffImage(bytes);
  if (image) return declared.startsWith('image/') || !declared ? image : null;
  // %PDF- dans le premier kilo-octet (certains générateurs le précèdent d'octets parasites).
  if (ascii(bytes, 0, 1024).includes('%PDF-')) return declared === 'application/pdf' || !declared ? 'application/pdf' : null;
  const office = ooxmlType(bytes);
  if (office) return declared === office || !declared || declared === 'application/zip' || declared === 'application/octet-stream' ? office : null;
  if (OLE_SIGNATURE.every((b, i) => bytes[i] === b)) return (LEGACY_OFFICE_TYPES as readonly string[]).includes(declared) ? declared : null;
  if ((declared === 'text/plain' || declared === 'text/csv') && isPlainText(bytes)) return declared;
  return null;
}

/** Types servis « inline » par /fichiers (affichés dans le navigateur) ; tout le reste est téléchargé. */
export const INLINE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'] as const;
export const isInlineType = (mime: string) => (INLINE_TYPES as readonly string[]).includes(mime);

/** Nom de fichier sûr pour l'en-tête Content-Disposition et l'affichage : sans chemin, contrôle ni marque bidirectionnelle. */
export function safeFileName(name: string, fallback = 'fichier'): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩"]/g, '').trim().slice(0, 200);
  return clean && clean !== '.' && clean !== '..' ? clean : fallback;
}

/** Repli ASCII du nom (paramètre filename= des anciens navigateurs). */
export const asciiFileName = (name: string) =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/[\\";]/g, '_') || 'fichier';

// ─── Métadonnées des photos (signalement anonyme ou sans compte, SEC-09) ──────

const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u32le = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + ((b[i + 3] << 24) >>> 0);
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/** JPEG : segments APP1 à APP15 (EXIF, XMP, IPTC…) et commentaires retirés, sauf profil de couleur ICC (APP2) et Adobe (APP14). */
function stripJpeg(b: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; } // octet de remplissage
    if (marker === 0xd9) { parts.push(b.subarray(i)); return concat(parts); }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { parts.push(b.subarray(i, i + 2)); i += 2; continue; }
    const len = u16(b, i + 2);
    if (len < 2 || i + 2 + len > b.length) return null;
    const segment = b.subarray(i, i + 2 + len);
    if (marker === 0xda) { parts.push(b.subarray(i)); return concat(parts); } // début des données : la suite est copiée
    const app = marker >= 0xe1 && marker <= 0xef;
    const keep = !app && marker !== 0xfe
      || (marker === 0xe2 && ascii(b, i + 4, i + 15) === 'ICC_PROFILE')
      || (marker === 0xee && ascii(b, i + 4, i + 9) === 'Adobe');
    if (keep) parts.push(segment);
    i += 2 + len;
  }
  return null;
}

/** PNG : morceaux de texte (tEXt, zTXt, iTXt), EXIF (eXIf) et date (tIME) retirés. */
function stripPng(b: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = u32(b, i);
    const type = ascii(b, i + 4, i + 8);
    const end = i + 12 + len;
    if (end > b.length) return null;
    if (!['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'].includes(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') return concat(parts);
  }
  return null;
}

/** WebP : morceaux EXIF et XMP retirés, indicateurs de l'en-tête VP8X et taille RIFF mis à jour. */
function stripWebp(b: Uint8Array): Uint8Array | null {
  const chunks: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, i + 4);
    const len = u32le(b, i + 4);
    const end = i + 8 + len + (len % 2);
    if (i + 8 + len > b.length) return null;
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = b.slice(i, Math.min(end, b.length));
      if (type === 'VP8X' && chunk.length > 8) chunk[8] &= ~0x0c; // indicateurs EXIF (0x08) et XMP (0x04)
      chunks.push(chunk);
    }
    i = end;
  }
  const body = concat(chunks);
  const head = new Uint8Array(12);
  head.set(b.subarray(0, 4), 0);
  const size = body.length + 4;
  head.set([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff], 4);
  head.set(b.subarray(8, 12), 8);
  return concat([head, body]);
}

/** GIF : extensions de commentaire et d'application (XMP…) retirées, sauf la boucle d'animation (NETSCAPE2.0). */
function stripGif(b: Uint8Array): Uint8Array | null {
  if (b.length < 13) return null;
  let i = 13;
  if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 0x07) + 1));
  const parts: Uint8Array[] = [b.subarray(0, i)];
  const skipSubBlocks = (j: number) => {
    while (j < b.length && b[j] !== 0) j += b[j] + 1;
    return j < b.length ? j + 1 : -1;
  };
  while (i < b.length) {
    const start = i;
    if (b[i] === 0x3b) { parts.push(b.subarray(i, i + 1)); return concat(parts); }
    if (b[i] === 0x21) {
      const label = b[i + 1];
      const end = skipSubBlocks(i + 2);
      if (end < 0) return null;
      const app = label === 0xff && ascii(b, i + 3, i + 14) === 'NETSCAPE2.0';
      if (label !== 0xfe && (label !== 0xff || app)) parts.push(b.subarray(start, end));
      i = end;
    } else if (b[i] === 0x2c) {
      let j = i + 10;
      if (b[i + 9] & 0x80) j += 3 * (1 << ((b[i + 9] & 0x07) + 1));
      const end = skipSubBlocks(j + 1);
      if (end < 0) return null;
      parts.push(b.subarray(start, end));
      i = end;
    } else return null;
  }
  return null;
}

type Box = { type: string; start: number; body: number; end: number };
/** Boîtes ISOBMFF de [from, to). */
function boxes(b: Uint8Array, from: number, to: number): Box[] | null {
  const out: Box[] = [];
  let i = from;
  while (i + 8 <= to) {
    let size = u32(b, i);
    let body = i + 8;
    if (size === 1) {
      if (i + 16 > to || u32(b, i + 8) !== 0) return null;
      size = u32(b, i + 12);
      body = i + 16;
    } else if (size === 0) size = to - i;
    if (size < body - i || i + size > to) return null;
    out.push({ type: ascii(b, i + 4, i + 8), start: i, body, end: i + size });
    i += size;
  }
  return out;
}

/**
 * HEIC / HEIF : données des éléments « Exif » et XMP (type mime application/rdf+xml) mises à zéro, structure inchangée
 * (iinf et iloc de la boîte meta). null si la structure n'est pas comprise.
 */
function stripHeif(src: Uint8Array): Uint8Array | null {
  const b = src.slice();
  const top = boxes(b, 0, b.length);
  const meta = top?.find((x) => x.type === 'meta');
  if (!top || !meta) return null;
  const inner = boxes(b, meta.body + 4, meta.end);
  if (!inner) return null;
  const iinf = inner.find((x) => x.type === 'iinf');
  const iloc = inner.find((x) => x.type === 'iloc');
  const idat = inner.find((x) => x.type === 'idat');
  if (!iinf || !iloc) return b; // aucun élément : rien à retirer
  const metaItems = new Set<number>();
  const iinfVersion = b[iinf.body];
  const entries = boxes(b, iinf.body + 4 + (iinfVersion === 0 ? 2 : 4), iinf.end);
  if (!entries) return null;
  for (const e of entries.filter((x) => x.type === 'infe')) {
    const v = b[e.body];
    if (v < 2) continue;
    let p = e.body + 4;
    const id = v === 2 ? u16(b, p) : u32(b, p);
    p += (v === 2 ? 2 : 4) + 2;
    const itemType = ascii(b, p, p + 4);
    p += 4;
    let mimeType = '';
    if (itemType === 'mime') {
      while (p < e.end && b[p] !== 0) p++; // nom de l'élément
      const q = ++p;
      while (p < e.end && b[p] !== 0) p++;
      mimeType = ascii(b, q, p);
    }
    if (itemType === 'Exif' || (itemType === 'mime' && /rdf\+xml|xmp/i.test(mimeType))) metaItems.add(id);
  }
  if (!metaItems.size) return b;
  const v = b[iloc.body];
  let p = iloc.body + 4;
  const offsetSize = b[p] >> 4, lengthSize = b[p] & 0x0f, baseSize = b[p + 1] >> 4, indexSize = v >= 1 ? b[p + 1] & 0x0f : 0;
  p += 2;
  const read = (n: number) => {
    let val = 0;
    if (n === 8) { if (u32(b, p) !== 0) throw new Error('offset'); val = u32(b, p + 4); }
    else if (n === 4) val = u32(b, p);
    else if (n === 2) val = u16(b, p);
    else if (n !== 0) throw new Error('taille');
    p += n;
    return val;
  };
  try {
    const count = v < 2 ? read(2) : read(4);
    for (let k = 0; k < count; k++) {
      const id = v < 2 ? read(2) : read(4);
      const method = v >= 1 ? read(2) & 0x0f : 0;
      read(2); // data_reference_index
      const base = read(baseSize);
      const extents = read(2);
      for (let x = 0; x < extents; x++) {
        if (indexSize) read(indexSize);
        const offset = read(offsetSize);
        const length = read(lengthSize);
        if (!metaItems.has(id)) continue;
        const origin = method === 1 ? idat?.body : method === 0 ? 0 : undefined;
        if (origin === undefined) return null;
        const from = origin + base + offset;
        const to = length ? from + length : (method === 1 ? idat!.end : b.length);
        if (from < 0 || to > b.length || from > to) return null;
        b.fill(0, from, to);
      }
    }
  } catch {
    return null;
  }
  return b;
}

/**
 * Photo sans métadonnées (position GPS, appareil, date, auteur, logiciel) : JPEG, PNG, WebP, GIF réécrits sans leurs
 * segments de métadonnées, HEIC/HEIF avec leurs éléments EXIF et XMP effacés. null si le format n'est pas pris en charge
 * ou si le fichier est mal formé (la photo est alors refusée).
 */
export function stripImageMetadata(bytes: Uint8Array, mime: string): Uint8Array | null {
  switch (mime) {
    case 'image/jpeg': return stripJpeg(bytes);
    case 'image/png': return stripPng(bytes);
    case 'image/webp': return stripWebp(bytes);
    case 'image/gif': return stripGif(bytes);
    case 'image/heic':
    case 'image/heif': return stripHeif(bytes);
    default: return null;
  }
}
