// Filtres des onglets Plans et Permis (?filtre=, ?type=), partagés par l'écran et le registre imprimable.

import type { PermitState, PermitType, PlanPhase } from './model';

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
