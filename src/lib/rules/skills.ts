import { addDays, addMonths, daysBetween, fmtDate, monthName } from '@/lib/dates';
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
  // Non requis, ou état inconnu (titres détenus de Cursus indisponibles) : aucune alerte.
  if (state === 'n' || state === 'u') return null;
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
  if (state === 'n' || state === 'u') return null;
  const next = upcoming.find((a) => lapseFor(state, expiresOn, a, now) !== null);
  if (state === 'v' && !next) return null;
  const due = next ? addDays(next.startOn, -1) : expiresOn ?? addDays(now, 30);
  return due < now ? now : due;
}

/** Titre détenu d'après Cursus (cursus.pub_titres_detenus) : ce qui fixe l'état d'une case de la matrice. */
export type HeldFacts = {
  expiresOn: string | null;
  usableUntil: string | null;
  prerequisiteMissing: boolean;
  measure: 'suspension' | 'retrait' | null;
  measureOn: string | null;
};

/**
 * État d'une case d'après le titre détenu publié par Cursus (D09, lecture conseillée par Cursus : utilisable si
 * `utilisable_jusqu_au` >= aujourd'hui et `prerequis_manquant` faux) : non requis (n), jamais suivi (r), suspendu (p :
 * prérequis manquant, ou suspension ou retrait de l'habilitation à cette date), sinon valide, à renouveler ou expiré d'après
 * le dernier jour utilisable (échéance bornée par les prérequis et une mesure à venir). `expiresOn` : date affichée et
 * comparée aux affectations (échéance du titre pour un titre suspendu).
 */
export function heldTitleState(required: boolean, held: HeldFacts | undefined, now: string): { state: SkillState; expiresOn: string | null } {
  if (!held) return { state: required ? 'r' : 'n', expiresOn: null };
  const usable = held.usableUntil ?? held.expiresOn;
  if (!required) return { state: 'n', expiresOn: usable };
  if (held.prerequisiteMissing || (held.measure && (!held.measureOn || held.measureOn <= now))) return { state: 'p', expiresOn: held.expiresOn };
  return { state: heldState(usable, now), expiresOn: usable };
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
  /** État actuel du titre requis (r jamais suivi, x expiré, p suspendu, s expire sous 60 j, v valide). */
  state: SkillState;
};
export type ForecastMonth = { month: string; items: ForecastItem[] };
export type RenewalForecast = {
  /** À rattraper : titre requis jamais suivi, expiré, ou suspendu (prérequis manquant, suspension ou retrait dans Cursus). */
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
      if (!c.required || c.state === 'n' || c.state === 'u') continue;
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

// ─── Lien profond ?salarie=…&titre=… (HAB-17) ───────────────────────────────

/** Ce que la page sait de la personne et du titre visés par un lien profond. */
export type SkillLinkFacts = {
  /** Vue Salarié : seule sa ligne est affichée. */
  self: boolean;
  selfId: string;
  personId: string;
  titleId?: string;
  /** Salariés présents de la matrice (site sélectionné). */
  rowIds: ReadonlySet<string>;
  /** Personnel présent du site non suivi dans la matrice. */
  otherIds: ReadonlySet<string>;
  /** Salariés sortis du site sélectionné : date de sortie. */
  departed: ReadonlyMap<string, string>;
  /** Personne du périmètre rattachée à un autre site que celui sélectionné. */
  otherSite: boolean;
  activeTitleIds: ReadonlySet<string>;
  /** Titres archivés : intitulé. */
  archivedTitles: ReadonlyMap<string, string>;
};

export type SkillLinkResult = {
  /** Case ouverte (titre actif) ou ligne mise en évidence (sans titre ou titre non affiché). */
  select?: { personId: string; titleId?: string };
  /** Message affiché quand la cible n'est pas (entièrement) affichée ; jamais rien d'une personne hors du périmètre. */
  notice?: string;
};

/** Message unique d'une personne absente du périmètre ou inconnue (rien n'est révélé, UX-13). */
export const SKILL_LINK_MISSING = 'Salarié introuvable ou hors de votre périmètre.';

/**
 * Lien profond vers la matrice : un message précis par cas (HAB-17) — fiche d'autrui en vue Salarié, salarié sorti,
 * personnel hors matrice, autre site du périmètre, titre archivé ou inconnu ; message unique hors périmètre.
 */
export function skillLinkTarget(f: SkillLinkFacts): SkillLinkResult {
  if (f.self && f.personId !== f.selfId) return { notice: 'Fiche non accessible : seules vos habilitations sont affichées.' };
  if (!f.rowIds.has(f.personId)) {
    const left = f.departed.get(f.personId);
    if (left) return { notice: `Salarié sorti de l'effectif le ${fmtDate(left)} : sa fiche et ses titres sont conservés en consultation seule (filtre « Sortis »).` };
    if (f.otherIds.has(f.personId)) return { notice: "Cette personne n'est pas suivie dans la matrice des habilitations (personnel hors matrice)." };
    if (f.otherSite) return { notice: 'Salarié rattaché à un autre site que celui sélectionné : changez de site pour afficher sa ligne.' };
    return { notice: SKILL_LINK_MISSING };
  }
  if (!f.titleId || f.activeTitleIds.has(f.titleId)) return { select: { personId: f.personId, titleId: f.titleId } };
  const archived = f.archivedTitles.get(f.titleId);
  return {
    select: { personId: f.personId },
    notice: archived
      ? `Titre « ${archived} » qui n'est plus suivi : il ne figure plus dans la matrice (titres détenus consultables dans Cursus). La ligne du salarié est mise en évidence.`
      : 'Titre introuvable : la ligne du salarié est mise en évidence.',
  };
}

// ─── Indicateurs de compétences de la revue de direction (HAB-18) ───────────

/**
 * Indicateurs de compétences du dossier de revue (HAB-18, ISO 9001 §7.2 et §9.3.2 ; ISO 45001 §7.2), calculés, jamais
 * stockés : taux de conformité (titres requis valides, y compris expirant sous 60 jours, sur l'ensemble des titres requis
 * lus), titres obtenus sur les 12 mois précédant `asOf` (dernière formation de chaque case d'après Cursus, tous titres),
 * recyclages en retard (titres requis expirés). L'efficacité des formations (évaluation à froid) est tenue par Cursus
 * (non publiée) : plus comptée dans Vigie (décision CV-01 du 04/11/2026). Cases d'état inconnu (Cursus indisponible) exclues.
 */
export function skillIndicators(
  rows: readonly { cells: readonly { state: SkillState; obtainedOn: string | null }[] }[],
  asOf: string,
) {
  const cells = rows.flatMap((r) => r.cells).filter((c) => c.state !== 'u');
  const required = cells.filter((c) => c.state !== 'n');
  const compliant = required.filter((c) => c.state === 'v' || c.state === 's').length;
  const from = addMonths(asOf, -12);
  const trainings = cells.filter((c) => c.obtainedOn && c.obtainedOn > from && c.obtainedOn <= asOf);
  return {
    required: required.length,
    compliant,
    /** Taux de conformité en % (arrondi à l'entier), null sans titre requis. */
    rate: required.length ? Math.round((compliant / required.length) * 100) : null,
    trainings12: trainings.length,
    lateRenewals: required.filter((c) => c.state === 'x').length,
  };
}
