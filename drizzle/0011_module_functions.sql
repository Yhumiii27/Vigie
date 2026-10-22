CREATE TABLE "coactivity_controls" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"pair_key" text NOT NULL,
	"activity_a" integer NOT NULL,
	"activity_b" integer NOT NULL,
	"measure" text NOT NULL,
	"controlled_by_id" text,
	"controlled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"cancel_reason" text,
	CONSTRAINT "coactivity_controls_pair_check" CHECK ("coactivity_controls"."activity_a" < "coactivity_controls"."activity_b")
);
--> statement-breakpoint
ALTER TABLE "coactivity_controls" ADD CONSTRAINT "coactivity_controls_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coactivity_controls" ADD CONSTRAINT "coactivity_controls_activity_a_site_activities_id_fk" FOREIGN KEY ("activity_a") REFERENCES "public"."site_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coactivity_controls" ADD CONSTRAINT "coactivity_controls_activity_b_site_activities_id_fk" FOREIGN KEY ("activity_b") REFERENCES "public"."site_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coactivity_controls" ADD CONSTRAINT "coactivity_controls_controlled_by_id_people_id_fk" FOREIGN KEY ("controlled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coactivity_controls" ADD CONSTRAINT "coactivity_controls_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coactivity_controls_active_pair" ON "coactivity_controls" USING btree ("site_id","pair_key") WHERE "coactivity_controls"."cancelled_at" is null;--> statement-breakpoint
-- VEI-07 : rattachement explicite des exigences de veille à un indicateur calculé (requirements.linked_to), repris des
-- anciens rapprochements par le texte : domaine « Plans de prévention » (R. 4512-6), bordereaux de déchets dangereux
-- (R. 541-45) et registre des déchets (R. 541-43, « déchet »). Une seule exigence en vigueur par indicateur : la première
-- dans l'ordre de la veille ; jamais une exigence déjà rattachée (« duerp »).
UPDATE "requirements" SET "linked_to" = 'prevention' WHERE "id" = (
	SELECT "id" FROM "requirements" WHERE "linked_to" IS NULL AND "archived_at" IS NULL AND "domain" = 'Plans de prévention' ORDER BY "sort", "id" LIMIT 1
) AND NOT EXISTS (SELECT 1 FROM "requirements" WHERE "linked_to" = 'prevention' AND "archived_at" IS NULL);--> statement-breakpoint
UPDATE "requirements" SET "linked_to" = 'waste_bsd' WHERE "id" = (
	SELECT "id" FROM "requirements" WHERE "linked_to" IS NULL AND "archived_at" IS NULL AND "text" ~ 'R\.\s?541-45' ORDER BY "sort", "id" LIMIT 1
) AND NOT EXISTS (SELECT 1 FROM "requirements" WHERE "linked_to" = 'waste_bsd' AND "archived_at" IS NULL);--> statement-breakpoint
UPDATE "requirements" SET "linked_to" = 'waste_register' WHERE "id" = (
	SELECT "id" FROM "requirements" WHERE "linked_to" IS NULL AND "archived_at" IS NULL
	AND ("text" ~* 'R\.\s?541-4|déchet' OR "domain" ~* 'R\.\s?541-4|déchet') ORDER BY "sort", "id" LIMIT 1
) AND NOT EXISTS (SELECT 1 FROM "requirements" WHERE "linked_to" = 'waste_register' AND "archived_at" IS NULL);
