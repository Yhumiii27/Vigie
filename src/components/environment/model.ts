// Règles métier « Environnement et déchets » (partagées serveur / client, sans dépendance serveur).
// Registre chronologique des déchets sortants : Code de l'environnement R. 541-43 et arrêté du 31 mai 2021.
// Bordereau de suivi dématérialisé (Trackdéchets) obligatoire pour les déchets dangereux (R. 541-45).

import type { Tone } from '@/lib/domain';

// ─── Bordereaux de suivi (BSD) ──────────────────────────────────────────────

export type BsdStatus = 'brouillon' | 'emis' | 'collecte' | 'traite';
export const BSD_STATUS: Record<BsdStatus, { label: string; tone: Tone }> = {
  brouillon: { label: 'Brouillon', tone: 'warn' },
  emis: { label: 'Émis', tone: 'accent' },
  collecte: { label: 'Collecté', tone: 'neutral' },
  traite: { label: 'Traité', tone: 'ok' },
};
export const BSD_STATUS_KEYS = Object.keys(BSD_STATUS) as BsdStatus[];
export const isBsdStatus = (s: string | null | undefined): s is BsdStatus => !!s && s in BSD_STATUS;

/** Numéro de bordereau : lettres, chiffres et tirets (ex. BSD-20260312-7KQ4P2XR). */
export const BSD_NUMBER = /^[A-Z0-9][A-Z0-9-]{5,39}$/;
export const BSD_PLACEHOLDER = 'BSD-AAAAMMJJ-XXXXXXXX';

// ─── Codes déchet et codes de traitement ────────────────────────────────────

/**
 * Normalise un code de la liste européenne des déchets : « 130110 * » → « 13 01 10* ».
 * Renvoie null si le code n'a pas 6 chiffres (suivis éventuellement de l'astérisque des déchets dangereux).
 */
export function normalizeEwc(raw: string): string | null {
  const s = raw.replace(/\s+/g, '');
  const m = /^(\d{2})(\d{2})(\d{2})(\*?)$/.exec(s);
  return m ? `${m[1]} ${m[2]} ${m[3]}${m[4]}` : null;
}
/** Un déchet est dangereux lorsque son code porte un astérisque (C. env. R. 541-8). */
export const isHazardousCode = (code: string) => code.trim().endsWith('*');

/** Opérations de valorisation (R) et d'élimination (D) — annexes I et II de la directive 2008/98/CE. */
export const TREATMENT_CODES: readonly (readonly [code: string, label: string])[] = [
  ['R1', 'Utilisation principale comme combustible ou pour produire de l’énergie'],
  ['R2', 'Récupération ou régénération des solvants'],
  ['R3', 'Recyclage des substances organiques non utilisées comme solvants'],
  ['R4', 'Recyclage ou récupération des métaux et composés métalliques'],
  ['R5', 'Recyclage ou récupération d’autres matières inorganiques'],
  ['R6', 'Régénération des acides ou des bases'],
  ['R7', 'Récupération des produits servant à capter les polluants'],
  ['R8', 'Récupération des produits provenant des catalyseurs'],
  ['R9', 'Régénération ou autres réemplois des huiles'],
  ['R10', 'Épandage sur le sol au profit de l’agriculture ou de l’écologie'],
  ['R11', 'Utilisation de déchets résiduels issus des opérations R1 à R10'],
  ['R12', 'Échange de déchets en vue d’une opération R1 à R11'],
  ['R13', 'Stockage préalable à une opération R1 à R12'],
  ['D1', 'Dépôt sur ou dans le sol (mise en décharge)'],
  ['D2', 'Traitement en milieu terrestre'],
  ['D3', 'Injection en profondeur'],
  ['D4', 'Lagunage'],
  ['D5', 'Mise en décharge spécialement aménagée'],
  ['D6', 'Rejet dans le milieu aquatique, sauf l’immersion'],
  ['D7', 'Immersion, y compris enfouissement dans le sous-sol marin'],
  ['D8', 'Traitement biologique'],
  ['D9', 'Traitement physico-chimique'],
  ['D10', 'Incinération à terre'],
  ['D11', 'Incinération en mer'],
  ['D12', 'Stockage permanent'],
  ['D13', 'Regroupement ou mélange préalable à une opération D1 à D12'],
  ['D14', 'Reconditionnement préalable à une opération D1 à D13'],
  ['D15', 'Stockage préalable à une opération D1 à D14'],
];
export const TREATMENT_KEYS = TREATMENT_CODES.map(([c]) => c);
export const treatmentLabel = (code: string) => TREATMENT_CODES.find(([c]) => c === code)?.[1] ?? code;
/** Valorisation (R1–R13) ou élimination (D1–D15). */
export const isRecovery = (code: string) => code.startsWith('R');

// ─── Unités et quantités ────────────────────────────────────────────────────

export const WASTE_UNITS: readonly (readonly [value: string, label: string])[] = [
  ['kg', 'kg'], ['t', 't'], ['L', 'L'], ['m³', 'm³'],
];
export const WASTE_UNIT_KEYS = WASTE_UNITS.map(([u]) => u);
/** Quantité en tonnes pour les unités de masse ; null pour un volume (non pesé). */
export const toTonnes = (quantity: number, unit: string) => (unit === 'kg' ? quantity / 1000 : unit === 't' ? quantity : null);

// ─── Consommations ──────────────────────────────────────────────────────────

export type ConsumptionKind = 'electricite' | 'gaz' | 'eau';
export const CONSUMPTION_KINDS: { key: ConsumptionKind; label: string; unit: string; icon: string }[] = [
  { key: 'electricite', label: 'Électricité', unit: 'kWh', icon: 'ph-lightning' },
  { key: 'gaz', label: 'Gaz', unit: 'kWh', icon: 'ph-flame' },
  { key: 'eau', label: 'Eau', unit: 'm³', icon: 'ph-drop' },
];

// ─── Mise en forme (déterministe : identique côté serveur et navigateur) ────

/** Minuscule initiale sauf sigle (« DIB », « CSR ») : « Déchets en mélange (DIB) » → « déchets en mélange (DIB) ». */
export const lcfirst = (s: string) => (s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s);

const NNBSP = ' ';

/** 12 345,6 — séparateur de milliers insécable, virgule décimale. */
export function fmtNum(n: number, decimals = 0): string {
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, dec] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  const sign = n < 0 && Number(fixed) !== 0 ? '−' : '';
  return `${sign}${grouped}${dec && Number(dec) !== 0 ? `,${dec.replace(/0+$/, '')}` : ''}`;
}

/** Quantité avec son unité : « 1 250 kg », « 2,4 t ». */
export const fmtQty = (n: number, unit: string) => `${fmtNum(n, unit === 'kg' || unit === 'L' ? 0 : 2)}${NNBSP}${unit}`;

/** Pourcentage arrondi : « 23 % ». */
export const fmtPct = (ratio: number) => `${fmtNum(Math.round(ratio * 100))}${NNBSP}%`;

/** Variation signée : « +3,2 % », « −4,1 % ». */
export function fmtDelta(ratio: number): string {
  const v = Math.round(ratio * 1000) / 10;
  return `${v > 0 ? '+' : ''}${fmtNum(v, 1)}${NNBSP}%`;
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_ABBR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_INITIAL = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/** « septembre 2026 » à partir de « 2026-09-01 » ou « 2026-09 ». */
export const monthLong = (iso: string) => `${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
/** « sept. 2026 » */
export const monthShort = (iso: string) => `${MONTHS_ABBR[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
/** « S » */
export const monthInitial = (iso: string) => MONTHS_INITIAL[+iso.slice(5, 7) - 1];

/** Premier jour du mois « AAAA-MM-01 » décalé de `n` mois. */
export function shiftMonth(month: string, n: number): string {
  const y = +month.slice(0, 4), m = +month.slice(5, 7) - 1 + n;
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}-01`;
}
