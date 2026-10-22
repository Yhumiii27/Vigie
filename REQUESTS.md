# Requêtes inter-applications
Format d'une entrée :
## [YYYY-MM-DD] <app demandeuse> → <cette app> — <titre court>
- Statut : OUVERTE | ACCEPTÉE | REFUSÉE | FAITE
- Demande : (quoi)
- Justification : (pourquoi, impact sur l'app demandeuse)
- Détails techniques : (tables, champs, types, endpoints, exemples)
- Validé par Guillaume le : (date)

## [2026-10-22] Crucible → Vigie — Publier les contrôles périodiques avec un code d'équipement commun (vue pub_controles)
- Statut : OUVERTE
- Demande : (1) ajouter à la table `controls` une colonne facultative `equipment_code` portant le code commun de l'équipement avec les moyens d'essais de Crucible (ex. `PDE-PIL`) ; (2) publier une vue `vigie.pub_controles` des contrôles périodiques.
- Justification : depuis sa livraison 2, Crucible (planification des moyens d'essais R&D partagés, dépôt Yhumiii27/Crucible) bloque toute réservation d'un moyen dont un contrôle réglementaire arrive à échéance avant la fin du créneau. Vigie est la référence des contrôles ; Crucible les ressaisit aujourd'hui. Sans la vue, la double saisie reste : un contrôle renouvelé dans Vigie mais pas dans Crucible bloque à tort le moyen, et l'inverse le laisse réservable alors qu'il est échu (risque de sécurité).
- Détails techniques : colonne `controls.equipment_code` (text, null admis, nouvelle migration). Vue `pub_controles` (schéma `vigie`, `WITH (security_barrier)`, contrat : colonnes ajoutées en fin seulement). Colonnes : `vigie_ref` (text, identifiant du contrôle), `site_code` (text), `equipement` (text, `equipment`), `equipement_code` (text), `type_controle` (text), `organisme` (text), `periodicite_mois` (integer), `dernier_le` (date), `prochain_le` (date), `reserves` (text), `archive` (boolean, `archived_at` non nul), `maj_le` (timestamptz). Lecteur : `crucible_app` (droit à accorder par Matrix dans `90-droits.sql`). Crucible lit les contrôles dont `equipement_code` correspond à un de ses moyens.
- Validé par Guillaume le : 2026-10-22
