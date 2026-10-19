ALTER TABLE "contractors" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "keystone_project_code" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "nc_number" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "keystone_activity_code" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "part_ref" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "keystone_deliverable_number" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "supplier_name" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "root_cause" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "nc_cost_keur" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "iso_clause" text;--> statement-breakpoint
ALTER TABLE "permits" ADD COLUMN "keystone_project_code" text;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "keystone_project_code" text;--> statement-breakpoint
ALTER TABLE "site_activities" ADD COLUMN "keystone_project_code" text;--> statement-breakpoint
CREATE INDEX "contractors_supplier_id_idx" ON "contractors" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "events_keystone_project_code_idx" ON "events" USING btree ("keystone_project_code");--> statement-breakpoint
CREATE UNIQUE INDEX "events_nc_number_par_projet" ON "events" USING btree ("keystone_project_code","nc_number") WHERE "events"."nc_number" is not null;--> statement-breakpoint
CREATE INDEX "permits_keystone_project_code_idx" ON "permits" USING btree ("keystone_project_code");--> statement-breakpoint
CREATE INDEX "prevention_plans_keystone_project_code_idx" ON "prevention_plans" USING btree ("keystone_project_code");--> statement-breakpoint
CREATE INDEX "site_activities_keystone_project_code_idx" ON "site_activities" USING btree ("keystone_project_code");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_nc_number_check" CHECK ("events"."nc_number" is null or ("events"."nc_number" ~ '^NCR-[0-9]{3,}$' and "events"."type" = 'NC' and "events"."keystone_project_code" is not null));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_nc_cost_keur_check" CHECK ("events"."nc_cost_keur" >= 0);