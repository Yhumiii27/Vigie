import { describe, expect, it } from 'vitest';
import { WHOLE_DAY, activitySlot, fmtHourRanges, fmtSlot, overlapHours, parseSimopsDay, permitSlot, simultaneous } from './simops';

// PRV-22 : opérations simultanées par zone et par heure — règles pures.

describe('créneaux du jour', () => {
  it('permis : validité ramenée au jour (heure de Paris), null hors du jour', () => {
    expect(permitSlot('2026-10-09T07:30', '2026-10-09T17:00', '2026-10-09')).toEqual({ from: 450, to: 1020 });
    expect(permitSlot('2026-10-08T07:30', '2026-10-10T17:00', '2026-10-09')).toEqual(WHOLE_DAY);
    expect(permitSlot('2026-10-08T07:30', '2026-10-09T10:00', '2026-10-09')).toEqual({ from: 0, to: 600 });
    expect(permitSlot('2026-10-10T07:30', '2026-10-10T17:00', '2026-10-09')).toBeNull();
  });
  it('activité : plage horaire libre lue, sinon toute la journée', () => {
    expect(activitySlot('7 h 30 – 16 h 30')).toEqual({ from: 450, to: 990 });
    expect(activitySlot('14h-17h')).toEqual({ from: 840, to: 1020 });
    expect(activitySlot('matin')).toEqual(WHOLE_DAY);
    expect(activitySlot(null)).toEqual(WHOLE_DAY);
    expect(fmtSlot({ from: 450, to: 990 })).toBe('7 h 30 – 16 h 30');
    expect(fmtSlot(WHOLE_DAY)).toBe('Toute la journée');
  });
  it('jour demandé valide, sinon le jour même', () => {
    expect(parseSimopsDay('2026-10-12', '2026-10-09')).toBe('2026-10-12');
    expect(parseSimopsDay('12/10/2026', '2026-10-09')).toBe('2026-10-09');
    expect(parseSimopsDay(undefined, '2026-10-09')).toBe('2026-10-09');
  });
});

describe('simultanéité', () => {
  it('heures où au moins deux opérations se recouvrent, fusionnées', () => {
    expect(overlapHours([{ from: 450, to: 990 }, { from: 480, to: 720 }])).toEqual([[8, 12]]);
    expect(overlapHours([{ from: 480, to: 600 }, { from: 600, to: 720 }])).toEqual([]);
    expect(fmtHourRanges([[8, 12], [14, 15]])).toBe('8 h – 12 h, 14 h – 15 h');
  });
  it('opérations d’une même zone dont les créneaux se recoupent ; jamais sans zone', () => {
    const m = simultaneous([
      { key: 'a', zoneId: 1, slot: { from: 450, to: 990 } },
      { key: 'b', zoneId: 1, slot: { from: 480, to: 600 } },
      { key: 'c', zoneId: 2, slot: { from: 480, to: 600 } },
      { key: 'd', zoneId: null, slot: { from: 480, to: 600 } },
      { key: 'e', zoneId: null, slot: { from: 480, to: 600 } },
    ]);
    expect(m.get('a')).toEqual(['b']);
    expect(m.get('c')).toEqual([]);
    expect(m.get('d')).toEqual([]);
  });
});
