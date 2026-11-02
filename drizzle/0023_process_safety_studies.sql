CREATE TABLE "process_safety_studies" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"capex_code" text,
	"keystone_project_code" text,
	"milestone" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'planifiee' NOT NULL,
	"session_on" date NOT NULL,
	"validated_on" date,
	"conclusion" text,
	"facilitator_id" text,
	"facilitator_external" text,
	"report_ref" text,
	"scope" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"cancel_reason" text,
	CONSTRAINT "process_safety_studies_milestone_check" CHECK ("process_safety_studies"."milestone" in ('HS2', 'HS3', 'HS4', 'PSSR', 'HS6')),
	CONSTRAINT "process_safety_studies_type_check" CHECK ("process_safety_studies"."type" in ('hazid', 'hazop', 'amdec', 'controle_chantier', 'pssr', 'rspdi', 'aspd')),
	CONSTRAINT "process_safety_studies_status_check" CHECK ("process_safety_studies"."status" in ('planifiee', 'realisee', 'validee')),
	CONSTRAINT "process_safety_studies_conclusion_check" CHECK ("process_safety_studies"."conclusion" is null or "process_safety_studies"."conclusion" in ('favorable', 'reserves', 'defavorable')),
	CONSTRAINT "process_safety_studies_type_milestone_check" CHECK (("process_safety_studies"."type" = 'hazid' and "process_safety_studies"."milestone" = 'HS2') or ("process_safety_studies"."type" in ('hazop', 'amdec') and "process_safety_studies"."milestone" = 'HS3') or ("process_safety_studies"."type" = 'controle_chantier' and "process_safety_studies"."milestone" = 'HS4') or ("process_safety_studies"."type" in ('pssr', 'rspdi') and "process_safety_studies"."milestone" = 'PSSR') or ("process_safety_studies"."type" = 'aspd' and "process_safety_studies"."milestone" = 'HS6')),
	CONSTRAINT "process_safety_studies_link_check" CHECK ("process_safety_studies"."capex_code" is not null or "process_safety_studies"."keystone_project_code" is not null),
	CONSTRAINT "process_safety_studies_capex_code_check" CHECK ("process_safety_studies"."capex_code" is null or "process_safety_studies"."capex_code" ~ '^CPX-[A-Z0-9][A-Z0-9-]{0,39}$'),
	CONSTRAINT "process_safety_studies_validated_check" CHECK (("process_safety_studies"."status" = 'validee' and "process_safety_studies"."validated_on" is not null and "process_safety_studies"."conclusion" is not null) or ("process_safety_studies"."status" <> 'validee' and "process_safety_studies"."validated_on" is null and "process_safety_studies"."conclusion" is null)),
	CONSTRAINT "process_safety_studies_facilitator_check" CHECK ("process_safety_studies"."facilitator_id" is null or "process_safety_studies"."facilitator_external" is null),
	CONSTRAINT "process_safety_studies_cancel_check" CHECK (("process_safety_studies"."cancelled_at" is null and "process_safety_studies"."cancelled_by_id" is null and "process_safety_studies"."cancel_reason" is null) or ("process_safety_studies"."cancelled_at" is not null and "process_safety_studies"."cancel_reason" is not null and btrim("process_safety_studies"."cancel_reason") <> ''))
);
--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "safety_study_id" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "safety_study_blocking" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "process_safety_studies" ADD CONSTRAINT "process_safety_studies_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_safety_studies" ADD CONSTRAINT "process_safety_studies_facilitator_id_people_id_fk" FOREIGN KEY ("facilitator_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_safety_studies" ADD CONSTRAINT "process_safety_studies_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_safety_studies" ADD CONSTRAINT "process_safety_studies_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "process_safety_studies_site_idx" ON "process_safety_studies" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "process_safety_studies_capex_idx" ON "process_safety_studies" USING btree ("capex_code");--> statement-breakpoint
CREATE INDEX "process_safety_studies_project_idx" ON "process_safety_studies" USING btree ("keystone_project_code");--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_safety_study_id_process_safety_studies_id_fk" FOREIGN KEY ("safety_study_id") REFERENCES "public"."process_safety_studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_safety_study_idx" ON "actions" USING btree ("safety_study_id");--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_code_unique" UNIQUE("code");--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_safety_study_blocking_check" CHECK (not "actions"."safety_study_blocking" or "actions"."safety_study_id" is not null);--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_code_check" CHECK ("sites"."code" is null or ("sites"."code" ~ '^[a-z][a-z0-9_]{1,31}$' and "sites"."code" <> 'all'));