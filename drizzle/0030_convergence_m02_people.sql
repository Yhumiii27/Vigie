-- D01 de Matrix (convergence M-02), décision CV-10 du 03/11/2026 : people devient un cache de cursus.pub_salaries
-- (src/server/foreign-sync.ts). État dans Cursus, catégorie, entreprise et e-mail publiés (contrat D01 v2), fiche remplacée
-- lors d'un rattachement (src/server/people.ts). Aucune colonne publiée modifiée.
ALTER TABLE "people" ADD COLUMN "cursus_state" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "company" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "cursus_email" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "replaced_by_id" text;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_replaced_by_id_people_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_cursus_state_check" CHECK ("people"."cursus_state" in ('actif', 'absent'));--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_category_check" CHECK ("people"."category" in ('salarie', 'interimaire', 'exterieur'));