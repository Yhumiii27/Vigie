// Rapports de contraste WCAG 2.x (UX-09) : luminance relative d'une couleur sRGB, couleurs « #rrggbb » ou « oklch(L C H) »
// (tons de statut de vigie.css). Règles pures, sans dépendance : mesures documentées dans contrast.test.ts.

export type Rgb = readonly [number, number, number];

/** Seuils WCAG 2.2 (AA) : texte courant 4,5:1, grand texte (≥ 18,66 px gras ou 24 px) et éléments graphiques 3:1. */
export const AA_TEXT = 4.5;
export const AA_LARGE = 3;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** « #rrggbb » ou « #rgb » → composantes sRGB entre 0 et 1. */
function parseHex(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`Couleur invalide : ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as unknown as Rgb;
}

/** sRGB linéaire → sRGB gamma (composante entre 0 et 1). */
const encode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** « oklch(L C H) » (L entre 0 et 1, H en degrés) → sRGB entre 0 et 1, ramené dans le gamut par écrêtage. */
function parseOklch(value: string): Rgb {
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/i.exec(value.trim());
  if (!m) throw new Error(`Couleur invalide : ${value}`);
  const L = Number(m[1]) / (m[2] ? 100 : 1);
  const C = Number(m[3]);
  const H = (Number(m[4]) * Math.PI) / 180;
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  return lin.map((v) => clamp01(encode(clamp01(v)))) as unknown as Rgb;
}

export function parseColor(value: string): Rgb {
  return value.trim().toLowerCase().startsWith('oklch') ? parseOklch(value) : parseHex(value);
}

/** Luminance relative WCAG d'une couleur. */
export function relativeLuminance(color: string): number {
  const [r, g, b] = parseColor(color).map(decode);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Couleur `fg` posée sur `bg` avec une opacité `alpha` (mélange en sRGB gamma, comme color-mix(in srgb) et opacity). */
export function blend(fg: string, bg: string, alpha: number): string {
  const f = parseColor(fg);
  const b = parseColor(bg);
  const hex = f.map((v, i) => Math.round((v * alpha + b[i] * (1 - alpha)) * 255).toString(16).padStart(2, '0')).join('');
  return `#${hex}`;
}

/** Rapport de contraste WCAG entre deux couleurs (1 à 21), arrondi au centième. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}
