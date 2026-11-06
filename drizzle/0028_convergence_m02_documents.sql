-- Lot 4 de la convergence M-02 (D10, décision CV-05 du 05/11/2026 : avancer D10) : Codex fait foi pour les documents ;
-- Vigie lit codex.pub_documents, pub_revisions_document, pub_validations et pub_types_document (src/lib/foreign/codex.ts).
-- Les tables documents, document_versions et document_reviews sont supprimées ; aucune vue pub_ ni requête de référence ne
-- les lit (garde-fou M-18 : published-columns-m18.test.ts). Aucune donnée de production à reprendre (P-03) : seule une base
-- de démonstration existante (PGlite, application Mac) porte des documents, ceux du jeu, que les substituts de Codex
-- reprennent sous leur identifiant de Codex (ancien identifiant de Vigie gardé comme alias : src/db/seeds/documents.ts).
-- Avant la suppression, rien n'est perdu en silence :
-- - action rattachée à une version (document_versions.action_id) → table document_actions (identifiant de Codex, lettre
--   de la révision, action) : lien complémentaire « docversion » du registre des actions ;
-- - events.document_id, actions.document_id (ACT-01) et risk_measure_links.document_id (DUE-19) gardent leur valeur, en
--   texte, sans clé étrangère (identifiant d'un autre outil) ; les identifiants du jeu de démonstration sont réécrits en
--   identifiants de Codex ; une autre valeur est gardée telle quelle (résolue par les alias de Codex, sinon affichée seule) ;
-- - journal des documents (change_log, entité « document ») gardé, rattaché à l'identifiant de Codex ; plus montré par
--   Vigie (l'historique d'un document est celui de Codex), toujours publié par pub_journal ;
-- - fichiers des versions (attachments « document_version ») gardés en base et sur le disque, rattachés à
--   « <identifiant Codex>|<révision> » : retirés du service (/fichiers les refuse ; les fichiers d'un document sont servis
--   par Codex), conservés pour une reprise éventuelle dans Codex (sauvegarde, import de Codex) ;
-- - revues sans modification (DOC-15), origine, émetteur et conservation par document (DOC-17) : tenus par Codex
--   (conservation par type) ; leurs entrées restent au journal du document.
-- États lus des anciennes échéances documentaires (notification_reads) non réécrits : leurs clés changent avec la source
-- (identifiant de Codex) ; les anciens états sont purgés après 365 jours (purgeReadStates).
CREATE TABLE "document_actions" (
	"codex_id" text NOT NULL,
	"revision" text NOT NULL,
	"action_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_actions_codex_id_revision_pk" PRIMARY KEY("codex_id","revision"),
	CONSTRAINT "document_actions_revision_check" CHECK (btrim("document_actions"."revision") <> '')
);
--> statement-breakpoint
ALTER TABLE "document_actions" ADD CONSTRAINT "document_actions_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_actions_action_idx" ON "document_actions" USING btree ("action_id");--> statement-breakpoint
INSERT INTO "document_actions" ("codex_id", "revision", "action_id")
SELECT coalesce(m."new_id", v."document_id"), v."version", v."action_id"
FROM "document_versions" v LEFT JOIN (VALUES ('POL-QHSE-001', 'POL-QUA-0001'), ('PR-QHSE-001', 'PRO-QUA-0001'), ('PR-QHSE-002', 'PRO-QUA-0002'), ('PR-QHSE-003', 'PRO-QUA-0003'), ('PR-QHSE-004', 'PRO-HSE-0001'), ('PR-QHSE-005', 'PRO-HSE-0002'), ('PR-ACH-001', 'PRO-QUA-0004'), ('PR-BE-001', 'PRO-QUA-0005'), ('IT-MON-012', 'PRO-HSE-0003'), ('IT-USI-004', 'PRO-QUA-0006'), ('IT-ESS-002', 'PRO-HSE-0004'), ('IT-MON-007', 'PRO-QUA-0007'), ('FO-QHSE-010', 'FRM-HSE-0001'), ('FO-MON-003', 'FRM-QUA-0001'), ('EN-QHSE-001', 'REC-HSE-0001'), ('EXT-QHSE-001', 'NRM-QUA-0001')) AS m("old_id", "new_id") ON m."old_id" = v."document_id"
WHERE v."action_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "attachments" SET "entity_id" = q."ref"
FROM (SELECT v."id"::text AS "version_id", coalesce(m."new_id", v."document_id") || '|' || v."version" AS "ref"
  FROM "document_versions" v LEFT JOIN (VALUES ('POL-QHSE-001', 'POL-QUA-0001'), ('PR-QHSE-001', 'PRO-QUA-0001'), ('PR-QHSE-002', 'PRO-QUA-0002'), ('PR-QHSE-003', 'PRO-QUA-0003'), ('PR-QHSE-004', 'PRO-HSE-0001'), ('PR-QHSE-005', 'PRO-HSE-0002'), ('PR-ACH-001', 'PRO-QUA-0004'), ('PR-BE-001', 'PRO-QUA-0005'), ('IT-MON-012', 'PRO-HSE-0003'), ('IT-USI-004', 'PRO-QUA-0006'), ('IT-ESS-002', 'PRO-HSE-0004'), ('IT-MON-007', 'PRO-QUA-0007'), ('FO-QHSE-010', 'FRM-HSE-0001'), ('FO-MON-003', 'FRM-QUA-0001'), ('EN-QHSE-001', 'REC-HSE-0001'), ('EXT-QHSE-001', 'NRM-QUA-0001')) AS m("old_id", "new_id") ON m."old_id" = v."document_id") q
WHERE "attachments"."entity_type" = 'document_version' AND "attachments"."entity_id" = q."version_id";--> statement-breakpoint
ALTER TABLE "actions" DROP CONSTRAINT "actions_document_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_document_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "risk_measure_links" DROP CONSTRAINT "risk_measure_links_document_id_documents_id_fk";
--> statement-breakpoint
UPDATE "events" SET "document_id" = m."new_id" FROM (VALUES ('POL-QHSE-001', 'POL-QUA-0001'), ('PR-QHSE-001', 'PRO-QUA-0001'), ('PR-QHSE-002', 'PRO-QUA-0002'), ('PR-QHSE-003', 'PRO-QUA-0003'), ('PR-QHSE-004', 'PRO-HSE-0001'), ('PR-QHSE-005', 'PRO-HSE-0002'), ('PR-ACH-001', 'PRO-QUA-0004'), ('PR-BE-001', 'PRO-QUA-0005'), ('IT-MON-012', 'PRO-HSE-0003'), ('IT-USI-004', 'PRO-QUA-0006'), ('IT-ESS-002', 'PRO-HSE-0004'), ('IT-MON-007', 'PRO-QUA-0007'), ('FO-QHSE-010', 'FRM-HSE-0001'), ('FO-MON-003', 'FRM-QUA-0001'), ('EN-QHSE-001', 'REC-HSE-0001'), ('EXT-QHSE-001', 'NRM-QUA-0001')) AS m("old_id", "new_id") WHERE "events"."document_id" = m."old_id";--> statement-breakpoint
UPDATE "actions" SET "document_id" = m."new_id" FROM (VALUES ('POL-QHSE-001', 'POL-QUA-0001'), ('PR-QHSE-001', 'PRO-QUA-0001'), ('PR-QHSE-002', 'PRO-QUA-0002'), ('PR-QHSE-003', 'PRO-QUA-0003'), ('PR-QHSE-004', 'PRO-HSE-0001'), ('PR-QHSE-005', 'PRO-HSE-0002'), ('PR-ACH-001', 'PRO-QUA-0004'), ('PR-BE-001', 'PRO-QUA-0005'), ('IT-MON-012', 'PRO-HSE-0003'), ('IT-USI-004', 'PRO-QUA-0006'), ('IT-ESS-002', 'PRO-HSE-0004'), ('IT-MON-007', 'PRO-QUA-0007'), ('FO-QHSE-010', 'FRM-HSE-0001'), ('FO-MON-003', 'FRM-QUA-0001'), ('EN-QHSE-001', 'REC-HSE-0001'), ('EXT-QHSE-001', 'NRM-QUA-0001')) AS m("old_id", "new_id") WHERE "actions"."document_id" = m."old_id";--> statement-breakpoint
UPDATE "risk_measure_links" SET "document_id" = m."new_id" FROM (VALUES ('POL-QHSE-001', 'POL-QUA-0001'), ('PR-QHSE-001', 'PRO-QUA-0001'), ('PR-QHSE-002', 'PRO-QUA-0002'), ('PR-QHSE-003', 'PRO-QUA-0003'), ('PR-QHSE-004', 'PRO-HSE-0001'), ('PR-QHSE-005', 'PRO-HSE-0002'), ('PR-ACH-001', 'PRO-QUA-0004'), ('PR-BE-001', 'PRO-QUA-0005'), ('IT-MON-012', 'PRO-HSE-0003'), ('IT-USI-004', 'PRO-QUA-0006'), ('IT-ESS-002', 'PRO-HSE-0004'), ('IT-MON-007', 'PRO-QUA-0007'), ('FO-QHSE-010', 'FRM-HSE-0001'), ('FO-MON-003', 'FRM-QUA-0001'), ('EN-QHSE-001', 'REC-HSE-0001'), ('EXT-QHSE-001', 'NRM-QUA-0001')) AS m("old_id", "new_id") WHERE "risk_measure_links"."document_id" = m."old_id";--> statement-breakpoint
UPDATE "change_log" SET "entity_id" = m."new_id" FROM (VALUES ('POL-QHSE-001', 'POL-QUA-0001'), ('PR-QHSE-001', 'PRO-QUA-0001'), ('PR-QHSE-002', 'PRO-QUA-0002'), ('PR-QHSE-003', 'PRO-QUA-0003'), ('PR-QHSE-004', 'PRO-HSE-0001'), ('PR-QHSE-005', 'PRO-HSE-0002'), ('PR-ACH-001', 'PRO-QUA-0004'), ('PR-BE-001', 'PRO-QUA-0005'), ('IT-MON-012', 'PRO-HSE-0003'), ('IT-USI-004', 'PRO-QUA-0006'), ('IT-ESS-002', 'PRO-HSE-0004'), ('IT-MON-007', 'PRO-QUA-0007'), ('FO-QHSE-010', 'FRM-HSE-0001'), ('FO-MON-003', 'FRM-QUA-0001'), ('EN-QHSE-001', 'REC-HSE-0001'), ('EXT-QHSE-001', 'NRM-QUA-0001')) AS m("old_id", "new_id") WHERE "change_log"."entity_type" = 'document' AND "change_log"."entity_id" = m."old_id";--> statement-breakpoint
ALTER TABLE "document_reviews" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_versions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "document_reviews" CASCADE;--> statement-breakpoint
DROP TABLE "document_versions" CASCADE;--> statement-breakpoint
DROP TABLE "documents" CASCADE;