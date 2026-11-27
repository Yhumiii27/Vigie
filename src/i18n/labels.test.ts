import { describe, expect, it } from 'vitest';
import {
  ACTION_DOMAINS, ACTION_PRIORITIES, ACTION_RISK_LEVELS, ACTION_SOURCES, AUDIT_KINDS, AVANCEMENT, BENIGN_CAREGIVER_KINDS, D8_STEPS, ENV_ASPECTS,
  ENV_MEDIA, EVENT_DISMISSED, EVENT_STEPS, EVENT_TRANSITIONS, EVENT_TYPES, FINDING_KINDS, FOLLOW_REASONS, METHODS, NC_DISPOSITIONS, NC_ORIGINS,
  SEVERITY, VERIFY_METHODS, VICTIM_KINDS, RISK_LEVELS, RISK_FLAGS, PROGRAM_STATES, DUERP_ACCESS_CHANNELS, REQUIREMENT_EVAL, REQUIREMENT_LINKS,
  CONTROL_RESULTS, CONTROL_CATEGORIES, SAFETY_NOTICE_KINDS, CHANGE_KINDS, CHANGE_STATUS, SKILL_STATES, ROLE_KEYS, REVIEW_SOURCES, REVIEW_KINDS,
  REVIEW_DECISION_KINDS, CONTEXT_KINDS, PLAN_ITEM_STATES, MEASURE_LINK_KINDS,
} from '@/lib/domain';
import { HEALTH_RESTRICTED, HEALTH_RESTRICTED_HINT, INJURIES } from '@/lib/rules/events';
import { BSD_STATUS, TREATMENT_CODES, TREATMENT_QUALIFICATIONS } from '@/lib/rules/environment';
import { COMPANY_RULE_REASON, DANGEROUS_WORK_HINT, PERMIT_STATE, PERMIT_TYPES, PLAN_STATUS, SEVESO_LEVELS, START_GAP_LABEL, ruleBasis, sevesoLabel } from '@/lib/rules/prevention';
import { ROUTE_KINDS, TEAMS, ZONE_KINDS } from '@/lib/rules/sitemap';
import { OBJECTIVE_INDICATORS } from '@/lib/objectives';
import { ASSESSMENT_STANDARDS, CONFORMITY_LEVELS } from '@/lib/rules/self-assessment';
import { STUDY_MILESTONES, STUDY_TYPES } from '@/lib/rules/process-safety';
import { ECO_APPROVAL_KEYS, ECO_STATUSES, EFFECTIVITY_DISPOSITIONS } from '@/lib/rules/engineering';
import { CARD_PERIODS, DASHBOARD_CARDS } from '@/lib/dashboard-cards';
import { CURSUS_PERSON_STATES, CURSUS_TITLE_STATES, MATRIX_SITE_STATES, PERSON_CATEGORIES, SOURCES, SYNC_STATUSES } from '@/lib/integration-labels';
import { INBOUND_STATUSES } from '@/lib/rules/inbound';
import { OUTBOUND_STATUSES } from '@/lib/rules/outbound';
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
  AUDIT_KINDS: Object.values(AUDIT_KINDS).flatMap((x) => [x.label, x.short]),
  FINDING_KINDS: Object.values(FINDING_KINDS).map((x) => x.label),
  BSD_STATUS: Object.values(BSD_STATUS).map((x) => x.label),
  TREATMENT_CODES: TREATMENT_CODES.map(([, label]) => label),
  TREATMENT_QUALIFICATIONS: Object.values(TREATMENT_QUALIFICATIONS),
  RISK_LEVELS: RISK_LEVELS.map((x) => x.label),
  RISK_FLAGS: Object.values(RISK_FLAGS).flatMap((x) => [x.label, x.hint]),
  PROGRAM_STATES: Object.values(PROGRAM_STATES).map((x) => x.label),
  DUERP_ACCESS_CHANNELS: Object.values(DUERP_ACCESS_CHANNELS),
  REQUIREMENT_EVAL: Object.values(REQUIREMENT_EVAL).map((x) => x.label),
  REQUIREMENT_LINKS: Object.values(REQUIREMENT_LINKS).flatMap((x) => [x.label, x.hint]),
  CONTROL_RESULTS: Object.values(CONTROL_RESULTS).map((x) => x.label),
  CONTROL_CATEGORIES: Object.values(CONTROL_CATEGORIES).flatMap((x) => [x.label, x.short]),
  SAFETY_NOTICE_KINDS: Object.values(SAFETY_NOTICE_KINDS).map((x) => x.label),
  CHANGE_KINDS: Object.values(CHANGE_KINDS).map((x) => x.label),
  CHANGE_STATUS: Object.values(CHANGE_STATUS).map((x) => x.label),
  SKILL_STATES: Object.values(SKILL_STATES).map((x) => x.label),
  ROLES: ROLE_KEYS,
  SITE_MAP: [...Object.values(ZONE_KINDS), ...Object.values(ROUTE_KINDS), ...Object.values(TEAMS)].map((x) => x.label),
  PREVENTION: [
    ...Object.values(PLAN_STATUS).map((x) => x.label), ...Object.values(PERMIT_TYPES).flatMap((x) => [x.label, x.short]),
    ...Object.values(PERMIT_STATE).map((x) => x.label), ...Object.values(START_GAP_LABEL), ...SEVESO_LEVELS.map(([, l]) => l),
    ...[null, 'seuil_haut', 'seuil_bas'].map(sevesoLabel), ruleBasis(null), COMPANY_RULE_REASON, DANGEROUS_WORK_HINT,
  ],
  REVIEW: [
    ...Object.values(REVIEW_SOURCES).map((x) => x.label), ...Object.values(REVIEW_KINDS).flatMap((x) => [x.label, x.short]),
    ...Object.values(REVIEW_DECISION_KINDS).map((x) => x.label), ...Object.values(CONTEXT_KINDS).flatMap((x) => [x.label, x.plural, x.detail]),
    ...Object.values(PLAN_ITEM_STATES).map((x) => x.label),
  ],
  MEASURE_LINK_KINDS: Object.values(MEASURE_LINK_KINDS).map((x) => x.label),
  OBJECTIVE_INDICATORS: Object.values(OBJECTIVE_INDICATORS).flatMap((x) => [x.label, x.short]),
  SELF_ASSESSMENT: [...Object.values(ASSESSMENT_STANDARDS).flatMap((x) => [x.label, x.short]), ...Object.values(CONFORMITY_LEVELS).map((x) => x.label)],
  PROCESS_SAFETY: [...Object.values(STUDY_MILESTONES).flatMap((x) => [x.label, x.hint]), ...Object.values(STUDY_TYPES).map((x) => x.label)],
  ENGINEERING: [
    ...Object.values(ECO_STATUSES).map((x) => x.label), ...Object.values(ECO_APPROVAL_KEYS).flatMap((x) => [x.label, x.short]),
    ...Object.values(EFFECTIVITY_DISPOSITIONS).map((x) => x.label),
  ],
  DASHBOARD_CARDS: [...Object.values(CARD_PERIODS).map((x) => x.label), ...Object.values(DASHBOARD_CARDS).flatMap((x) => [x.label, x.hint])],
  CONNECTORS: [
    ...Object.values(SOURCES), ...Object.values(MATRIX_SITE_STATES), ...Object.values(CURSUS_TITLE_STATES), ...Object.values(CURSUS_PERSON_STATES),
    ...Object.values(PERSON_CATEGORIES), ...Object.values(SYNC_STATUSES), ...Object.values(INBOUND_STATUSES), ...Object.values(OUTBOUND_STATUSES),
  ].map((x) => x.label),
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
