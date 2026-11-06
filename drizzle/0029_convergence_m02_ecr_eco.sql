-- D12 (lot 5 de la convergence M-02), décision CV-06 du 05/11/2026 du responsable produit : demandes (ECR) et ordres (ECO)
-- de modification tenus par Vigie (docs/specs/modifications-techniques.md). Tables de la spécification de Matrix
-- (infra/postgres/partage/60-vigie-ecr-eco.sql) avec exactement les colonnes que lisent ses publications (pub_ordres_modification,
-- pub_eco_approbations, pub_eco_effectivite, pub_demandes_modification : définies et appliquées par Matrix, M-18 ; aucune vue
-- pub_ ici), colonnes propres à Vigie en fin de table. external_progress n'est pas créée : les écritures reçues passent par
-- inbound_requests (décision CV-08) et deux fonctions pub_ (fin de fichier). File d'envoi outbound_messages (webhook de
-- Codex). Source d'action « Modification technique » ajoutée (contrainte actions_source_check).
CREATE TABLE "eco_actions" (
	"eco_id" text NOT NULL,
	"action_id" text NOT NULL,
	CONSTRAINT "eco_actions_eco_id_action_id_pk" PRIMARY KEY("eco_id","action_id")
);
--> statement-breakpoint
CREATE TABLE "eco_approvals" (
	"eco_id" text NOT NULL,
	"approval_key" text NOT NULL,
	"approver_text" text NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"decided_by_name" text,
	"decided_by_matricule" text,
	"decided_at" timestamp with time zone,
	"comment" text,
	"via" text,
	"approver_id" text,
	"decided_by_id" text,
	CONSTRAINT "eco_approvals_eco_id_approval_key_pk" PRIMARY KEY("eco_id","approval_key"),
	CONSTRAINT "eco_approvals_approval_key_check" CHECK ("eco_approvals"."approval_key" in ('englead', 'quality', 'pm')),
	CONSTRAINT "eco_approvals_decision_check" CHECK ("eco_approvals"."decision" in ('pending', 'ok', 'rejected')),
	CONSTRAINT "eco_approvals_matricule_check" CHECK ("eco_approvals"."decided_by_matricule" ~ '^EMP-[0-9]{4,}$'),
	CONSTRAINT "eco_approvals_via_check" CHECK ("eco_approvals"."via" in ('vigie', 'keystone'))
);
--> statement-breakpoint
CREATE TABLE "eco_documents" (
	"eco_id" text NOT NULL,
	"position" integer NOT NULL,
	"ref_label" text NOT NULL,
	"codex_doc_id" text,
	"ecr_id" text,
	CONSTRAINT "eco_documents_eco_id_position_pk" PRIMARY KEY("eco_id","position")
);
--> statement-breakpoint
CREATE TABLE "eco_effectivity" (
	"eco_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_ref" text NOT NULL,
	"label" text NOT NULL,
	"disposition" text,
	"is_automatic" boolean DEFAULT false NOT NULL,
	"note" text,
	"fitted_part_ref" text,
	"fitted_revision" text,
	"position" integer NOT NULL,
	"due_on" date,
	"done_on" date,
	CONSTRAINT "eco_effectivity_eco_id_target_type_target_ref_pk" PRIMARY KEY("eco_id","target_type","target_ref"),
	CONSTRAINT "eco_effectivity_target_type_check" CHECK ("eco_effectivity"."target_type" in ('project', 'machine')),
	CONSTRAINT "eco_effectivity_disposition_check" CHECK ("eco_effectivity"."disposition" in ('update', 'pinned', 'retrofit', 'na')),
	CONSTRAINT "eco_effectivity_retrofit_check" CHECK ("eco_effectivity"."disposition" is distinct from 'retrofit' or "eco_effectivity"."target_type" = 'machine')
);
--> statement-breakpoint
CREATE TABLE "eco_parts" (
	"eco_id" text NOT NULL,
	"part_ref" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "eco_parts_eco_id_part_ref_pk" PRIMARY KEY("eco_id","part_ref")
);
--> statement-breakpoint
CREATE TABLE "eco_projects" (
	"eco_id" text NOT NULL,
	"keystone_project_code" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "eco_projects_eco_id_keystone_project_code_pk" PRIMARY KEY("eco_id","keystone_project_code")
);
--> statement-breakpoint
CREATE TABLE "ecos" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"eco_type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"interchangeability" text,
	"from_revision" text NOT NULL,
	"to_revision" text NOT NULL,
	"cost_eur" numeric(12, 2) DEFAULT 0 NOT NULL,
	"schedule_days" integer DEFAULT 0 NOT NULL,
	"stock_impact" text DEFAULT '' NOT NULL,
	"requested_by_name" text NOT NULL,
	"requested_by_matricule" text,
	"raised_on" date NOT NULL,
	"pilot_id" text,
	"site_id" text,
	"source" text DEFAULT 'vigie' NOT NULL,
	"released_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"approval_requested_on" date,
	"created_by_id" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"cancel_reason" text,
	CONSTRAINT "ecos_id_check" CHECK ("ecos"."id" ~ '^ECO-[0-9]{4}-[0-9]{3,}$'),
	CONSTRAINT "ecos_eco_type_check" CHECK ("ecos"."eco_type" in ('rev', 'sub', 'asm', 'sup', 'obs')),
	CONSTRAINT "ecos_status_check" CHECK ("ecos"."status" in ('draft', 'impact_analysis', 'in_approval', 'released', 'rejected')),
	CONSTRAINT "ecos_interchangeability_check" CHECK ("ecos"."interchangeability" in ('yes', 'no')),
	CONSTRAINT "ecos_requested_by_matricule_check" CHECK ("ecos"."requested_by_matricule" ~ '^EMP-[0-9]{4,}$'),
	CONSTRAINT "ecos_source_check" CHECK ("ecos"."source" in ('vigie', 'keystone', 'codex')),
	CONSTRAINT "ecos_released_check" CHECK ("ecos"."released_at" is null or "ecos"."status" = 'released'),
	CONSTRAINT "ecos_rejected_check" CHECK ("ecos"."rejected_at" is null or "ecos"."status" = 'rejected'),
	CONSTRAINT "ecos_cost_check" CHECK ("ecos"."cost_eur" >= 0),
	CONSTRAINT "ecos_cancelled_rejected_check" CHECK ("ecos"."cancelled_at" is null or "ecos"."status" = 'rejected'),
	CONSTRAINT "ecos_cancel_check" CHECK (("ecos"."cancelled_at" is null and "ecos"."cancelled_by_id" is null and "ecos"."cancel_reason" is null) or ("ecos"."cancelled_at" is not null and "ecos"."cancel_reason" is not null and btrim("ecos"."cancel_reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "ecrs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"codex_doc_id" text,
	"keystone_project_code" text,
	"part_ref" text,
	"event_id" text,
	"requester_name" text NOT NULL,
	"requester_matricule" text,
	"requester_ref" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"eco_id" text,
	"modifier_ref" text,
	"decision_note" text,
	"decided_by_id" text,
	"decided_at" timestamp with time zone,
	"implemented_at" timestamp with time zone,
	"codex_revision" text,
	"notify_status" text,
	"notify_attempts" integer DEFAULT 0 NOT NULL,
	"notify_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"site_id" text,
	"created_by_id" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"cancel_reason" text,
	CONSTRAINT "ecrs_id_check" CHECK ("ecrs"."id" ~ '^ECR-[0-9]{4}-[0-9]{3,}$'),
	CONSTRAINT "ecrs_kind_check" CHECK ("ecrs"."kind" in ('modification', 'obsolescence')),
	CONSTRAINT "ecrs_subject_check" CHECK ("ecrs"."subject" in ('document', 'part', 'project', 'event')),
	CONSTRAINT "ecrs_objet_check" CHECK (("ecrs"."subject" = 'document' and "ecrs"."codex_doc_id" is not null) or ("ecrs"."subject" = 'part' and "ecrs"."part_ref" is not null) or ("ecrs"."subject" = 'project' and "ecrs"."keystone_project_code" is not null) or ("ecrs"."subject" = 'event' and "ecrs"."event_id" is not null)),
	CONSTRAINT "ecrs_source_check" CHECK ("ecrs"."source" in ('vigie', 'keystone', 'codex')),
	CONSTRAINT "ecrs_requester_matricule_check" CHECK ("ecrs"."requester_matricule" ~ '^EMP-[0-9]{4,}$'),
	CONSTRAINT "ecrs_status_check" CHECK ("ecrs"."status" in ('submitted', 'accepted', 'rejected', 'implemented')),
	CONSTRAINT "ecrs_decision_check" CHECK ("ecrs"."status" = 'submitted' or "ecrs"."decided_at" is not null),
	CONSTRAINT "ecrs_implemented_check" CHECK ("ecrs"."status" <> 'implemented' or "ecrs"."implemented_at" is not null),
	CONSTRAINT "ecrs_notify_status_check" CHECK ("ecrs"."notify_status" in ('pending', 'sent', 'failed')),
	CONSTRAINT "ecrs_notify_attempts_check" CHECK ("ecrs"."notify_attempts" >= 0),
	CONSTRAINT "ecrs_cancelled_rejected_check" CHECK ("ecrs"."cancelled_at" is null or "ecrs"."status" = 'rejected'),
	CONSTRAINT "ecrs_cancel_check" CHECK (("ecrs"."cancelled_at" is null and "ecrs"."cancelled_by_id" is null and "ecrs"."cancel_reason" is null) or ("ecrs"."cancelled_at" is not null and "ecrs"."cancel_reason" is not null and btrim("ecrs"."cancel_reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"target" text NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"last_status" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "outbound_messages_status_check" CHECK ("outbound_messages"."status" in ('pending', 'sent', 'failed')),
	CONSTRAINT "outbound_messages_target_check" CHECK ("outbound_messages"."target" in ('codex')),
	CONSTRAINT "outbound_messages_kind_check" CHECK ("outbound_messages"."kind" in ('ecr_decision')),
	CONSTRAINT "outbound_messages_sent_check" CHECK (("outbound_messages"."status" = 'sent') = ("outbound_messages"."sent_at" is not null)),
	CONSTRAINT "outbound_messages_attempts_check" CHECK ("outbound_messages"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "actions" DROP CONSTRAINT "actions_source_check";--> statement-breakpoint
ALTER TABLE "inbound_requests" DROP CONSTRAINT "inbound_requests_kind_check";--> statement-breakpoint
ALTER TABLE "inbound_requests" ALTER COLUMN "project_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_requests" ADD COLUMN "ecr_id" text;--> statement-breakpoint
ALTER TABLE "inbound_requests" ADD COLUMN "eco_id" text;--> statement-breakpoint
ALTER TABLE "eco_actions" ADD CONSTRAINT "eco_actions_eco_id_ecos_id_fk" FOREIGN KEY ("eco_id") REFERENCES "public"."ecos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_actions" ADD CONSTRAINT "eco_actions_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_approvals" ADD CONSTRAINT "eco_approvals_eco_id_ecos_id_fk" FOREIGN KEY ("eco_id") REFERENCES "public"."ecos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_approvals" ADD CONSTRAINT "eco_approvals_approver_id_people_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_approvals" ADD CONSTRAINT "eco_approvals_decided_by_id_people_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_documents" ADD CONSTRAINT "eco_documents_eco_id_ecos_id_fk" FOREIGN KEY ("eco_id") REFERENCES "public"."ecos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_documents" ADD CONSTRAINT "eco_documents_ecr_id_ecrs_id_fk" FOREIGN KEY ("ecr_id") REFERENCES "public"."ecrs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_effectivity" ADD CONSTRAINT "eco_effectivity_eco_id_ecos_id_fk" FOREIGN KEY ("eco_id") REFERENCES "public"."ecos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_parts" ADD CONSTRAINT "eco_parts_eco_id_ecos_id_fk" FOREIGN KEY ("eco_id") REFERENCES "public"."ecos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_projects" ADD CONSTRAINT "eco_projects_eco_id_ecos_id_fk" FOREIGN KEY ("eco_id") REFERENCES "public"."ecos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecos" ADD CONSTRAINT "ecos_pilot_id_people_id_fk" FOREIGN KEY ("pilot_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecos" ADD CONSTRAINT "ecos_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ecos" ADD CONSTRAINT "ecos_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecos" ADD CONSTRAINT "ecos_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecrs" ADD CONSTRAINT "ecrs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ecrs" ADD CONSTRAINT "ecrs_eco_id_ecos_id_fk" FOREIGN KEY ("eco_id") REFERENCES "public"."ecos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecrs" ADD CONSTRAINT "ecrs_decided_by_id_people_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecrs" ADD CONSTRAINT "ecrs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ecrs" ADD CONSTRAINT "ecrs_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecrs" ADD CONSTRAINT "ecrs_cancelled_by_id_people_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eco_actions_action_id_idx" ON "eco_actions" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "eco_documents_ecr_id_idx" ON "eco_documents" USING btree ("ecr_id");--> statement-breakpoint
CREATE INDEX "ecos_status_idx" ON "ecos" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ecos_pilot_id_idx" ON "ecos" USING btree ("pilot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ecrs_one_open_per_document" ON "ecrs" USING btree ("codex_doc_id") WHERE "ecrs"."codex_doc_id" is not null and "ecrs"."status" in ('submitted', 'accepted');--> statement-breakpoint
CREATE INDEX "ecrs_eco_id_idx" ON "ecrs" USING btree ("eco_id");--> statement-breakpoint
CREATE INDEX "ecrs_event_id_idx" ON "ecrs" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "outbound_messages_status_idx" ON "outbound_messages" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "outbound_messages_entity_idx" ON "outbound_messages" USING btree ("entity_type","entity_id");--> statement-breakpoint
ALTER TABLE "inbound_requests" ADD CONSTRAINT "inbound_requests_ecr_id_ecrs_id_fk" FOREIGN KEY ("ecr_id") REFERENCES "public"."ecrs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_requests" ADD CONSTRAINT "inbound_requests_eco_id_ecos_id_fk" FOREIGN KEY ("eco_id") REFERENCES "public"."ecos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbound_requests_ecr_idx" ON "inbound_requests" USING btree ("ecr_id");--> statement-breakpoint
CREATE INDEX "inbound_requests_eco_idx" ON "inbound_requests" USING btree ("eco_id");--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_source_check" CHECK ("actions"."source" is null or "actions"."source" in ('analyse_risque', 'analyse_chimique', 'analyse_environnementale', 'audit_certification', 'audit_fournisseur', 'audit_interne', 'audit_terrain', 'autorite_publique', 'causerie', 'comex', 'controle_reglementaire', 'dechets', 'duerp', 'evenement', 'objectif', 'reclamation_client', 'reunion_operationnelle', 'revue_direction', 'revue_documentaire', 'revue_processus', 'veille', 'hazop', 'reserves', 'rex', 'modification_technique'));--> statement-breakpoint
ALTER TABLE "inbound_requests" ADD CONSTRAINT "inbound_requests_project_check" CHECK ("inbound_requests"."kind" not in ('nc_step', 'nc_verification', 'nc_references') or "inbound_requests"."project_code" is not null);--> statement-breakpoint
ALTER TABLE "inbound_requests" ADD CONSTRAINT "inbound_requests_kind_check" CHECK ("inbound_requests"."kind" in ('nc_step', 'nc_verification', 'nc_references', 'ecr_create', 'eco_step', 'eco_approval'));--> statement-breakpoint
-- Appelants admis (session_user) : codex_app, rôle de Codex sur le serveur commun (création d'une demande de modification ;
-- keystone_app inscrit par la migration 0026). La démonstration et les tests inscrivent leur propre session_user.
INSERT INTO "public"."inbound_callers" ("role", "tool", "label") VALUES ('codex_app', 'codex', 'Codex')
ON CONFLICT ("role") DO NOTHING;--> statement-breakpoint
-- Fonction d'écriture reçue de Codex (M-17 règle R4, M-18, décision CV-08) : SECURITY DEFINER, sans SQL dynamique, appelant
-- identifié par session_user (outil « codex » d'inbound_callers), arguments contrôlés (P0V02). Réserve le numéro
-- ECR-AAAA-NNN (compteur « ref:ECR-AAAA- » de Vigie, toujours au-delà des numéros déjà vus), dépose la demande dans
-- inbound_requests et rend le numéro : le même pour un identifiant externe déjà reçu (idempotence). Vigie crée la demande à
-- son traitement (src/server/inbound.ts) : « À décider », ou « refusée » avec le motif (document inconnu, retiré, ou déjà
-- visé par une demande en cours). Signature jamais changée (une nouvelle version prend un nouveau nom). Exécution accordée
-- par Matrix seulement (lien de nature execution du registre matrix.liens).
CREATE FUNCTION "public"."pub_creer_demande_modification"(
  p_id_externe text, p_nature text, p_document text, p_motif text, p_description text, p_demandeur_ref text,
  p_demandeur_nom text, p_demandeur_matricule text, p_remplacant text, p_enregistre_le timestamptz
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_outil text;
  v_ref text;
  v_prefix text;
  v_n integer;
  v_max integer;
  v_id integer;
  -- Identifiants de Codex (document, utilisateur) : lettres, chiffres, point, tiret, soulignement, 64 caractères au plus.
  v_motif text := '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$';
BEGIN
  SELECT c.tool INTO v_outil FROM "public"."inbound_callers" c WHERE c.role = session_user;
  IF v_outil IS NULL OR v_outil <> 'codex' THEN
    RAISE EXCEPTION 'appelant non admis : %', session_user USING ERRCODE = 'P0V01';
  END IF;
  IF p_id_externe IS NULL OR p_id_externe !~ '^[^[:cntrl:]]{1,100}$' THEN
    RAISE EXCEPTION 'identifiant externe (p_id_externe) absent ou trop long' USING ERRCODE = 'P0V02';
  END IF;
  -- Demande déjà reçue : même numéro, aucun nouveau numéro consommé.
  SELECT r.target_ref INTO v_ref FROM "public"."inbound_requests" r WHERE r.caller = session_user AND r.external_id = p_id_externe;
  IF v_ref IS NOT NULL THEN
    RETURN v_ref;
  END IF;
  IF p_nature IS NULL OR p_nature NOT IN ('modification', 'obsolescence') THEN
    RAISE EXCEPTION 'nature invalide : modification ou obsolescence' USING ERRCODE = 'P0V02';
  END IF;
  IF p_document IS NULL OR p_document !~ v_motif THEN
    RAISE EXCEPTION 'document (p_document) absent ou invalide : identifiant de Codex attendu (PRO-QUA-0001)' USING ERRCODE = 'P0V02';
  END IF;
  IF p_motif IS NULL OR btrim(p_motif) = '' OR length(p_motif) > 2000 THEN
    RAISE EXCEPTION 'motif (p_motif) absent ou trop long (2000 caractères au plus)' USING ERRCODE = 'P0V02';
  END IF;
  IF p_demandeur_nom IS NULL OR btrim(p_demandeur_nom) = '' OR length(p_demandeur_nom) > 200 THEN
    RAISE EXCEPTION 'demandeur (p_demandeur_nom) absent ou trop long' USING ERRCODE = 'P0V02';
  END IF;
  IF length(p_description) > 4000 OR (p_demandeur_ref IS NOT NULL AND p_demandeur_ref !~ v_motif)
     OR (p_demandeur_matricule IS NOT NULL AND p_demandeur_matricule !~ '^EMP-[0-9]{4,}$')
     OR (p_remplacant IS NOT NULL AND p_remplacant !~ v_motif) THEN
    RAISE EXCEPTION 'description, demandeur ou document de remplacement invalide' USING ERRCODE = 'P0V02';
  END IF;
  -- Numéro réservé : compteur de Vigie (même portée que nextReference, src/server/references.ts), toujours au-delà des
  -- numéros déjà vus (demandes, numéros réservés non encore traités, journal).
  v_prefix := 'ECR-' || to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY') || '-';
  INSERT INTO "public"."action_counters" ("scope", "last") VALUES ('ref:' || v_prefix, 1)
  ON CONFLICT ("scope") DO UPDATE SET "last" = "action_counters"."last" + 1
  RETURNING "last" INTO v_n;
  SELECT coalesce(max(substring(x.id FROM length(v_prefix) + 1)::integer), 0) INTO v_max
  FROM (
    SELECT e.id FROM "public"."ecrs" e WHERE e.id LIKE v_prefix || '%'
    UNION ALL SELECT r.target_ref FROM "public"."inbound_requests" r WHERE r.kind = 'ecr_create' AND r.target_ref LIKE v_prefix || '%'
    UNION ALL SELECT l.entity_id FROM "public"."change_log" l WHERE l.entity_type = 'ecr' AND l.entity_id LIKE v_prefix || '%'
  ) x
  WHERE substring(x.id FROM length(v_prefix) + 1) ~ '^[0-9]{1,9}$';
  IF v_n <= v_max THEN
    v_n := v_max + 1;
    UPDATE "public"."action_counters" SET "last" = v_n WHERE "scope" = 'ref:' || v_prefix;
  END IF;
  v_ref := v_prefix || lpad(v_n::text, 3, '0');
  INSERT INTO "public"."inbound_requests" ("caller", "tool", "kind", "external_id", "target_ref", "project_code", "payload")
  VALUES (session_user, v_outil, 'ecr_create', p_id_externe, v_ref, NULL, jsonb_strip_nulls(jsonb_build_object(
    'kind', p_nature,
    'documentId', p_document,
    'reason', btrim(p_motif),
    'description', nullif(btrim(p_description), ''),
    'requester', jsonb_strip_nulls(jsonb_build_object('ref', p_demandeur_ref, 'name', btrim(p_demandeur_nom), 'matricule', p_demandeur_matricule)),
    'replacementId', p_remplacant,
    'recordedAt', to_char(p_enregistre_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))
  ON CONFLICT ("caller", "external_id") DO NOTHING
  RETURNING "id" INTO v_id;
  IF v_id IS NULL THEN
    SELECT r.target_ref INTO v_ref FROM "public"."inbound_requests" r WHERE r.caller = session_user AND r.external_id = p_id_externe;
  END IF;
  RETURN v_ref;
END
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."pub_creer_demande_modification"(text, text, text, text, text, text, text, text, text, timestamptz) FROM PUBLIC;--> statement-breakpoint
-- Fonction d'écriture reçue de Keystone (mêmes règles) : avancement d'un ordre de modification (étape suivante) ou décision
-- d'une clé d'approbation ; dépose seulement une ligne dans inbound_requests, traitée par Vigie avec ses règles et son
-- journal ; identifiant de la demande rendu (le même pour un identifiant externe déjà reçu).
CREATE FUNCTION "public"."pub_signaler_avancement_eco"(
  p_numero text, p_nature text, p_cle text, p_decision text, p_etape_depuis text, p_etape_cible text, p_commentaire text,
  p_acteur_nom text, p_acteur_role text, p_enregistre_le timestamptz, p_id_externe text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_outil text;
  v_id integer;
  v_etats text[] := ARRAY['draft', 'impact_analysis', 'in_approval', 'released', 'rejected'];
BEGIN
  SELECT c.tool INTO v_outil FROM "public"."inbound_callers" c WHERE c.role = session_user;
  IF v_outil IS NULL OR v_outil <> 'keystone' THEN
    RAISE EXCEPTION 'appelant non admis : %', session_user USING ERRCODE = 'P0V01';
  END IF;
  IF p_id_externe IS NULL OR p_id_externe !~ '^[^[:cntrl:]]{1,100}$' THEN
    RAISE EXCEPTION 'identifiant externe (p_id_externe) absent ou trop long' USING ERRCODE = 'P0V02';
  END IF;
  IF p_numero IS NULL OR p_numero !~ '^ECO-[0-9]{4}-[0-9]{3,9}$' THEN
    RAISE EXCEPTION 'numéro d''ordre invalide : ECO-AAAA-NNN de Vigie attendu' USING ERRCODE = 'P0V02';
  END IF;
  IF p_nature IS NULL OR p_nature NOT IN ('step', 'approval') THEN
    RAISE EXCEPTION 'nature invalide : step ou approval' USING ERRCODE = 'P0V02';
  END IF;
  IF p_nature = 'step' AND (p_etape_depuis IS NULL OR NOT (p_etape_depuis = ANY (v_etats)) OR p_etape_cible IS NULL OR NOT (p_etape_cible = ANY (v_etats))) THEN
    RAISE EXCEPTION 'étapes (p_etape_depuis, p_etape_cible) invalides' USING ERRCODE = 'P0V02';
  END IF;
  IF p_nature = 'approval' AND (p_cle IS NULL OR p_cle NOT IN ('englead', 'quality', 'pm') OR p_decision IS NULL OR p_decision NOT IN ('ok', 'rejected')) THEN
    RAISE EXCEPTION 'clé (englead, quality, pm) ou décision (ok, rejected) invalide' USING ERRCODE = 'P0V02';
  END IF;
  IF p_etape_depuis IS NOT NULL AND NOT (p_etape_depuis = ANY (v_etats)) THEN
    RAISE EXCEPTION 'étape de départ (p_etape_depuis) invalide' USING ERRCODE = 'P0V02';
  END IF;
  IF length(p_commentaire) > 2000 OR length(p_acteur_nom) > 200 OR length(p_acteur_role) > 50 THEN
    RAISE EXCEPTION 'commentaire ou acteur trop long' USING ERRCODE = 'P0V02';
  END IF;
  INSERT INTO "public"."inbound_requests" ("caller", "tool", "kind", "external_id", "target_ref", "project_code", "payload")
  VALUES (session_user, v_outil, 'eco_' || p_nature, p_id_externe, p_numero, NULL, jsonb_strip_nulls(jsonb_build_object(
    'kind', p_nature,
    'approvalKey', CASE WHEN p_nature = 'approval' THEN p_cle END,
    'decision', CASE WHEN p_nature = 'approval' THEN p_decision END,
    'fromStatus', p_etape_depuis,
    'targetStatus', CASE WHEN p_nature = 'step' THEN p_etape_cible END,
    'comment', nullif(btrim(p_commentaire), ''),
    'actor', jsonb_strip_nulls(jsonb_build_object('name', nullif(btrim(p_acteur_nom), ''), 'role', nullif(btrim(p_acteur_role), ''))),
    'recordedAt', to_char(p_enregistre_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))
  ON CONFLICT ("caller", "external_id") DO NOTHING
  RETURNING "id" INTO v_id;
  IF v_id IS NULL THEN
    SELECT r.id INTO v_id FROM "public"."inbound_requests" r WHERE r.caller = session_user AND r.external_id = p_id_externe;
  END IF;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."pub_signaler_avancement_eco"(text, text, text, text, text, text, text, text, text, timestamptz, text) FROM PUBLIC;--> statement-breakpoint
-- search_path fixé au schéma de Vigie (vigie sur le serveur commun, public en PGlite) puis pg_temp, comme la migration 0026.
DO $$
BEGIN
  EXECUTE format('ALTER FUNCTION %I.pub_creer_demande_modification(text, text, text, text, text, text, text, text, text, timestamptz) SET search_path = %I, pg_temp',
    current_schema(), current_schema());
  EXECUTE format('ALTER FUNCTION %I.pub_signaler_avancement_eco(text, text, text, text, text, text, text, text, text, timestamptz, text) SET search_path = %I, pg_temp',
    current_schema(), current_schema());
END
$$;--> statement-breakpoint
COMMENT ON FUNCTION "public"."pub_creer_demande_modification"(text, text, text, text, text, text, text, text, text, timestamptz) IS 'Contrat D12 v1 (décisions CV-06 et CV-08) : Codex crée une demande de modification (ECR) d''un de ses documents ; réserve et rend le numéro ECR-AAAA-NNN, dépose la demande dans inbound_requests, traitée par Vigie (règles et journal de Vigie). Appelant : codex_app (lien execution de Matrix).';--> statement-breakpoint
COMMENT ON FUNCTION "public"."pub_signaler_avancement_eco"(text, text, text, text, text, text, text, text, text, timestamptz, text) IS 'Contrat D12 v1 (décisions CV-06 et CV-08) : Keystone signale l''avancement d''un ordre de modification de Vigie (ECO-…) ou la décision d''une clé d''approbation (ingénierie, chefs de projet) ; dépose une demande dans inbound_requests, traitée par Vigie. Appelant : keystone_app (lien execution de Matrix).';
