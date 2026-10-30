// Clés stockées des colonnes d'état texte (QUA-23, migration 0017) : module pur, sans import, comme src/lib/action-keys.ts.
// Importé par src/db/schema.ts (contraintes CHECK) ; chaque liste est comparée à la liste de l'interface qui porte ses
// libellés (src/lib/state-keys.test.ts). Ajouter une valeur demande une nouvelle migration (la contrainte de la base en dépend).

/** events.type : EVENT_TYPES (src/lib/domain.ts). */
export const EVENT_TYPE_CODES = ['AT', 'PA', 'SD', 'NC', 'RC', 'ENV', 'MP'] as const;
/** event_steps.kind : EventTransition (src/lib/domain.ts). */
export const EVENT_STEP_KINDS = ['advance', 'revert', 'reopen', 'dismiss', 'restore'] as const;
/** reviews.status : REVIEW_STATUS (src/lib/domain.ts). */
export const REVIEW_STATUS_CODES = ['planifiee', 'tenue', 'cloturee', 'annulee'] as const;
/** reviews.kind : REVIEW_KINDS. */
export const REVIEW_KIND_CODES = ['ordinaire', 'intermediaire'] as const;
/** review_decisions.kind : REVIEW_DECISION_KINDS. */
export const REVIEW_DECISION_KIND_CODES = ['decision', 'objectif', 'ressource'] as const;
/** prevention_plans.status : PLAN_STATUS (src/lib/rules/prevention.ts). */
export const PLAN_STATUS_CODES = ['brouillon', 'a_signer', 'signe', 'clos', 'annule'] as const;
/** permits.status (stocké ; l'état affiché « expiré » est calculé : permitState). */
export const PERMIT_STATUS_CODES = ['demande', 'delivre', 'clos', 'annule'] as const;
/** permits.type : PERMIT_TYPES. */
export const PERMIT_TYPE_CODES = ['feu', 'essai'] as const;
/** document_versions.status : VERSION_STATUS_KEYS (src/lib/rules/documents.ts). */
export const VERSION_STATUS_CODES = ['brouillon', 'en_revue', 'approuve', 'archive'] as const;
/** requirements.evaluation, requirement_evaluations.evaluation : REQUIREMENT_EVAL. */
export const EVALUATION_CODES = ['conforme', 'ecart', 'analyse', 'a_evaluer'] as const;
/** audit_findings.kind : FINDING_KINDS. */
export const FINDING_KIND_CODES = ['ecart_majeur', 'ecart_mineur', 'observation', 'piste', 'point_fort'] as const;
/** waste_entries.bsd_status : BSD_STATUS (src/lib/rules/environment.ts), ou vide. */
export const BSD_STATUS_CODES = ['brouillon', 'emis', 'collecte', 'traite', 'refuse', 'accepte_partiel'] as const;
/** requirements.linked_to : REQUIREMENT_LINKS (src/lib/domain.ts), ou vide. */
export const REQUIREMENT_LINK_CODES = ['duerp', 'prevention', 'waste_register', 'waste_bsd', 'certification'] as const;
/** controls.category : CONTROL_CATEGORIES (src/lib/domain.ts) — VEI-14, migration 0020. */
export const CONTROL_CATEGORY_CODES = ['reglementaire', 'metrologie'] as const;
/** safety_notices.kind : SAFETY_NOTICE_KINDS (src/lib/domain.ts) — VEI-15. */
export const SAFETY_NOTICE_KIND_CODES = ['observation', 'mise_en_demeure'] as const;
/** prevention_plan_meetings.kind : PLAN_MEETING_KINDS (src/lib/rules/prevention.ts) — PRV-17. */
export const PLAN_MEETING_KIND_CODES = ['inspection', 'reunion'] as const;
/** risk_measure_links.kind : MEASURE_LINK_KINDS (src/lib/domain.ts) — DUE-19. */
export const MEASURE_LINK_KIND_CODES = ['control', 'document', 'title'] as const;
/** qualifications.effectiveness : TRAINING_EFFECTIVENESS (src/lib/domain.ts) — HAB-13. */
export const EFFECTIVENESS_CODES = ['efficace', 'partielle', 'non_efficace'] as const;
/** documents.origin : DOC_ORIGINS (src/lib/rules/documents.ts) — DOC-17, migration 0021. */
export const DOC_ORIGIN_CODES = ['interne', 'externe'] as const;
/** change_requests.kind : CHANGE_KINDS (src/lib/domain.ts) — CNF-11. */
export const CHANGE_KIND_CODES = ['organisation', 'procede', 'equipement', 'produit', 'exigence', 'autre'] as const;
/** change_requests.status : CHANGE_STATUS (src/lib/domain.ts) — CNF-11. */
export const CHANGE_STATUS_CODES = ['demandee', 'acceptee', 'refusee', 'realisee'] as const;
