# Vigie — reste à faire (développement)

*Arrêté au 10/10/2026, après le commit `e8e3a3c` (« Compléter les écrans de Vigie : traçabilité, échéances et liens entre modules »).*

**État du logiciel.** Les écrans de la maquette sont en place (tableau de bord et « À faire », événements et signalement terrain, plan d'actions, DUERP, habilitations, veille et contrôles, audits et revue de direction, prévention et carte du site, documents maîtrisés, environnement), avec annulation, archivage et classement motivés, journal des modifications, échéances transverses, badges et liens entre modules. Vigie reste une **démonstration** : le rôle se choisit dans un sélecteur, toute base vide reçoit le jeu de démonstration, aucun connecteur n'existe (Entra ID, Keystone, Cursus, Trackdéchets), les seuls échanges de fichiers sont l'import des plans de prévention et les exports CSV du DUERP et du registre des déchets, et aucun test automatisé n'est écrit.

**Contenu.** 309 éléments vérifiés dans le code, chacun avec sa preuve `fichier:ligne` (chemins depuis la racine du dépôt, lignes au commit `e8e3a3c`). Charge totale indicative : 309,5–895 jours, soit de l'ordre de 1,4 à 4 années-développeur ; les lots 1 et 2 (P0 et P1 sans prérequis externe) en représentent 54–158 j.

**Lecture.**

- **Priorité** — **P0** : bloque une mise en production. **P1** : à traiter avant l'usage réel (obligation réglementaire, donnée fausse ou perdue, droit d'accès). **P2** : important, à planifier. **P3** : confort, dette, amélioration.
- **Taille** — **S** < 1 j · **M** 1–3 j · **L** 3–10 j · **XL** > 10 j (aucun élément XL : les gros sujets sont découpés). Estimations indicatives pour un développeur qui connaît le code, hors recette et coordination ; la charge d'un ensemble est la somme des bornes basses (S = 0,5 j) et hautes.
- **Réf** — préfixe du groupe + numéro, stable : à citer dans les tickets et les commits. Dans chaque groupe, les éléments sont triés par priorité.
- **Dépend de** — prérequis technique ou décision externe ; les décisions attendues sont regroupées en [§ 19](#19-questions-ouvertes).

## 1. Synthèse

| Groupe | Préfixe | P0 | P1 | P2 | P3 | Total | S / M / L | Charge (j) |
|---|---|--:|--:|--:|--:|--:|:-:|--:|
| [Tableau de bord, échéances et navigation](#3-tableau-de-bord-échéances-et-navigation-tdb) | TDB | · | 5 | 4 | 9 | **18** | 9 / 9 / 0 | 13,5–36 |
| [Événements et signalement terrain](#4-événements-et-signalement-terrain-evt) | EVT | · | 7 | 15 | 6 | **28** | 12 / 12 / 4 | 30–88 |
| [Plan d'actions](#5-plan-dactions-act) | ACT | · | 1 | 4 | 11 | **16** | 11 / 4 / 1 | 12,5–33 |
| [Prévention et carte du site](#6-prévention-et-carte-du-site-prv) | PRV | · | 3 | 9 | 8 | **20** | 8 / 9 / 3 | 22–65 |
| [Risques / DUERP](#7-risques--duerp-due) | DUE | · | 2 | 9 | 9 | **20** | 10 / 8 / 2 | 19–54 |
| [Habilitations et formations](#8-habilitations-et-formations-hab) | HAB | · | 1 | 9 | 10 | **20** | 8 / 9 / 3 | 22–65 |
| [Veille et contrôles](#9-veille-et-contrôles-vei) | VEI | · | 2 | 9 | 7 | **18** | 10 / 8 / 0 | 13–34 |
| [Audits et revue de direction](#10-audits-et-revue-de-direction-aud) | AUD | · | 6 | 11 | 19 | **36** | 19 / 16 / 1 | 28,5–77 |
| [Documents et environnement](#11-documents-et-environnement-doc) | DOC | · | 2 | 10 | 11 | **23** | 14 / 6 / 3 | 22–62 |
| [Intégrations](#12-intégrations-int) | INT | · | 4 | 6 | 7 | **17** | 2 / 8 / 7 | 30–96 |
| [Imports, exports et impression](#13-imports-exports-et-impression-imp) | IMP | · | 1 | 6 | 2 | **9** | 2 / 5 / 2 | 12–37 |
| [Production et exploitation](#14-production-et-exploitation-prd) | PRD | 4 | 3 | 8 | · | **15** | 7 / 8 / 0 | 11,5–31 |
| [Sécurité et RGPD](#15-sécurité-et-rgpd-sec) | SEC | 3 | 3 | 6 | 2 | **14** | 6 / 6 / 2 | 15–44 |
| [Qualité, tests, performance et dette technique](#16-qualité-tests-performance-et-dette-technique-qua) | QUA | · | 7 | 6 | 15 | **28** | 12 / 13 / 3 | 28–81 |
| [UX et accessibilité](#17-ux-et-accessibilité-ux) | UX | · | 3 | 11 | 2 | **16** | 5 / 10 / 1 | 15,5–45 |
| [Conformité réglementaire transverse](#18-conformité-réglementaire-transverse-cnf) | CNF | · | · | 6 | 5 | **11** | 0 / 9 / 2 | 15–47 |
| **Total** | | **7** | **50** | **129** | **123** | **309** | 135 / 140 / 34 | **309,5–895** |

Par type :

| Type | Éléments | dont P0–P1 |
|---|--:|--:|
| fonctionnel | 74 | 8 |
| conformité-réglementaire | 68 | 9 |
| bug | 47 | 12 |
| ux-accessibilité | 33 | 3 |
| intégration | 23 | 4 |
| dette-technique | 19 | 1 |
| production | 15 | 6 |
| sécurité | 11 | 8 |
| qualité-tests | 9 | 5 |
| import-export | 7 | 1 |
| performance | 3 | 0 |

### Bloquants pour une mise en production (P0), dans l'ordre recommandé

1. **PRD-03** Mode démonstration explicite (VIGIE_DEMO) — isoler le sélecteur de rôle, `setRole` et `VIGIE_TODAY` derrière `VIGIE_DEMO` ; préalable à tout déploiement.
2. **SEC-03** Identifiants stables sur la fiche personne — objectId, e-mail, matricule : la clé de rapprochement avec Entra ID et Cursus.
3. **PRD-04** Base de production sans jeu de démonstration — seed réservé à la démonstration ; retirer les identifiants du seed de `ROLES` et `QHSE_LEAD` (avec **TDB-01**).
4. **PRD-01** Hébergement et empaquetage — sortie standalone, HTTPS, volume persistant ; trancher **PRD-05** (PGlite ou PostgreSQL) avant.
5. **PRD-02** Sauvegarde, restauration et chiffrement — sauvegarde avant chaque migration et restauration testée, avant les premières données réelles.
6. **SEC-01** Authentification Microsoft Entra ID — taille L et dépend du tenant : demander l'inscription de l'application dès le début du lot.
7. **SEC-02** Rôles et périmètre de sites depuis Entra — rôles et sites autorisés tirés d'Entra ; ferme le changement de site hors périmètre.

À livrer avec ces bloquants : **SEC-04**, **SEC-05** (hôte, en-têtes, cookies), **PRD-07** (URL publique des QR codes), **EVT-06** et **EVT-07** (parcours terrain sans poste de démonstration, authentifié).

## 2. Feuille de route proposée

Quatre lots. Les lots 1 et 2 se suivent ; le lot 3 démarre dès que ses prérequis externes sont levés ; le lot 4 s'intercale selon la capacité. Les éléments qui exigent une migration drizzle sont à regrouper par lot pour limiter le nombre de migrations : ceux dont la colonne « Dépend de » le signale (TDB-01, ACT-09, ACT-10, PRV-02, PRV-04, PRV-07, PRV-09, DUE-03, AUD-01, AUD-03, AUD-22, AUD-36), mais aussi tous ceux qui ajoutent une colonne ou une table (par exemple SEC-03, EVT-01, EVT-19, DOC-02, DOC-09, HAB-04).

### Lot 1 — Mise en production

23 éléments (P0 : 7 · P1 : 16) — charge indicative 26,5–79 j.

Objectif : une instance hébergée, authentifiée, sauvegardée, sans données de démonstration, avec une intégration continue et les premiers tests.

1. Bloquants (P0), dans l'ordre du § 1
   - **PRD-03** Mode démonstration explicite (VIGIE_DEMO) (P0, S)
   - **SEC-03** Identifiants stables sur la fiche personne (P0, S)
   - **PRD-04** Base de production sans jeu de démonstration (P0, M)
   - **PRD-01** Hébergement et empaquetage (P0, M)
   - **PRD-02** Sauvegarde, restauration et chiffrement (P0, M)
   - **SEC-01** Authentification Microsoft Entra ID (P0, L)
   - **SEC-02** Rôles et périmètre de sites depuis Entra (P0, M)
2. Exploitation
   - **PRD-05** PGlite ou PostgreSQL (P1, M)
   - **PRD-06** Règles et tests de migration (P1, M)
   - **PRD-07** URL publique des QR codes (P1, S)
3. Sécurité et données
   - **SEC-04** Contrôle de l'hôte (DNS rebinding) (P1, S)
   - **SEC-05** En-têtes HTTP et cookies (P1, S)
   - **SEC-06** Données de santé des AT restreintes (P1, M)
   - **TDB-01** Destinataires des alertes : un animateur QHSE par site, tiré des données (P1, M)
4. Signalement terrain
   - **EVT-06** « Nouveau signalement » : lieu de démonstration et cible du bouton (P1, S)
   - **EVT-07** Parcours terrain authentifié et signalement sans compte (P1, L)
5. Qualité et tests
   - **QUA-02** typecheck sur un clone neuf (P1, S)
   - **QUA-01** Intégration continue (P1, S)
   - **QUA-07** Corriger addMonths en fin de mois (P1, S)
   - **QUA-03** Vitest et tests des règles pures (P1, L)
   - **QUA-04** Tests d'intégration des server actions (P1, L)
   - **QUA-05** Recette des server actions jamais exécutées (P1, M)
   - **QUA-06** Non-régression du cloisonnement Salarié (P1, M)

### Lot 2 — Fiabilisation et conformité prioritaire

28 éléments (P1 : 28) — charge indicative 27,5–79 j.

Objectif : tous les P1 métier qui ne dépendent pas d'un connecteur ni d'une levée de report.

1. Corrections rapides (S)
   - **TDB-04** TF1/TG : fenêtre de 12 mois, mois manquants et « — » sans heures (P1, S)
   - **EVT-02** Clôture d'un AT sans déclaration CPAM : l'obligation disparaît (P1, S)
   - **EVT-05** Qualification : exiger les données propres au type (P1, S)
   - **HAB-01** Contrôle des fichiers côté navigateur dans « Enregistrer une formation » (P1, S)
   - **VEI-01** Pilote, responsable ou site effacés en silence (P1, S)
   - **VEI-02** Réserves sans action de levée absentes des échéances (P1, S)
   - **DOC-01** Document : propriétaire sorti ou site archivé remplacé (P1, S)
   - **AUD-02** Accès en lecture aux audits pour leurs responsables (P1, S)
   - **AUD-05** Section 1 du dossier : décisions sans action et actions annulées (P1, S)
   - **UX-02** Formulaire terrain : zoom iOS, cibles, dictée (P1, S)
   - **UX-03** Fenêtres modales (P1, S)
2. Accidents du travail — **EVT-01** après la décision RGPD, avec **SEC-06** du lot 1
   - **EVT-03** Délai CPAM : 48 h hors dimanches et fériés, à compter de la connaissance (P1, S)
   - **EVT-01** Accident du travail : victime, circonstances et rubriques de la DAT (P1, L)
   - **EVT-04** Registre des accidents bénins (P1, M)
3. Prévention et DUERP
   - **PRV-01** Écarts R. 4512-6 passés non comptés (P1, M)
   - **PRV-02** Contenu réglementaire du plan incomplet (R. 4512-8 et R. 4512-9) (P1, M)
   - **PRV-03** Fiche imprimable d'un permis et registre par période (P1, S)
   - **DUE-01** Mise à disposition du DUERP aux salariés, anciens salariés et instances (P1, M)
   - **DUE-02** PAPRIPACT : programme annuel de prévention (P1, L)
4. Audits et revue de direction
   - **AUD-01** Lier programme d'audit et revues de direction par reviewId (P1, M)
   - **AUD-03** Reporter ou annuler un élément du programme (P1, M)
   - **AUD-04** Contributeurs de revue sans accès à l'écran Audits (P1, M)
   - **AUD-06** Dossier figé calculé à la clôture, pas à la séance (P1, M)
5. Échéances, liens et mobile — **ACT-01** avec son script de reprise
   - **TDB-02** Échéances masquées pour un responsable sans accès à l'écran source (P1, M)
   - **TDB-05** « Mes échéances » consolidées tous sites (P1, M)
   - **ACT-01** Rattacher les actions Prévention, Documents et Environnement par un vrai lien (P1, L)
   - **DOC-02** Registre des déchets : mentions de l'arrêté du 31 mai 2021 (P1, M)
   - **UX-01** Navigation mobile (P1, M)

### Lot 3 — Intégrations EPC2i, imports, exports et impression

42 éléments (P1 : 6 · P2 : 20 · P3 : 16) — charge indicative 65,5–207 j.

Objectif : brancher Vigie sur le système EPC2i et ouvrir les échanges de fichiers, au rythme des API disponibles et des reports levés (voir [§ 19](#19-questions-ouvertes)).

- **Socle** : **INT-01** connecteurs (P1), **PRD-12** tâches planifiées, puis **INT-04** notifications sortantes (P1) et **INT-17** flux iCalendar.
- **Keystone** : **INT-02** (P1), **INT-05**, **INT-08**, **INT-11**, **INT-12**, **INT-15**, **VEI-17**, **PRV-20**.
- **Cursus** (personnel, formations, santé au travail) : **INT-03** (P1), **INT-09**, **HAB-02**, **HAB-08**, **HAB-20**, **DUE-08**, **PRV-08**, **DOC-07**.
- **Trackdéchets et Légifrance** : **INT-10**, **INT-16**.
- **Import des plans de prévention par IA** : **INT-06**, **INT-07**, **INT-13**, **INT-14**.
- **Imports** (après levée du report) : **TDB-03** et **IMP-01** (P1 ; heures travaillées, base du TF1/TG), **IMP-02** (Lucca), **IMP-03** (veille Excel).
- **Exports et impression** : **IMP-04** (helper CSV) puis **IMP-05**, **IMP-06**, **IMP-07**, **IMP-08**, **IMP-09** ; vues imprimables **EVT-10**, **DUE-11**, **AUD-26**, **VEI-15** ; archivage PDF **AUD-32**.
- **Signature à distance** des plans de prévention : **PRV-18**.

### Lot 4 — Conformité étendue et confort

216 éléments (P2 : 109 · P3 : 107) — charge indicative 190–530 j.

Objectif : le reste des P2, puis les P3, par thème.

- **Traçabilité** (journal, motifs) : **TDB-09**, **EVT-12**, **ACT-03**, **ACT-04**, **ACT-05**, **PRV-04**, **PRV-12**, **DUE-04**, **DUE-06**, **HAB-03**, **VEI-04**, **AUD-10**, **AUD-36**, **DOC-04**, **DOC-10**, **SEC-11**.
- **Conformité réglementaire** : **CNF-01** à **CNF-06**, **EVT-08**, **EVT-09**, **EVT-17**, **PRV-05**, **PRV-09**, **DUE-03**, **DUE-07**, **DUE-10**, **AUD-08**, **AUD-09**, **AUD-13**, **VEI-10**, **HAB-10**, **DOC-12**, **SEC-10**, **SEC-12**.
- **Terrain et mobile** : **EVT-18** à **EVT-22**, **UX-05** à **UX-08**.
- **Exploitation et robustesse** : **PRD-08** à **PRD-11**, **PRD-13** à **PRD-15**, **SEC-07** à **SEC-09**, **QUA-08** à **QUA-13**.
- **P2** — 109 éléments, 109–316 j : TDB-06 à 09 · EVT-08, 09, 11 à 22 · ACT-02 à 05 · PRV-04 à 07, 09 à 12 · DUE-03 à 07, 09, 10 · HAB-03 à 07, 09, 10 · VEI-03 à 11 · AUD-07 à 17 · DOC-03 à 06, 08 à 12 · PRD-08 à 11, 13 à 15 · SEC-07 à 12 · QUA-08 à 13 · UX-04 à 14 · CNF-01 à 06
- **P3** — 107 éléments, 81–214 j : TDB-10 à 18 · EVT-23 à 28 · ACT-06 à 16 · PRV-13 à 17, 19 · DUE-12 à 20 · HAB-11 à 19 · VEI-12 à 14, 16, 18 · AUD-18 à 25, 27 à 31, 33 à 36 · DOC-13 à 23 · SEC-13, 14 · QUA-14 à 28 · UX-15, 16 · CNF-07 à 11

## 3. Tableau de bord, échéances et navigation (TDB)

18 éléments — P1 : 5 · P2 : 4 · P3 : 9 — charge indicative 13,5–36 j.

| Réf | Élément | Priorité | Taille | Dépend de |
|---|---|:-:|:-:|---|
| TDB-01 | Destinataires des alertes : un animateur QHSE par site, tiré des données | **P1** | M | Migration sites.qhseLeadId ; rôles réels Entra ID |
| TDB-02 | Échéances masquées pour un responsable sans accès à l'écran source | **P1** | M | — |
| TDB-03 | Saisie mensuelle des heures travaillées (base du TF1/TG) | **P1** | M | Levée du report « aucune saisie/import » |
| TDB-04 | TF1/TG : fenêtre de 12 mois, mois manquants et « — » sans heures | **P1** | S | — |
| TDB-05 | « Mes échéances » consolidées tous sites | **P1** | M | — |
| TDB-06 | Notifications d'information (action confiée, suite d'un signalement) | P2 | M | — |
| TDB-07 | État lu : clé avec date d'échéance et gravité, retards triés par ancienneté | P2 | M | — |
| TDB-08 | Archivage d'un site : avertir des éléments encore ouverts | P2 | M | — |
| TDB-09 | Traçabilité des sites : journaliser la règle Seveso / PP et afficher l'historique | P2 | S | — |
| TDB-10 | Purge des états lus et commentaire de schéma obsolète | P3 | S | Tâches planifiées |
| TDB-11 | Marquer lue une échéance ouverte depuis À faire ou le tableau de bord | P3 | S | — |
| TDB-12 | Liens du tableau de bord vers des listes vraiment filtrées | P3 | M | Filtres de /evenements et /actions |
| TDB-13 | Exactitude des KPI du tableau de bord | P3 | S | — |
| TDB-14 | Carte « Veille réglementaire » après la date d'application | P3 | S | — |
| TDB-15 | Indiquer le site en vue « Tous les sites » | P3 | S | — |
| TDB-16 | Horizons d'échéances centralisés et groupes de À faire | P3 | S | — |
| TDB-17 | Titres d'onglet du tableau de bord et de À faire | P3 | S | — |
| TDB-18 | Recherche globale dans l'en-tête | P3 | M | — |

- **TDB-01** — Les alertes de tous les domaines et le pilote par défaut des recyclages visent QHSE_LEAD, une personne de démonstration fixe. Il faut un responsable QHSE par site (dans « Gérer les sites »), utilisé par les load\*Signals. (preuve : src/lib/domain.ts:301-304 ; src/components/skills/common.tsx:16,41 ; src/lib/data/skills.ts:254-265 ; src/lib/data/events.ts:318-326 ; src/lib/data/risks.ts:486-487 ; src/lib/data/actions.ts:303 ; src/lib/data/audits.ts:272,282 ; src/lib/data/review.ts:639-650 ; src/db/schema.ts:10-22)
  *Question : Un animateur par site ou un seul ? Qui reçoit les alertes si le poste est vacant ?*
- **TDB-02** — loadVisibleTodo écarte les échéances dont le lien vise un écran fermé au rôle, même pour leur responsable (visite S. Benali, audit E. Dubois, contributions de revue). (preuve : src/lib/data/todo.ts:32-36 ; src/lib/data/review.ts:623-625 ; src/lib/data/audits.ts:259-267 ; src/lib/domain.ts:276-287 ; src/db/seed.ts:263,306)
  *Question : Vue en lecture de l'élément, ou échéance sans lien ?*
- **TDB-03** — hours_worked n'est rempli que par le seed (10/2025-09/2026). Ajouter saveHoursWorked (site, mois, requireApprover), une fenêtre depuis le KPI TF1 et un signal « heures de M-1 non saisies ». (preuve : src/db/seed.ts:349-354 ; src/lib/data/dashboard.ts:25,38-40 ; src/lib/data/review.ts:97,113)
  *Question : Saisie manuelle ou import (paie, Lucca, Cursus) ? Intérimaires inclus ?*
- **TDB-04** — La comparaison de chaînes inclut un 13e mois, les mois manquants gonflent les taux sans avertissement, et 0 heure affiche TF1 0,0. Extraire une fonction pure testée utilisée par le tableau de bord et la revue. (preuve : src/lib/data/dashboard.ts:37-40,66 ; src/lib/data/review.ts:113,364-369)
- **TDB-05** — Notifications et À faire ne couvrent que le site sélectionné : une personne ne voit pas ses échéances d'un autre site. (preuve : src/lib/data/todo.ts:21-28 ; src/lib/data/notifications.ts:24-34 ; src/lib/queries.ts:39-42 ; src/lib/session.ts:31,52-58)
  *Question : Consolider tous sites pour chaque personne, indépendamment du sélecteur ?*
- **TDB-06** — La cloche ne contient que des échéances : rien quand une action est confiée ou réaffectée, ni pour le déclarant quand son signalement est qualifié, classé ou clôturé. (preuve : src/lib/data/notifications.ts:24-34 ; src/server/plan.ts:117-146)
- **TDB-07** — todoKey ignore la date et le ton : une échéance récurrente ou aggravée reste lue. Les retards ont tous la date du jour. Ajouter dueOn à TodoItem, à la clé et au tri. (preuve : src/lib/domain.ts:319-336 ; src/lib/data/watch.ts:265-298 ; src/lib/data/audits.ts:259-275 ; src/lib/data/review.ts:640-650)
- **TDB-08** — archiveSite ne vérifie que le dernier site actif. Afficher le décompte des éléments ouverts, voire bloquer ou proposer un transfert. (preuve : src/server/sites.ts:71-94 ; src/components/SitesManager.tsx:84-90)
  *Question : Blocage ou avertissement ? Transfert en masse ?*
- **TDB-09** — saveSiteRule n'appelle pas logChange alors qu'elle change rétroactivement les écarts ; l'historique des sites n'est affiché nulle part. (preuve : src/server/sites.ts:121-138 ; src/components/SitesManager.tsx:21-68)
- **TDB-10** — notification_reads grossit sans limite et le commentaire du schéma décrit une purge supprimée. (preuve : src/server/notifications.ts:28-40 ; src/db/schema.ts:646-652)
- **TDB-11** — Seul le clic dans la cloche appelle markNotificationsRead. (preuve : src/app/(app)/a-faire/page.tsx:64 ; src/app/(app)/page.tsx:102-104 ; src/components/NotificationBell.tsx:62)
- **TDB-12** — « Actions en retard », « > 30 j » et les trois barres AT ouvrent des listes non filtrées. (preuve : src/lib/data/dashboard.ts:63-68,76-78 ; src/app/(app)/actions/page.tsx:55-75 ; src/app/(app)/evenements/page.tsx:38-44)
- **TDB-13** — « 7 derniers jours » compte par date des faits, la note Contrôles cite le premier et non le plus en retard, une NC sans origine n'a pas de barre, la NC « Réclamation client » est fusionnée avec les RC. (preuve : src/lib/data/dashboard.ts:44,52,57-59,67,69,84,101 ; src/lib/domain.ts:52)
- **TDB-14** — La carte reste « Applicable au [date passée] ». Afficher « depuis le » avec l'état de conformité ou retirer de la une. (preuve : src/app/(app)/page.tsx:147-155 ; src/lib/data/dashboard.ts:87,110-123)
- **TDB-15** — Échéances et derniers signalements n'indiquent pas le site (TodoItem sans site). (preuve : src/lib/domain.ts:319-331 ; src/app/(app)/page.tsx:95-108,122 ; src/app/(app)/a-faire/page.tsx:73-75)
- **TDB-16** — Prévention et coactivité ont leurs constantes à 15 j ; À faire range tout au-delà de 15 j dans « Contrôles à 30 jours ». (preuve : src/components/prevention/model.ts:12 ; src/lib/data/prevention.ts:682 ; src/components/sitemap/model.ts:8 ; src/lib/data/sitemap.ts:310 ; src/lib/data/dashboard.ts:155-160)
- **TDB-17** — Ces deux pages n'exportent pas de metadata.title. (preuve : src/app/(app)/page.tsx:1-13 ; src/app/(app)/a-faire/page.tsx:1-14 ; src/app/layout.tsx:9-12)
- **TDB-18** — Recherche par référence ou intitulé, filtrée par site et droits, vers les liens profonds existants. Hors maquette. (preuve : src/components/PageHeader.tsx:7-22)
  *Question : Souhaitée alors que la maquette n'en prévoit pas ?*

## 4. Événements et signalement terrain (EVT)

28 éléments — P1 : 7 · P2 : 15 · P3 : 6 — charge indicative 30–88 j.

| Réf | Élément | Priorité | Taille | Dépend de |
|---|---|:-:|:-:|---|
| EVT-01 | Accident du travail : victime, circonstances et rubriques de la DAT | **P1** | L | Décision RGPD données de santé ; people en attendant Cursus |
| EVT-02 | Clôture d'un AT sans déclaration CPAM : l'obligation disparaît | **P1** | S | — |
| EVT-03 | Délai CPAM : 48 h hors dimanches et fériés, à compter de la connaissance | **P1** | S | Calendrier des jours fériés dans src/lib/dates.ts |
| EVT-04 | Registre des accidents bénins | **P1** | M | Victime et lésions de l'AT |
| EVT-05 | Qualification : exiger les données propres au type | **P1** | S | — |
| EVT-06 | « Nouveau signalement » : lieu de démonstration et cible du bouton | **P1** | S | — |
| EVT-07 | Parcours terrain authentifié et signalement sans compte | **P1** | L | Entra ID |
| EVT-08 | Suivi de l'arrêt de travail : périodes, reprise, jours perdus calculés | P2 | M | Victime identifiée sur l'AT |
| EVT-09 | Maladies professionnelles et accidents de trajet | P2 | M | Victime de l'AT |
| EVT-10 | Synthèse imprimable de la DAT et feuille d'accident | P2 | M | Victime de l'AT |
| EVT-11 | Analyse des causes vidable ou méthode changeable après « Actions » | P2 | S | — |
| EVT-12 | Journal : analyse, méthode et réception des signalements terrain | P2 | S | — |
| EVT-13 | Filtres de la liste : blessure, étape, pilote, période, gravité, ancienneté | P2 | M | — |
| EVT-14 | Événements liés sur les fiches contrôle et document | P2 | M | — |
| EVT-15 | Échéances événement manquantes | P2 | M | — |
| EVT-16 | Clôture d'un événement réservée aux approbateurs ? | P2 | S | — |
| EVT-17 | Traitement des produits non conformes et coût de non-qualité | P2 | M | — |
| EVT-18 | Formulaire terrain : choix du site et QR code périmé | P2 | M | — |
| EVT-19 | Rattacher l'événement à sa zone et protéger les zones porteuses de QR | P2 | M | — |
| EVT-20 | Signalement installable (PWA) | P2 | M | HTTPS |
| EVT-21 | File d'attente hors ligne des signalements | P2 | L | PWA |
| EVT-22 | Espace salarié mobile (mes actions, mes habilitations) | P2 | L | Entra ID ; navigation mobile |
| EVT-23 | Formulaire événement : le champ Site propose des sites refusés | P3 | S | — |
| EVT-24 | « Nouvel événement » prérempli depuis contrôle, risque, document, environnement | P3 | S | — |
| EVT-25 | Fiche événement : action annulée ou clôturée ouverte en modification | P3 | S | — |
| EVT-26 | « Plan d'actions → » filtré sur l'événement | P3 | S | — |
| EVT-27 | Vue déclarant : photos et périmètre de /evenements | P3 | S | — |
| EVT-28 | Suivi d'un signalement anonyme par code | P3 | M | — |

- **EVT-01** — Ajouter victime (salarié, intérimaire, externe), heure, horaire, siège et nature des lésions, témoins, date de connaissance, réserves (Cerfa 14463), avec accès restreint. (preuve : src/db/schema.ts:73-107 ; src/components/events/EventEditButton.tsx:120-134)
  *Question : Quels champs tenir dans Vigie et qui peut lire les lésions ?*
- **EVT-02** — Un AT peut être clôturé sans cpamDeclaredOn et l'échéance sort alors des signaux. Bloquer dans advanceBlocker ou garder le signal. (preuve : src/lib/data/events.ts:324 ; src/components/events/shared.ts:16-39,49-53)
  *Question : Bloquer la clôture ou garder l'échéance visible ?*
- **EVT-03** — Le délai est occurredOn + 2 jours calendaires (R. 441-3 CSS non respecté). Ajouter aussi l'échéance des réserves motivées (10 jours francs). (preuve : src/lib/data/events.ts:117,325 ; src/lib/domain.ts:34 ; src/lib/dates.ts:19)
  *Question : Point de départ : date de l'accident ou createdAt ? Fériés Alsace-Moselle ?*
- **EVT-04** — Le libellé existe mais pas le registre (R. 441-3, D. 441-1 CSS) : vue imprimable par site, secouriste SST valide, bascule en déclaration si arrêt ultérieur. (preuve : src/lib/data/events.ts:113-115 ; src/components/events/shared.ts:55-56)
  *Question : Registre par site ou unique ? Visa de la victime dans Vigie ?*
- **EVT-05** — Seul le pilote est exigé : un AT sans blessure sort du TF1/TG, une NC sans origine tombe dans « Autre ». (preuve : src/components/events/shared.ts:22-24 ; src/server/events.ts:191-192 ; src/lib/data/dashboard.ts:35,58,77)
  *Question : Quels champs obligatoires à la qualification ?*
- **EVT-06** — /apercu-mobile crée de vrais événements avec DEMO_POST et un cadre iPhone même sur téléphone. Viser /signaler sur mobile et retirer le poste codé en dur. (preuve : src/app/(app)/apercu-mobile/page.tsx:17,40-46 ; src/components/PageHeader.tsx:18 ; src/app/(app)/page.tsx:125)
  *Question : Cible en production selon le rôle ?*
- **EVT-07** — createReport repose sur le cookie de démonstration. Choisir : Entra sur mobile, borne partagée ou formulaire public anonyme protégé. (preuve : src/server/events.ts:475-526 ; src/lib/session.ts:14-34 ; src/lib/domain.ts:272 ; src/app/signaler/page.tsx:13-19)
  *Question : Comment signalent intérimaires et entreprises extérieures ?*
- **EVT-08** — lostDays est saisi à la main et vaut 0 s'il manque. Gérer les périodes d'arrêt (prolongation, rechute, reprise), calculer TG, signaler visite de reprise (R. 4624-31) et pré-reprise. (preuve : src/server/events.ts:193 ; src/lib/data/dashboard.ts:40 ; src/components/events/EventEditButton.tsx:125-127)
  *Question : Dates d'arrêt saisies par la QHSE ou venues de la paie / Cursus ?*
- **EVT-09** — Ajouter les types MP (R. 461-9) et accident de trajet, ce dernier exclu du TF1/TG. (preuve : src/lib/domain.ts:14-23 ; src/lib/data/dashboard.ts:35-40)
- **EVT-10** — Vue d'impression navigateur des rubriques DAT pour net-entreprises et feuille d'accident (L. 441-5). (preuve : aucune occurrence de « Cerfa » ni de vue d'impression DAT dans src ; src/db/schema.ts:73-107)
- **EVT-11** — La règle n'est vérifiée qu'au passage à l'étape 3 : un événement peut être clôturé sans analyse. (preuve : src/components/events/shared.ts:25-28 ; src/server/events.ts:160-172,406-408)
- **EVT-12** — saveAnalysis, setAnalysisMethod et createReport n'écrivent pas de change_log (byId: null pour un anonyme). (preuve : src/server/events.ts:160-172,361-414,475-526 ; src/server/changelog.ts:33-34)
- **EVT-13** — La liste ne filtre que par onglet, type, origine et texte. (preuve : src/app/(app)/evenements/page.tsx:38-57)
- **EVT-14** — Un événement pointe vers un contrôle ou un document, mais ces fiches ne listent pas leurs événements (ni les actions clôturées du document). (preuve : src/lib/data/events.ts:61-86 ; src/lib/data/watch.ts:85-98 ; src/lib/data/documents.ts:156-158)
- **EVT-15** — Ajouter : délai d'analyse, pilote sorti de l'effectif, toutes actions clôturées sans passage à « Efficacité vérifiée », seule action annulée, action rouverte sur événement clos. (preuve : src/lib/data/events.ts:303-334 ; src/server/plan-ui.ts:24-30,98-130)
  *Question : Quels délais retenir ?*
- **EVT-16** — advanceEvent n'exige que requireManager alors que réouverture et classement exigent requireApprover. (preuve : src/server/events.ts:38-40,71-73,101-103)
  *Question : Qui valide la clôture ?*
- **EVT-17** — Ajouter décision de traitement (retouche, rebut, dérogation, retour), quantités et coût (ISO 9001 §8.7). (preuve : src/db/schema.ts:73-107)
- **EVT-18** — Sans QR, le site n'est pas modifiable (premier site sous « Tous ») ; un QR de zone supprimée vide le lieu sans message. (preuve : src/server/events.ts:498-499 ; src/components/ReportForm.tsx:215 ; src/app/signaler/page.tsx:18-19 ; src/lib/data/events.ts:284-292)
  *Question : Code de poste stable indépendant de l'id de zone ?*
- **EVT-19** — L'événement ne garde que le lieu en texte ; deleteZone invalide les QR imprimés sans avertir. Ajouter zoneId, archivage de zone, lien vers le QR. (preuve : src/db/schema.ts:79 ; src/server/sitemap.ts:109-123 ; src/components/sitemap/dialogs.tsx:58-63)
- **EVT-20** — Manifeste, icônes, service worker pour /signaler, zones sûres iOS. (preuve : src/app/layout.tsx:9-14 ; src/app/signaler/page.tsx:9 ; public/ (plans/ seulement))
- **EVT-21** — Brouillon IndexedDB renvoyé au retour du réseau, clé d'idempotence, date et heure réelles de l'événement. (preuve : src/components/ReportForm.tsx:169-180 ; src/server/events.ts:510)
  *Question : Ajouter date et heure au formulaire terrain ?*
- **EVT-22** — Le parcours terrain n'offre que Signaler et Mes signalements ; ajouter Démarrer / Déclarer réalisée avec photo et ses échéances. (preuve : src/app/signaler/ (page.tsx, mes-signalements/, postes/) ; src/server/plan-ui.ts:18-22)
- **EVT-23** — Tous les sites actifs sont listés alors que le serveur refuse tout autre site que le sélectionné. (preuve : src/components/events/EventEditButton.tsx:102-104 ; src/app/(app)/evenements/page.tsx:77,335 ; src/lib/guard.ts:32-37 ; src/server/events.ts:228-232)
- **EVT-24** — Seuls plan et permis préremplissent ; l'environnement renvoie vers /signaler?type=ENV. (preuve : src/lib/data/events.ts:340-356 ; src/app/(app)/environnement/page.tsx:278)
- **EVT-25** — Le clic ouvre le formulaire que le serveur refuse ensuite ; idem quand l'événement est verrouillé. (preuve : src/components/events/EventActions.tsx:31 ; src/app/(app)/evenements/page.tsx:342-345,402 ; src/server/plan.ts:51-52)
- **EVT-26** — Pointer vers /actions?q=&lt;référence> avec les clôturées. (preuve : src/components/events/EventActions.tsx:45 ; src/app/(app)/actions/page.tsx:55,75)
- **EVT-27** — Le détail mobile n'affiche que le nombre de photos ; /evenements filtre le Salarié par site alors que « Mes signalements » est tous sites. (preuve : src/components/events/MyReportDetail.tsx:92-97 ; src/app/(app)/evenements/page.tsx:50,244 ; src/lib/queries.ts:29-33)
- **EVT-28** — Code secret remis à l'envoi, ouvrant un détail en lecture sans identifier l'auteur. (preuve : src/components/ReportForm.tsx:192-193 ; src/lib/data/events.ts:209-213)
  *Question : Risque de ré-identification acceptable ?*

## 5. Plan d'actions (ACT)

16 éléments — P1 : 1 · P2 : 4 · P3 : 11 — charge indicative 12,5–33 j.

| Réf | Élément | Priorité | Taille | Dépend de |
|---|---|:-:|:-:|---|
| ACT-01 | Rattacher les actions Prévention, Documents et Environnement par un vrai lien | **P1** | L | Script de reprise par originRef |
| ACT-02 | Rattacher une action existante depuis toutes les sources | P2 | M | Rattachement par vrai lien |
| ACT-03 | Tracer les changements d'action faits par les autres modules | P2 | S | — |
| ACT-04 | Historique de l'action : tous les champs modifiés | P2 | S | — |
| ACT-05 | Motif obligatoire pour rouvrir une action clôturée | P2 | S | — |
| ACT-06 | Champ Site des « Nouvelle action » ouvertes depuis les autres écrans | P3 | S | — |
| ACT-07 | Sélecteur « Événement lié » : exclure les événements fermés aux actions | P3 | S | — |
| ACT-08 | Origine Risques ou Revue de direction : choisir la source à la création | P3 | S | — |
| ACT-09 | Report d'échéance motivé et échéance initiale conservée | P3 | M | Migration drizzle |
| ACT-10 | Date, auteur et commentaire de réalisation | P3 | M | Migration drizzle |
| ACT-11 | Fiabiliser saveAction (pilote, dates, longueurs) | P3 | S | — |
| ACT-12 | Action issue d'une coactivité sans plan : origine non cliquable | P3 | S | — |
| ACT-13 | Jugement « Efficacité insuffisante » et indépendance du vérificateur | P3 | S | — |
| ACT-14 | Vérifications d'efficacité hors des échéances du pilote salarié | P3 | S | — |
| ACT-15 | Filtre de statut et lien profond « en retard » | P3 | S | — |
| ACT-16 | Indicateurs de performance du plan d'actions | P3 | M | Date de réalisation ; échéance initiale |

- **ACT-01** — Ces écrans retrouvent leurs actions par originRef : modifier la référence, la date ou la filière d'un enlèvement détache l'action sans trace. Ajouter des types plan, permit, document, waste, stream au registre action-links et migrer. (preuve : src/lib/data/prevention.ts:372,383,453,516 ; src/server/prevention.ts:321,386 ; src/lib/data/environment.ts:142-145,238-239,314 ; src/lib/data/documents.ts:157 ; src/lib/action-links.ts:52-311 (type `plan` = programme d'audit, lignes 132-153) ; src/components/actions/ActionDetail.tsx:64-67 (originRef modifiable))
  *Question : Colonnes dédiées ou table action_links ? Origine verrouillée ?*
- **ACT-02** — Événement, habilitation, document, plan et permis n'ont pas LinkActionButton ; la fiche action ne permet pas d'ajouter ou détacher une source. (preuve : Utilisations de LinkActionButton limitées à src/components/watch/\*, review/ReviewPanel.tsx, audits/\*, risks/RiskSheet.tsx ; src/components/prevention/PlanDialogs.tsx:419-430 (liste sans « Rattacher ») ; src/components/actions/ActionDetail.tsx:137-153 (sources affichées, sans ajout ni détachement) ; src/lib/action-links.ts:230-263 (type qualification sans bouton))
- **ACT-03** — Le recyclage passe l'action en « verify » par UPDATE direct (date passée reprise) et la cascade de site d'un événement n'écrit rien : passer par applyActionStatus et logChange. (preuve : src/server/skills.ts:155-159 ; src/server/events.ts:306-310)
- **ACT-04** — diffFields ignore verifyDueOn, kind et description. (preuve : src/server/plan.ts:116-121)
- **ACT-05** — « Rouvrir » ne demande aucun motif. (preuve : src/components/actions/ActionDetail.tsx:267-270 ; src/server/plan-ui.ts:75-78 ; src/server/plan-core.ts:38-45)
- **ACT-06** — Seul /actions filtre les sites ; ailleurs l'utilisateur choisit un site que saveAction refuse. (preuve : src/server/plan.ts:72-81 ; src/components/ActionFormDialog.tsx:91-95 ; src/app/(app)/actions/page.tsx:63 (filtre seulement ici) ; options.sites complet passé par evenements/page.tsx:81, audits/page.tsx:28, veille/page.tsx:25, environnement/page.tsx:40, risques/page.tsx:140)
- **ACT-07** — La liste inclut l'étape « Efficacité vérifiée », refusée au rattachement. (preuve : src/lib/data/options.ts:37-39 ; src/components/events/shared.ts:6,42-46)
- **ACT-08** — Seules les origines événement ont un sélecteur ; une action « Risques » ou « Revue » n'est rattachée à aucun risque ni revue. (preuve : src/components/ActionFormDialog.tsx:41,63-78 ; src/lib/domain.ts:96 (EVENT_ORIGINS = ev, client))
- **ACT-09** — dueOn est écrasé librement, ce qui efface le retard. Ajouter un report avec motif, initial_due_on et le nombre de reports. (preuve : src/server/plan.ts:40,99,117,120 (échéance tracée seulement dans change_log) ; src/db/schema.ts:131-153 (pas d'initial_due_on ni de compteur de reports))
  *Question : Motif obligatoire et report réservé aux approbateurs ?*
- **ACT-10** — « Déclarer réalisée » ne stocke que la date de vérification prévue. (preuve : src/server/plan-core.ts:33-36 ; src/components/actions/ActionDetail.tsx:72-87 ; src/db/schema.ts:131-153 (ni done_on, ni done_by_id, ni done_note))
  *Question : Preuve obligatoire ?*
- **ACT-11** — Pilote non vérifié (erreur de clé étrangère, salarié sorti), date impossible acceptée, description sans maximum, vérification avant échéance. (preuve : src/server/plan.ts:37-42,99 ; src/lib/forms.ts:10,51-55)
- **ACT-12** — L'origine « Coactivité JJ/MM/AAAA » n'a pas de lien vers /prevention/carte. (preuve : src/components/sitemap/SiteMapScreen.tsx:232 ; src/lib/data/actions.ts:179-183,208-209 (repli vers /prevention) ; src/app/(app)/prevention/carte/page.tsx:27 (paramètre date))
- **ACT-13** — Les non-valideurs peuvent juger l'efficacité ; l'animateur peut vérifier sa propre action. (preuve : src/components/actions/ActionDetail.tsx:259-261 ; src/server/plan-ui.ts:25-29,55 ; src/server/plan-core.ts:28-31 ; src/lib/domain.ts:293-294)
  *Question : Jugement réservé aux approbateurs ?*
- **ACT-14** — Le pilote salarié reçoit une alerte urgente sur une vérification qu'il ne peut pas faire. (preuve : src/lib/data/actions.ts:302-307 ; src/lib/data/todo.ts (filtre isMine du Salarié dans loadVisibleTodo))
- **ACT-15** — Ajouter ?statut=, renvoyer vers l'historique quand le plan est vide, afficher la date de clôture en vue Liste. (preuve : src/app/(app)/actions/page.tsx:25-26,69-83,181-189,244 ; src/lib/data/dashboard.ts:68 (lien sans filtre retard))
- **ACT-16** — Taux à l'échéance, délai moyen, efficacité au premier contrôle, répartition par origine (ISO 9001 §9.3.2). (preuve : src/lib/data/dashboard.ts:68 (seul KPI action : retards) ; src/lib/data/review.ts:454-470 (répartition par origine déjà présente))

## 6. Prévention et carte du site (PRV)

20 éléments — P1 : 3 · P2 : 9 · P3 : 8 — charge indicative 22–65 j.

| Réf | Élément | Priorité | Taille | Dépend de |
|---|---|:-:|:-:|---|
| PRV-01 | Écarts R. 4512-6 passés non comptés | **P1** | M | — |
| PRV-02 | Contenu réglementaire du plan incomplet (R. 4512-8 et R. 4512-9) | **P1** | M | Migration drizzle |
| PRV-03 | Fiche imprimable d'un permis et registre par période | **P1** | S | — |
| PRV-04 | Traçabilité de la délivrance, de la check-list et de la clôture des permis | P2 | M | Migration drizzle |
| PRV-05 | Protocoles de sécurité de chargement et déchargement | P2 | M | — |
| PRV-06 | Inspection commune « préalable » acceptée après le début des travaux | P2 | S | — |
| PRV-07 | Signataires du plan et date de signature EU | P2 | S | Migration drizzle |
| PRV-08 | Intervenants des permis reliés au personnel et aux habilitations | P2 | M | Niveaux d'habilitation ; Cursus |
| PRV-09 | Dossier entreprise extérieure : pièces de vigilance, intervenants, accueil | P2 | L | Migration drizzle |
| PRV-10 | Situations de coactivité : état « maîtrisée » | P2 | M | — |
| PRV-11 | Cohérence plan, permis et activités après modification | P2 | S | — |
| PRV-12 | Carte du site : journal, annulation plutôt que suppression, sites archivés | P2 | M | — |
| PRV-13 | Cumul des heures d'une entreprise extérieure sur 12 mois | P3 | S | — |
| PRV-14 | Filtres projet et entreprise, accès direct à la fiche entreprise | P3 | S | — |
| PRV-15 | Permis complémentaires : consignation, espace confiné, hauteur, fouille | P3 | M | — |
| PRV-16 | Validité des permis : durée maximale et prolongation | P3 | S | — |
| PRV-17 | Interventions longues : inspections et réunions périodiques | P3 | M | — |
| PRV-18 | Signature à distance ou envoi du plan à l'entreprise extérieure | P3 | L | Messagerie ou signature électronique |
| PRV-19 | Échéances de coactivité sans personne concernée | P3 | S | — |
| PRV-20 | Plans de prévention reçus des clients | P3 | L | Keystone |

- **PRV-01** — Seules les interventions en cours sans plan signé comptent ; une intervention terminée sans signature ou signée après démarrage ne laisse pas d'écart. (preuve : src/components/prevention/model.ts:104-107 (isInProgress, lacksSignedPlan), 120-121 (planEndIssue) ; src/lib/data/prevention.ts:265, 609-614, 660-668, 697-699 ; src/server/prevention.ts:270-272 et 284-302 (signature acceptée après startOn))
  *Question : Écart passé dans le badge ou seulement dans les indicateurs ?*
- **PRV-02** — Manquent effectif EE, sous-traitants, secours et évacuation, instructions, phases dangereuses, matériels prêtés. (preuve : src/db/schema.ts:443-468 ; src/components/prevention/PlanDialogs.tsx:101-155 ; src/app/(app)/prevention/imprimer/plan/[id]/page.tsx:75-137 (formData non imprimé, alors que la fiche l'affiche en PlanDialogs.tsx:210-228))
  *Question : Champs structurés ou sections libres du modèle importé ?*
- **PRV-03** — Un permis délivré ne s'imprime pas pour affichage ; le registre ne filtre pas par mois ou année. (preuve : src/components/prevention/PermitDialogs.tsx:331-342 (aucun lien d'impression) ; src/app/(app)/prevention/imprimer/permis/page.tsx:21-25 (filtres état et type seulement))
- **PRV-04** — Ni date-heure de délivrance, ni acceptation, ni fin réelle, ni auteur de clôture ou de ronde ; check-list sans historique ; clôture possible avant la fin de surveillance. (preuve : src/server/prevention.ts:559-572 (setPermitCheck sans logChange), 642-656 (closePermit sans contrôle de watchUntil) ; src/db/schema.ts:483-501 (aucun champ acceptation ou ronde) ; déjà tracé : src/server/prevention.ts:600-603, 651-654 et src/components/prevention/PermitDialogs.tsx:409)
  *Question : Interdire la clôture avant la fin des 2 h de surveillance ?*
- **PRV-05** — Protocole écrit exigé pour les transporteurs (R. 4515-4 à 11), signé des deux parties, avec révision. (preuve : aucune occurrence de « protocole » ni de « R. 4515 » dans src/ ni dans design/Vigie.dc.html)
  *Question : Transporteurs gérés comme entreprises extérieures ?*
- **PRV-06** — Seule la fin de l'intervention borne la date de l'inspection commune préalable. (preuve : src/server/prevention.ts:158)
  *Question : Refus strict ou écart tracé ?*
- **PRV-07** — Signature EU forcée au jour, sans nom ni qualité des signataires ; l'impression affiche le responsable du plan. (preuve : src/server/prevention.ts:259-276, 279-310 ; src/app/(app)/prevention/imprimer/plan/[id]/page.tsx:137-140)
- **PRV-08** — performer est un texte libre : choisir les intervenants internes et contrôler leurs titres valides à la délivrance. (preuve : src/db/schema.ts:490 ; src/components/prevention/PermitDialogs.tsx:166-168 ; src/server/prevention.ts:470 ; src/components/prevention/model.ts:152)
  *Question : Quels titres par type de permis ?*
- **PRV-09** — Ajouter assurance, attestation URSSAF (D. 8222-5), Kbis avec échéances, intervenants avec accueil sécurité, signaux d'expiration. (preuve : src/db/schema.ts:430-441 ; src/components/prevention/ContractorDialogs.tsx:62-68)
  *Question : Vigilance suivie par les achats ?*
- **PRV-10** — Une situation reste signalée après action ou report au plan, et des actions en double sont possibles. (preuve : src/lib/data/sitemap.ts:292-334 ; src/components/sitemap/SiteMapScreen.tsx:225-239 (originRef sans clé de situation), 637-638 ; src/server/sitemap.ts:392)
- **PRV-11** — savePlan ne contrôle pas les activités liées ; saveActivity accepte un permis clos ou hors période. (preuve : src/server/prevention.ts:181-197 ; src/server/sitemap.ts:256-259)
- **PRV-12** — 11 mutations sur 12 sans logChange, activités supprimées physiquement, création acceptée sur un site archivé (pas de requireInSite). (preuve : src/server/sitemap.ts:67-75, 80-368 (aucun logChange hors 399), 110-123, 291-300 ; src/lib/guard.ts:32-37 (requireInSite non utilisé))
- **PRV-13** — Le seuil de 400 h est évalué plan par plan. (preuve : src/components/prevention/model.ts:71 ; src/components/prevention/PlanDialogs.tsx:113-114 (saisie manuelle « Total estimé »))
  *Question : Par opération ou cumul ?*
- **PRV-14** — Plans filtrés par phase seulement ; nom d'entreprise non cliquable. (preuve : src/app/(app)/prevention/page.tsx:61-64 ; src/components/prevention/PlanDialogs.tsx:337 ; src/components/prevention/PermitDialogs.tsx:372)
- **PRV-15** — Seuls permis de feu et d'essai existent. (preuve : src/components/prevention/model.ts:137-169)
  *Question : Permis prévus par PR-QHSE-005 ?*
- **PRV-16** — Aucune durée maximale ; un permis délivré ne se prolonge pas. (preuve : src/server/prevention.ts:481-493, 505)
- **PRV-17** — Un contrat annuel n'a qu'une inspection préalable. (preuve : src/db/schema.ts:455)
- **PRV-18** — La signature EE est saisie en interne. (preuve : src/server/prevention.ts:279-310 ; design/Vigie.dc.html:778)
- **PRV-19** — Les échéances de coactivité n'ont ni who ni ownerIds. (preuve : src/lib/data/sitemap.ts:321-330 ; src/lib/domain.ts:334)
- **PRV-20** — Les interventions EPC2i chez les clients ne sont pas suivies. (preuve : src/db/schema.ts:443-447)
  *Question : À suivre dans Vigie ?*

## 7. Risques / DUERP (DUE)

20 éléments — P1 : 2 · P2 : 9 · P3 : 9 — charge indicative 19–54 j.

| Réf | Élément | Priorité | Taille | Dépend de |
|---|---|:-:|:-:|---|
| DUE-01 | Mise à disposition du DUERP aux salariés, anciens salariés et instances | **P1** | M | — |
| DUE-02 | PAPRIPACT : programme annuel de prévention | **P1** | L | Suivi des consultations CSE |
| DUE-03 | Transmission de chaque version au SPST et dépôt sur le portail | P2 | S | Migration drizzle |
| DUE-04 | Annulation d'une action : détachement absent de l'historique du risque | P2 | S | — |
| DUE-05 | Unités sur un site archivé déplacées en silence | P2 | S | — |
| DUE-06 | Historique des unités en vigueur et des versions jamais affiché | P2 | S | — |
| DUE-07 | Réévaluation après accident et mise à jour du DUERP déclenchée | P2 | M | — |
| DUE-08 | Facteurs de pénibilité et effectifs exposés | P2 | M | Effectifs (Cursus) |
| DUE-09 | Pièces jointes : DUERP signé par version et justificatifs des risques | P2 | M | — |
| DUE-10 | Contenu d'une version figé à la validation | P2 | M | — |
| DUE-11 | Vue imprimable du document unique | P2 | M | — |
| DUE-12 | Rattachement non tracé entre deux risques au même danger | P3 | S | — |
| DUE-13 | Unités homonymes indiscernables sous « Tous les sites » | P3 | S | — |
| DUE-14 | Déplacement d'un risque : rang et site des actions | P3 | S | — |
| DUE-15 | Validateur sorti de l'effectif | P3 | S | — |
| DUE-16 | Matrice G × P accessible et filtrante | P3 | S | — |
| DUE-17 | Vue d'ensemble du DUERP toutes unités | P3 | M | — |
| DUE-18 | Suggestions de familles de dangers | P3 | S | — |
| DUE-19 | Mesures liées aux contrôles, documents et habilitations | P3 | L | — |
| DUE-20 | Unités de travail reliées aux zones du plan de site | P3 | M | — |

- **DUE-01** — Salarié et Chef de projet n'ont aucun accès (R. 4121-4). Consultation en lecture et vue imprimable de la version en vigueur, trace des mises à disposition. (preuve : src/lib/domain.ts:268-269 ; src/app/(app)/risques/page.tsx:21 ; src/app/(app)/risques/export/route.ts:26-27 ; src/db/seed.ts:187 (exigence « mise à disposition des salariés et du CSE » marquée conforme))
  *Question : Tout le DUERP ou l'unité du salarié ?*
- **DUE-02** — Construire le programme (L. 4121-3-1) à partir des actions rattachées aux risques, avec coût, ressources, indicateur, figé par année avec la consultation CSE. (preuve : src/db/schema.ts:131-153 (actions : ni coût, ni ressources, ni indicateur) ; src/db/schema.ts:200-203 (risk_actions) ; src/db/schema.ts:157-168 (duerp_versions sans programme rattaché))
  *Question : Champs coût et ressources sur toutes les actions ?*
- **DUE-03** — Ajouter date de transmission SPST, échéance associée, et emplacement pour le futur dépôt numérique. (preuve : src/db/schema.ts:157-168 ; src/lib/data/risks.ts:498-500 ; src/components/risks/VersionDialogs.tsx:200-215 (formulaire de version sans transmission SPST))
- **DUE-04** — detachAllLinks n'appelle pas logAs ; l'état « Annulée » de la fiche n'est jamais atteint. (preuve : src/server/plan-ui.ts:116-124 ; src/lib/action-links.ts:92-94,346-354 ; src/components/risks/RiskSheet.tsx:172-176 (affichage « Annulée » inatteignable))
  *Question : Garder l'action annulée grisée ?*
- **DUE-05** — Le Select omet le site archivé et enregistre le premier actif ; la restauration accepte un site archivé. (preuve : src/components/risks/UnitDialogs.tsx:38,48-49,105 ; src/lib/data/options.ts:34 ; src/server/risks.ts:257-258,335 ; src/server/sites.ts:80-90)
- **DUE-06** — Ajouter ChangeLogList dans l'éditeur d'unité et « Versions du DUERP ». (preuve : src/lib/data/risks.ts:319-322 ; src/components/risks/UnitDialogs.tsx:81-130 ; src/components/risks/VersionDialogs.tsx (aucun ChangeLogList) ; src/server/risks.ts:432-435,468-475 (journalisé mais jamais affiché))
- **DUE-07** — Aucun signal quand un AT/PA est rattaché à un risque ou révèle un risque nouveau (R. 4121-2), ni trace « réévalué suite à EV-… ». (preuve : src/lib/data/risks.ts:241-247,482-520 ; src/app/(app)/evenements/page.tsx:306 ; src/server/risks.ts:114-118)
  *Question : Seuil de gravité imposant une nouvelle version ?*
- **DUE-08** — Ajouter effectif par unité et exposition par facteur au-delà des seuils (R. 4121-1-1). (preuve : src/db/schema.ts:170-198)
- **DUE-09** — Types 'duerp_version' et 'risk' absents des pièces jointes et de /fichiers. (preuve : src/lib/uploads.ts:75-111 ; src/db/schema.ts:58-59 ; src/components/risks/VersionDialogs.tsx:102-116)
- **DUE-10** — L'instantané est pris à la création de N+1 et ne garde que les identifiants d'actions. (preuve : src/server/risks.ts:420-425 ; src/lib/data/risks.ts:35,392,398-402)
  *Question : État au jour de la validation ou de l'archivage ?*
- **DUE-11** — Le DUERP ne sort qu'en CSV : page de garde, unités, cotations, plan d'actions, y compris versions archivées. (preuve : src/components/risks/ExportMenu.tsx:19-22 ; src/app/(app)/prevention/imprimer/print.css (modèle existant))
- **DUE-12** — linkAction compare les libellés « Unité · Danger » et non l'identifiant du risque. (preuve : src/server/links.ts:36,48-54,70-76 ; src/lib/action-links.ts:103)
- **DUE-13** — Sous « Tous les sites », deux unités homonymes sont indiscernables : afficher le site sous le libellé. (preuve : src/app/(app)/risques/page.tsx:110-113,166 ; src/server/risks.ts:261)
- **DUE-14** — saveRisk garde le rang et ne revérifie pas le site des actions liées. (preuve : src/server/risks.ts:92-108,126,172-179 ; src/server/links.ts:43)
- **DUE-15** — Le formulaire impose de réécrire le validateur historique. (preuve : src/components/risks/VersionDialogs.tsx:206-208 ; src/lib/data/options.ts:33 ; src/server/risks.ts:383 ; modèle : src/components/ActionFormDialog.tsx:50-52)
- **DUE-16** — Grille de div sans libellé ; lignes sans rôle. (preuve : src/app/(app)/risques/page.tsx:44-53,153-157 ; src/components/risks/RiskTable.tsx:22-28,61)
- **DUE-17** — Vue toutes unités : matrice globale, risques prioritaires, résiduels ≥ 8. (preuve : src/app/(app)/risques/page.tsx:37-62)
- **DUE-18** — Datalist inspirée INRS pour homogénéiser les libellés. (preuve : src/components/risks/RiskForm.tsx:65-67,80-82)
- **DUE-19** — Alerter quand une mesure de maîtrise liée n'est plus valide. (preuve : src/db/schema.ts:188 ; src/components/risks/RiskForm.tsx:80-82)
- **DUE-20** — Rattacher une zone à l'unité et proposer ses risques au signalement par QR. (preuve : src/db/schema.ts:170-178,589-596 ; src/app/signaler/page.tsx:11-17)

## 8. Habilitations et formations (HAB)

20 éléments — P1 : 1 · P2 : 9 · P3 : 10 — charge indicative 22–65 j.

| Réf | Élément | Priorité | Taille | Dépend de |
|---|---|:-:|:-:|---|
| HAB-01 | Contrôle des fichiers côté navigateur dans « Enregistrer une formation » | **P1** | S | — |
| HAB-02 | Suivi de l'état de santé au travail : VIP, SIR, aptitude, reprise | P2 | L | Cursus |
| HAB-03 | Journal des habilitations : compléter et afficher | P2 | M | — |
| HAB-04 | Les anciens recyclages perdent leur lien vers l'habilitation | P2 | M | — |
| HAB-05 | Sortie d'un salarié : responsabilités ouvertes et échéances postérieures | P2 | M | — |
| HAB-06 | Session de formation collective et recyclage groupé | P2 | L | — |
| HAB-07 | Exigences par poste ou par activité | P2 | L | Arbitrage (hors périmètre précédemment) |
| HAB-08 | Date d'entrée, contrat et formation sécurité à l'embauche | P2 | M | Cursus |
| HAB-09 | Prévision des recyclages à 12 mois et plan de formation | P2 | M | — |
| HAB-10 | Niveaux, catégories CACES et prérequis entre titres | P2 | M | — |
| HAB-11 | Vue Salarié : lien mort vers l'action de recyclage | P3 | S | — |
| HAB-12 | Droits sur les titres suivis communs à tous les sites | P3 | S | — |
| HAB-13 | Efficacité des formations et sensibilisation (ISO §7.2-7.3) | P3 | M | — |
| HAB-14 | Vue Salarié : habilitations filtrées par le site | P3 | S | — |
| HAB-15 | Réordonnancement des titres suivis | P3 | S | — |
| HAB-16 | Matrice : filtre par titre, site visible, colonne figée | P3 | S | — |
| HAB-17 | Lien profond : filtres mémorisés écrasés et messages imprécis | P3 | S | — |
| HAB-18 | Indicateurs de compétences dans la revue | P3 | S | — |
| HAB-19 | Vue Salarié : titres archivés et dépôt de son attestation | P3 | M | — |
| HAB-20 | Jeunes travailleurs : dérogation aux travaux réglementés | P3 | M | Cursus |

- **HAB-01** — Au-delà de 11 Mo la server action plante ; réutiliser checkPickedFiles. (preuve : src/components/skills/TrainingForm.tsx:115-117 (Input sans contrôle, consigne « 10 Mo par fichier ») ; src/components/watch/parts.tsx:15-24 (checkPickedFiles, FILES_HINT) ; next.config.ts:6 (bodySizeLimit 11mb) ; src/server/skills.ts:52-56,112 (checkFiles jamais atteint au-delà de la limite) ; src/components/form.tsx:32-38 (useActionState sans repli))
- **HAB-02** — Dates des visites sans contenu médical (R. 4624-10 à 31) avec échéances. (preuve : src/db/schema.ts:24-39 (people : name, job, siteId, service, leftOn, aucune donnée de suivi de santé) ; aucune occurrence de visite ou aptitude dans src/ ; CLAUDE.md « Cursus, propriétaire des données personnelles des employés »)
  *Question : Tenu dans Cursus ou dans Vigie ?*
- **HAB-03** — setRequirement et les attestations ne sont pas tracés ; l'historique écrit n'est affiché nulle part ; qualification sans logAs. (preuve : src/server/skills.ts:195-231 (attestations sans logChange), 237-265 (setRequirement sans logChange), 293-296 (« Fiche salarié modifiée » sans details) ; src/lib/action-links.ts:230-263 (qualification sans logAs, à comparer aux lignes 99, 123, 147) ; src/components/skills/SkillMatrix.tsx:188 (HistoryTable seul, aucun ChangeLogList))
- **HAB-04** — Le seul champ renewalActionId est écrasé ou supprimé. (preuve : src/db/schema.ts:297-301 (un seul renewalActionId) ; src/lib/action-links.ts:232-261 (attach écrase, detach/detachAll remettent à null, sources lit le seul champ courant) ; src/server/skills.ts:261 (delete de l'exigence) ; src/lib/data/skills.ts:128-129 (actions clôturées ignorées))
- **HAB-05** — Seuls les recyclages ouverts sont vérifiés ; réintégration possible sur site archivé. (preuve : src/server/skills.ts:332-333 (seul openRenewals est vérifié), 343-358 (reinstatePerson sans contrôle de site actif) ; src/lib/guard.ts:32-37 ; src/lib/data/skills.ts:165-170 (leavingOn conservé, aucune borne de date), 259-285 (signaux sans comparaison à leftOn) ; src/lib/data/options.ts:33 (seules les listes de choix excluent les sortis))
  *Question : Bloquer ou réaffecter en masse ?*
- **HAB-06** — Saisie multi-salariés et action partagée (A-205). (preuve : src/components/skills/TrainingForm.tsx:92-100 (un seul personId et titleId) ; src/components/skills/SkillMatrix.tsx:190-205 (Planifier crée une action par case, pas de LinkActionButton) ; src/db/seed.ts:89 (A-205 collective) ; src/lib/action-links.ts:232-245)
- **HAB-07** — Exigences case par case et alerte d'affectation sur tous les titres requis. (preuve : src/server/skills.ts:237-265 (exigence par case), 268-310 (savePerson sans exigences par défaut) ; src/lib/data/skills.ts:198-206 (lapses sur toutes les cases requises) ; src/components/skills/rules.ts:24-30 ; src/db/schema.ts:321-328 (activity en texte libre))
- **HAB-08** — Ajouter date d'entrée, type de contrat, poste à risques ; générer l'accueil sécurité (L. 4141-2) et la formation renforcée CDD/intérim (L. 4154-2). (preuve : src/db/schema.ts:24-39 (pas de date d'entrée ni de contrat) ; src/db/seed.ts:28 (« Monteur · arrivé le 28/09 » dans job), 233 (titre accueil), 290 (constat intérimaires) ; src/server/skills.ts:300-309 (création sans exigence))
- **HAB-09** — Vue « À prévoir » par mois et titre. (preuve : src/lib/domain.ts:152 (SKILL_SOON_DAYS = 60), 312 (TODO_HORIZON_DAYS = 15) ; src/components/skills/rules.ts:50-56 (renewalDue limité au besoin immédiat) ; src/lib/queries.ts:70-76)
- **HAB-10** — Autorisation de conduite conditionnée au CACES et à l'aptitude (R. 4323-56). (preuve : src/db/schema.ts:286-301 (pas de niveau, catégorie ni prérequis) ; src/db/seed.ts:233-234 (elec, r484, r489, conduite indépendants) ; src/lib/queries.ts:70-76 (état calculé sans dépendance))
- **HAB-11** — L'action est pilotée par la QHSE, invisible au Salarié. (preuve : src/components/skills/common.tsx:16,41 (pilote = QHSE_LEAD), 90 et 101 (liens /actions?action=) ; src/components/skills/SkillMatrix.tsx:160 ; src/components/skills/SkillAlerts.tsx:78,116 ; src/lib/data/actions.ts:252-265 (Salarié non pilote : action introuvable))
- **HAB-12** — Un chef de service peut renommer ou archiver un titre utilisé par tous les sites. (preuve : src/server/skills.ts:42-46 (requireSkillsEditor), 361-435 (saveTitle, archiveTitle, restoreTitle sans requireApprover) ; src/lib/domain.ts:267 (Chef de service avec skills modifiable), 298-299 (canEdit) ; src/db/schema.ts:286-295 (pas de siteId))
- **HAB-13** — Évaluation à froid des formations. (preuve : src/db/schema.ts:305-318 (qualifications sans champ d'évaluation) ; src/server/skills.ts:157-158 (seule l'action de recyclage passe à 'verify') ; src/db/schema.ts:144-145 (efficacyNote sur actions uniquement))
- **HAB-14** — La vue Salarié est filtrée par le site sélectionné : ignorer ce filtre pour lui. (preuve : src/lib/data/skills.ts:160 (filtre de site), 233-234 (restriction Salarié après ce filtre), 253 et 286 (signaux eux aussi filtrés par site) ; src/app/(app)/layout.tsx:8,18 (siteOptions pour tous les rôles))
- **HAB-15** — Ordre des colonnes = ordre de création. (preuve : src/components/skills/TitlesManager.tsx:100-111 (Modifier et Archiver seulement) ; src/server/skills.ts:387-389 (sort = max + 1) ; src/lib/data/skills.ts:109 (orderBy sort))
- **HAB-16** — Manquent filtre titre et site ; colonne Salarié non sticky. (preuve : src/components/skills/SkillMatrix.tsx:317-329 (filtres sans titre), 396-401 (overflowX, minWidth 880, th Salarié non sticky), 414-419 (méta sans site) ; src/app/vigie.css:30 (seul sticky))
- **HAB-17** — Un lien profond écrase les filtres mémorisés (writeFilter) ; un titre archivé est ignoré sans message. (preuve : src/components/skills/SkillMatrix.tsx:296-298 (writeFilter persistant) ; src/app/(app)/habilitations/page.tsx:38-41 (titre archivé ignoré sans message), 49 (message regroupé))
- **HAB-18** — Ajouter à la revue : taux de conformité, formations sur 12 mois, recyclages en retard. (preuve : src/lib/data/review.ts:547-559 (skillCounts et skillAlerts seuls) ; src/components/review/DossierView.tsx:523-535)
- **HAB-19** — Archive transmise mais non affichée ; pas de dépôt avec validation. (preuve : src/lib/data/skills.ts:234 (archive filtrée et transmise) ; src/components/skills/SkillMatrix.tsx:177 (canAdd={canManage}), 280 et 394 (puce Sortis exclue pour self), 353-369 (TitlesButton sous !self))
- **HAB-20** — Suivre la déclaration de dérogation, valable 3 ans (R. 4153-40). (preuve : src/db/schema.ts:24-39 (people sans date de naissance ni statut) ; aucune table de déclaration de dérogation dans src/db/schema.ts)

## 9. Veille et contrôles (VEI)

18 éléments — P1 : 2 · P2 : 9 · P3 : 7 — charge indicative 13–34 j.

| Réf | Élément | Priorité | Taille | Dépend de |
|---|---|:-:|:-:|---|
| VEI-01 | Pilote, responsable ou site effacés en silence | **P1** | S | — |
| VEI-02 | Réserves sans action de levée absentes des échéances | **P1** | S | — |
| VEI-03 | Échéance figée d'une exigence suivie par des contrôles | P2 | S | — |
| VEI-04 | Rattachements d'actions absents du journal des exigences et contrôles | P2 | S | — |
| VEI-05 | Écart ou réserve dont l'action est clôturée : relancer pour boucler | P2 | M | — |
| VEI-06 | Exigence jugée sur le seul site sélectionné | P2 | S | — |
| VEI-07 | Rattachement explicite d'une exigence à un indicateur (linkedTo) | P2 | S | — |
| VEI-08 | Pièces jointes à compléter ou retirer après coup | P2 | S | — |
| VEI-09 | Modifier « Dernier contrôle » contourne l'historique | P2 | S | — |
| VEI-10 | Applicabilité par site et référence du texte | P2 | M | — |
| VEI-11 | Résultat du contrôle réalisé | P2 | M | — |
| VEI-12 | Indicateurs calculés : registre des déchets et certification ISO 9001 | P3 | M | linkedTo éditable |
| VEI-13 | Filtres, recherche et tri | P3 | M | — |
| VEI-14 | Métrologie : étalonnage des équipements de mesure | P3 | M | — |
| VEI-15 | Registre de sécurité consolidé et observations des organismes | P3 | M | — |
| VEI-16 | Annulation d'une évaluation saisie par erreur | P3 | S | — |
| VEI-17 | Projets Keystone concernés : rattachement et critère | P3 | M | Connecteur Keystone |
| VEI-18 | Périodicité de réévaluation propre à chaque exigence | P3 | S | — |

- **VEI-01** — Sans withCurrent, l'enregistrement efface pilote sorti ou site archivé. (preuve : src/app/(app)/veille/page.tsx:25 ; src/lib/data/options.ts:33-34,49-50 ; src/components/watch/RequirementsPanel.tsx:442 ; src/components/watch/ControlsPanel.tsx:378,406,411 ; src/server/watch.ts:257,271-273)
- **VEI-02** — Une réserve sans action de levée n'a ni signal ni badge ; proposer aussi « Créer une action » sur un contrôle dépassé sans réserve. (preuve : src/lib/data/watch.ts:264-272,303-304 ; src/components/watch/ControlsPanel.tsx:109-110,255)
- **VEI-03** — L'échéance d'une exigence suivie par des contrôles est figée : la calculer depuis le prochain contrôle rattaché. (preuve : src/lib/data/watch.ts:148-151,155,160,282,287-290 ; src/db/seed.ts:188,423)
- **VEI-04** — requirement et control sans logAs ; détachements de recordControl non tracés. (preuve : src/lib/action-links.ts:155-201 (pas de logAs, cf. 99,123,147) ; src/server/links.ts:52-53,74-75 ; src/server/plan.ts:139-140 ; src/server/watch.ts:326,334,358,447,452)
- **VEI-05** — L'action clôturée laisse l'écart ou la réserve ouvert : proposer « Réévaluer » et « Lever les réserves », avec un signal. (preuve : src/lib/data/watch.ts:166,283-284 ; src/components/watch/RequirementsPanel.tsx:354-367 ; src/components/watch/ControlsPanel.tsx:258-271)
- **VEI-06** — Contrôles et indicateurs filtrés par site alors que l'exigence vaut pour l'entreprise. (preuve : src/lib/data/watch.ts:99-105,148,152,171 ; src/lib/data/prevention.ts:660-668)
- **VEI-07** — Lien par texte du domaine ou regex ; ajouter un Select. (preuve : src/server/watch.ts:95 ; src/db/seed.ts:411 ; src/lib/data/watch.ts:101-104 ; src/lib/data/environment.ts:104,196-200)
- **VEI-08** — Ajout après saisie impossible ; preuve d'évaluation non retirable. (preuve : src/server/watch.ts:460-479 ; src/components/watch/ControlsPanel.tsx:344-345,466-468 ; src/components/watch/RequirementsPanel.tsx:341)
- **VEI-09** — Modifier « Dernier contrôle » met la date à jour directement, sans contrôle enregistré ni détachement des actions. (preuve : src/server/watch.ts:282-288 (cf. 326) ; src/components/watch/ControlsPanel.tsx:413-422 ; src/lib/data/watch.ts:214-215)
- **VEI-10** — Ajouter à l'exigence les sites concernés, l'URL Légifrance et la pièce du texte. (preuve : src/db/schema.ts:207-230 ; src/lib/data/watch.ts:260,275)
- **VEI-11** — Saisir le résultat du contrôle : favorable, avec réserves, défavorable, mise à l'arrêt. (preuve : src/db/schema.ts:253-271 ; src/lib/queries.ts:63-68 ; src/server/watch.ts:307-336)
- **VEI-12** — BSD manquants et état de certification dans indicatorOf. (preuve : src/lib/data/watch.ts:101-104 ; src/lib/data/environment.ts:196-200,322-337)
- **VEI-13** — Filtres par évaluation, domaine, pilote et responsable ; tri par échéance. (preuve : src/app/(app)/veille/page.tsx:46-49,103-108 ; src/lib/data/watch.ts:91-92)
- **VEI-14** — Catégorie métrologie, hors tolérance ouvrant une NC. (preuve : src/db/schema.ts:232-271)
- **VEI-15** — Registre imprimable par site (L. 4711-1) et mises en demeure. (preuve : src/db/schema.ts:232-271 (notes l. 259) ; src/components/watch/ControlsPanel.tsx:299-364 ; src/app/vigie.css:190-192)
- **VEI-16** — Annuler une évaluation saisie par erreur, avec motif, et recalculer l'évaluation courante. (preuve : src/db/schema.ts:274-282 ; src/server/watch.ts:131-180)
- **VEI-17** — Table requirement_projects et critère plus fin. (preuve : src/lib/data/watch.ts:66-73 ; src/components/watch/RequirementsPanel.tsx:312-315 ; src/db/schema.ts:220-222)
- **VEI-18** — Une seule constante de 12 mois pour toutes les exigences. (preuve : src/lib/domain.ts:142 ; src/lib/data/watch.ts:154,292 ; src/db/schema.ts:207-230)

## 10. Audits et revue de direction (AUD)

36 éléments — P1 : 6 · P2 : 11 · P3 : 19 — charge indicative 28,5–77 j.

| Réf | Élément | Priorité | Taille | Dépend de |
|---|---|:-:|:-:|---|
| AUD-01 | Lier programme d'audit et revues de direction par reviewId | **P1** | M | Migration drizzle |
| AUD-02 | Accès en lecture aux audits pour leurs responsables | **P1** | S | — |
| AUD-03 | Reporter ou annuler un élément du programme | **P1** | M | Migration drizzle |
| AUD-04 | Contributeurs de revue sans accès à l'écran Audits | **P1** | M | — |
| AUD-05 | Section 1 du dossier : décisions sans action et actions annulées | **P1** | S | — |
| AUD-06 | Dossier figé calculé à la clôture, pas à la séance | **P1** | M | — |
| AUD-07 | Supprimer le libellé d'audit codé en dur | P2 | S | — |
| AUD-08 | Cycle de certification : renouvellement, suspension, historique | P2 | M | — |
| AUD-09 | Types de constat : écart majeur, observation, délai de réponse | P2 | M | — |
| AUD-10 | Journaliser les changements du programme faits par la revue | P2 | S | — |
| AUD-11 | Contrôles de saisie des constats | P2 | S | — |
| AUD-12 | Rattacher une action d'une autre revue la déplace | P2 | S | — |
| AUD-13 | Objectifs QHSE mesurables reliés aux indicateurs | P2 | L | — |
| AUD-14 | Contrôles avant clôture et visa | P2 | S | — |
| AUD-15 | Visa de la direction possible par l'animateur QHSE | P2 | S | — |
| AUD-16 | Échéances : décisions sans suite, prochaine revue non planifiée | P2 | S | — |
| AUD-17 | Pièces jointes de la revue | P2 | M | — |
| AUD-18 | Compléter les échéances du programme | P3 | S | — |
| AUD-19 | Lien profond vers un référentiel | P3 | S | — |
| AUD-20 | Audits hors programme en vrais audits | P3 | M | — |
| AUD-21 | Plusieurs éléments par ligne et par mois | P3 | M | — |
| AUD-22 | Rattacher programme, constats et certifications à un site | P3 | M | Migration drizzle |
| AUD-23 | Règle « revue de direction » trop large | P3 | S | — |
| AUD-24 | Gestion des lignes et reconduction annuelle | P3 | M | — |
| AUD-25 | Rétablir un constat annulé | P3 | S | — |
| AUD-26 | Impression du programme annuel | P3 | S | — |
| AUD-27 | Auditeur interne lié à une personne | P3 | M | — |
| AUD-28 | Plusieurs actions par constat | P3 | M | — |
| AUD-29 | Liste des constats : filtres et audits sans constat | P3 | S | — |
| AUD-30 | Revue annulée : échéance du programme | P3 | S | Lien reviewId |
| AUD-31 | Contrôles de dates et de doublons | P3 | S | — |
| AUD-32 | Archiver les enregistrements figés en PDF et dans Documents maîtrisés | P3 | M | Arbitrage exports |
| AUD-33 | Constats des audits fournisseurs dans la section Fournisseurs | P3 | S | — |
| AUD-34 | Rectificatif d'une revue clôturée | P3 | M | — |
| AUD-35 | Carte de revue : perception client et ressources | P3 | S | — |
| AUD-36 | Décision de revue abandonnée ou reformulée après la séance : statut, motif, ancien libellé | P3 | M | Migration drizzle |

- **AUD-01** — Lien par égalité de dates ; verrouiller les cellules de revue et ajouter « Ouvrir la revue ». (preuve : src/server/review.ts:66-81 (planItemsOf par plannedOn, ensurePlanItem sans lien si le mois est pris) ; src/server/review.ts:96-103,229-232 ; src/lib/data/audits.ts:252,262 (pendingReviews par date) ; src/components/audits/ProgramTimeline.tsx:113-117,194-292 (élément de revue modifiable comme un audit, sans lien vers la revue) ; src/db/schema.ts:346-361 (pas de reviewId))
- **AUD-02** — Chef de service et de projet sans écran Audits ; utiliser canEdit. (preuve : src/lib/domain.ts:267-268 ; src/app/(app)/audits/page.tsx:17,24 (guard puis canManage au lieu de canEdit) ; src/server/audits.ts:27-31 (canSee seulement) ; src/lib/data/todo.ts:34 (échéances filtrées par canOpen) ; src/db/seed.ts:263-267 (responsables E. Dubois et S. Benali))
- **AUD-03** — Seule la suppression existe ; année non modifiable. (preuve : src/components/audits/ProgramTimeline.tsx:138-141,211 (DeleteButton seul, year en champ caché) ; src/server/audits.ts:283-306 (delete physique, refus si action, constat ou rapport) ; src/lib/data/audits.ts:73-74,261-264 (état « late » permanent))
- **AUD-04** — Les contributeurs sans accès à l'écran Audits ne peuvent pas contribuer : vue « Mes contributions » et lecture du compte rendu. (preuve : src/lib/data/review.ts:624-625,637-645 ; src/server/review.ts:27-31,314-316 ; src/db/seed.ts:299,304,306)
- **AUD-05** — Le suivi des revues précédentes omet les décisions sans action et les actions annulées : ISO 9001 §9.3.2 a incomplet. (preuve : src/lib/data/review.ts:194,356-361 ; src/lib/queries.ts:45 ; src/lib/data/review.ts:200 (seules les décisions de la revue courante sont lues))
- **AUD-06** — L'instantané calcule la période et les indicateurs à la date de clôture, pas à la date de la séance. (preuve : src/lib/data/review.ts:301-302 ; src/server/review.ts:268-273 ; src/lib/domain.ts:230)
- **AUD-07** — DEFAULT_AUDIT préremplit le libellé d'audit des constats. (preuve : src/lib/data/audits.ts:65 ; src/app/(app)/audits/page.tsx:11,48 ; src/components/audits/FindingsCard.tsx:138,237)
- **AUD-08** — Échéance de certification visible à 15 j seulement ; ni cycle de 3 ans, ni renouvellement, ni suspension, ni historique. (preuve : src/lib/data/audits.ts:283-288 ; src/lib/domain.ts:182,312 (CERT_SOON_DAYS = 30, TODO_HORIZON_DAYS = 15) ; src/lib/queries.ts:140-148 ; src/db/schema.ts:332-343)
- **AUD-09** — Trois types seulement (écart mineur, piste, point fort) : ajouter écart majeur, observation et délai de réponse. (preuve : src/lib/domain.ts:161-165 ; src/db/schema.ts:369 (kind : ecart_mineur | piste | point_fort) ; src/lib/data/audits.ts:271-274)
- **AUD-10** — ensurePlanItem et moveReview sans logChange. (preuve : src/server/review.ts:71-81,96-103,232)
- **AUD-11** — Constat accepté sur un audit futur ; la date « Réalisé le » est perdue si la case n'est pas cochée. (preuve : src/server/audits.ts:224 (doneOn null si non coché) ; src/server/audits.ts:327,337-341 (aucun contrôle item.done, foundOn ??= plannedOn))
- **AUD-12** — Rattacher une action déjà liée à une autre revue réécrit son reviewId sans contrôle. (preuve : src/lib/action-links.ts:265-271,285-296)
- **AUD-13** — TF1_TARGET constant ; objectifs de revue en texte libre (ISO §6.2, §9.1). (preuve : src/lib/data/dashboard.ts:13,66 ; src/lib/data/review.ts:369 ; src/db/schema.ts:416-426)
- **AUD-14** — Clôture et visa ne vérifient ni les participants, ni le compte rendu, ni les décisions sans pilote. (preuve : src/server/review.ts:184-194,257-266,401-402)
- **AUD-15** — Le visa n'exige que requireApprover, que l'animateur QHSE satisfait : le réserver à la direction. (preuve : src/server/review.ts:33-38,256-259 ; src/lib/domain.ts:294)
- **AUD-16** — Aucune échéance pour une décision restée sans suite ni pour une prochaine revue non planifiée (ISO 9001 §9.3.1). (preuve : src/lib/data/review.ts:623-654)
- **AUD-17** — Ajouter les types de pièces jointes review et review_item. (preuve : src/db/schema.ts:59-60 ; src/lib/uploads.ts:71-113)
- **AUD-18** — Un élément sans date n'a pas d'échéance ; un élément en retard double l'échéance de son action porteuse. (preuve : src/lib/data/audits.ts:259-267 (horizon conditionné à p.plannedOn, retard sans exclusion de l'action) ; src/lib/data/actions.ts:298,304-305 (doublon évité seulement pour l'à venir))
- **AUD-19** — Les échéances de certification renvoient vers /audits sans ouvrir le référentiel : accepter ?referentiel=&lt;id>. (preuve : src/lib/data/audits.ts:282 (href '/audits') ; src/app/(app)/audits/page.tsx:20,41 (aucun paramètre referentiel, CertificationCards sans initialId))
- **AUD-20** — Les constats hors programme ne portent qu'un libellé libre, sans date ni auditeur. (preuve : src/server/audits.ts:319-322 ; src/lib/data/audits.ts:143 (groupe hors programme : year, date et auditor à null, reports vide))
- **AUD-21** — Le serveur refuse un second élément sur la même ligne et le même mois : lever la contrainte. (preuve : src/server/audits.ts:217-221 ; src/server/review.ts:83-93 ; src/components/audits/ProgramTimeline.tsx:166)
- **AUD-22** — Programme, constats et certifications n'ont pas de siteId ni de filtre par site. (preuve : src/db/schema.ts:332-377 (aucun siteId) ; src/lib/data/audits.ts:85-96 (aucun filtre currentSiteId))
- **AUD-23** — Un élément est reconnu comme revue de direction par /revue/i.test : tout libellé contenant « revue » est concerné. (preuve : src/components/audits/shared.ts:17-23)
- **AUD-24** — Lignes du programme ni renommables ni masquables ; pas de reconduction du programme N-1. (preuve : src/lib/data/audits.ts:205-209 ; src/server/audits.ts:167-268 (aucune action de ligne ni de copie))
- **AUD-25** — Un constat annulé ne peut pas être rétabli : ajouter cette action, avec motif. (preuve : src/server/audits.ts:363-390 (aucune fonction restoreFinding) ; src/server/audits.ts:334 (constat annulé non modifiable))
- **AUD-26** — Le programme annuel d'audit ne s'imprime pas (ISO 9001 §9.2). (preuve : src/app/(app)/audits/page.tsx:37-56 (pas de PrintButton) ; src/app/vigie.css:190-192 ; src/lib/data/review.ts:396-417 (programme dans le dossier))
- **AUD-27** — L'auditeur est un texte libre, sans lien vers une personne ni contrôle de qualification. (preuve : src/db/schema.ts:358 ; src/server/audits.ts:186)
- **AUD-28** — Un constat ne porte qu'une action (actionId unique). (preuve : src/db/schema.ts:371 ; src/lib/action-links.ts (rattachement à un seul emplacement))
- **AUD-29** — Seules des puces par audit filtrent la liste ; les audits sans constat n'y apparaissent pas. (preuve : src/components/audits/FindingsCard.tsx:85,105-118 ; src/lib/data/audits.ts:134-153 (groupes construits à partir des seuls constats))
- **AUD-30** — L'élément de programme d'une revue annulée reste en place et passe « à confirmer ». (preuve : src/server/review.ts:297-300 ; src/lib/data/audits.ts:252,262)
- **AUD-31** — Éléments après la revue, échéance passée, plusieurs revues planifiées. (preuve : src/server/review.ts:50-55,128,341,402)
- **AUD-32** — Archiver en PDF, et dans les documents maîtrisés, le dossier de revue et les versions DUERP figés. (preuve : src/server/review.ts:256-282 ; src/components/review/DossierView.tsx:45 (impression navigateur seulement) ; src/lib/data/documents.ts:168-197 (aucun lien avec les revues))
- **AUD-33** — Les constats d'audits fournisseurs, déjà chargés, sont rangés dans la section Audits et non Fournisseurs. (preuve : src/lib/data/review.ts:419-432 ; src/lib/data/review.ts:442-452 (constats regroupés dans la section Audits))
- **AUD-34** — Une revue clôturée ne peut être corrigée : rectificatif tracé après visa. (preuve : src/server/review.ts:199,322,353,414 ; src/lib/data/review.ts:52)
- **AUD-35** — La perception client et les ressources ne sont pas affichées sur la carte de revue. (preuve : src/components/review/ReviewPanel.tsx:133-139 ; src/components/review/DossierView.tsx:172,548)
- **AUD-36** — Une fois la revue tenue, une décision ne peut plus être retirée ni déclarée abandonnée avec un motif : seul son intitulé se réécrit, et le journal ne garde que le nouveau texte. Ajouter un statut « abandonnée » motivé (qui, quand, pourquoi), affiché barré dans la carte et le dossier, et l'ancien libellé dans le journal. Le dernier lot l'a écarté pour ne pas ajouter de migration. (preuve : src/server/review.ts:436-447 (retrait refusé hors « planifiée », message « corrigez leur intitulé ») ; src/server/review.ts:417 (journal : nouveau texte seul, sans details) ; src/db/schema.ts:417-426 (review_decisions sans cancelledAt ni cancelReason) ; src/components/review/ReviewDialogs.tsx:96-98 (« Retirer » seulement avant la séance, via canDelete) ; previous-run.md:856)

## 11. Documents et environnement (DOC)

23 éléments — P1 : 2 · P2 : 10 · P3 : 11 — charge indicative 22–62 j.

| Réf | Élément | Priorité | Taille | Dépend de |
|---|---|:-:|:-:|---|
| DOC-01 | Document : propriétaire sorti ou site archivé remplacé | **P1** | S | — |
| DOC-02 | Registre des déchets : mentions de l'arrêté du 31 mai 2021 | **P1** | M | SIRET des sites |
| DOC-03 | Propriétaire en consultation seule : ni révision ni échéances | P2 | M | — |
| DOC-04 | Journal du cycle de vie des documents | P2 | M | — |
| DOC-05 | Version approuvée sans fichier | P2 | S | — |
| DOC-06 | Renvoi en brouillon sans motif | P2 | S | — |
| DOC-07 | Diffusion contrôlée et prise de connaissance | P2 | L | Cursus ; Entra ID |
| DOC-08 | Lien profond vers un enlèvement ou une filière | P2 | S | — |
| DOC-09 | Archivage d'une filière déchets | P2 | S | — |
| DOC-10 | Journal des filières et relevés | P2 | S | — |
| DOC-11 | Pièces jointes d'un enlèvement | P2 | M | — |
| DOC-12 | Statuts de BSD refus et acceptation partielle | P2 | S | — |
| DOC-13 | Action liée d'une version : contrôles contournés | P3 | S | — |
| DOC-14 | Échéances documentaires | P3 | S | — |
| DOC-15 | Revue périodique sans modification | P3 | M | — |
| DOC-16 | Liens « Procédure » sur les autres écrans | P3 | S | — |
| DOC-17 | Conservation des enregistrements et documents externes | P3 | M | — |
| DOC-18 | Séparation rédaction et approbation | P3 | S | — |
| DOC-19 | Relevés de consommation : responsable absent, sites sans relevé non suivis | P3 | S | — |
| DOC-20 | Filières d'un site archivé proposées | P3 | S | — |
| DOC-21 | Suivi des rejets eaux et air | P3 | L | — |
| DOC-22 | Accès de l'encadrement à Environnement | P3 | S | — |
| DOC-23 | Aspects et impacts environnementaux | P3 | L | — |

- **DOC-01** — Sans withCurrent, l'enregistrement remplace en silence un propriétaire sorti ou un site archivé. (preuve : src/components/documents/DocumentForms.tsx:114-115,125-126 ; src/lib/data/options.ts:31-32,49 ; src/components/form.tsx:79-86 ; src/server/documents.ts:23-39)
- **DOC-02** — Mentions manquantes au registre : SIRET, récépissé du transporteur, traitement final. (preuve : src/db/schema.ts:533-567 ; src/db/schema.ts:10-22 (sites sans SIRET) ; src/lib/data/environment.ts:447-450 ; src/components/environment/model.ts:1-3)
- **DOC-03** — Un propriétaire en consultation seule ne peut pas réviser son document et loadDocumentSignals ne lui renvoie rien sans canEdit. (preuve : src/lib/domain.ts:267-269 ; src/lib/data/documents.ts:268 ; src/server/documents.ts:67-71 ; src/components/documents/DocumentForms.tsx:68 ; src/db/seeds/documents.ts:41,75,84,108,116,124)
- **DOC-04** — Seul obsoleteDocument écrit dans le journal ; les autres étapes du cycle de vie ne sont pas tracées. (preuve : src/server/documents.ts:97-351 (aucun logChange) ; src/server/documents.ts:377 (seul appel) ; src/server/documents.ts:320 ; src/db/schema.ts:518-529)
- **DOC-05** — Une version peut être approuvée sans fichier joint. (preuve : src/server/documents.ts:285-306 ; src/components/documents/DocumentPanel.tsx (ConfirmForm submit : note « Aucun fichier », ConfirmForm approve : aucun contrôle))
- **DOC-06** — Le renvoi en brouillon ne demande pas de motif et ne crée pas d'échéance pour l'auteur. (preuve : src/server/documents.ts:309-324 ; src/components/documents/DocumentPanel.tsx (mode 'return' : ConfirmForm sans champ motif) ; src/lib/data/documents.ts:265-295)
- **DOC-07** — La diffusion est un texte libre : destinataires structurés et accusé de prise de connaissance. (preuve : src/db/schema.ts:513 ; design/Vigie.dc.html:778 (docs : « diffusion contrôlée »))
- **DOC-08** — Les fiches d'enlèvement et de filière s'ouvrent en état local, sans lien profond. (preuve : src/components/environment/WasteRegister.tsx:38 ; src/components/environment/StreamsPanel.tsx:36 ; src/lib/data/actions.ts:185-188)
- **DOC-09** — Une filière ne peut qu'être supprimée : ajouter l'archivage. (preuve : src/server/environment.ts:217-234 ; src/db/schema.ts:533-544 (pas d'archivedAt))
- **DOC-10** — Filières et relevés modifiés sans logChange. (preuve : src/server/environment.ts:164-215 ; src/server/environment.ts:218-234 ; src/server/environment.ts:242-282)
- **DOC-11** — Joindre bordereau et certificat à un enlèvement. (preuve : src/lib/uploads.ts:71-112 ; src/components/environment/WasteRegister.tsx:111-160)
- **DOC-12** — Quatre statuts de BSD seulement : ajouter refus et acceptation partielle. (preuve : src/components/environment/model.ts:9-15,21)
- **DOC-13** — L'action liée à une version est lue par readAction au lieu de checkActionLink : les contrôles de rattachement sont contournés. (preuve : src/server/documents.ts:43-49,105,183,240 ; src/lib/action-links.ts:324-330 ; src/server/links.ts:17-31,38-58)
- **DOC-14** — Pas d'échéance quand la revue périodique est dépassée pendant une révision en cours. (preuve : src/lib/data/documents.ts:270-281 ; src/lib/data/documents.ts:156-158 (reviewActions non utilisées dans le signal))
- **DOC-15** — Tracer une revue périodique sans nouvelle révision ni changement d'indice. (preuve : src/lib/data/documents.ts:126 ; src/components/documents/DocumentPanel.tsx (encadré revue : « Une revue sans modification se trace aussi par une nouvelle révision ») ; src/db/schema.ts:506-516)
- **DOC-16** — Étendre SCREEN_PROCEDURES pour afficher la procédure applicable sur les autres écrans. (preuve : src/lib/domain.ts:307 ; src/lib/data/prevention.ts:347-349 ; src/db/seeds/documents.ts:33,41,49)
- **DOC-17** — Durées de conservation des enregistrements et documents d'origine externe (ISO 9001 §7.5.3.2). (preuve : src/db/schema.ts:506-529 ; src/components/documents/meta.ts:8-14)
- **DOC-18** — L'auteur d'une version peut l'approuver lui-même. (preuve : src/server/documents.ts:285-298)
- **DOC-19** — L'échéance de relevé de consommation n'a pas de responsable (who vide), et un site qui n'a encore aucun relevé n'est jamais signalé. (preuve : src/lib/data/environment.ts:437 ; src/lib/data/environment.ts:425,428-430 (« un site sans relevé n'est pas suivi ») ; src/lib/data/environment.ts:403-404 (owner des BSD non réutilisé) ; src/lib/domain.ts:330)
- **DOC-20** — Les filières d'un site archivé sont proposées puis refusées après saisie. (preuve : src/lib/data/environment.ts:119 ; src/app/(app)/environnement/page.tsx:73,199 ; src/lib/guard.ts:36)
- **DOC-21** — Suivi des rejets eaux et air annoncé par la maquette, sans modèle de données. (preuve : design/Vigie.dc.html:778 (env : « …consommations et rejets ») ; src/db/schema.ts:531-574)
- **DOC-22** — L'écran Environnement est réservé à la QHSE et à la direction : l'ouvrir à l'encadrement. (preuve : src/lib/domain.ts:267-269 ; src/server/environment.ts:21-24 ; src/lib/data/environment.ts:401)
- **DOC-23** — Analyse aspects / impacts environnementaux absente (ISO 14001 §6.1.2). (preuve : src/db/seed.ts:257 ; src/db/schema.ts:531-574 (aucune table aspects/impacts))

## 12. Intégrations (INT)

17 éléments — P1 : 4 · P2 : 6 · P3 : 7 — charge indicative 30–96 j.

| Réf | Élément | Priorité | Taille | Dépend de |
|---|---|:-:|:-:|---|
| INT-01 | Socle commun des connecteurs | **P1** | L | Hébergement |
| INT-02 | Connecteur Keystone : projets et affectations | **P1** | L | API Keystone |
| INT-03 | Connecteur Cursus : personnel | **P1** | L | API Cursus |
| INT-04 | Notifications sortantes e-mail, Teams, push | **P1** | L | Entra ID ; tâches planifiées |
| INT-05 | Projets Keystone référencés par identifiant | P2 | M | — |
| INT-06 | Import PP par IA : coût | P2 | M | — |
| INT-07 | Import PP par IA : confidentialité | P2 | S | DPO |
| INT-08 | Liens directs vers Keystone | P2 | S | — |
| INT-09 | Formations avec Cursus | P2 | L | Cursus |
| INT-10 | Connecteur Trackdéchets | P2 | L | Jeton API |
| INT-11 | API Vigie pour Keystone | P3 | L | Entra ID |
| INT-12 | Filtre « Mes projets » | P3 | M | Keystone |
| INT-13 | Import PP par IA : appel long et configuration | P3 | M | — |
| INT-14 | Import PP : plusieurs pages et HEIC | P3 | M | — |
| INT-15 | Indicateurs fournisseurs et satisfaction depuis Keystone | P3 | M | Keystone |
| INT-16 | Alerte Légifrance | P3 | M | — |
| INT-17 | Flux iCalendar des échéances | P3 | M | Entra ID |

- **INT-01** — Client HTTP, journal de synchronisation, planification et écran « Connecteurs » communs à Keystone, Cursus et Trackdéchets. (preuve : .env.example:19-26 (variables commentées seulement) ; package.json:14-29 (aucune dépendance de planification ou de synchro) ; src/lib/domain.ts:238-258 (aucun écran Connecteurs dans SCREENS/NAV))
- **INT-02** — keystone_projects et les affectations ne sont alimentées que par le seed : les synchroniser depuis Keystone. (preuve : src/db/seed.ts:136-147,347,462 (seule source des tables) ; src/db/schema.ts:48-54,320-328 ; src/lib/data/skills.ts:112,198-211)
- **INT-03** — Origine de la fiche, matricule, synchronisation et champs verrouillés quand la donnée vient de Cursus (source de vérité RH). (preuve : src/components/skills/SkillMatrix.tsx:356 ; src/components/skills/PersonForm.tsx:69,100 ; src/db/schema.ts:24-39 (pas de source ni de matricule) ; src/server/skills.ts:267,314)
- **INT-04** — Récapitulatif périodique et alertes immédiates hors de la cloche. (preuve : src/lib/data/notifications.ts:24-34 (cloche seulement) ; src/db/schema.ts:25-39 (people sans e-mail) ; package.json:14-29 (ni client e-mail ni planificateur))
- **INT-05** — Les projets sont stockés en texte « id · client » : passer à une référence par identifiant. Les affectations Keystone ne sont pas reliées à keystone_projects : la fenêtre « Voir l'affectation » n'affiche ni client ni date de livraison. (preuve : src/db/schema.ts:83,324,454,493,619 (colonnes texte) ; src/components/skills/SkillAlerts.tsx:33-41 (« Projet » en texte seul) ; src/server/events.ts:234 ; src/server/prevention.ts:179,523 ; src/server/sitemap.ts:231 ; src/server/pp-import.ts:485)
- **INT-06** — La consommation (usage) n'est pas lue et aucun cache n'évite de renvoyer le même fichier. (preuve : src/server/pp-import.ts:41,102-116 (aucune lecture de usage) ; src/components/pp-import/DetectStep.tsx:31 (renvoi du fichier) ; src/lib/pp-import/ai.ts:33-35)
- **INT-07** — Envoi automatique du document au service d'IA et extrait de réponse journalisé ; seul un avis global informe l'utilisateur. (preuve : src/server/pp-import.ts:137 (extrait de réponse journalisé) ; src/server/pp-import.ts:277-289 (envoi automatique) ; src/components/pp-import/DropStep.tsx:149-153 (avis global seulement))
- **INT-08** — Helper keystoneHref à partir de KEYSTONE_URL pour remplacer les mentions « lien direct à venir » et rendre cliquable le projet affiché en texte sur les fiches événement, plan, permis, activité et affectation. (preuve : src/components/watch/RequirementsPanel.tsx:313 (« lien direct à venir ») ; src/components/sitemap/dialogs.tsx:323 ; src/app/(app)/evenements/page.tsx:285 (« Projet Keystone lié » en texte) ; src/components/prevention/PlanDialogs.tsx:346 ; src/components/prevention/PermitDialogs.tsx:376 ; src/components/skills/SkillAlerts.tsx:41 ; .env.example:25-26 (KEYSTONE_URL non utilisé))
- **INT-09** — Définir le sens des flux formations et titres entre Vigie et Cursus. (preuve : src/db/schema.ts:286-318 (training_titles, qualifications sans source ni externalId))
- **INT-10** — Récupérer les BSD par SIRET au lieu de la saisie manuelle du numéro. (preuve : src/app/(app)/environnement/page.tsx:336-340 ; src/db/schema.ts:10-22 (sites sans SIRET) ; src/db/schema.ts:557 (bsdNumber saisi))
- **INT-11** — Exposer l'état des habilitations pour contrôle à l'affectation dans Keystone. (preuve : src/lib/data/skills.ts:198-211 (alerte calculée dans Vigie seulement) ; route handlers limités à src/app/fichiers/[id]/route.ts, src/app/(app)/environnement/registre/route.ts, src/app/(app)/risques/export/route.ts)
- **INT-12** — Filtre pour le Chef de projet sur ses projets Keystone. (preuve : src/lib/domain.ts:268 ; src/db/schema.ts:49-54 (keystone_projects sans responsable) ; src/app/(app)/prevention/page.tsx:44-46 (aucun filtre projet))
- **INT-13** — Appel non streamé avec délai de 5 min et modèle codé en dur : streaming et modèle configurable. (preuve : src/server/pp-import.ts:41 (modèle en dur) ; src/server/pp-import.ts:102-116 (create non streamé, timeout 5 min) ; src/server/pp-import.ts:78)
- **INT-14** — Un seul fichier par import et pas de HEIC (photos iPhone). (preuve : src/lib/pp-import/types.ts:99-107 (pas de HEIC) ; src/server/pp-import.ts:55-62,126 (un fichier, « importez-le en plusieurs fichiers ») ; src/components/pp-import/DropStep.tsx:52-57)
- **INT-15** — Alimenter la revue de direction avec les données fournisseurs et clients de Keystone. (preuve : src/lib/data/review.ts:390-432 ; src/lib/domain.ts:202-217 (sources : Vigie ou contributeur))
- **INT-16** — Signaler un texte modifié ou abrogé. (preuve : src/db/schema.ts:207-230 (requirements sans identifiant ni URL Légifrance ; abrogation = archivage manuel lignes 226-229))
- **INT-17** — Abonnement Outlook aux échéances personnelles. (preuve : src/lib/data/todo.ts:22,32 (échéances liées à la session) ; aucune route iCalendar dans src/app)

## 13. Imports, exports et impression (IMP)

9 éléments — P1 : 1 · P2 : 6 · P3 : 2 — charge indicative 12–37 j.

| Réf | Élément | Priorité | Taille | Dépend de |
|---|---|:-:|:-:|---|
| IMP-01 | Import des heures travaillées | **P1** | M | Levée du report |
| IMP-02 | Import du personnel Lucca | P2 | M | Levée du report |
| IMP-03 | Import Excel de la veille | P2 | L | Levée du report |
| IMP-04 | Helper CSV commun | P2 | S | — |
| IMP-05 | Exports CSV événements, actions, veille | P2 | M | Levée du report ; helper CSV |
| IMP-06 | Export et impression de la matrice des habilitations | P2 | M | Levée du report (export) |
| IMP-07 | Impression des fiches événement et action | P2 | M | — |
| IMP-08 | Exports : liste maîtresse, plans et permis | P3 | S | Levée du report ; helper CSV |
| IMP-09 | Plan régénéré au format importé | P3 | L | Levée du report |

- **IMP-01** — Import depuis la paie (le TF1/TG vaut 0 sans heures). (preuve : src/db/schema.ts:41-46 (table hours_worked) ; src/db/seed.ts:350-354 (seule source des heures) ; src/lib/data/dashboard.ts:25,38-40 (TF1/TG à 0 sans heures) ; src/lib/data/review.ts:97,364-367 ; aucune server action dans src/server/)
- **IMP-02** — Import CSV avec aperçu avant écriture. (preuve : src/components/skills/SkillMatrix.tsx:355 (bouton Soon désactivé) ; src/server/skills.ts:97-422 (aucune action d'import) ; maquette design/Vigie.dc.html:410)
- **IMP-03** — Import du tableau de veille existant avec aperçu. (preuve : src/app/(app)/veille/page.tsx:75-77 (bouton désactivé) ; src/server/watch.ts:70-461 (aucune action d'import) ; parseurs réutilisables : src/lib/pp-import/docx.ts (fflate + fast-xml-parser) ; maquette design/Vigie.dc.html:366)
- **IMP-04** — csvCell, fileSlug, BOM et séparateur « ; » existent en deux copies. (preuve : src/lib/data/risks.ts:447-473 et src/lib/data/environment.ts:452-475 (csvCell, fileSlug, BOM/« ; » dupliqués) ; src/app/(app)/risques/export/route.ts:12-21 et src/app/(app)/environnement/registre/route.ts:22-29 (en-têtes Content-Disposition dupliqués))
- **IMP-05** — Exports reportés ; suivre le modèle de l'export DUERP. (preuve : src/app/(app)/evenements/, src/app/(app)/actions/, src/app/(app)/veille/ (uniquement page.tsx, aucun route.ts) ; modèle : src/app/(app)/risques/export/route.ts:12-56)
- **IMP-06** — Matrice exportable et imprimable pour les audits. (preuve : src/app/(app)/habilitations/page.tsx (seul fichier, pas de route d'export ni de vue d'impression) ; src/components/skills/SkillMatrix.tsx:352-366 (barre d'outils sans export/impression) ; src/app/vigie.css:190-192)
- **IMP-07** — Feuille d'impression générique pour les fiches ouvertes en fenêtre modale. (preuve : src/app/vigie.css:190-192 (règle print minimale) ; src/components/Dialog.tsx:13 (fiches en dialog modal) ; PrintButton utilisé seulement dans src/components/review/DossierView.tsx:45, src/app/signaler/postes/page.tsx:31, src/app/(app)/prevention/imprimer/ ; src/app/(app)/prevention/imprimer/permis/page.tsx:16 (registre seulement, pas de fiche permis individuelle))
- **IMP-08** — Exports reportés de la liste maîtresse des documents et des plans/permis. (preuve : src/app/(app)/documents/page.tsx (seul fichier, aucun export) ; src/app/(app)/prevention/ (vues imprimer/ présentes, aucun route.ts CSV) ; modèle : src/app/(app)/environnement/registre/route.ts)
- **IMP-09** — Régénérer le plan de prévention dans le format du formulaire importé (pdf-lib). (preuve : src/lib/pp-import/pdf-form.ts:1-7 (lecture seule avec pdf-lib) ; aucune génération PDF dans src/ ; impression navigateur seulement : src/app/(app)/prevention/imprimer/plan/[id]/page.tsx)

## 14. Production et exploitation (PRD)

15 éléments — P0 : 4 · P1 : 3 · P2 : 8 — charge indicative 11,5–31 j.

| Réf | Élément | Priorité | Taille | Dépend de |
|---|---|:-:|:-:|---|
| PRD-01 | Hébergement et empaquetage | **P0** | M | — |
| PRD-02 | Sauvegarde, restauration et chiffrement | **P0** | M | — |
| PRD-03 | Mode démonstration explicite (VIGIE_DEMO) | **P0** | S | — |
| PRD-04 | Base de production sans jeu de démonstration | **P0** | M | — |
| PRD-05 | PGlite ou PostgreSQL | **P1** | M | — |
| PRD-06 | Règles et tests de migration | **P1** | M | — |
| PRD-07 | URL publique des QR codes | **P1** | S | — |
| PRD-08 | Numéros de référence sûrs | P2 | S | — |
| PRD-09 | Configuration centralisée | P2 | S | — |
| PRD-10 | Journalisation serveur | P2 | S | — |
| PRD-11 | Supervision et santé | P2 | S | — |
| PRD-12 | Tâches planifiées | P2 | M | — |
| PRD-13 | Stockage des pièces jointes | P2 | M | — |
| PRD-14 | Application Mac client du serveur | P2 | M | — |
| PRD-15 | Documentation d'exploitation | P2 | S | — |

- **PRD-01** — Sortie standalone, HTTPS, volume persistant pour la base et les pièces jointes ; aujourd'hui seul le serveur local du Mac existe. (preuve : next.config.ts:3-7 (pas d'output standalone) ; package.json:6-9 (seuls next dev/start --port 3200) ; aucun Dockerfile ni compose dans le dépôt ; src/db/index.ts:20,23 et src/lib/uploads.ts:12 (base, dossier drizzle/ et pièces résolus depuis process.cwd()) ; src/app/actions.ts:13,18 (cookies sans secure/httpOnly) ; desktop-app/README.md:99 (serveur limité à ::1, « Vigie n'a pas d'authentification »))
- **PRD-02** — Sauvegarde de la base et des fichiers (avant chaque migration), procédure de restauration, pièces jointes chiffrées au repos. (preuve : src/db/index.ts:19-24 (PGlite sur disque local, migration au démarrage sans sauvegarde préalable) ; src/lib/uploads.ts:12,28-30 (fichiers écrits en clair dans .data/uploads) ; package.json:13 (seul script : db:reset = rm -rf .data) ; aucun script de sauvegarde ou de restauration dans scripts/)
- **PRD-03** — setRole, VIGIE_TODAY et le sélecteur de rôle ne doivent fonctionner qu'avec VIGIE_DEMO activé. (preuve : src/app/actions.ts:11-15 (setRole sans contrôle d'environnement) ; src/components/Sidebar.tsx:103-124 (sélecteur de rôle toujours affiché) ; src/lib/dates.ts:9-11 (VIGIE_TODAY honoré partout, sans validation) ; .env.example:6 (VIGIE_TODAY=2026-10-09 renseigné par défaut) ; src/lib/domain.ts:272 (DEFAULT_ROLE = Animateur QHSE sans cookie))
- **PRD-04** — Seed conditionnel (démo seulement) et suppression des dépendances aux personnes du seed (ROLES.personId, QHSE_LEAD). (preuve : src/db/index.ts:24 (seed à chaque ouverture) ; src/db/seed.ts:329-331 (toute base vide reçoit le jeu de démonstration) ; src/lib/domain.ts:264-269,302 (ROLES.personId et QHSE_LEAD = identifiants du seed) ; src/lib/session.ts:28 (people.find(...)! : plantage si ces personnes n'existent pas) ; src/lib/data/actions.ts:303, audits.ts:272-282, risks.ts:486-487 (QHSE_LEAD propriétaire des alertes))
- **PRD-05** — Une seule instance PGlite par processus et un seul serveur sur la base : décider du moteur de production. (preuve : src/db/index.ts:4-6,16-34 (instance PGlite unique par processus) ; src/db/seed.ts:3 et src/db/seeds/types.ts (type PgliteDatabase) ; desktop-app/README.md:52-57,101 (contrainte d'un seul serveur sur la base))
- **PRD-06** — Ne plus modifier une migration publiée (0002 l'a été à la main) ; tester les migrations sur une copie de base avant déploiement. (preuve : src/db/index.ts:23 (migrate au démarrage, sans sauvegarde ni test préalable) ; drizzle/0002_traceability.sql et drizzle/meta/0002_snapshot.json (modifiés à la main au dernier run) ; package.json:5-14 (aucun script de test) ; pas de dossier .github ni de fichier \*.test.\* ; README.md:12 (db:reset recommandé après une modification du schéma))
- **PRD-07** — Les QR codes dépendent de l'en-tête Host (repli localhost) : fixer VIGIE_PUBLIC_URL. (preuve : src/lib/data/events.ts:294-299 (appOrigin d'après x-forwarded-host/host, repli http://localhost:3200) ; utilisé par src/app/signaler/postes/page.tsx:19 et src/app/(app)/apercu-mobile/page.tsx:31)
- **PRD-08** — Les références (A-n, PP-, etc.) sont calculées par max + 1 hors transaction : risque de doublon en écritures simultanées. (preuve : src/server/plan.ts:128-131 (A-n hors transaction) ; src/server/prevention.ts:78,227-228,542-543 ; src/server/documents.ts:112-114 ; src/server/environment.ts:209-211 ; src/server/audits.ts:99-102 ; src/server/pp-import.ts:502-504 ; à l'inverse src/server/events.ts:344-345 calcule dans la transaction ; src/lib/forms.ts:89-92 (nextRef))
- **PRD-09** — Variables d'environnement lues et validées en un seul module (zod). (preuve : src/lib/dates.ts:10 (VIGIE_TODAY renvoyé tel quel) ; src/db/index.ts:20 (VIGIE_DATA_DIR) ; src/lib/uploads.ts:12 (VIGIE_UPLOAD_DIR) ; src/lib/pp-import/ai.ts:20-34 (VIGIE_AI_IMPORT, ANTHROPIC_API_KEY) ; package.json:25 (zod disponible))
- **PRD-10** — Erreurs serveur journalisées avec leur référence (instrumentation.ts). (preuve : src/app/(app)/error.tsx:8,17-19 et src/app/error.tsx:8,19 (référence affichée, console.error côté client seulement) ; aucun src/instrumentation.ts ; les console.error serveur se limitent à src/server/pp-import.ts:118-540)
- **PRD-11** — Route /api/sante contrôlant aussi la base. (preuve : pas de dossier src/app/api ; seule route handler : src/app/fichiers/[id]/route.ts ; desktop-app/README.md:43 (sonde /_next/static/vigie-desktop-probe, sans contrôle de la base))
- **PRD-12** — Calculer les échéances hors requête utilisateur (prérequis des notifications sortantes et des purges). (preuve : src/lib/data/todo.ts:22-37 (échéances calculées seulement dans une requête, via getSession et le site sélectionné) ; src/lib/data/notifications.ts:13-35 (notifications dans l'application uniquement) ; aucune bibliothèque d'envoi d'e-mail ni planificateur dans package.json:15-30)
- **PRD-13** — Dossier persistant hors cwd, type réel du fichier, nettoyage des orphelins si l'insertion échoue. (preuve : src/lib/uploads.ts:12 (dossier relatif à cwd) ; src/lib/uploads.ts:17-20 (type MIME déclaré par le client) ; src/lib/uploads.ts:24-36 (writeFile puis insert, sans transaction ni nettoyage en cas d'échec) ; src/server/events.ts:526 (photos enregistrées après la création de l'événement))
- **PRD-14** — L'application Mac doit pouvoir ouvrir l'URL du serveur central au lieu de localhost:3200. (preuve : desktop-app/Sources/AppConfig.swift:41-42 (baseURL et probeURL figées sur localhost:3200) ; desktop-app/Sources/AppConfig.swift:46-52 (isAppURL : seuls localhost, 127.0.0.1 et ::1 sur le port 3200) ; desktop-app/README.md:99)
- **PRD-15** — Procédures d'installation, sauvegarde, mise à jour et restauration. (preuve : README.md:5-12 (démarrage dev et db:reset seulement) ; README.md:29 (« suppression des risques », périmé) ; aucune section exploitation, sauvegarde ou mise à jour ; .env.example présent mais orienté démonstration (VIGIE_TODAY renseigné à la ligne 6))

## 15. Sécurité et RGPD (SEC)

14 éléments — P0 : 3 · P1 : 3 · P2 : 6 · P3 : 2 — charge indicative 15–44 j.

| Réf | Élément | Priorité | Taille | Dépend de |
|---|---|:-:|:-:|---|
| SEC-01 | Authentification Microsoft Entra ID | **P0** | L | Tenant Entra |
| SEC-02 | Rôles et périmètre de sites depuis Entra | **P0** | M | Entra ID |
| SEC-03 | Identifiants stables sur la fiche personne | **P0** | S | — |
| SEC-04 | Contrôle de l'hôte (DNS rebinding) | **P1** | S | — |
| SEC-05 | En-têtes HTTP et cookies | **P1** | S | — |
| SEC-06 | Données de santé des AT restreintes | **P1** | M | — |
| SEC-07 | Limitation de débit et quotas | P2 | M | — |
| SEC-08 | Validation et service des pièces jointes | P2 | M | — |
| SEC-09 | Anonymat des signalements côté serveur | P2 | S | — |
| SEC-10 | Registre des traitements et durées de conservation | P2 | L | DPO |
| SEC-11 | Consultations tracées | P2 | M | — |
| SEC-12 | Mentions d'information RGPD | P2 | S | — |
| SEC-13 | Droits d'accès d'un salarié | P3 | M | — |
| SEC-14 | Redirection 307 avant le streaming | P3 | S | — |

- **SEC-01** — OIDC, session signée, contrôle dans proxy.ts, retrait de setRole. (preuve : src/lib/session.ts:12-18 (rôle lu dans un cookie, sinon rôle par défaut) ; src/lib/domain.ts:272 (DEFAULT_ROLE = 'Animateur QHSE') ; src/app/actions.ts:11-15 (setRole accessible à tous) ; pas de src/proxy.ts ; package.json:14-29 (aucune dépendance OIDC/MSAL/Auth.js))
- **SEC-02** — Rôle et sites autorisés tirés d'Entra ; site par défaut = site de rattachement ; setSite limité au périmètre. (preuve : src/lib/domain.ts:264-272 (ROLES → personId en dur) ; src/lib/session.ts:28-33 (utilisateur déduit du rôle, site lu dans un cookie, sinon premier site actif, sans tenir compte du site de rattachement) ; src/app/actions.ts:17-19 (setSite sans contrôle du périmètre) ; src/lib/guard.ts:32-37 (requireInSite contrôle le site sélectionné, pas les sites autorisés à l'utilisateur))
- **SEC-03** — Ajouter objectId Entra, e-mail et matricule ; ne plus dédoublonner ni identifier par le nom. (preuve : src/db/schema.ts:25-39 (people : id, nom, poste, site, aucun e-mail, objectId ni matricule) ; src/server/skills.ts:283 (doublon détecté par le nom) ; src/server/skills.ts:302 (identifiant tiré du nom : uniqueId(personSlug(name))))
- **SEC-04** — Refuser les hôtes inconnus dans proxy.ts et restreindre serverActions.allowedOrigins. (preuve : pas de src/proxy.ts ; next.config.ts:3-7 (aucune liste d'hôtes ni serverActions.allowedOrigins) ; src/app/fichiers/[id]/route.ts:5-9 (droit déduit du seul cookie de rôle) ; src/lib/domain.ts:272 (sans cookie, rôle Animateur QHSE) ; desktop-app/README.md:99 (« Vigie n'a pas d'authentification »))
- **SEC-05** — CSP, HSTS, poweredByHeader: false ; cookies httpOnly et secure. (preuve : next.config.ts:3-7 (ni headers() ni poweredByHeader: false) ; src/app/actions.ts:13 et 18 (cookies sans httpOnly ni secure) ; src/app/fichiers/[id]/route.ts:16 (seul en-tête de sécurité présent, nosniff))
- **SEC-06** — Blessure, jours perdus et déclaration CPAM visibles par tout rôle qui voit les événements : les limiter aux rôles habilités. (preuve : src/app/(app)/evenements/page.tsx:300-301 (blessure, jours perdus et déclaration CPAM affichés à tout rôle qui voit les événements) ; src/app/(app)/evenements/page.tsx:47-50 (seul le Salarié est filtré) ; src/db/schema.ts:92-95 (injury, lostDays, cpamDeclaredOn))
- **SEC-07** — Limites par utilisateur et par période sur le signalement, les fichiers et l'import IA. (preuve : src/server/events.ts:475-494 (createReport : contrôles par requête seulement, aucune limite par utilisateur ou par période) ; src/server/pp-import.ts:79 (seule la limite côté Anthropic est gérée) ; src/lib/uploads.ts:17-21 (pas de quota de stockage))
- **SEC-08** — Contrôle des octets réels (magic bytes) et antivirus ; types Office anciens à reconsidérer. (preuve : src/lib/uploads.ts:10 (liste blanche de types MIME, dont application/msword et vnd.ms-excel) ; src/lib/uploads.ts:17-21 (contrôle fondé sur file.type déclaré, ni octets réels ni antivirus) ; src/lib/uploads.ts:33 (type MIME et nom de fichier client enregistrés tels quels) ; src/app/fichiers/[id]/route.ts:12-14)
- **SEC-09** — Retirer EXIF et noms de fichiers d'origine côté serveur pour les signalements anonymes. (preuve : src/server/events.ts:489-494 (aucun nettoyage des métadonnées côté serveur) ; src/server/events.ts:520-526 (saveUpload garde fichier et nom d'origine, seul uploadedBy est mis à null) ; src/components/ReportForm.tsx:37-58 (EXIF retiré seulement côté client, base du nom de fichier conservée))
- **SEC-10** — Durées de conservation par donnée, purge et anonymisation (salariés sortis, AT). (preuve : src/lib/data/risks.ts:17-18 (seul le DUERP a une durée, un simple libellé) ; src/db/schema.ts:35-38 (salarié sorti conservé sans limite) ; src/db/schema.ts:92-95 (données AT sans durée de conservation) ; aucun job ni action de purge ou d'anonymisation dans src/server)
- **SEC-11** — Journal des accès aux données sensibles et aux fichiers, en plus des modifications. (preuve : src/app/fichiers/[id]/route.ts:5-18 (aucune trace de consultation) ; src/db/schema.ts:634-644 (change_log limité aux modifications) ; src/app/(app)/evenements/page.tsx:66 (seul le journal des modifications est chargé))
- **SEC-12** — Mentions de l'article 13 sur le signalement et la fiche salarié. (preuve : src/components/ReportForm.tsx:298-301 (option d'anonymat sans mention d'information) ; src/components/skills/PersonForm.tsx:100 ; aucune occurrence de « RGPD », « CNIL » ou « données personnelles » sous forme de mention dans src)
- **SEC-13** — Vue par personne de toutes ses données pour répondre à une demande d'accès. (preuve : src/lib/data/skills.ts:229-234 (vue limitée à soi, sur la matrice seulement) ; src/app/(app)/evenements/page.tsx:47-50 ; src/lib/data/actions.ts:234 (filtres « mes données » éparpillés, sans fiche par personne))
- **SEC-14** — Les gardes redirigent pendant le rendu, après envoi du squelette : faire la redirection dans proxy.ts. (preuve : src/lib/guard.ts:7-11 (redirect() pendant le rendu) ; src/app/(app)/loading.tsx (squelette envoyé avant la redirection) ; pas de src/proxy.ts pour faire la redirection avant le rendu)

## 16. Qualité, tests, performance et dette technique (QUA)

28 éléments — P1 : 7 · P2 : 6 · P3 : 15 — charge indicative 28–81 j.

| Réf | Élément | Priorité | Taille | Dépend de |
|---|---|:-:|:-:|---|
| QUA-01 | Intégration continue | **P1** | S | — |
| QUA-02 | typecheck sur un clone neuf | **P1** | S | — |
| QUA-03 | Vitest et tests des règles pures | **P1** | L | — |
| QUA-04 | Tests d'intégration des server actions | **P1** | L | Vitest |
| QUA-05 | Recette des server actions jamais exécutées | **P1** | M | — |
| QUA-06 | Non-régression du cloisonnement Salarié | **P1** | M | — |
| QUA-07 | Corriger addMonths en fin de mois | **P1** | S | — |
| QUA-08 | Tests de bout en bout Playwright | P2 | L | — |
| QUA-09 | Dates en UTC | P2 | S | — |
| QUA-10 | Tests de l'import de plan de prévention | P2 | M | — |
| QUA-11 | Historiques à l'ouverture d'une fiche | P2 | M | — |
| QUA-12 | Modifications simultanées | P2 | M | — |
| QUA-13 | README et CLAUDE.md à jour | P2 | S | — |
| QUA-14 | Sortir les règles métier des composants | P3 | M | — |
| QUA-15 | Jeu d'essai des scans | P3 | M | — |
| QUA-16 | Recette visuelle et contrôle d'accessibilité (axe-core) | P3 | M | — |
| QUA-17 | Échéances et badges : coût par page | P3 | M | — |
| QUA-18 | requireEditor commun | P3 | S | — |
| QUA-19 | Factoriser le contrôle des pièces jointes | P3 | S | — |
| QUA-20 | Dater le jeu de démonstration | P3 | M | — |
| QUA-21 | Pagination des événements | P3 | M | — |
| QUA-22 | Motif unifié | P3 | S | — |
| QUA-23 | États annulé et archivé | P3 | M | — |
| QUA-24 | Code mort et knip | P3 | S | — |
| QUA-25 | Helpers mutualisés | P3 | S | — |
| QUA-26 | Découper les gros fichiers | P3 | M | — |
| QUA-27 | AGENTS.md | P3 | S | — |
| QUA-28 | Environnement de développement | P3 | S | — |

- **QUA-01** — Pipeline typecheck, lint et build sur chaque push. (preuve : package.json:5-13 (scripts dev/build/start/lint/typecheck/db:\*, aucun test) ; .github/ absent ; git remote origin = github.com/Yhumiii27/Vigie)
- **QUA-02** — tsc échoue tant que .next/types n'est pas généré : lancer next typegen avant tsc. (preuve : package.json:10 ("typecheck": "tsc --noEmit") ; .gitignore:57 (next-env.d.ts) ; next-env.d.ts:3-4 importe ./.next/types/routes.d.ts ; src/app/(app)/a-faire/page.tsx:14, src/app/fichiers/[id]/route.ts:5 (PageProps/RouteContext générés))
- **QUA-03** — Tests unitaires des règles des domaines (statuts, échéances, dates, coactivité). (preuve : src/lib/queries.ts:1 (import 'server-only'), :57-77 (actionColumn, controlStatus, skillState) ; src/lib/dates.ts:23-27 ; src/components/prevention/model.ts, src/components/sitemap/coactivity.ts ; package.json:5-13 sans script test)
- **QUA-04** — Server actions testées sur une base PGlite en mémoire (droits, site, journal). (preuve : src/db/index.ts:19-25 (open : PGlite(dir) + migrate + seed), :28-34 (instance globale) ; src/lib/session.ts:14-35 (cookies()) ; src/server/\*.ts (≈125 « export async function »))
- **QUA-05** — Les actions prévention et habilitations du dernier lot n'ont jamais été appelées : recette manuelle ou automatisée. (preuve : previous-run.md:235 (actions prévention « not exercised »), :332 (habilitations : « None of the new server actions were called »), :575 (≈20 actions appelées), corrections postérieures « I did not run the app » ; src/server/prevention.ts:260-459 (signPlanEu, recordPlanEeSignature, closePlan, cancelPlan, deletePlan, add/removePlanAttachment) ; src/server/skills.ts:97-422)
- **QUA-06** — Vérifier que la charge RSC envoyée au Salarié ne contient que ses données. (preuve : src/lib/uploads.ts:71-110 (canReadAttachment) ; src/lib/data/todo.ts:32-36 (loadVisibleTodo, isMine) ; previous-run.md, section Review fixes « Salarié data leak in the page payload (evenements/page.tsx) »)
- **QUA-07** — addMonths déborde au mois suivant (31/01 + 1 mois = 03/03) : échéances repoussées ; utiliser la version bornée. (preuve : src/lib/dates.ts:23-27 (setUTCMonth sans borne) ; src/server/skills.ts:130 (expiresOn = addMonths(...)) ; src/components/skills/TrainingForm.tsx:26 ; src/lib/data/documents.ts:126 ; src/server/risks.ts:428 ; src/components/watch/period.ts:7-12 (version bornée))
- **QUA-08** — Parcours principaux par rôle. (preuve : package.json:32-41 (devDependencies sans @playwright/test) ; src/lib/domain.ts:264-269 (5 rôles et écrans))
- **QUA-09** — Plusieurs dates du jour sont calculées en UTC : un helper parisDay commun. (preuve : src/lib/data/actions.ts:83 (isoDay) ; src/lib/attachments.ts:32 (addedOn) ; src/lib/data/audits.ts:113 ; src/lib/data/review.ts:169,602 ; src/lib/data/sites.ts:23 ; src/components/skills/TitlesManager.tsx:34)
- **QUA-10** — Tests sur les formulaires d'exemple et leurs résultats attendus. (preuve : samples/README.md:5-11 (résultats attendus) ; src/lib/pp-import/pdf-form.ts, docx.ts, mapping.ts ; scripts/pp-samples.mjs)
- **QUA-11** — Les journaux sont chargés pour toute la liste : les charger à l'ouverture de la fiche. (preuve : src/lib/data/actions.ts:149 (loadChangeLogs('action', toutes les actions)) ; src/components/actions/ActionDetail.tsx:287 ; src/lib/data/risks.ts:320, prevention.ts:375-377, audits.ts:98-100, watch.ts:122-123, documents.ts:182)
- **QUA-12** — Écriture conditionnelle (version ou updatedAt) pour éviter qu'une modification en écrase une autre. (preuve : src/server/events.ts:305 (update events set v where id) ; src/server/events.ts:316-319 (nextEventId) ; src/lib/forms.ts:89-92 (nextRef) ; src/server/risks.ts:39-40 (isUniqueViolation, seul cas traité))
- **QUA-13** — Routes, date de démonstration et conventions (requireInSite, logChange, archivage) à mettre à jour. (preuve : README.md:12 (VIGIE_TODAY=2026-10-06), :24-40 (table des routes incomplète), :29 (« suppression des risques ») ; .env.example:6 ; CLAUDE.md, section Conventions (pas de requireInSite / logChange / archivage) ; src/lib/guard.ts:32, src/server/changelog.ts)
- **QUA-14** — Le serveur importe des règles depuis src/components : les déplacer dans src/lib/rules. (preuve : src/server/watch.ts:6 et src/lib/data/watch.ts:5 (addMonthsClamped depuis components/watch/period) ; src/server/prevention.ts:11, src/server/sitemap.ts:6-8, src/server/skills.ts:5, src/lib/data/sitemap.ts:5-13, src/lib/action-links.ts:5 (imports @/components))
- **QUA-15** — Mesurer la précision de l'IA sur des scans et photos. (preuve : samples/ (plan-de-prevention-exemple.pdf/.docx, vierge.pdf seulement) ; samples/README.md (section « Scans et photos ») ; src/lib/pp-import/scan.ts, ai.ts)
- **QUA-16** — Captures d'écran comparées et contrôle d'accessibilité axe-core en trois tailles d'écran. (preuve : package.json:5-13 (aucun script de test visuel ni axe-core) ; design/Vigie.dc.html (maquette de référence))
- **QUA-17** — Les 11 loaders d'échéances tournent à chaque page : filtrage SQL, index, cache. (preuve : src/app/(app)/layout.tsx:8 (loadCounters à chaque page) ; src/lib/data/todo.ts:22-29 (11 loaders) ; src/lib/queries.ts:29-31,40-42 (select complet puis filter inSite))
- **QUA-18** — Sept gardes d'écriture par domaine : un requireEditor fondé sur canEdit. (preuve : src/server/risks.ts:21-35 ; src/server/audits.ts:27-31 ; src/server/review.ts:27-38 ; src/server/watch.ts:21-26 ; src/server/skills.ts:42-45 ; src/server/environment.ts:21-23 ; src/server/documents.ts:67-70 ; src/lib/domain.ts:298-299 (canEdit))
- **QUA-19** — Contrôles de lot de fichiers dupliqués côté serveur et client : checkFileBatch commun. (preuve : src/server/events.ts:426-427,488 ; src/server/plan.ts:164-165 ; src/server/audits.ts:50-51 ; src/server/watch.ts:43-44 ; src/server/skills.ts:53-54 ; src/server/prevention.ts:418 ; src/components/Attachments.tsx:48-51, watch/parts.tsx:17-20, prevention/PlanDialogs.tsx:33-36)
- **QUA-20** — ≈420 dates en dur dans le seed : dates relatives ou date de démonstration figée et documentée. (preuve : src/lib/dates.ts:9-12 (today, VIGIE_TODAY) ; src/db/seed.ts et src/db/seeds/\*.ts (≈420 dates « '20XX-MM-JJ ») ; .env.example:6 (VIGIE_TODAY=2026-10-09) ; decisions.md (« Hors périmètre : … dates relatives du seed »))
- **QUA-21** — Tous les événements sont chargés puis filtrés en mémoire : filtre SQL et pagination. (preuve : src/lib/queries.ts:29-33 (loadSiteEvents : select from events puis filter inSite) ; src/app/(app)/evenements/page.tsx (aucun slice ni limit))
- **QUA-22** — Saisie et validation du motif (annulation, archivage, réouverture) par formReader.reason partout. (preuve : src/lib/forms.ts:69-74 (reason) ; src/server/plan-ui.ts:101 ; src/server/sites.ts:16,77 ; src/server/watch.ts:35-38 ; src/lib/domain.ts:99-101)
- **QUA-23** — La convention d'états n'est qu'un commentaire : contraintes CHECK en base. (preuve : src/db/schema.ts:3-6 (convention en commentaire) ; schema.ts : aucun check() (seuls index l.318 et l.644))
- **QUA-24** — Réexports, alias et fonctions inutilisés ; ajouter knip. (preuve : src/components/audits/PrintButton.tsx:1-2 ; src/components/ui.tsx:49 (OutOfScope) ; src/lib/action-links.ts:366 (openActionIds) ; src/lib/pp-import/text.ts:207 (parseDate) ; src/components/documents/meta.ts:34 ; src/lib/domain.ts:100-101,303-304)
- **QUA-25** — withCurrent (server-only) et nextSort recopiés : les partager. (preuve : src/lib/data/options.ts:1,49-50 (withCurrent, server-only) ; src/components/audits/ProgramTimeline.tsx:205-207 et src/components/ActionFormDialog.tsx:50 (copies inline) ; src/server/audits.ts:33 et src/server/review.ts:42 (nextSort))
- **QUA-26** — Seed et prévention à découper comme les seeds déjà séparés. (preuve : src/db/seed.ts (531 l., 57 Ko) vs src/db/seeds/{documents,environment,prevention,sitemap}.ts ; src/server/prevention.ts (678 l., 42 Ko) ; src/lib/data/prevention.ts (739 l.))
- **QUA-27** — Committer AGENTS.md ou passer par agentRules dans next.config. (preuve : next.config.ts:3-7 (pas d'agentRules) ; node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/agentRules.md ; .gitignore (pas d'AGENTS.md) ; previous-run.md:327,374,577)
- **QUA-28** — Hook de démarrage de session, champ engines et version de Node figée. (preuve : .claude/launch.json (seul fichier) ; package.json:1-42 (pas d'engines) ; absence de .nvmrc / .node-version)

## 17. UX et accessibilité (UX)

16 éléments — P1 : 3 · P2 : 11 · P3 : 2 — charge indicative 15,5–45 j.

| Réf | Élément | Priorité | Taille | Dépend de |
|---|---|:-:|:-:|---|
| UX-01 | Navigation mobile | **P1** | M | — |
| UX-02 | Formulaire terrain : zoom iOS, cibles, dictée | **P1** | S | — |
| UX-03 | Fenêtres modales | **P1** | S | — |
| UX-04 | Erreurs de formulaire accessibles | P2 | S | — |
| UX-05 | Photos : galerie et allègement | P2 | M | — |
| UX-06 | Mise en page tablette | P2 | M | — |
| UX-07 | Liste puis fiche sur petit écran | P2 | M | — |
| UX-08 | Carte du site tactile | P2 | M | — |
| UX-09 | Contraste | P2 | M | — |
| UX-10 | Icônes et infobulles | P2 | M | — |
| UX-11 | Structure sémantique et clavier de la coque | P2 | M | — |
| UX-12 | Uniformiser filtres et liens profonds | P2 | L | — |
| UX-13 | Élément introuvable partout | P2 | S | — |
| UX-14 | Retours d'état | P2 | M | — |
| UX-15 | Dossier de revue sur téléphone | P3 | S | — |
| UX-16 | Aide en ligne | P3 | M | — |

- **UX-01** — Barre latérale empilée sur téléphone : tiroir de navigation, cloche à largeur adaptable. (preuve : src/app/vigie.css:194-199 (sidebar en position statique et empilée, pas de tiroir) ; src/app/(app)/layout.tsx:17-19 ; src/components/NotificationBell.tsx:40 (width: 380 fixe) ; src/components/PageHeader.tsx:18 (lien vers /apercu-mobile au lieu de /signaler) ; src/app/(app)/apercu-mobile/page.tsx:39 (IOSDevice width={390}))
- **UX-02** — Champs à 16 px (zoom iOS), cibles tactiles de 44 px, micro proposé seulement si la dictée est disponible, radiogroup nommé. (preuve : src/components/ReportForm.tsx:235,249 (fontSize 13.5) ; src/app/vigie.css:152 (.vg-form .input 13px) ; src/components/ReportForm.tsx:240 (bouton « Modifier » padding 0), 250-251 (micro 30 px), 279-280 (retrait 26 px), 93-95 (micro sans détection préalable), 290-291 (radiogroup sans aria-label))
- **UX-03** — Nom accessible, titre sémantique, fermeture au clic extérieur sans perte de saisie. (preuve : src/components/Dialog.tsx:18 (dialog sans aria-labelledby), 25 (titre en div, pas en titre de section), 19 (fermeture sur clic dont la cible est le dialog, sans vérifier le mousedown ni une saisie en cours), 59 (icône du DialogButton sans aria-hidden))
- **UX-04** — Erreurs reliées aux champs (aria-describedby) et focus sur la première erreur. (preuve : src/components/form.tsx:59 (span .vg-field-error sans id), 71/76/82 (aria-invalid sans aria-describedby, id={name}), 35-41 (aucun focus sur l'erreur après l'échec) ; src/components/watch/RequirementsPanel.tsx:483 et src/components/audits/ProgramTimeline.tsx:256 (Field sans name))
- **UX-05** — Choix depuis la galerie et réduction/nettoyage EXIF partagés (shrinkPhoto) pour toutes les pièces jointes. (preuve : src/components/ReportForm.tsx:258 (capture="environment"), 38-60 (shrinkPhoto local au composant) ; src/components/Attachments.tsx:44-60 (envoi des fichiers d'origine, sans réduction ni nettoyage EXIF))
- **UX-06** — Mises en page 768-1180 px (un seul point de rupture à 760 px aujourd'hui). (preuve : src/app/vigie.css:28-29 (.vg-side width 236px), 194 (seul point de rupture à 760 px) ; src/app/(app)/evenements/page.tsx:97 (minmax(320px) en auto-fit, une seule colonne sous ~946 px) ; src/components/actions/KanbanBoard.tsx:21 (repeat(5, minmax(200px))))
- **UX-07** — Sur petit écran, la fiche s'affiche sous la liste sans défilement ni retour. (preuve : src/app/(app)/evenements/page.tsx:97 (grille auto-fit, fiche sous la liste), 131 (Link scroll={false} sans défilement vers la fiche ni retour) ; src/app/(app)/risques/page.tsx:107 (gridTemplateColumns 'minmax(200px, 216px) minmax(0, 1fr)' sans repli mobile))
- **UX-08** — Pincement pour zoomer et sélection au toucher. (preuve : src/components/sitemap/MapCanvas.tsx:188-197 (gesture.current mono-pointeur), 200-207 (survol seulement au pointermove) ; src/components/sitemap/sitemap.module.css:10 (touch-action: none) ; boutons de zoom existants en MapCanvas.tsx:535-538)
- **UX-09** — Textes secondaires en neutral-600 (#75798c), parfois en 10 px, à mettre au contraste AA : jeton plus contrasté dans vigie.css (nocturne.css reste intact). (preuve : src/app/nocturne.css:25 (--color-neutral-600 #75798c, à ne pas modifier) ; texte en neutral-600 dans src/app/vigie.css:49 (.vg-eyebrow 10px), 182 ; src/components/Sidebar.tsx:123 ; src/components/actions/ActionDetail.tsx:181 ; src/components/watch/parts.tsx:53 ; src/components/prevention/parts.tsx:79 ; src/components/skills/SkillMatrix.tsx:417 ; src/components/Attachments.tsx:81,121)
- **UX-10** — Icônes décoratives en aria-hidden, boutons à icône seule nommés, infobulles accessibles au clavier. (preuve : &lt;i className="ph …"> sans aria-hidden : src/components/Sidebar.tsx:56,58,88 ; src/components/Dialog.tsx:59 ; src/components/PageHeader.tsx:18 ; src/components/NotificationBell.tsx:32. Bouton à icône seule nommé par title : src/components/risks/UnitDialogs.tsx:74 (label="" + tooltip). Infobulles en title : src/components/NotificationBell.tsx:51, src/components/Sidebar.tsx:103,122)
- **UX-11** — aria-current, menus clavier (aria-haspopup, flèches, focus), régions nommées, lien d'évitement. (preuve : src/components/Sidebar.tsx:87 (pas d'aria-current), 55-78 et 102-121 (menus sans aria-haspopup, gestion du focus ni flèches), 47 et 82 (aside et nav sans aria-label) ; src/app/(app)/layout.tsx:17-19 (pas de lien d'évitement))
- **UX-12** — Une convention d'URL unique pour filtres, archives et fiche ouverte. (preuve : src/app/(app)/veille/page.tsx:38-41 (archives=1 / statut=archives) ; src/app/(app)/evenements/page.tsx:85 (etat=classes) ; src/components/documents/DocumentRegister.tsx:38-44 (?doc via history.replaceState) ; src/components/skills/SkillMatrix.tsx:62-69,277-278 (filtres en localStorage, recherche en état local) ; src/lib/data/dashboard.ts:66 (KPI vers type=AT sans filtre d'arrêt))
- **UX-13** — Bandeau MissingNotice quand un lien profond vise un élément inconnu, au lieu d'un repli silencieux. (preuve : src/lib/data/review.ts:59-65 (pickReview se rabat sur une autre revue) ; src/lib/data/audits.ts:198-203 (?element / ?constat inconnus ignorés) ; src/app/(app)/apercu-mobile/page.tsx:23-29,40-44 (?sel inconnu → liste) ; src/components/documents/DocumentRegister.tsx:48-58 (aucun bandeau pour un ?doc inconnu))
- **UX-14** — Indicateurs d'attente, erreurs et confirmations après enregistrement. (preuve : src/components/Sidebar.tsx:42,64,115 (useTransition sans pending ni gestion d'erreur pour setSite et setRole) ; src/components/form.tsx:35 (fermeture après succès sans confirmation) ; src/components/sitemap/SiteMapScreen.tsx:110,194-209 (enregistrement sans indicateur) ; même schéma en src/components/watch/ControlsPanel.tsx:304, src/components/prevention/PermitDialogs.tsx:255, src/components/review/ReviewPanel.tsx:35)
- **UX-15** — Tableaux du dossier sans conteneur à défilement horizontal. (preuve : src/components/review/DossierView.tsx:106,114,126,185,… (table.rd-table sans conteneur overflow-x) ; src/components/review/dossier-parts.tsx:95 ; src/app/revue-de-direction/dossier.css:35-39,58-63 (rien sur les tableaux en mobile))
- **UX-16** — Glossaire des indicateurs (TF1, TG…) et entrée « Aide ». (preuve : src/lib/data/dashboard.ts:66 (KPI « TF1 · 12 mois glissants » / « TG » sans définition) ; src/components/Sidebar.tsx:97-125 (aucune entrée Aide) ; seule définition existante : src/components/review/DossierView.tsx:93)

## 18. Conformité réglementaire transverse (CNF)

11 éléments — P2 : 6 · P3 : 5 — charge indicative 15–47 j.

| Réf | Élément | Priorité | Taille | Dépend de |
|---|---|:-:|:-:|---|
| CNF-01 | Registre des dangers graves et imminents | P2 | M | — |
| CNF-02 | Instances CSE / CSSCT | P2 | M | — |
| CNF-03 | Bilan annuel SSCT | P2 | M | — |
| CNF-04 | Évaluation des fournisseurs | P2 | L | — |
| CNF-05 | Contexte et risques du système de management | P2 | M | — |
| CNF-06 | Produits chimiques | P2 | L | — |
| CNF-07 | Satisfaction client | P3 | M | — |
| CNF-08 | Situations d'urgence | P3 | M | — |
| CNF-09 | Communication et sensibilisation | P3 | M | — |
| CNF-10 | EPI | P3 | M | — |
| CNF-11 | Gestion des changements | P3 | M | — |

- **CNF-01** — Registre DGI (L. 4131-1 et L. 4132-2) : type d'événement, salariés exposés, représentant du CSE, avis. (preuve : src/lib/domain.ts:14-23 (EVENT_TYPES : AT, PA, SD, NC, RC, ENV, pas de type DGI) ; src/db/schema.ts:73-108 (events sans champs salariés exposés, représentant du CSE ou avis) ; rg « danger grave|imminent|L. 4132 » dans src : aucun résultat)
- **CNF-02** — Réunions, ordres du jour et PV des instances. (preuve : src/db/schema.ts:164 (duerpVersions.cseConsultedOn, seule donnée CSE) ; src/db/schema.ts:388 (reviews.externalParticipants, texte libre) ; aucune table de réunion CSE/CSSCT parmi les pgTable de src/db/schema.ts)
- **CNF-03** — Bilan annuel santé, sécurité et conditions de travail présenté au CSE (L. 2312-27). (preuve : src/components/review/DossierView.tsx:83-552 (sections ISO 9001 §9.3 uniquement, pas de rapport ni de programme SSCT) ; rg « PAPRIPACT|programme annuel de prévention|rapport annuel » dans src : aucun résultat ; src/lib/data/dashboard.ts (TF1/TG calculés sur hoursWorked du seed))
- **CNF-04** — Fournisseurs comme entité évaluée (ISO 9001 §8.4) au lieu d'une simple origine de NC. (preuve : src/lib/domain.ts:52 (NC_ORIGINS : « Fournisseurs » simple catégorie) ; src/db/schema.ts:91 (events.ncOrigin texte, pas de supplierId) ; src/components/review/DossierView.tsx:178-218 (synthèse existante) ; src/db/schema.ts:430-442 (contractors réservé à la prévention))
- **CNF-05** — Enjeux, parties intéressées, risques et opportunités (ISO 9001 §4.1, §6.1). (preuve : src/components/review/DossierView.tsx:83-552 (sections listées : aucune pour les enjeux, parties intéressées ou risques et opportunités) ; rg « enjeu|parties int|opportunit » dans src : seulement l'aide de ReviewDialogs.tsx:84)
- **CNF-06** — Inventaire des produits, FDS et repérage des CMR. (preuve : src/db/seed.ts:162 (« FDS » en texte libre dans existingMeasures d'un risque) ; aucune table produit chimique ou FDS dans src/db/schema.ts ; rg « CMR » : seulement prevention/model.ts:15 et pp-import/text.ts:32)
- **CNF-07** — Enquêtes de satisfaction en plus du texte libre de la revue. (preuve : src/db/schema.ts:389 (reviews.customerPerception, texte libre) ; src/components/review/ReviewDialogs.tsx:134 ; src/components/review/DossierView.tsx:149-176 (section alimentée par les RC et le texte libre))
- **CNF-08** — Situations d'urgence identifiées et exercices planifiés et tracés. (preuve : src/components/audits/ProgramTimeline.tsx:222 (exercices seulement suggérés comme ligne libre du programme) ; src/lib/domain.ts:167-170 (PLAN_TRACK_KINDS sans type exercice) ; aucune table pour les situations d'urgence dans src/db/schema.ts)
- **CNF-09** — Causeries et quarts d'heure sécurité avec participants. (preuve : src/db/schema.ts:513 (documents.distribution, texte libre) ; src/db/schema.ts:286-319 (trainingTitles et qualifications par personne, pas de session collective) ; rg « causerie|quart d'heure » dans src : aucun résultat)
- **CNF-10** — Dotation des EPI par salarié. (preuve : src/db/seed.ts:214 (« EPI antichute » = contrôle global) ; src/db/schema.ts:232-250 (controls par équipement, pas par salarié) ; design/Vigie.dc.html:745 ; aucune table de dotation EPI)
- **CNF-11** — Demandes de changement maîtrisées (ISO 9001 §8.1.3 / §6.3). (preuve : src/db/schema.ts:634-644 (change_log = journal d'audit des fiches, pas de MOC) ; aucune table de demande de changement dans src/db/schema.ts)

## 19. Questions ouvertes

Décisions attendues du responsable produit avant ou pendant le développement.

### Prérequis et arbitrages externes

| Prérequis ou arbitrage | Éléments concernés |
|---|---|
| Tenant Microsoft Entra ID (inscription de l'application, correspondance groupes ↔ rôles) | TDB-01, EVT-07, EVT-22, DOC-07, INT-04, INT-11, INT-17, SEC-01, SEC-02 |
| API Keystone (projets, affectations) | PRV-20, VEI-17, INT-02, INT-12, INT-15 |
| API Cursus (personnel, formations, effectifs) | EVT-01, PRV-08, DUE-08, HAB-02, HAB-08, HAB-20, DOC-07, INT-03, INT-09 |
| Jeton API Trackdéchets et SIRET des sites | INT-10, DOC-02 |
| Hébergement cible et HTTPS ; moteur de base de production (PGlite ou PostgreSQL) | PRD-01, PRD-05, EVT-20, INT-01 |
| Avis du DPO (données de santé, IA, conservation) | EVT-01, INT-07, SEC-10 |
| Levée des reports (saisie et imports, exports, exigences par poste) | TDB-03, HAB-07, AUD-32, IMP-01, IMP-02, IMP-03, IMP-05, IMP-06, IMP-08, IMP-09 |
| Suivi des consultations CSE | DUE-02 |
| Messagerie ou signature électronique | PRV-18 |

### Questions par élément (40)

**Tableau de bord, échéances et navigation**

- **TDB-01** *Destinataires des alertes : un animateur QHSE par site, tiré des données* — Un animateur par site ou un seul ? Qui reçoit les alertes si le poste est vacant ?
- **TDB-02** *Échéances masquées pour un responsable sans accès à l'écran source* — Vue en lecture de l'élément, ou échéance sans lien ?
- **TDB-03** *Saisie mensuelle des heures travaillées (base du TF1/TG)* — Saisie manuelle ou import (paie, Lucca, Cursus) ? Intérimaires inclus ?
- **TDB-05** *« Mes échéances » consolidées tous sites* — Consolider tous sites pour chaque personne, indépendamment du sélecteur ?
- **TDB-08** *Archivage d'un site : avertir des éléments encore ouverts* — Blocage ou avertissement ? Transfert en masse ?
- **TDB-18** *Recherche globale dans l'en-tête* — Souhaitée alors que la maquette n'en prévoit pas ?

**Événements et signalement terrain**

- **EVT-01** *Accident du travail : victime, circonstances et rubriques de la DAT* — Quels champs tenir dans Vigie et qui peut lire les lésions ?
- **EVT-02** *Clôture d'un AT sans déclaration CPAM : l'obligation disparaît* — Bloquer la clôture ou garder l'échéance visible ?
- **EVT-03** *Délai CPAM : 48 h hors dimanches et fériés, à compter de la connaissance* — Point de départ : date de l'accident ou createdAt ? Fériés Alsace-Moselle ?
- **EVT-04** *Registre des accidents bénins* — Registre par site ou unique ? Visa de la victime dans Vigie ?
- **EVT-05** *Qualification : exiger les données propres au type* — Quels champs obligatoires à la qualification ?
- **EVT-06** *« Nouveau signalement » : lieu de démonstration et cible du bouton* — Cible en production selon le rôle ?
- **EVT-07** *Parcours terrain authentifié et signalement sans compte* — Comment signalent intérimaires et entreprises extérieures ?
- **EVT-08** *Suivi de l'arrêt de travail : périodes, reprise, jours perdus calculés* — Dates d'arrêt saisies par la QHSE ou venues de la paie / Cursus ?
- **EVT-15** *Échéances événement manquantes* — Quels délais retenir ?
- **EVT-16** *Clôture d'un événement réservée aux approbateurs ?* — Qui valide la clôture ?
- **EVT-18** *Formulaire terrain : choix du site et QR code périmé* — Code de poste stable indépendant de l'id de zone ?
- **EVT-21** *File d'attente hors ligne des signalements* — Ajouter date et heure au formulaire terrain ?
- **EVT-28** *Suivi d'un signalement anonyme par code* — Risque de ré-identification acceptable ?

**Plan d'actions**

- **ACT-01** *Rattacher les actions Prévention, Documents et Environnement par un vrai lien* — Colonnes dédiées ou table action_links ? Origine verrouillée ?
- **ACT-09** *Report d'échéance motivé et échéance initiale conservée* — Motif obligatoire et report réservé aux approbateurs ?
- **ACT-10** *Date, auteur et commentaire de réalisation* — Preuve obligatoire ?
- **ACT-13** *Jugement « Efficacité insuffisante » et indépendance du vérificateur* — Jugement réservé aux approbateurs ?

**Prévention et carte du site**

- **PRV-01** *Écarts R. 4512-6 passés non comptés* — Écart passé dans le badge ou seulement dans les indicateurs ?
- **PRV-02** *Contenu réglementaire du plan incomplet (R. 4512-8 et R. 4512-9)* — Champs structurés ou sections libres du modèle importé ?
- **PRV-04** *Traçabilité de la délivrance, de la check-list et de la clôture des permis* — Interdire la clôture avant la fin des 2 h de surveillance ?
- **PRV-05** *Protocoles de sécurité de chargement et déchargement* — Transporteurs gérés comme entreprises extérieures ?
- **PRV-06** *Inspection commune « préalable » acceptée après le début des travaux* — Refus strict ou écart tracé ?
- **PRV-08** *Intervenants des permis reliés au personnel et aux habilitations* — Quels titres par type de permis ?
- **PRV-09** *Dossier entreprise extérieure : pièces de vigilance, intervenants, accueil* — Vigilance suivie par les achats ?
- **PRV-13** *Cumul des heures d'une entreprise extérieure sur 12 mois* — Par opération ou cumul ?
- **PRV-15** *Permis complémentaires : consignation, espace confiné, hauteur, fouille* — Permis prévus par PR-QHSE-005 ?
- **PRV-20** *Plans de prévention reçus des clients* — À suivre dans Vigie ?

**Risques / DUERP**

- **DUE-01** *Mise à disposition du DUERP aux salariés, anciens salariés et instances* — Tout le DUERP ou l'unité du salarié ?
- **DUE-02** *PAPRIPACT : programme annuel de prévention* — Champs coût et ressources sur toutes les actions ?
- **DUE-04** *Annulation d'une action : détachement absent de l'historique du risque* — Garder l'action annulée grisée ?
- **DUE-07** *Réévaluation après accident et mise à jour du DUERP déclenchée* — Seuil de gravité imposant une nouvelle version ?
- **DUE-10** *Contenu d'une version figé à la validation* — État au jour de la validation ou de l'archivage ?

**Habilitations et formations**

- **HAB-02** *Suivi de l'état de santé au travail : VIP, SIR, aptitude, reprise* — Tenu dans Cursus ou dans Vigie ?
- **HAB-05** *Sortie d'un salarié : responsabilités ouvertes et échéances postérieures* — Bloquer ou réaffecter en masse ?

## 20. Hors périmètre / décidé

Rappel des décisions déjà prises, qui s'appliquent à tous les éléments ci-dessus.

- **Jamais de suppression physique** d'un enregistrement métier tracé : on annule, classe sans suite ou archive, avec un motif obligatoire (qui, quand, pourquoi). Éléments archivés ou annulés masqués par défaut, visibles par filtre. Suppression tolérée seulement pour un brouillon jamais diffusé ou une pièce jointe ajoutée par erreur avant clôture (d'où **AUD-03**, **AUD-36**, **DOC-09**, **PRV-12**, **EVT-19**).
- **Imports et exports reportés** : pas d'import Lucca ni Excel, pas de saisie ni d'import des heures travaillées, pas de nouveaux exports CSV ; les boutons « à venir » restent en place. **TDB-03**, **IMP-01** à **IMP-03**, **IMP-05**, **IMP-06**, **IMP-08** et **IMP-09** attendent la levée de ce report ; **IMP-04** (refonte du CSV existant) et **IMP-07** (impression) n'en dépendent pas.
- **Connecteurs non implémentés** (Entra ID, Keystone, Cursus, Trackdéchets) : les emplacements « à venir » sont conservés. Cursus est la source de vérité RH cible ; Lucca reste la source provisoire du personnel.
- **Rôle Salarié** : ne voit que ses propres données (habilitations, signalements, actions) et peut déclarer réalisée une action dont il est pilote ; **QUA-06** protège ce cloisonnement.
- **Indicateurs calculés, jamais stockés** (TF1/TG, retards, échéances, statuts) dans `src/lib/queries.ts`.
- **Exigences par poste** : hors périmètre jusqu'ici ; **HAB-07** demande l'arbitrage.
- **Anciennement hors périmètre, désormais au backlog** : recherche globale (**TDB-18**), tests et CI (**QUA-01** à **QUA-08**), dates relatives du jeu de démonstration (**QUA-20**).
- **`src/app/nocturne.css`** est une copie du design system, à ne pas modifier : les corrections visuelles passent par `src/app/vigie.css` (**UX-09**).
