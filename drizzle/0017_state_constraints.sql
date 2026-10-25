-- QUA-23 : convention des états annulé, archivé et classé sans suite, et domaines des colonnes d'état texte, en contraintes
-- CHECK (src/db/schema.ts : archiveState, src/lib/state-keys.ts). Triplet date / auteur / motif : tous vides, ou date et
-- motif non vide (auteur facultatif) ; statut « annulé » d'une revue, d'un plan de prévention ou d'un permis porté par sa date
-- ou son motif d'annulation. Aucune vue pub_ touchée. Données existantes, dans la même transaction :
--   1. réparation sans perte seulement : motif vide (chaîne vide ou espaces) d'un élément ni archivé, ni annulé, ni classé
--      → NULL (aucune information perdue) ;
--   2. toute autre incohérence (date sans motif, motif ou auteur sans date, statut inconnu…) fait échouer la migration avec
--      la liste des contraintes et le nombre de lignes à corriger : rien n'est modifié, la base reste à la migration 0016
--      (sauvegarde automatique faite avant) ; corriger ces lignes (requête : select * from <table> where not (<contrainte>),
--      contraintes ci-dessous), puis redémarrer (docs/EXPLOITATION.md § 6).
UPDATE "actions" SET "cancel_reason" = NULL WHERE "cancelled_at" IS NULL AND "cancelled_by_id" IS NULL AND "cancel_reason" IS NOT NULL AND btrim("cancel_reason") = '';
--> statement-breakpoint
UPDATE "audit_findings" SET "cancel_reason" = NULL WHERE "cancelled_at" IS NULL AND "cancelled_by_id" IS NULL AND "cancel_reason" IS NOT NULL AND btrim("cancel_reason") = '';
--> statement-breakpoint
UPDATE "audit_plan_items" SET "cancel_reason" = NULL WHERE "cancelled_at" IS NULL AND "cancelled_by_id" IS NULL AND "cancel_reason" IS NOT NULL AND btrim("cancel_reason") = '';
--> statement-breakpoint
UPDATE "benign_accidents" SET "cancel_reason" = NULL WHERE "cancelled_at" IS NULL AND "cancelled_by_id" IS NULL AND "cancel_reason" IS NOT NULL AND btrim("cancel_reason") = '';
--> statement-breakpoint
UPDATE "coactivity_controls" SET "cancel_reason" = NULL WHERE "cancelled_at" IS NULL AND "cancelled_by_id" IS NULL AND "cancel_reason" IS NOT NULL AND btrim("cancel_reason") = '';
--> statement-breakpoint
UPDATE "context_items" SET "archive_reason" = NULL WHERE "archived_at" IS NULL AND "archived_by_id" IS NULL AND "archive_reason" IS NOT NULL AND btrim("archive_reason") = '';
--> statement-breakpoint
UPDATE "contractors" SET "archive_reason" = NULL WHERE "archived_at" IS NULL AND "archived_by_id" IS NULL AND "archive_reason" IS NOT NULL AND btrim("archive_reason") = '';
--> statement-breakpoint
UPDATE "control_records" SET "cancel_reason" = NULL WHERE "cancelled_at" IS NULL AND "cancelled_by_id" IS NULL AND "cancel_reason" IS NOT NULL AND btrim("cancel_reason") = '';
--> statement-breakpoint
UPDATE "controls" SET "archive_reason" = NULL WHERE "archived_at" IS NULL AND "archived_by_id" IS NULL AND "archive_reason" IS NOT NULL AND btrim("archive_reason") = '';
--> statement-breakpoint
UPDATE "duerp_access_requests" SET "cancel_reason" = NULL WHERE "cancelled_at" IS NULL AND "cancelled_by_id" IS NULL AND "cancel_reason" IS NOT NULL AND btrim("cancel_reason") = '';
--> statement-breakpoint
UPDATE "events" SET "dismiss_reason" = NULL WHERE "dismissed_at" IS NULL AND "dismissed_by_id" IS NULL AND "dismiss_reason" IS NOT NULL AND btrim("dismiss_reason") = '';
--> statement-breakpoint
UPDATE "map_zones" SET "archive_reason" = NULL WHERE "archived_at" IS NULL AND "archived_by_id" IS NULL AND "archive_reason" IS NOT NULL AND btrim("archive_reason") = '';
--> statement-breakpoint
UPDATE "prevention_plans" SET "cancel_reason" = NULL WHERE "cancelled_at" IS NULL AND "cancelled_by_id" IS NULL AND "cancel_reason" IS NOT NULL AND btrim("cancel_reason") = '';
--> statement-breakpoint
UPDATE "qhse_objectives" SET "archive_reason" = NULL WHERE "archived_at" IS NULL AND "archived_by_id" IS NULL AND "archive_reason" IS NOT NULL AND btrim("archive_reason") = '';
--> statement-breakpoint
UPDATE "qualifications" SET "cancel_reason" = NULL WHERE "cancelled_at" IS NULL AND "cancelled_by_id" IS NULL AND "cancel_reason" IS NOT NULL AND btrim("cancel_reason") = '';
--> statement-breakpoint
UPDATE "requirements" SET "archive_reason" = NULL WHERE "archived_at" IS NULL AND "archived_by_id" IS NULL AND "archive_reason" IS NOT NULL AND btrim("archive_reason") = '';
--> statement-breakpoint
UPDATE "reviews" SET "cancel_reason" = NULL WHERE "cancelled_at" IS NULL AND "cancelled_by_id" IS NULL AND "cancel_reason" IS NOT NULL AND btrim("cancel_reason") = '';
--> statement-breakpoint
UPDATE "risks" SET "archive_reason" = NULL WHERE "archived_at" IS NULL AND "archived_by_id" IS NULL AND "archive_reason" IS NOT NULL AND btrim("archive_reason") = '';
--> statement-breakpoint
UPDATE "site_activities" SET "cancel_reason" = NULL WHERE "cancelled_at" IS NULL AND "cancelled_by_id" IS NULL AND "cancel_reason" IS NOT NULL AND btrim("cancel_reason") = '';
--> statement-breakpoint
UPDATE "sites" SET "archive_reason" = NULL WHERE "archived_at" IS NULL AND "archived_by_id" IS NULL AND "archive_reason" IS NOT NULL AND btrim("archive_reason") = '';
--> statement-breakpoint
UPDATE "training_titles" SET "archive_reason" = NULL WHERE "archived_at" IS NULL AND "archived_by_id" IS NULL AND "archive_reason" IS NOT NULL AND btrim("archive_reason") = '';
--> statement-breakpoint
UPDATE "waste_entries" SET "cancel_reason" = NULL WHERE "cancelled_at" IS NULL AND "cancelled_by_id" IS NULL AND "cancel_reason" IS NOT NULL AND btrim("cancel_reason") = '';
--> statement-breakpoint
UPDATE "waste_streams" SET "archive_reason" = NULL WHERE "archived_at" IS NULL AND "archived_by_id" IS NULL AND "archive_reason" IS NOT NULL AND btrim("archive_reason") = '';
--> statement-breakpoint
UPDATE "work_units" SET "archive_reason" = NULL WHERE "archived_at" IS NULL AND "archived_by_id" IS NULL AND "archive_reason" IS NOT NULL AND btrim("archive_reason") = '';
--> statement-breakpoint
UPDATE "permits" SET "cancel_reason" = NULL WHERE "status" <> 'annule' AND "cancelled_by_id" IS NULL AND "cancel_reason" IS NOT NULL AND btrim("cancel_reason") = '';
--> statement-breakpoint
DO $qua23$
DECLARE
  n bigint;
  problems text := '';
BEGIN
  SELECT count(*) INTO n FROM "actions" WHERE NOT (("actions"."cancelled_at" is null and "actions"."cancelled_by_id" is null and "actions"."cancel_reason" is null) or ("actions"."cancelled_at" is not null and "actions"."cancel_reason" is not null and btrim("actions"."cancel_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'actions_cancel_check', n); END IF;
  SELECT count(*) INTO n FROM "audit_findings" WHERE NOT (("audit_findings"."cancelled_at" is null and "audit_findings"."cancelled_by_id" is null and "audit_findings"."cancel_reason" is null) or ("audit_findings"."cancelled_at" is not null and "audit_findings"."cancel_reason" is not null and btrim("audit_findings"."cancel_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'audit_findings_cancel_check', n); END IF;
  SELECT count(*) INTO n FROM "audit_findings" WHERE NOT ("audit_findings"."kind" in ('ecart_majeur', 'ecart_mineur', 'observation', 'piste', 'point_fort'));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'audit_findings_kind_check', n); END IF;
  SELECT count(*) INTO n FROM "audit_plan_items" WHERE NOT (("audit_plan_items"."cancelled_at" is null and "audit_plan_items"."cancelled_by_id" is null and "audit_plan_items"."cancel_reason" is null) or ("audit_plan_items"."cancelled_at" is not null and "audit_plan_items"."cancel_reason" is not null and btrim("audit_plan_items"."cancel_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'audit_plan_items_cancel_check', n); END IF;
  SELECT count(*) INTO n FROM "benign_accidents" WHERE NOT (("benign_accidents"."cancelled_at" is null and "benign_accidents"."cancelled_by_id" is null and "benign_accidents"."cancel_reason" is null) or ("benign_accidents"."cancelled_at" is not null and "benign_accidents"."cancel_reason" is not null and btrim("benign_accidents"."cancel_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'benign_accidents_cancel_check', n); END IF;
  SELECT count(*) INTO n FROM "coactivity_controls" WHERE NOT (("coactivity_controls"."cancelled_at" is null and "coactivity_controls"."cancelled_by_id" is null and "coactivity_controls"."cancel_reason" is null) or ("coactivity_controls"."cancelled_at" is not null and "coactivity_controls"."cancel_reason" is not null and btrim("coactivity_controls"."cancel_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'coactivity_controls_cancel_check', n); END IF;
  SELECT count(*) INTO n FROM "context_items" WHERE NOT (("context_items"."archived_at" is null and "context_items"."archived_by_id" is null and "context_items"."archive_reason" is null) or ("context_items"."archived_at" is not null and "context_items"."archive_reason" is not null and btrim("context_items"."archive_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'context_items_archive_check', n); END IF;
  SELECT count(*) INTO n FROM "contractors" WHERE NOT (("contractors"."archived_at" is null and "contractors"."archived_by_id" is null and "contractors"."archive_reason" is null) or ("contractors"."archived_at" is not null and "contractors"."archive_reason" is not null and btrim("contractors"."archive_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'contractors_archive_check', n); END IF;
  SELECT count(*) INTO n FROM "control_records" WHERE NOT (("control_records"."cancelled_at" is null and "control_records"."cancelled_by_id" is null and "control_records"."cancel_reason" is null) or ("control_records"."cancelled_at" is not null and "control_records"."cancel_reason" is not null and btrim("control_records"."cancel_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'control_records_cancel_check', n); END IF;
  SELECT count(*) INTO n FROM "controls" WHERE NOT (("controls"."archived_at" is null and "controls"."archived_by_id" is null and "controls"."archive_reason" is null) or ("controls"."archived_at" is not null and "controls"."archive_reason" is not null and btrim("controls"."archive_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'controls_archive_check', n); END IF;
  SELECT count(*) INTO n FROM "document_versions" WHERE NOT ("document_versions"."status" in ('brouillon', 'en_revue', 'approuve', 'archive'));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'document_versions_status_check', n); END IF;
  SELECT count(*) INTO n FROM "duerp_access_requests" WHERE NOT (("duerp_access_requests"."cancelled_at" is null and "duerp_access_requests"."cancelled_by_id" is null and "duerp_access_requests"."cancel_reason" is null) or ("duerp_access_requests"."cancelled_at" is not null and "duerp_access_requests"."cancel_reason" is not null and btrim("duerp_access_requests"."cancel_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'duerp_access_requests_cancel_check', n); END IF;
  SELECT count(*) INTO n FROM "event_steps" WHERE NOT ("event_steps"."kind" in ('advance', 'revert', 'reopen', 'dismiss', 'restore'));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'event_steps_kind_check', n); END IF;
  SELECT count(*) INTO n FROM "events" WHERE NOT (("events"."dismissed_at" is null and "events"."dismissed_by_id" is null and "events"."dismiss_reason" is null) or ("events"."dismissed_at" is not null and "events"."dismiss_reason" is not null and btrim("events"."dismiss_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'events_dismiss_check', n); END IF;
  SELECT count(*) INTO n FROM "events" WHERE NOT ("events"."type" in ('AT', 'PA', 'SD', 'NC', 'RC', 'ENV', 'MP'));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'events_type_check', n); END IF;
  SELECT count(*) INTO n FROM "map_zones" WHERE NOT (("map_zones"."archived_at" is null and "map_zones"."archived_by_id" is null and "map_zones"."archive_reason" is null) or ("map_zones"."archived_at" is not null and "map_zones"."archive_reason" is not null and btrim("map_zones"."archive_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'map_zones_archive_check', n); END IF;
  SELECT count(*) INTO n FROM "permits" WHERE NOT ("permits"."status" in ('demande', 'delivre', 'clos', 'annule'));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'permits_status_check', n); END IF;
  SELECT count(*) INTO n FROM "permits" WHERE NOT ("permits"."type" in ('feu', 'essai'));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'permits_type_check', n); END IF;
  SELECT count(*) INTO n FROM "permits" WHERE NOT (("permits"."status" = 'annule') = ("permits"."cancel_reason" is not null and btrim("permits"."cancel_reason") <> '') and ("permits"."status" = 'annule' or "permits"."cancelled_by_id" is null));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'permits_cancel_check', n); END IF;
  SELECT count(*) INTO n FROM "prevention_plans" WHERE NOT (("prevention_plans"."cancelled_at" is null and "prevention_plans"."cancelled_by_id" is null and "prevention_plans"."cancel_reason" is null) or ("prevention_plans"."cancelled_at" is not null and "prevention_plans"."cancel_reason" is not null and btrim("prevention_plans"."cancel_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'prevention_plans_cancel_check', n); END IF;
  SELECT count(*) INTO n FROM "prevention_plans" WHERE NOT ("prevention_plans"."status" in ('brouillon', 'a_signer', 'signe', 'clos', 'annule'));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'prevention_plans_status_check', n); END IF;
  SELECT count(*) INTO n FROM "prevention_plans" WHERE NOT (("prevention_plans"."status" = 'annule') = ("prevention_plans"."cancelled_at" is not null));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'prevention_plans_cancel_status_check', n); END IF;
  SELECT count(*) INTO n FROM "qhse_objectives" WHERE NOT (("qhse_objectives"."archived_at" is null and "qhse_objectives"."archived_by_id" is null and "qhse_objectives"."archive_reason" is null) or ("qhse_objectives"."archived_at" is not null and "qhse_objectives"."archive_reason" is not null and btrim("qhse_objectives"."archive_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'qhse_objectives_archive_check', n); END IF;
  SELECT count(*) INTO n FROM "qualifications" WHERE NOT (("qualifications"."cancelled_at" is null and "qualifications"."cancelled_by_id" is null and "qualifications"."cancel_reason" is null) or ("qualifications"."cancelled_at" is not null and "qualifications"."cancel_reason" is not null and btrim("qualifications"."cancel_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'qualifications_cancel_check', n); END IF;
  SELECT count(*) INTO n FROM "requirement_evaluations" WHERE NOT ("requirement_evaluations"."evaluation" in ('conforme', 'ecart', 'analyse', 'a_evaluer'));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'requirement_evaluations_evaluation_check', n); END IF;
  SELECT count(*) INTO n FROM "requirements" WHERE NOT (("requirements"."archived_at" is null and "requirements"."archived_by_id" is null and "requirements"."archive_reason" is null) or ("requirements"."archived_at" is not null and "requirements"."archive_reason" is not null and btrim("requirements"."archive_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'requirements_archive_check', n); END IF;
  SELECT count(*) INTO n FROM "requirements" WHERE NOT ("requirements"."evaluation" in ('conforme', 'ecart', 'analyse', 'a_evaluer'));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'requirements_evaluation_check', n); END IF;
  SELECT count(*) INTO n FROM "requirements" WHERE NOT ("requirements"."linked_to" is null or "requirements"."linked_to" in ('duerp', 'prevention', 'waste_register', 'waste_bsd'));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'requirements_linked_to_check', n); END IF;
  SELECT count(*) INTO n FROM "review_decisions" WHERE NOT ("review_decisions"."kind" in ('decision', 'objectif', 'ressource'));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'review_decisions_kind_check', n); END IF;
  SELECT count(*) INTO n FROM "reviews" WHERE NOT (("reviews"."cancelled_at" is null and "reviews"."cancelled_by_id" is null and "reviews"."cancel_reason" is null) or ("reviews"."cancelled_at" is not null and "reviews"."cancel_reason" is not null and btrim("reviews"."cancel_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'reviews_cancel_check', n); END IF;
  SELECT count(*) INTO n FROM "reviews" WHERE NOT ("reviews"."status" in ('planifiee', 'tenue', 'cloturee', 'annulee'));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'reviews_status_check', n); END IF;
  SELECT count(*) INTO n FROM "reviews" WHERE NOT ("reviews"."kind" in ('ordinaire', 'intermediaire'));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'reviews_kind_check', n); END IF;
  SELECT count(*) INTO n FROM "reviews" WHERE NOT (("reviews"."status" = 'annulee') = ("reviews"."cancelled_at" is not null));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'reviews_cancel_status_check', n); END IF;
  SELECT count(*) INTO n FROM "risks" WHERE NOT (("risks"."archived_at" is null and "risks"."archived_by_id" is null and "risks"."archive_reason" is null) or ("risks"."archived_at" is not null and "risks"."archive_reason" is not null and btrim("risks"."archive_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'risks_archive_check', n); END IF;
  SELECT count(*) INTO n FROM "site_activities" WHERE NOT (("site_activities"."cancelled_at" is null and "site_activities"."cancelled_by_id" is null and "site_activities"."cancel_reason" is null) or ("site_activities"."cancelled_at" is not null and "site_activities"."cancel_reason" is not null and btrim("site_activities"."cancel_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'site_activities_cancel_check', n); END IF;
  SELECT count(*) INTO n FROM "sites" WHERE NOT (("sites"."archived_at" is null and "sites"."archived_by_id" is null and "sites"."archive_reason" is null) or ("sites"."archived_at" is not null and "sites"."archive_reason" is not null and btrim("sites"."archive_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'sites_archive_check', n); END IF;
  SELECT count(*) INTO n FROM "training_titles" WHERE NOT (("training_titles"."archived_at" is null and "training_titles"."archived_by_id" is null and "training_titles"."archive_reason" is null) or ("training_titles"."archived_at" is not null and "training_titles"."archive_reason" is not null and btrim("training_titles"."archive_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'training_titles_archive_check', n); END IF;
  SELECT count(*) INTO n FROM "waste_entries" WHERE NOT (("waste_entries"."cancelled_at" is null and "waste_entries"."cancelled_by_id" is null and "waste_entries"."cancel_reason" is null) or ("waste_entries"."cancelled_at" is not null and "waste_entries"."cancel_reason" is not null and btrim("waste_entries"."cancel_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'waste_entries_cancel_check', n); END IF;
  SELECT count(*) INTO n FROM "waste_entries" WHERE NOT ("waste_entries"."bsd_status" is null or "waste_entries"."bsd_status" in ('brouillon', 'emis', 'collecte', 'traite', 'refuse', 'accepte_partiel'));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'waste_entries_bsd_status_check', n); END IF;
  SELECT count(*) INTO n FROM "waste_streams" WHERE NOT (("waste_streams"."archived_at" is null and "waste_streams"."archived_by_id" is null and "waste_streams"."archive_reason" is null) or ("waste_streams"."archived_at" is not null and "waste_streams"."archive_reason" is not null and btrim("waste_streams"."archive_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'waste_streams_archive_check', n); END IF;
  SELECT count(*) INTO n FROM "work_units" WHERE NOT (("work_units"."archived_at" is null and "work_units"."archived_by_id" is null and "work_units"."archive_reason" is null) or ("work_units"."archived_at" is not null and "work_units"."archive_reason" is not null and btrim("work_units"."archive_reason") <> ''));
  IF n > 0 THEN problems := problems || format(' %s : %s ligne(s) ;', 'work_units_archive_check', n); END IF;
  IF problems <> '' THEN
    RAISE EXCEPTION 'QUA-23 (migration 0017_state_constraints) : données incohérentes à corriger avant les contraintes d''état —%', problems
      USING HINT = 'Lignes en cause : select * from <table> where not (<expression de la contrainte>) — expressions dans drizzle/0017_state_constraints.sql ; rien n''a été modifié (docs/EXPLOITATION.md § 6).';
  END IF;
END
$qua23$;
--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_cancel_check" CHECK (("actions"."cancelled_at" is null and "actions"."cancelled_by_id" is null and "actions"."cancel_reason" is null) or ("actions"."cancelled_at" is not null and "actions"."cancel_reason" is not null and btrim("actions"."cancel_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_cancel_check" CHECK (("audit_findings"."cancelled_at" is null and "audit_findings"."cancelled_by_id" is null and "audit_findings"."cancel_reason" is null) or ("audit_findings"."cancelled_at" is not null and "audit_findings"."cancel_reason" is not null and btrim("audit_findings"."cancel_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_kind_check" CHECK ("audit_findings"."kind" in ('ecart_majeur', 'ecart_mineur', 'observation', 'piste', 'point_fort'));
--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD CONSTRAINT "audit_plan_items_cancel_check" CHECK (("audit_plan_items"."cancelled_at" is null and "audit_plan_items"."cancelled_by_id" is null and "audit_plan_items"."cancel_reason" is null) or ("audit_plan_items"."cancelled_at" is not null and "audit_plan_items"."cancel_reason" is not null and btrim("audit_plan_items"."cancel_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "benign_accidents" ADD CONSTRAINT "benign_accidents_cancel_check" CHECK (("benign_accidents"."cancelled_at" is null and "benign_accidents"."cancelled_by_id" is null and "benign_accidents"."cancel_reason" is null) or ("benign_accidents"."cancelled_at" is not null and "benign_accidents"."cancel_reason" is not null and btrim("benign_accidents"."cancel_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "coactivity_controls" ADD CONSTRAINT "coactivity_controls_cancel_check" CHECK (("coactivity_controls"."cancelled_at" is null and "coactivity_controls"."cancelled_by_id" is null and "coactivity_controls"."cancel_reason" is null) or ("coactivity_controls"."cancelled_at" is not null and "coactivity_controls"."cancel_reason" is not null and btrim("coactivity_controls"."cancel_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "context_items" ADD CONSTRAINT "context_items_archive_check" CHECK (("context_items"."archived_at" is null and "context_items"."archived_by_id" is null and "context_items"."archive_reason" is null) or ("context_items"."archived_at" is not null and "context_items"."archive_reason" is not null and btrim("context_items"."archive_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_archive_check" CHECK (("contractors"."archived_at" is null and "contractors"."archived_by_id" is null and "contractors"."archive_reason" is null) or ("contractors"."archived_at" is not null and "contractors"."archive_reason" is not null and btrim("contractors"."archive_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "control_records" ADD CONSTRAINT "control_records_cancel_check" CHECK (("control_records"."cancelled_at" is null and "control_records"."cancelled_by_id" is null and "control_records"."cancel_reason" is null) or ("control_records"."cancelled_at" is not null and "control_records"."cancel_reason" is not null and btrim("control_records"."cancel_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "controls" ADD CONSTRAINT "controls_archive_check" CHECK (("controls"."archived_at" is null and "controls"."archived_by_id" is null and "controls"."archive_reason" is null) or ("controls"."archived_at" is not null and "controls"."archive_reason" is not null and btrim("controls"."archive_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_status_check" CHECK ("document_versions"."status" in ('brouillon', 'en_revue', 'approuve', 'archive'));
--> statement-breakpoint
ALTER TABLE "duerp_access_requests" ADD CONSTRAINT "duerp_access_requests_cancel_check" CHECK (("duerp_access_requests"."cancelled_at" is null and "duerp_access_requests"."cancelled_by_id" is null and "duerp_access_requests"."cancel_reason" is null) or ("duerp_access_requests"."cancelled_at" is not null and "duerp_access_requests"."cancel_reason" is not null and btrim("duerp_access_requests"."cancel_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "event_steps" ADD CONSTRAINT "event_steps_kind_check" CHECK ("event_steps"."kind" in ('advance', 'revert', 'reopen', 'dismiss', 'restore'));
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_dismiss_check" CHECK (("events"."dismissed_at" is null and "events"."dismissed_by_id" is null and "events"."dismiss_reason" is null) or ("events"."dismissed_at" is not null and "events"."dismiss_reason" is not null and btrim("events"."dismiss_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_type_check" CHECK ("events"."type" in ('AT', 'PA', 'SD', 'NC', 'RC', 'ENV', 'MP'));
--> statement-breakpoint
ALTER TABLE "map_zones" ADD CONSTRAINT "map_zones_archive_check" CHECK (("map_zones"."archived_at" is null and "map_zones"."archived_by_id" is null and "map_zones"."archive_reason" is null) or ("map_zones"."archived_at" is not null and "map_zones"."archive_reason" is not null and btrim("map_zones"."archive_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_status_check" CHECK ("permits"."status" in ('demande', 'delivre', 'clos', 'annule'));
--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_type_check" CHECK ("permits"."type" in ('feu', 'essai'));
--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_cancel_check" CHECK (("permits"."status" = 'annule') = ("permits"."cancel_reason" is not null and btrim("permits"."cancel_reason") <> '') and ("permits"."status" = 'annule' or "permits"."cancelled_by_id" is null));
--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD CONSTRAINT "prevention_plans_cancel_check" CHECK (("prevention_plans"."cancelled_at" is null and "prevention_plans"."cancelled_by_id" is null and "prevention_plans"."cancel_reason" is null) or ("prevention_plans"."cancelled_at" is not null and "prevention_plans"."cancel_reason" is not null and btrim("prevention_plans"."cancel_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD CONSTRAINT "prevention_plans_status_check" CHECK ("prevention_plans"."status" in ('brouillon', 'a_signer', 'signe', 'clos', 'annule'));
--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD CONSTRAINT "prevention_plans_cancel_status_check" CHECK (("prevention_plans"."status" = 'annule') = ("prevention_plans"."cancelled_at" is not null));
--> statement-breakpoint
ALTER TABLE "qhse_objectives" ADD CONSTRAINT "qhse_objectives_archive_check" CHECK (("qhse_objectives"."archived_at" is null and "qhse_objectives"."archived_by_id" is null and "qhse_objectives"."archive_reason" is null) or ("qhse_objectives"."archived_at" is not null and "qhse_objectives"."archive_reason" is not null and btrim("qhse_objectives"."archive_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_cancel_check" CHECK (("qualifications"."cancelled_at" is null and "qualifications"."cancelled_by_id" is null and "qualifications"."cancel_reason" is null) or ("qualifications"."cancelled_at" is not null and "qualifications"."cancel_reason" is not null and btrim("qualifications"."cancel_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "requirement_evaluations" ADD CONSTRAINT "requirement_evaluations_evaluation_check" CHECK ("requirement_evaluations"."evaluation" in ('conforme', 'ecart', 'analyse', 'a_evaluer'));
--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_archive_check" CHECK (("requirements"."archived_at" is null and "requirements"."archived_by_id" is null and "requirements"."archive_reason" is null) or ("requirements"."archived_at" is not null and "requirements"."archive_reason" is not null and btrim("requirements"."archive_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_evaluation_check" CHECK ("requirements"."evaluation" in ('conforme', 'ecart', 'analyse', 'a_evaluer'));
--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_linked_to_check" CHECK ("requirements"."linked_to" is null or "requirements"."linked_to" in ('duerp', 'prevention', 'waste_register', 'waste_bsd'));
--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_kind_check" CHECK ("review_decisions"."kind" in ('decision', 'objectif', 'ressource'));
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_cancel_check" CHECK (("reviews"."cancelled_at" is null and "reviews"."cancelled_by_id" is null and "reviews"."cancel_reason" is null) or ("reviews"."cancelled_at" is not null and "reviews"."cancel_reason" is not null and btrim("reviews"."cancel_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_status_check" CHECK ("reviews"."status" in ('planifiee', 'tenue', 'cloturee', 'annulee'));
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_kind_check" CHECK ("reviews"."kind" in ('ordinaire', 'intermediaire'));
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_cancel_status_check" CHECK (("reviews"."status" = 'annulee') = ("reviews"."cancelled_at" is not null));
--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_archive_check" CHECK (("risks"."archived_at" is null and "risks"."archived_by_id" is null and "risks"."archive_reason" is null) or ("risks"."archived_at" is not null and "risks"."archive_reason" is not null and btrim("risks"."archive_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "site_activities" ADD CONSTRAINT "site_activities_cancel_check" CHECK (("site_activities"."cancelled_at" is null and "site_activities"."cancelled_by_id" is null and "site_activities"."cancel_reason" is null) or ("site_activities"."cancelled_at" is not null and "site_activities"."cancel_reason" is not null and btrim("site_activities"."cancel_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_archive_check" CHECK (("sites"."archived_at" is null and "sites"."archived_by_id" is null and "sites"."archive_reason" is null) or ("sites"."archived_at" is not null and "sites"."archive_reason" is not null and btrim("sites"."archive_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "training_titles" ADD CONSTRAINT "training_titles_archive_check" CHECK (("training_titles"."archived_at" is null and "training_titles"."archived_by_id" is null and "training_titles"."archive_reason" is null) or ("training_titles"."archived_at" is not null and "training_titles"."archive_reason" is not null and btrim("training_titles"."archive_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_cancel_check" CHECK (("waste_entries"."cancelled_at" is null and "waste_entries"."cancelled_by_id" is null and "waste_entries"."cancel_reason" is null) or ("waste_entries"."cancelled_at" is not null and "waste_entries"."cancel_reason" is not null and btrim("waste_entries"."cancel_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_bsd_status_check" CHECK ("waste_entries"."bsd_status" is null or "waste_entries"."bsd_status" in ('brouillon', 'emis', 'collecte', 'traite', 'refuse', 'accepte_partiel'));
--> statement-breakpoint
ALTER TABLE "waste_streams" ADD CONSTRAINT "waste_streams_archive_check" CHECK (("waste_streams"."archived_at" is null and "waste_streams"."archived_by_id" is null and "waste_streams"."archive_reason" is null) or ("waste_streams"."archived_at" is not null and "waste_streams"."archive_reason" is not null and btrim("waste_streams"."archive_reason") <> ''));
--> statement-breakpoint
ALTER TABLE "work_units" ADD CONSTRAINT "work_units_archive_check" CHECK (("work_units"."archived_at" is null and "work_units"."archived_by_id" is null and "work_units"."archive_reason" is null) or ("work_units"."archived_at" is not null and "work_units"."archive_reason" is not null and btrim("work_units"."archive_reason") <> ''));