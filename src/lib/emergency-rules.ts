// Situations d'urgence (CNF-08, ISO 45001 §8.2, ISO 14001 §8.2) : règles pures de l'échéance des exercices, sans accès
// serveur (composants client, chargements, tests). L'échéance est calculée, jamais stockée.
import { addMonths } from './dates';

export type DrillDue = {
  /** Date à laquelle le prochain exercice est attendu (planifié, sinon dernier exercice + périodicité). */
  dueOn: string;
  /** Exercice planifié à cette date (situation.nextDrillOn). */
  planned: boolean;
  /** Exercice planifié après l'échéance de la périodicité : signalé, l'échéance reste celle de la périodicité. */
  plannedLate: boolean;
  /** Aucun exercice tracé : le premier est attendu dans la périodicité suivant l'identification de la situation. */
  first: boolean;
};

/**
 * Prochain exercice d'une situation d'urgence : périodicité comptée depuis le dernier exercice tenu (ou, sans exercice,
 * depuis l'identification de la situation) ; un exercice planifié plus tôt devient l'échéance, un exercice planifié plus
 * tard ne la repousse pas (signalé `plannedLate`).
 */
export function drillDue(s: { drillMonths: number; nextDrillOn: string | null; createdOn: string }, lastHeldOn: string | null): DrillDue {
  const computed = addMonths(lastHeldOn ?? s.createdOn, s.drillMonths);
  const first = !lastHeldOn;
  if (s.nextDrillOn && s.nextDrillOn <= computed) return { dueOn: s.nextDrillOn, planned: true, plannedLate: false, first };
  return { dueOn: computed, planned: false, plannedLate: !!s.nextDrillOn, first };
}

/** Périodicités proposées (mois) : tous les 6 mois, chaque année, tous les 2 ou 3 ans. */
export const DRILL_PERIODS = [6, 12, 24, 36] as const;
