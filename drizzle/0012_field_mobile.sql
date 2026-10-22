ALTER TABLE "events" ADD COLUMN "zone_id" integer;--> statement-breakpoint
ALTER TABLE "map_zones" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "map_zones" ADD COLUMN "archived_by_id" text;--> statement-breakpoint
ALTER TABLE "map_zones" ADD COLUMN "archive_reason" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_zone_id_map_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."map_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_zones" ADD CONSTRAINT "map_zones_archived_by_id_people_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_zone_idx" ON "events" USING btree ("zone_id");--> statement-breakpoint
-- EVT-19 (reprise) : un événement dont le lieu est exactement le nom d'une zone de son site (lieu pré-rempli par le QR code
-- du poste) est rattaché à cette zone, quand le nom est unique sur le site. Maladies professionnelles exclues (aucun
-- rattachement). Les autres événements restent sans zone : le lieu en texte reste affiché.
UPDATE "events" AS e SET "zone_id" = z."id"
FROM "map_zones" AS z
WHERE e."zone_id" IS NULL AND e."type" <> 'MP' AND z."site_id" = e."site_id" AND z."name" = e."location"
  AND (SELECT count(*) FROM "map_zones" AS z2 WHERE z2."site_id" = e."site_id" AND z2."name" = e."location") = 1;
