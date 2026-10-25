-- QUA-17 : index des chargements filtrés par site (actions, événements, contrôles : siteWhere de src/lib/queries.ts), des
-- pièces d'une fiche (attachments par type et identifiant) et des risques d'une action (risk_actions). Index seulement :
-- aucune donnée modifiée, aucune vue pub_ touchée. Sur un gros volume, la création prend un verrou d'écriture le temps de
-- construire l'index (quelques secondes pour des tables de cette taille).
CREATE INDEX "actions_site_idx" ON "actions" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "attachments_entity_idx" ON "attachments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "controls_site_idx" ON "controls" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "events_site_idx" ON "events" USING btree ("site_id","occurred_on");--> statement-breakpoint
CREATE INDEX "risk_actions_action_idx" ON "risk_actions" USING btree ("action_id");