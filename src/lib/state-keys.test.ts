import { describe, expect, it } from 'vitest';
import { BSD_STATUS_KEYS } from '@/components/environment/model';
import { VERSION_STATUS_KEYS } from '@/components/documents/meta';
import { PERMIT_STATE, PERMIT_TYPE_KEYS, PLAN_STATUS } from '@/components/prevention/model';
import {
  EVENT_TYPE_KEYS, FINDING_KINDS, REQUIREMENT_EVAL, REQUIREMENT_LINK_KEYS, REVIEW_DECISION_KEYS, REVIEW_KIND_KEYS, REVIEW_STATUS, type EventTransition,
} from './domain';
import {
  BSD_STATUS_CODES, EVALUATION_CODES, EVENT_STEP_KINDS, EVENT_TYPE_CODES, FINDING_KIND_CODES, PERMIT_STATUS_CODES, PERMIT_TYPE_CODES, PLAN_STATUS_CODES,
  REQUIREMENT_LINK_CODES, REVIEW_DECISION_KIND_CODES, REVIEW_KIND_CODES, REVIEW_STATUS_CODES, VERSION_STATUS_CODES,
} from './state-keys';

// QUA-23 : les listes des contraintes CHECK (migration 0017) sont celles de l'interface ; une valeur ajoutée d'un côté
// seulement échoue ici (et demande une nouvelle migration).

const same = (a: readonly string[], b: readonly string[]) => expect([...a].sort()).toEqual([...b].sort());

describe('clés des colonnes d’état (QUA-23)', () => {
  it('identiques aux listes de l’interface', () => {
    same(EVENT_TYPE_CODES, EVENT_TYPE_KEYS);
    same(EVENT_STEP_KINDS, ['advance', 'revert', 'reopen', 'dismiss', 'restore'] satisfies EventTransition[]);
    same(REVIEW_STATUS_CODES, Object.keys(REVIEW_STATUS));
    same(REVIEW_KIND_CODES, REVIEW_KIND_KEYS);
    same(REVIEW_DECISION_KIND_CODES, REVIEW_DECISION_KEYS);
    same(PLAN_STATUS_CODES, Object.keys(PLAN_STATUS));
    // État stocké d'un permis : l'état affiché ajoute « en cours » et « expiré », calculés (permitState).
    same(PERMIT_STATUS_CODES, Object.keys(PERMIT_STATE).filter((k) => k !== 'en_cours' && k !== 'expire'));
    same(PERMIT_TYPE_CODES, PERMIT_TYPE_KEYS);
    same(VERSION_STATUS_CODES, VERSION_STATUS_KEYS);
    same(EVALUATION_CODES, Object.keys(REQUIREMENT_EVAL));
    same(FINDING_KIND_CODES, Object.keys(FINDING_KINDS));
    same(BSD_STATUS_CODES, BSD_STATUS_KEYS);
    same(REQUIREMENT_LINK_CODES, REQUIREMENT_LINK_KEYS);
  });
});
