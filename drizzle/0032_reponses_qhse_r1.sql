CREATE TABLE "duerp_version_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"body" text NOT NULL,
	"author_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duerp_version_comments_body_check" CHECK (length(btrim("duerp_version_comments"."body")) > 0)
);
--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD COLUMN "audit_kind" text DEFAULT 'autre' NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_plans" ADD COLUMN "gap_measures" text;--> statement-breakpoint
ALTER TABLE "duerp_version_comments" ADD CONSTRAINT "duerp_version_comments_version_duerp_versions_version_fk" FOREIGN KEY ("version") REFERENCES "public"."duerp_versions"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duerp_version_comments" ADD CONSTRAINT "duerp_version_comments_author_id_people_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "duerp_version_comments_version_idx" ON "duerp_version_comments" USING btree ("version");--> statement-breakpoint
ALTER TABLE "audit_plan_items" ADD CONSTRAINT "audit_plan_items_audit_kind_check" CHECK ("audit_plan_items"."audit_kind" in ('terrain', 'iso_certification', 'iso_blanc', 'revue_processus', 'revue_direction', 'autre'));--> statement-breakpoint
-- D08-5 (réponse du service QHSE du 09/11/2026) : type des éléments existants du programme d'audit, déduit comme
-- inferAuditKind (src/lib/rules/audits.ts) ; à défaut « autre ».
UPDATE "audit_plan_items" SET "audit_kind" = CASE
  WHEN "track" ~* '\mrevues?\s+de\s+direction\M' OR ("label" || ' ' || coalesce("detail", '')) ~* '\mrevues?\s+de\s+direction\M' THEN 'revue_direction'
  WHEN ("track" || ' ' || "label" || ' ' || coalesce("detail", '')) ~* '\mrevues?\s+de\s+processus\M' THEN 'revue_processus'
  WHEN ("track" || ' ' || "label" || ' ' || coalesce("detail", '')) ~* '\mblanc\M' THEN 'iso_blanc'
  WHEN "track" = 'Certification' OR "certification_id" IS NOT NULL THEN 'iso_certification'
  WHEN "track" = 'Visites sécurité' OR ("track" || ' ' || "label" || ' ' || coalesce("detail", '')) ~* '\m(visites?|terrain)\M' THEN 'terrain'
  ELSE 'autre'
END;
