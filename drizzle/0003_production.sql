CREATE TABLE "report_rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "report_rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "declarant_company" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "reported_via" text;--> statement-breakpoint
ALTER TABLE "map_zones" ADD COLUMN "qr_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "entra_object_id" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "matricule" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "last_role" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "qhse_lead_id" text;--> statement-breakpoint
CREATE INDEX "report_rate_limits_window_idx" ON "report_rate_limits" USING btree ("window_start");--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_qhse_lead_id_people_id_fk" FOREIGN KEY ("qhse_lead_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "people_email_lower_unique" ON "people" USING btree (lower("email"));--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_entra_object_id_unique" UNIQUE("entra_object_id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_matricule_unique" UNIQUE("matricule");