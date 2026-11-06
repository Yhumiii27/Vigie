// Envois aux autres outils (D12, lot 5 de M-02, migration 0029) : règles pures de la file outbound_messages — libellés,
// reprises espacées, lecture de la réponse du webhook de Codex (POST /api/integrations/vigie, docs/api.md de Codex).
// Module sans import de serveur ; l'envoi est dans src/server/outbound.ts.

import type { Tone } from '../domain';
import type { OUTBOUND_KIND_CODES, OUTBOUND_STATUS_CODES, OUTBOUND_TARGET_CODES } from '../state-keys';

export type OutboundStatus = (typeof OUTBOUND_STATUS_CODES)[number];
export type OutboundTarget = (typeof OUTBOUND_TARGET_CODES)[number];
export type OutboundKind = (typeof OUTBOUND_KIND_CODES)[number];

export const OUTBOUND_STATUSES: Record<OutboundStatus, { label: string; tone: Tone }> = {
  pending: { label: 'À envoyer', tone: 'accent' },
  sent: { label: 'Envoyé', tone: 'ok' },
  failed: { label: 'Refusé par le destinataire', tone: 'danger' },
};
export const OUTBOUND_TARGETS: Record<OutboundTarget, { label: string; path: string }> = {
  codex: { label: 'Codex', path: '/api/integrations/vigie' },
};
export const OUTBOUND_KINDS: Record<OutboundKind, string> = { ecr_decision: 'Décision sur une demande de modification' };

/** Corps du webhook de Codex (docs/api.md de Codex, « décisions de Vigie ») : identifiants de 64 caractères, note de 2 000. */
export type CodexDecisionPayload = { requestId: string; accepted: boolean; ecoRef: string | null; modifierId: string | null; note: string | null };

export function codexDecisionPayload(o: { requestId: string; accepted: boolean; ecoRef?: string | null; modifierId?: string | null; note?: string | null }): CodexDecisionPayload {
  const cut = (v: string | null | undefined, max: number) => (v?.trim() ? v.trim().slice(0, max) : null);
  return { requestId: o.requestId, accepted: o.accepted, ecoRef: cut(o.ecoRef, 64), modifierId: cut(o.modifierId, 64), note: cut(o.note, 2000) };
}

/** Tentatives au-delà desquelles un message n'est plus repris (refus définitif, échéance du QHSE). */
export const OUTBOUND_MAX_ATTEMPTS = 12;
const MINUTE = 60_000;
/** Attente avant la reprise n° `attempts` (1, 2, 4… minutes, au plus 6 h) ; `retryAfterS` du destinataire si plus long. */
export function retryDelayMs(attempts: number, retryAfterS?: number | null): number {
  const backoff = Math.min(2 ** Math.max(0, attempts - 1) * MINUTE, 6 * 60 * MINUTE);
  return Math.max(backoff, retryAfterS && retryAfterS > 0 ? Math.min(retryAfterS, 6 * 3600) * 1000 : 0);
}

/** Issue d'une réponse HTTP du webhook de Codex. */
export type DeliveryOutcome =
  | { kind: 'sent'; implemented: boolean; revision: string | null; pending: boolean; rejected: boolean }
  | { kind: 'retry'; error: string }
  | { kind: 'failed'; error: string };

/**
 * Lecture d'une réponse : 200 → envoyé (décision appliquée : `implemented` ou `rejected`, `revision` ouverte) ; 202 →
 * envoyé, acceptation enregistrée en attente chez Codex ; 409 `already_decided` avec la même issue déjà appliquée → 200
 * chez Codex, sinon refus définitif ; 400, 401, 403, 404, 413 → refus définitif (corps ou identifiants à corriger) ;
 * 429, 5xx, 503 `disabled` et erreur réseau → reprise. Jamais le corps envoyé dans le message d'erreur.
 */
export function readCodexResponse(status: number, body: unknown): DeliveryOutcome {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const code = typeof b.error === 'string' ? b.error.slice(0, 60) : null;
  if (status === 200 || status === 202) {
    return {
      kind: 'sent', pending: status === 202, implemented: status === 200 && b.status === 'implemented', rejected: status === 200 && b.status === 'rejected',
      revision: typeof b.revision === 'string' ? b.revision.slice(0, 10) : null,
    };
  }
  const error = `HTTP ${status}${code ? ` ${code}` : ''}`;
  if (status === 429 || status >= 500) return { kind: 'retry', error };
  return { kind: 'failed', error };
}
