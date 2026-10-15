CREATE TABLE "action_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"author_id" text NOT NULL,
	"author_role" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_id" text,
	"withdraw_reason" text,
	CONSTRAINT "action_comments_body_check" CHECK (char_length("action_comments"."body") between 1 and 4000),
	CONSTRAINT "action_comments_withdraw_check" CHECK (("action_comments"."withdrawn_at" is null) = ("action_comments"."withdraw_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "action_counters" (
	"scope" text PRIMARY KEY NOT NULL,
	"last" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_reminder_sends" (
	"person_id" text NOT NULL,
	"week" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"email" text,
	"action_count" integer DEFAULT 0 NOT NULL,
	"late_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "action_reminder_sends_person_id_week_pk" PRIMARY KEY("person_id","week"),
	CONSTRAINT "action_reminder_sends_status_check" CHECK ("action_reminder_sends"."status" in ('en_cours', 'envoye', 'echec', 'sans_adresse')),
	CONSTRAINT "action_reminder_sends_week_check" CHECK ("action_reminder_sends"."week" ~ '^[0-9]{4}-W[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"title" text NOT NULL,
	"href" text NOT NULL,
	"by_id" text,
	"comment_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "actions" ALTER COLUMN "status" SET DEFAULT 'a_faire';--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "opened_on" date;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "priority" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "initial_due_on" date;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "done_on" date;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "domain" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "problem" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "detail" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "verify_method" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "effective" boolean;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "new_risk" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "risk_level" integer;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "hours" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "estimated_cost" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "actual_cost" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "follows_action_id" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "follow_reason" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "legacy_origin" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "comment_id" integer;--> statement-breakpoint
ALTER TABLE "action_comments" ADD CONSTRAINT "action_comments_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_comments" ADD CONSTRAINT "action_comments_author_id_people_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_comments" ADD CONSTRAINT "action_comments_withdrawn_by_id_people_id_fk" FOREIGN KEY ("withdrawn_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_reminder_sends" ADD CONSTRAINT "action_reminder_sends_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_by_id_people_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_comment_id_action_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."action_comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_comments_action_idx" ON "action_comments" USING btree ("action_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_person_idx" ON "notifications" USING btree ("person_id","created_at");--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_follows_action_id_actions_id_fk" FOREIGN KEY ("follows_action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_comment_id_action_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."action_comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_pilot_idx" ON "actions" USING btree ("pilot_id");--> statement-breakpoint
CREATE INDEX "actions_follows_idx" ON "actions" USING btree ("follows_action_id");--> statement-breakpoint
CREATE INDEX "attachments_comment_idx" ON "attachments" USING btree ("comment_id");--> statement-breakpoint
-- ACT-19 : reprise des actions existantes (docs/specs/actions-qse.md § 18). Déterministe, sans valeur inventée : un champ obligatoire qui ne se déduit pas reste vide (« à compléter », calculé par missingFields, src/lib/action-rules.ts). Avancement : todo → a_faire, doing → initiee, verify → terminee, done → verifiee, cancelled → abandonnee ; un avancement inconnu n'est pas transformé : la contrainte actions_status_check qui suit échoue et toute la migration est annulée (base laissée en 0004, sauvegarde automatique faite avant). Source (réponses du service QHSE du 15/10/2026, ACT-37) : env → Déchets ; skills et prevention → vide (plus d'action QSE pour les recyclages ni les plans de prévention : le QHSE complète ou abandonne). Date effective d'une action « verify » : dernier « Déclarée réalisée » du journal, sinon vide — y compris les recyclages passés à « verify » par les Habilitations sans entrée de journal (la date de formation n'est pas reprise : règle que la spécification ne pose pas). L'origine d'avant 0005 est gardée dans legacy_origin (D9).
UPDATE "actions" SET "legacy_origin" = "origin";--> statement-breakpoint
-- Date d'ouverture = date de Paris de la création ; date cible initiale = date cible ; détail = intitulé, puis les précisions à la ligne (précisions vides ou faites seulement d'espaces, tabulations, retours à la ligne : intitulé seul).
UPDATE "actions" SET "opened_on" = ("created_at" AT TIME ZONE 'Europe/Paris')::date, "initial_due_on" = "due_on", "detail" = CASE WHEN coalesce("description", '') ~ '^\s*$' THEN "title" ELSE "title" || chr(10) || "description" END;--> statement-breakpoint
-- Source d'après l'origine (§ 12, § 18) ; audit : ligne du programme de l'élément qui porte l'action, sinon de celui de son constat (IS NOT DISTINCT FROM : un élément atteint par un constat a action_id NULL) — Certification, Visites sécurité, Fournisseurs, Revues de direction (élément qui porte l'action, comme admissibleSources), défaut Audit interne ISO ; watch : contrôle, sinon Veille ; rev : décision « objectif », sinon Revue de direction. Action annulée sans l'élément qui décide (l'ancienne annulation détachait constats, éléments du programme, exigences, contrôles et décisions) : vide (source non déterminable ; rien à compléter sur une Abandonnée).
UPDATE "actions" a SET "source" = CASE a."origin"
  WHEN 'ev' THEN 'evenement'
  WHEN 'client' THEN 'reclamation_client'
  WHEN 'risk' THEN 'duerp'
  WHEN 'docs' THEN 'revue_documentaire'
  WHEN 'env' THEN 'dechets'
  WHEN 'audit' THEN coalesce((
    SELECT CASE
        WHEN p."track" = 'Certification' THEN 'audit_certification'
        WHEN p."track" = 'Visites sécurité' THEN 'audit_terrain'
        WHEN p."track" = 'Fournisseurs' THEN 'audit_fournisseur'
        WHEN p."track" = 'Revues de direction' AND p."action_id" IS NOT DISTINCT FROM a."id" THEN 'revue_direction'
        ELSE 'audit_interne' END
    FROM "audit_plan_items" p
    WHERE p."action_id" = a."id" OR p."id" IN (SELECT f."plan_item_id" FROM "audit_findings" f WHERE f."action_id" = a."id" AND f."plan_item_id" IS NOT NULL)
    ORDER BY (p."action_id" IS NOT DISTINCT FROM a."id") DESC, p."id" LIMIT 1),
    CASE WHEN a."status" = 'cancelled' AND NOT EXISTS (SELECT 1 FROM "audit_findings" f WHERE f."action_id" = a."id") THEN NULL ELSE 'audit_interne' END)
  WHEN 'watch' THEN CASE
    WHEN EXISTS (SELECT 1 FROM "controls" c WHERE c."action_id" = a."id") THEN 'controle_reglementaire'
    WHEN a."status" = 'cancelled' AND NOT EXISTS (SELECT 1 FROM "requirements" r WHERE r."action_id" = a."id") THEN NULL
    ELSE 'veille' END
  WHEN 'rev' THEN CASE
    WHEN EXISTS (SELECT 1 FROM "review_decisions" d WHERE d."action_id" = a."id" AND d."kind" = 'objectif') THEN 'objectif'
    WHEN a."status" = 'cancelled' AND NOT EXISTS (SELECT 1 FROM "review_decisions" d WHERE d."action_id" = a."id") THEN NULL
    ELSE 'revue_direction' END
  ELSE NULL END;--> statement-breakpoint
-- Date effective (avancements encore anciens) : verify → dernier « Déclarée réalisée » du journal, sinon vide ; done → dernier « Déclarée réalisée », sinon date de vérification, jamais après celle-ci.
UPDATE "actions" a SET "done_on" = CASE
    WHEN a."status" = 'verify' THEN j."d"
    ELSE least(coalesce(j."d", a."closed_on"), coalesce(a."closed_on", j."d")) END
  FROM (SELECT x."id", (SELECT (max(l."at") AT TIME ZONE 'Europe/Paris')::date FROM "change_log" l
          WHERE l."entity_type" = 'action' AND l."entity_id" = x."id" AND l."action" = 'status' AND l."summary" LIKE 'Déclarée réalisée%') AS "d"
        FROM "actions" x) j
  WHERE j."id" = a."id" AND a."status" IN ('verify', 'done');--> statement-breakpoint
-- Résultat des actions clôturées : efficace (la clôture exigeait une efficacité vérifiée) ; nature de la vérification vide (à compléter).
UPDATE "actions" SET "effective" = true WHERE "status" = 'done';--> statement-breakpoint
-- Une entrée de journal « Reprise du modèle Power Apps » par action (by_id vide : reprise automatique ; at : date de reprise), avec les valeurs transformées (clés d'avancement pour les statistiques, ACT-29).
INSERT INTO "change_log" ("entity_type", "entity_id", "action", "summary", "details", "by_id")
SELECT 'action', a."id", 'reprise', 'Reprise du modèle Power Apps',
  (SELECT jsonb_agg(e."item" ORDER BY e."n") FROM jsonb_array_elements(jsonb_build_array(
     jsonb_build_object('field', 'Avancement',
       'from', CASE a."status" WHEN 'todo' THEN 'À lancer' WHEN 'doing' THEN 'En cours' WHEN 'verify' THEN 'Efficacité à vérifier' WHEN 'done' THEN 'Clôturée' WHEN 'cancelled' THEN 'Annulée' ELSE a."status" END,
       'to', CASE a."status" WHEN 'todo' THEN 'À faire' WHEN 'doing' THEN 'Budgétée ou initiée' WHEN 'verify' THEN 'Terminée — à vérifier' WHEN 'done' THEN 'Vérifiée' WHEN 'cancelled' THEN 'Abandonnée' ELSE a."status" END,
       'fromKey', a."status",
       'toKey', CASE a."status" WHEN 'todo' THEN 'a_faire' WHEN 'doing' THEN 'initiee' WHEN 'verify' THEN 'terminee' WHEN 'done' THEN 'verifiee' WHEN 'cancelled' THEN 'abandonnee' ELSE a."status" END),
     jsonb_build_object('field', 'Nature', 'from', CASE a."kind" WHEN 'C' THEN 'Corrective' WHEN 'P' THEN 'Préventive' ELSE a."kind" END, 'to', NULL, 'fromKey', a."kind"),
     jsonb_build_object('field', 'Origine',
       'from', CASE a."origin" WHEN 'ev' THEN 'Événement' WHEN 'audit' THEN 'Audit' WHEN 'risk' THEN 'Risques' WHEN 'watch' THEN 'Veille' WHEN 'client' THEN 'Client' WHEN 'rev' THEN 'Revue de direction' WHEN 'skills' THEN 'Habilitations' WHEN 'prevention' THEN 'Prévention' WHEN 'docs' THEN 'Documents' WHEN 'env' THEN 'Environnement' ELSE a."origin" END,
       'to', NULL, 'fromKey', a."origin"),
     jsonb_build_object('field', 'Source', 'from', NULL,
       'to', coalesce(CASE a."source" WHEN 'evenement' THEN 'Évènement QSE' WHEN 'reclamation_client' THEN 'Réclamation client' WHEN 'duerp' THEN 'DUERP' WHEN 'revue_documentaire' THEN 'Revue documentaire' WHEN 'dechets' THEN 'Déchets' WHEN 'audit_certification' THEN 'Audit de certification ISO' WHEN 'audit_terrain' THEN 'Audit terrain' WHEN 'audit_fournisseur' THEN 'Audit fournisseur' WHEN 'audit_interne' THEN 'Audit interne ISO' WHEN 'controle_reglementaire' THEN 'Contrôle réglementaire' WHEN 'veille' THEN 'Veille réglementaire' WHEN 'objectif' THEN 'Objectif QSE' WHEN 'revue_direction' THEN 'Revue de direction' END,
         CASE WHEN a."status" = 'cancelled' THEN 'Non déterminée' ELSE 'À compléter' END),
       'toKey', a."source"),
     jsonb_build_object('field', 'Intitulé', 'from', a."title", 'to', NULL),
     jsonb_build_object('field', 'Précisions', 'from', CASE WHEN coalesce(a."description", '') ~ '^\s*$' THEN NULL ELSE a."description" END, 'to', NULL),
     jsonb_build_object('field', 'Détail de l''action', 'from', NULL, 'to', 'Intitulé et précisions fusionnés'),
     jsonb_build_object('field', 'Date d''ouverture', 'from', NULL, 'to', to_char(a."opened_on", 'DD/MM/YYYY')),
     jsonb_build_object('field', 'Date cible initiale', 'from', NULL, 'to', to_char(a."initial_due_on", 'DD/MM/YYYY')),
     jsonb_build_object('field', 'Date effective', 'from', NULL, 'to', to_char(a."done_on", 'DD/MM/YYYY')),
     jsonb_build_object('field', 'Résultat', 'from', NULL, 'to', CASE WHEN a."effective" THEN 'Efficace' END)
   )) WITH ORDINALITY AS e("item", "n") WHERE e."item"->>'from' IS NOT NULL OR e."item"->>'to' IS NOT NULL),
  NULL
FROM "actions" a;--> statement-breakpoint
-- Avancement dans le nouveau modèle (en dernier : les reprises précédentes lisent les anciennes valeurs).
UPDATE "actions" SET "status" = CASE "status" WHEN 'todo' THEN 'a_faire' WHEN 'doing' THEN 'initiee' WHEN 'verify' THEN 'terminee' WHEN 'done' THEN 'verifiee' WHEN 'cancelled' THEN 'abandonnee' ELSE "status" END;--> statement-breakpoint
-- ACT-35 : compteur de numérotation initialisé au plus grand numéro « A-n » déjà vu (actions et journal) ; 10 chiffres ou plus : ignoré (pas de dépassement d'entier) ; base vide : 0.
INSERT INTO "action_counters" ("scope", "last") SELECT 'A', coalesce(max(substring(x."id" from '^A-([0-9]{1,9})$')::integer), 0) FROM (SELECT "id" FROM "actions" UNION SELECT "entity_id" FROM "change_log" WHERE "entity_type" = 'action') x;--> statement-breakpoint
-- Champs obligatoires du nouveau modèle, renseignés par la reprise.
ALTER TABLE "actions" ALTER COLUMN "opened_on" SET NOT NULL;--> statement-breakpoint
-- Champs obligatoires du nouveau modèle, renseignés par la reprise.
ALTER TABLE "actions" ALTER COLUMN "detail" SET NOT NULL;--> statement-breakpoint
-- Champs obligatoires du nouveau modèle, renseignés par la reprise.
ALTER TABLE "actions" ALTER COLUMN "initial_due_on" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_status_check" CHECK ("actions"."status" in ('a_faire', 'initiee', 'p20', 'p40', 'p60', 'p80', 'reportee', 'terminee', 'verifiee', 'abandonnee'));--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_source_check" CHECK ("actions"."source" is null or "actions"."source" in ('analyse_risque', 'analyse_chimique', 'analyse_environnementale', 'audit_certification', 'audit_fournisseur', 'audit_interne', 'audit_terrain', 'autorite_publique', 'causerie', 'comex', 'controle_reglementaire', 'dechets', 'duerp', 'evenement', 'objectif', 'reclamation_client', 'reunion_operationnelle', 'revue_direction', 'revue_documentaire', 'revue_processus', 'veille', 'hazop', 'reserves', 'rex'));--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_domain_check" CHECK ("actions"."domain" is null or "actions"."domain" in ('qualite', 'securite', 'sante', 'environnement', 'surete'));--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_priority_check" CHECK ("actions"."priority" is null or "actions"."priority" in ('urgent', 'moyen_terme', 'long_terme'));--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_verify_method_check" CHECK ("actions"."verify_method" is null or "actions"."verify_method" in ('audit_visite', 'ecrit', 'reunion', 'visuelle', 'autre'));--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_follow_reason_check" CHECK ("actions"."follow_reason" is null or "actions"."follow_reason" in ('non_efficace', 'nouveau_risque'));--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_follow_pair_check" CHECK (("actions"."follows_action_id" is null) = ("actions"."follow_reason" is null));--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_risk_level_check" CHECK ("actions"."risk_level" is null or "actions"."risk_level" between 0 and 4);--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_amounts_check" CHECK (("actions"."hours" is null or "actions"."hours" >= 0) and ("actions"."estimated_cost" is null or "actions"."estimated_cost" >= 0) and ("actions"."actual_cost" is null or "actions"."actual_cost" >= 0));--> statement-breakpoint
ALTER TABLE "actions" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "actions" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "actions" DROP COLUMN "origin";--> statement-breakpoint
ALTER TABLE "actions" DROP COLUMN "kind";