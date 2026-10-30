# Requêtes inter-applications
Format d'une entrée :
## [YYYY-MM-DD] <app demandeuse> → <cette app> — <titre court>
- Statut : OUVERTE | ACCEPTÉE | REFUSÉE | FAITE
- Demande : (quoi)
- Justification : (pourquoi, impact sur l'app demandeuse)
- Détails techniques : (tables, champs, types, endpoints, exemples)
- Validé par Guillaume le : (date)

## [2026-10-22] Crucible → Vigie — Publier les contrôles périodiques avec un code d'équipement commun (vue pub_controles)
- Statut : FAITE
- Demande : (1) ajouter à la table `controls` une colonne facultative `equipment_code` portant le code commun de l'équipement avec les moyens d'essais de Crucible (ex. `PDE-PIL`) ; (2) publier une vue `vigie.pub_controles` des contrôles périodiques.
- Justification : depuis sa livraison 2, Crucible (planification des moyens d'essais R&D partagés, dépôt Yhumiii27/Crucible) bloque toute réservation d'un moyen dont un contrôle réglementaire arrive à échéance avant la fin du créneau. Vigie est la référence des contrôles ; Crucible les ressaisit aujourd'hui. Sans la vue, la double saisie reste : un contrôle renouvelé dans Vigie mais pas dans Crucible bloque à tort le moyen, et l'inverse le laisse réservable alors qu'il est échu (risque de sécurité).
- Détails techniques : colonne `controls.equipment_code` (text, null admis, nouvelle migration). Vue `pub_controles` (schéma `vigie`, `WITH (security_barrier)`, contrat : colonnes ajoutées en fin seulement). Colonnes : `vigie_ref` (text, identifiant du contrôle), `site_code` (text), `equipement` (text, `equipment`), `equipement_code` (text), `type_controle` (text), `organisme` (text), `periodicite_mois` (integer), `dernier_le` (date), `prochain_le` (date), `reserves` (text), `archive` (boolean, `archived_at` non nul), `maj_le` (timestamptz). Lecteur : `crucible_app` (droit à accorder par Matrix dans `90-droits.sql`). Crucible lit les contrôles dont `equipement_code` correspond à un de ses moyens.
- Validé par Guillaume le : 2026-10-22
- Traitement : colonne `controls.equipment_code` (facultative, saisie « Code équipement » de la fiche du contrôle, écran Veille : majuscules, chiffres et tirets, 2 à 32 caractères, non unique, journalisée) et vue `vigie.pub_controles` (`WITH (security_barrier)`, colonnes du contrat dans l'ordre demandé ; `vigie_ref` = `controls.id` en texte ; tous les contrôles, en vigueur et archivés ; `maj_le` = dernière écriture du journal du contrôle et de ses enregistrements, nulle sans trace ; ni personne ni donnée de santé ; banc BE-1 codé `BE-1` dans la démonstration) (migration 0014, `drizzle/0014_controls_share.sql`, date 22/10/2026 ; reste côté Matrix : droit de lecture de `crucible_app` et copie dans `50-vigie.sql`, demande à valider).


## [2026-10-30] Matrix → Vigie — M-17 : accès entre outils décidés par Matrix (plus de copie de vue, écritures par API ou fonction `pub_`)
- Statut : OUVERTE
- Demande : appliquer dans Vigie la décision M-17 de Matrix (`docs/decisions.md` et `docs/architecture-postgres.md` § 8 sexies du dépôt Matrix) :
  1. **Lire** les données d'un autre outil uniquement par ses vues `pub_` (R2), jamais par ses tables ;
  2. **Écrire** chez un autre outil uniquement par son API ou par une fonction `pub_` qu'il fournit (R4), jamais par `INSERT` / `UPDATE` / `DELETE` dans son schéma ;
  3. pour un **nouvel échange**, ne plus demander à Matrix de recopier une vue dans `partage/` : la migration de Vigie reste la seule définition de ses vues `pub_` (R3), et le besoin d'accès se déclare comme un lien du registre `matrix.liens` (R5) — en attendant l'API `POST /api/liens` (lot M17-4), par une entrée courte dans le `REQUESTS.md` de Matrix : lecteur, objet (`schéma.pub_…`), nature (`lecture` ou `execution`), justification ;
  4. pour une **écriture qu'un autre outil doit faire chez Vigie** : lui fournir une API, ou une fonction `pub_<verbe>_<objet>` créée par migration (`SECURITY DEFINER`, `SET search_path = <schéma>, pg_temp`, appelant identifié par `session_user`, règles et journal de Vigie appliqués, `REVOKE EXECUTE … FROM PUBLIC` ; § « Fonctions pub_ » de la note) ;
  5. reprendre ces règles dans le `CLAUDE.md` de Vigie et dans ses documents de demandes à Matrix, et faire l'inventaire de ses échanges (point de départ ci-dessous), en signalant à Matrix tout accès qui n'y serait pas conforme.
- Justification : décision du responsable produit du 30/10/2026 (M-17) : Matrix décide de chaque accès d'un outil aux données d'un autre, PostgreSQL l'applique. Les vues `pub_` restent les contrats de lecture, mais leur copie par Matrix (quatre étapes par échange, dont deux à la main) disparaît, et l'écriture entre outils devient possible sous le contrôle de Matrix sans contourner les règles métier du propriétaire.
- Détails techniques : relevé du 30/10/2026 sur `main` de Vigie (requêtes SQL vers d'autres schémas) : `keystone.pub_projets`, `pub_livrables`, `pub_fournisseurs`, `pub_articles`, `pub_activites`. Toutes ces lectures passent déjà par des vues `pub_` et aucune écriture directe dans un autre schéma n'a été trouvée : aucune correction urgente. Les vues, droits et fichiers de partage actuels restent en place pendant la transition (lots M17-1 à M17-5 côté Matrix) ; une vue `pub_` existante ne change pas.
- Validé par Guillaume le : 2026-10-30
