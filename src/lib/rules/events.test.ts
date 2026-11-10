import { describe, expect, it } from 'vitest';
import { REPORT_OCCURRED_MAX_DAYS, reportOccurredError } from './events';

describe('reportOccurredError : date et heure des faits d’un signalement terrain (EVT-21)', () => {
  const now = new Date('2026-10-09T10:00:00Z');
  it('admet un instant passé dans la limite, l’envoi lui-même compris', () => {
    expect(reportOccurredError(now, now)).toBeNull();
    expect(reportOccurredError(new Date(now.getTime() - REPORT_OCCURRED_MAX_DAYS * 86_400_000), now)).toBeNull();
  });
  it('refuse une saisie invalide, un instant futur ou trop ancien', () => {
    expect(reportOccurredError(null, now)).toMatch(/invalides/);
    expect(reportOccurredError(new Date(now.getTime() + 60_000), now)).toMatch(/postérieure/);
    expect(reportOccurredError(new Date(now.getTime() - (REPORT_OCCURRED_MAX_DAYS * 86_400_000 + 60_000)), now)).toMatch(/30 jours/);
  });
});
