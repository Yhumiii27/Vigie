// Dates métier en chaînes ISO « AAAA-MM-JJ » (fuseau Europe/Paris), calculs en UTC.

const DAY = 86_400_000;
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const MONTHS_SHORT = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
const MONTHS_ABBR = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc'];

/** Date du jour à Paris ; `VIGIE_TODAY` permet de figer la date de référence. */
export function today(): string {
  if (process.env.VIGIE_TODAY) return process.env.VIGIE_TODAY;
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const ms = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

/** Nombre de jours de `from` à `to` (positif si `to` est après `from`). */
export const daysBetween = (from: string, to: string) => Math.round((ms(to) - ms(from)) / DAY);

export function addDays(iso: string, n: number): string {
  return new Date(ms(iso) + n * DAY).toISOString().slice(0, 10);
}

export function addMonths(iso: string, n: number): string {
  const d = new Date(ms(iso));
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** 03/10 */
export const fmtDayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** 03/10/2026 */
export const fmtDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** 6 octobre 2026 */
export const fmtLong = (iso: string) => `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
/** 09 */
export const fmtDay = (iso: string) => String(+iso.slice(8, 10)).padStart(2, '0');
export const fmtMonthAbbr = (iso: string) => MONTHS_ABBR[+iso.slice(5, 7) - 1];
export const monthOf = (iso: string) => +iso.slice(5, 7);
export const yearOf = (iso: string) => +iso.slice(0, 4);

/** Numéro de semaine ISO 8601. */
export function isoWeek(iso: string): number {
  const d = new Date(ms(iso));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - firstThursday.getTime()) / DAY - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

/** Libellé de mois en toutes lettres (« octobre »). */
export const monthName = (m: number) => MONTHS[m - 1];
