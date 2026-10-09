CREATE TABLE "actions" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"origin" text NOT NULL,
	"origin_ref" text NOT NULL,
	"event_id" text,
	"site_id" text,
	"pilot_id" text NOT NULL,
	"due_on" date NOT NULL,
	"status" text NOT NULL,
	"kind" text NOT NULL,
	"verify_due_on" date,
	"efficacy_note" text,
	"verified_by_id" text,
	"closed_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_path" text NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"audit" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"action_id" text,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_plan_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"track" text NOT NULL,
	"month" integer NOT NULL,
	"label" text NOT NULL,
	"planned_on" date,
	"detail" text,
	"owner_id" text,
	"action_id" text,
	"done" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certifications" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"standard" text NOT NULL,
	"status" text NOT NULL,
	"tone" text NOT NULL,
	"note" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consumptions" (
	"site_id" text NOT NULL,
	"month" date NOT NULL,
	"kind" text NOT NULL,
	"value" numeric(12, 2) NOT NULL,
	CONSTRAINT "consumptions_site_id_month_kind_pk" PRIMARY KEY("site_id","month","kind")
);
--> statement-breakpoint
CREATE TABLE "contractors" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trade" text NOT NULL,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text
);
--> statement-breakpoint
CREATE TABLE "control_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"control_id" integer NOT NULL,
	"performed_on" date NOT NULL,
	"organization" text NOT NULL,
	"reserves" text,
	"notes" text,
	"recorded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "controls" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" text,
	"equipment" text NOT NULL,
	"control_type" text NOT NULL,
	"period_months" integer NOT NULL,
	"organization" text NOT NULL,
	"responsible_id" text,
	"last_on" date NOT NULL,
	"next_on" date NOT NULL,
	"reserves" text,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"version" text NOT NULL,
	"status" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"author_id" text,
	"approver_id" text,
	"submitted_on" date,
	"approved_on" date,
	"action_id" text
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"process" text NOT NULL,
	"owner_id" text NOT NULL,
	"review_months" integer DEFAULT 36 NOT NULL,
	"distribution" text DEFAULT '' NOT NULL,
	"site_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duerp_versions" (
	"version" text PRIMARY KEY NOT NULL,
	"current" boolean DEFAULT false NOT NULL,
	"updated_on" date NOT NULL,
	"next_update_on" date NOT NULL,
	"retention" text NOT NULL,
	"validated_by_id" text,
	"cse_consulted_on" date,
	"archived_on" date,
	"comment" text,
	"snapshot" jsonb
);
--> statement-breakpoint
CREATE TABLE "event_analyses" (
	"event_id" text NOT NULL,
	"method" text NOT NULL,
	"content" jsonb NOT NULL,
	CONSTRAINT "event_analyses_event_id_method_pk" PRIMARY KEY("event_id","method")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"occurred_on" date NOT NULL,
	"location" text NOT NULL,
	"declarant" text,
	"anonymous" boolean DEFAULT false NOT NULL,
	"keystone_project" text,
	"equipment" text,
	"pilot_id" text,
	"severity" integer NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"immediate_measures" text DEFAULT '' NOT NULL,
	"analysis_method" text DEFAULT '5m' NOT NULL,
	"nc_origin" text,
	"injury" text,
	"lost_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hours_worked" (
	"month" date NOT NULL,
	"site_id" text NOT NULL,
	"hours" integer NOT NULL,
	CONSTRAINT "hours_worked_month_site_id_pk" PRIMARY KEY("month","site_id")
);
--> statement-breakpoint
CREATE TABLE "keystone_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"project" text NOT NULL,
	"activity" text NOT NULL,
	"start_on" date NOT NULL,
	"end_on" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keystone_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"client" text NOT NULL,
	"title" text NOT NULL,
	"delivery_on" date
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"job" text DEFAULT '' NOT NULL,
	"site_id" text,
	"in_skills_matrix" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permits" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"site_id" text NOT NULL,
	"location" text NOT NULL,
	"description" text NOT NULL,
	"contractor_id" text,
	"performer" text NOT NULL,
	"issuer_id" text,
	"prevention_plan_id" text,
	"keystone_project" text,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"watch_until" timestamp with time zone,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "prevention_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"contractor_id" text NOT NULL,
	"title" text NOT NULL,
	"location" text NOT NULL,
	"start_on" date NOT NULL,
	"end_on" date NOT NULL,
	"estimated_hours" integer NOT NULL,
	"dangerous_work" boolean DEFAULT false NOT NULL,
	"keystone_project" text,
	"inspection_on" date,
	"interference_risks" text DEFAULT '' NOT NULL,
	"measures" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"signed_eu_on" date,
	"signed_ee_on" date,
	"owner_id" text
);
--> statement-breakpoint
CREATE TABLE "qualification_requirements" (
	"person_id" text NOT NULL,
	"title_id" text NOT NULL,
	"renewal_action_id" text,
	CONSTRAINT "qualification_requirements_person_id_title_id_pk" PRIMARY KEY("person_id","title_id")
);
--> statement-breakpoint
CREATE TABLE "qualifications" (
	"person_id" text NOT NULL,
	"title_id" text NOT NULL,
	"obtained_on" date NOT NULL,
	"expires_on" date,
	"provider" text,
	CONSTRAINT "qualifications_person_id_title_id_pk" PRIMARY KEY("person_id","title_id")
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" serial PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"domain" text NOT NULL,
	"summary" text NOT NULL,
	"impact" text,
	"due_on" date,
	"due_note" text,
	"evaluation" text NOT NULL,
	"evaluation_note" text,
	"last_evaluated_on" date,
	"pilot_id" text,
	"featured" boolean DEFAULT false NOT NULL,
	"keystone_projects" integer,
	"action_id" text,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_on" date NOT NULL,
	"label" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"owner" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_actions" (
	"risk_id" integer NOT NULL,
	"action_id" text NOT NULL,
	CONSTRAINT "risk_actions_risk_id_action_id_pk" PRIMARY KEY("risk_id","action_id")
);
--> statement-breakpoint
CREATE TABLE "risks" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_id" text NOT NULL,
	"hazard" text NOT NULL,
	"situation" text NOT NULL,
	"gravity" integer NOT NULL,
	"probability" integer NOT NULL,
	"existing_measures" text NOT NULL,
	"residual_gravity" integer NOT NULL,
	"residual_probability" integer NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_titles" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"validity_months" integer DEFAULT 0 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waste_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"stream_id" text NOT NULL,
	"removed_on" date NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"ewc_code" text,
	"treatment_code" text,
	"destination" text,
	"bsd_number" text,
	"bsd_status" text,
	"transporter" text NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "waste_streams" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"label" text NOT NULL,
	"ewc_code" text NOT NULL,
	"hazardous" boolean DEFAULT false NOT NULL,
	"unit" text DEFAULT 'kg' NOT NULL,
	"treatment_code" text NOT NULL,
	"channel" text NOT NULL,
	"collector" text NOT NULL,
	"destination" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_units" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"site_id" text,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_pilot_id_people_id_fk" FOREIGN KEY ("pilot_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_verified_by_id_people_id_fk" FOREIGN KEY ("verified_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD CONSTRAINT "audit_plan_items_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD CONSTRAINT "audit_plan_items_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumptions" ADD CONSTRAINT "consumptions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_records" ADD CONSTRAINT "control_records_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_records" ADD CONSTRAINT "control_records_recorded_by_id_people_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controls" ADD CONSTRAINT "controls_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controls" ADD CONSTRAINT "controls_responsible_id_people_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_author_id_people_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_approver_id_people_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duerp_versions" ADD CONSTRAINT "duerp_versions_validated_by_id_people_id_fk" FOREIGN KEY ("validated_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_analyses" ADD CONSTRAINT "event_analyses_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_pilot_id_people_id_fk" FOREIGN KEY ("pilot_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hours_worked" ADD CONSTRAINT "hours_worked_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keystone_assignments" ADD CONSTRAINT "keystone_assignments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_issuer_id_people_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_prevention_plan_id_prevention_plans_id_fk" FOREIGN KEY ("prevention_plan_id") REFERENCES "public"."prevention_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD CONSTRAINT "prevention_plans_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD CONSTRAINT "prevention_plans_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD CONSTRAINT "prevention_plans_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_requirements" ADD CONSTRAINT "qualification_requirements_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_requirements" ADD CONSTRAINT "qualification_requirements_title_id_training_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."training_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_requirements" ADD CONSTRAINT "qualification_requirements_renewal_action_id_actions_id_fk" FOREIGN KEY ("renewal_action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_title_id_training_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."training_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_pilot_id_people_id_fk" FOREIGN KEY ("pilot_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_actions" ADD CONSTRAINT "risk_actions_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_actions" ADD CONSTRAINT "risk_actions_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_unit_id_work_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."work_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_stream_id_waste_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."waste_streams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_streams" ADD CONSTRAINT "waste_streams_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_units" ADD CONSTRAINT "work_units_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;