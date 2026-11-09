-- Matricule de site publié par Cursus (lot 14 de Cursus ; proposition de publication en attente du propriétaire et de
-- Matrix, docs/specs/convergence-m02.md § 7 sexies) : « I… » (intérimaire) ou « E… » (extérieur), permanent, jamais
-- réattribué, null pour un salarié ; cache de la colonne `matricule_site` de cursus.pub_salaries quand la vue la porte
-- (src/server/foreign-sync.ts), clé de rapprochement des présences prévues avec le matricule Cursus (poste de garde).
-- Aucune colonne publiée modifiée.
ALTER TABLE "people" ADD COLUMN "site_matricule" text;--> statement-breakpoint
CREATE UNIQUE INDEX "people_site_matricule_unique" ON "people" USING btree ("site_matricule") WHERE "people"."site_matricule" is not null;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_site_matricule_check" CHECK ("people"."site_matricule" ~ '^[IE][0-9]+$');--> statement-breakpoint
-- Jeu de démonstration (PGlite, application Mac) : les intérimaires et extérieurs repris de Cursus portaient les anciens
-- matricules « I-9101 », « E-9201 »… ; Cursus publie désormais le matricule « EMP-… » pour tous et le matricule de site
-- à part. Réécrits ici, pour ces seules valeurs du jeu (matricule et nom entre crochets), afin qu'un rafraîchissement ne
-- crée pas de doublons ni ne marque les anciennes fiches « absentes ». Sans effet sur toute autre base.
UPDATE "people" SET "matricule" = m."new_matricule", "site_matricule" = m."site_matricule" FROM (VALUES ('I-9101', '[D. Garnier]', 'EMP-9101', 'I00101'), ('I-9102', '[C. Barbier]', 'EMP-9102', 'I00102'), ('E-9201', '[F. Rousseau]', 'EMP-9201', 'E00201'), ('E-9202', '[B. Morel]', 'EMP-9202', 'E00202'), ('E-9203', '[L. Fabre]', 'EMP-9203', 'E00203'), ('E-9204', '[P. Henry]', 'EMP-9204', 'E00204')) AS m("old_matricule", "name", "new_matricule", "site_matricule") WHERE "people"."matricule" = m."old_matricule" AND "people"."name" = m."name" AND NOT EXISTS (SELECT 1 FROM "people" o WHERE o."matricule" = m."new_matricule" OR o."site_matricule" = m."site_matricule");
