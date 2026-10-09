CREATE TABLE "map_routes" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"polyline" jsonb NOT NULL,
	"shared" boolean DEFAULT true NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "map_zones" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"polygon" jsonb NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "pp_import_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"format" text NOT NULL,
	"signature" text,
	"mapping" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "site_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"title" text NOT NULL,
	"team" text NOT NULL,
	"contractor_id" text,
	"owner_id" text,
	"prevention_plan_id" text,
	"permit_id" text,
	"keystone_project" text,
	"zone_id" integer,
	"geometry" jsonb,
	"start_on" date NOT NULL,
	"end_on" date NOT NULL,
	"hours" text,
	"route_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vehicles" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_maps" (
	"site_id" text PRIMARY KEY NOT NULL,
	"attachment_id" text,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"meters_per_unit" numeric(12, 4),
	"proximity_meters" integer DEFAULT 15 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "form_data" jsonb;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "imported_from_id" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "seveso" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "pp_from_first_minute" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "map_routes" ADD CONSTRAINT "map_routes_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_zones" ADD CONSTRAINT "map_zones_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pp_import_templates" ADD CONSTRAINT "pp_import_templates_updated_by_id_people_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_activities" ADD CONSTRAINT "site_activities_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_activities" ADD CONSTRAINT "site_activities_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_activities" ADD CONSTRAINT "site_activities_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_activities" ADD CONSTRAINT "site_activities_prevention_plan_id_prevention_plans_id_fk" FOREIGN KEY ("prevention_plan_id") REFERENCES "public"."prevention_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_activities" ADD CONSTRAINT "site_activities_permit_id_permits_id_fk" FOREIGN KEY ("permit_id") REFERENCES "public"."permits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_activities" ADD CONSTRAINT "site_activities_zone_id_map_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."map_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_maps" ADD CONSTRAINT "site_maps_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_maps" ADD CONSTRAINT "site_maps_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD CONSTRAINT "prevention_plans_imported_from_id_attachments_id_fk" FOREIGN KEY ("imported_from_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;