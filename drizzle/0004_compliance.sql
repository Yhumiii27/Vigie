CREATE TABLE "benign_accidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"number" integer NOT NULL,
	"event_id" text NOT NULL,
	"care_given_at" timestamp with time zone NOT NULL,
	"caregiver_id" text,
	"caregiver_name" text,
	"caregiver_qualification" text NOT NULL,
	"care" text NOT NULL,
	"signed_on" date,
	"escalated_at" timestamp with time zone,
	"escalated_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"cancel_reason" text
);
--> statement-breakpoint
CREATE TABLE "duerp_access_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"requested_on" date NOT NULL,
	"requester_kind" text NOT NULL,
	"requester_name" text NOT NULL,
	"site_id" text,
	"version" text NOT NULL,
	"communicated_on" date,
	"channel" text,
	"note" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"cancel_reason" text
);
--> statement-breakpoint
CREATE TABLE "prevention_program_actions" (
	"year" integer NOT NULL,
	"action_id" text NOT NULL,
	"estimated_cost" numeric(12, 2),
	"resources" text,
	"indicator" text,
	CONSTRAINT "prevention_program_actions_year_action_id_pk" PRIMARY KEY("year","action_id")
);
--> statement-breakpoint
CREATE TABLE "prevention_programs" (
	"year" integer PRIMARY KEY NOT NULL,
	"duerp_version" text NOT NULL,
	"comment" text,
	"cse_consulted_on" date,
	"frozen_at" timestamp with time zone,
	"frozen_by_id" text,
	"snapshot" jsonb,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "prevention_plan_id" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "permit_id" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "document_id" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "waste_stream_id" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "waste_entry_id" integer;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "health" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD COLUMN "review_id" integer;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD COLUMN "postponed_from" date;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD COLUMN "cancelled_by_id" text;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "victim_kind" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "victim_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "victim_name" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "victim_company" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "occurred_time" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "work_schedule" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "known_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "activity" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "circumstances" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "witnesses" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "third_party" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "lesion_nature" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "lesion_site" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "care_given" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "reserves_on" date;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cpam_waived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cpam_waived_by_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cpam_waiver_reason" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "customer" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "customer_ref" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "env_aspect" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "env_medium" text;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "ee_headcount" integer;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "ee_supervisor" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "subcontracting" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "dangerous_phases" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "equipment" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "worker_instructions" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "emergency_organisation" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "coordination" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "sir_posts" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "first_signed_on" date;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "siret" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "alsace_moselle" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "training_titles" ADD COLUMN "first_aid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD COLUMN "pop" boolean;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD COLUMN "qualification" text;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD COLUMN "destination_siret" text;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD COLUMN "destination_address" text;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD COLUMN "transporter_siret" text;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD COLUMN "transporter_address" text;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD COLUMN "transporter_receipt" text;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD COLUMN "pickup_address" text;--> statement-breakpoint
ALTER TABLE "waste_streams" ADD COLUMN "pop" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "waste_streams" ADD COLUMN "qualification" text;--> statement-breakpoint
ALTER TABLE "waste_streams" ADD COLUMN "collector_siret" text;--> statement-breakpoint
ALTER TABLE "waste_streams" ADD COLUMN "collector_address" text;--> statement-breakpoint
ALTER TABLE "waste_streams" ADD COLUMN "collector_receipt" text;--> statement-breakpoint
ALTER TABLE "waste_streams" ADD COLUMN "destination_siret" text;--> statement-breakpoint
ALTER TABLE "waste_streams" ADD COLUMN "destination_address" text;--> statement-breakpoint
ALTER TABLE "benign_accidents" ADD CONSTRAINT "benign_accidents_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benign_accidents" ADD CONSTRAINT "benign_accidents_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benign_accidents" ADD CONSTRAINT "benign_accidents_caregiver_id_people_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benign_accidents" ADD CONSTRAINT "benign_accidents_escalated_by_id_people_id_fk" FOREIGN KEY ("escalated_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benign_accidents" ADD CONSTRAINT "benign_accidents_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benign_accidents" ADD CONSTRAINT "benign_accidents_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duerp_access_requests" ADD CONSTRAINT "duerp_access_requests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duerp_access_requests" ADD CONSTRAINT "duerp_access_requests_version_duerp_versions_version_fk" FOREIGN KEY ("version") REFERENCES "public"."duerp_versions"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duerp_access_requests" ADD CONSTRAINT "duerp_access_requests_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duerp_access_requests" ADD CONSTRAINT "duerp_access_requests_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_program_actions" ADD CONSTRAINT "prevention_program_actions_year_prevention_programs_year_fk" FOREIGN KEY ("year") REFERENCES "public"."prevention_programs"("year") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_program_actions" ADD CONSTRAINT "prevention_program_actions_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_programs" ADD CONSTRAINT "prevention_programs_duerp_version_duerp_versions_version_fk" FOREIGN KEY ("duerp_version") REFERENCES "public"."duerp_versions"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_programs" ADD CONSTRAINT "prevention_programs_frozen_by_id_people_id_fk" FOREIGN KEY ("frozen_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_programs" ADD CONSTRAINT "prevention_programs_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "benign_accidents_site_number_unique" ON "benign_accidents" USING btree ("site_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "benign_accidents_event_active_unique" ON "benign_accidents" USING btree ("event_id") WHERE cancelled_at is null;--> statement-breakpoint
CREATE INDEX "benign_accidents_event_idx" ON "benign_accidents" USING btree ("event_id");--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_prevention_plan_id_prevention_plans_id_fk" FOREIGN KEY ("prevention_plan_id") REFERENCES "public"."prevention_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_permit_id_permits_id_fk" FOREIGN KEY ("permit_id") REFERENCES "public"."permits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_waste_stream_id_waste_streams_id_fk" FOREIGN KEY ("waste_stream_id") REFERENCES "public"."waste_streams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_waste_entry_id_waste_entries_id_fk" FOREIGN KEY ("waste_entry_id") REFERENCES "public"."waste_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD CONSTRAINT "audit_plan_items_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD CONSTRAINT "audit_plan_items_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_victim_id_people_id_fk" FOREIGN KEY ("victim_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_cpam_waived_by_id_people_id_fk" FOREIGN KEY ("cpam_waived_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD CONSTRAINT "audit_plan_items_review_id_unique" UNIQUE("review_id");--> statement-breakpoint
-- AUD-01 : rattachement des échéances « revue de direction » du programme à leur revue (même date prévue ; une seule revue non annulée et une seule échéance de revue à cette date).
UPDATE "audit_plan_items" p SET "review_id" = r."id" FROM "reviews" r WHERE p."review_id" IS NULL AND r."status" <> 'annulee' AND p."planned_on" = r."review_on" AND (p."track" ~* 'revue' OR (p."label" || ' ' || coalesce(p."detail", '')) ~* 'revue[[:space:]]+de[[:space:]]+direction') AND (SELECT count(*) FROM "reviews" s WHERE s."review_on" = r."review_on" AND s."status" <> 'annulee') = 1 AND (SELECT count(*) FROM "audit_plan_items" q WHERE q."planned_on" = p."planned_on" AND (q."track" ~* 'revue' OR (q."label" || ' ' || coalesce(q."detail", '')) ~* 'revue[[:space:]]+de[[:space:]]+direction')) = 1;--> statement-breakpoint
-- PRV-01 : date de première signature complète des plans déjà signés par les deux entreprises (la plus tardive des deux signatures).
UPDATE "prevention_plans" SET "first_signed_on" = GREATEST("signed_eu_on", "signed_ee_on") WHERE "first_signed_on" IS NULL AND "signed_eu_on" IS NOT NULL AND "signed_ee_on" IS NOT NULL;
