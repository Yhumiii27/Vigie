// Retours d'état (UX-14), règles pures : message annoncé après une server action (src/components/feedback.tsx).

export type FeedbackTone = 'ok' | 'info' | 'error';
export type Feedback = { tone: FeedbackTone; message: string };

/** Confirmation par défaut d'un formulaire enregistré (ActionForm). */
export const SAVED_MESSAGE = 'Enregistrement effectué.';
/** Échec sans message de l'action : réseau coupé, serveur indisponible, erreur inattendue. */
export const FAILURE_MESSAGE = "L'enregistrement n'a pas abouti (connexion ou serveur indisponible). Réessayez.";

/**
 * Retour d'une server action : `{ error }` (message de l'action), sinon succès avec `success` (ou rien à annoncer). Toute
 * autre forme (undefined, `{ ok: true }`, identifiant…) vaut succès.
 */
export function feedbackOf(result: unknown, success?: string): Feedback {
  if (result && typeof result === 'object' && 'error' in result) {
    const error = (result as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) return { tone: 'error', message: error };
  }
  return { tone: 'ok', message: success ?? '' };
}

/**
 * Message d'un formulaire enregistré : celui renvoyé par l'action (`message`), sinon `success` (false : aucune annonce),
 * sinon la confirmation par défaut.
 */
export function savedMessage(state: { message?: string }, success?: string | false): string | null {
  if (success === false) return null;
  return state.message?.trim() || success || SAVED_MESSAGE;
}
