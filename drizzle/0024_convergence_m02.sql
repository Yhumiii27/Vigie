CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"read" integer DEFAULT 0 NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"removed" integer DEFAULT 0 NOT NULL,
	"message" text,
	CONSTRAINT "sync_runs_status_check" CHECK ("sync_runs"."status" in ('ok', 'error', 'unavailable'))
);
--> statement-breakpoint
ALTER TABLE "keystone_projects" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "keystone_projects" CASCADE;--> statement-breakpoint
ALTER TABLE "sites" DROP CONSTRAINT "sites_code_unique";--> statement-breakpoint
ALTER TABLE "sites" DROP CONSTRAINT "sites_code_check";--> statement-breakpoint
ALTER TABLE "actions" DROP CONSTRAINT "actions_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_findings" DROP CONSTRAINT "audit_findings_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_plan_items" DROP CONSTRAINT "audit_plan_items_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "benign_accidents" DROP CONSTRAINT "benign_accidents_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "certifications" DROP CONSTRAINT "certifications_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "change_requests" DROP CONSTRAINT "change_requests_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "coactivity_controls" DROP CONSTRAINT "coactivity_controls_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "consumptions" DROP CONSTRAINT "consumptions_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "controls" DROP CONSTRAINT "controls_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "duerp_access_requests" DROP CONSTRAINT "duerp_access_requests_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "emergency_situations" DROP CONSTRAINT "emergency_situations_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "hours_worked" DROP CONSTRAINT "hours_worked_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "map_routes" DROP CONSTRAINT "map_routes_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "map_zones" DROP CONSTRAINT "map_zones_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "people" DROP CONSTRAINT "people_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "permits" DROP CONSTRAINT "permits_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "prevention_plans" DROP CONSTRAINT "prevention_plans_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "process_safety_studies" DROP CONSTRAINT "process_safety_studies_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "qhse_objectives" DROP CONSTRAINT "qhse_objectives_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "safety_notices" DROP CONSTRAINT "safety_notices_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "site_activities" DROP CONSTRAINT "site_activities_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "site_maps" DROP CONSTRAINT "site_maps_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "waste_entries" DROP CONSTRAINT "waste_entries_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "waste_streams" DROP CONSTRAINT "waste_streams_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "work_units" DROP CONSTRAINT "work_units_site_id_sites_id_fk";
--> statement-breakpoint
ALTER TABLE "keystone_assignments" ADD COLUMN "affectation_id" text;--> statement-breakpoint
ALTER TABLE "keystone_assignments" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "keystone_assignments" ADD COLUMN "project_code" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "matrix_state" text;--> statement-breakpoint
CREATE INDEX "sync_runs_source_idx" ON "sync_runs" USING btree ("source","started_at");--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD CONSTRAINT "audit_plan_items_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "benign_accidents" ADD CONSTRAINT "benign_accidents_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "coactivity_controls" ADD CONSTRAINT "coactivity_controls_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "consumptions" ADD CONSTRAINT "consumptions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "controls" ADD CONSTRAINT "controls_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "duerp_access_requests" ADD CONSTRAINT "duerp_access_requests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "emergency_situations" ADD CONSTRAINT "emergency_situations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "hours_worked" ADD CONSTRAINT "hours_worked_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "map_routes" ADD CONSTRAINT "map_routes_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "map_zones" ADD CONSTRAINT "map_zones_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD CONSTRAINT "prevention_plans_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "process_safety_studies" ADD CONSTRAINT "process_safety_studies_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "qhse_objectives" ADD CONSTRAINT "qhse_objectives_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "safety_notices" ADD CONSTRAINT "safety_notices_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "site_activities" ADD CONSTRAINT "site_activities_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "site_maps" ADD CONSTRAINT "site_maps_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "waste_streams" ADD CONSTRAINT "waste_streams_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_units" ADD CONSTRAINT "work_units_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "code";--> statement-breakpoint
ALTER TABLE "keystone_assignments" ADD CONSTRAINT "keystone_assignments_affectation_id_unique" UNIQUE("affectation_id");--> statement-breakpoint
ALTER TABLE "keystone_assignments" ADD CONSTRAINT "keystone_assignments_source_check" CHECK ("keystone_assignments"."source" in ('rotation', 'planning'));--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_matrix_state_check" CHECK ("sites"."matrix_state" in ('actif', 'ferme', 'absent'));--> statement-breakpoint
-- Décision CV-09 (03/11/2026, D14 de Matrix) : l'identifiant d'un site est son code commun (matrix.sites.code). Aucune
-- donnée de production à reprendre (P-03) : seuls les sites du jeu de démonstration d'une base existante (PGlite de
-- démonstration, application Mac) sont renommés. Les clés étrangères vers sites.id suivent (ON UPDATE CASCADE, posées
-- ci-dessus) ; les références en texte sont réécrites ensuite. Sans effet sur une base qui n'a pas ces identifiants.
UPDATE "sites" SET "id" = m."new_id"
FROM (VALUES ('ville-a', 'site_a'), ('ville-b', 'site_b'), ('ville-c', 'site_c')) AS m("old_id", "new_id")
WHERE "sites"."id" = m."old_id" AND NOT EXISTS (SELECT FROM "sites" s2 WHERE s2."id" = m."new_id");--> statement-breakpoint
UPDATE "requirements" SET "site_ids" = (
  SELECT coalesce(jsonb_agg(CASE e.x WHEN 'ville-a' THEN 'site_a' WHEN 'ville-b' THEN 'site_b' WHEN 'ville-c' THEN 'site_c' ELSE e.x END ORDER BY e.o), '[]'::jsonb)
  FROM jsonb_array_elements_text("requirements"."site_ids") WITH ORDINALITY AS e(x, o))
WHERE "site_ids" ?| array['ville-a', 'ville-b', 'ville-c'];--> statement-breakpoint
UPDATE "change_log" SET "entity_id" = CASE "entity_id" WHEN 'ville-a' THEN 'site_a' WHEN 'ville-b' THEN 'site_b' ELSE 'site_c' END
WHERE "entity_id" IN ('ville-a', 'ville-b', 'ville-c');--> statement-breakpoint
UPDATE "attachments" SET "entity_id" = CASE "entity_id" WHEN 'ville-a' THEN 'site_a' WHEN 'ville-b' THEN 'site_b' ELSE 'site_c' END
WHERE "entity_id" IN ('ville-a', 'ville-b', 'ville-c');--> statement-breakpoint
UPDATE "access_log" SET "entity_id" = CASE "entity_id" WHEN 'ville-a' THEN 'site_a' WHEN 'ville-b' THEN 'site_b' ELSE 'site_c' END
WHERE "entity_id" IN ('ville-a', 'ville-b', 'ville-c');--> statement-breakpoint
UPDATE "notification_reads" SET "item_key" = regexp_replace(regexp_replace(regexp_replace("item_key",
  '(^|[^a-z0-9_-])ville-a([^a-z0-9_-]|$)', '\1site_a\2', 'g'),
  '(^|[^a-z0-9_-])ville-b([^a-z0-9_-]|$)', '\1site_b\2', 'g'),
  '(^|[^a-z0-9_-])ville-c([^a-z0-9_-]|$)', '\1site_c\2', 'g')
WHERE "item_key" ~ 'ville-[abc]';
