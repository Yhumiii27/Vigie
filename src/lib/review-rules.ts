// Règles pures de la revue de direction (client-safe, sans import serveur).

import { fmtDate, yearOf } from './dates';

/** Revue telle que la voit le contrôle de clôture : participants internes et compte rendu de la séance. */
export type ReviewToClose = { status: string; participantIds: string[] | null; minutes: string | null };
/** Décision de la revue : texte et pilote ; une décision abandonnée (AUD-36) n'est plus à piloter. */
export type DecisionToClose = { text: string; pilotId: string | null; cancelledAt?: Date | string | null };

/**
 * Contrôles avant la clôture (visa de la direction, AUD-14) : compte rendu saisi (revue « tenue ») avec sa synthèse,
 * au moins un participant de l'entreprise, chaque décision pilotée. Liste vide : la revue peut être clôturée.
 */
export function reviewCloseBlockers(review: ReviewToClose, decisions: DecisionToClose[]): string[] {
  if (review.status !== 'tenue') return ['Saisissez le compte rendu avant de clôturer la revue.'];
  const out: string[] = [];
  if (!review.participantIds?.length) out.push("Indiquez au compte rendu les participants de l'entreprise.");
  if (!review.minutes?.trim()) out.push('Rédigez la synthèse de la séance au compte rendu.');
  const unpiloted = decisions.filter((d) => !d.pilotId && !d.cancelledAt);
  if (unpiloted.length === 1) out.push(`Désignez le pilote de la décision « ${clip(unpiloted[0].text)} ».`);
  else if (unpiloted.length > 1) out.push(`Désignez le pilote de ${unpiloted.length} décisions (${unpiloted.map((d) => `« ${clip(d.text)} »`).join(', ')}).`);
  return out;
}

const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * Suite d'une décision de revue à son échéance (AUD-16) : `none` sans action au plan, `abandoned` action abandonnée,
 * `open` action encore ouverte (À faire → 80 %, Reportée) ; null : suite donnée (Vérifiée) ou en attente de vérification
 * (Terminée, déjà rappelée par le plan d'actions). Une action rattachée mais introuvable compte comme sans action.
 */
export function decisionFollowUpGap(actionStatus: string | null, hasAction: boolean): 'none' | 'abandoned' | 'open' | null {
  if (!hasAction || !actionStatus) return 'none';
  if (actionStatus === 'abandonnee') return 'abandoned';
  if (actionStatus === 'verifiee' || actionStatus === 'terminee') return null;
  return 'open';
}

/** Texte abrégé pour un intitulé d'échéance. */
export const clipText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// ─── Contrôles de dates et de doublons (AUD-31) ─────────────────────────────
// Appliqués aux seules valeurs saisies ou modifiées (une date déjà enregistrée, passée depuis, reste acceptée).

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Date de remise d'un élément de la check-list : au plus tard le jour de la séance, jamais déjà passée ; revue dont la date
 * est dépassée : à reporter (ou son compte rendu à saisir) avant d'attendre un nouvel élément. Message, ou null.
 */
export function reviewItemDueError(dueOn: string | null, reviewOn: string, today: string): string | null {
  if (!dueOn) return null;
  if (reviewOn < today) return `Revue du ${fmtDate(reviewOn)} dépassée : reportez-la ou saisissez son compte rendu avant de fixer une date de remise.`;
  if (dueOn > reviewOn) return `Remise attendue au plus tard le jour de la séance (${fmtDate(reviewOn)}).`;
  if (dueOn < today) return 'Date de remise déjà passée.';
  return null;
}

/** Échéance d'une décision, d'un objectif ou d'un besoin : pas avant la revue, jamais déjà passée. Message, ou null. */
export function decisionDueError(dueOn: string | null, reviewOn: string, today: string): string | null {
  if (!dueOn) return null;
  if (dueOn < reviewOn) return `Échéance antérieure à la revue du ${fmtDate(reviewOn)}.`;
  if (dueOn < today) return 'Échéance déjà passée.';
  return null;
}

/** Libellé déjà présent dans la même revue (élément de la check-list ou décision en vigueur), casse et accents indifférents. */
export function duplicateLabel(label: string, others: readonly { id: number; label: string }[], exceptId?: number | null): boolean {
  const key = norm(label);
  return !!key && others.some((o) => o.id !== exceptId && norm(o.label) === key);
}

/** Revue telle que la voit le contrôle des doublons de planification. */
export type PlannedReview = { id: number; reviewOn: string; kind: string; status: string };

/**
 * Revue du même type déjà planifiée la même année civile (AUD-31 : jamais deux revues annuelles, ou deux intermédiaires,
 * planifiées la même année) : la revue en conflit, ou null. Contrôlé à la planification d'une nouvelle revue ; `id` : revue
 * exclue du contrôle.
 */
export function plannedReviewTwin<R extends PlannedReview>(reviews: readonly R[], candidate: { id?: number; reviewOn: string; kind: string }): R | null {
  return reviews.find((r) => r.id !== candidate.id && r.status === 'planifiee' && r.kind === candidate.kind && yearOf(r.reviewOn) === yearOf(candidate.reviewOn)) ?? null;
}
