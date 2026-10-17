CREATE TABLE "access_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"person_id" text,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"attachment_id" text,
	"health" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "returned_on" date;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "return_reason" text;--> statement-breakpoint
ALTER TABLE "site_activities" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "site_activities" ADD COLUMN "cancelled_by_id" text;--> statement-breakpoint
ALTER TABLE "site_activities" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "waste_streams" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waste_streams" ADD COLUMN "archived_by_id" text;--> statement-breakpoint
ALTER TABLE "waste_streams" ADD COLUMN "archive_reason" text;--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_log_entity_idx" ON "access_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "access_log_person_idx" ON "access_log" USING btree ("person_id","at");--> statement-breakpoint
ALTER TABLE "site_activities" ADD CONSTRAINT "site_activities_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_streams" ADD CONSTRAINT "waste_streams_archived_by_id_people_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;