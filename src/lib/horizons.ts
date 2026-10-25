// Horizons des échéances (TDB-16) : source unique des délais d'anticipation des échéances transverses (« À traiter »,
// page À faire, cloche, badges) et groupes de la page À faire. Module pur, partagé serveur / client : seul import, les
// calculs de dates. Un domaine n'a plus sa propre constante d'horizon (prévention, coactivité, documents : 15 jours) ;
// un délai propre à une règle métier (certificat 30 jours avant sa fin, AUD-08) est déclaré ici.

import { addDays } from './dates';

/** Horizon commun des échéances (« À traiter dans les 15 jours », page À faire, badges ; prévention, coactivité, documents…). */
export const TODO_HORIZON_DAYS = 15;
/** Contrôles réglementaires : anticipés à 30 jours (KPI « Contrôles < 30 j », échéances, badge veille). */
export const CONTROL_HORIZON_DAYS = 30;
/** Certificat : fin de validité signalée 30 jours avant (AUD-08). */
export const CERT_SOON_DAYS = 30;
/** Panneau de notifications : dépassements + échéances des 7 prochains jours. */
export const NOTIFY_HORIZON_DAYS = 7;
/** Groupe « Cette semaine » de la page À faire. */
const WEEK_DAYS = 7;

/** Échéance vue par les règles d'horizon : date affichée (jour du retard pour un dépassement) et dépassement signalé. */
type Dated = { date: string; overdue?: boolean };

/** Échéance en retard : signalée comme telle par son domaine, ou datée avant aujourd'hui. */
export const isTodoLate = (x: Dated, today: string) => !!x.overdue || x.date < today;

/** Groupes de la page À faire, dans l'ordre d'affichage. */
export type TodoGroupKey = 'late' | 'week' | 'horizon' | 'later';
export const TODO_GROUPS: Record<TodoGroupKey, string> = {
  late: 'En retard',
  week: 'Cette semaine',
  horizon: `D'ici ${TODO_HORIZON_DAYS} jours`,
  // Au-delà de l'horizon commun : contrôles (30 jours) et fins de validité des certificats (30 jours) — plus seulement
  // les contrôles (TDB-16 : un certificat y était rangé sous « Contrôles à 30 jours »).
  later: `Au-delà de ${TODO_HORIZON_DAYS} jours`,
};
const GROUP_ORDER = Object.keys(TODO_GROUPS) as TodoGroupKey[];

/** Groupe d'une échéance : retard, 7 prochains jours, horizon commun (15 jours), au-delà. */
export function todoGroup(x: Dated, today: string): TodoGroupKey {
  if (isTodoLate(x, today)) return 'late';
  if (x.date <= addDays(today, WEEK_DAYS)) return 'week';
  if (x.date <= addDays(today, TODO_HORIZON_DAYS)) return 'horizon';
  return 'later';
}

/** Carte « À traiter » du tableau de bord : retards et échéances de l'horizon commun (les autres restent sur la page À faire). */
export const inTodoHorizon = (x: Dated, today: string) => todoGroup(x, today) !== 'later';

/** Cloche : retards et échéances des 7 prochains jours. */
export const inNotifyHorizon = (x: Dated, today: string) => !!x.overdue || x.date <= addDays(today, NOTIFY_HORIZON_DAYS);

/** Groupes non vides de la page À faire, dans l'ordre, chaque échéance dans l'ordre reçu. */
export function groupTodo<T extends Dated>(items: T[], today: string): [label: string, rows: T[]][] {
  const by = new Map<TodoGroupKey, T[]>(GROUP_ORDER.map((k) => [k, []]));
  items.forEach((x) => by.get(todoGroup(x, today))!.push(x));
  return GROUP_ORDER.filter((k) => by.get(k)!.length).map((k) => [TODO_GROUPS[k], by.get(k)!]);
}
