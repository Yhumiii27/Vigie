-- Décision CV-01 (04/11/2026, D08 et D09 de Matrix) : Vigie consulte les titres détenus dans cursus.pub_titres_detenus
-- (src/lib/foreign/cursus.ts) ; plus de saisie de formation, de session collective ni d'évaluation à froid. Aucune donnée
-- de production à reprendre (P-03). Avant la suppression des tables : les attestations jointes à une formation et le
-- journal des formations sont rattachés à leur case de la matrice (« personne|titre », clé du journal de l'exigence),
-- pour rester lisibles (/fichiers, historique de la case). Les fichiers ne sont jamais effacés.
UPDATE "attachments" SET "entity_id" = q."person_id" || '|' || q."title_id"
FROM "qualifications" q
WHERE "attachments"."entity_type" = 'qualification' AND "attachments"."entity_id" = q."id"::text;--> statement-breakpoint
UPDATE "change_log" SET "entity_id" = q."person_id" || '|' || q."title_id"
FROM "qualifications" q
WHERE "change_log"."entity_type" = 'qualification' AND "change_log"."entity_id" = q."id"::text;--> statement-breakpoint
ALTER TABLE "qualifications" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_sessions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "qualifications" CASCADE;--> statement-breakpoint
DROP TABLE "training_sessions" CASCADE;--> statement-breakpoint
ALTER TABLE "actions" DROP CONSTRAINT "actions_qualification_title_id_training_titles_id_fk";
--> statement-breakpoint
ALTER TABLE "qualification_requirements" DROP CONSTRAINT "qualification_requirements_title_id_training_titles_id_fk";
--> statement-breakpoint
ALTER TABLE "risk_measure_links" DROP CONSTRAINT "risk_measure_links_title_id_training_titles_id_fk";
--> statement-breakpoint
ALTER TABLE "training_titles" ADD COLUMN "cursus_state" text;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_qualification_title_id_training_titles_id_fk" FOREIGN KEY ("qualification_title_id") REFERENCES "public"."training_titles"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "qualification_requirements" ADD CONSTRAINT "qualification_requirements_title_id_training_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."training_titles"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "risk_measure_links" ADD CONSTRAINT "risk_measure_links_title_id_training_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."training_titles"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "training_titles" DROP COLUMN "prerequisite_ids";--> statement-breakpoint
ALTER TABLE "training_titles" ADD CONSTRAINT "training_titles_cursus_state_check" CHECK ("training_titles"."cursus_state" in ('actif', 'absent'));--> statement-breakpoint
-- D08 : l'identifiant d'un titre suivi est le titre_id du catalogue de Cursus. Titres du jeu de démonstration d'une base
-- existante (PGlite de démonstration, application Mac) recodés d'après le rapprochement proposé par le plan de Matrix
-- (question C-01, choix par défaut à confirmer : l'habilitation de préférence à la formation) ; les clés étrangères suivent
-- (ON UPDATE CASCADE, posées ci-dessus), les références en texte (journal, pièces jointes, états lus) sont réécrites
-- ensuite. Sans effet sur une base qui n'a pas ces identifiants.
UPDATE "training_titles" SET "id" = m."new_id"
FROM (VALUES ('accueil', 'formation.accueil'), ('elec', 'habilitation.he'), ('r484', 'formation.caces484'), ('r489', 'formation.caces489'), ('sst', 'formation.sst'), ('hauteur', 'habilitation.hauteur'), ('atex', 'habilitation.atex'), ('conduite', 'habilitation.ac489'), ('pont-ancien', 'formation.pontier'), ('auditeur-interne', 'formation.auditeur_interne')) AS m("old_id", "new_id")
WHERE "training_titles"."id" = m."old_id" AND NOT EXISTS (SELECT FROM "training_titles" t2 WHERE t2."id" = m."new_id");--> statement-breakpoint
UPDATE "change_log" SET "entity_id" = m."new_id"
FROM (VALUES ('accueil', 'formation.accueil'), ('elec', 'habilitation.he'), ('r484', 'formation.caces484'), ('r489', 'formation.caces489'), ('sst', 'formation.sst'), ('hauteur', 'habilitation.hauteur'), ('atex', 'habilitation.atex'), ('conduite', 'habilitation.ac489'), ('pont-ancien', 'formation.pontier'), ('auditeur-interne', 'formation.auditeur_interne')) AS m("old_id", "new_id")
WHERE "change_log"."entity_type" = 'training_title' AND "change_log"."entity_id" = m."old_id";--> statement-breakpoint
UPDATE "change_log" SET "entity_id" = split_part("change_log"."entity_id", '|', 1) || '|' || m."new_id"
FROM (VALUES ('accueil', 'formation.accueil'), ('elec', 'habilitation.he'), ('r484', 'formation.caces484'), ('r489', 'formation.caces489'), ('sst', 'formation.sst'), ('hauteur', 'habilitation.hauteur'), ('atex', 'habilitation.atex'), ('conduite', 'habilitation.ac489'), ('pont-ancien', 'formation.pontier'), ('auditeur-interne', 'formation.auditeur_interne')) AS m("old_id", "new_id")
WHERE "change_log"."entity_type" IN ('qualification', 'qualification_requirement') AND split_part("change_log"."entity_id", '|', 2) = m."old_id";--> statement-breakpoint
UPDATE "attachments" SET "entity_id" = split_part("attachments"."entity_id", '|', 1) || '|' || m."new_id"
FROM (VALUES ('accueil', 'formation.accueil'), ('elec', 'habilitation.he'), ('r484', 'formation.caces484'), ('r489', 'formation.caces489'), ('sst', 'formation.sst'), ('hauteur', 'habilitation.hauteur'), ('atex', 'habilitation.atex'), ('conduite', 'habilitation.ac489'), ('pont-ancien', 'formation.pontier'), ('auditeur-interne', 'formation.auditeur_interne')) AS m("old_id", "new_id")
WHERE "attachments"."entity_type" = 'qualification' AND split_part("attachments"."entity_id", '|', 2) = m."old_id";--> statement-breakpoint
UPDATE "notification_reads" SET "item_key" = regexp_replace("item_key", '([?&]titre=)' || m."old_id" || '([^a-z0-9_.-]|$)', '\1' || m."new_id" || '\2', 'g')
FROM (VALUES ('accueil', 'formation.accueil'), ('elec', 'habilitation.he'), ('r484', 'formation.caces484'), ('r489', 'formation.caces489'), ('sst', 'formation.sst'), ('hauteur', 'habilitation.hauteur'), ('atex', 'habilitation.atex'), ('conduite', 'habilitation.ac489'), ('pont-ancien', 'formation.pontier'), ('auditeur-interne', 'formation.auditeur_interne')) AS m("old_id", "new_id")
WHERE "notification_reads"."item_key" ~ ('[?&]titre=' || m."old_id" || '([^a-z0-9_.-]|$)');
