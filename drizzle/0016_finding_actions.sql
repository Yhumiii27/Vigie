-- AUD-28 : plusieurs actions par constat d'audit. Table de liaison finding_actions (un constat → plusieurs actions ; une
-- action → un seul constat, posé à sa création, D20), reprise de l'ancienne colonne audit_findings.action_id dans la même
-- transaction, puis suppression de cette colonne. Aucune vue pub_ ne lit audit_findings (pub_non_conformites, pub_hse_projet,
-- pub_journal, pub_controles inchangées). Noms non qualifiés (serveur commun : schéma vigie, migrateServer).
CREATE TABLE "finding_actions" (
	"finding_id" integer NOT NULL,
	"action_id" text NOT NULL,
	CONSTRAINT "finding_actions_finding_id_action_id_pk" PRIMARY KEY("finding_id","action_id")
);
--> statement-breakpoint
ALTER TABLE "finding_actions" ADD CONSTRAINT "finding_actions_finding_id_audit_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."audit_findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_actions" ADD CONSTRAINT "finding_actions_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finding_actions_action_idx" ON "finding_actions" USING btree ("action_id");--> statement-breakpoint
-- Reprise : chaque constat qui portait une action la garde (rien d'autre n'est modifié).
INSERT INTO "finding_actions" ("finding_id", "action_id") SELECT "id", "action_id" FROM "audit_findings" WHERE "action_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_findings" DROP CONSTRAINT "audit_findings_action_id_actions_id_fk";--> statement-breakpoint
ALTER TABLE "audit_findings" DROP COLUMN "action_id";
