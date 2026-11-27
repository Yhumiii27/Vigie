import { describe, expect, it } from 'vitest';
import {
  ACTION_DOMAINS, ACTION_PRIORITIES, ACTION_RISK_LEVELS, ACTION_SOURCES, AUDIT_KINDS, AVANCEMENT, BENIGN_CAREGIVER_KINDS, D8_STEPS, ENV_ASPECTS,
  ENV_MEDIA, EVENT_DISMISSED, EVENT_STEPS, EVENT_TRANSITIONS, EVENT_TYPES, FINDING_KINDS, FOLLOW_REASONS, METHODS, NC_DISPOSITIONS, NC_ORIGINS,
  SEVERITY, VERIFY_METHODS, VICTIM_KINDS,
} from '@/lib/domain';
import { HEALTH_RESTRICTED, HEALTH_RESTRICTED_HINT, INJURIES } from '@/lib/rules/events';
import { BSD_STATUS, TREATMENT_CODES, TREATMENT_QUALIFICATIONS } from '@/lib/rules/environment';
import { LABEL_EN, LABELS_FR, labelT } from './labels';
import { FR } from './fr';
import { makeT } from './translate';

// VG-N01 : les libellés des tables de src/lib repris s'affichent en anglais par leur chaîne source, et en français exactement
// comme la table (le serveur, les règles et le journal ne voient jamais que le libellé français).
const TABLES: Record<string, readonly string[]> = {
  EVENT_TYPES: Object.values(EVENT_TYPES).map((x) => x.label),
  EVENT_STEPS: [...EVENT_STEPS, EVENT_DISMISSED],
  EVENT_TRANSITIONS: Object.values(EVENT_TRANSITIONS).map((x) => x.label),
  VICTIM_KINDS: Object.values(VICTIM_KINDS),
  SEVERITY: SEVERITY.filter(Boolean),
  METHODS: METHODS.map(([, label]) => label),
  D8_STEPS,
  INJURIES: INJURIES.map(([, label]) => label),
  HEALTH: [HEALTH_RESTRICTED, HEALTH_RESTRICTED_HINT],
  ENV: [...ENV_ASPECTS, ...ENV_MEDIA],
  NC: [...NC_ORIGINS, ...Object.values(NC_DISPOSITIONS)],
  BENIGN_CAREGIVER_KINDS: Object.values(BENIGN_CAREGIVER_KINDS),
  AVANCEMENT: [...Object.values(AVANCEMENT).map((x) => x.label), 'En retard'],
  ACTION_PRIORITIES: Object.values(ACTION_PRIORITIES).map((x) => x.label),
  ACTION_DOMAINS: Object.values(ACTION_DOMAINS),
  ACTION_RISK_LEVELS,
  VERIFY_METHODS: Object.values(VERIFY_METHODS),
  FOLLOW_REASONS: Object.values(FOLLOW_REASONS),
  ACTION_SOURCES: Object.values(ACTION_SOURCES).map((x) => x.label),
  AUDIT_KINDS: Object.values(AUDIT_KINDS).map((x) => x.label),
  FINDING_KINDS: Object.values(FINDING_KINDS).map((x) => x.label),
  BSD_STATUS: Object.values(BSD_STATUS).map((x) => x.label),
  TREATMENT_CODES: TREATMENT_CODES.map(([, label]) => label),
  TREATMENT_QUALIFICATIONS: Object.values(TREATMENT_QUALIFICATIONS),
};

describe('libellés des tables de src/lib (VG-N01)', () => {
  it('chaque libellé des tables reprises a sa chaîne source anglaise', () => {
    const missing = Object.entries(TABLES).flatMap(([name, labels]) => labels.filter((l) => !Object.hasOwn(LABEL_EN, l)).map((l) => `${name} : ${l}`));
    expect(missing).toEqual([]);
  });

  it('en français, le libellé est rendu mot pour mot ; en anglais, sa chaîne source', () => {
    const fr = labelT(makeT('fr'));
    const en = labelT(makeT('en'));
    for (const [label, source] of Object.entries(LABEL_EN)) {
      expect(fr(label), label).toBe(label);
      expect(FR[source], source).toBe(label);
      expect(en(label)).toBe(source.replace(/#[a-z]+$/, ''));
    }
  });

  it('une chaîne source par libellé (inversion sans perte) ; un libellé inconnu est rendu tel quel', () => {
    expect(Object.keys(LABELS_FR).length).toBe(Object.keys(LABEL_EN).length);
    expect(labelT(makeT('en'))('Texte saisi')).toBe('Texte saisi');
    expect(labelT(makeT('en'))('G3 · grave')).toBe('G3 · serious');
  });
});
