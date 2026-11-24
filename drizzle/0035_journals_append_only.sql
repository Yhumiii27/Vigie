-- Journaux d'audit en ajout seul (Norma § 4, VG-N03) : le journal des modifications (change_log) et celui des
-- consultations (access_log) n'acceptent que des ajouts. Toute mise à jour, suppression ou troncature est refusée par la
-- base (SQLSTATE P0V04), quel que soit le rôle connecté. Une restauration de sauvegarde supprime les tables avant de les
-- recréer (DROP n'est pas concerné) puis recharge les lignes par COPY (ajouts) : elle reste possible.
CREATE FUNCTION "public"."journal_append_only"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Journal en ajout seul : % refusé sur %.', TG_OP, TG_TABLE_NAME USING ERRCODE = 'P0V04';
END
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."journal_append_only"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "change_log_append_only" BEFORE UPDATE OR DELETE ON "public"."change_log"
FOR EACH ROW EXECUTE FUNCTION "public"."journal_append_only"();--> statement-breakpoint
CREATE TRIGGER "change_log_no_truncate" BEFORE TRUNCATE ON "public"."change_log"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."journal_append_only"();--> statement-breakpoint
CREATE TRIGGER "access_log_append_only" BEFORE UPDATE OR DELETE ON "public"."access_log"
FOR EACH ROW EXECUTE FUNCTION "public"."journal_append_only"();--> statement-breakpoint
CREATE TRIGGER "access_log_no_truncate" BEFORE TRUNCATE ON "public"."access_log"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."journal_append_only"();
