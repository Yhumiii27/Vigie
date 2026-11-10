// Règles pures du document unique (DUERP) issues des réponses du service QHSE du 09/11/2026 (DUE-07, DUE-10).

import { addMonths } from '@/lib/dates';

/** DUE-07 : gravité potentielle « élevée » (G3 grave, G4 très grave, SEVERITY de src/lib/domain.ts). */
export const DUERP_REVIEW_MIN_SEVERITY = 3;
/** DUE-07 : événements considérés, survenus dans les 12 derniers mois (cycle de la mise à jour annuelle du DUERP). */
export const DUERP_REVIEW_WINDOW_MONTHS = 12;

/** Événement candidat à la réévaluation du DUERP (colonnes de `events`). */
export type DuerpReviewEvent = {
  type: string; severity: number; injury: string | null; lostDays: number | null; occurredOn: string; dismissed: boolean;
};

/**
 * Motif de réévaluation du DUERP (DUE-07 : « tout AT avec arrêt et toute gravité potentielle élevée »), ou null :
 * - 'gravite' : gravité potentielle G3 ou G4, tout type (maladie professionnelle exclue : événement réservé, sans risque) ;
 * - 'arret' : accident du travail avec arrêt (blessure « arrêt » ou jours perdus) — donnée de santé : l'échéance qui en
 *   découle seule est réservée aux rôles habilités (health).
 * Événement classé sans suite ou survenu hors de la fenêtre de 12 mois : null.
 */
export function duerpReviewReason(e: DuerpReviewEvent, now: string): 'gravite' | 'arret' | null {
  if (e.dismissed || e.type === 'MP' || e.occurredOn > now || e.occurredOn <= addMonths(now, -DUERP_REVIEW_WINDOW_MONTHS)) return null;
  if (e.severity >= DUERP_REVIEW_MIN_SEVERITY) return 'gravite';
  if (e.type === 'AT' && (e.injury === 'arret' || (e.lostDays ?? 0) > 0)) return 'arret';
  return null;
}

/**
 * Réévaluation faite (DUE-07) : une version du DUERP validée (consultation du CSE) le jour de l'événement ou après, ou le
 * risque rattaché à l'événement recoté (residualReviewedOn) le jour de l'événement ou après.
 */
export function duerpReviewDone(occurredOn: string, validatedOn: readonly (string | null)[], riskReviewedOn: string | null): boolean {
  return validatedOn.some((d) => !!d && d >= occurredOn) || (!!riskReviewedOn && riskReviewedOn >= occurredOn);
}

/**
 * DUE-10 (« le DUERP doit être figé après validation par le CSE mais il faut qu'après on puisse rajouter des
 * commentaires ») : refus de modifier une version validée (consultation du CSE enregistrée) — validateur, date de
 * consultation et objet de la mise à jour — ou null. Les transmissions au SPST et au portail restent saisissables.
 */
export function frozenVersionError(
  stored: { cseConsultedOn: string | null; validatedById: string | null; comment: string | null },
  next: { cseConsultedOn: string | null; validatedById: string | null; comment: string | null },
): string | null {
  if (!stored.cseConsultedOn) return null;
  const changed = stored.cseConsultedOn !== next.cseConsultedOn || stored.validatedById !== next.validatedById || (stored.comment ?? null) !== (next.comment ?? null);
  return changed ? 'Version validée par le CSE : son contenu est figé. Ajoutez un commentaire à la version.' : null;
}

/** Commentaire ajouté à une version du DUERP après sa validation (DUE-10) : 2 000 caractères au plus. */
export const DUERP_COMMENT_MAX = 2000;
