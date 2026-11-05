import { describe, expect, it } from 'vitest';
import { codexDecisionPayload, readCodexResponse, retryDelayMs } from './outbound';

// D12 (lot 5 de M-02) : file d'envoi vers Codex — corps du webhook, reprises espacées, lecture des réponses.

describe('envois à Codex', () => {
  it('corps du webhook : champs bornés comme Codex les lit', () => {
    expect(codexDecisionPayload({ requestId: 'ECR-2026-001', accepted: true, ecoRef: ' ', modifierId: 'jwagner', note: 'x'.repeat(2100) }))
      .toEqual({ requestId: 'ECR-2026-001', accepted: true, ecoRef: null, modifierId: 'jwagner', note: 'x'.repeat(2000) });
  });

  it('reprises : 1, 2, 4… minutes, au plus 6 h ; Retry-After plus long respecté', () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(240_000);
    expect(retryDelayMs(20)).toBe(6 * 3_600_000);
    expect(retryDelayMs(1, 600)).toBe(600_000);
    expect(retryDelayMs(5, 10)).toBe(16 * 60_000);
  });

  it('réponses : 200 et 202 envoyés, 429 et 5xx repris, 4xx refusés', () => {
    expect(readCodexResponse(200, { status: 'implemented', revision: 'B' })).toEqual({ kind: 'sent', pending: false, implemented: true, rejected: false, revision: 'B' });
    expect(readCodexResponse(200, { status: 'rejected' })).toMatchObject({ kind: 'sent', rejected: true, implemented: false });
    expect(readCodexResponse(202, { pending: true, revision: 'C' })).toMatchObject({ kind: 'sent', pending: true, implemented: false });
    expect(readCodexResponse(429, { error: 'rate_limited' })).toEqual({ kind: 'retry', error: 'HTTP 429 rate_limited' });
    expect(readCodexResponse(503, null)).toEqual({ kind: 'retry', error: 'HTTP 503' });
    expect(readCodexResponse(404, { error: 'not_found' })).toEqual({ kind: 'failed', error: 'HTTP 404 not_found' });
    expect(readCodexResponse(401, { error: 'unauthorized', reason: 'signature_invalid' })).toEqual({ kind: 'failed', error: 'HTTP 401 unauthorized' });
  });
});
