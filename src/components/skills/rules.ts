import { addDays, daysBetween, monthName } from '@/lib/dates';
import { SKILL_SOON_DAYS, type SkillState } from '@/lib/domain';

// Règles métier des habilitations, partagées par le serveur (chargement, actions) et les formulaires.
// L'échéance d'un titre est son dernier jour de validité (cf. skillState : expiré quand expiresOn < aujourd'hui).

/** Période d'une affectation Keystone. */
export type Span = { startOn: string; endOn: string };

/** « du 13 au 17 octobre » / « du 28 septembre au 2 octobre ». */
export function period(start: string, end: string) {
  const d1 = +start.slice(8, 10), d2 = +end.slice(8, 10), m1 = +start.slice(5, 7), m2 = +end.slice(5, 7);
  if (start === end) return `le ${d1} ${monthName(m1)}`;
  return m1 === m2 ? `du ${d1} au ${d2} ${monthName(m2)}` : `du ${d1} ${monthName(m1)} au ${d2} ${monthName(m2)}`;
}

/**
 * Manque d'un titre requis au regard d'une affectation :
 * missing (jamais suivi), expired (déjà expiré), before (expire avant le début), during (expire avant la fin).
 */
export type Lapse = 'missing' | 'expired' | 'before' | 'during';

/** Manque du titre pour l'affectation, null s'il la couvre en entier (ou s'il n'est pas requis). */
export function lapseFor(state: SkillState, expiresOn: string | null, a: Span, now: string): Lapse | null {
  if (state === 'n') return null;
  if (state === 'r') return 'missing';
  if (!expiresOn || expiresOn >= a.endOn) return null;
  if (expiresOn < now) return 'expired';
  return expiresOn < a.startOn ? 'before' : 'during';
}

/** Le manque empêche le salarié d'intervenir dès le début de l'affectation. */
export const isBlocking = (lapse: Lapse | null) => lapse !== null && lapse !== 'during';

/** État d'un titre détenu et requis, d'après son échéance (même règle que skillState). */
export function heldState(expiresOn: string | null, now: string): SkillState {
  if (!expiresOn) return 'v';
  if (expiresOn < now) return 'x';
  return daysBetween(now, expiresOn) <= SKILL_SOON_DAYS ? 's' : 'v';
}

/**
 * Échéance du recyclage à prévoir (formation gérée par le service RH, hors actions QSE), null quand il n'y a rien à planifier.
 * À planifier : titre requis expiré, expirant sous 60 jours, jamais suivi, ou valide mais expirant avant la fin
 * d'une affectation Keystone à venir.
 * - la veille du début de la première affectation Keystone à venir que le titre ne couvre pas (`upcoming` trié par date de début) ;
 * - sinon : l'échéance du titre, ou dans 30 jours pour un titre jamais suivi (formation initiale) ;
 * - jamais avant aujourd'hui (titre déjà expiré, affectation en cours ou débutant aujourd'hui).
 */
export function renewalDue(state: SkillState, expiresOn: string | null, upcoming: readonly Span[], now: string): string | null {
  if (state === 'n') return null;
  const next = upcoming.find((a) => lapseFor(state, expiresOn, a, now) !== null);
  if (state === 'v' && !next) return null;
  const due = next ? addDays(next.startOn, -1) : expiresOn ?? addDays(now, 30);
  return due < now ? now : due;
}

/**
 * Prérequis non satisfaits (HAB-10) : un titre qui porte des prérequis (titres actifs seulement) n'est valide que si la
 * personne détient au moins l'un d'eux en cours de validité à `now` (requis ou non pour elle) — par exemple une
 * autorisation de conduite avec un CACES valide de la catégorie (R. 4323-56). Renvoie les prérequis (tous) quand aucun
 * n'est valide, [] sinon ou sans prérequis.
 */
export function missingPrerequisites(prerequisiteIds: readonly string[], held: ReadonlyMap<string, { expiresOn: string | null } | undefined>, activeIds: ReadonlySet<string>, now: string): string[] {
  const active = prerequisiteIds.filter((id) => activeIds.has(id));
  const valid = (id: string) => {
    const q = held.get(id);
    return !!q && (!q.expiresOn || q.expiresOn >= now);
  };
  return active.length && !active.some(valid) ? active : [];
}

/** Prérequis qui créeraient un cycle (A exige B qui exige A…) si `titleId` exigeait `prerequisiteIds`. */
export function prerequisiteCycle(titleId: string, prerequisiteIds: readonly string[], graph: ReadonlyMap<string, readonly string[]>): string | null {
  for (const start of prerequisiteIds) {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === titleId) return start;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(graph.get(id) ?? []));
    }
  }
  return null;
}

/** Une formation d'échéance `expiresOn` règle-t-elle le besoin (titre valide au-delà de 60 jours et couvrant les affectations) ? */
export function coversNeed(expiresOn: string | null, upcoming: readonly Span[], now: string) {
  return renewalDue(heldState(expiresOn, now), expiresOn, upcoming, now) === null;
}

// ─── Prévision des recyclages (HAB-09) ──────────────────────────────────────

/** Horizon de la vue « À prévoir » (mois, le mois en cours compris). */
export const FORECAST_MONTHS = 12;

export type ForecastItem = {
  personId: string; person: string; titleId: string; title: string;
  /** Échéance du titre (dernier jour de validité) ; null : jamais suivi. */
  expiresOn: string | null;
  /** État actuel du titre requis (r jamais suivi, x expiré, p prérequis non valide, s expire sous 60 j, v valide). */
  state: SkillState;
};
export type ForecastMonth = { month: string; items: ForecastItem[] };
export type RenewalForecast = {
  /** À rattraper : titre requis jamais suivi, expiré, ou inopérant faute de prérequis valide. */
  overdue: ForecastItem[];
  /** Les FORECAST_MONTHS mois à venir (« AAAA-MM »), mois en cours d'abord, avec les titres requis qui y expirent. */
  months: ForecastMonth[];
  /** Titres concernés (colonnes du tableau), dans l'ordre des titres suivis. */
  titles: { id: string; label: string }[];
};

/** « AAAA-MM » décalé de `n` mois. */
const shiftYm = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
};

/**
 * Prévision des recyclages et formations à planifier sur 12 mois, par mois et par titre (HAB-09) : calculée à l'affichage,
 * jamais stockée ; titres requis seulement (cases « n » ignorées). Base du plan de formation imprimable, géré par le
 * service RH (aucune action QSE). Un titre expiré ou jamais suivi est « à rattraper » ; un titre valide entre dans le mois
 * de son échéance s'il expire dans l'horizon.
 */
export function renewalForecast(
  rows: readonly { person: { id: string; name: string }; cells: readonly { title: { id: string; label: string }; state: SkillState; expiresOn: string | null; required: boolean }[] }[],
  now: string,
  months = FORECAST_MONTHS,
): RenewalForecast {
  const first = now.slice(0, 7);
  const keys = Array.from({ length: months }, (_, i) => shiftYm(first, i));
  const last = keys[keys.length - 1];
  const overdue: ForecastItem[] = [];
  const byMonth = new Map(keys.map((k) => [k, [] as ForecastItem[]]));
  const used = new Map<string, string>();
  for (const row of rows) {
    for (const c of row.cells) {
      if (!c.required || c.state === 'n') continue;
      const item: ForecastItem = { personId: row.person.id, person: row.person.name, titleId: c.title.id, title: c.title.label, expiresOn: c.expiresOn, state: c.state };
      if (c.state === 'r' || c.state === 'x' || c.state === 'p' || (c.expiresOn && c.expiresOn < now)) {
        overdue.push(item);
        used.set(c.title.id, c.title.label);
      } else if (c.expiresOn && c.expiresOn.slice(0, 7) <= last) {
        byMonth.get(c.expiresOn.slice(0, 7))?.push(item);
        used.set(c.title.id, c.title.label);
      }
    }
  }
  const order = (a: ForecastItem, b: ForecastItem) => (a.expiresOn ?? '').localeCompare(b.expiresOn ?? '') || a.person.localeCompare(b.person, 'fr');
  const titleOrder = rows[0]?.cells.map((c) => c.title.id) ?? [];
  const titles = [...used.entries()].map(([id, label]) => ({ id, label }))
    .sort((a, b) => titleOrder.indexOf(a.id) - titleOrder.indexOf(b.id));
  return { overdue: overdue.sort(order), months: keys.map((month) => ({ month, items: byMonth.get(month)!.sort(order) })), titles };
}
