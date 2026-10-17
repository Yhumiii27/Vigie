ALTER TABLE "qualification_requirements" DROP CONSTRAINT "qualification_requirements_renewal_action_id_actions_id_fk";
--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "qualification_person_id" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "qualification_title_id" text;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_qualification_person_id_people_id_fk" FOREIGN KEY ("qualification_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_qualification_title_id_training_titles_id_fk" FOREIGN KEY ("qualification_title_id") REFERENCES "public"."training_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- HAB-04 : l'habilitation d'une action de recyclage reprise passe sur l'action (conservée quand elle est close ou abandonnée, ou quand le titre n'est plus requis).
UPDATE "actions" SET "qualification_person_id" = q."person_id", "qualification_title_id" = q."title_id" FROM "qualification_requirements" q WHERE q."renewal_action_id" = "actions"."id";--> statement-breakpoint
ALTER TABLE "qualification_requirements" DROP COLUMN "renewal_action_id";