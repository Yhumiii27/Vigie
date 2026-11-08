# Convergence des données (décision M-02 de Matrix) appliquée à Vigie — note de cadrage

État au 02/11/2026, mis à jour le 03/11/2026 : **lot 0 et lot 1 sans D01 développés** (D14, D02, D04, D16, contrôle D18 ;
migration `0024_convergence_m02`, voir § 7) ; le 04/11/2026 : **lot 2 développé** en consultation seule (D08, D09 ; décision
CV-01 ; migration `0025_convergence_m02_titles`, voir § 7 bis), décisions CV-07 et CV-08 (§ 6) ; le 05/11/2026 : **lot 3 développé**
(D13 : numéro `EV-…`, fonction `vigie.pub_signaler_avancement_nc` et boîte de réception ; migration `0026_convergence_m02_nc_inbox`,
voir § 7 ter) ; le 05/11/2026 aussi : **lot 4 développé** (D10 : documents lus dans Codex, décision CV-05 « avancer D10 » ;
migration `0028_convergence_m02_documents`, voir § 7 quater) ; le 07/11/2026 : **D01 et PRV-25 développés** (personnes lues dans
Cursus, liste du poste de garde ; décision CV-10 ; migration `0030_convergence_m02_people`, voir § 7 sexies). Rien n'est encore demandé aux autres outils. Les demandes du § 5 sont des
textes prêts à coller, à valider par Guillaume ; les questions du § 6 attendent le responsable produit, le service QHSE
ou les RH.

Sommaire : 1. Objet, sources et état · 2. Socle commun des lectures croisées · 3. Décision par décision · 4. Ordre des
lots · 5. Demandes aux autres outils · 6. Questions · Annexe : écarts relevés dans le plan de Matrix · 7. Réalisation du
03/11/2026 · 7 bis. Réalisation du 04/11/2026 · 7 ter. Réalisation du 05/11/2026 · 7 quater. Réalisation du 05/11/2026 (lot 4) · 7 quinquies. Réalisation du 05/11/2026 (lot 5) · 7 sexies. Réalisation du 07/11/2026 (D01, PRV-25).

## 1. Objet, sources et état

### 1.1 Objet

M-02 (15/10/2026) retient une option pour chacun des 20 groupes de données en double entre les outils d'EPC2i ; le plan
de Matrix (`docs/convergence-des-donnees.md`) en décrit la mise en œuvre et compte **49 jours** pour Vigie (§ 5.4). Ce
plan a été écrit d'après le commit `b658790` de Vigie. Depuis, Vigie a livré les paquets 5 à 15, les lots A et B de la
classe 1 et les études de sécurité (migrations jusqu'à `0023`), et Matrix a changé de méthode (M-13, M-17, M-18). Cette
note dit, pour Vigie seulement : ce qui reste valable, ce que chaque décision change dans le code, ce qu'elle retire des
fonctions livrées depuis le 15/10, ce qu'elle attend des autres outils, et dans quel ordre la faire.

### 1.2 Sources

| Source | Version lue | Contenu utilisé |
|---|---|---|
| Plan de Matrix `docs/convergence-des-donnees.md` | `origin/main` de Matrix (`78c99e7`), fichier modifié en dernier le 22/10/2026 (`655c72a`), rédigé le 15/10/2026 d'après Vigie `b658790` | § 1.3 à 1.5, D01 à D20, § 5.4, § 6, § 7, § 8 (C-01 à C-13) |
| Journal des décisions de Matrix `docs/decisions.md` | `be94a58`, 01/11/2026 | M-02, M-03, M-05, P-02, P-03, M-12 / D23, M-13, M-17, M-18 |
| `docs/architecture-postgres.md` de Matrix | `20efc3a`, 02/11/2026 | § 8 sexies (M-17, règles R1 à R7, fonctions `pub_`), § 8 septies (M-18, `matrix_gestion`, registre `matrix.publications`), § 9, § 10 |
| `docs/remplacement-lucca.md` de Matrix | idem | flux H3 (heures par site et par mois lues par Vigie), § 3.6, § 5.3 |
| Partage de Matrix | `infra/postgres/partage/10`, `20`, `50`, `60`, `90-droits.sql`, `data/publications-depot.json` | définition actuelle des vues `matrix.pub_*`, liens « convention » de `vigie_app` (`90-droits.sql:192-240`), vues ECR / ECO en attente |
| Cursus | `origin/main` `360824c` (02/11/2026) | vues `pub_salaries`, `pub_titres`, `pub_titres_detenus`, `pub_parametres` (`server/migrations-pg/0002_partage.sql:56-158`, avenant `0011_pub_titres_valides.sql`), routes d'intégration (`server/src/app.ts:102`), `docs/ECHANGES.md`, `docs/demandes/matrix-lot11-indicateurs.md` § 3, `docs/DEMANDES-LOT8-DONNEES.md` (avenant D09) |
| Keystone | `origin/main` `c585f12` (02/11/2026) | vues `drizzle/0035_share.sql`, `0038_share_followup.sql` ; connecteurs `src/server/integrations/vigie/*` ; contrat proposé `docs/integrations/vigie-contract.md` |
| Codex | `origin/main` `acb457b` (02/11/2026) | vues `drizzle/0001_partage.sql:20-122` ; `src/lib/vigie.ts` ; `docs/api.md` (import, dépôt, webhook Vigie) |
| Vigie | `5b4cfd5` (02/11/2026) | `CLAUDE.md`, `docs/RESTE-A-FAIRE.md`, `REQUESTS.md`, `src/db/schema.ts`, écrans, server actions, tests |

Les références É5, É9 et É14 citées dans la commande de cette note ne figurent dans aucun des dépôts lus (seule É13
apparaît, `docs/RESTE-A-FAIRE.md:115`) ; elles sont traitées ici par leur objet : numéro de NC (§ 3.10, CV-07), ECR / ECO
(§ 3.12, CV-06), habilitations et documents tenus par Cursus et Codex (§ 3.7, 3.8, 3.11, CV-01, CV-05).

### 1.3 Ce qui a changé depuis le 15/10/2026

**Côté Matrix (méthode).**

| Décision | Effet sur la convergence de Vigie |
|---|---|
| P-02 (18/10) | Les migrations publiées de Vigie restent intactes ; le serveur les réécrit en `"vigie".` (`src/db/migrations.ts`). Plus de migration de base régénérée. |
| P-03 (18/10) | **Aucune reprise de données pour Vigie** : sur le serveur, Vigie démarre vide (ou sur sa démonstration). Les rapprochements du plan (12 noms provisoires, 10 codes K-AAAA-NNN, 39 formations, 15 documents, sites `ville-a` / `ville-b`) ne valent plus que pour le jeu de démonstration, **tant que le service QHSE ne saisit rien en production avant la convergence** (voir CV-05). |
| M-13 (24/10) | Registre `matrix.liens` : les droits de lecture de `vigie_app` sont des liens du registre. Les liens de la « convention » du 15/10 y sont inscrits comme autorisés (`90-droits.sql:192-201`) : **toutes les vues que Vigie lirait d'après le plan ont déjà `vigie_app` pour lecteur** (§ 5.1). |
| M-17 (30/10) | Lecture par vues `pub_` seulement ; écriture chez un autre outil par son API ou une fonction `pub_` qu'il fournit ; un besoin se déclare comme lien (`POST /api/liens` ou entrée courte du `REQUESTS.md` de Matrix). |
| M-18 (01/11) | **Matrix définit et applique les vues `pub_`**, y compris celles du schéma `vigie` ; Vigie n'en écrit plus (garde-fou `test/integration/published-columns-m18.test.ts`) et tient seulement les tables et colonnes qu'elles lisent. Les écritures reçues par Vigie passent par ses fonctions `vigie.pub_<verbe>_<objet>` (lien de nature `execution`) ou par une API. Conséquence : les vues prévues par D12 (`pub_ordres_modification`…) attendent dans `data/publications-depot.json` de Matrix que Vigie crée ses tables d'après `partage/60-vigie-ecr-eco.sql`, désormais simple spécification. |
| M17-3 (02/11) | `partage/20` à `80` ne recopient plus les vues : la forme publiée d'une vue est son **contrat dans le registre des publications** de Matrix (§ 8 septies), d'où Vigie tirera ses substituts (§ 2). |

**Côté Vigie (fonctions livrées après `b658790` que la convergence touche).**

| Domaine | Livré depuis le 15/10 | Décision concernée |
|---|---|---|
| Personnes | identité Entra (`people.entra_object_id`, `email`, création à la première connexion, `src/lib/auth/person.ts:41-62`), `people.matricule` saisi (migration 0008, `PersonForm.tsx:102`), données personnelles SEC-13, espace salarié EVT-22 | D01 |
| Sites | 27 clés étrangères vers `sites.id` (le plan en comptait 16), responsable QHSE, SIRET, Alsace-Moselle, **`sites.code` au format de `matrix.sites.code`** (VG-05, migration 0023, `schema.ts:57`) | D14 |
| Projets | études de sécurité avec `keystone_project_code` saisi (0023) ; « projets concernés » de la veille calculés d'après `keystone_projects.delivery_on` (`src/lib/data/watch.ts:88-120`) | D02 |
| Habilitations | HAB-04, 06 (sessions), 09 (prévision), 10 (prérequis, portée), 12 et 15 (titres réservés au QHSE, ordre), 13 (efficacité, sensibilisation), 14, 16, 17, 18 (indicateurs de revue), AUD-27 (titres d'auditeur interne), EVT-04 (titulaires SST), DUE-19 (mesure de maîtrise = titre) | D08, D09 |
| Documents | DOC-01, 04, 05, 06, 13, 14, 15 (revue sans modification), 17 (origine, émetteur, conservation), DUE-19 (mesure = document), EVT-24 (événement prérempli depuis un document), ACT-01 (`actions.document_id`) | D10 |
| Journal | `change_log` et `logChange()` partout (paquet 3), `pub_journal` (0009, 0010) | D18 : **fait** |
| NC et HSE de projet | colonnes de 0008 et vues 0009 / 0013 (É13) ; aucune saisie des colonnes NC dans les écrans | D13 |
| Changements | `change_requests` « MC-n » (CNF-11, gestion des changements ISO 45001 § 8.1.3, `schema.ts:1126`) : objet différent des ECR / ECO de D12, même nom de table que `codex.change_requests` | D12, D20 |
| Outillage | tests Vitest (104 fichiers d'intégration), PostgreSQL en CI, Playwright, planificateur `src/db/scheduler.ts` | toutes (charges de test) |

### 1.4 État de chaque décision pour Vigie

| Déc. | Plan de Matrix (15/10) | Ce qui a changé | Reste valable | État |
|---|---|---|---|---|
| D01 Personnes | `people` cache de `cursus.pub_salaries` par `matricule` ; rattachement ; 3 j | `matricule` existe ; personnes créées par Entra ; P-03 | source Cursus, cache `name` / `job` / `site_id`, rattachement | **fait le 07/11** (§ 7 sexies ; CV-10 tranché ; colonnes v2 et vue des présences à créer par Cursus) |
| D02 Projets | `keystone_projects` supprimée, `keystone_project_code` dans 4 tables ; 3,5 j | colonnes de code déjà posées (0008) mais jamais saisies ; 5ᵉ table (études) déjà en code ; la veille lit une date de livraison absente de `pub_projets` | lecture directe de `pub_projets` | **fait le 03/11** (veille : nombre saisi, CV-11 ouverte) |
| D04 Affectations | `keystone_assignments` cache de `pub_affectations` ; 1 j | rien | tout | **fait le 03/11** (jointure par matricule : matricules de démonstration posés, D01 à faire) |
| D08 Catalogue | `training_titles` cache de `cursus.pub_titres` ; 1,5 j | 5 attributs locaux ajoutés aux titres ; titres réservés au QHSE (HAB-12) | cache, `sort` local | **fait le 04/11** (§ 7 bis ; C-01 et CV-03 par défaut) |
| D09 Titres détenus | `qualifications` supprimée, lecture de `pub_titres_detenus`, saisie par API de Cursus ; 3 j | réponse QHSE du 15/10 (« le RH gère, le QHSE consulte ») ; sessions et efficacité livrées dans Vigie ; avenant D09 de Cursus (lot 8) ; route Cursus absente | lecture de la vue | **fait le 04/11** en consultation seule (CV-01 tranché, § 7 bis) |
| D10 Documents | documents migrés dans Codex, registre en lecture ; 7,5 j | DOC-15, DOC-17, DUE-19, EVT-24 livrés ; P-03 ; import Codex à une seule révision | Codex fait foi | **fait le 05/11** (§ 7 quater ; CV-05 tranché : avancer D10 ; C-06 par défaut) |
| D12 ECR / ECO | 9 tables, écran, API, webhook ; 14 j | vues définies par Matrix (M-18) ; aucun élément ECR / ECO au reste à faire de Vigie | Vigie fait foi | **fait le 05/11** (§ 7 quinquies ; CV-06 tranché : module construit dans Vigie ; 8 tables, `external_progress` remplacée par `inbound_requests`) |
| D13 NC et HSE projet | fiche NC, API d'avancement ; 7,5 j | colonnes et vues faites (0008, 0009, 0013) ; Keystone lit encore par HTTP | Vigie fait foi | **fait le 05/11** (§ 7 ter : numéro `EV-…`, fonction `pub_` et boîte de réception ; volet projet de la fiche NC et `/signaler` de Keystone non faits) |
| D14 Sites | `sites` cache de `matrix.pub_sites`, **réécriture des identifiants** de 16 tables ; 2,5 j | `sites.code` existe ; 27 clés ; P-03 | cache, attributs Seveso locaux | **fait le 03/11** (CV-09 : identifiants réécrits) |
| D16 Fournisseurs | `contractors.supplier_id` saisi et contrôlé ; 2,5 j | colonne faite (0008), sans écran | tout | **fait le 03/11** (choix dans la fiche ; proposition par le nom à l'import des plans : non faite) |
| D18 Journal | journal à créer ; 3 j | `change_log` et `pub_journal` livrés | — | **fait** ; `qui_matricule` rempli pour les personnes de démonstration (matricules posés le 03/11), à recontrôler après D01 |
| D19 Paramètres | constante `SKILL_SOON_DAYS` gardée jusqu'à C-12 | constante à `src/lib/domain.ts:491` (le plan cite `:88`), hors de `src/lib/horizons.ts` | tout | **fait le 07/11/2026** : 90 jours (C-12), `SKILL_SOON_DAYS` dans `src/lib/horizons.ts` |
| D06 / H3 Heures | API `GET …/heures-travaillees` de Cursus ; 2,5 j | route absente de Cursus ; Cursus propose une vue `pub_heures_travaillees` ; planificateur de Vigie en place ; M-03 provisoire | Cursus fait foi | lot parallèle, attend M-03 |
| D15, D17, D20, D21, D23 | sans charge pour Vigie | D23 fait (`pub_controles`, 0014) ; D21 : usines des filiales = sites de Vigie (VG-05) | — | voir § 3.13 |

## 2. Socle commun des lectures croisées (lot 0)

**Fait le 03/11/2026** (§ 7) : déclarations dans `src/db/foreign.ts` (comme proposé ci-dessous), substituts en TypeScript (`src/db/foreign-substitutes.ts` et `src/db/seeds/foreign.ts`, au lieu de fichiers SQL) créés à l'ouverture de la base, tâche nommée « Référentiels partagés », onglet « Connecteurs » dans « Gérer les sites ».

Le plan compte ce travail dans chaque décision ; il est commun à toutes et doit précéder le lot 1. Il recouvre en partie
INT-01 (« socle commun des connecteurs », `docs/RESTE-A-FAIRE.md:1421`).

### 2.1 Déclaration et lecture

- Un fichier `src/db/foreign.ts`, **hors** de `drizzle.config.ts` (qui ne lit que `src/db/schema.ts`) : vues lues
  déclarées `pgSchema('cursus').view('pub_titres', {…}).existing()`, l'objet `pgSchema` jamais exporté (règle du plan,
  § 1.3) ; colonnes recopiées du contrat de la publication dans le registre de Matrix.
- Lectures regroupées dans `src/lib/foreign/<outil>.ts` (une fonction par vue, `React.cache` par requête), seul endroit
  qui nomme un schéma étranger. Garde-fou : aucun fichier de `drizzle/` ni de `src/server` ne nomme `cursus.`, `keystone.`,
  `codex.` ou `matrix.` (extension de `published-columns-m18.test.ts`) ; aucune écriture vers ces schémas.
- Disponibilité : `to_regclass('<schéma>.pub_x')` et `has_table_privilege(…, 'SELECT')` à la première lecture ; absente
  ou refusée (lien retiré, outil non basculé) → état **« source indisponible »** : bandeau sur l'écran (« Données de
  Cursus indisponibles, dernière lecture le … »), saisie qui en dépend refusée avec un message, `log.warn` (jamais
  bloquant pour le reste de la page). Une échéance qui dépend de la vue n'est pas calculée et le bandeau le dit (pas
  d'absence silencieuse d'alerte).

### 2.2 Caches

- Tables locales gardées comme caches (décision ou clé étrangère locale, plan § 1.3) : `people` (D01), `sites` (D14),
  `training_titles` (D08), `keystone_assignments` (D04). Seule une tâche de rafraîchissement les écrit, jamais un
  formulaire.
- Tâche « Référentiels partagés » dans le registre `scheduledTasks` (`src/db/scheduler.ts`) : au démarrage, chaque nuit
  et par un bouton « Actualiser » (QHSE) ; une transaction par cache ; écrite dans `change_log` (entité `sync`, acteur
  absent) et dans une table `sync_runs` (cache, début, fin, lignes ajoutées / modifiées / retirées, erreur) lue par un
  écran « Connecteurs » (INT-01). Une ligne disparue de la vue n'est jamais supprimée : marquée « hors source » (une
  personne sortie, un site fermé restent lisibles dans l'historique).

### 2.3 Démonstration, application Mac et tests (PGlite)

Vigie tourne seul en démonstration, dans l'application Mac locale et dans les tests ; les vues des autres outils n'y
existent pas.

- **Substituts** : fichiers SQL `src/db/foreign-fixtures/<outil>.sql` qui créent les schémas `cursus`, `keystone`,
  `codex`, `matrix` avec de petites tables de démonstration et des vues `pub_*` **de mêmes colonnes, types et ordre que le
  contrat**. Joués par `seed.ts` seulement si le moteur est PGlite et `isDemo()`, et par `freshDemoDatabase()` (aussi sur
  la base jetable de `TEST_DATABASE_URL`). **Jamais dans `drizzle/`, jamais sur le serveur commun** (où `vigie_app` n'a
  d'ailleurs pas le droit `CREATE` sur la base). Le code de lecture est le même dans les deux modes.
- **Contrats figés** : `test/fixtures/contracts/<schéma>.<vue>.json` (colonnes, types, ordre), copiés du registre des
  publications de Matrix (§ 7.3 du plan, `matrix.publications`) ; un test compare chaque substitut à son contrat ; une
  mise à jour du contrat est un changement voulu, relu.
- **Jeu de démonstration cohérent** : matricules `EMP-…` sur les personnes de démonstration, codes de site
  `site_a`… (voir § 3.1), codes projet du substitut de `keystone.pub_projets` repris par les événements, plans, permis,
  activités et études ; identifiants de démonstration seulement dans `src/lib/demo.ts` et les seeds (règle de `CLAUDE.md`).
- Mode « source indisponible » éprouvé par un test qui retire une vue du substitut.

**Charge du lot 0 : 3,5 j** (déclarations et lecteurs 1 ; substituts, contrats et garde-fous 1,5 ; tâche, `sync_runs`,
écran « Connecteurs » 1).

## 3. Décision par décision

Chaque section : cible · changements dans Vigie · ce que la décision retire ou dégrade · prérequis hors de Vigie ·
démonstration · charge révisée. Les références `HAB-…`, `DOC-…` renvoient à `docs/RESTE-A-FAIRE.md`.

### 3.1 D14 · Sites (plan § D14, `convergence-des-donnees.md:510`)

- **Cible.** Matrix fait foi (`matrix.sites`) ; Vigie lit `matrix.pub_sites` (`code`, `libelle`, `ville`, `pays_iso2`,
  `ordre`, `actif`, `filiale_code`, `latitude`, `longitude`). `vigie.sites` reste un cache : une ligne = un site suivi
  par Vigie.
- **Décision CV-09 (responsable produit, 03/11/2026) : réécrire les identifiants** — « sinon on doublonne de l'information ». L'identifiant d'un site de Vigie est son code de Matrix (`matrix.sites.code`) ; plus de colonne `sites.code` distincte à terme. Avec P-03 (aucune donnée en production), seuls le jeu de démonstration et les tests sont repris.
- *Proposition initiale, écartée :* Le plan réécrit les identifiants (`ville-a` → `lyon`) dans toutes les tables.
  Proposé : **garder `sites.id`** (27 clés étrangères, `pub_controles.site_code` publie `controls.site_id`) et faire de
  `sites.code` (VG-05, déjà unique et au format de Matrix) la clé du cache, obligatoire hors démonstration. Avec P-03, le
  serveur part sans site : chaque site est créé en choisissant un code de `pub_sites`.
- **Changements.** Migration : rien d'obligatoire (contrainte « code obligatoire » appliquée par la server action, pas en
  base, pour la démonstration). Rafraîchissement : `label` ← `libelle`, `sort` ← `ordre`, signal « fermé dans Matrix »
  quand `actif` est faux. `saveSite` (`src/server/sites.ts:35`) : création = choix d'un code de `pub_sites` non encore
  suivi ; libellé en lecture seule ; attributs locaux inchangés (`seveso`, `pp_from_first_minute`, `qhse_lead_id`,
  `siret`, `alsace_moselle`). `archiveSite` = « ne plus suivre » (motif, inchangé). Écran « Gérer les sites ». Tests :
  `sites`, `server-layout`, Playwright de l'écran.
- **Retire ou dégrade.** Création libre d'un site et modification de son libellé ; saisie libre du code (VG-05) remplacée
  par un choix. Rien d'autre.
- **Prérequis.** `matrix.pub_sites` existe, lien `vigie_app` dans la convention (`90-droits.sql:199`) ; à vérifier dans
  l'écran « Liens entre outils ». Sites des usines des filiales créés dans Matrix (D21). Avec CV-09,
  `pub_controles.site_code` publie directement le code de Matrix (écart É8 clos) : plus de demande de colonne `site_code_commun`.
- **Démonstration.** Substitut `matrix.pub_sites` avec `site_a`, `site_b`, `site_c` ; codes posés sur les trois sites
  de démonstration (aujourd'hui sans code, `src/db/seeds/core.ts:68-79`).
- **Charge : 1,5 j** (plan : 2,5 j).

### 3.2 D01 · Personnes (plan `:136`)

- **Décision CV-10 (responsable produit, 03/11/2026).** Aucune fiche de personne propre à Vigie : toutes viennent de Cursus (`cursus.pub_salaries`), intérimaires et salariés d'entreprises extérieures compris. Cursus leur donne un matricule **permanent** préfixé `I` (intérimaire) ou `E` (extérieur), retrouvé quand la personne revient sur site. Ils se pré-déclarent avant leur venue dans un formulaire public de **Cursus**, validé par les RH. **Vigie** produit la liste des arrivées et départs à venir pour le poste de garde (PRV-25) à partir des présences prévues publiées par Cursus. Rattachement d'un compte Entra : adresse e-mail publiée par Cursus (proposé). Demandes à Cursus et à Matrix rédigées, à valider.

- **Cible.** Cursus fait foi pour les salariés (`cursus.pub_salaries` : `matricule`, `nom`, `poste`, `unite_code`,
  `site_code`, `entree`, `sortie`, `actif`). `vigie.people` reste (104 clés étrangères vers `people.id`), cache relié par
  `matricule` (colonne déjà là, unique, `schema.ts:82`).
- **Changements.** Rafraîchissement des fiches qui ont un matricule : `name` ← `nom`, `job` ← `poste`, `site_id` ←
  site suivi de code `site_code` (sinon nul, comme le plan), `left_on` ← `sortie` (motif « Sortie enregistrée dans
  Cursus »), `service` ← libellé de l'unité si Matrix accorde `pub_organigramme` (déjà lecteur, `90-droits.sql:200`).
  `PersonForm.tsx` / `savePerson` (`src/server/skills.ts:491`) : « Rattacher un salarié Cursus » (choix dans la vue) ;
  champs verrouillés quand un matricule est posé (INT-03) ; création locale réservée aux personnes sans matricule
  (CV-10). `setPersonLeft` / `reinstatePerson` (`:557`, `:584`) refusés pour une fiche rattachée. Bouton « Connecteur
  Cursus · à venir » activé (`SkillMatrix.tsx:448`), bouton Lucca retiré (`:447`, IMP-02 caduc). Première connexion
  Entra (`src/lib/auth/person.ts`) : rapprochement inchangé (objectId puis e-mail), le matricule venant du rattachement.
- **Retire ou dégrade.** Saisie du nom, du poste, du site et de la sortie des salariés rattachés ; IMP-02 (import Lucca)
  sans objet ; HAB-05 (sortie et responsabilités ouvertes) devient une réaction à une sortie lue dans Cursus.
- **Prérequis.** Cursus basculé sur le serveur (étape 4 de `architecture-postgres.md` § 10) ; vue existante
  (`0002_partage.sql:56`), lien `vigie_app` dans la convention. Aucun e-mail dans la vue : le lien compte Entra ↔
  matricule passe par le rattachement manuel ou par `matrix.pub_correspondances` (CV-10).
- **Démonstration.** Substitut `cursus.pub_salaries` avec les personnes de démonstration (matricules fictifs `EMP-9…`).
- **Charge : 3,5 j** (plan : 3 j ; données personnelles, espace salarié et première connexion à revoir).
- **Réalisé le 07/11/2026** (§ 7 sexies) : cache par matricule (contrat v1 lu seul tant que les colonnes v2 manquent), création des personnes publiées, aucune création dans Vigie, rattachement des fiches anciennes par le QHSE, première connexion rapprochée d'abord par l'adresse publiée par Cursus, liste du poste de garde (PRV-25). Service d'après l'unité (`pub_organigramme`) : non fait.

### 3.3 D02 · Projets (plan `:187`)

- **Cible.** Keystone fait foi ; Vigie lit `keystone.pub_projets` au besoin (`code`, `numero`, `nom`, `client`, `nature`,
  `imputable`…). `vigie.keystone_projects` (`schema.ts:96`) est supprimée.
- **Changements.** Saisie du code dans `events`, `prevention_plans`, `permits`, `site_activities` (colonnes
  `keystone_project_code` de 0008, indexées, jamais remplies aujourd'hui) ; contrôle « projet Keystone inconnu » contre la
  vue dans `src/server/events.ts`, `prevention.ts`, `permits.ts`, `sitemap.ts`, `pp-import.ts` ; listes de choix
  (`src/lib/data/options.ts`) ; dialogues (`EventEditButton.tsx`, `PlanDialogs.tsx`, `PermitDialogs.tsx`,
  `sitemap/dialogs.tsx`) ; affichage « code · client » recomposé ; `matchProject` de l'import des plans de prévention
  (`src/lib/pp-import/draft.ts:98`) ; études de sécurité : contrôle du code contre la vue (`src/server/process-safety.ts:68-80`).
  Colonnes texte `keystone_project` : plus écrites, lues en « ancien libellé » ; suppression dans une migration ultérieure
  (aucune vue `pub_` ne les lit). Liens directs vers Keystone (INT-08) et filtre « Mes projets » (INT-12, via
  `chef_projet_matricule`) deviennent possibles.
- **Veille (non prévu par le plan).** Le nombre de « projets concernés » d'une exigence (`affectsProjects`,
  `concernedProjects`, `src/lib/queries.ts:306-316`) repose sur `keystone_projects.delivery_on` ; `pub_projets` n'a pas
  de date de livraison. Options : lien de lecture sur `keystone.pub_jalons_projets` (jalon `pv_reception`) ou
  `pub_avancement_projets.fin_prevue_le` (lecteurs actuels : `arche_app`, `matrix_app` seulement,
  `keystone/drizzle/0038_share_followup.sql:142,183`), ou garder la seule surcharge manuelle (CV-11).
- **Retire ou dégrade.** Saisie libre « id · client » ; projets inventés hors de Keystone (refusés hors démonstration).
- **Prérequis.** Keystone basculé (étape 3) ; `pub_projets` existe, lien dans la convention (`90-droits.sql:212`) ;
  lien à demander pour la date de livraison (§ 5.1).
- **Démonstration.** Substitut `keystone.pub_projets` avec les codes de démonstration (`K-2025-042`…) réécrits au format
  de Keystone ; seeds `core.ts:82`, `watch.ts:69`, `skills.ts:66` adaptés.
- **Charge : 4,5 j** (plan : 3,5 j ; études, veille et 12 fichiers de test en plus).

### 3.4 D04 · Affectations (plan `:257`)

- **Cible.** Keystone fait foi ; `vigie.keystone_assignments` (`schema.ts:890`) reste un cache de
  `keystone.pub_affectations` (les deux sources, jointes par `people.matricule`).
- **Changements.** Migration : `affectation_id` (texte, unique), `source` (`rotation` | `planning`), `project_code` ;
  rafraîchissement filtré `au >= current_date - 1 an` ; `project` recomposé « code · client ». `loadSkillMatrix`,
  `SkillAlerts.tsx`, échéances : inchangés.
- **Retire ou dégrade.** Rien (aucune saisie aujourd'hui, seed seulement).
- **Prérequis.** Keystone (étape 3) et D01 (matricules) ; vue et lien existants (`90-droits.sql:214`).
- **Démonstration.** Substitut avec l'affectation de démonstration de `tnguyen`.
- **Charge : 1 j.**

### 3.5 D16 · Fournisseurs (plan `:567`)

- **Cible.** Keystone fait foi pour les fournisseurs ; `vigie.contractors` reste (contacts HSE, corps de métier) avec un
  lien facultatif `supplier_id` (`schema.ts:1170`, déjà là).
- **Changements.** Champ « Fournisseur Keystone » dans `ContractorDialogs.tsx` / `saveContractor`
  (`src/server/contractors.ts:20`), choix dans `keystone.pub_fournisseurs` sans les ateliers internes, contrôle à
  l'enregistrement, journal ; proposition par le nom à l'import des plans de prévention (`matchByName`,
  `src/lib/pp-import/draft.ts:67`) ; NC fournisseur : `events.supplier_id` / `supplier_name` (lot 3).
- **Retire ou dégrade.** Rien.
- **Prérequis.** Keystone (étape 3) ; vue et lien existants (`90-droits.sql:216`).
- **Charge : 1,5 j** (plan : 2,5 j, colonne déjà faite).

### 3.6 D18 · Journaux (plan `:623`)

Fait : `change_log` écrit par `logChange()` dans chaque transaction (paquet 3), `pub_journal` publiée (0009, 0010 :
`qui_matricule`, `projet` ; hors AT, MP et registre bénin), reprise par Matrix (M-18). Reste à contrôler, une fois D01
fait, que `qui_matricule` est rempli. **Charge : 0,25 j** (plan : 3 j).

### 3.7 D08 · Catalogue des titres (plan `:319`)

- **Cible.** Cursus fait foi (`cursus.pub_titres` : `titre_id`, `nature`, `code`, `libelle`, `libelle_court`,
  `validite_mois`, nul = sans échéance) ; `vigie.training_titles` (`schema.ts:809`) reste un cache, une ligne = titre
  suivi par Vigie.
- **Changements.** `id` = `titre_id` (`habilitation.he`…) : migration qui recode les ids et leurs 5 clés
  (`qualification_requirements`, `qualifications`, `training_sessions`, `actions.qualification_title_id`,
  `risk_measure_links.title_id`) d'après C-01 ; rafraîchissement `label` ← `libelle_court`, `validity_months` ←
  `validite_mois` (nul → 0). `saveTitle` (`src/server/skills.ts:610`) devient « Suivre un titre du catalogue » ;
  `archiveTitle` / `restoreTitle` = ne plus suivre / suivre à nouveau ; `moveTitle` (HAB-15) inchangé. **Attributs
  locaux gardés** (CV-03) : `sort`, `first_aid` (EVT-04), `awareness` (HAB-13), `internal_auditor` (AUD-27),
  `scope_label` (HAB-10) ; `prerequisite_ids` (HAB-10) : remplacé par `prerequis_manquant` de la vue de Cursus, qui tient
  les prérequis (`habilitations.prereqs`).
- **Retire ou dégrade.** HAB-12 : création et renommage d'un titre par le QHSE et la direction (désormais demande aux
  RH) ; HAB-10 : prérequis entre titres saisis dans Vigie.
- **Prérequis.** Cursus basculé ; trois titres à créer dans Cursus (`formation.accueil`, `formation.caces484`,
  `habilitation.ac484`, absents de `origin/main` de Cursus) ; règle « validité nulle = sans échéance » ; C-01 (sens de
  `elec`, `atex`, `hauteur`, `conduite`).
- **Démonstration.** Substitut `cursus.pub_titres` avec les titres de démonstration recodés.
- **Charge : 2,5 j** (plan : 1,5 j).

### 3.8 D09 · Titres détenus (plan `:362`)

- **Cible.** Cursus fait foi ; Vigie lit `cursus.pub_titres_detenus` (avenant du lot 8 : certification annulée retirée,
  `utilisable_jusqu_au` borné par prérequis, suspension et retrait, colonnes `mesure`, `mesure_le`), jointe par
  `people.matricule` et `training_titles.id`. `vigie.qualifications` (`schema.ts:842`) est supprimée.
- **Arbitrage préalable (CV-01).** Le plan garde une saisie depuis Vigie par une API de Cursus
  (`POST /api/integrations/vigie/certifications`) ; **cette route n'existe pas** (Cursus n'expose que
  `/api/integrations/keystone`, `server/src/app.ts:102` ; `docs/ECHANGES.md:30` : « Cursus → Vigie : aucun envoi ») et le
  service QHSE a répondu le 15/10 que « c'est le service RH qui gère cette partie-là ; nous devons juste pouvoir
  consulter ces données » (HAB-21, `docs/RESTE-A-FAIRE.md:1106` ; `docs/specs/actions-qse.md:57`). Proposé : **Vigie en
  lecture seule**, sans API.
- **Changements (lecture seule).** `loadSkillMatrix` (`src/lib/data/skills.ts`) lit la vue en gardant sa forme de sortie ;
  état d'un titre : utilisable si `utilisable_jusqu_au >= aujourd'hui` et `prerequis_manquant` faux (lecture conseillée
  par Cursus, `DEMANDES-LOT8-DONNEES.md:76`), « suspendu » sinon ; `mesure` affichée. Matrice, alertes, échéances,
  prévision HAB-09, recyclage requis, espace salarié EVT-22, données personnelles SEC-13 (`personal-data.ts`), bilan SSCT,
  titulaires SST du registre bénin (EVT-04), auditeurs internes (AUD-27), indicateurs de revue (HAB-18), mesures de
  maîtrise « titre » (DUE-19) relus sur la vue. Server actions retirées : `saveQualification`, `cancelQualification`,
  `evaluateTrainingEffectiveness`, `saveTrainingSession`, `cancelTrainingSession`, `addQualificationFiles`,
  `removeQualificationFile` (`src/server/skills.ts:107-437`) ; composants `TrainingForm.tsx`, `SessionForm.tsx`,
  `GroupRenewalButton.tsx`. `qualification_requirements` (exigences par personne) et `setRequirement` restent.
  Tables `qualifications`, `training_sessions` : passage en lecture seule, export, puis suppression dans une migration
  (vérifier qu'aucune vue `pub_` ne les lit : aucune aujourd'hui). Pièces jointes `qualification` : gardées en lecture.
- **Retire ou dégrade (explicite).** HAB-06 (sessions et recyclage groupé, livré le 31/10) ; HAB-13 volet efficacité
  (évaluation à froid ; Cursus tient `evaluations_formation`, `0010_evaluations_formation.sql`, **non publiée**) ;
  HAB-18 « formations sur 12 mois dont évaluées » ; HAB-01 et HAB-19 (dépôt d'attestation) sans objet ; HAB-10 « portée »
  (catégories CACES, `qualifications.scope`) non publiée par Cursus ; attestations jointes dans Vigie. HAB-21 et INT-09
  soldés.
- **Prérequis.** Cursus basculé ; vue et lien existants (`90-droits.sql:207`) ; reprise des formations de démonstration
  abandonnée (P-03) ; C-02 (aptitude médicale non publiée) ; publication de la portée si elle est gardée (§ 5.2).
- **Démonstration.** Substitut `cursus.pub_titres_detenus` construit depuis les formations de démonstration actuelles
  (mêmes états : valide, bientôt, expiré, suspendu), pour que les tests d'alertes et `todo-golden.json` restent
  comparables.
- **Charge : 5 j** en lecture seule (plan : 3 j) ; **+2 j** si une saisie depuis Vigie est maintenue par l'API de Cursus.

### 3.9 D19 · Horizon d'alerte (plan `:645`)

**Fait le 07/11/2026** (C-12 tranchée : 90 jours) : `SKILL_SOON_DAYS = 90` déplacé dans `src/lib/horizons.ts` (TDB-16), libellés « Expire sous 90 jours » tirés de la constante. Cursus ne publie pas de `pub_parametres` : la valeur est fixée dans Vigie ; à relire si Cursus publie un jour son horizon.


Après C-12 seulement : lire `cursus.pub_parametres.horizon_alerte_jours` à la place de `SKILL_SOON_DAYS = 60`
(`src/lib/domain.ts:491`, utilisé par `src/lib/rules/skills.ts:39` et `src/lib/queries.ts:120`), en passant la valeur
par `src/lib/horizons.ts` (règle TDB-16). Sans C-12, un titre est « à renouveler » dans Cursus et « valide » dans Vigie
entre J-90 et J-60. **Charge : 0,5 j.**

### 3.10 D13 · NC et HSE de projet (plan `:485`)

- **Cible.** Vigie fait foi ; Keystone garde ses miroirs `vigie_ncrs` / `vigie_hse_items`.
- **Fait.** Colonnes (0008) ; vues `pub_non_conformites`, `pub_hse_projet` (0009, 0013), reprises par Matrix ; liens
  `keystone_app` dans la convention (`90-droits.sql:235-236`).
- **Changements.** Fiche NC : volet « Projet Keystone » (code lu dans `pub_projets`, activité `pub_activites`, article
  `pub_articles`, livrable `pub_livrables`, fournisseur `pub_fournisseurs`), cause racine, coût, clause ISO, numéro de NC
  (règle CV-07) dans `EventEditButton.tsx`, `saveEvent`, `advanceEvent`, `revertEvent` ; `/signaler` avec les paramètres
  de Keystone ; nouveaux types de permis `levage`, `travail_ht` (déjà lus par `pub_hse_projet`) ; écritures reçues :
  avancement d'une NC par Keystone (corps de `quality-connector.ts:128-138` de Keystone), réponse `stale` / `refused`,
  journal `external_progress` (table de `partage/60`, commune avec D12). Forme de l'écriture reçue : API HTTP avec
  authentification de machine (Vigie n'en a aucune : routes limitées à `/auth`, `/fichiers`, `/api/sante` et deux
  exports) ou fonction `vigie.pub_enregistrer_avancement_nc` (M-18) — CV-08.
- **Retire ou dégrade.** Rien ; la gravité de Vigie (4 niveaux) est ramenée à 3 dans la vue (déjà le cas).
- **Prérequis.** Keystone lit encore par HTTP (`GET /api/ncrs`, `/api/hse`, `quality-connector.ts:86-89`, mode simulé) :
  passer son connecteur à la lecture des vues (§ 5.4). C-13 (accueils sécurité de chantier).
- **Démonstration.** NC de démonstration avec code et numéro (aujourd'hui `pub_non_conformites` est toujours vide).
- **Charge : 8 j** (plan : 7,5 j ; API ou fonction d'écriture et authentification de machine en plus, partagées avec D12).
- **Réalisé le 05/11/2026** (§ 7 ter) : CV-07 (numéro `EV-…`, `nc_number` tenu par la base) et CV-08 (fonction
  `vigie.pub_signaler_avancement_nc`, table de réception `inbound_requests`, traitement par Vigie, échéances, fiche et
  onglet « Connecteurs »). Restent : volet « Projet Keystone » saisi dans la fiche NC (activité, article, livrable,
  fournisseur, cause racine, coût, clause ISO), paramètres de Keystone dans `/signaler`, types de permis `levage` et
  `travail_ht`, C-13, et le basculement de Keystone (§ 5.4).

### 3.11 D10 · Documents (plan `:393`)

- **Cible.** Codex fait foi ; Vigie lit `codex.pub_documents`, `pub_revisions_document`, `pub_validations` (et
  `pub_types_document`), filtrées sur le périmètre QHSE (C-06) et la confidentialité (`conf`, à appliquer par Vigie).
  `vigie.documents`, `document_versions`, `document_reviews` sont supprimées après reprise ; nouvelle table
  `document_actions (codex_id, revision, action_id)`.
- **Changements.** `/documents` devient un registre en lecture (`DocumentRegister.tsx`, `DocumentPanel.tsx` sur les
  vues ; liens profonds vers Codex `/documents/<id>`) ; retrait de `DocumentForms.tsx` et des 11 server actions de
  `src/server/documents.ts` (`createDocument` … `cancelDocumentReview`) ; « Rendre obsolète » devient une demande de
  retrait (D12). Clés étrangères vers `documents.id` remplacées par l'identifiant Codex en texte, contrôlé contre la
  vue : `events.document_id` (`schema.ts:189`), `actions.document_id` (`:320`, ACT-01), `risk_measure_links.document_id`
  (`:509`, DUE-19) ; `document_versions.action_id` → `document_actions` ; lien complémentaire `docversion`
  (`COMPLEMENTARY_LINK_KINDS`, `src/lib/action-rules.ts:385`) sur `document_actions` ; source `document` de
  `NEW_EVENT_SOURCES` (`src/lib/event-prefill.ts:12`) et `loadLinkedEvents` sur l'identifiant Codex ; échéances
  documentaires (DOC-14) d'après `review_due_at` et les circuits en cours ; 10 fichiers de test.
- **Retire ou dégrade (explicite).** DOC-04, 05, 06, 13 (cycle de vie et journal dans Vigie) ; DOC-15 (revue sans
  modification : **Codex l'a**, `recordReview`, `codex/src/lib/actions.ts:833`) ; DOC-17 (Codex tient l'origine,
  l'organisme source et une conservation **par type**, pas un texte par document) ; DOC-18 et DOC-24 sans objet (circuits
  et signature de Codex) ; DOC-03 et DOC-07 relèvent de Codex ; validité « document sans version approuvée » de DUE-19
  relue sur les vues.
- **Prérequis.** Codex basculé (étape 1) ; vues et liens existants (`90-droits.sql:225-228`). **Import de Codex à une
  seule révision** (`codex/docs/api.md` « Ce que crée l'import » : les révisions antérieures restent dans l'ancien
  système) : l'extension « historique, version en cours, état » du plan n'existe pas ; avec P-03, elle n'est utile que si
  le service QHSE saisit des documents en production avant D10 (CV-05). Sous-type « Instruction de travail », correspondance
  des types (`politique`… → POL, PRO, FRM, REC) et départements QUA / HSE dans le registre de Codex.
- **Démonstration.** Substituts des quatre vues de Codex avec les documents de démonstration ; fichiers servis par Codex
  (lien), plus par `/fichiers`.
- **Charge : 9 j** (plan : 7,5 j).
- **Réalisé le 05/11/2026** (§ 7 quater) : lectures des quatre vues, registre en consultation, `document_actions`, clés
  d'identifiant Codex sans clé étrangère, échéances d'après Codex, mesure de maîtrise « document » sur les vues, lien
  profond `VIGIE_CODEX_URL` ; DOC-15 et DOC-17 retirés (Codex). Restent : Codex basculé sur le serveur commun, liens de
  lecture (§ 5.1), documents QHSE saisis dans Codex (§ 5.3), demande de retrait depuis Vigie (D12, lot 5).

### 3.12 D12 · ECR et ECO (plan `:454`)

- **Cible.** Vigie numérote, instruit, approuve et libère les demandes (ECR) et ordres (ECO) de modification, venus de
  Codex, de Keystone ou de Vigie ; vues définies par Matrix (`data/publications-depot.json` : `pub_ordres_modification`,
  `pub_eco_approbations`, `pub_eco_effectivite`, `pub_demandes_modification`).
- **Changements.** Les 9 tables de `partage/60-vigie-ecr-eco.sql` reportées dans `schema.ts` **avec exactement les
  colonnes que lisent les définitions de Matrix** (une colonne publiée ne change ensuite qu'après évolution de la
  publication) ; numérotation `ECO-AAAA-NNN` / `ECR-AAAA-NNN` par `nextEntityReference` ; écran « Modifications
  techniques » (registre, fiche à onglets, effectivité par défaut lue dans `keystone.pub_articles`, `pub_nomenclatures`,
  `pub_parc_machines`, `pub_projets`, libération automatique, actions du plan) ; écritures reçues (création d'ECR par
  Codex, avancement d'ECO par Keystone) par API ou fonctions `pub_` (CV-08) ; appel du webhook de Codex
  (`POST {CODEX_URL}/api/integrations/vigie`, existant) avec file d'envoi ; navigation, aide (`SCREEN_HELP`), `ROLE_ROUTES`,
  axe, tests.
- **Retire ou dégrade.** Rien ; collision de nom à lever avec la gestion des changements « MC-n » (`change_requests`,
  CNF-11, carte de l'écran Audits `?changement=`) : Codex ouvre `/changements/<ECR>` (`codex/src/lib/vigie.ts:13-15`),
  Keystone `/modifications-techniques/` (CV-06).
- **Prérequis.** Confirmation du besoin (aucun élément ECR / ECO au reste à faire de Vigie) ; Codex : `submitChange`
  appelle Vigie au lieu de numéroter lui-même (`codex/src/lib/vigie.ts:36-44`, simulé) ; Keystone : connecteur ECO par
  les vues (`eco-connector.ts:82-85`, HTTP simulé) ; reprise des 6 ECO de Keystone et 3 ECR de Codex (démonstration
  seulement, P-03) ; D13 avant D12.
- **Charge : 16 j** (plan : 14 j ; authentification de machine et file d'envoi en plus si non faites au lot 3).
- **État au 05/11/2026 : fait** (lot 5, migration `0029_convergence_m02_ecr_eco`, § 7 quinquies,
  `docs/specs/modifications-techniques.md`) ; CV-06 tranché le 05/11/2026. Adresse retenue : `/modifications-techniques`
  (fiche `?sel=<numéro>`, `/modifications-techniques/<numéro>` redirigé) ; Codex doit passer de `/changements/<ECR>` à
  `/modifications-techniques/<ECR>` (§ 5.3). Écritures reçues par fonctions `pub_` (CV-08) plutôt que par l'API HTTP de la
  spécification de Matrix (`POST /api/ecrs`, `POST /api/ecos/:number/progress`).

### 3.13 D06 / H3 · Heures travaillées (hors M-02, `remplacement-lucca.md` § 3.6, § 5.3)

Base du TF1 / TG (`hours_worked`, `schema.ts:89`, rempli par le seed seulement ; TDB-03, report « aucune saisie ni
import » encore ouvert). Le plan prévoit une API `GET /api/integrations/vigie/heures-travaillees` de Cursus, **absente** ;
Cursus propose une vue `cursus.pub_heures_travaillees` (`docs/demandes/matrix-lot11-indicateurs.md` § 3), plus conforme
à M-17 (lecture par vue). Côté Vigie : colonnes `source`, `hours_interim`, `hours_school`, `complete`, `updated_at`,
clé `(month, site_id, source)`, réglage `VIGIE_HEURES_CURSUS_DEPUIS` (`env.ts`, `.env.example`, `EXPLOITATION.md` § 4),
lecture par la tâche nocturne du planificateur (pas de tâche Coolify), `safetyRates()` sur la source choisie. Attend
M-03 et le contrat de la vue. **Charge : 2 j.**

### 3.14 Autres décisions

| Déc. | Pour Vigie |
|---|---|
| D15 Organisation | Rien d'obligatoire ; `people.service` peut devenir le libellé de l'unité (`pub_organigramme`, lien existant), compté dans D01. |
| D17 Pays | Rien (aucune donnée de pays). |
| D20 Homonymes | Ajouter à la liste : `vigie.change_requests` (gestion des changements MC-n) ≠ `codex.change_requests` (ECR) ; `vigie.certifications` (certificats ISO) ≠ `cursus.certifications`. |
| D21 Filiales | Usines des filiales = sites de Vigie par `sites.code` (VG-05) ; `pub_filiales` non nécessaire. |
| D23 Contrôles des moyens d'essai | Fait : `pub_controles` (0014). Demandes V-2 (`pub_suspensions_essais`), V-3, V-4 de Crucible (`crucible/docs/DEMANDES-VIGIE.md`) jamais déposées dans le `REQUESTS.md` de Vigie ; hors de cette note. |
| Cursus → Vigie (BDESE) | Cursus voudra lire les accidents avec arrêt (`matrix-lot11-indicateurs.md` § 3) : publication à définir par Matrix sur les tables de Vigie, sans donnée nominative ni de santé ; pas encore demandée. |

### 3.15 Synthèse des charges

| Lot | Décisions | Plan (15/10) | Révisé |
|---|---|--:|--:|
| 0 | socle des lectures croisées | (réparti) | 3,5 |
| 1 | D14, D01, D02, D04, D16, D18 | 15,5 | 12,25 |
| 2 | D08, D09, D19 | 4,5 (+0,5) | 8 (+2 avec saisie) |
| 3 | D13 | 7,5 | 8 |
| 4 | D10 | 7,5 | 9 |
| 5 | D12 | 14 | 16 |
| **Total M-02** | | **49** (+0,5 D19) | **56,75** (58,75 avec saisie D09) |
| parallèle | D06 / H3 | 2,5 | 2 |

Hors charge : arbitrages métier (C-01, CV-01…), recette du service QHSE, travaux des autres outils (§ 5).

## 4. Ordre des lots

| Lot | Contenu | Développable maintenant (substituts) | Attend un autre outil ou une décision |
|---|---|---|---|
| 0 | socle § 2 | oui, entièrement | contrats des vues dans le registre de Matrix (lecture de l'écran « Publications ») |
| 1 | D14, D01, D02, D04, D16 (+ contrôle D18) — caches et lectures seules | oui, sur substituts ; recette réelle par outil | Vigie sur le serveur (étape 2) ; D14 : sites créés dans Matrix ; D02, D04, D16 : Keystone basculé (étape 3) ; D01 : Cursus basculé (étape 4) ; CV-09, CV-10, CV-11 |
| 2 | D08, D09, D19 — **fait le 04/11/2026 (§ 7 bis), D19 attend C-12** | sur substituts (CV-01, CV-02 tranchés ; C-01 par défaut) | Cursus basculé ; trois titres créés dans Cursus ; C-02 ; C-12 pour D19 ; portée publiée si gardée |
| 3 | D13 — **numéro, fonction et boîte de réception faits le 05/11/2026 (§ 7 ter)** | oui (fiche NC, vues déjà là) | lien d'exécution et publication de l'état des demandes (Matrix, § 5.1) ; connecteur Keystone par vues et fonction (§ 5.4) ; C-13 ; volet projet de la fiche NC |
| 4 | D10 | non avant CV-05, C-06 | Codex basculé ; import étendu seulement si des documents existent en production ; types et sous-types dans le registre de Codex |
| 5 | D12 — **fait le 05/11/2026 (§ 7 quinquies)** | sur substituts (CV-06 tranché) | Codex (`submitChange` par la fonction), Keystone (connecteur ECO par vues et fonction), liens d'exécution et publications appliquées par Matrix après la migration 0029 |
| parallèle | D06 / H3 | colonnes et lecture sur substitut | M-03 ; vue `pub_heures_travaillees` de Cursus |

Ordre interne du lot 1 : D14 (les autres clés de site en dépendent), D01 (matricules), puis D02, D04, D16. Le lot 2
suit le lot 1 (jointure par matricule). D13 passe avant D12 (journal `external_progress` et authentification communs).
D10 peut précéder le lot 3 si le service QHSE veut arrêter tôt la saisie de documents dans Vigie (CV-05).

## 5. Demandes aux autres outils

**À valider par Guillaume, rien n'est écrit dans les autres dépôts.** Format du `REQUESTS.md` de chaque outil.

### 5.1 Matrix

```markdown
## [2026-11-xx] Vigie → Matrix — Liens de lecture de vigie_app utilisés depuis le 03/11/2026 (M-02, lots 0 et 1)
- Statut : OUVERTE
- Demande : confirmer dans le registre matrix.liens les liens de nature lecture, lecteur vigie_app, sur les quatre vues
  que Vigie lit depuis sa migration 0024 (convention du 15/10/2026, partage/90-droits.sql:199, 212, 214, 216) :
  1. matrix.pub_sites (code, libelle, ville, pays_iso2, ordre, actif, filiale_code, latitude, longitude) — sites suivis
     (cache vigie.sites, identifiant = code, décision CV-09 de Vigie) ;
  2. keystone.pub_projets (contrat D02 v1 + capex_code, besoin_ref, client_interne, filiale_code, categorie) — choix et
     affichage des projets (lecture directe, plus de table keystone_projects) ;
  3. keystone.pub_affectations (contrat D04 v1) — cache vigie.keystone_assignments (jointure par matricule) ;
  4. keystone.pub_fournisseurs (contrat D16 v1) — vigie.contractors.supplier_id.
  Et prévenir Vigie de toute évolution du contrat de ces quatre publications (Vigie fige leur forme dans
  test/fixtures/contracts/*.json et en tire ses substituts de démonstration).
- Justification : décision M-02 (D14, D02, D04, D16) ; lecture par SELECT seulement depuis src/lib/foreign/ de Vigie,
  aucune écriture (M-17). Sans le lien, Vigie affiche « source indisponible » et refuse la saisie qui en dépend.
- Détails techniques : vérification en vigie_app : select count(*) from matrix.pub_sites (idem pour les trois vues de
  Keystone) ; Vigie ne crée jamais de schéma ni de vue hors du schéma vigie sur le serveur commun.
- Validé par Guillaume le :

## [2026-11-xx] Vigie → Matrix — Liens de lecture de vigie_app pour la suite de la convergence (M-02, lots 1 à 4)
- Statut : OUVERTE (à déposer avec les lots concernés)
- Demande : confirmer les liens de la convention restants : matrix.pub_organigramme, matrix.pub_correspondances,
  cursus.pub_salaries, cursus.pub_titres, cursus.pub_titres_detenus, cursus.pub_parametres, keystone.pub_activites,
  keystone.pub_articles, keystone.pub_livrables, keystone.pub_nomenclatures, keystone.pub_parc_machines,
  codex.pub_documents, codex.pub_revisions_document, codex.pub_validations, codex.pub_types_document ; nouveau :
  keystone.pub_jalons_projets (jalon pv_reception) ou keystone.pub_avancement_projets (fin_prevue_le), selon CV-11.
- Validé par Guillaume le :

## [2026-11-xx] Vigie → Matrix — Liens de lecture de vigie_app sur les quatre vues de Codex (D10, lot 4 livré le 05/11/2026)
- Statut : OUVERTE
- Demande : confirmer dans le registre matrix.liens les liens de nature lecture, lecteur vigie_app, sur
  codex.pub_documents, codex.pub_revisions_document, codex.pub_validations et codex.pub_types_document (convention du
  15/10/2026, partage/90-droits.sql:225-228, déjà inscrits) ; prévenir Vigie de toute évolution de leur contrat (Vigie en
  fige la forme dans test/fixtures/contracts/codex.*.json et en tire ses substituts de démonstration).
- Justification : décision M-02 (D10) et décision CV-05 de Vigie ; lecture par SELECT seulement depuis
  src/lib/foreign/codex.ts, aucune écriture (M-17). Sans le lien, le registre des documents de Vigie affiche « source
  indisponible » et refuse les nouveaux rattachements à un document.
- Détails techniques : vérification en vigie_app : select count(*) from codex.pub_documents (idem pour les trois autres).
- Validé par Guillaume le :

## [2026-11-xx] Vigie → Matrix — Lien d'exécution de keystone_app sur vigie.pub_signaler_avancement_nc (D13, CV-08)
- Statut : OUVERTE
- Demande : inscrire au registre matrix.liens un lien de nature execution : lecteur keystone_app, objet
  vigie.pub_signaler_avancement_nc (signature : text, text, text, text, text, text, text, text, text, timestamptz, text,
  text, text, text ; retour integer), et l'appliquer (droits.accorder_execution). La fonction est créée par la migration
  0026_convergence_m02_nc_inbox de Vigie : propriétaire vigie_app, SECURITY DEFINER, search_path = vigie, pg_temp, sans SQL
  dynamique, REVOKE EXECUTE … FROM PUBLIC dans la même migration ; nom unique (une nouvelle version prendra un autre nom).
- Justification : décisions M-17 (règle R4) et M-18 ; décision CV-08 de Vigie (04/11/2026) : Keystone signale l'avancement
  d'une NC de projet en déposant une demande, que Vigie traite avec ses règles et son journal. La fonction n'écrit que
  dans vigie.inbound_requests (appelant contrôlé par session_user, table vigie.inbound_callers).
- Détails techniques : vérification par select has_function_privilege('keystone_app',
  'vigie.pub_signaler_avancement_nc(text, text, text, text, text, text, text, text, text, timestamptz, text, text, text, text)',
  'EXECUTE') ; erreurs de la fonction : SQLSTATE P0V01 (appelant non admis), P0V02 (argument invalide). codex_app (D12)
  fera l'objet d'une demande distincte avec le lot 5.
- Validé par Guillaume le :

## [2026-11-xx] Vigie → Matrix — Liens d'exécution des fonctions de D12 (lot 5 livré le 05/11/2026, CV-06, CV-08)
- Statut : OUVERTE
- Demande : inscrire au registre matrix.liens deux liens de nature execution et les appliquer (droits.accorder_execution) :
  1. lecteur codex_app, objet vigie.pub_creer_demande_modification (signature : text, text, text, text, text, text, text,
     text, text, timestamptz ; retour text : numéro ECR-AAAA-NNN réservé) — Codex crée une demande de modification d'un de
     ses documents ;
  2. lecteur keystone_app, objet vigie.pub_signaler_avancement_eco (signature : text, text, text, text, text, text, text,
     text, text, timestamptz, text ; retour integer) — Keystone signale l'avancement d'un ordre ou la décision d'une clé.
  Fonctions créées par la migration 0029_convergence_m02_ecr_eco de Vigie : propriétaire vigie_app, SECURITY DEFINER,
  search_path = vigie, pg_temp, sans SQL dynamique, REVOKE EXECUTE … FROM PUBLIC ; appelant contrôlé par session_user
  (vigie.inbound_callers : codex_app pour la première, keystone_app pour la seconde) ; erreurs P0V01 (appelant non admis),
  P0V02 (argument invalide) ; noms uniques.
- Justification : décisions M-17 (R4), M-18 ; CV-06 et CV-08 de Vigie. Les fonctions n'écrivent que dans
  vigie.inbound_requests (et, pour la première, le compteur de numérotation vigie.action_counters).
- Détails techniques : has_function_privilege('codex_app', 'vigie.pub_creer_demande_modification(text, text, text, text,
  text, text, text, text, text, timestamptz)', 'EXECUTE') ; has_function_privilege('keystone_app',
  'vigie.pub_signaler_avancement_eco(text, text, text, text, text, text, text, text, text, timestamptz, text)', 'EXECUTE').
- Validé par Guillaume le :

## [2026-11-xx] Vigie → Matrix — Appliquer les quatre publications de D12 sur les tables de Vigie (lot 5 livré le 05/11/2026)
- Statut : OUVERTE (après la migration 0029 de Vigie sur le serveur commun)
- Demande : appliquer vigie.pub_ordres_modification, pub_eco_approbations, pub_eco_effectivite et pub_demandes_modification
  (data/publications-depot.json, contrat D12 v1, définitions inchangées) : les tables vigie.ecos, ecrs, eco_approvals,
  eco_parts, eco_projects, eco_effectivity, eco_documents existent avec exactement les colonnes lues par ces définitions
  (requêtes de référence exécutées par les tests de Vigie : docs/specs/modifications-techniques.md § 8). Lecteurs de la
  convention : keystone_app, matrix_app (et codex_app pour pub_demandes_modification). Retirer le bandeau « À NE PAS
  JOUER » de partage/60-vigie-ecr-eco.sql : vigie.external_progress n'est pas créée (écritures reçues par
  vigie.inbound_requests, CV-08), et les colonnes propres de Vigie sont en fin de table (jamais publiées).
- Justification : M-18 (Matrix définit et applique les vues pub_ du schéma vigie) ; D12.
- Validé par Guillaume le :

## [2026-11-xx] Vigie → Matrix — Liens de lecture de vigie_app sur les vues de Keystone de D12 (lot 5 livré le 05/11/2026)
- Statut : OUVERTE
- Demande : confirmer les liens de nature lecture, lecteur vigie_app, sur keystone.pub_articles, keystone.pub_nomenclatures
  et keystone.pub_parc_machines (convention, partage/90-droits.sql ; déjà demandés en bloc par la deuxième demande de cette
  liste) ; confirmer leurs contrats (Vigie les a relevés dans les migrations 0035 et 0040 de Keystone :
  test/fixtures/contracts/keystone.pub_articles.json, pub_nomenclatures.json, pub_parc_machines.json).
- Justification : effectivité proposée d'un ordre de modification (projets qui emploient un article, machines qui le
  portent), contrôle des articles saisis ; lecture par SELECT depuis src/lib/foreign/keystone.ts seulement.
- Validé par Guillaume le :

## [2026-11-xx] Vigie → Matrix — Publication de l'état des demandes reçues (D13, CV-08)
- Statut : OUVERTE (après le lien d'exécution)
- Demande : publier, dans le schéma vigie, une vue de l'état des demandes déposées par un outil (nom proposé
  vigie.pub_demandes_recues, contrat « Demandes reçues v1 »), lecteur keystone_app, d'après la table vigie.inbound_requests,
  chaque outil ne voyant que ses propres demandes (filtre caller = session_user) :
  id (integer, numéro rendu par la fonction), id_externe (external_id, text : keystoneId), nature (kind, text :
  nc_step | nc_verification | nc_references), numero (target_ref, text : EV-…), projet_code (project_code, text),
  statut (status, text : received | applied | rejected), recu_le (received_at, timestamptz), traite_le (processed_at,
  timestamptz), code_resultat (result_code, text : stale | refused | not_found | invalid, nul si appliquée), resultat (result,
  text : message du traitement), vigie_ref (event_id, text : NC rattachée, nulle si introuvable).
  Ni payload (nom de la personne déclarée par l'outil, commentaire), ni prise en compte du refus par le QHSE
  (acknowledged_*), ni donnée de santé (le message d'une demande visant un autre élément qu'une NC de projet est
  toujours « introuvable »).
- Justification : décision CV-08 (réponse asynchrone, état lu dans une vue) ; Vigie ne crée plus de vue pub_ (M-18). Vigie
  tient ces colonnes et ne les modifie qu'après évolution de la publication.
- Validé par Guillaume le :
```

### 5.2 Cursus

```markdown
## [2026-11-xx] Vigie → Cursus — Catalogue des titres pour D08 (titres QHSE et sans échéance)
- Statut : OUVERTE
- Demande : créer dans le catalogue formation.accueil (Accueil sécurité, sans échéance), formation.caces484 et
  habilitation.ac484 ; appliquer « validite nulle = sans échéance » (pub_titres.validite_mois NULL).
- Justification : D08 option A ; ces titres sont suivis par le QHSE dans Vigie et absents du catalogue de Cursus.
- Validé par Guillaume le :

## [2026-11-xx] Vigie → Cursus — Portée des titres détenus (catégories CACES, indices d'habilitation) — si CV-04 = oui
- Statut : OUVERTE
- Demande : tenir la portée d'une certification ou d'une habilitation (« 1A, 3, 5 », « B1V, BR ») et la faire publier
  en fin de pub_titres_detenus (colonne portee, texte) par Matrix (M-18).
- Justification : HAB-10 de Vigie ; sans elle, la matrice ne dit plus quelles catégories sont couvertes.
- Validé par Guillaume le :

## [2026-11-xx] Vigie → Cursus — Heures travaillées par site et par mois (H3) — après M-03
- Statut : OUVERTE
- Demande : la vue proposée par Cursus (docs/demandes/matrix-lot11-indicateurs.md § 3), publiée par Matrix :
  mois, site_code (matrix.pub_sites.code), heures_salaries, heures_interimaires, heures_ecole, complet, maj_le ;
  aucune personne.
- Justification : TF1 / TG de Vigie ; remplace l'API H3 de docs/remplacement-lucca.md (lecture par vue, M-17).
- Validé par Guillaume le :

## [2026-11-xx] Vigie → Cursus — Enregistrement d'une formation depuis Vigie — seulement si CV-01 = saisie gardée
- Statut : OUVERTE
- Demande : POST /api/integrations/vigie/certifications { matricule, titre_id, obtenue, organisme? } → 201
  { cursus_ref, expire_le } ; 422 pour une habilitation (délivrée dans Cursus) ; clé VIGIE_API_KEY.
- Validé par Guillaume le :
```

À reporter aussi dans le `REQUESTS.md` de Vigie : l'avenant D09 de Cursus (`DEMANDES-LOT8-DONNEES.md:76`, « à valider,
pas envoyée »), que le lot 2 applique.

### 5.3 Codex

```markdown
## [2026-11-xx] Vigie → Codex — Documents QHSE lus par Vigie (D10, lot 4 livré le 05/11/2026, décision CV-05)
- Statut : OUVERTE (brouillon, à valider)
- Demande :
  1. Registre : confirmer que le sous-type « Instruction de travail » du type PRO et les départements QUA et HSE (déjà dans
     origin/main de Codex : src/db/registry.ts, src/db/seed-org.ts) restent stables : Vigie lit comme registre QHSE les
     documents sans rattachement (attachment = 'none') de ces deux départements (question C-06, choix par défaut).
  2. Correspondance des types de Vigie (jeu de démonstration, et documents QHSE à créer dans Codex) : politique → POL ;
     procédure → PRO (« Procédure standard ») ; instruction de travail → PRO (« Instruction de travail ») ; formulaire →
     FRM ; enregistrement → REC ; document d'origine externe (exigences d'un client) → NRM (« Standard client »), organisme
     source dans source_org. Processus de Vigie (QHSE, ACH, BE, MON, USI, ESS, DIR…) → process_code. Identifiants de
     démonstration : PR-QHSE-002 → PRO-QUA-0002… (ancien identifiant en alias), voir src/db/seeds/documents.ts de Vigie.
  3. Site des documents : pub_documents.site = code de site de Matrix (site_a…), vide = toute l'entreprise (Vigie filtre
     dessus) ; matricule des propriétaires et valideurs renseigné (users.matricule : échéances de Vigie au propriétaire et
     à la personne de l'étape en cours, pilote d'une action de revue).
  4. review_due_at tenu à jour après une revue sans modification (recordReview) et une mise en vigueur : Vigie en tire
     ses échéances de revue périodique (DOC-14).
  5. Si des documents existent dans Vigie en production avant le basculement (P-03 : aucun à ce jour) : POST /api/import
     étendu à l'historique des révisions, à la diffusion, à la périodicité de revue et au processus.
- Justification : D10 option A, décision CV-05 de Vigie (05/11/2026) ; Vigie n'écrit rien chez Codex ; liens profonds
  <codex>/documents/<id> (VIGIE_CODEX_URL de Vigie).
- Validé par Guillaume le :

## [2026-11-xx] Vigie → Codex — Création des ECR dans Vigie et décisions par le webhook (D12, lot 5 livré le 05/11/2026)
- Statut : OUVERTE (brouillon, à valider)
- Demande :
  1. submitChange (src/lib/vigie.ts) appelle, en codex_app, select vigie.pub_creer_demande_modification(p_id_externe =>
     identifiant de la demande chez Codex (même valeur au renvoi : même numéro), p_nature => 'modification' |
     'obsolescence', p_document => docId, p_motif => reason, p_description => description, p_demandeur_ref => requesterId,
     p_demandeur_nom => nom du demandeur, p_demandeur_matricule => users.matricule ou null, p_remplacant =>
     replacementId ou null, p_enregistre_le => horodatage) et garde comme identifiant le numéro ECR-AAAA-NNN rendu (au
     lieu de numéroter lui-même) ; erreurs P0V01 / P0V02 : demande non transmise, message à l'utilisateur. La demande est
     créée dans Vigie à son traitement (10 minutes au plus) : « submitted », ou « rejected » avec le motif (document
     inconnu, retiré, ou déjà visé par une demande en cours) — lisible dans vigie.pub_demandes_modification et notifié par
     le webhook.
  2. Lien vers la fiche : vigieUrl(id) = <NEXT_PUBLIC_VIGIE_URL>/modifications-techniques/<ECR> (au lieu de /changements/).
  3. Webhook POST /api/integrations/vigie : Vigie l'appelle avec le corps actuel { requestId, accepted, ecoRef, modifierId,
     note } (refus et acceptation sans ordre aussitôt ; acceptation avec un ordre à sa libération, ecoRef = numéro de
     l'ordre) ; jeton et / ou signature : Vigie pose VIGIE_CODEX_WEBHOOK_TOKEN / VIGIE_CODEX_WEBHOOK_SECRET aux valeurs de
     VIGIE_WEBHOOK_TOKEN / VIGIE_WEBHOOK_SECRET de Codex (O-10 en partie répondue : Vigie envoie, signe et reprend ses envois).
     Vigie lit la réponse 200 « implemented » (révision ouverte) ; 409, 404, 400 : refus définitif (signalé au QHSE).
  4. Lien de lecture codex_app sur vigie.pub_demandes_modification (convention) pour le contrôle de cohérence de route.ts.
- Justification : D12 (Vigie numérote et décide), décisions CV-06 et CV-08 de Vigie ; M-17 (écriture par fonction pub_ du
  propriétaire).
- Validé par Guillaume le :
```

### 5.4 Keystone

```markdown
## [2026-11-xx] Vigie → Keystone — NC de projet de Vigie : lecture par les vues, avancement par vigie.pub_signaler_avancement_nc (D13)
- Statut : OUVERTE
- Demande :
  1. Lecture : rafraîchir vigie_ncrs et vigie_hse_items par SELECT sur vigie.pub_non_conformites et vigie.pub_hse_projet
     (liens keystone_app de la convention ; vues reprises par Matrix) au lieu de GET /api/ncrs et /api/hse
     (quality-connector.ts) ; Vigie n'exposera pas de GET. Correspondance : pub_non_conformites.project_code →
     projectCode, number → number, vigie_ref → vigieRef, status (open … closed : étapes 0 à 5 de Vigie), closed_on,
     supplier_id, owner_matricule (voir le plan de Matrix, D13).
  2. Numéro : décision CV-07 de Vigie (04/11/2026) — le numéro d'une NC est la référence EV-… de Vigie
     (pub_non_conformites.number = vigie_ref, ex. EV-2026-130), unique ; plus de NCR-nnn (déjà accepté par le contrat
     vigie-contract.md § 2.2). Seules les NC portant un code projet de keystone.pub_projets sont publiées.
  3. Avancement (outbox vigie_ncr_progress) : au lieu de POST /api/ncrs/:project/:number/progress, appeler
     select vigie.pub_signaler_avancement_nc(p_numero => number, p_projet => projectCode, p_nature => kind
     ('step' | 'verification' | 'references'), p_etape_depuis => fromStatus, p_etape_cible => targetStatus,
     p_decision => decision ('approved' | 'rejected'), p_commentaire => comment, p_acteur_nom => actor.name,
     p_acteur_role => actor.role, p_enregistre_le => recordedAt, p_id_externe => keystoneId (même valeur au renvoi :
     même demande), p_activite, p_article, p_livrable => null hors 'references') ; le résultat est le numéro de la demande
     dans Vigie (à garder comme vigieRef de l'entrée). Erreur P0V01 (appelant non admis) ou P0V02 (argument invalide) :
     entrée « failed », non renvoyée telle quelle.
  4. Réponse asynchrone : la demande est traitée par Vigie dans les 10 minutes ; état et motif lus dans la publication de
     l'état des demandes (demandée à Matrix : statut applied | rejected, code_resultat stale | refused | not_found |
     invalid, resultat) ; rejected = état « refused » de l'outbox (fin des renvois) ; stale = l'état a changé dans Vigie
     (renvoyer d'après le nouvel état lu dans pub_non_conformites).
  5. Ce que Vigie applique (choix restrictifs, à confirmer avec Keystone) : étape suivante seulement depuis l'état vu
     (ni « containment », qui est la qualification par le QHSE de Vigie, ni « closed ») et selon les règles de Vigie
     (analyse saisie, action liée, actions vérifiées) ; vérification (approved / rejected) : proposition au QHSE de Vigie,
     qui clôt ou renvoie la NC lui-même (la NC reste « verification » d'ici là) ; références activité / article /
     livrable : posées si vides dans Vigie.
  6. Liens profonds : fiche /evenements?etat=tous&sel=<EV-…> (inchangé, vigieRef = number).
- Justification : M-17 (lecture par vues, écriture par fonction pub_ du propriétaire), décisions CV-07 et CV-08 de Vigie.
- Validé par Guillaume le :

## [2026-11-xx] Vigie → Keystone — Ordres de modification de Vigie : lecture par les vues, avancement par vigie.pub_signaler_avancement_eco (D12, lot 5 livré le 05/11/2026)
- Statut : OUVERTE (brouillon, à valider)
- Demande :
  1. Lecture : rafraîchir vigie_ecos par SELECT sur vigie.pub_ordres_modification (number, title, eco_type → type,
     status, interchangeability, from_revision, to_revision, cost_eur, schedule_days, stock_impact, document_refs,
     requested_by_name → requestedBy, raised_on, pending_dispositions, locked, parts, projects, released_at,
     vigie_updated_at → updatedAt), pub_eco_approbations (approvals : approval_key → key, decision, approver_text →
     approver, decided_by_name → decidedBy, decided_at) et pub_eco_effectivite (effectivity, même noms en snake_case) au
     lieu de GET /api/ecos?source=keystone ; projets = codes de keystone.pub_projets.
  2. Avancement (outbox vigie_eco_progress) : au lieu de POST /api/ecos/:number/progress, select
     vigie.pub_signaler_avancement_eco(p_numero => ecoNumber, p_nature => kind ('step' | 'approval'), p_cle => approvalKey,
     p_decision => decision, p_etape_depuis => fromStatus, p_etape_cible => targetStatus, p_commentaire => comment,
     p_acteur_nom => actor.name, p_acteur_role => actor.role, p_enregistre_le => recordedAt, p_id_externe => keystoneId) ;
     résultat : numéro de la demande dans Vigie (vigieRef). P0V01 / P0V02 : entrée « failed », non renvoyée telle quelle.
  3. Ce que Vigie applique (choix restrictifs, à confirmer) : étape suivante depuis l'état vu (draft → impact_analysis →
     in_approval, interchangeabilité évaluée) ; clés englead et pm (quality décidée dans Vigie) ; jamais released (d'office)
     ni rejected (une clé refusée rejette l'ordre). Réponse asynchrone : état lu dans la publication de l'état des demandes
     (§ 5.1) ; refus « refused » = fin des renvois.
  4. Liens : /modifications-techniques/<ECO> (inchangé, NEW-D4-1), /modifications-techniques/nouvelle?part=&project=&title=
     &source=keystone (formulaire prérempli), filtres ?part= et ?project= (projet = code de Keystone).
- Justification : M-17, M-18 ; CV-06 et CV-08 de Vigie.
- Validé par Guillaume le :
```

## 6. Questions

Questions du plan de Matrix encore ouvertes pour Vigie (§ 8 du plan) : **C-01** (sens de `elec`, `atex`, `hauteur`,
`conduite` ; rapprochement par défaut appliqué au jeu de démonstration le 04/11/2026, § 7 bis), **C-02** (aptitude médicale dans `pub_titres_detenus`, DPO), **C-06** (périmètre des documents QHSE ; choix par défaut appliqué le 05/11/2026 : QUA / HSE sans rattachement, § 7 quater),
**C-12** (horizon d'alerte : **tranché le 07/11/2026, 90 jours**, appliqué par D19), **C-13** (accueils sécurité de chantier). **C-03** et **C-08** ne portent
plus que sur la démonstration (P-03) ; **C-04** (usage des applications Mac) fixe la durée de vie des substituts.

Questions nouvelles (CV : convergence de Vigie) :

| N° | Question | Pour qui | Bloque |
|---|---|---|---|
| CV-01 | D09 : le plan garde une saisie de formation depuis Vigie par une API de Cursus (inexistante) ; le service QHSE a répondu le 15/10 « le RH gère, le QHSE consulte » (HAB-21). Vigie passe-t-il en **consultation seule** des formations ? **Tranché le 04/11/2026 : « consultation seule »** — Vigie lit `cursus.pub_titres` et `cursus.pub_titres_detenus`, sans API d'écriture ; saisie des formations, sessions (HAB-06), évaluation à froid (HAB-13), création des titres (HAB-12) et prérequis saisis (HAB-10) retirés (ce qui tranche aussi CV-02 : retrait). | responsable produit, QHSE, RH | lot 2 |
| CV-02 | **Tranché avec CV-01 le 04/11/2026 : fonctions retirées de Vigie** (aucune publication de l'efficacité demandée à Cursus pour l'instant). Question d'origine — Fonctions livrées après le 15/10 et contraires à D09 : sessions collectives et recyclage groupé (HAB-06, 31/10), évaluation à froid (HAB-13), indicateurs de formation de la revue (HAB-18). Les retirer (Cursus a sessions et évaluations, non publiées), ou garder l'évaluation à froid dans Vigie rattachée à `cursus_ref` ? Faut-il demander à Cursus de publier l'efficacité (sans avis nominatif) ? | QHSE, RH | lot 2 |
| CV-03 | **Appliqué par défaut le 04/11/2026, à confirmer : attributs gardés dans le cache de Vigie ; titres créés par les RH seulement.** Question d'origine — Attributs propres au QHSE sur un titre du catalogue de Cursus (titre de secourisme, sensibilisation, auditeur interne, libellé de portée) : gardés dans le cache de Vigie (proposé) ou portés par Cursus ? Les titres ne se créent plus que par les RH (HAB-12) : accepté ? | QHSE, RH | lot 2 |
| CV-04 | **Appliqué par défaut le 04/11/2026, à confirmer : portée abandonnée dans Vigie** (non publiée par Cursus ; `scope_label` gardé sans usage). Question d'origine — Portée des titres (catégories CACES, indices électriques, HAB-10) : à tenir et publier par Cursus, ou abandonnée dans Vigie ? | QHSE, RH | lot 2 |
| CV-05 | **Tranché le 05/11/2026 : « avancer D10 »** (lot 4 développé le même jour, § 7 quater ; création non fermée d'abord ; DOC-15 et DOC-17 passés à Codex, conservation par type, appliqué par défaut à confirmer). Question d'origine — D10 et calendrier : tant que D10 n'est pas fait, des documents saisis dans Vigie en production devront être repris dans Codex (import à une révision aujourd'hui). Fermer la création de documents dans Vigie sur le serveur dès maintenant (consultation des documents de démonstration seulement), ou avancer D10 ? DOC-15 et DOC-17 ont leur pendant dans Codex (conservation par type et non par document) : accepté ? | responsable produit, QHSE | lot 4 |
| CV-06 | **Tranché le 05/11/2026 : module construit dans Vigie** (« lance le lot 5 »), écran « Modifications techniques » à `/modifications-techniques/<numéro>` (fiche `?sel=`), « gestion des changements » MC-n inchangée ; **développé le même jour** (§ 7 quinquies ; droits, clés de Keystone, libération et envois à Codex par défaut, à confirmer : tableau « Convergence M-02, lot 5 » du § 19 de `docs/RESTE-A-FAIRE.md`). Question d'origine — D12 : le module ECR / ECO n'est pas au reste à faire de Vigie et l'écran n'existe pas dans la maquette : confirmer qu'il est à construire dans Vigie. Adresse et nom : Codex ouvre `/changements/<ECR>`, Keystone `/modifications-techniques/`, et Vigie a déjà une « gestion des changements » MC-n (CNF-11, `?changement=`). Proposé : `/modifications-techniques/<numéro>`, MC-n inchangé. | responsable produit | lot 5 |
| CV-07 | **Tranché le 04/11/2026 : numéro propre de Vigie `EV-…` partout (aucun `NCR-nnn`)**, attribué par Vigie (lot 3) ; **appliqué le 05/11/2026** (§ 7 ter). Question d'origine — Numéro d'une NC de projet : `NCR-nnn` par projet (contrainte `events_nc_number_check`, plan D13) ou numéro propre de Vigie `EV-…` (contrat proposé par Keystone, `docs/integrations/vigie-contract.md` § 2.2) ? Saisi ou attribué par Vigie ? | responsable produit, QHSE, Keystone | lot 3 |
| CV-08 | **Tranché le 04/11/2026 : Keystone écrit par une fonction `vigie.pub_…` qui dépose la demande dans une table de réception traitée par Vigie** (réponse asynchrone, état lu dans une vue) ; **appliqué le 05/11/2026** (§ 7 ter : `vigie.pub_signaler_avancement_nc`, table `inbound_requests` ; vue de l'état à publier par Matrix, § 5.1). Question d'origine — Écritures reçues (avancement d'une NC ou d'un ECO par Keystone, ECR par Codex) : API HTTP avec authentification de machine (clé par appelant, à créer dans Vigie), ou fonctions `vigie.pub_…` (M-18) ? Les règles de Vigie sont en TypeScript : une fonction devrait soit les recopier en SQL, soit déposer la demande dans une table de réception traitée par le planificateur de Vigie (réponse asynchrone, état lu dans une vue). Proposé : boîte de réception par fonction `pub_`. | responsable produit, Matrix | lots 3 et 5 |
| CV-09 | D14 : garder les identifiants de Vigie et utiliser `sites.code` comme clé du cache, ou réécrire les identifiants ? **Tranché le 03/11/2026 : réécrire les identifiants (identifiant de site = code de Matrix), pour ne rien doublonner.** | responsable produit | lot 1 |
| CV-10 | **Tranché le 03/11/2026 : toutes les personnes viennent de Cursus ; intérimaires et extérieurs avec un matricule permanent `I` / `E`, pré-déclaration dans Cursus, liste du poste de garde dans Vigie (PRV-25).** Question d'origine — D01 : personnes sans matricule (comptes Entra hors Cursus, intérimaires, extérieurs) gardées comme fiches locales ? Lien compte Entra ↔ matricule : rattachement manuel par le QHSE, ou correspondance tenue par Matrix (`pub_correspondances`), ou e-mail publié par Cursus ? | responsable produit, RH | lot 1 |
| CV-11 | Veille : « projets concernés » d'une exigence d'après une date de livraison que `pub_projets` ne publie pas. Lire `pub_jalons_projets` (PV de réception) ou `pub_avancement_projets` (fin prévue), ou ne garder que la surcharge manuelle ? | QHSE | lot 1 (D02) |

## Annexe : écarts relevés dans le plan de Matrix (à lui signaler)

- Vigie « n'a aucun test » (§ D02, § 10.1) et « aucun journal » (§ D18) : faux depuis les paquets 3 et 8 (Vitest, PostgreSQL
  en CI, Playwright ; `change_log`, `pub_journal`).
- Références de lignes de Vigie (`schema.ts:16-24`, `server/skills.ts:113-145`, `:147-170`, `domain.ts:88`…) : périmées
  (commit `b658790`).
- D14 : 27 clés vers `sites.id` (16 au plan) ; `sites.code` existe depuis 0023.
- D09 : `POST /api/integrations/vigie/certifications` et H3 `GET …/heures-travaillees` n'existent pas dans Cursus.
- D13, D12 : Keystone lit encore Vigie par HTTP (simulé), pas par les vues ; l'API de Vigie « ne sert qu'aux écritures »
  suppose ce changement de Keystone.
- D02 : la veille de Vigie a besoin d'une date de livraison absente de `pub_projets`.
- M-18 : les vues `pub_` de D12 ne sont plus créées par une migration de Vigie (le plan, § D12 « vues déjà écrites »,
  et `partage/60` le supposaient).

## 7. Réalisation du 03/11/2026 (lot 0, D14, D02, D04, D16 ; migration `0024_convergence_m02`)

| Élément | Fait | Attend |
|---|---|---|
| Lot 0 | `src/db/foreign.ts` (vues `.existing()`, `FOREIGN_CONTRACTS`, aucune migration générée), `src/lib/foreign/` (`readSource` : `to_regclass` et `has_table_privilege`, état « source indisponible », `log.warn` limité), substituts `src/db/foreign-substitutes.ts` + `src/db/seeds/foreign.ts` (PGlite ou démonstration, schéma absent ; repère sur le schéma, recréés à chaque ouverture), contrats figés `test/fixtures/contracts/*.json`, `refreshSharedReferences` (`src/server/foreign-sync.ts`) à l'ouverture, chaque nuit (tâche « Référentiels partagés ») et par « Actualiser » ; table `sync_runs` ; onglet « Connecteurs » de « Gérer les sites » ; garde-fou et tests `test/integration/foreign-sources.test.ts` | liens de lecture (§ 5.1) ; recette sur le serveur commun |
| D14 | identifiant = code de Matrix (CV-09), `sites.code` supprimée, 27 clés en `ON UPDATE CASCADE`, réécriture des identifiants de démonstration (`ville-a/b/c` → `site_a/b/c`) dans la migration, `sites.matrix_state` et échéance « fermé / absent de Matrix », suivi d'un site choisi dans `pub_sites` (amorçage compris), libellé et ordre lus | sites créés dans Matrix ; Vigie sur le serveur commun |
| D02 | `keystone_projects` supprimée, choix et contrôle du code (`unknownProjectError`) dans les événements, plans, permis, activités, import des plans et études ; affichage « code · client » (`projectText`) ; ancien libellé lu seulement ; veille : nombre de projets saisi | CV-11 (date de livraison) ; Keystone basculé ; suppression des colonnes `keystone_project` dans une migration ultérieure |
| D04 | cache `keystone_assignments` (`affectation_id`, `source`, `project_code`), jointure par matricule, fin depuis moins d'un an, retrait des affectations disparues | D01 (matricules réels) ; Keystone basculé |
| D16 | `contractors.supplier_id` choisi dans la fiche (sans les ateliers internes), contrôlé, journalisé par le nom | proposition par le nom à l'import des plans (non faite) ; NC fournisseur (lot 3) |
| D18 | contrôle : `pub_journal.qui_matricule` rempli pour les personnes de démonstration | recontrôle après D01 |

Choix pris par défaut, à confirmer : codes des projets de démonstration gardés au format `K-AAAA-NNN` (Keystone n'impose pas de format) ; affectations disparues de la vue retirées du cache (cache sans historique propre) ; pas de contrainte de format sur `sites.id` en base (format contrôlé par le choix dans `pub_sites` et `siteCodeError`) ; rafraîchissement nocturne à partir de 2 h ; substituts aussi en PGlite hors démonstration (application Mac, tests).

## 7 bis. Réalisation du 04/11/2026 (lot 2 : D08, D09 ; migration `0025_convergence_m02_titles`)

Décision CV-01 du 04/11/2026 : **Vigie en consultation seule** des formations et habilitations ; Cursus fait foi pour le
catalogue (D08) et les titres détenus (D09). Décisions du même jour pour la suite : CV-07 (numéro `EV-…` partout) et CV-08
(fonction `vigie.pub_…` et table de réception traitée par Vigie), à réaliser au lot 3.

| Élément | Fait | Attend |
|---|---|---|
| D08 | `training_titles` = cache de `cursus.pub_titres` : identifiant = `titre_id` (démonstration recodée par la migration, clés `qualification_requirements.title_id`, `actions.qualification_title_id`, `risk_measure_links.title_id` en `ON UPDATE CASCADE`, journal, pièces jointes et états lus réécrits), intitulé ← `libelle_court`, validité ← `validite_mois` (nul → 0), `cursus_state` (`actif` \| `absent`) rafraîchis par `refreshSharedReferences` (source `titles`, journal `training_title` « sync ») ; « Suivre un titre » choisi dans le catalogue (`followTitle`, `loadTitleChoices`), « Ne plus suivre » / « Suivre à nouveau » motivés, ordre local (HAB-15) ; attributs propres gardés (CV-03, par défaut) ; `prerequisite_ids` supprimée | Cursus basculé ; trois titres à créer dans Cursus (§ 5.2) ; C-01 confirmé ; CV-03 confirmé |
| D09 | `qualifications` et `training_sessions` supprimées (aucune vue `pub_` ni requête de référence ne les lisait) ; titres détenus lus dans `cursus.pub_titres_detenus` (`readHeldTitles`), joints par `people.matricule` (`src/lib/data/held-titles.ts`) ; état d'une case par `heldTitleState` (« Suspendu » = `prerequis_manquant` ou mesure de suspension / retrait, sinon `utilisable_jusqu_au`) ; matrice, alertes, échéances, prévision HAB-09, EVT-22, SEC-13, secouristes EVT-04, auditeurs AUD-27, bilan SSCT, HAB-18 (sans les formations évaluées), mesures « titre » DUE-19 relus sur la vue ; attestations et journal des formations rattachés à la case « personne\|titre » (lisibles, plus modifiables) ; retirés : saisie et attestations d'une formation, HAB-06, évaluation à froid HAB-13, portée (CV-04, par défaut) | Cursus basculé ; lien de lecture de `vigie_app` (§ 5.1) ; C-02 (aptitude médicale) ; CV-04 confirmé |
| D19 | **fait le 07/11/2026** : `SKILL_SOON_DAYS` = 90 j dans `src/lib/horizons.ts` (C-12) ; `cursus.pub_parametres` n'existe pas chez Cursus | — |
| Source indisponible | cases requises « Donnée indisponible » (`u`), bandeau, aucune échéance par case, une échéance commune `habilitations-cursus-indisponible` au QHSE ; suivi d'un titre et secouriste de l'effectif refusés avec le message ; auditeur interne jamais signalé | recette sur le serveur commun |

Choix pris par défaut, à confirmer (tableau « Convergence M-02, lot 2 » du § 19 de `docs/RESTE-A-FAIRE.md`) : rapprochement
C-01 des titres de démonstration (`elec` → `habilitation.he`, `conduite` → `habilitation.ac489`, `hauteur` et `atex` →
l'habilitation, CACES et SST → la formation, `accueil` → `formation.accueil`) ; attributs QHSE dans le cache (CV-03) ;
portée abandonnée (CV-04) ; substitut de démonstration construit d'après la matrice du jeu (prérequis et mesures posés à la
main, comme Cursus les calculerait) ; une ligne par salarié et titre (dernière formation) : l'historique des formations
saisies avant la bascule reste au journal de la case.

## 7 ter. Réalisation du 05/11/2026 (lot 3 : D13 ; migration `0026_convergence_m02_nc_inbox`)

Décisions CV-07 (numéro `EV-…`) et CV-08 (fonction `pub_` et table de réception) du 04/11/2026.

| Élément | Fait | Attend |
|---|---|---|
| CV-07 numéro | `events.nc_number` gardée (lue par `pub_non_conformites`, colonne `number` et filtre « NC numérotées ») et tenue par la base : déclencheur `events_nc_number` (= identifiant de toute NC portant un code projet, null sinon), contrainte `events_nc_number_check` réécrite (`nc_number = id`), reprise des lignes existantes dans la migration ; aucune colonne publiée supprimée, renommée ni retypée (`published-columns-m18.test.ts` vert) ; les NC de projet de démonstration sont désormais publiées | Keystone : lecture par la vue (§ 5.4) |
| CV-08 fonction | `vigie.pub_signaler_avancement_nc` (14 arguments typés, retour `integer`), `SECURITY DEFINER`, `search_path` = schéma de Vigie puis `pg_temp` (posé par la migration d'après `current_schema()` : `vigie` sur le serveur, `public` en PGlite), sans SQL dynamique, appelant `session_user` contrôlé dans `inbound_callers` (`keystone_app` inscrit par la migration ; P0V01), arguments contrôlés (P0V02), une ligne déposée dans `inbound_requests`, idempotente par `(caller, external_id)`, `REVOKE EXECUTE … FROM PUBLIC` ; commentaire « Contrat D13 v1 » | lien d'exécution de Matrix (§ 5.1) |
| Traitement | `processInboundRequests` (`src/server/inbound.ts`) : tâche « Demandes reçues » à chaque passage du planificateur (serveur Next.js) et « Traiter maintenant » (onglet « Connecteurs », QHSE et direction) ; décision pure `decideNcRequest` (`src/lib/rules/inbound.ts`) ; passage d'étape par les fonctions communes à l'écran (`eventAdvanceBlocker`, `writeAdvance` de `src/server/event-workflow.ts`, `event_steps.inbound_request_id`) ; journal `logChange` (auteur vide, « Keystone (keystone_app) » dans l'intitulé, publié par `pub_journal` ; personne déclarée et commentaire dans le détail, non publiés) ; une demande traitée une fois (état relu dans la transaction) | — |
| Écrans et échéances | fiche d'une NC : « Demandes reçues de Keystone » (refus et motifs pour le QHSE et la direction) ; historique des étapes : « Keystone (demande n° …) » ; onglet « Connecteurs » : boîte de réception (nombres par état, refus à prendre en compte, « Traiter maintenant ») ; échéances au responsable QHSE du site : demande refusée (jusqu'à « Prendre en compte », motivé, journal `inbound_request`), demande non traitée depuis plus d'un jour, vérification proposée par Keystone tant que la NC n'a pas changé d'étape | — |
| Démonstration | deux demandes de Keystone traitées : références de EV-2026-130 (appliquée), passage de EV-2026-121 à « Efficacité vérifiée » refusé (actions non vérifiées : échéance du responsable QHSE) | — |
| Tests | `src/lib/rules/inbound.test.ts`, `test/integration/inbound-keystone.test.ts` (PGlite et PostgreSQL : fonction protégée, aucune exécution pour PUBLIC ni pour un rôle quelconque, appelant inconnu, arguments invalides, idempotence, application et journal, refus santé / AT / MP / autre projet, échéances, prise en compte, « Traiter maintenant ») | — |

Choix pris par défaut, à confirmer (tableau « Convergence M-02, lot 3 » du § 19 de `docs/RESTE-A-FAIRE.md`) : Keystone ne
qualifie pas une NC (passage à « Qualifié » réservé au QHSE de Vigie) et ne la clôt pas (une vérification approuvée ou
refusée est une proposition au QHSE, étape inchangée) ; passage d'étape selon les règles de l'écran Événements, sans droit
propre (une NC dont les actions ne sont pas vérifiées reste à « Actions ») ; références Keystone posées seulement si vides
(jamais d'écrasement, refus motivé), sans contrôle contre `pub_activites` / `pub_articles` / `pub_livrables` (non lues par
Vigie) ; même réponse « introuvable » pour un numéro inconnu, un autre projet ou un autre type d'événement (AT, MP…) ;
codes d'état et de nature en anglais, comme ceux de Keystone et de `pub_non_conformites` ; appelants admis tenus dans une
table de Vigie (`inbound_callers`) plutôt qu'en dur, pour que la démonstration et les tests inscrivent leur `session_user`
sans paramètre de session (aucun affaiblissement : seul le propriétaire du schéma y écrit) ; une demande non traitée
devient une échéance après un jour ; demandes de démonstration non ajoutées aux bases de démonstration existantes (jeu
neuf seulement).

## 7 quater. Réalisation du 05/11/2026 (lot 4 : D10 ; migration `0028_convergence_m02_documents`)

Décision CV-05 du 05/11/2026 : **avancer D10** (« lance le lot 4 »), sans fermer d'abord la création de documents dans Vigie.

| Élément | Fait | Attend |
|---|---|---|
| Lectures | `codex.pub_documents`, `pub_revisions_document`, `pub_validations`, `pub_types_document` déclarées dans `src/db/foreign.ts` (contrats `test/fixtures/contracts/codex.*.json`, Codex `origin/main` `8f41630`), lues directement par `src/lib/foreign/codex.ts` (`readRegisterDocuments`, `readDocumentsByRef` par identifiant ou alias, `readDocumentRevisions`, `readDocumentValidations`, `readDocumentTypes`, `readDocumentsByOwner`) ; contrôlées par `refreshSharedReferences` (`sync_runs`) ; substituts construits d'après les anciens documents du jeu (`src/db/seeds/documents.ts`) | liens de lecture (§ 5.1) ; Codex sur le serveur commun |
| Registre | `/documents` en consultation : périmètre QHSE (C-06 : `attachment = 'none'`, départements `QUA` / `HSE`), site (`pub_documents.site`), confidentialité (`confReadable` : confidentiel pour le QHSE et la direction), révision en vigueur, révisions, circuit en cours, actions et événements rattachés, conservation par type, lien « Ouvrir dans Codex » (`VIGIE_CODEX_URL`) ; ancien identifiant (alias) ouvre la fiche ; consultation seule des autres rôles (documents en vigueur) ; création d'une action (revue périodique ou action libre) par le QHSE | documents QHSE créés dans Codex (§ 5.3) |
| Retiré | formulaires et 11 server actions de `src/server/documents.ts` (création, révision, brouillon, soumission, approbation, renvoi, abandon, « Rendre obsolète », revue sans modification et son annulation) ; DOC-15, DOC-17 ; journal du document montré par Vigie (celui de Codex fait foi) ; fichiers des documents servis par `/fichiers` | demande de retrait depuis Vigie (D12, lot 5) |
| Données | tables `documents`, `document_versions`, `document_reviews` supprimées (aucune vue `pub_` ni requête de référence ne les lisait : garde-fou M-18 vert) ; `document_actions (codex_id, revision, action_id)` ; `events.document_id`, `actions.document_id`, `risk_measure_links.document_id` gardées en texte sans clé étrangère ; reprise de démonstration (identifiants recodés, journal rattaché, fichiers gardés non servis) | — |
| Liens | `docversion:<identifiant>:<lettre>` (révision ouverte), source d'origine `document:<identifiant>` (alias admis, identifiant de Codex enregistré) ; événement (`?document=` prérempli, choix et contrôle) ; mesure de maîtrise DUE-19 (en vigueur, revue dépassée, « donnée indisponible ») ; procédure de l'écran Prévention (alias) ; références d'origine reprises (`reprise-liens`) ; données d'une personne (propriétaire par matricule) ; dossier de revue (revues en retard, révisions en validation) | — |
| Échéances | `revue-documentaire\|<id>` (au propriétaire par matricule, sinon responsable QHSE du site), `validation-documentaire\|<id>\|<révision>` (personne de l'étape en cours, sinon propriétaire, sinon responsable QHSE), `documents-codex-indisponible` ; `test/fixtures/todo-golden.json` réécrit | — |
| Tests | `test/integration/codex-documents.test.ts` (périmètre, confidentialité, Salarié, alias, résolution hors périmètre, événement, mesure, échéances, lien profond, source indisponible) ; tests des actions, de la migration 0005, de la reprise des liens et de l'ergonomie mis à jour ; `documents-actions.test.ts` et les tests du cycle de vie retirés | recette sur le serveur commun |

Choix pris par défaut, à confirmer (tableau « Convergence M-02, lot 4 » du § 19 de `docs/RESTE-A-FAIRE.md`) : DOC-15 et
DOC-17 passés à Codex (conservation par type) ; périmètre C-06 (QUA / HSE sans rattachement, site) ; confidentiel lu par le
QHSE et la direction ; liens vers Codex seulement avec `VIGIE_CODEX_URL` ; destinataires par matricule (propriétaire,
étape en cours), à défaut le responsable QHSE du site ; une action par révision ouverte ; identifiants de démonstration
`TYPE-DÉPARTEMENT-SEQ` avec l'ancien identifiant en alias.

## 7 quinquies. Réalisation du 05/11/2026 (lot 5 : D12 ; migration `0029_convergence_m02_ecr_eco`)

Décision CV-06 du 05/11/2026 (« lance le lot 5 ») : **module ECR / ECO construit dans Vigie**, écran « Modifications
techniques » à `/modifications-techniques`, gestion des changements MC-n inchangée. Détail : `docs/specs/modifications-techniques.md`.

| Élément | Fait | Attend |
|---|---|---|
| Tables | `ecos`, `ecrs`, `eco_approvals`, `eco_parts`, `eco_projects`, `eco_effectivity`, `eco_documents`, `eco_actions` aux colonnes exactes des quatre publications de Matrix (requêtes de référence nommées, `test/integration/ecr-eco-contract.test.ts`, garde-fou M-18 étendu), colonnes propres en fin de table ; `external_progress` non créée (`inbound_requests`) ; file `outbound_messages` | application des quatre publications par Matrix (§ 5.1) |
| Écran | registre des ordres et des demandes, fiches (approbations, effectivité, demandes et actions liées, historique), formulaires ; liens `/modifications-techniques/<numéro>` et `/nouvelle` de Keystone et Codex ; navigation, aide, `ROLE_ROUTES`, axe | recette du service QHSE |
| Règles | numérotation `ECO-AAAA-NNN` / `ECR-AAAA-NNN`, parcours et libération d'office, approbateur désigné, effectivité proposée d'après `keystone.pub_nomenclatures` et `pub_parc_machines`, annulation motivée, source d'action « Modification technique » | — |
| Écritures reçues | `vigie.pub_creer_demande_modification` (Codex, numéro réservé et rendu) et `vigie.pub_signaler_avancement_eco` (Keystone), traitées par « Demandes reçues » (`decideEcrRequest`, `decideEcoRequest`) | liens d'exécution (§ 5.1) ; bascule de Codex et de Keystone (§ 5.3, § 5.4) |
| Envois | décisions sur les demandes de Codex au webhook `POST /api/integrations/vigie` (jeton, signature HMAC, reprises), tâche « Envois aux outils », onglet « Connecteurs » | identifiants du webhook posés des deux côtés |
| Lectures | `keystone.pub_articles`, `pub_nomenclatures`, `pub_parc_machines` (contrats relevés dans les migrations 0035 et 0040 de Keystone, substituts) | liens de lecture (§ 5.1) |
| Échéances | `ecr-decision`, `eco-approbation`, `eco-dispositions`, `eco-effectivite` ; refus et attentes de Codex `codex-refus` / `codex-attente` | — |

Choix pris par défaut, à confirmer : tableau « Convergence M-02, lot 5 » du § 19 de `docs/RESTE-A-FAIRE.md`.

## 7 sexies. Réalisation du 07/11/2026 (D01 et PRV-25 ; migration `0030_convergence_m02_people`)

Décision CV-10 du 03/11/2026 (tranchée) : aucune fiche de personne propre à Vigie ; toutes viennent de Cursus,
intérimaires (`I…`) et salariés d'entreprises extérieures (`E…`) compris ; Vigie produit la liste du poste de garde.

| Élément | Fait | Attend |
|---|---|---|
| Lectures | `cursus.pub_salaries` déclarée au **contrat D01 v2** (`src/db/foreign.ts`, `test/fixtures/contracts/cursus.pub_salaries.json` : colonnes v1 de `0002_partage.sql` de Cursus puis `categorie`, `entreprise`, `email` du contrat de Matrix `cursus.pub_salaries-d01-v2.json`) ; `readCursusPeople` (`src/lib/foreign/cursus.ts`) sonde les colonnes présentes de la vue (`viewColumns`, catalogue `pg_attribute`) à chaque lecture et ne lit une colonne v2 que si elle existe : une vue au contrat v1 reste une source **disponible** (valeurs de Vigie gardées). `cursus.pub_presences_prevues` (contrat de Matrix, 9 colonnes) lue par `readPlannedPresences` ; vue absente = « source indisponible ». Substituts de démonstration (`demoCursusPeople`, `demoPresences` de `src/db/seeds/foreign.ts`), vides en PGlite hors démonstration | Cursus sur le serveur commun ; colonnes v2 et vue des présences créées par Cursus et publiées par Matrix ; liens de lecture de `vigie_app` (§ 5.1) |
| Cache des personnes | étape « Personnes » de `refreshSharedReferences` (avant les affectations) : fiche de même matricule mise à jour (nom, poste, site suivi de même code sinon aucun, sortie avec « Sortie enregistrée dans Cursus », catégorie, entreprise, `cursus_email`) ; personne publiée inconnue créée (présente ou sortie depuis moins d'un an) ; personne retirée de la vue gardée, `cursus_state = 'absent'` ; règles pures `src/lib/rules/people-sync.ts` ; journal `person` sans auteur (« Cursus » dans l'intitulé, e-mail jamais en clair, première lecture des colonnes v2 sans entrée) ; `sync_runs` : nombres seulement | — |
| Saisie retirée | création d'une fiche (`savePerson` sans identifiant refusé, « Ajouter un salarié » retiré), import Lucca (IMP-02 caduc) ; fiche tenue par Cursus : seuls le service et le suivi dans la matrice se modifient ; sortie et réintégration refusées (elles viennent de Cursus) | — |
| Fiches anciennes | fiche sans matricule (saisie avant D01 ou créée à la première connexion Entra) gardée, « à rattacher » : vue `/habilitations?vue=personnel` (QHSE et direction), `attachPerson` (`src/server/people.ts`, motif, site de la fiche, journal des deux fiches) ; matricule déjà porté refusé, sauf par la fiche que le rafraîchissement avait créée sans historique propre (sortie, `replaced_by_id`, jamais supprimée) | — |
| Première connexion | `src/lib/auth/person.ts` : objectId, puis adresse publiée par Cursus (`people.cursus_email`), puis adresse de la fiche ; sans fiche : création sans matricule (« à rattacher ») ; refus « Compte Microsoft non rattaché » inchangé | colonne `email` publiée (v2) |
| Écrans | « Actualiser depuis Cursus » (Habilitations, QHSE et direction, `refreshFromCursus`) ; fiche salarié : données de Cursus en lecture ; données personnelles SEC-13 : origine (Cursus ou Vigie) de chaque donnée | — |
| PRV-25 | vue `/prevention?vue=poste-de-garde&horizon=` et impression `/prevention/poste-de-garde/imprimer` : arrivées et départs validés des 1, 7 (défaut), 14 ou 30 prochains jours, annulées à part, nom d'après le cache (« matricule inconnu »), plan ou permis de la même entreprise sur le même site aux dates recoupées (`src/lib/rules/gate-house.ts`) ; lecteurs : QHSE, direction, encadrement | accueil sécurité (C-13) |
| Échéances | `personne-a-rattacher\|<id>`, `cursus-personne-absente\|<id>` au responsable QHSE du site, `cursus-personnes-indisponible` (dernier passage en échec) ; QHSE et direction seulement ; `test/fixtures/todo-golden.json` réécrit (+1 échéance pour le QHSE et la direction : la fiche ancienne du jeu) | — |
| Tests | `src/lib/rules/people-sync.test.ts`, `gate-house.test.ts`, `test/integration/cursus-people.test.ts` (vue v1 et v2, absente, indisponible, création refusée, rattachement, échéances, poste de garde par rôle et par site), `test/integration/entra.test.ts` (ordre du rapprochement), `test/e2e/employee-payload.test.ts`, Playwright `poste-de-garde.spec.ts`, `habilitations.spec.ts`, axe | recette sur le serveur commun |

Choix pris par défaut, à confirmer : tableau « Convergence M-02, D01 et PRV-25 » du § 19 de `docs/RESTE-A-FAIRE.md`
(création « à rattacher » à la première connexion, lecteurs et horizon de la liste, rapprochement d'un plan ou d'un permis,
fiches anciennes gardées et rattachées à la main).

