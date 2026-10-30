CREATE TABLE "prevention_plan_meetings" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"kind" text NOT NULL,
	"held_on" date NOT NULL,
	"participants" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"recorded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"cancel_reason" text,
	CONSTRAINT "prevention_plan_meetings_kind_check" CHECK ("prevention_plan_meetings"."kind" in ('inspection', 'reunion')),
	CONSTRAINT "prevention_plan_meetings_cancel_check" CHECK (("prevention_plan_meetings"."cancelled_at" is null and "prevention_plan_meetings"."cancelled_by_id" is null and "prevention_plan_meetings"."cancel_reason" is null) or ("prevention_plan_meetings"."cancelled_at" is not null and "prevention_plan_meetings"."cancel_reason" is not null and btrim("prevention_plan_meetings"."cancel_reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "risk_measure_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"risk_id" integer NOT NULL,
	"kind" text NOT NULL,
	"control_id" integer,
	"document_id" text,
	"title_id" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by_id" text,
	"remove_reason" text,
	CONSTRAINT "risk_measure_links_kind_check" CHECK ("risk_measure_links"."kind" in ('control', 'document', 'title')),
	CONSTRAINT "risk_measure_links_target_check" CHECK (("risk_measure_links"."kind" = 'control') = ("risk_measure_links"."control_id" is not null) and ("risk_measure_links"."kind" = 'document') = ("risk_measure_links"."document_id" is not null) and ("risk_measure_links"."kind" = 'title') = ("risk_measure_links"."title_id" is not null)),
	CONSTRAINT "risk_measure_links_remove_check" CHECK (("risk_measure_links"."removed_at" is null and "risk_measure_links"."removed_by_id" is null and "risk_measure_links"."remove_reason" is null) or ("risk_measure_links"."removed_at" is not null and "risk_measure_links"."remove_reason" is not null and btrim("risk_measure_links"."remove_reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "safety_notices" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"kind" text NOT NULL,
	"received_on" date NOT NULL,
	"authority" text NOT NULL,
	"reference" text,
	"text" text NOT NULL,
	"due_on" date,
	"control_id" integer,
	"answered_on" date,
	"answer" text,
	"answered_by_id" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"cancel_reason" text,
	CONSTRAINT "safety_notices_kind_check" CHECK ("safety_notices"."kind" in ('observation', 'mise_en_demeure')),
	CONSTRAINT "safety_notices_answer_check" CHECK (("safety_notices"."answered_on" is null) = ("safety_notices"."answer" is null)),
	CONSTRAINT "safety_notices_cancel_check" CHECK (("safety_notices"."cancelled_at" is null and "safety_notices"."cancelled_by_id" is null and "safety_notices"."cancel_reason" is null) or ("safety_notices"."cancelled_at" is not null and "safety_notices"."cancel_reason" is not null and btrim("safety_notices"."cancel_reason") <> ''))
);
--> statement-breakpoint
ALTER TABLE "requirements" DROP CONSTRAINT "requirements_linked_to_check";--> statement-breakpoint
ALTER TABLE "control_records" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "controls" ADD COLUMN "category" text DEFAULT 'reglementaire' NOT NULL;--> statement-breakpoint
ALTER TABLE "controls" ADD COLUMN "tolerance" text;--> statement-breakpoint
ALTER TABLE "map_zones" ADD COLUMN "work_unit_id" text;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "meeting_period_days" integer;--> statement-breakpoint
ALTER TABLE "qualifications" ADD COLUMN "effectiveness" text;--> statement-breakpoint
ALTER TABLE "qualifications" ADD COLUMN "effectiveness_on" date;--> statement-breakpoint
ALTER TABLE "qualifications" ADD COLUMN "effectiveness_note" text;--> statement-breakpoint
ALTER TABLE "qualifications" ADD COLUMN "effectiveness_by_id" text;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "review_months" integer;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "certification_id" text;--> statement-breakpoint
ALTER TABLE "training_titles" ADD COLUMN "awareness" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_plan_meetings" ADD CONSTRAINT "prevention_plan_meetings_plan_id_prevention_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."prevention_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_plan_meetings" ADD CONSTRAINT "prevention_plan_meetings_recorded_by_id_people_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_plan_meetings" ADD CONSTRAINT "prevention_plan_meetings_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_measure_links" ADD CONSTRAINT "risk_measure_links_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_measure_links" ADD CONSTRAINT "risk_measure_links_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_measure_links" ADD CONSTRAINT "risk_measure_links_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_measure_links" ADD CONSTRAINT "risk_measure_links_title_id_training_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."training_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_measure_links" ADD CONSTRAINT "risk_measure_links_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_measure_links" ADD CONSTRAINT "risk_measure_links_removed_by_id_people_id_fk" FOREIGN KEY ("removed_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_notices" ADD CONSTRAINT "safety_notices_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_notices" ADD CONSTRAINT "safety_notices_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_notices" ADD CONSTRAINT "safety_notices_answered_by_id_people_id_fk" FOREIGN KEY ("answered_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_notices" ADD CONSTRAINT "safety_notices_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_notices" ADD CONSTRAINT "safety_notices_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_plan_meetings_plan_idx" ON "prevention_plan_meetings" USING btree ("plan_id","held_on");--> statement-breakpoint
CREATE INDEX "risk_measure_links_risk_idx" ON "risk_measure_links" USING btree ("risk_id");--> statement-breakpoint
CREATE UNIQUE INDEX "risk_measure_links_control_active" ON "risk_measure_links" USING btree ("risk_id","control_id") WHERE "risk_measure_links"."removed_at" is null and "risk_measure_links"."control_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "risk_measure_links_document_active" ON "risk_measure_links" USING btree ("risk_id","document_id") WHERE "risk_measure_links"."removed_at" is null and "risk_measure_links"."document_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "risk_measure_links_title_active" ON "risk_measure_links" USING btree ("risk_id","title_id") WHERE "risk_measure_links"."removed_at" is null and "risk_measure_links"."title_id" is not null;--> statement-breakpoint
CREATE INDEX "safety_notices_site_idx" ON "safety_notices" USING btree ("site_id","received_on");--> statement-breakpoint
ALTER TABLE "control_records" ADD CONSTRAINT "control_records_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_zones" ADD CONSTRAINT "map_zones_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "public"."work_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_effectiveness_by_id_people_id_fk" FOREIGN KEY ("effectiveness_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_certification_id_certifications_id_fk" FOREIGN KEY ("certification_id") REFERENCES "public"."certifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controls" ADD CONSTRAINT "controls_category_check" CHECK ("controls"."category" in ('reglementaire', 'metrologie'));--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD CONSTRAINT "prevention_plans_meeting_period_check" CHECK ("prevention_plans"."meeting_period_days" is null or "prevention_plans"."meeting_period_days" between 1 and 365);--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_effectiveness_check" CHECK (("qualifications"."effectiveness" is null and "qualifications"."effectiveness_on" is null) or ("qualifications"."effectiveness" in ('efficace', 'partielle', 'non_efficace') and "qualifications"."effectiveness_on" is not null));--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_review_months_check" CHECK ("requirements"."review_months" is null or "requirements"."review_months" between 1 and 60);--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_certification_check" CHECK (("requirements"."certification_id" is null) = ("requirements"."linked_to" is null or "requirements"."linked_to" <> 'certification'));--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_linked_to_check" CHECK ("requirements"."linked_to" is null or "requirements"."linked_to" in ('duerp', 'prevention', 'waste_register', 'waste_bsd', 'certification'));