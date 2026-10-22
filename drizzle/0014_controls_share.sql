ALTER TABLE "controls" ADD COLUMN "equipment_code" text;
--> statement-breakpoint
-- Demande de Crucible du 22/10/2026 (REQUESTS.md, validée par Guillaume) : contrôles périodiques publiés avec le code
-- commun de l'équipement (controls.equipment_code, colonne ci-dessus), pour que Crucible bloque la réservation d'un
-- moyen d'essai dont le contrôle réglementaire est échu (Crucible R-6, S-4, V-1). Vue écrite à la main (drizzle-kit ne
-- gère pas les vues), noms non qualifiés : public en PGlite, vigie sur le serveur (search_path du pool).
--
-- Contrat Crucible v1 : on n'en retire ni ne renomme de colonne (sinon nouvelle vue _v2) ; ajout en fin de liste
-- seulement. Tous les contrôles sont publiés, en vigueur et archivés (« archive ») ; Crucible garde ceux dont
-- equipement_code correspond à un de ses moyens. Aucune donnée de personne (ni responsable, ni auteur, ni motif
-- d'archivage) ni de santé ; du journal, seule la date (ni motif ni détail).
--  - vigie_ref : identifiant du contrôle (controls.id en texte, celui du lien profond /veille?onglet=controles&controle=<id>
--    et de change_log.entity_id) ;
--  - site_code : site de Vigie (sites.id ; null = tous les sites), pas encore au format de matrix.sites.code (écart É8) ;
--  - maj_le : dernière écriture connue du contrôle, calculée (jamais stockée) : journal du contrôle (fiche, contrôles
--    enregistrés ou annulés, pièces jointes, archivage, actions rattachées) et enregistrements ; null sans trace.
-- Copie Matrix à créer : infra/postgres/partage/50-vigie.sql ; droit de lecture de crucible_app : partage/90-droits.sql
-- (demandes par le REQUESTS.md de Matrix).
CREATE OR REPLACE VIEW "pub_controles" WITH (security_barrier) AS
SELECT c.id::text            AS vigie_ref,
       c.site_id             AS site_code,
       c.equipment           AS equipement,
       c.equipment_code      AS equipement_code,
       c.control_type        AS type_controle,
       c.organization        AS organisme,
       c.period_months       AS periodicite_mois,
       c.last_on             AS dernier_le,
       c.next_on             AS prochain_le,
       c.reserves            AS reserves,
       c.archived_at IS NOT NULL AS archive,
       greatest(c.archived_at, jl.last_at, rec.last_at) AS maj_le
FROM "controls" c
LEFT JOIN LATERAL (
  SELECT max(l.at) AS last_at FROM "change_log" l WHERE l.entity_type = 'control' AND l.entity_id = c.id::text
) jl ON true
LEFT JOIN LATERAL (
  SELECT max(greatest(r.created_at, r.cancelled_at)) AS last_at FROM "control_records" r WHERE r.control_id = c.id
) rec ON true;
--> statement-breakpoint
COMMENT ON VIEW "pub_controles" IS 'Contrat Crucible v1 : contrôles périodiques (en vigueur et archivés) avec le code commun de l''équipement (equipement_code, null s''il n''est pas renseigné) ; maj_le = dernière écriture connue (journal et enregistrements), null sans trace. Ni personne ni donnée de santé. Colonnes ajoutées en fin seulement. Lecteur : crucible_app (droit accordé par Matrix, 90-droits.sql).';
