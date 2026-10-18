CREATE TABLE "context_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"treatment" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_id" text,
	"archive_reason" text
);
--> statement-breakpoint
CREATE TABLE "qhse_objectives" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"label" text NOT NULL,
	"indicator" text NOT NULL,
	"target" numeric(12, 2) NOT NULL,
	"site_id" text,
	"pilot_id" text,
	"review_decision_id" integer,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_id" text,
	"archive_reason" text,
	CONSTRAINT "qhse_objectives_target_check" CHECK ("qhse_objectives"."target" >= 0)
);
--> statement-breakpoint
ALTER TABLE "audit_findings" ADD COLUMN "response_due_on" date;--> statement-breakpoint
ALTER TABLE "certifications" ADD COLUMN "suspended_on" date;--> statement-breakpoint
ALTER TABLE "certifications" ADD COLUMN "suspended_by_id" text;--> statement-breakpoint
ALTER TABLE "certifications" ADD COLUMN "suspend_reason" text;--> statement-breakpoint
ALTER TABLE "control_records" ADD COLUMN "result" text;--> statement-breakpoint
ALTER TABLE "duerp_versions" ADD COLUMN "spst_sent_on" date;--> statement-breakpoint
ALTER TABLE "duerp_versions" ADD COLUMN "portal_deposited_on" date;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "commute" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "mp_table" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "mp_disease" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "mp_certificate_on" date;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "mp_informed_on" date;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "mp_questionnaire_received_on" date;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "mp_questionnaire_returned_on" date;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "nc_disposition" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "nc_quantity" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "nc_cost" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "nc_disposition_note" text;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "signed_eu_name" text;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "signed_eu_quality" text;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "signed_ee_name" text;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "signed_ee_quality" text;--> statement-breakpoint
ALTER TABLE "qualifications" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "site_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "legifrance_url" text;--> statement-breakpoint
ALTER TABLE "training_titles" ADD COLUMN "prerequisite_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "training_titles" ADD COLUMN "scope_label" text;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD COLUMN "bsd_refused_quantity" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "waste_entries" ADD COLUMN "bsd_refusal_reason" text;--> statement-breakpoint
ALTER TABLE "context_items" ADD CONSTRAINT "context_items_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_items" ADD CONSTRAINT "context_items_archived_by_id_people_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qhse_objectives" ADD CONSTRAINT "qhse_objectives_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qhse_objectives" ADD CONSTRAINT "qhse_objectives_pilot_id_people_id_fk" FOREIGN KEY ("pilot_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qhse_objectives" ADD CONSTRAINT "qhse_objectives_review_decision_id_review_decisions_id_fk" FOREIGN KEY ("review_decision_id") REFERENCES "public"."review_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qhse_objectives" ADD CONSTRAINT "qhse_objectives_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qhse_objectives" ADD CONSTRAINT "qhse_objectives_archived_by_id_people_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_suspended_by_id_people_id_fk" FOREIGN KEY ("suspended_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_nc_amounts_check" CHECK (("events"."nc_quantity" is null or "events"."nc_quantity" >= 0) and ("events"."nc_cost" is null or "events"."nc_cost" >= 0));