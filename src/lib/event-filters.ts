// Filtres de la liste des événements portés par l'URL (EVT-13), comme ceux du plan d'actions (src/lib/action-rules.ts) :
// blessure, étape, pilote, période, gravité, ancienneté, accidents de l'effectif. Règles pures, sans dépendance serveur.
// Liens profonds du tableau de bord (TDB-12) : /evenements?etat=tous&type=AT&blessure=arret&effectif=1&du=…

import { EVENT_STEPS } from './domain';

/** Gravités et seuils d'ancienneté proposés (jours depuis la date des faits). */
export const EVENT_AGE_DAYS = [30, 60, 90] as const;
/** Blessure d'un AT (events.injury) : donnée de santé, filtre réservé aux rôles canSeeHealth. */
export const INJURY_FILTERS = [['arret', 'Avec arrêt'], ['sans_arret', 'Sans arrêt'], ['soins', 'Premiers soins']] as const;
export type InjuryFilter = (typeof INJURY_FILTERS)[number][0];
/** Pilote : une personne, ou « aucun » (événement sans pilote désigné). */
export const NO_PILOT = 'aucun';

export type EventFilters = {
  blessure?: InjuryFilter;
  /** Index dans EVENT_STEPS. */
  etape?: number;
  pilote?: string;
  du?: string;
  au?: string;
  gravite?: number;
  /** Plus de N jours depuis la date des faits. */
  anciennete?: number;
  /** Accidents du travail de l'effectif, hors accident de trajet (workforceAccident : TF1/TG, pyramide). */
  effectif?: boolean;
};

/** Événement lu par les filtres (ligne de la table events). */
export type FilterableEvent = {
  type: string; occurredOn: string; step: number; severity: number; pilotId: string | null; injury: string | null;
  victimKind: string | null; commute?: boolean | null;
};

/**
 * Accident du travail de l'effectif (salarié, hors intérimaire et personne extérieure), hors accident de trajet (EVT-09) :
 * seul compté dans le TF1 / TG, les jours sans accident et la pyramide.
 */
export const workforceAccident = (e: { type: string; victimKind: string | null; commute?: boolean | null }) =>
  e.type === 'AT' && !e.commute && e.victimKind !== 'interimaire' && e.victimKind !== 'externe';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v.trim() : undefined);
const daysSince = (iso: string, now: string) => Math.round((Date.parse(`${now}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000);

/**
 * Filtres retenus d'après les paramètres d'URL ; une valeur invalide est ignorée. `health` : le filtre « blessure »
 * (donnée de santé) n'est retenu que pour les rôles habilités — pour les autres, le paramètre est ignoré, sans rien
 * révéler. `pilots` : identifiants admis (personnes de l'annuaire) ; sans liste, tout identifiant est admis.
 */
export function parseEventFilters(sp: Record<string, string | string[] | undefined>, opts: { health: boolean; pilots?: ReadonlySet<string> }): EventFilters {
  const f: EventFilters = {};
  const blessure = one(sp.blessure);
  if (opts.health && INJURY_FILTERS.some(([k]) => k === blessure)) f.blessure = blessure as InjuryFilter;
  const etape = one(sp.etape);
  if (etape && /^\d$/.test(etape) && +etape < EVENT_STEPS.length) f.etape = +etape;
  const pilote = one(sp.pilote);
  if (pilote && (pilote === NO_PILOT || !opts.pilots || opts.pilots.has(pilote))) f.pilote = pilote;
  const du = one(sp.du), au = one(sp.au);
  if (du && ISO.test(du)) f.du = du;
  if (au && ISO.test(au)) f.au = au;
  const gravite = one(sp.gravite);
  if (gravite && /^[1-4]$/.test(gravite)) f.gravite = +gravite;
  const anciennete = one(sp.anciennete);
  if (anciennete && EVENT_AGE_DAYS.some((d) => String(d) === anciennete)) f.anciennete = +anciennete;
  if (one(sp.effectif) === '1') f.effectif = true;
  return f;
}

/** L'événement satisfait tous les filtres (`now` : date du jour, pour l'ancienneté). */
export function matchesEventFilters(e: FilterableEvent, f: EventFilters, now: string): boolean {
  if (f.blessure) {
    if (e.type !== 'AT') return false;
    // Même règle que la pyramide : un AT sans blessure renseignée compte « sans arrêt ».
    if (f.blessure === 'sans_arret' ? !(e.injury === 'sans_arret' || !e.injury) : e.injury !== f.blessure) return false;
  }
  if (f.effectif && !workforceAccident(e)) return false;
  if (f.etape != null && e.step !== f.etape) return false;
  if (f.pilote && (f.pilote === NO_PILOT ? e.pilotId != null : e.pilotId !== f.pilote)) return false;
  if (f.du && e.occurredOn < f.du) return false;
  if (f.au && e.occurredOn > f.au) return false;
  if (f.gravite != null && e.severity !== f.gravite) return false;
  if (f.anciennete != null && daysSince(e.occurredOn, now) <= f.anciennete) return false;
  return true;
}

/** Paramètres d'URL des filtres retenus (liens de la liste, formulaire). */
export function eventFilterParams(f: EventFilters): Record<string, string | undefined> {
  return {
    blessure: f.blessure, etape: f.etape != null ? String(f.etape) : undefined, pilote: f.pilote, du: f.du, au: f.au,
    gravite: f.gravite != null ? String(f.gravite) : undefined, anciennete: f.anciennete != null ? String(f.anciennete) : undefined,
    effectif: f.effectif ? '1' : undefined,
  };
}

/** Au moins un filtre retenu (état vide « Aucun événement ne correspond »). */
export const hasEventFilters = (f: EventFilters) => Object.values(eventFilterParams(f)).some((v) => v != null);
