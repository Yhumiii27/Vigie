-- Partage des données EPC2I (serveur commun, décision M-01) : vues pub_ publiées par Vigie, d'après
-- infra/postgres/partage/50-vigie.sql du dépôt Matrix (D13 non-conformités et HSE de projet, D18 journal), adaptées au
-- schéma actuel de Vigie. Migration écrite à la main (drizzle-kit ne gère pas les vues) ; colonnes prérequises :
-- migration 0008_partage_prerequis.
--
-- Noms non qualifiés : les vues sont créées dans le premier schéma du search_path, public en PGlite (démonstration,
-- application Mac, tests), vigie sur le serveur (search_path du pool, src/db/index.ts). Elles ne lisent que des tables
-- du même schéma. Droits des lecteurs (keystone_app, matrix_app…) : Matrix, partage/90-droits.sql.
--
-- Contrat : on n'en retire ni ne renomme de colonne (sinon nouvelle vue _v2) ; ajout en fin de liste seulement. Une
-- migration qui touche une colonne lue ici recrée la vue (CREATE OR REPLACE VIEW).
-- Données de santé : aucune vue ne lit events.injury, events.lost_days ni aucune colonne de HEALTH_LABELS
-- (src/components/events/shared.ts) ; un accident du travail (type AT) n'entre dans aucune vue, son journal non plus.
-- security_barrier : les filtres de la vue s'évaluent avant toute fonction posée par le lecteur.

-- D13 · Non-conformités de projet (miroir Keystone vigie_ncrs). Événements NC portant un code projet Keystone et un
-- numéro NCR, hors classés sans suite. closed_on et vigie_updated_at sont calculés (passage à « Clôturé » dans
-- event_steps ; dernière écriture d'après event_steps et change_log), jamais stockés.
CREATE OR REPLACE VIEW "pub_non_conformites" WITH (security_barrier) AS
SELECT e.keystone_project_code AS project_code,
       e.nc_number             AS number,
       e.id                    AS vigie_ref,
       e.title,
       CASE WHEN e.severity >= 3 THEN 'critical' WHEN e.severity = 2 THEN 'major' ELSE 'minor' END AS severity,
       CASE e.nc_origin WHEN 'Fournisseurs' THEN 'goods_receipt' WHEN 'Fabrication' THEN 'workshop'
            WHEN 'Mise en service' THEN 'site_inspection' WHEN 'Inspection chantier' THEN 'site_inspection'
            WHEN 'Relevé' THEN 'survey' WHEN 'Audit' THEN 'audit' WHEN 'Réclamation client' THEN 'client'
            WHEN 'Conception BE' THEN 'design' ELSE 'workshop' END AS source,
       (ARRAY['open', 'containment', 'root_cause', 'corrective_action', 'verification', 'closed'])[least(e.step, 5) + 1] AS status,
       e.keystone_activity_code      AS activity_code,
       e.part_ref,
       e.keystone_deliverable_number AS deliverable_number,
       e.supplier_id,
       e.supplier_name,
       CASE WHEN e.anonymous THEN 'Anonyme' ELSE coalesce(e.declarant, 'Anonyme') END AS raised_by_name,
       e.occurred_on                 AS raised_on,
       coalesce(p.name, '—')         AS owner_name,
       p.matricule                   AS owner_matricule,
       coalesce(e.root_cause, '')    AS root_cause,
       coalesce(concat_ws(' · ', nullif(e.immediate_measures, ''), act.titres), '') AS action,
       act.prochaine_echeance        AS due_on,
       coalesce(e.nc_cost_keur, 0)   AS cost_keur,
       coalesce(e.iso_clause, '')    AS iso_clause,
       CASE WHEN e.step >= 5 THEN st.closed_on END AS closed_on,
       greatest(e.created_at, st.last_at, jl.last_at) AS vigie_updated_at
FROM "events" e
LEFT JOIN "people" p ON p.id = e.pilot_id
LEFT JOIN LATERAL (
  -- Libellé d'une action : première ligne non vide du détail, espaces réduits, 90 caractères (actionLabel).
  SELECT string_agg(coalesce(nullif(left(btrim(regexp_replace(substring(a.detail from '[^\r\n]*\S[^\r\n]*'), '\s+', ' ', 'g')), 90), ''),
                             'Action sans détail'), ' · ' ORDER BY a.due_on, a.id) AS titres,
         min(a.due_on) FILTER (WHERE a.status NOT IN ('terminee', 'verifiee', 'abandonnee')) AS prochaine_echeance
  FROM "actions" a
  WHERE a.event_id = e.id AND a.status <> 'abandonnee'
) act ON true
LEFT JOIN LATERAL (
  SELECT max(s.at) AS last_at,
         (max(s.at) FILTER (WHERE s.kind = 'advance' AND s.to_step = 5) AT TIME ZONE 'Europe/Paris')::date AS closed_on
  FROM "event_steps" s
  WHERE s.event_id = e.id
) st ON true
LEFT JOIN LATERAL (
  SELECT max(l.at) AS last_at FROM "change_log" l WHERE l.entity_type = 'event' AND l.entity_id = e.id
) jl ON true
WHERE e.type = 'NC' AND e.keystone_project_code IS NOT NULL AND e.nc_number IS NOT NULL AND e.dismissed_at IS NULL;
--> statement-breakpoint
COMMENT ON VIEW "pub_non_conformites" IS 'Contrat D13 v1 : NC de projet (type NC, code projet et numéro renseignés, hors classées sans suite). Ni injury ni lost_days. Lecteurs : keystone_app, matrix_app.';
--> statement-breakpoint

-- D13 · Registre HSE de projet (miroir Keystone vigie_hse_items) : plans de prévention et permis non annulés portant
-- un code projet Keystone, puis le nombre de presqu'accidents du projet. Pas de ligne « induction » : Vigie n'a pas
-- d'accueils sécurité de chantier (table inductions de 50-vigie.sql non créée, D13 à arbitrer).
CREATE OR REPLACE VIEW "pub_hse_projet" WITH (security_barrier) AS
WITH projets AS (
  SELECT keystone_project_code AS project_code FROM "prevention_plans" WHERE keystone_project_code IS NOT NULL AND status <> 'annule'
  UNION SELECT keystone_project_code FROM "permits" WHERE keystone_project_code IS NOT NULL AND status <> 'annule'
  UNION SELECT keystone_project_code FROM "events" WHERE keystone_project_code IS NOT NULL AND dismissed_at IS NULL
), lignes AS (
  SELECT pp.keystone_project_code AS project_code, pp.id AS vigie_ref, 'prevention_plan'::text AS kind,
         'Plan de prévention · ' || pp.title AS title,
         CASE WHEN pp.status IN ('signe', 'clos') THEN 'signed' ELSE 'pending' END AS status,
         NULL::text AS status_text,
         CASE WHEN pp.status IN ('signe', 'clos') THEN greatest(pp.signed_eu_on, pp.signed_ee_on) ELSE pp.start_on END AS date_on,
         1 AS groupe, pp.start_on AS tri
  FROM "prevention_plans" pp
  WHERE pp.keystone_project_code IS NOT NULL AND pp.status <> 'annule'
  UNION ALL
  SELECT pe.keystone_project_code, pe.id, 'permit',
         CASE pe.type WHEN 'feu' THEN 'Permis de feu' WHEN 'essai' THEN 'Permis d''essai' WHEN 'levage' THEN 'Permis de levage'
                      WHEN 'travail_ht' THEN 'Permis de travail HT' ELSE 'Permis' END || ' · ' || pe.location,
         CASE pe.status WHEN 'demande' THEN 'pending' WHEN 'delivre' THEN 'signed' ELSE 'recorded' END,
         NULL, (pe.valid_from AT TIME ZONE 'Europe/Paris')::date, 2, (pe.valid_from AT TIME ZONE 'Europe/Paris')::date
  FROM "permits" pe
  WHERE pe.keystone_project_code IS NOT NULL AND pe.status <> 'annule'
  UNION ALL
  SELECT x.project_code, NULL, 'register', 'Registre presqu''accidents', 'recorded',
         count(ev.id) || CASE WHEN count(ev.id) > 1 THEN ' déclarés' ELSE ' déclaré' END, NULL, 3, NULL
  FROM projets x
  LEFT JOIN "events" ev ON ev.keystone_project_code = x.project_code AND ev.type = 'PA' AND ev.dismissed_at IS NULL
  GROUP BY x.project_code
)
SELECT project_code,
       vigie_ref,
       kind,
       title,
       status,
       status_text,
       date_on,
       (row_number() OVER (PARTITION BY project_code ORDER BY groupe, tri NULLS LAST, vigie_ref) - 1)::integer AS position
FROM lignes;
--> statement-breakpoint
COMMENT ON VIEW "pub_hse_projet" IS 'Contrat D13 v1 : registre HSE par projet Keystone (plans de prévention, permis, nombre de presqu''accidents). Lecteurs : keystone_app, matrix_app.';
--> statement-breakpoint

-- D18 · Journal (colonnes communes aux quatre pub_journal, réunies par matrix.journal_unifie) : journal des
-- modifications de Vigie (change_log, écrit par logChange), sans le motif ni le détail des champs (details), qui
-- peuvent porter des données de santé. Écartés : les entrées d'un accident du travail et du registre des accidents
-- bénins (benign_accident). Auteur absent (signalement anonyme, tâche du serveur) : « Anonyme ». qui_role : dernier
-- rôle connu de l'auteur (people.last_role), Vigie ne journalisant pas le rôle de l'écriture.
CREATE OR REPLACE VIEW "pub_journal" WITH (security_barrier) AS
SELECT 'change_log:' || l.id::text           AS ref_source,
       'audit'::text                         AS nature,
       l.at                                  AS quand,
       coalesce(p.name, 'Anonyme')           AS qui,
       l.by_id                               AS qui_ref,
       p.last_role                           AS qui_role,
       l.entity_type || '.' || l.action      AS action,
       l.entity_type || ':' || l.entity_id   AS objet,
       l.summary                             AS detail,
       coalesce(ev.keystone_project_code, pp.keystone_project_code, pe.keystone_project_code) AS projet,
       p.matricule                           AS qui_matricule
FROM "change_log" l
LEFT JOIN "people" p ON p.id = l.by_id
LEFT JOIN "events" ev ON l.entity_type = 'event' AND ev.id = l.entity_id
LEFT JOIN "prevention_plans" pp ON l.entity_type = 'prevention_plan' AND pp.id = l.entity_id
LEFT JOIN "permits" pe ON l.entity_type = 'permit' AND pe.id = l.entity_id
WHERE l.entity_type <> 'benign_accident' AND ev.type IS DISTINCT FROM 'AT';
--> statement-breakpoint
COMMENT ON VIEW "pub_journal" IS 'Contrat D18 v1 : journal des modifications de Vigie (change_log) aux colonnes communes, sans motif ni détail des champs, hors accidents du travail et registre des accidents bénins. Lecteur : matrix_app (matrix.journal_unifie).';
