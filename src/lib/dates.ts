// Dates métier en chaînes ISO « AAAA-MM-JJ » (fuseau Europe/Paris), calculs en UTC.

const DAY = 86_400_000;
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const MONTHS_SHORT = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
const MONTHS_ABBR = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc'];

// La date du jour (`today()`, VIGIE_TODAY en démonstration) est servie par src/lib/today.ts (serveur).

const ms = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

/** Nombre de jours de `from` à `to` (positif si `to` est après `from`). */
export const daysBetween = (from: string, to: string) => Math.round((ms(to) - ms(from)) / DAY);

export function addDays(iso: string, n: number): string {
  return new Date(ms(iso) + n * DAY).toISOString().slice(0, 10);
}

/**
 * Ajoute `n` mois (négatif : retire) à une date ISO en restant dans le mois d'arrivée :
 * 31/08/2026 + 6 mois = 28/02/2027 (et non 03/03/2027), pour ne jamais dépasser une échéance réglementaire.
 */
export function addMonths(iso: string, n: number): string {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7) - 1 + n;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(+iso.slice(8, 10), lastDay))).toISOString().slice(0, 10);
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

// ─── Dates et heures (fuseau Europe/Paris) ──────────────────────────────────

const PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/** Instant → « AAAA-MM-JJTHH:mm » à l'heure de Paris (valeur d'un champ datetime-local). */
export function toParisLocal(d: Date): string {
  const p = Object.fromEntries(PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

const wallMs = (local: string) => {
  const m = LOCAL.exec(local);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
};

/** « AAAA-MM-JJTHH:mm » (heure de Paris) → instant ; null si la saisie est invalide. */
export function fromParisLocal(local: string): Date | null {
  const wall = wallMs(local);
  if (wall == null) return null;
  const offset = (d: Date) => wallMs(toParisLocal(d))! - Math.floor(d.getTime() / 60_000) * 60_000;
  let d = new Date(wall - offset(new Date(wall)));
  d = new Date(wall - offset(d));
  return d;
}

/** Ajoute des heures à une date-heure locale (calcul « horloge murale »). */
export function addHoursLocal(local: string, hours: number): string {
  const wall = wallMs(local);
  if (wall == null) return local;
  return new Date(wall + hours * 3_600_000).toISOString().slice(0, 16);
}

/** Instant de référence : date du jour Vigie (VIGIE_TODAY le cas échéant) à l'heure courante de Paris. */
export function referenceNow(todayIso: string): Date {
  return fromParisLocal(`${todayIso}T${toParisLocal(new Date()).slice(11)}`) ?? new Date();
}
