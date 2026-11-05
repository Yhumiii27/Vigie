-- D13 (lot 3 de la convergence M-02), décisions CV-07 et CV-08 du 04/11/2026 du responsable produit.
-- CV-08 : Keystone n'écrit jamais dans les tables de Vigie. Il appelle vigie.pub_signaler_avancement_nc (fin de fichier),
-- qui dépose seulement une demande dans inbound_requests ; Vigie la traite avec ses règles et son journal
-- (src/server/inbound.ts). Aucune vue pub_ (M-18) : l'état des demandes sera publié par Matrix s'il le décide.
CREATE TABLE "inbound_callers" (
	"role" text PRIMARY KEY NOT NULL,
	"tool" text NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"caller" text NOT NULL,
	"tool" text NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"target_ref" text NOT NULL,
	"project_code" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"processed_at" timestamp with time zone,
	"result_code" text,
	"result" text,
	"event_id" text,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by_id" text,
	"acknowledge_reason" text,
	CONSTRAINT "inbound_requests_status_check" CHECK ("inbound_requests"."status" in ('received', 'applied', 'rejected')),
	CONSTRAINT "inbound_requests_kind_check" CHECK ("inbound_requests"."kind" in ('nc_step', 'nc_verification', 'nc_references')),
	CONSTRAINT "inbound_requests_result_code_check" CHECK ("inbound_requests"."result_code" is null or "inbound_requests"."result_code" in ('stale', 'refused', 'not_found', 'invalid')),
	CONSTRAINT "inbound_requests_processed_check" CHECK (("inbound_requests"."status" = 'received') = ("inbound_requests"."processed_at" is null) and ("inbound_requests"."status" = 'rejected') = ("inbound_requests"."result_code" is not null)),
	CONSTRAINT "inbound_requests_ack_check" CHECK ("inbound_requests"."acknowledged_at" is null or "inbound_requests"."status" = 'rejected'),
	CONSTRAINT "inbound_requests_ack_state_check" CHECK (("inbound_requests"."acknowledged_at" is null and "inbound_requests"."acknowledged_by_id" is null and "inbound_requests"."acknowledge_reason" is null) or ("inbound_requests"."acknowledged_at" is not null and "inbound_requests"."acknowledge_reason" is not null and btrim("inbound_requests"."acknowledge_reason") <> ''))
);
--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_nc_number_check";--> statement-breakpoint
-- CV-07 : le numéro d'une NC vu par Keystone est la référence EV-… de Vigie (plus de NCR-nnn). La colonne nc_number,
-- lue par la vue pub_non_conformites (colonne number, et filtre « NC numérotées »), est gardée et recopie la référence
-- pour toute NC portant un code projet (déclencheur events_nc_number ci-dessous) ; aucune donnée de production (P-03).
UPDATE "events" SET "nc_number" = CASE WHEN "type" = 'NC' AND "keystone_project_code" IS NOT NULL THEN "id" END
WHERE "nc_number" IS DISTINCT FROM CASE WHEN "type" = 'NC' AND "keystone_project_code" IS NOT NULL THEN "id" END;--> statement-breakpoint
ALTER TABLE "event_steps" ADD COLUMN "inbound_request_id" integer;--> statement-breakpoint
ALTER TABLE "inbound_requests" ADD CONSTRAINT "inbound_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_requests" ADD CONSTRAINT "inbound_requests_acknowledged_by_id_people_id_fk" FOREIGN KEY ("acknowledged_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_requests_external_idx" ON "inbound_requests" USING btree ("caller","external_id");--> statement-breakpoint
CREATE INDEX "inbound_requests_status_idx" ON "inbound_requests" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "inbound_requests_event_idx" ON "inbound_requests" USING btree ("event_id");--> statement-breakpoint
ALTER TABLE "event_steps" ADD CONSTRAINT "event_steps_inbound_request_id_inbound_requests_id_fk" FOREIGN KEY ("inbound_request_id") REFERENCES "public"."inbound_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_nc_number_check" CHECK ("events"."nc_number" is null or ("events"."nc_number" = "events"."id" and "events"."type" = 'NC' and "events"."keystone_project_code" is not null));--> statement-breakpoint
-- Numéro d'une NC de projet tenu par la base (CV-07) : jamais saisi ni écrit par le code de Vigie.
CREATE FUNCTION "public"."events_nc_number"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  NEW.nc_number := CASE WHEN NEW.type = 'NC' AND NEW.keystone_project_code IS NOT NULL THEN NEW.id END;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."events_nc_number"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "events_nc_number" BEFORE INSERT OR UPDATE ON "public"."events"
FOR EACH ROW EXECUTE FUNCTION "public"."events_nc_number"();--> statement-breakpoint
-- Appelants admis (session_user) : keystone_app, rôle de Keystone sur le serveur commun. La démonstration et les tests
-- (PGlite, base jetable) inscrivent leur propre session_user ; seul le propriétaire du schéma (vigie_app) écrit ici.
INSERT INTO "public"."inbound_callers" ("role", "tool", "label") VALUES ('keystone_app', 'keystone', 'Keystone')
ON CONFLICT ("role") DO NOTHING;--> statement-breakpoint
-- Fonction d'écriture reçue (M-17 règle R4, M-18) : SECURITY DEFINER, sans SQL dynamique, appelant identifié par
-- session_user, arguments contrôlés, une ligne déposée dans inbound_requests, identifiant de la demande renvoyé (le même
-- pour un identifiant externe déjà reçu : idempotence). Erreurs : SQLSTATE P0V01 (appelant non admis), P0V02 (argument
-- invalide). Signature jamais changée (une nouvelle version prend un nouveau nom). Exécution accordée par Matrix seulement
-- (lien de nature execution du registre matrix.liens).
CREATE FUNCTION "public"."pub_signaler_avancement_nc"(
  p_numero text, p_projet text, p_nature text, p_etape_depuis text, p_etape_cible text, p_decision text,
  p_commentaire text, p_acteur_nom text, p_acteur_role text, p_enregistre_le timestamptz, p_id_externe text,
  p_activite text, p_article text, p_livrable text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_outil text;
  v_id integer;
  v_etats text[] := ARRAY['open', 'containment', 'root_cause', 'corrective_action', 'verification', 'closed'];
  v_ref text := '^[^[:cntrl:]]{1,64}$';
BEGIN
  SELECT c.tool INTO v_outil FROM "public"."inbound_callers" c WHERE c.role = session_user;
  IF v_outil IS NULL THEN
    RAISE EXCEPTION 'appelant non admis : %', session_user USING ERRCODE = 'P0V01';
  END IF;
  IF p_id_externe IS NULL OR p_id_externe !~ '^[^[:cntrl:]]{1,100}$' THEN
    RAISE EXCEPTION 'identifiant externe (p_id_externe) absent ou trop long' USING ERRCODE = 'P0V02';
  END IF;
  IF p_numero IS NULL OR p_numero !~ '^EV-[0-9]{4}-[0-9]{1,9}$' THEN
    RAISE EXCEPTION 'numéro de NC invalide : référence EV-AAAA-n de Vigie attendue' USING ERRCODE = 'P0V02';
  END IF;
  IF p_projet IS NULL OR p_projet !~ v_ref THEN
    RAISE EXCEPTION 'code projet (p_projet) absent ou invalide' USING ERRCODE = 'P0V02';
  END IF;
  IF p_nature IS NULL OR p_nature NOT IN ('step', 'verification', 'references') THEN
    RAISE EXCEPTION 'nature invalide : step, verification ou references' USING ERRCODE = 'P0V02';
  END IF;
  IF p_nature IN ('step', 'verification') AND (p_etape_depuis IS NULL OR NOT (p_etape_depuis = ANY (v_etats))) THEN
    RAISE EXCEPTION 'étape de départ (p_etape_depuis) invalide' USING ERRCODE = 'P0V02';
  END IF;
  IF p_nature = 'step' AND (p_etape_cible IS NULL OR NOT (p_etape_cible = ANY (v_etats))) THEN
    RAISE EXCEPTION 'étape demandée (p_etape_cible) invalide' USING ERRCODE = 'P0V02';
  END IF;
  IF p_nature = 'verification' AND (p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected')) THEN
    RAISE EXCEPTION 'décision de vérification (p_decision) invalide : approved ou rejected' USING ERRCODE = 'P0V02';
  END IF;
  IF p_nature = 'references' AND p_activite IS NULL AND p_article IS NULL AND p_livrable IS NULL THEN
    RAISE EXCEPTION 'aucune référence transmise (p_activite, p_article, p_livrable)' USING ERRCODE = 'P0V02';
  END IF;
  IF (p_activite IS NOT NULL AND p_activite !~ v_ref) OR (p_article IS NOT NULL AND p_article !~ v_ref)
     OR (p_livrable IS NOT NULL AND p_livrable !~ v_ref) THEN
    RAISE EXCEPTION 'référence Keystone invalide (64 caractères au plus)' USING ERRCODE = 'P0V02';
  END IF;
  IF length(p_commentaire) > 2000 OR length(p_acteur_nom) > 200 OR length(p_acteur_role) > 50 THEN
    RAISE EXCEPTION 'commentaire ou acteur trop long' USING ERRCODE = 'P0V02';
  END IF;
  INSERT INTO "public"."inbound_requests" ("caller", "tool", "kind", "external_id", "target_ref", "project_code", "payload")
  VALUES (session_user, v_outil, 'nc_' || p_nature, p_id_externe, p_numero, p_projet, jsonb_strip_nulls(jsonb_build_object(
    'kind', p_nature,
    'fromStatus', CASE WHEN p_nature <> 'references' THEN p_etape_depuis END,
    'targetStatus', CASE WHEN p_nature = 'step' THEN p_etape_cible END,
    'decision', CASE WHEN p_nature = 'verification' THEN p_decision END,
    'comment', nullif(btrim(p_commentaire), ''),
    'actor', jsonb_strip_nulls(jsonb_build_object('name', nullif(btrim(p_acteur_nom), ''), 'role', nullif(btrim(p_acteur_role), ''))),
    'recordedAt', to_char(p_enregistre_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'activityCode', p_activite, 'partRef', p_article, 'deliverableNumber', p_livrable)))
  ON CONFLICT ("caller", "external_id") DO NOTHING
  RETURNING "id" INTO v_id;
  IF v_id IS NULL THEN
    SELECT r.id INTO v_id FROM "public"."inbound_requests" r WHERE r.caller = session_user AND r.external_id = p_id_externe;
  END IF;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."pub_signaler_avancement_nc"(text, text, text, text, text, text, text, text, text, timestamptz, text, text, text, text) FROM PUBLIC;--> statement-breakpoint
-- search_path fixé au schéma de Vigie (vigie sur le serveur commun, public en PGlite) puis pg_temp (M-17 : la fonction ne
-- résout jamais un objet d'un schéma temporaire de l'appelant) ; seul endroit où la migration nomme le schéma courant.
DO $$
BEGIN
  EXECUTE format('ALTER FUNCTION %I.pub_signaler_avancement_nc(text, text, text, text, text, text, text, text, text, timestamptz, text, text, text, text) SET search_path = %I, pg_temp',
    current_schema(), current_schema());
END
$$;--> statement-breakpoint
COMMENT ON FUNCTION "public"."pub_signaler_avancement_nc"(text, text, text, text, text, text, text, text, text, timestamptz, text, text, text, text) IS 'Contrat D13 v1 (décision CV-08) : Keystone signale l''avancement d''une NC de projet de Vigie (numéro EV-…), un avis de vérification ou ses références projet ; dépose une demande dans inbound_requests, traitée par Vigie (règles et journal de Vigie). Appelant : keystone_app (lien execution de Matrix).';
