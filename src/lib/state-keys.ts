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
/** change_requests.kind : CHANGE_KINDS (src/lib/domain.ts) — CNF-11. */
export const CHANGE_KIND_CODES = ['organisation', 'procede', 'equipement', 'produit', 'exigence', 'autre'] as const;
/** change_requests.status : CHANGE_STATUS (src/lib/domain.ts) — CNF-11. */
export const CHANGE_STATUS_CODES = ['demandee', 'acceptee', 'refusee', 'realisee'] as const;
/** process_safety_studies.milestone : STUDY_MILESTONES (src/lib/rules/process-safety.ts) — VG-01, migration 0023. */
export const STUDY_MILESTONE_CODES = ['HS2', 'HS3', 'HS4', 'PSSR', 'HS6'] as const;
/** process_safety_studies.type : STUDY_TYPES. */
export const STUDY_TYPE_CODES = ['hazid', 'hazop', 'amdec', 'controle_chantier', 'pssr', 'rspdi', 'aspd'] as const;
/** process_safety_studies.status (stocké ; « annulee » est calculé d'après le triplet cancelled_*) : STORED_STUDY_STATUS_KEYS. */
export const STUDY_STATUS_CODES = ['planifiee', 'realisee', 'validee'] as const;
/** process_safety_studies.conclusion : STUDY_CONCLUSIONS, ou vide. */
export const STUDY_CONCLUSION_CODES = ['favorable', 'reserves', 'defavorable'] as const;
/** sites.matrix_state : MATRIX_SITE_STATES (src/lib/foreign/labels.ts) — D14, migration 0024. */
export const MATRIX_STATE_CODES = ['actif', 'ferme', 'absent'] as const;
/** sync_runs.status : SYNC_STATUSES (src/lib/foreign/labels.ts) — lot 0 de M-02, migration 0024. */
export const SYNC_STATUS_CODES = ['ok', 'error', 'unavailable'] as const;
/** keystone_assignments.source : ASSIGNMENT_SOURCES (src/lib/foreign/labels.ts) — D04, contrat keystone.pub_affectations. */
export const ASSIGNMENT_SOURCE_CODES = ['rotation', 'planning'] as const;
/** training_titles.cursus_state : CURSUS_TITLE_STATES (src/lib/foreign/labels.ts) — D08, migration 0025. */
export const CURSUS_TITLE_STATE_CODES = ['actif', 'absent'] as const;
/** people.cursus_state : CURSUS_PERSON_STATES (src/lib/foreign/labels.ts) — D01, décision CV-10, migration 0030. */
export const CURSUS_PERSON_STATE_CODES = ['actif', 'absent'] as const;
/** people.category : PERSON_CATEGORIES (src/lib/foreign/labels.ts) — contrat cursus.pub_salaries D01 v2 (colonne categorie). */
export const PERSON_CATEGORY_CODES = ['salarie', 'interimaire', 'exterieur'] as const;
/** inbound_requests.status : INBOUND_STATUSES (src/lib/rules/inbound.ts) — D13, décision CV-08, migration 0026. */
export const INBOUND_STATUS_CODES = ['received', 'applied', 'rejected'] as const;
/** inbound_requests.kind : INBOUND_KINDS (src/lib/rules/inbound.ts) — demandes déposées par vigie.pub_signaler_avancement_nc. */
export const INBOUND_KIND_CODES = ['nc_step', 'nc_verification', 'nc_references'] as const;
/** inbound_requests.result_code (demande refusée) : INBOUND_RESULT_CODES_LABELS (src/lib/rules/inbound.ts). */
export const INBOUND_RESULT_CODES = ['stale', 'refused', 'not_found', 'invalid'] as const;
/**
 * inbound_requests.kind, demandes de D12 (lot 5 de M-02, migration 0029) : création d'une demande de modification par Codex
 * (vigie.pub_creer_demande_modification), avancement et approbation d'un ordre de modification par Keystone
 * (vigie.pub_signaler_avancement_eco). Liste complète des natures : INBOUND_KIND_CODES + ENGINEERING_INBOUND_KIND_CODES.
 */
export const ENGINEERING_INBOUND_KIND_CODES = ['ecr_create', 'eco_step', 'eco_approval'] as const;
/** ecos.eco_type : ECO_TYPES (src/lib/rules/engineering.ts) — D12, spécification partage/60-vigie-ecr-eco.sql de Matrix. */
export const ECO_TYPE_CODES = ['rev', 'sub', 'asm', 'sup', 'obs'] as const;
/** ecos.status : ECO_STATUSES. */
export const ECO_STATUS_CODES = ['draft', 'impact_analysis', 'in_approval', 'released', 'rejected'] as const;
/** ecos.source et ecrs.source : outil d'origine (ENGINEERING_SOURCES). */
export const ENGINEERING_SOURCE_CODES = ['vigie', 'keystone', 'codex'] as const;
/** ecrs.kind : ECR_KINDS. */
export const ECR_KIND_CODES = ['modification', 'obsolescence'] as const;
/** ecrs.subject : ECR_SUBJECTS. */
export const ECR_SUBJECT_CODES = ['document', 'part', 'project', 'event'] as const;
/** ecrs.status : ECR_STATUSES. */
export const ECR_STATUS_CODES = ['submitted', 'accepted', 'rejected', 'implemented'] as const;
/** eco_approvals.approval_key : ECO_APPROVAL_KEYS. */
export const ECO_APPROVAL_KEY_CODES = ['englead', 'quality', 'pm'] as const;
/** eco_approvals.decision : ECO_DECISIONS. */
export const ECO_DECISION_CODES = ['pending', 'ok', 'rejected'] as const;
/** eco_approvals.via : outil où la décision a été prise. */
export const ECO_APPROVAL_VIA_CODES = ['vigie', 'keystone'] as const;
/** eco_effectivity.target_type : EFFECTIVITY_TARGETS. */
export const EFFECTIVITY_TARGET_CODES = ['project', 'machine'] as const;
/** eco_effectivity.disposition : EFFECTIVITY_DISPOSITIONS, ou vide (à décider). */
export const EFFECTIVITY_DISPOSITION_CODES = ['update', 'pinned', 'retrofit', 'na'] as const;
/** ecrs.notify_status et outbound_messages.status : OUTBOUND_STATUSES (src/lib/rules/outbound.ts). */
export const OUTBOUND_STATUS_CODES = ['pending', 'sent', 'failed'] as const;
/** outbound_messages.target : outils destinataires (OUTBOUND_TARGETS). */
export const OUTBOUND_TARGET_CODES = ['codex'] as const;
/** outbound_messages.kind : OUTBOUND_KINDS. */
export const OUTBOUND_KIND_CODES = ['ecr_decision'] as const;
