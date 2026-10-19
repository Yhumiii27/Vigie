// Délais d'un accident du travail (EVT-03), fonctions pures partagées par le serveur et les composants :
// - déclaration à la CPAM dans les 48 heures de la connaissance de l'accident par l'employeur, dimanches et jours fériés
//   non compris (art. R. 441-3 du code de la sécurité sociale) ; même délai pour l'inscription d'un accident bénin au registre ;
// - AT d'un intérimaire : information de l'entreprise de travail temporaire dans les 24 heures (art. R. 412-2) ;
// - réserves motivées sous 10 jours francs à compter de la déclaration (art. R. 441-6), dernier jour reporté au premier jour
//   ouvrable suivant s'il tombe un samedi, un dimanche ou un jour férié (art. 642 du code de procédure civile).
// Jours fériés : liste légale de l'art. L. 3133-1 du code du travail ; droit local d'Alsace-Moselle en plus (Vendredi saint,
// 26 décembre), option du site (sites.alsace_moselle).

import { CPAM_DELAY_HOURS, ETT_DELAY_HOURS, MP_QUESTIONNAIRE_DAYS, RESERVES_DELAY_DAYS } from '@/lib/domain';
import { addDays, fmtDate, toParisLocal } from '@/lib/dates';

export type DeadlineOptions = { alsaceMoselle?: boolean };

/** Échéance à la minute près : jour « AAAA-MM-JJ » et minute du jour (1 à 1440 ; 1440 = fin de journée). */
export type Deadline = { date: string; minutes: number };

const DAY_MINUTES = 24 * 60;

/** Dimanche de Pâques (calendrier grégorien, algorithme dit « anonyme » de Meeus, Jones et Butcher), « AAAA-MM-JJ ». */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const holidayCache = new Map<string, Set<string>>();

/** Jours fériés de l'année (« AAAA-MM-JJ ») ; `alsaceMoselle` ajoute le Vendredi saint et le 26 décembre. */
export function frenchHolidays(year: number, alsaceMoselle = false): Set<string> {
  const key = `${year}:${alsaceMoselle ? 1 : 0}`;
  const cached = holidayCache.get(key);
  if (cached) return cached;
  const easter = easterSunday(year);
  const fixed = ['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25'].map((md) => `${year}-${md}`);
  // Lundi de Pâques, Ascension (Pâques + 39), lundi de Pentecôte (Pâques + 50).
  const days = new Set([...fixed, addDays(easter, 1), addDays(easter, 39), addDays(easter, 50)]);
  if (alsaceMoselle) {
    days.add(addDays(easter, -2)); // Vendredi saint
    days.add(`${year}-12-26`); // Saint-Étienne
  }
  holidayCache.set(key, days);
  return days;
}

const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = dimanche, 6 = samedi
const isHoliday = (iso: string, am: boolean) => frenchHolidays(+iso.slice(0, 4), am).has(iso);

/** Jour non décompté du délai de 48 h : dimanche ou jour férié (le samedi compte). */
export const isExcludedDay = (iso: string, alsaceMoselle = false) => weekday(iso) === 0 || isHoliday(iso, alsaceMoselle);

/**
 * `hours` heures décomptées à partir de `knownLocal` (« AAAA-MM-JJTHH:mm », heure de Paris), sans les heures des jours
 * `excluded`. Connaissance un jour non décompté : le délai part du jour décompté suivant, à 0 h.
 */
function countHours(knownLocal: string, hours: number, excluded: (iso: string) => boolean): Deadline {
  const nextCounted = (iso: string) => {
    let d = addDays(iso, 1);
    while (excluded(d)) d = addDays(d, 1);
    return d;
  };
  let date = knownLocal.slice(0, 10);
  let minutes = Math.min(DAY_MINUTES - 1, (+knownLocal.slice(11, 13) || 0) * 60 + (+knownLocal.slice(14, 16) || 0));
  if (excluded(date)) {
    date = nextCounted(date);
    minutes = 0;
  }
  let remaining = hours * 60;
  for (;;) {
    const avail = DAY_MINUTES - minutes;
    if (remaining <= avail) return { date, minutes: minutes + remaining };
    remaining -= avail;
    date = nextCounted(date);
    minutes = 0;
  }
}

/**
 * Échéance de la déclaration CPAM (ou de l'inscription d'un accident bénin au registre) : 48 heures décomptées à partir de
 * `knownLocal` (« AAAA-MM-JJTHH:mm », heure de Paris), sans les heures des dimanches et jours fériés. Connaissance un jour
 * non décompté : le délai part du jour décompté suivant, à 0 h.
 */
export function cpamDeadline(knownLocal: string, opts: DeadlineOptions = {}): Deadline {
  const am = !!opts.alsaceMoselle;
  return countHours(knownLocal, CPAM_DELAY_HOURS, (iso) => isExcludedDay(iso, am));
}

/**
 * Échéance de l'information de l'entreprise de travail temporaire (AT d'un intérimaire, R. 412-2 CSS) : 24 heures à partir
 * de `knownLocal` (heure de Paris), d'heure à heure, sans exclusion des dimanches ni des jours fériés.
 */
export function ettDeadline(knownLocal: string): Deadline {
  return countHours(knownLocal, ETT_DELAY_HOURS, () => false);
}

/**
 * Dernier jour d'un délai de `days` jours francs à compter de `fromOn` (jour de départ non compté), reporté au premier jour
 * ni samedi, ni dimanche, ni férié (art. 642 du code de procédure civile).
 */
export function francDaysDeadline(fromOn: string, days: number, opts: DeadlineOptions = {}): string {
  const am = !!opts.alsaceMoselle;
  let d = addDays(fromOn, days);
  while (weekday(d) === 0 || weekday(d) === 6 || isHoliday(d, am)) d = addDays(d, 1);
  return d;
}

/** Dernier jour des réserves motivées : déclaration + 10 jours, reporté au premier jour ni samedi, ni dimanche, ni férié. */
export function reservesDeadline(declaredOn: string, opts: DeadlineOptions = {}): string {
  return francDaysDeadline(declaredOn, RESERVES_DELAY_DAYS, opts);
}

/**
 * Maladie professionnelle (EVT-09) : retour du questionnaire de la caisse par l'employeur sous 30 jours francs à compter de
 * sa réception (art. R. 461-9 CSS).
 */
export function mpQuestionnaireDeadline(receivedOn: string, opts: DeadlineOptions = {}): string {
  return francDaysDeadline(receivedOn, MP_QUESTIONNAIRE_DAYS, opts);
}

/** « avant le 12/10/2026 à 15 h 00 », ou « avant la fin du 13/10/2026 » pour une échéance à minuit. */
export function fmtDeadline(d: Deadline): string {
  if (d.minutes >= DAY_MINUTES) return `avant la fin du ${fmtDate(d.date)}`;
  const hh = String(Math.floor(d.minutes / 60)).padStart(2, '0'), mm = String(d.minutes % 60).padStart(2, '0');
  return `avant le ${fmtDate(d.date)} à ${hh} h ${mm}`;
}

/**
 * Point de départ du délai de 48 h (heure de Paris) : connaissance d'un arrêt ou de soins médicaux après une inscription
 * au registre des accidents bénins (`escalatedAt`), sinon connaissance de l'accident (knownAt), sinon son enregistrement.
 */
export function cpamBasis(e: { knownAt: Date | null; createdAt: Date }, escalatedAt?: Date | null): string {
  return toParisLocal(escalatedAt ?? e.knownAt ?? e.createdAt);
}
