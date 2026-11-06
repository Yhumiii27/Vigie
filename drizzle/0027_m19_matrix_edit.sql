-- Demande M-19 de Matrix (décision du 05/11/2026 : « l'admin IT peut modifier toutes les données à l'exception des
-- données sensibles RGPD », par les outils). Matrix n'écrit jamais dans les tables de Vigie (M-18) : il appelle
-- vigie.pub_editer (fin de fichier), qui n'ouvre que les tables et colonnes du registre ci-dessous, applique les contrôles
-- de la saisie dans Vigie et écrit le journal de Vigie (change_log) dans la même transaction. Spec :
-- docs/specs/edition-matrix-m19.md. Aucune vue pub_ (M-18).
CREATE TABLE "external_edit_columns" (
	"table_name" text NOT NULL,
	"column_name" text NOT NULL,
	"label" text NOT NULL,
	"max_length" integer,
	"required" boolean DEFAULT false NOT NULL,
	"choices" jsonb,
	"min_value" integer,
	"max_value" integer,
	"pattern" text,
	CONSTRAINT "external_edit_columns_table_name_column_name_pk" PRIMARY KEY("table_name","column_name")
);
--> statement-breakpoint
CREATE TABLE "external_edit_tables" (
	"table_name" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"entity_type" text NOT NULL,
	"key_column" text NOT NULL,
	"entity_id_column" text,
	"can_add" boolean DEFAULT false NOT NULL,
	"can_remove" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_edit_columns" ADD CONSTRAINT "external_edit_columns_table_name_external_edit_tables_table_name_fk" FOREIGN KEY ("table_name") REFERENCES "public"."external_edit_tables"("table_name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Registre de la phase 1 : référentiels et registres sans circuit, colonnes descriptives dont la saisie dans Vigie ne fait
-- que des contrôles de présence, de longueur, de liste ou de bornes (repris ici). Libellés = ceux du journal de Vigie.
-- « Ajouter » : tables dont la création ne tire ni référence, ni notification, ni circuit. « Retirer » : archivage motivé,
-- pour les tables dont l'archivage dans Vigie n'a pas d'autre règle.
INSERT INTO "public"."external_edit_tables" ("table_name", "label", "entity_type", "key_column", "entity_id_column", "can_add", "can_remove") VALUES
  ('sites', 'Site', 'site', 'id', NULL, false, false),
  ('map_zones', 'Zone de la carte', 'site_map', 'id', 'site_id', false, false),
  ('waste_streams', 'Filière de déchets', 'waste_stream', 'id', NULL, false, true),
  ('contractors', 'Entreprise extérieure', 'contractor', 'id', NULL, false, false),
  ('context_items', 'Élément du contexte', 'context_item', 'id', NULL, true, true),
  ('qhse_objectives', 'Objectif QHSE', 'qhse_objective', 'id', NULL, false, true),
  ('requirements', 'Exigence réglementaire', 'requirement', 'id', NULL, false, false),
  ('controls', 'Contrôle périodique', 'control', 'id', NULL, false, true),
  ('emergency_situations', 'Situation d''urgence', 'emergency_situation', 'id', NULL, true, true),
  ('certifications', 'Référentiel de certification', 'certification', 'id', NULL, false, false),
  ('training_titles', 'Titre suivi', 'training_title', 'id', NULL, false, false);--> statement-breakpoint
INSERT INTO "public"."external_edit_columns" ("table_name", "column_name", "label", "max_length", "required", "choices", "min_value", "max_value", "pattern") VALUES
  ('sites', 'seveso', 'Classement Seveso', NULL, false, '{"seuil_haut": "Seuil haut", "seuil_bas": "Seuil bas"}', NULL, NULL, NULL),
  ('sites', 'pp_from_first_minute', 'Plan de prévention dès la première minute', NULL, false, NULL, NULL, NULL, NULL),
  ('sites', 'alsace_moselle', 'Droit local d’Alsace-Moselle', NULL, false, NULL, NULL, NULL, NULL),
  ('map_zones', 'name', 'Nom', 80, true, NULL, NULL, NULL, NULL),
  ('map_zones', 'kind', 'Type', NULL, true, '{"batiment": "Bâtiment", "atelier": "Atelier", "stockage": "Stockage", "atex": "Zone ATEX", "essais": "Zone d''essais", "quai": "Quai", "parking": "Parking", "exterieur": "Aire extérieure", "autre": "Autre"}', NULL, NULL, NULL),
  ('map_zones', 'notes', 'Notes', 1000, false, NULL, NULL, NULL, NULL),
  ('waste_streams', 'channel', 'Filière de traitement', 80, true, NULL, NULL, NULL, NULL),
  ('waste_streams', 'collector', 'Collecteur', 160, true, NULL, NULL, NULL, NULL),
  ('waste_streams', 'collector_address', 'Adresse du collecteur', 300, false, NULL, NULL, NULL, NULL),
  ('waste_streams', 'collector_receipt', 'N° de récépissé (collecteur)', 60, false, NULL, NULL, NULL, NULL),
  ('waste_streams', 'destination', 'Installation de destination', 200, true, NULL, NULL, NULL, NULL),
  ('waste_streams', 'destination_address', 'Adresse de l''installation', 300, false, NULL, NULL, NULL, NULL),
  ('contractors', 'trade', 'Corps de métier', 120, true, NULL, NULL, NULL, NULL),
  ('contractors', 'contact_name', 'Interlocuteur', 120, false, NULL, NULL, NULL, NULL),
  ('contractors', 'contact_phone', 'Téléphone', 40, false, NULL, NULL, NULL, NULL),
  ('contractors', 'contact_email', 'E-mail', 160, false, NULL, NULL, NULL, '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  ('context_items', 'kind', 'Nature', NULL, true, '{"enjeu_externe": "Enjeu externe", "enjeu_interne": "Enjeu interne", "partie_interessee": "Partie intéressée", "risque": "Risque", "opportunite": "Opportunité"}', NULL, NULL, NULL),
  ('context_items', 'label', 'Intitulé', 200, true, NULL, NULL, NULL, NULL),
  ('context_items', 'detail', 'Description, attentes', 2000, false, NULL, NULL, NULL, NULL),
  ('context_items', 'treatment', 'Traitement', 2000, false, NULL, NULL, NULL, NULL),
  ('qhse_objectives', 'label', 'Objectif', 200, true, NULL, NULL, NULL, NULL),
  ('requirements', 'text', 'Texte', 120, true, NULL, NULL, NULL, NULL),
  ('requirements', 'domain', 'Domaine', 120, true, NULL, NULL, NULL, NULL),
  ('requirements', 'summary', 'Ce qu''il exige', 1000, true, NULL, NULL, NULL, NULL),
  ('requirements', 'impact', 'Impact', 300, false, NULL, NULL, NULL, NULL),
  ('controls', 'equipment', 'Équipement', 160, true, NULL, NULL, NULL, NULL),
  ('controls', 'control_type', 'Type de contrôle', 120, true, NULL, NULL, NULL, NULL),
  ('controls', 'organization', 'Organisme', 120, true, NULL, NULL, NULL, NULL),
  ('controls', 'tolerance', 'Tolérance (EMT)', 120, false, NULL, NULL, NULL, NULL),
  ('emergency_situations', 'site_id', 'Site', NULL, true, NULL, NULL, NULL, NULL),
  ('emergency_situations', 'label', 'Situation', 160, true, NULL, NULL, NULL, NULL),
  ('emergency_situations', 'scenario', 'Scénario', 2000, false, NULL, NULL, NULL, NULL),
  ('emergency_situations', 'response', 'Moyens et consignes', 2000, false, NULL, NULL, NULL, NULL),
  ('emergency_situations', 'drill_months', 'Périodicité des exercices (mois)', NULL, true, NULL, 1, 60, NULL),
  ('certifications', 'domain', 'Domaine', 60, true, NULL, NULL, NULL, NULL),
  ('certifications', 'standard', 'Référentiel', 80, true, NULL, NULL, NULL, NULL),
  ('certifications', 'note', 'Note', 240, false, NULL, NULL, NULL, NULL),
  ('certifications', 'organization', 'Organisme', 120, false, NULL, NULL, NULL, NULL),
  ('training_titles', 'first_aid', 'Secourisme', NULL, false, NULL, NULL, NULL, NULL),
  ('training_titles', 'awareness', 'Sensibilisation', NULL, false, NULL, NULL, NULL, NULL),
  ('training_titles', 'internal_auditor', 'Auditeur interne', NULL, false, NULL, NULL, NULL, NULL);--> statement-breakpoint
-- Refus inscrits dans la base, indépendants du registre (un registre erroné n'ouvrirait jamais ces colonnes) : données de
-- santé (HEALTH_LABELS de src/lib/rules/events.ts, attachments.health), identifiants et références, ordre, états et
-- étapes, triplets d'archivage et d'annulation, auteurs et dates de saisie, versions, clés et données tenues par un autre
-- outil (Matrix, Keystone, Cursus, Crucible), changement de site après la création. Renvoie le motif du refus, ou NULL.
CREATE FUNCTION "public"."external_edit_denied"(p_table text, p_column text, p_action text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
    WHEN p_column = ANY (ARRAY['injury', 'lost_days', 'cpam_declared_on', 'lesion_nature', 'lesion_site', 'care_given', 'reserves_on',
      'cpam_waived_at', 'cpam_waived_by_id', 'cpam_waiver_reason', 'mp_table', 'mp_disease', 'mp_certificate_on', 'mp_informed_on',
      'mp_questionnaire_received_on', 'mp_questionnaire_returned_on', 'health', 'care', 'care_given_at', 'caregiver_id',
      'caregiver_name', 'caregiver_qualification']) THEN 'donnée de santé'
    WHEN p_column ~ '^(id|ref|reference|number|sort|step|status|state|version|qr_version|polygon|nc_number)$'
      OR p_column ~ '^(archived|archive|cancelled|cancel|created|updated|dismissed|dismiss|hidden|hide|removed|remove|suspended|suspend|acknowledged|acknowledge|escalated|validated|closed)_'
      OR p_column ~ '_(state|status|step|version|by_id)$' THEN 'identifiant, ordre, état ou suivi tenu par Vigie'
    WHEN p_column ~ '^keystone_' OR p_column = ANY (ARRAY['supplier_id', 'capex_code', 'equipment_code', 'matricule', 'entra_object_id'])
      OR (p_table || '.' || p_column) = ANY (ARRAY['sites.label', 'training_titles.label', 'training_titles.validity_months'])
      THEN 'donnée ou clé tenue par un autre outil'
    WHEN p_column = 'site_id' AND p_action IS DISTINCT FROM 'ajouter' THEN 'le site ne change pas depuis Matrix (règles de Vigie)'
  END
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."external_edit_denied"(text, text, text) FROM PUBLIC;--> statement-breakpoint
-- Valeur affichée dans le journal (oui / non, libellé d'une liste, texte ; vide = NULL).
CREATE FUNCTION "public"."external_edit_shown"(p_choices jsonb, p_value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR jsonb_typeof(p_value) = 'null' OR p_value = '""'::jsonb THEN NULL
    WHEN jsonb_typeof(p_value) = 'boolean' THEN CASE WHEN p_value = 'true'::jsonb THEN 'oui' ELSE 'non' END
    WHEN p_choices IS NOT NULL THEN coalesce(p_choices ->> (p_value #>> '{}'), p_value #>> '{}')
    ELSE p_value #>> '{}'
  END
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."external_edit_shown"(jsonb, jsonb) FROM PUBLIC;--> statement-breakpoint
-- Fonction d'édition (M-19, convention docs/edition-par-les-outils.md de Matrix) : SECURITY DEFINER, identifiants tirés du
-- registre seulement (format %I), valeurs passées en paramètres (jsonb_populate_record), jamais concaténées. Ajoute,
-- corrige ou retire (archivage motivé) une ligne d'une table ouverte ; journal change_log de la fiche dans la même
-- transaction (auteur NULL, « … depuis Matrix par <p_par> (<session_user>) », motif = p_motif) : la version QUA-12 de la
-- fiche change, une saisie concurrente dans Vigie est refusée comme périmée. Renvoie la clé, les colonnes ouvertes et
-- archived_at. Refus : RAISE EXCEPTION, SQLSTATE P0V03, message en français montré tel quel par Matrix. Signature jamais
-- changée (une nouvelle version prend un nouveau nom). Exécution accordée par Matrix seulement (lien écriture matrix_app).
CREATE FUNCTION "public"."pub_editer"(p_table text, p_action text, p_cle jsonb, p_valeurs jsonb, p_par text, p_motif text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_schema text := current_schema();
  v_tbl record;
  v_col record;
  v_rel regclass;
  v_par text := btrim(coalesce(p_par, ''));
  v_motif text := btrim(coalesce(p_motif, ''));
  v_key text;
  v_clean jsonb := '{}'::jsonb;
  v_changed text[];
  v_name text;
  v_value jsonb;
  v_text text;
  v_num numeric;
  v_next integer;
  v_type text;
  v_notnull boolean;
  v_denied text;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb;
  v_merged jsonb;
  v_details jsonb;
  v_list text;
  v_action text;
  v_verb text;
  v_summary text;
  v_constraint text;
  v_column text;
  v_has_archive boolean;
  v_result jsonb;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('ajouter', 'corriger', 'retirer') THEN
    RAISE EXCEPTION 'Action inconnue : « ajouter », « corriger » ou « retirer » attendue.' USING ERRCODE = 'P0V03';
  END IF;
  IF v_par = '' THEN
    RAISE EXCEPTION 'Nom de la personne connectée à Matrix (p_par) obligatoire.' USING ERRCODE = 'P0V03';
  END IF;
  IF char_length(v_par) > 200 OR v_par ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Nom de la personne connectée à Matrix (p_par) invalide : 200 caractères au plus, sans caractère de contrôle.' USING ERRCODE = 'P0V03';
  END IF;
  -- Règle commune des motifs de Vigie (reasonError, src/lib/forms.ts : obligatoire, REASON_MAX = 1000 caractères).
  IF v_motif = '' THEN
    RAISE EXCEPTION 'Motif obligatoire.' USING ERRCODE = 'P0V03';
  END IF;
  IF char_length(v_motif) > 1000 THEN
    RAISE EXCEPTION 'Motif : 1000 caractères au maximum.' USING ERRCODE = 'P0V03';
  END IF;

  -- Table : jamais une table métier à circuit, un journal, une donnée personnelle, un cache d'un autre outil ni le
  -- registre lui-même, quel que soit le registre ; sinon celles du registre seulement.
  IF p_table IS NULL OR p_table ~ '^(events|event_.*|benign_accidents|attachments|people|actions|action_.*|notifications|notification_reads|change_log|access_log|sync_runs|inbound_.*|report_rate_limits|ai_usage|keystone_assignments|hours_worked|external_edit_.*|__drizzle_migrations)$' THEN
    RAISE EXCEPTION 'Table fermée à l''édition depuis Matrix : %.', coalesce(p_table, '(aucune)') USING ERRCODE = 'P0V03';
  END IF;
  SELECT * INTO v_tbl FROM "public"."external_edit_tables" t WHERE t.table_name = p_table;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Table non ouverte à l''édition depuis Matrix : %.', p_table USING ERRCODE = 'P0V03';
  END IF;
  v_rel := to_regclass(format('%I.%I', v_schema, v_tbl.table_name));
  IF v_rel IS NULL THEN
    RAISE EXCEPTION 'Table introuvable dans Vigie : %.', p_table USING ERRCODE = 'P0V03';
  END IF;
  SELECT count(*) = 3 INTO v_has_archive FROM pg_attribute a
  WHERE a.attrelid = v_rel AND a.attname IN ('archived_at', 'archived_by_id', 'archive_reason') AND a.attnum > 0 AND NOT a.attisdropped;

  -- Clé : la clé primaire seule (corriger, retirer) ; aucune pour ajouter.
  IF p_action = 'ajouter' THEN
    IF NOT v_tbl.can_add THEN
      RAISE EXCEPTION '% : ajout non ouvert depuis Matrix (création à faire dans Vigie).', v_tbl.label USING ERRCODE = 'P0V03';
    END IF;
    IF p_cle IS NOT NULL AND jsonb_typeof(p_cle) <> 'null' THEN
      RAISE EXCEPTION 'Clé (p_cle) inutile pour « ajouter » : laissez-la vide.' USING ERRCODE = 'P0V03';
    END IF;
  ELSE
    IF p_cle IS NULL OR jsonb_typeof(p_cle) <> 'object'
       OR (SELECT array_agg(k) FROM jsonb_object_keys(p_cle) k) IS DISTINCT FROM ARRAY[v_tbl.key_column]
       OR jsonb_typeof(p_cle -> v_tbl.key_column) NOT IN ('string', 'number') THEN
      RAISE EXCEPTION 'Clé (p_cle) invalide : {"%": …} attendu.', v_tbl.key_column USING ERRCODE = 'P0V03';
    END IF;
    v_key := p_cle ->> v_tbl.key_column;
  END IF;

  -- Valeurs : colonnes ouvertes seulement, contrôles de la saisie dans Vigie (texte sans espaces de début et de fin, vide =
  -- NULL ou chaîne vide selon la colonne, longueur, obligatoire, liste, format ; booléen ; entier borné).
  IF p_action = 'retirer' THEN
    IF NOT v_tbl.can_remove OR NOT v_has_archive THEN
      RAISE EXCEPTION '% : retrait non ouvert depuis Matrix (à faire dans Vigie, qui applique ses règles d''archivage).', v_tbl.label USING ERRCODE = 'P0V03';
    END IF;
    IF p_valeurs IS NOT NULL AND jsonb_typeof(p_valeurs) <> 'null' AND p_valeurs <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Valeurs (p_valeurs) inutiles pour « retirer » : laissez-les vides.' USING ERRCODE = 'P0V03';
    END IF;
  ELSE
    IF p_valeurs IS NULL OR jsonb_typeof(p_valeurs) <> 'object' OR p_valeurs = '{}'::jsonb THEN
      RAISE EXCEPTION 'Valeurs (p_valeurs) obligatoires : {"colonne": valeur} attendu.' USING ERRCODE = 'P0V03';
    END IF;
    FOR v_name, v_value IN SELECT e.key, e.value FROM jsonb_each(p_valeurs) e ORDER BY e.key LOOP
      v_denied := "public"."external_edit_denied"(v_tbl.table_name, v_name, p_action);
      IF v_denied IS NOT NULL THEN
        RAISE EXCEPTION 'Colonne refusée : % (%).', v_name, v_denied USING ERRCODE = 'P0V03';
      END IF;
      SELECT * INTO v_col FROM "public"."external_edit_columns" c WHERE c.table_name = v_tbl.table_name AND c.column_name = v_name;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Colonne non ouverte à l''édition depuis Matrix : %.%.', v_tbl.table_name, v_name USING ERRCODE = 'P0V03';
      END IF;
      SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull INTO v_type, v_notnull FROM pg_attribute a
      WHERE a.attrelid = v_rel AND a.attname = v_name AND a.attnum > 0 AND NOT a.attisdropped;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Colonne introuvable dans Vigie : %.%.', v_tbl.table_name, v_name USING ERRCODE = 'P0V03';
      END IF;
      IF v_type = 'text' THEN
        IF jsonb_typeof(v_value) NOT IN ('string', 'null') THEN
          RAISE EXCEPTION '« % » : texte attendu.', v_col.label USING ERRCODE = 'P0V03';
        END IF;
        v_text := nullif(btrim(v_value #>> '{}'), '');
        IF v_text IS NULL AND v_col.required THEN
          RAISE EXCEPTION '« % » : champ obligatoire.', v_col.label USING ERRCODE = 'P0V03';
        END IF;
        IF v_text IS NOT NULL AND v_col.max_length IS NOT NULL AND char_length(v_text) > v_col.max_length THEN
          RAISE EXCEPTION '« % » : % caractères au maximum.', v_col.label, v_col.max_length USING ERRCODE = 'P0V03';
        END IF;
        IF v_text IS NOT NULL AND v_col.pattern IS NOT NULL AND v_text !~ v_col.pattern THEN
          RAISE EXCEPTION '« % » : format invalide.', v_col.label USING ERRCODE = 'P0V03';
        END IF;
        IF v_text IS NOT NULL AND v_col.choices IS NOT NULL AND NOT (v_col.choices ? v_text) THEN
          SELECT string_agg(k, ', ' ORDER BY k) INTO v_list FROM jsonb_object_keys(v_col.choices) k;
          RAISE EXCEPTION '« % » : valeur non autorisée (valeurs admises : %).', v_col.label, v_list USING ERRCODE = 'P0V03';
        END IF;
        v_value := CASE WHEN v_text IS NOT NULL THEN to_jsonb(v_text) WHEN v_notnull THEN '""'::jsonb ELSE 'null'::jsonb END;
      ELSIF v_type = 'boolean' THEN
        IF jsonb_typeof(v_value) <> 'boolean' THEN
          RAISE EXCEPTION '« % » : oui ou non attendu (true ou false).', v_col.label USING ERRCODE = 'P0V03';
        END IF;
      ELSIF v_type = 'integer' THEN
        IF jsonb_typeof(v_value) = 'null' THEN
          IF v_notnull OR v_col.required THEN
            RAISE EXCEPTION '« % » : champ obligatoire.', v_col.label USING ERRCODE = 'P0V03';
          END IF;
        ELSE
          IF jsonb_typeof(v_value) <> 'number' THEN
            RAISE EXCEPTION '« % » : nombre entier attendu.', v_col.label USING ERRCODE = 'P0V03';
          END IF;
          v_num := (v_value #>> '{}')::numeric;
          IF v_num <> trunc(v_num) THEN
            RAISE EXCEPTION '« % » : nombre entier attendu.', v_col.label USING ERRCODE = 'P0V03';
          END IF;
          IF v_num < coalesce(v_col.min_value, -2147483648) THEN
            RAISE EXCEPTION '« % » : minimum %.', v_col.label, coalesce(v_col.min_value, -2147483648) USING ERRCODE = 'P0V03';
          END IF;
          IF v_num > coalesce(v_col.max_value, 2147483647) THEN
            RAISE EXCEPTION '« % » : maximum %.', v_col.label, coalesce(v_col.max_value, 2147483647) USING ERRCODE = 'P0V03';
          END IF;
          v_value := to_jsonb(v_num::integer);
        END IF;
      ELSE
        RAISE EXCEPTION '« % » : type de colonne non pris en charge depuis Matrix (%).', v_col.label, v_type USING ERRCODE = 'P0V03';
      END IF;
      v_clean := v_clean || jsonb_build_object(v_name, v_value);
    END LOOP;
  END IF;

  -- Verrou d'écriture de Vigie (src/db/index.ts : clé hashtext('<schéma>.ecritures'), pris par chaque transaction de
  -- Vigie) : la lecture de la ligne, le contrôle de version QUA-12 d'une saisie concurrente et l'écriture se suivent.
  PERFORM pg_advisory_xact_lock(hashtext(v_schema || '.ecritures'));
  IF p_action = 'ajouter' THEN
    -- Colonnes obligatoires de la table et du registre ; site existant et suivi (requireInSite(…, { create: true })).
    FOR v_name IN SELECT a.attname FROM pg_attribute a
      WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull AND NOT a.atthasdef ORDER BY a.attnum LOOP
      IF NOT (v_clean ? v_name) THEN
        SELECT c.label INTO v_text FROM "public"."external_edit_columns" c WHERE c.table_name = v_tbl.table_name AND c.column_name = v_name;
        RAISE EXCEPTION '« % » : champ obligatoire.', coalesce(v_text, v_name) USING ERRCODE = 'P0V03';
      END IF;
    END LOOP;
    FOR v_col IN SELECT * FROM "public"."external_edit_columns" c WHERE c.table_name = v_tbl.table_name AND c.required ORDER BY c.column_name LOOP
      IF NOT (v_clean ? v_col.column_name) THEN
        RAISE EXCEPTION '« % » : champ obligatoire.', v_col.label USING ERRCODE = 'P0V03';
      END IF;
    END LOOP;
    IF v_clean ? 'site_id' AND NOT EXISTS (SELECT 1 FROM "public"."sites" s WHERE s.id = v_clean ->> 'site_id' AND s.archived_at IS NULL) THEN
      RAISE EXCEPTION '« Site » : site inconnu ou archivé dans Vigie (%).', v_clean ->> 'site_id' USING ERRCODE = 'P0V03';
    END IF;
    v_merged := v_clean;
  ELSE
    BEGIN
      EXECUTE format('SELECT to_jsonb(r) FROM %I.%I r WHERE r.%I = (jsonb_populate_record(NULL::%I.%I, $1)).%I FOR UPDATE',
        v_schema, v_tbl.table_name, v_tbl.key_column, v_schema, v_tbl.table_name, v_tbl.key_column) INTO v_before USING p_cle;
    EXCEPTION WHEN data_exception THEN
      v_before := NULL;
    END;
    IF v_before IS NULL THEN
      RAISE EXCEPTION '% introuvable : %.', v_tbl.label, v_key USING ERRCODE = 'P0V03';
    END IF;
    IF (v_before ->> 'archived_at') IS NOT NULL OR (v_before ->> 'cancelled_at') IS NOT NULL OR (v_before ->> 'hidden_at') IS NOT NULL THEN
      RAISE EXCEPTION 'Ligne archivée : % % ne se modifie plus depuis Matrix (à réactiver d''abord dans Vigie).', v_tbl.label, v_key USING ERRCODE = 'P0V03';
    END IF;
    v_merged := v_before || v_clean;
  END IF;

  -- Règles propres à une table, reprises de la saisie dans Vigie.
  IF p_action <> 'retirer' AND v_tbl.table_name = 'context_items' AND (v_merged ->> 'kind') IN ('risque', 'opportunite')
     AND btrim(coalesce(v_merged ->> 'treatment', '')) = '' THEN
    -- saveContextItem (src/server/context.ts) : traitement exigé pour un risque ou une opportunité (ISO 9001 §6.1.2).
    RAISE EXCEPTION '« Traitement » : indiquez le traitement prévu (actions, maîtrise, surveillance).' USING ERRCODE = 'P0V03';
  END IF;

  BEGIN
    IF p_action = 'ajouter' THEN
      -- Ordre : à la suite (nextSort de Vigie) quand la table en a un.
      IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_rel AND a.attname = 'sort' AND a.attnum > 0 AND NOT a.attisdropped) THEN
        EXECUTE format('SELECT coalesce(max(sort), -1) + 1 FROM %I.%I', v_schema, v_tbl.table_name) INTO v_next;
        v_clean := v_clean || jsonb_build_object('sort', v_next);
      END IF;
      SELECT string_agg(format('%I', k), ', ' ORDER BY k) INTO v_list FROM jsonb_object_keys(v_clean) k;
      EXECUTE format('INSERT INTO %I.%I AS r (%s) SELECT %s FROM jsonb_populate_record(NULL::%I.%I, $1) RETURNING to_jsonb(r)',
        v_schema, v_tbl.table_name, v_list, v_list, v_schema, v_tbl.table_name) INTO v_after USING v_clean;
      v_key := v_after ->> v_tbl.key_column;
      v_action := 'create';
      v_verb := 'Ajouté';
    ELSIF p_action = 'corriger' THEN
      SELECT array_agg(k ORDER BY k) INTO v_changed FROM jsonb_object_keys(v_clean) k WHERE (v_before -> k) IS DISTINCT FROM (v_clean -> k);
      IF v_changed IS NULL THEN
        v_after := v_before;
      ELSE
        SELECT string_agg(format('%1$I = x.%1$I', k), ', ') INTO v_list FROM unnest(v_changed) k;
        EXECUTE format('UPDATE %I.%I AS r SET %s FROM jsonb_populate_record(NULL::%I.%I, $1) AS x WHERE r.%I = (jsonb_populate_record(NULL::%I.%I, $2)).%I RETURNING to_jsonb(r)',
          v_schema, v_tbl.table_name, v_list, v_schema, v_tbl.table_name, v_tbl.key_column, v_schema, v_tbl.table_name, v_tbl.key_column)
          INTO v_after USING v_clean, p_cle;
      END IF;
      v_action := 'update';
      v_verb := 'Corrigé';
    ELSE
      EXECUTE format('UPDATE %I.%I AS r SET archived_at = now(), archived_by_id = NULL, archive_reason = $1 WHERE r.%I = (jsonb_populate_record(NULL::%I.%I, $2)).%I AND r.archived_at IS NULL RETURNING to_jsonb(r)',
        v_schema, v_tbl.table_name, v_tbl.key_column, v_schema, v_tbl.table_name, v_tbl.key_column) INTO v_after USING v_motif, p_cle;
      v_action := 'archive';
      v_verb := 'Retiré (archivé)';
    END IF;
  EXCEPTION WHEN integrity_constraint_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME, v_column = COLUMN_NAME;
    SELECT c.label INTO v_text FROM "public"."external_edit_columns" c WHERE c.table_name = v_tbl.table_name AND c.column_name = v_column;
    RAISE EXCEPTION 'Valeur refusée par les règles de Vigie (%) : rien n''a été modifié.',
      coalesce('« ' || v_text || ' »', nullif(v_constraint, ''), nullif(v_column, ''), 'contrainte de la base') USING ERRCODE = 'P0V03';
  END;

  -- Journal de la fiche (seules les valeurs changées), dans la transaction de l'écriture.
  IF p_action <> 'corriger' OR v_changed IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('field', d.label, 'from', d.f, 'to', d.t) ORDER BY d.column_name), '[]'::jsonb) INTO v_details
    FROM (
      SELECT c.label, c.column_name, "public"."external_edit_shown"(c.choices, v_before -> c.column_name) AS f,
        "public"."external_edit_shown"(c.choices, v_after -> c.column_name) AS t
      FROM "public"."external_edit_columns" c
      WHERE c.table_name = v_tbl.table_name AND v_clean ? c.column_name
    ) d WHERE d.f IS DISTINCT FROM d.t;
    v_summary := format('%s depuis Matrix par %s (%s)', v_verb, v_par, session_user)
      || CASE WHEN v_tbl.entity_id_column IS NOT NULL THEN format(' · %s n° %s', v_tbl.label, v_key) ELSE '' END;
    INSERT INTO "public"."change_log" ("entity_type", "entity_id", "action", "summary", "reason", "details", "by_id")
    VALUES (v_tbl.entity_type, coalesce(v_after ->> v_tbl.entity_id_column, v_key), v_action, v_summary, v_motif, nullif(v_details, '[]'::jsonb), NULL);
  END IF;

  -- Ligne renvoyée : clé, colonnes ouvertes (hors refus inscrits) et archived_at ; jamais une autre colonne.
  SELECT jsonb_object_agg(s.k, v_after -> s.k) INTO v_result FROM (
    SELECT v_tbl.key_column AS k
    UNION SELECT c.column_name FROM "public"."external_edit_columns" c
      WHERE c.table_name = v_tbl.table_name AND "public"."external_edit_denied"(c.table_name, c.column_name, 'ajouter') IS NULL
    UNION SELECT 'archived_at' WHERE v_has_archive
  ) s;
  RETURN v_result;
END
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."pub_editer"(text, text, jsonb, jsonb, text, text) FROM PUBLIC;--> statement-breakpoint
-- search_path fixé au schéma de Vigie (vigie sur le serveur commun, public en PGlite) puis pg_temp, comme
-- pub_signaler_avancement_nc (migration 0026) ; seul endroit où la migration nomme le schéma courant.
DO $$
BEGIN
  EXECUTE format('ALTER FUNCTION %I.pub_editer(text, text, jsonb, jsonb, text, text) SET search_path = %I, pg_temp',
    current_schema(), current_schema());
END
$$;--> statement-breakpoint
COMMENT ON FUNCTION "public"."pub_editer"(text, text, jsonb, jsonb, text, text) IS 'Contrat M-19 v1 (demande de Matrix du 05/11/2026) : la DSI ajoute, corrige ou retire (archivage motivé) une ligne d''une table de Vigie ouverte par le registre external_edit_tables / external_edit_columns, avec les contrôles de saisie et le journal de Vigie (change_log). Refus : SQLSTATE P0V03. Appelant : matrix_app (lien écriture de Matrix).';
