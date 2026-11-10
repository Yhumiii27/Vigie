// Droit d'écriture sur un écran (QUA-18) : règle pure commune à toutes les gardes des server actions (requireEditor de
// src/lib/guard.ts). Ordre des refus inchangé : rôle d'encadrement (ou de validation), puis écran modifiable (canEdit :
// écran ouvert au rôle et non limité à la consultation).
import { canApprove, canEdit, canManage, type Role, type ScreenKey } from './domain';

/** Refus d'une saisie par un rôle sans droit d'écriture (Salarié, écran en consultation seule). */
export const EDIT_DENIED = 'Votre rôle ne permet pas cette modification.';
/** Refus d'une validation (animateur QHSE et direction seulement). */
export const APPROVER_ONLY = "Réservé à l'animateur QHSE et à la direction.";
/** Refus d'une écriture réservée au service QHSE (animateur QHSE) : actions QSE et suivi des événements (ACT-P17, EVT-29). */
export const QHSE_ONLY = "Réservé à l'animateur QHSE.";

export type EditorOptions = {
  /** Validation : animateur QHSE et direction seulement (requireApprover), au lieu de l'encadrement (requireManager). */
  approver?: boolean;
  /**
   * Écran modifié par le seul service QHSE (canEdit : animateur QHSE seulement, ROLES de src/lib/domain.ts — actions et
   * événements, réponses du 09/11/2026) : un seul message de refus (QHSE_ONLY, ou `denied`) pour tous les autres rôles.
   */
  qhse?: boolean;
  /** Message propre à l'écran quand le rôle peut saisir ailleurs mais pas sur cet écran (consultation seule). */
  denied?: string;
};

/** Message de refus d'une écriture sur `screen` par `role`, ou null si elle est permise. */
export function editorError(role: Role, screen: ScreenKey, opts: EditorOptions = {}): string | null {
  if (opts.qhse) return canEdit(role, screen) ? null : opts.denied ?? QHSE_ONLY;
  if (opts.approver ? !canApprove(role) : !canManage(role)) return opts.approver ? APPROVER_ONLY : EDIT_DENIED;
  return canEdit(role, screen) ? null : opts.denied ?? EDIT_DENIED;
}
