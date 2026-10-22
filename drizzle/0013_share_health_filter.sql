-- É13 (audit de cohérence Vigie / Matrix / Keystone, 22/10/2026) : un projet qui n'a qu'un accident du travail (AT) ou
-- une maladie professionnelle (MP) apparaissait dans pub_hse_projet (ligne « Registre presqu'accidents · 0 déclaré »),
-- ce qui révélait l'existence d'un événement réservé aux données de santé. Le CTE projets écarte désormais les types
-- AT et MP (HEALTH_EVENT_TYPES et l'accident du travail, src/lib/domain.ts). Vue de 0009 reprise à l'identique : mêmes
-- colonnes, même ordre, mêmes types (contrat D13 v1, CREATE OR REPLACE VIEW). Noms non qualifiés (serveur : schéma
-- vigie par le search_path). Copie Matrix à mettre à jour : infra/postgres/partage/50-vigie.sql (demande par REQUESTS.md).
CREATE OR REPLACE VIEW "pub_hse_projet" WITH (security_barrier) AS
WITH projets AS (
  SELECT keystone_project_code AS project_code FROM "prevention_plans" WHERE keystone_project_code IS NOT NULL AND status <> 'annule'
  UNION SELECT keystone_project_code FROM "permits" WHERE keystone_project_code IS NOT NULL AND status <> 'annule'
  UNION SELECT keystone_project_code FROM "events" WHERE keystone_project_code IS NOT NULL AND dismissed_at IS NULL
        AND type NOT IN ('AT', 'MP')
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
COMMENT ON VIEW "pub_hse_projet" IS 'Contrat D13 v1 : registre HSE par projet Keystone (plans de prévention, permis, nombre de presqu''accidents). Un accident du travail ou une maladie professionnelle ne fait pas apparaître un projet (0013). Lecteurs : keystone_app, matrix_app.';
