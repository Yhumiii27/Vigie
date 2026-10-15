CREATE TABLE "change_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"reason" text,
	"details" jsonb,
	"by_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"kind" text NOT NULL,
	"from_step" integer NOT NULL,
	"to_step" integer NOT NULL,
	"reason" text,
	"by_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_reads" (
	"person_id" text NOT NULL,
	"item_key" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_reads_person_id_item_key_pk" PRIMARY KEY("person_id","item_key")
);
--> statement-breakpoint
CREATE TABLE "requirement_evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"requirement_id" integer NOT NULL,
	"evaluated_on" date NOT NULL,
	"evaluation" text NOT NULL,
	"note" text,
	"evaluated_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_id" integer NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"pilot_id" text,
	"due_on" date,
	"action_id" text,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_on" date NOT NULL,
	"kind" text DEFAULT 'ordinaire' NOT NULL,
	"status" text DEFAULT 'planifiee' NOT NULL,
	"participant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_participants" text,
	"customer_perception" text,
	"resource_needs" text,
	"minutes" text,
	"next_review_on" date,
	"recorded_by_id" text,
	"closed_on" date,
	"closed_by_id" text,
	"snapshot" jsonb,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qualifications" DROP CONSTRAINT "qualifications_person_id_title_id_pk";--> statement-breakpoint
ALTER TABLE "certifications" ALTER COLUMN "status" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "review_items" ALTER COLUMN "owner" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "review_id" integer;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "cancelled_by_id" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD COLUMN "plan_item_id" integer;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD COLUMN "clause" text;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD COLUMN "found_on" date;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD COLUMN "cancelled_by_id" text;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD COLUMN "done_on" date;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD COLUMN "auditor" text;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD COLUMN "certification_id" text;--> statement-breakpoint
ALTER TABLE "certifications" ADD COLUMN "organization" text;--> statement-breakpoint
ALTER TABLE "certifications" ADD COLUMN "issued_on" date;--> statement-breakpoint
ALTER TABLE "certifications" ADD COLUMN "valid_until" date;--> statement-breakpoint
ALTER TABLE "contractors" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contractors" ADD COLUMN "archived_by_id" text;--> statement-breakpoint
ALTER TABLE "contractors" ADD COLUMN "archive_reason" text;--> statement-breakpoint
ALTER TABLE "control_records" ADD COLUMN "prev_last_on" date;--> statement-breakpoint
ALTER TABLE "control_records" ADD COLUMN "prev_next_on" date;--> statement-breakpoint
ALTER TABLE "control_records" ADD COLUMN "prev_reserves" text;--> statement-breakpoint
ALTER TABLE "control_records" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "control_records" ADD COLUMN "cancelled_by_id" text;--> statement-breakpoint
ALTER TABLE "control_records" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "controls" ADD COLUMN "requirement_id" integer;--> statement-breakpoint
ALTER TABLE "controls" ADD COLUMN "action_id" text;--> statement-breakpoint
ALTER TABLE "controls" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "controls" ADD COLUMN "archived_by_id" text;--> statement-breakpoint
ALTER TABLE "controls" ADD COLUMN "archive_reason" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "declarant_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cpam_declared_on" date;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "control_id" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "risk_id" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "document_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "prevention_plan_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "permit_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "dismissed_by_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "dismiss_reason" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "service" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "left_on" date;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "left_reason" text;--> statement-breakpoint
ALTER TABLE "permits" ADD COLUMN "cancelled_by_id" text;--> statement-breakpoint
ALTER TABLE "permits" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "cancelled_by_id" text;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "qualifications" ADD COLUMN "id" serial PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "qualifications" ADD COLUMN "recorded_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "qualifications" ADD COLUMN "recorded_by_id" text;--> statement-breakpoint
ALTER TABLE "qualifications" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "qualifications" ADD COLUMN "cancelled_by_id" text;--> statement-breakpoint
ALTER TABLE "qualifications" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "affects_projects" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "linked_to" text;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "archived_by_id" text;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "archive_reason" text;--> statement-breakpoint
ALTER TABLE "review_items" ADD COLUMN "review_id" integer;--> statement-breakpoint
ALTER TABLE "review_items" ADD COLUMN "source" text DEFAULT 'manuel' NOT NULL;--> statement-breakpoint
ALTER TABLE "review_items" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "review_items" ADD COLUMN "due_on" date;--> statement-breakpoint
ALTER TABLE "risks" ADD COLUMN "residual_reviewed_on" date;--> statement-breakpoint
ALTER TABLE "risks" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "risks" ADD COLUMN "archived_by_id" text;--> statement-breakpoint
ALTER TABLE "risks" ADD COLUMN "archive_reason" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "archived_by_id" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "archive_reason" text;--> statement-breakpoint
ALTER TABLE "training_titles" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "training_titles" ADD COLUMN "archived_by_id" text;--> statement-breakpoint
ALTER TABLE "training_titles" ADD COLUMN "archive_reason" text;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD COLUMN "cancelled_by_id" text;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "work_units" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_units" ADD COLUMN "archived_by_id" text;--> statement-breakpoint
ALTER TABLE "work_units" ADD COLUMN "archive_reason" text;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_by_id_people_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_steps" ADD CONSTRAINT "event_steps_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_steps" ADD CONSTRAINT "event_steps_by_id_people_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_evaluations" ADD CONSTRAINT "requirement_evaluations_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_evaluations" ADD CONSTRAINT "requirement_evaluations_evaluated_by_id_people_id_fk" FOREIGN KEY ("evaluated_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_pilot_id_people_id_fk" FOREIGN KEY ("pilot_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_recorded_by_id_people_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_closed_by_id_people_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_log_entity_idx" ON "change_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_plan_item_id_audit_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."audit_plan_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD CONSTRAINT "audit_plan_items_certification_id_certifications_id_fk" FOREIGN KEY ("certification_id") REFERENCES "public"."certifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_archived_by_id_people_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_records" ADD CONSTRAINT "control_records_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controls" ADD CONSTRAINT "controls_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controls" ADD CONSTRAINT "controls_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controls" ADD CONSTRAINT "controls_archived_by_id_people_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_declarant_id_people_id_fk" FOREIGN KEY ("declarant_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_prevention_plan_id_prevention_plans_id_fk" FOREIGN KEY ("prevention_plan_id") REFERENCES "public"."prevention_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_permit_id_permits_id_fk" FOREIGN KEY ("permit_id") REFERENCES "public"."permits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_dismissed_by_id_people_id_fk" FOREIGN KEY ("dismissed_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD CONSTRAINT "prevention_plans_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_recorded_by_id_people_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_archived_by_id_people_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_archived_by_id_people_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_archived_by_id_people_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_titles" ADD CONSTRAINT "training_titles_archived_by_id_people_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_units" ADD CONSTRAINT "work_units_archived_by_id_people_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qualifications_person_title_idx" ON "qualifications" USING btree ("person_id","title_id");--> statement-breakpoint
-- Reprise des déclarants nominatifs (« Mes signalements », vue Salarié) : rapprochement par nom, homonymes exclus.
UPDATE "events" e SET "declarant_id" = p."id" FROM "people" p WHERE e."declarant_id" IS NULL AND NOT e."anonymous" AND e."declarant" = p."name" AND (SELECT count(*) FROM "people" h WHERE h."name" = p."name") = 1;--> statement-breakpoint
-- Reprise des check-lists de revue existantes : une revue par date (bases de développement antérieures).
INSERT INTO "reviews" ("review_on", "kind", "status") SELECT DISTINCT "review_on", 'ordinaire', CASE WHEN "review_on" < CURRENT_DATE THEN 'tenue' ELSE 'planifiee' END FROM "review_items";--> statement-breakpoint
UPDATE "review_items" i SET "review_id" = r."id" FROM "reviews" r WHERE r."review_on" = i."review_on";--> statement-breakpoint
-- Reprise des actions d'origine « Revue de direction » : la référence cite la date de la revue (« 10/12/2025 », ou « 10/12 » sans année) ; rattachement seulement si une seule revue correspond.
UPDATE "actions" a SET "review_id" = m."review_id" FROM (SELECT x."id" AS "action_id", min(r."id") AS "review_id" FROM "actions" x JOIN "reviews" r ON x."origin_ref" LIKE '%' || to_char(r."review_on", 'DD/MM/YYYY') || '%' OR (x."origin_ref" !~ '[0-9]{2}/[0-9]{2}/[0-9]{4}' AND x."origin_ref" LIKE '%' || to_char(r."review_on", 'DD/MM') || '%') WHERE x."origin" = 'rev' AND x."review_id" IS NULL GROUP BY x."id" HAVING count(*) = 1) m WHERE a."id" = m."action_id";--> statement-breakpoint
ALTER TABLE "review_items" ALTER COLUMN "review_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "review_items" DROP COLUMN "review_on";
