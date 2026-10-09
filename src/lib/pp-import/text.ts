// Outils de texte de l'import du formulaire de plan de prévention (modules purs, sans dépendance serveur) :
// normalisation des libellés, dates et heures écrites à la française, rapprochement approximatif.

/** Minuscules sans accents ni ponctuation (« Lieu d’intervention : » → « lieu d intervention »). */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Identifiant technique dérivé d'un libellé (« Travail en hauteur » → « travail_en_hauteur »). */
export const slug = (s: string, max = 60) => normalize(s).replace(/ /g, '_').slice(0, max).replace(/_+$/, '');

/** Espaces normalisés (insécables, tabulations, retours à la ligne). */
export const squash = (s: string) => s.replace(/[\s     ]+/g, ' ').trim();

/** Libellé nettoyé : espaces, puces et deux-points de fin retirés, longueur bornée. */
export function cleanLabel(s: string, max = 200): string {
  const t = squash(s)
    .replace(/^[\s•▪◦·\-–—*>]+/, '')
    .replace(/[\s:：.…_]+$/, '')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Sigles conservés en capitales quand un titre écrit en capitales est remis en casse de phrase. */
const ACRONYMS = new Set(['ATEX', 'EPI', 'EPC', 'POI', 'PPI', 'SST', 'EU', 'EE', 'CACES', 'ICPE', 'FDS', 'DUERP', 'QHSE', 'HSE', 'BT', 'HT', 'TBT', 'CMR', 'ERP', 'SSI', 'RIA', 'PDP', 'PP', 'N°']);

/** « RISQUES D'INTERFÉRENCE – ATEX » → « Risques d'interférence – ATEX ». */
export function sentenceCase(s: string): string {
  if (!isUpper(s)) return s;
  const words = s.toLocaleLowerCase('fr').split(/(\s+)/).map((w, i) => {
    const upper = s.split(/(\s+)/)[i] ?? w;
    const bare = upper.replace(/[^A-ZÀ-Ý0-9°]/g, '');
    return ACRONYMS.has(bare) || (bare.length >= 2 && !/[AEIOUYÀ-ÆÈ-ÏÒ-ÖÙ-Ý]/.test(bare)) ? upper : w;
  });
  const out = words.join('');
  return out.charAt(0).toLocaleUpperCase('fr') + out.slice(1);
}

/** Titre de section nettoyé, sans numérotation ni capitales (« 3. RISQUES D'INTERFÉRENCE : » → « Risques d'interférence »). */
export const cleanHeading = (s: string) => sentenceCase(cleanLabel(cleanLabel(s).replace(/^(?:\d+(?:\.\d+)*|[IVXLC]+|[A-Za-z])[.)–-]\s+/, '')));

/** Valeur saisie nettoyée ; les pointillés, traits et textes d'invite Word valent « vide ». */
export function cleanValue(s: string | undefined | null, max = 4000): string {
  const t = squash(s ?? '');
  if (!t || /^[\s._\-–—…/|]+$/.test(t)) return '';
  if (/^(cliquez|appuyez|click|tap|choisissez un element|choose an item|entrez|saisissez|enter text)\b/i.test(normalize(t))) return '';
  return t.length > max ? t.slice(0, max) : t;
}

/** Nom technique → libellé lisible (« risqueTravail_hauteur2 » → « Risque travail hauteur 2 »). */
export function humanize(name: string): string {
  const s = name
    .replace(/\[\d+\]/g, '')
    .replace(/([a-zà-ÿ])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-zÀ-ÿ])(\d)/g, '$1 $2')
    .replace(/[_\-.#/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return name;
  return s[0].toUpperCase() + s.slice(1);
}

/** Texte entièrement en capitales (au moins trois lettres). */
export function isUpper(s: string): boolean {
  const letters = s.replace(/[^A-Za-zÀ-ÿ]/g, '');
  return letters.length >= 3 && s === s.toLocaleUpperCase('fr') && s !== s.toLocaleLowerCase('fr');
}

/** « Oui » au sens d'un formulaire : oui, x, coché, vrai, 1… */
export function isYes(raw: string | undefined | null): boolean {
  if (!raw) return false;
  if (/[☑☒✓✔✗✘■⊠⌧▣]/.test(raw)) return true;
  const n = normalize(raw);
  return ['oui', 'o', 'x', 'yes', 'y', '1', 'true', 'vrai', 'on', 'coche', 'cochee', 'checked'].includes(n);
}

/** « Non » au sens d'un formulaire. */
export function isNo(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const n = normalize(raw);
  return ['non', 'n', 'no', '0', 'false', 'faux', 'off'].includes(n);
}

// ─── Dates ──────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  janvier: 1, janv: 1, jan: 1, fevrier: 2, fevr: 2, fev: 2, mars: 3, mar: 3, avril: 4, avr: 4, mai: 5, juin: 6,
  juillet: 7, juil: 7, aout: 8, septembre: 9, sept: 9, sep: 9, octobre: 10, oct: 10, novembre: 11, nov: 11, decembre: 12, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');

function isoOf(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Date lue à partir d'un jeton : année, mois, jour, et dernier jeton utilisé. */
type DateHit = { y: number; m: number; d: number; iso: string; end: number };

function hitOf(y: number, m: number, d: number, end: number): DateHit | null {
  const iso = isoOf(y, m, d);
  return iso ? { y: +iso.slice(0, 4), m, d, iso, end } : null;
}

const isNum = (t: string | undefined, digits = '+') => !!t && new RegExp(`^\\d${digits}$`).test(t);

/** Date commençant exactement au jeton `i` (jetons normalisés : « 12 10 2026 », « 12 octobre 2026 », « 1 er oct »…). */
function dateAt(tokens: string[], i: number, refYear?: number): DateHit | null {
  const a = tokens[i], b = tokens[i + 1], c = tokens[i + 2];
  if (!isNum(a)) return null;
  // 2026 10 12
  if (a.length === 4 && isNum(b, '{1,2}') && isNum(c, '{1,2}')) return hitOf(+a, +b, +c, i + 2);
  if (a.length > 2) return null;
  const day = +a;
  // 12 octobre 2026 · 1er octobre
  const er = b === 'er' ? 1 : 0;
  const monthWord = tokens[i + 1 + er];
  if (monthWord && MONTHS[monthWord]) {
    const yearTok = tokens[i + 2 + er];
    const withYear = isNum(yearTok, '{2}') || isNum(yearTok, '{4}');
    const y = withYear ? +yearTok : refYear;
    return y ? hitOf(y, MONTHS[monthWord], day, i + 1 + er + (withYear ? 1 : 0)) : null;
  }
  // 12 10 2026 · 12 10 26 · 12 10 (année de référence)
  if (isNum(b, '{1,2}')) {
    if (isNum(c, '{2}') || isNum(c, '{4}')) return hitOf(+c, +b, day, i + 2);
    if (refYear && !isNum(c)) return hitOf(refYear, +b, day, i + 1);
  }
  return null;
}

/** Liaisons d'une période : « du 12 au 16 », « entre le 12 et le 16 », « 12-16 » (tiret converti en « au »). */
const RANGE_LINKS = new Set(['au', 'a', 'et']);

/**
 * Début d'une période écrite sans mois ni année, complété par la date de fin qui suit :
 * « du 12 au 16 octobre 2026 », « 12/10 au 16/10/2026 », « 28 décembre au 3 janvier 2027 ».
 */
function rangeStartAt(tokens: string[], i: number, refYear?: number): { start: string; end: DateHit } | null {
  if (!isNum(tokens[i], '{1,2}')) return null;
  const day = +tokens[i];
  let j = i + 1;
  if (tokens[j] === 'er') j += 1;
  let month: number | null = null;
  if (isNum(tokens[j], '{1,2}')) { month = +tokens[j]; j += 1; } else if (tokens[j] && MONTHS[tokens[j]]) { month = MONTHS[tokens[j]]; j += 1; }
  if (!RANGE_LINKS.has(tokens[j] ?? '')) return null;
  j += 1;
  if (tokens[j] === 'le') j += 1;
  const end = dateAt(tokens, j, refYear);
  if (!end) return null;
  const m = month ?? end.m;
  // Période à cheval sur deux années (« 28 décembre au 3 janvier 2027 »).
  const start = hitOf(m > end.m ? end.y - 1 : end.y, m, day, i);
  return start && start.iso <= end.iso ? { start: start.iso, end } : null;
}

/**
 * Toutes les dates lisibles d'un texte, dans l'ordre : « 12/10/2026 », « 12.10.26 », « 2026-10-12 »,
 * « 12 octobre 2026 », « lundi 12 oct. 2026 », « 12/10 » (année de référence), et les deux bornes d'une période
 * écrite en abrégé : « du 12 au 16 octobre 2026 », « 12-16/10/2026 », « du 12/10 au 16/10/2026 ».
 */
export function parseDates(raw: string | undefined | null, refYear?: number): string[] {
  if (!raw) return [];
  const prepared = raw
    // « 2026-10-12T00:00:00Z » → « 2026-10-12 »
    .replace(/T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/gi, ' ')
    // « 12-16/10/2026 », « 12/10-16/10/2026 », « 12 – 16 octobre » : le tiret d'une période devient « au »
    // (sauf à l'intérieur d'une date « 2026-10-12 »).
    .replace(/(?<!\d[-/.]\s?)\b(\d{1,2}(?:[/.]\d{1,2})?)\s*[-–—]\s*(?=\d{1,2}(?:er)?(?:[/.]\d{1,2}[/.]\d{2,4}\b|\s+[A-Za-zÀ-ÿ]{3}))/g, '$1 au ');
  // « 12/10/2026 » → « 12 10 2026 » ; « 1er » → « 1 er »
  const tokens = normalize(prepared).replace(/\b(\d{1,2})er\b/g, '$1 er').split(' ');
  const found: string[] = [];
  let lastEnd = -1; // dernier jeton d'une date trouvée
  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i];
    if (!isNum(a)) continue;
    // Jour en tête : pas au milieu d'une suite de nombres (numéro de téléphone, référence).
    const midNumber = i > 0 && i - 1 !== lastEnd && isNum(tokens[i - 1]);
    if (a.length <= 2 && midNumber) continue;
    const range = a.length <= 2 ? rangeStartAt(tokens, i, refYear) : null;
    if (range) {
      found.push(range.start, range.end.iso);
      i = lastEnd = range.end.end;
      continue;
    }
    const hit = dateAt(tokens, i, refYear);
    if (hit) {
      found.push(hit.iso);
      i = lastEnd = hit.end;
    }
  }
  return found;
}

/** Première date lisible d'un texte (AAAA-MM-JJ), ou null. */
export const parseDate = (raw: string | undefined | null, refYear?: number) => parseDates(raw, refYear)[0] ?? null;

/** Nombre d'heures écrit librement (« 1 200 h », « 60 heures », « 35,5 ») ; null si aucun nombre. */
export function parseHours(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const m = /(\d{1,3}(?:[\s  .]\d{3})+|\d+)(?:,(\d+))?/.exec(raw);
  if (!m) return null;
  const n = Number(m[1].replace(/[\s  .]/g, '') + (m[2] ? `.${m[2]}` : ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

// ─── Rapprochement ──────────────────────────────────────────────────────────

const LEGAL_WORDS = new Set(['entreprise', 'ets', 'etablissements', 'societe', 'ste', 'sarl', 'sas', 'sasu', 'sa', 'eurl', 'snc', 'groupe', 'cie', 'et', 'de', 'des', 'du', 'la', 'le', 'les']);

/** Mots significatifs d'une raison sociale (formes juridiques et mots vides retirés). */
export const nameTokens = (s: string) => normalize(s).split(' ').filter((w) => w && !LEGAL_WORDS.has(w));

/** Similarité de deux ensembles de mots (0 à 1, coefficient de Dice). */
export function tokenSimilarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sb = new Set(b);
  const common = new Set(a.filter((w) => sb.has(w))).size;
  return (2 * common) / (new Set(a).size + sb.size);
}

/** Meilleure entreprise correspondant à un nom lu (nom normalisé identique, ou très proche). */
export function matchByName<T extends { name: string }>(raw: string, list: T[]): T | null {
  const wanted = nameTokens(raw);
  if (!wanted.length) return null;
  const key = wanted.join(' ');
  const exact = list.find((c) => nameTokens(c.name).join(' ') === key);
  if (exact) return exact;
  let best: T | null = null, score = 0;
  for (const c of list) {
    const s = tokenSimilarity(wanted, nameTokens(c.name));
    if (s > score) { score = s; best = c; }
  }
  return score >= 0.8 ? best : null;
}

/**
 * Projet Keystone correspondant à un texte lu (« K-2025-042 », « affaire 2025-042 [Client A] »,
 * ou le client et l'intitulé) ; `options` = [valeur, libellé] des listes de choix.
 */
export function matchProject(raw: string, options: readonly (readonly [string, string])[]): string | null {
  const text = squash(raw);
  if (!text) return null;
  // Référence « K-2025-042 » (préfixe K), ou « 2025-042 » sans préfixe : numéro à 3 chiffres qui ne se prolonge pas
  // en date (« 2026-10-12 » n'est pas une référence d'affaire).
  const ref = /\bK\s*-?\s*(\d{4})\s*[-/ ]\s*(\d{2,3})(?![\d]|[-/.]\d)/i.exec(text)
    ?? /(?<![\d/.-])\b(\d{4})-(\d{3})(?![\d]|[-/.]\d)/.exec(text);
  if (ref) {
    const id = `K-${ref[1]}-${ref[2].padStart(3, '0')}`;
    const hit = options.find(([v]) => v.startsWith(`${id} `) || v === id);
    if (hit) return hit[0];
  }
  const words = normalize(text).split(' ').filter((w) => w.length > 1);
  let best: string | null = null, score = 0;
  for (const [value, label] of options) {
    const s = tokenSimilarity(words, normalize(label).split(' ').filter((w) => w.length > 1));
    if (s > score) { score = s; best = value; }
  }
  return score >= 0.6 ? best : null;
}
