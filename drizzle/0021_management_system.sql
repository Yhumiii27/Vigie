CREATE TABLE "audit_plan_tracks" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"track" text NOT NULL,
	"hidden_at" timestamp with time zone,
	"hidden_by_id" text,
	"hide_reason" text,
	CONSTRAINT "audit_plan_tracks_hide_check" CHECK (("audit_plan_tracks"."hidden_at" is null and "audit_plan_tracks"."hidden_by_id" is null and "audit_plan_tracks"."hide_reason" is null) or ("audit_plan_tracks"."hidden_at" is not null and "audit_plan_tracks"."hide_reason" is not null and btrim("audit_plan_tracks"."hide_reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "change_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"impacts" text DEFAULT '' NOT NULL,
	"pilot_id" text,
	"planned_on" date,
	"status" text DEFAULT 'demandee' NOT NULL,
	"decided_on" date,
	"decided_by_id" text,
	"decision_note" text,
	"done_on" date,
	"done_note" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"cancel_reason" text,
	CONSTRAINT "change_requests_kind_check" CHECK ("change_requests"."kind" in ('organisation', 'procede', 'equipement', 'produit', 'exigence', 'autre')),
	CONSTRAINT "change_requests_status_check" CHECK ("change_requests"."status" in ('demandee', 'acceptee', 'refusee', 'realisee')),
	CONSTRAINT "change_requests_decision_check" CHECK (("change_requests"."status" = 'demandee') = ("change_requests"."decided_on" is null)),
	CONSTRAINT "change_requests_done_check" CHECK (("change_requests"."status" = 'realisee') = ("change_requests"."done_on" is not null)),
	CONSTRAINT "change_requests_cancel_check" CHECK (("change_requests"."cancelled_at" is null and "change_requests"."cancelled_by_id" is null and "change_requests"."cancel_reason" is null) or ("change_requests"."cancelled_at" is not null and "change_requests"."cancel_reason" is not null and btrim("change_requests"."cancel_reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "document_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"version" text NOT NULL,
	"reviewed_on" date NOT NULL,
	"reviewer_id" text,
	"conclusion" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"cancel_reason" text,
	CONSTRAINT "document_reviews_conclusion_check" CHECK (btrim("document_reviews"."conclusion") <> ''),
	CONSTRAINT "document_reviews_cancel_check" CHECK (("document_reviews"."cancelled_at" is null and "document_reviews"."cancelled_by_id" is null and "document_reviews"."cancel_reason" is null) or ("document_reviews"."cancelled_at" is not null and "document_reviews"."cancel_reason" is not null and btrim("document_reviews"."cancel_reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "emergency_drills" (
	"id" serial PRIMARY KEY NOT NULL,
	"situation_id" integer NOT NULL,
	"held_on" date NOT NULL,
	"participants" text DEFAULT '' NOT NULL,
	"findings" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"cancel_reason" text,
	CONSTRAINT "emergency_drills_cancel_check" CHECK (("emergency_drills"."cancelled_at" is null and "emergency_drills"."cancelled_by_id" is null and "emergency_drills"."cancel_reason" is null) or ("emergency_drills"."cancelled_at" is not null and "emergency_drills"."cancel_reason" is not null and btrim("emergency_drills"."cancel_reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "emergency_situations" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"label" text NOT NULL,
	"scenario" text DEFAULT '' NOT NULL,
	"response" text DEFAULT '' NOT NULL,
	"drill_months" integer NOT NULL,
	"next_drill_on" date,
	"owner_id" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_id" text,
	"archive_reason" text,
	CONSTRAINT "emergency_situations_drill_months_check" CHECK ("emergency_situations"."drill_months" between 1 and 60),
	CONSTRAINT "emergency_situations_archive_check" CHECK (("emergency_situations"."archived_at" is null and "emergency_situations"."archived_by_id" is null and "emergency_situations"."archive_reason" is null) or ("emergency_situations"."archived_at" is not null and "emergency_situations"."archive_reason" is not null and btrim("emergency_situations"."archive_reason") <> ''))
);
--> statement-breakpoint
ALTER TABLE "audit_findings" ADD COLUMN "site_id" text;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD COLUMN "auditor_id" text;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD COLUMN "site_id" text;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD COLUMN "unplanned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "certifications" ADD COLUMN "site_id" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "origin" text DEFAULT 'interne' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "issuer" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "retention" text;--> statement-breakpoint
ALTER TABLE "training_titles" ADD COLUMN "internal_auditor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_plan_tracks" ADD CONSTRAINT "audit_plan_tracks_hidden_by_id_people_id_fk" FOREIGN KEY ("hidden_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_pilot_id_people_id_fk" FOREIGN KEY ("pilot_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_decided_by_id_people_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reviews" ADD CONSTRAINT "document_reviews_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reviews" ADD CONSTRAINT "document_reviews_reviewer_id_people_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reviews" ADD CONSTRAINT "document_reviews_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_drills" ADD CONSTRAINT "emergency_drills_situation_id_emergency_situations_id_fk" FOREIGN KEY ("situation_id") REFERENCES "public"."emergency_situations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_drills" ADD CONSTRAINT "emergency_drills_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_drills" ADD CONSTRAINT "emergency_drills_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_situations" ADD CONSTRAINT "emergency_situations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_situations" ADD CONSTRAINT "emergency_situations_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_situations" ADD CONSTRAINT "emergency_situations_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_situations" ADD CONSTRAINT "emergency_situations_archived_by_id_people_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_plan_tracks_year_track" ON "audit_plan_tracks" USING btree ("year","track");--> statement-breakpoint
CREATE INDEX "document_reviews_document_idx" ON "document_reviews" USING btree ("document_id","reviewed_on");--> statement-breakpoint
CREATE INDEX "emergency_drills_situation_idx" ON "emergency_drills" USING btree ("situation_id","held_on");--> statement-breakpoint
CREATE INDEX "emergency_situations_site_idx" ON "emergency_situations" USING btree ("site_id");--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD CONSTRAINT "audit_plan_items_auditor_id_people_id_fk" FOREIGN KEY ("auditor_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD CONSTRAINT "audit_plan_items_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD CONSTRAINT "audit_plan_items_unplanned_check" CHECK (not "audit_plan_items"."unplanned" or ("audit_plan_items"."done" and "audit_plan_items"."done_on" is not null and "audit_plan_items"."review_id" is null));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_origin_check" CHECK ("documents"."origin" in ('interne', 'externe'));