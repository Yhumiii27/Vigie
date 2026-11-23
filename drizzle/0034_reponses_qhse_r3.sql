CREATE TABLE "assessment_requirements" (
	"id" serial PRIMARY KEY NOT NULL,
	"standard" text NOT NULL,
	"clause" text NOT NULL,
	"heading" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_id" text,
	"archive_reason" text,
	CONSTRAINT "assessment_requirements_standard_check" CHECK ("assessment_requirements"."standard" in ('iso45001', 'iso14001', 'iso9001')),
	CONSTRAINT "assessment_requirements_clause_check" CHECK ("assessment_requirements"."clause" ~ '^[0-9]+(\.[0-9]+)*$'),
	CONSTRAINT "assessment_requirements_heading_check" CHECK (btrim("assessment_requirements"."heading") <> ''),
	CONSTRAINT "assessment_requirements_archive_check" CHECK (("assessment_requirements"."archived_at" is null and "assessment_requirements"."archived_by_id" is null and "assessment_requirements"."archive_reason" is null) or ("assessment_requirements"."archived_at" is not null and "assessment_requirements"."archive_reason" is not null and btrim("assessment_requirements"."archive_reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "dashboard_layouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" text,
	"role" text,
	"cards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" text,
	CONSTRAINT "dashboard_layouts_owner_check" CHECK (("dashboard_layouts"."person_id" is null) <> ("dashboard_layouts"."role" is null)),
	CONSTRAINT "dashboard_layouts_role_check" CHECK ("dashboard_layouts"."role" is null or "dashboard_layouts"."role" in ('Animateur QHSE', 'Direction'))
);
--> statement-breakpoint
CREATE TABLE "lockouts" (
	"id" text PRIMARY KEY NOT NULL,
	"permit_id" text NOT NULL,
	"prevention_plan_id" text,
	"site_id" text NOT NULL,
	"energy" text NOT NULL,
	"equipment" text NOT NULL,
	"points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"applier_id" text NOT NULL,
	"verifier_id" text NOT NULL,
	"status" text DEFAULT 'preparee' NOT NULL,
	"applied_at" timestamp with time zone,
	"applied_by_id" text,
	"verified_at" timestamp with time zone,
	"verified_by_id" text,
	"removed_at" timestamp with time zone,
	"removed_by_id" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"cancel_reason" text,
	CONSTRAINT "lockouts_energy_check" CHECK ("lockouts"."energy" in ('electrique', 'mecanique', 'hydraulique', 'pneumatique', 'fluide', 'chimique', 'thermique', 'autre')),
	CONSTRAINT "lockouts_status_check" CHECK ("lockouts"."status" in ('preparee', 'posee', 'verifiee', 'levee', 'annulee')),
	CONSTRAINT "lockouts_people_check" CHECK ("lockouts"."applier_id" <> "lockouts"."verifier_id"),
	CONSTRAINT "lockouts_applied_check" CHECK ("lockouts"."status" in ('preparee', 'annulee') or "lockouts"."applied_at" is not null),
	CONSTRAINT "lockouts_verified_check" CHECK ("lockouts"."status" <> 'verifiee' or "lockouts"."verified_at" is not null),
	CONSTRAINT "lockouts_removed_check" CHECK ("lockouts"."status" <> 'levee' or "lockouts"."removed_at" is not null),
	CONSTRAINT "lockouts_cancel_status_check" CHECK (("lockouts"."status" = 'annulee') = ("lockouts"."cancelled_at" is not null)),
	CONSTRAINT "lockouts_cancel_check" CHECK (("lockouts"."cancelled_at" is null and "lockouts"."cancelled_by_id" is null and "lockouts"."cancel_reason" is null) or ("lockouts"."cancelled_at" is not null and "lockouts"."cancel_reason" is not null and btrim("lockouts"."cancel_reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "self_assessment_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"assessment_id" text NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "self_assessment_comments_body_check" CHECK (btrim("self_assessment_comments"."body") <> '')
);
--> statement-breakpoint
CREATE TABLE "self_assessment_line_actions" (
	"line_id" integer NOT NULL,
	"action_id" text NOT NULL,
	CONSTRAINT "self_assessment_line_actions_line_id_action_id_pk" PRIMARY KEY("line_id","action_id")
);
--> statement-breakpoint
CREATE TABLE "self_assessment_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"assessment_id" text NOT NULL,
	"requirement_id" integer NOT NULL,
	"clause" text NOT NULL,
	"heading" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"level" text,
	"justification" text DEFAULT '' NOT NULL,
	"finding" text DEFAULT '' NOT NULL,
	"assessed_by_id" text,
	"assessed_at" timestamp with time zone,
	CONSTRAINT "self_assessment_lines_level_check" CHECK ("self_assessment_lines"."level" is null or "self_assessment_lines"."level" in ('conforme', 'partiel', 'non_conforme', 'non_applicable')),
	CONSTRAINT "self_assessment_lines_justification_check" CHECK ("self_assessment_lines"."level" is null or "self_assessment_lines"."level" not in ('non_conforme', 'non_applicable') or btrim("self_assessment_lines"."justification") <> '')
);
--> statement-breakpoint
CREATE TABLE "self_assessments" (
	"id" text PRIMARY KEY NOT NULL,
	"standard" text NOT NULL,
	"site_id" text,
	"assessed_on" date NOT NULL,
	"assessor_id" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"conclusion" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'brouillon' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_id" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"cancel_reason" text,
	CONSTRAINT "self_assessments_standard_check" CHECK ("self_assessments"."standard" in ('iso45001', 'iso14001', 'iso9001')),
	CONSTRAINT "self_assessments_status_check" CHECK ("self_assessments"."status" in ('brouillon', 'cloturee')),
	CONSTRAINT "self_assessments_closed_check" CHECK (("self_assessments"."status" = 'cloturee') = ("self_assessments"."closed_at" is not null)),
	CONSTRAINT "self_assessments_cancel_status_check" CHECK ("self_assessments"."cancelled_at" is null or "self_assessments"."status" = 'brouillon'),
	CONSTRAINT "self_assessments_cancel_check" CHECK (("self_assessments"."cancelled_at" is null and "self_assessments"."cancelled_by_id" is null and "self_assessments"."cancel_reason" is null) or ("self_assessments"."cancelled_at" is not null and "self_assessments"."cancel_reason" is not null and btrim("self_assessments"."cancel_reason") <> ''))
);
--> statement-breakpoint
ALTER TABLE "assessment_requirements" ADD CONSTRAINT "assessment_requirements_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_requirements" ADD CONSTRAINT "assessment_requirements_archived_by_id_people_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_layouts" ADD CONSTRAINT "dashboard_layouts_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_layouts" ADD CONSTRAINT "dashboard_layouts_updated_by_id_people_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lockouts" ADD CONSTRAINT "lockouts_permit_id_permits_id_fk" FOREIGN KEY ("permit_id") REFERENCES "public"."permits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lockouts" ADD CONSTRAINT "lockouts_prevention_plan_id_prevention_plans_id_fk" FOREIGN KEY ("prevention_plan_id") REFERENCES "public"."prevention_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lockouts" ADD CONSTRAINT "lockouts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lockouts" ADD CONSTRAINT "lockouts_applier_id_people_id_fk" FOREIGN KEY ("applier_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lockouts" ADD CONSTRAINT "lockouts_verifier_id_people_id_fk" FOREIGN KEY ("verifier_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lockouts" ADD CONSTRAINT "lockouts_applied_by_id_people_id_fk" FOREIGN KEY ("applied_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lockouts" ADD CONSTRAINT "lockouts_verified_by_id_people_id_fk" FOREIGN KEY ("verified_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lockouts" ADD CONSTRAINT "lockouts_removed_by_id_people_id_fk" FOREIGN KEY ("removed_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lockouts" ADD CONSTRAINT "lockouts_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lockouts" ADD CONSTRAINT "lockouts_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_assessment_comments" ADD CONSTRAINT "self_assessment_comments_assessment_id_self_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."self_assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_assessment_comments" ADD CONSTRAINT "self_assessment_comments_author_id_people_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_assessment_line_actions" ADD CONSTRAINT "self_assessment_line_actions_line_id_self_assessment_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."self_assessment_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_assessment_line_actions" ADD CONSTRAINT "self_assessment_line_actions_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_assessment_lines" ADD CONSTRAINT "self_assessment_lines_assessment_id_self_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."self_assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_assessment_lines" ADD CONSTRAINT "self_assessment_lines_requirement_id_assessment_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."assessment_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_assessment_lines" ADD CONSTRAINT "self_assessment_lines_assessed_by_id_people_id_fk" FOREIGN KEY ("assessed_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_assessments" ADD CONSTRAINT "self_assessments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "self_assessments" ADD CONSTRAINT "self_assessments_assessor_id_people_id_fk" FOREIGN KEY ("assessor_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_assessments" ADD CONSTRAINT "self_assessments_closed_by_id_people_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_assessments" ADD CONSTRAINT "self_assessments_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_assessments" ADD CONSTRAINT "self_assessments_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_requirements_clause_unique" ON "assessment_requirements" USING btree ("standard","clause");--> statement-breakpoint
CREATE UNIQUE INDEX "dashboard_layouts_person_unique" ON "dashboard_layouts" USING btree ("person_id") WHERE person_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "dashboard_layouts_role_unique" ON "dashboard_layouts" USING btree ("role") WHERE person_id is null;--> statement-breakpoint
CREATE INDEX "lockouts_permit_idx" ON "lockouts" USING btree ("permit_id");--> statement-breakpoint
CREATE INDEX "self_assessment_line_actions_action_idx" ON "self_assessment_line_actions" USING btree ("action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "self_assessment_lines_unique" ON "self_assessment_lines" USING btree ("assessment_id","requirement_id");--> statement-breakpoint
CREATE INDEX "self_assessments_standard_idx" ON "self_assessments" USING btree ("standard","assessed_on");
--> statement-breakpoint
-- AUD-40 : catalogue de référence des exigences (numéros d'articles et intitulés courts rédigés pour Vigie, jamais le texte des normes).
INSERT INTO "assessment_requirements" ("standard", "clause", "heading", "sort") VALUES
('iso45001', '4', 'Contexte de l’organisme', 10),
('iso45001', '4.1', 'Enjeux internes et externes', 20),
('iso45001', '4.2', 'Parties intéressées et leurs attentes', 30),
('iso45001', '4.3', 'Périmètre du système de management', 40),
('iso45001', '4.4', 'Système de management et ses processus', 50),
('iso45001', '5', 'Leadership', 60),
('iso45001', '5.1', 'Engagement et implication de la direction', 70),
('iso45001', '5.2', 'Politique', 80),
('iso45001', '5.3', 'Rôles, responsabilités et autorités', 90),
('iso45001', '5.4', 'Consultation et participation des travailleurs', 100),
('iso45001', '6', 'Planification', 110),
('iso45001', '6.1', 'Risques et opportunités', 120),
('iso45001', '6.1.2', 'Identification des dangers et évaluation des risques', 130),
('iso45001', '6.1.3', 'Exigences légales et autres exigences', 140),
('iso45001', '6.1.4', 'Planification des actions', 150),
('iso45001', '6.2', 'Objectifs SST et moyens de les atteindre', 160),
('iso45001', '7', 'Support', 170),
('iso45001', '7.1', 'Ressources', 180),
('iso45001', '7.2', 'Compétences', 190),
('iso45001', '7.3', 'Sensibilisation', 200),
('iso45001', '7.4', 'Communication interne et externe', 210),
('iso45001', '7.5', 'Informations documentées', 220),
('iso45001', '8', 'Réalisation des activités opérationnelles', 230),
('iso45001', '8.1', 'Planification et maîtrise opérationnelles', 240),
('iso45001', '8.1.2', 'Suppression des dangers et réduction des risques', 250),
('iso45001', '8.1.3', 'Pilotage des changements', 260),
('iso45001', '8.1.4', 'Achats, sous-traitance et entreprises extérieures', 270),
('iso45001', '8.2', 'Préparation et réponse aux situations d’urgence', 280),
('iso45001', '9', 'Évaluation des performances', 290),
('iso45001', '9.1', 'Surveillance, mesure, analyse et évaluation', 300),
('iso45001', '9.1.2', 'Évaluation du respect des exigences légales', 310),
('iso45001', '9.2', 'Audit interne', 320),
('iso45001', '9.3', 'Revue de direction', 330),
('iso45001', '10', 'Amélioration', 340),
('iso45001', '10.2', 'Événements indésirables, non-conformités et actions correctives', 350),
('iso45001', '10.3', 'Amélioration continue', 360),
('iso14001', '4', 'Contexte de l’organisme', 10),
('iso14001', '4.1', 'Enjeux internes et externes', 20),
('iso14001', '4.2', 'Parties intéressées et leurs attentes', 30),
('iso14001', '4.3', 'Périmètre du système de management', 40),
('iso14001', '4.4', 'Système de management et ses processus', 50),
('iso14001', '5', 'Leadership', 60),
('iso14001', '5.1', 'Engagement et implication de la direction', 70),
('iso14001', '5.2', 'Politique', 80),
('iso14001', '5.3', 'Rôles, responsabilités et autorités', 90),
('iso14001', '6', 'Planification', 100),
('iso14001', '6.1', 'Risques et opportunités', 110),
('iso14001', '6.1.2', 'Aspects environnementaux significatifs', 120),
('iso14001', '6.1.3', 'Obligations de conformité', 130),
('iso14001', '6.1.4', 'Planification des actions', 140),
('iso14001', '6.2', 'Objectifs environnementaux et moyens de les atteindre', 150),
('iso14001', '7', 'Support', 160),
('iso14001', '7.1', 'Ressources', 170),
('iso14001', '7.2', 'Compétences', 180),
('iso14001', '7.3', 'Sensibilisation', 190),
('iso14001', '7.4', 'Communication interne et externe', 200),
('iso14001', '7.5', 'Informations documentées', 210),
('iso14001', '8', 'Réalisation des activités opérationnelles', 220),
('iso14001', '8.1', 'Planification et maîtrise opérationnelles', 230),
('iso14001', '8.2', 'Préparation et réponse aux situations d’urgence', 240),
('iso14001', '9', 'Évaluation des performances', 250),
('iso14001', '9.1', 'Surveillance, mesure, analyse et évaluation', 260),
('iso14001', '9.1.2', 'Évaluation de la conformité', 270),
('iso14001', '9.2', 'Audit interne', 280),
('iso14001', '9.3', 'Revue de direction', 290),
('iso14001', '10', 'Amélioration', 300),
('iso14001', '10.2', 'Non-conformités et actions correctives', 310),
('iso14001', '10.3', 'Amélioration continue', 320),
('iso9001', '4', 'Contexte de l’organisme', 10),
('iso9001', '4.1', 'Enjeux internes et externes', 20),
('iso9001', '4.2', 'Parties intéressées et leurs attentes', 30),
('iso9001', '4.3', 'Périmètre du système de management', 40),
('iso9001', '4.4', 'Système de management et ses processus', 50),
('iso9001', '5', 'Leadership', 60),
('iso9001', '5.1', 'Engagement et implication de la direction', 70),
('iso9001', '5.2', 'Politique', 80),
('iso9001', '5.3', 'Rôles, responsabilités et autorités', 90),
('iso9001', '6', 'Planification', 100),
('iso9001', '6.1', 'Actions face aux risques et opportunités', 110),
('iso9001', '6.2', 'Objectifs qualité et moyens de les atteindre', 120),
('iso9001', '6.3', 'Planification des modifications', 130),
('iso9001', '7', 'Support', 140),
('iso9001', '7.1', 'Ressources (personnes, infrastructures, environnement de travail)', 150),
('iso9001', '7.1.5', 'Moyens de surveillance et de mesure', 160),
('iso9001', '7.1.6', 'Connaissances organisationnelles', 170),
('iso9001', '7.2', 'Compétences', 180),
('iso9001', '7.3', 'Sensibilisation', 190),
('iso9001', '7.4', 'Communication', 200),
('iso9001', '7.5', 'Informations documentées', 210),
('iso9001', '8', 'Réalisation des activités opérationnelles', 220),
('iso9001', '8.1', 'Planification et maîtrise opérationnelles', 230),
('iso9001', '8.2', 'Exigences relatives aux produits et services', 240),
('iso9001', '8.3', 'Conception et développement', 250),
('iso9001', '8.4', 'Maîtrise des prestataires externes', 260),
('iso9001', '8.5', 'Production et prestation de service', 270),
('iso9001', '8.6', 'Libération des produits et services', 280),
('iso9001', '8.7', 'Maîtrise des éléments de sortie non conformes', 290),
('iso9001', '9', 'Évaluation des performances', 300),
('iso9001', '9.1', 'Surveillance, mesure, analyse et évaluation', 310),
('iso9001', '9.1.2', 'Satisfaction des clients', 320),
('iso9001', '9.2', 'Audit interne', 330),
('iso9001', '9.3', 'Revue de direction', 340),
('iso9001', '10', 'Amélioration', 350),
('iso9001', '10.2', 'Non-conformités et actions correctives', 360),
('iso9001', '10.3', 'Amélioration continue', 370)
ON CONFLICT ("standard", "clause") DO NOTHING;
