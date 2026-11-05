# Édition des données de Vigie depuis Matrix (M-19)

Demande M-19 de Matrix du 05/11/2026, validée par Guillaume le même jour (`REQUESTS.md`). Décision du responsable produit :
« pour le moment, l'admin IT peut modifier toutes les données à l'exception des données sensibles RGPD », **par les
outils**. Matrix n'écrit jamais dans les tables de Vigie (décision M-18) : la DSI corrige depuis la visionneuse de Matrix,
qui appelle une fonction fournie par Vigie. Cette fonction applique les contrôles de saisie de Vigie et écrit son journal.
Convention de Matrix : `docs/edition-par-les-outils.md` de son dépôt.

Livré par la migration `0027_m19_matrix_edit` (05/11/2026). Tests : `test/integration/matrix-edit-m19.test.ts` (PGlite et
PostgreSQL).

## 1. Principe

Les règles métier de Vigie sont écrites en TypeScript (server actions de `src/server/`). Une fonction SQL ne peut pas
toutes les rejouer. Elle n'ouvre donc que ce qu'elle applique fidèlement :

- des **référentiels et registres sans circuit** (ni étape, ni validation, ni notification) ;
- dans ces tables, des **colonnes descriptives** dont la saisie dans Vigie ne fait que des contrôles de présence, de
  longueur, de liste de valeurs, de bornes ou de format. La fonction reprend ces contrôles.

Le reste est fermé. La DSI le fait corriger dans Vigie, par le service QHSE.

## 2. Signature

```sql
vigie.pub_editer(p_table text, p_action text, p_cle jsonb, p_valeurs jsonb, p_par text, p_motif text) RETURNS jsonb
```

| Paramètre | Contenu |
|---|---|
| `p_table` | Nom de la table de Vigie (`controls`, `context_items`…). |
| `p_action` | `ajouter`, `corriger` ou `retirer`. |
| `p_cle` | Clé primaire de la ligne, `{"id": 12}` ou `{"id": "FD-03"}` ; `null` pour `ajouter`. Seule la clé primaire est admise. |
| `p_valeurs` | Colonnes à écrire, `{"colonne": valeur}` ; `null` pour `retirer`. Texte en chaîne JSON, booléen en `true` / `false`, entier en nombre. |
| `p_par` | Nom de la personne connectée à Matrix : obligatoire, 200 caractères au plus, sans caractère de contrôle. |
| `p_motif` | Motif saisi dans Matrix. Même règle que les motifs de Vigie (`reasonError`, `src/lib/forms.ts`) : obligatoire après suppression des espaces, 1 000 caractères au plus. |

Propriétés : `SECURITY DEFINER` (propriétaire `vigie_app`), `search_path` fixé au schéma de Vigie puis `pg_temp`,
`EXECUTE` retiré à `PUBLIC`. Le droit d'exécution est le lien « écriture » `matrix_app` → `vigie.pub_editer` du registre
`matrix.liens`, posé par Matrix seulement. Les noms de table et de colonne viennent toujours du registre (`format('%I')`).
Les valeurs passent en paramètres (`jsonb_populate_record`) et ne sont jamais concaténées au SQL. Commentaire de la
fonction : « Contrat M-19 v1 ». La signature ne change jamais : une nouvelle version prendra un nouveau nom.

**Résultat** : la ligne après modification, réduite à la clé, aux colonnes ouvertes et à `archived_at` quand la table en
a un. Aucune autre colonne n'est renvoyée.

## 3. Registre des tables et colonnes ouvertes

Deux tables de Vigie, remplies par la migration : `external_edit_tables` (table, libellé, type de fiche du journal, clé,
ajout et retrait ouverts) et `external_edit_columns` (colonne, libellé du journal, longueur maximale, obligatoire, liste de
valeurs, bornes, format). Elles ne s'éditent pas depuis l'interface. Toute ouverture nouvelle passe par une migration.

| Table | Fiche du journal | Colonnes ouvertes (contrôles) | Ajouter | Retirer |
|---|---|---|:-:|:-:|
| `sites` (attributs propres à Vigie) | `site` | `seveso` (seuil haut, seuil bas, vide), `pp_from_first_minute`, `alsace_moselle` | non | non |
| `map_zones` | `site_map` (carte du site) | `name` (80, obligatoire), `kind` (liste des types de zone), `notes` (1 000) | non | non |
| `waste_streams` | `waste_stream` | `channel` (80, obl.), `collector` (160, obl.), `collector_address` (300), `collector_receipt` (60), `destination` (200, obl.), `destination_address` (300) | non | oui |
| `contractors` | `contractor` | `trade` (120, obl.), `contact_name` (120), `contact_phone` (40), `contact_email` (160, format e-mail) | non | non |
| `context_items` | `context_item` | `kind` (liste), `label` (200, obl.), `detail` (2 000), `treatment` (2 000 ; exigé pour un risque ou une opportunité) | oui | oui |
| `qhse_objectives` | `qhse_objective` | `label` (200, obl.) | non | oui |
| `requirements` | `requirement` | `text` (120, obl.), `domain` (120, obl.), `summary` (1 000, obl.), `impact` (300) | non | non |
| `controls` | `control` | `equipment` (160, obl.), `control_type` (120, obl.), `organization` (120, obl.), `tolerance` (120) | non | oui |
| `emergency_situations` | `emergency_situation` | `label` (160, obl.), `scenario` (2 000), `response` (2 000), `drill_months` (1 à 60) ; `site_id` à l'ajout seulement | oui | oui |
| `certifications` | `certification` | `domain` (60, obl.), `standard` (80, obl.), `note` (240), `organization` (120) | non | non |
| `training_titles` (attributs QHSE) | `training_title` | `first_aid`, `awareness`, `internal_auditor` | non | non |

Les longueurs, les listes et les bornes sont celles des server actions de Vigie (`saveSiteRule`, `saveSite`, `saveZone`,
`saveWasteStream`, `saveContractor`, `saveContextItem`, `saveObjective`, `saveRequirement`, `saveControl`,
`saveEmergencySituation`, `saveCertification`, `saveTitle`). Les libellés sont ceux de leur journal. Le test vérifie que
les listes de valeurs du registre sont celles de l'interface (`ZONE_KINDS`, `CONTEXT_KINDS`, `SEVESO_LEVELS`).

Texte : les espaces de début et de fin sont retirés, comme dans Vigie. Une valeur vide est refusée si le champ est
obligatoire. Sinon elle devient `NULL`, ou une chaîne vide quand la colonne est `NOT NULL` en base (`note`, `detail`…),
comme le fait la saisie de Vigie.

## 4. Actions

- **corriger** : seules les colonnes dont la valeur change sont écrites et journalisées. Une correction qui ne change
  rien n'écrit rien. Une ligne archivée, annulée ou masquée est refusée (« Ligne archivée : … ») : elle se réactive
  d'abord dans Vigie. Le site d'une ligne ne change jamais depuis Matrix, car un déplacement a ses règles (DUE-14).
- **ajouter** : ouvert seulement aux tables dont la création dans Vigie ne tire ni référence (`EE-`, `FD-`, `ES-`…), ni
  notification, ni circuit, soit `context_items` et `emergency_situations`. Toute colonne obligatoire en base et sans
  valeur par défaut doit être fournie. Le site (`site_id`) doit exister et ne pas être archivé, comme
  `requireInSite(…, { create: true })`. L'ordre (`sort`) suit le dernier élément, comme `nextSort`. L'auteur
  (`created_by_id`) reste vide.
- **retirer** : archivage motivé, jamais une suppression : `archived_at = now()`, `archived_by_id = NULL`,
  `archive_reason = p_motif`. Ouvert seulement aux tables dont l'archivage dans Vigie n'a pas d'autre règle :
  `waste_streams`, `context_items`, `qhse_objectives`, `controls`, `emergency_situations`. Une ligne déjà archivée est
  refusée.

## 5. Ce qui est refusé, et pourquoi

| Refus | Raison |
|---|---|
| Tables `events`, `event_*`, `benign_accidents`, `actions`, `action_*`, `notifications`, `notification_reads` | Circuits, étapes, notifications et données de santé : règles de Vigie non reproductibles en SQL. |
| `change_log`, `access_log`, `sync_runs`, `inbound_*`, `report_rate_limits`, `ai_usage`, `external_edit_*` | Journaux, compteurs et registres techniques. |
| `people`, `hours_worked`, `attachments` | Données personnelles (les personnes viendront de Cursus, D01) et pièces jointes (chiffrées, fichiers). |
| `keystone_assignments`, libellé et ordre des sites, intitulé et validité des titres | Caches de Matrix, Keystone et Cursus : ces données se corrigent chez leur propriétaire. |
| Toute autre table hors du registre (risques, unités de travail, plans, permis, audits, revues, documents, enlèvements, études…) | Pas encore ouvertes (phase 1). Elles ont des numéros, des circuits ou des règles d'archivage propres. |
| Colonnes de santé | `HEALTH_LABELS` de `src/lib/rules/events.ts` (blessure, jours perdus, CPAM, lésions, soins, réserves, champs `mp_*`…), `attachments.health` et les soins du registre des accidents bénins. Le refus est inscrit dans la fonction, indépendamment du registre et de Matrix. |
| Identifiants, références, ordre, états, étapes, versions, `qr_version`, contours | Tenus par Vigie (numérotation, circuits, QR codes, carte). |
| Triplets d'archivage et d'annulation, auteurs et dates de saisie | Archivage par « retirer » seulement, avec le motif. |
| Clés et données des autres outils : `keystone_*`, `supplier_id`, `capex_code`, `equipment_code`, `matricule`, `entra_object_id` | Choisies dans les vues de Keystone, d'Arche ou de Crucible, avec les contrôles de Vigie (`unknownProjectError`, `supplierError`, `equipmentCodeError`). |
| `site_id` sur `corriger` | Changer de site a des règles (actions liées, DUE-14 ; filières utilisées). |

Les refus par nom de colonne sont écrits dans la fonction `external_edit_denied`. Même si le registre ouvrait une de ces
colonnes par erreur, elle resterait refusée. Ces refus valent en plus de ceux de Matrix, qui retire déjà
`droits.colonnes_sensibles`.

Pas encore ouvert, car la règle de Vigie dépasse un contrôle de saisie :

- libellé d'une filière (unique par site) ou d'une entreprise (unique) ;
- codes déchet, SIRET et codes de traitement (format et qualification) ;
- périodicité et dates d'un contrôle (prochain contrôle recalculé, enregistrements) ;
- évaluation, pilote, échéance et rattachements d'une exigence ;
- engagement et dates d'un référentiel ;
- indicateur et cible d'un objectif ;
- responsable d'une situation d'urgence et date d'exercice (personne présente, pas de date passée).

Retraits non ouverts :

- entreprise extérieure (refusé tant qu'un plan ou un permis est en cours) ;
- zone (les activités sont détachées et le QR code révoqué) ;
- exigence (la mise en avant est retirée) ;
- titre (refusé tant qu'un recyclage est ouvert) ;
- site (un site au moins doit rester actif ; Matrix fait foi) ;
- référentiel (sans archivage).

Le programme d'audit (`audit_plan_tracks`) et les unités de travail ne sont pas ouverts : renommer une ligne touche ses
éléments, et un libellé d'unité est unique par site.

## 6. Journal

Chaque écriture ajoute une ligne à `change_log`, dans la transaction de l'écriture :

- `entity_type` : celui de la fiche dans Vigie (registre) ;
- `entity_id` : la clé, ou le site pour une zone (journal de la carte du site) ;
- `action` : `create`, `update` ou `archive` ;
- `summary` : « Corrigé depuis Matrix par <p_par> (<session_user>) », ou « Ajouté… », « Retiré (archivé)… ». Pour une
  zone, la phrase est suivie de « · Zone de la carte n° <id> ».
- `reason` : le motif ;
- `details` : `[{field, from, to}]` des seules valeurs changées, avec le libellé du journal de Vigie (oui / non, libellé
  d'une liste) ;
- `by_id` : `NULL`, car la personne de Matrix n'est pas à l'effectif de Vigie.

L'historique de la fiche montre donc la correction. Comme la version d'une fiche (QUA-12) est le numéro de sa dernière
entrée du journal, un formulaire ouvert dans Vigie avant la correction est refusé comme périmé. C'est voulu.

## 7. Erreurs

Tout refus lève `RAISE EXCEPTION` avec le SQLSTATE **`P0V03`** (`P0V01` et `P0V02` sont ceux de
`pub_signaler_avancement_nc`, D13). Le message, en français, est montré tel quel par Matrix. Exemples :

- `Table non ouverte à l'édition depuis Matrix : risks.`
- `Colonne refusée : injury (donnée de santé).`
- `« Équipement » : 160 caractères au maximum.`
- `« Type » : valeur non autorisée (valeurs admises : …).`
- `Ligne archivée : Filière de déchets FD-03 ne se modifie plus depuis Matrix (à réactiver d'abord dans Vigie).`
- `Motif obligatoire.`

Une contrainte de la base (CHECK, NOT NULL, clé étrangère, unicité) qui refuse l'écriture donne aussi un message
lisible : « Valeur refusée par les règles de Vigie (<champ ou contrainte>) : rien n'a été modifié. » Rien n'est écrit,
ni la ligne ni le journal.

## 8. Points appliqués par défaut, à confirmer

Repris au § 19 de `docs/RESTE-A-FAIRE.md` (« M-19 : points appliqués par défaut »).

1. Fonction générique unique (`pub_editer`) plutôt qu'une fonction par table.
2. Périmètre de la phase 1 : les 11 tables du § 3, colonnes descriptives seulement.
3. Ajout limité aux éléments du contexte et aux situations d'urgence.
4. Retrait limité aux cinq tables sans règle d'archivage propre ; jamais de réactivation depuis Matrix.
5. Auteur du journal vide (`by_id` NULL) ; la personne de Matrix est nommée dans la phrase du journal.
6. Correction d'une ligne archivée refusée.
7. Registre tenu par migration seulement, sans écran d'administration.
