// Filtres des onglets Plans et Permis (?filtre=, ?type=), partagés par l'écran et le registre imprimable
// (qui ajoute la période ?annee=, ?mois= et le filtre « Tous, annulés compris »).

import { addDays, addMonths, monthName } from '@/lib/dates';
import type { PermitState, PermitType, PlanPhase } from '@/lib/rules/prevention';

export type ListFilter<S extends string> = {
  /** Valeur de ?filtre= (le premier filtre de la liste est celui par défaut, sans paramètre). */
  key: string;
  label: string;
  states: readonly S[];
  /** Message du tableau vide. */
  empty: string;
  /** Affiché seulement s'il contient des éléments ou s'il est sélectionné. */
  optional?: boolean;
};

// « En cours » suit l'indicateur (début ≤ aujourd'hui ≤ fin) ; « À clore » (période échue, plan non clos) et « Annulés » n'apparaissent que s'il y a lieu.
export const PLAN_FILTERS: ListFilter<PlanPhase>[] = [
  { key: 'en-cours', label: 'En cours', states: ['en_cours'], empty: 'Aucune intervention en cours sur ce site.' },
  { key: 'a-venir', label: 'À venir', states: ['a_venir'], empty: 'Aucune intervention à venir sur ce site.' },
  { key: 'a-clore', label: 'À clore', states: ['a_clore'], empty: 'Aucun plan à clore sur ce site.', optional: true },
  { key: 'clos', label: 'Clos', states: ['clos'], empty: 'Aucun plan clos sur ce site.' },
  { key: 'annules', label: 'Annulés', states: ['annule'], empty: 'Aucun plan annulé sur ce site.', optional: true },
  { key: 'tous', label: 'Tous', states: ['en_cours', 'a_venir', 'a_clore', 'clos'], empty: 'Aucun plan de prévention sur ce site.' },
];

// « Ouverts » : tout ce qui reste à traiter (demandes, permis délivrés ou en cours, expirés non clos). « Tous » exclut les annulés.
export const PERMIT_FILTERS: ListFilter<PermitState>[] = [
  { key: 'ouverts', label: 'Ouverts', states: ['demande', 'delivre', 'en_cours', 'expire'], empty: 'Aucun permis ouvert sur ce site.' },
  { key: 'actifs', label: 'Actifs', states: ['delivre', 'en_cours'], empty: 'Aucun permis délivré ou en cours sur ce site.' },
  { key: 'demandes', label: 'Demandes', states: ['demande'], empty: 'Aucune demande de permis à délivrer sur ce site.' },
  { key: 'expires', label: 'Expirés', states: ['expire'], empty: 'Aucun permis expiré non clos sur ce site.', optional: true },
  { key: 'clos', label: 'Clos', states: ['clos'], empty: 'Aucun permis clos sur ce site.' },
  { key: 'annules', label: 'Annulés', states: ['annule'], empty: 'Aucun permis annulé sur ce site.', optional: true },
  { key: 'tous', label: 'Tous', states: ['demande', 'delivre', 'en_cours', 'expire', 'clos'], empty: 'Aucun permis sur ce site.' },
];

/** Registre imprimable : filtres de l'onglet Permis, plus tous les permis annulés compris (l'écran reste inchangé). */
export const REGISTER_FILTERS: ListFilter<PermitState>[] = [
  ...PERMIT_FILTERS,
  { key: 'registre', label: 'Tous, annulés compris', states: ['demande', 'delivre', 'en_cours', 'expire', 'clos', 'annule'], empty: 'Aucun permis sur ce site.' },
];

/** ?type= : tous types (sans paramètre), permis de feu, permis d'essai. */
export const PERMIT_TYPE_FILTERS: { key: PermitType | null; label: string }[] = [
  { key: null, label: 'Tous types' },
  { key: 'feu', label: 'Feu' },
  { key: 'essai', label: 'Essai' },
];

/**
 * Filtre demandé (?filtre=), ou celui par défaut ; quand une fiche est ouverte par lien direct (?plan=, ?permis=)
 * et n'appartient pas au filtre demandé, bascule sur le premier filtre qui la contient.
 */
export function pickFilter<S extends string>(filters: ListFilter<S>[], requested: string | undefined, openState?: S | null): ListFilter<S> {
  const asked = filters.find((f) => f.key === requested) ?? filters[0];
  if (!openState || asked.states.includes(openState)) return asked;
  return filters.find((f) => f.states.includes(openState)) ?? asked;
}

/** Type demandé (?type=), ignoré si la fiche ouverte est d'un autre type. */
export function pickType(requested: string | undefined, openType?: PermitType | null): PermitType | null {
  const asked = PERMIT_TYPE_FILTERS.find((f) => f.key === requested)?.key ?? null;
  return asked && openType && openType !== asked ? null : asked;
}

/** Valeur de ?filtre= dans un lien (absente pour le filtre par défaut). */
export const filterParam = <S extends string>(filters: ListFilter<S>[], f: ListFilter<S>) => (f === filters[0] ? undefined : f.key);

/** Filtres affichés : les filtres facultatifs seulement s'ils contiennent des éléments ou s'ils sont sélectionnés. */
export const shownFilters = <S extends string>(filters: ListFilter<S>[], current: ListFilter<S>, count: (f: ListFilter<S>) => number) =>
  filters.filter((f) => !f.optional || f === current || count(f) > 0);

// ─── Période du registre des permis (?annee=, ?mois=) ───────────────────────

/** Période du registre : jours « AAAA-MM-JJ » inclus, libellé (« octobre 2026 », « année 2026 »), valeurs des paramètres. */
export type Period = { from: string; to: string; label: string; annee: string; mois?: string };

/**
 * Période demandée : une année (?annee=2026), ou un mois de cette année (&mois=1 à 12) ; un mois invalide est ignoré
 * (l'année entière), un mois sans année valide ne donne aucune période (null : toutes les périodes).
 */
export function pickPeriod(annee?: string, mois?: string): Period | null {
  if (!annee || !/^\d{4}$/.test(annee)) return null;
  const m = mois && /^\d{1,2}$/.test(mois) ? Number(mois) : NaN;
  if (Number.isInteger(m) && m >= 1 && m <= 12) {
    const from = `${annee}-${String(m).padStart(2, '0')}-01`;
    return { from, to: addDays(addMonths(from, 1), -1), label: `${monthName(m)} ${annee}`, annee, mois: String(m) };
  }
  return { from: `${annee}-01-01`, to: `${annee}-12-31`, label: `année ${annee}`, annee };
}

/**
 * Permis dont la validité recoupe la période, en jours de Paris : validFrom et validTo en date-heure locale
 * « AAAA-MM-JJTHH:mm » (PermitView). Un permis du 30/09 22:00 au 01/10 06:00 compte en septembre et en octobre.
 */
export const inPeriod = (p: { validFrom: string; validTo: string }, period: Pick<Period, 'from' | 'to'>) =>
  p.validFrom.slice(0, 10) <= period.to && p.validTo.slice(0, 10) >= period.from;

// ─── PRV-14 : filtres par entreprise extérieure et par projet Keystone (plans et permis) ───────────────────────

/** Intervention filtrable : entreprise extérieure (null : intervention interne) et projet Keystone. */
type Intervention = { contractorId: string | null; contractor: string | null; keystoneProject: string | null };
export type InterventionFilters = { entreprise?: string; projet?: string };

/**
 * Filtres `?entreprise=<id>` et `?projet=<code>` d'une liste de plans ou de permis : choix proposés = entreprises et
 * projets présents dans la liste chargée (site sélectionné, périmètre) ; valeur inconnue ignorée. Une fiche ouverte par
 * lien direct (`open`) que les filtres cacheraient les retire (comme pour la phase, pickFilter).
 */
export function interventionFilters<T extends Intervention>(rows: readonly T[], sp: { entreprise?: string; projet?: string }, open?: T) {
  const byLabel = (a: readonly [string, string], b: readonly [string, string]) => a[1].localeCompare(b[1], 'fr');
  const contractors = [...new Map(rows.filter((r) => r.contractorId).map((r) => [r.contractorId!, r.contractor ?? r.contractorId!])).entries()].sort(byLabel);
  const projects = [...new Set(rows.map((r) => r.keystoneProject).filter((p): p is string => !!p))].map((p) => [p, p] as const).sort(byLabel);
  const asked: InterventionFilters = {
    entreprise: contractors.some(([id]) => id === sp.entreprise) ? sp.entreprise : undefined,
    projet: projects.some(([p]) => p === sp.projet) ? sp.projet : undefined,
  };
  const filters = open && !matchesIntervention(open, asked) ? {} : asked;
  return { filters, contractors, projects };
}

/** Intervention retenue par les filtres (entreprise, projet). */
export const matchesIntervention = (r: Intervention, f: InterventionFilters) =>
  (!f.entreprise || r.contractorId === f.entreprise) && (!f.projet || r.keystoneProject === f.projet);
