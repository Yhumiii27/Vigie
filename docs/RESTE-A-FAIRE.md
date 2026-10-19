# Vigie — reste à faire (développement)

*Arrêté au 10/10/2026, après le commit `e8e3a3c` (« Compléter les écrans de Vigie : traçabilité, échéances et liens entre modules ») ; statuts mis à jour le 11/10/2026 (lot 1), le 12/10/2026 (lot 2), puis le 15/10/2026 : refonte des actions QSE alignée sur Power Apps, feuille de route réorganisée par classe de dépendance et livraison du paquet 1 (refonte des actions QSE), puis le 17/10/2026 : livraison du paquet 2 (suites de la refonte des actions, hors UX-05, UX-06 et éléments PA), du paquet 3 (traçabilité et journal) et du paquet 4 (cohérence des données et corrections), puis le 18/10/2026 : livraison du paquet 5 (conformité réglementaire, hors aptitude médicale de HAB-10).*

**État du logiciel après les lots 1 et 2 (12/10/2026).** Les écrans de la maquette sont en place (tableau de bord et « À faire », événements et signalement terrain, plan d'actions, DUERP, habilitations, veille et contrôles, audits et revue de direction, prévention et carte du site, documents maîtrisés, environnement), avec annulation, archivage et classement motivés, journal des modifications, échéances transverses, badges et liens entre modules. Le lot 1 rend Vigie déployable : mode démonstration explicite (`VIGIE_DEMO=1` : sélecteur de rôle, jeu de démonstration, `VIGIE_TODAY`, aperçu mobile ; `npm run dev` et l'application Mac), PostgreSQL en production et PGlite en démonstration, connexion Microsoft Entra ID (OIDC + PKCE, session chiffrée, `src/proxy.ts`), rôles applicatifs et périmètre de sites, responsable QHSE par site, contrôle de l'hôte, CSP et cookies, données de santé des AT restreintes, signalement terrain sans compte par jeton de poste, image Docker et `docker-compose.yml`, sauvegardes chiffrées (dont la sauvegarde avant migration) et pièces jointes chiffrées au repos, contrôle des migrations, tests Vitest et CI GitHub Actions ; exploitation : [`docs/EXPLOITATION.md`](EXPLOITATION.md). Le lot 2 fiabilise et met en conformité : rubriques de la déclaration d'accident du travail (lésions et pièces médicales restreintes), délai CPAM de 48 h hors dimanches et fériés, déclaration selon la victime (entreprise de travail temporaire informée sous 24 h pour un intérimaire, TF1/TG sur les accidents de l'effectif), clôture d'un AT subordonnée à la déclaration, registre des accidents bénins par site, qualification exigeante, écarts R. 4512-6 passés et contenu réglementaire des plans de prévention, fiche imprimable des permis, DUERP en lecture pour tous avec registre des demandes d'accès et impression, PAPRIPACT, programme d'audit lié aux revues (report, annulation), contributions de revue, dossier de revue figé à la séance, échéances du responsable sur tout son périmètre et sur un écran fermé, TF1/TG sur 12 mois complets, actions rattachées à leur source par un vrai lien (avec reprise), mentions de l'arrêté du 31 mai 2021 au registre des déchets, navigation mobile et fenêtres accessibles, et lève les réserves de sécurité et d'exploitation du lot 1 ; une seule migration (`drizzle/0004_compliance.sql`). Tests Vitest : 72 fichiers (597 tests, dont 39 fichiers d'intégration rejoués sur PostgreSQL) et 2 fichiers de bout en bout sur le serveur construit. Aucun connecteur Keystone, Cursus ou Trackdéchets n'existe encore, et les seuls échanges de fichiers restent l'import des plans de prévention et les exports CSV du DUERP et du registre des déchets. La connexion Entra n'a été éprouvée qu'avec un fournisseur OIDC factice : l'inscription de l'application dans le tenant reste à faire.

**Alignement sur Power Apps (15/10/2026).** Le service QHSE suit aujourd'hui ses actions dans l'application Power Apps « Créer Actions QSE ». Son formulaire (reçu le 15/10/2026), deux tours de réponses du service QHSE et les arbitrages de l'utilisateur du même jour fixent la refonte du plan d'actions de Vigie, décrite dans [`docs/specs/actions-qse.md`](specs/actions-qse.md) : 24 éléments ajoutés au [§ 5](#5-plan-dactions-act) (ACT-17 à ACT-40), dont 16 prêts à développer qui forment, avec PRD-12, le premier paquet de la feuille de route. Arbitrages du 15/10/2026 : rappel du mercredi dans Vigie **et** par e-mail (la notification à la création reste dans Vigie seulement) ; rôle du responsable validé (il consulte ses actions, commente dans le fil et joint des preuves ; l'avancement est géré par le service QHSE) ; format des numéros AC-AA#### gardé pour plus tard, le service QHSE recherchant la règle actuelle ; extraction des actions Power Apps fournie plus tard par le propriétaire de l'application, pour reprendre les actions existantes avec leurs numéros AC. D'autres formulaires Power Apps suivront : les éléments des écrans concernés portent la marque **PA** et pourront évoluer à leur réception.

**Avancement.** 129 éléments livrés (✅) : les 23 du lot 1 (TDB-01 et SEC-06 terminés au lot 2) et les 28 du lot 2, plus PRD-09, PRD-11, PRD-15, QUA-13 (avec le lot 1), EVT-23, AUD-30, SEC-14 (avec le lot 2), DUE-11 et AUD-10 (livrés avec DUE-01 et AUD-01, constatés le 15/10/2026), et les 25 du paquet 1 de la refonte des actions QSE (15/10/2026 : ACT-13, ACT-17 à ACT-28, ACT-30 à ACT-33, ACT-35, ACT-37, ACT-38 — clos sans objet —, ACT-40 ; avec lui EVT-25, EVT-26, DUE-04, HAB-11), et les 7 du paquet 2 (17/10/2026 : ACT-02, ACT-03, ACT-29, TDB-06, AUD-12, PRD-08, QUA-09), et les 13 du paquet 3 (17/10/2026 : TDB-09, EVT-12, PRV-12, DUE-06, HAB-03, VEI-04, VEI-09, DOC-04, DOC-05, DOC-06, DOC-09, DOC-10, SEC-11), et les 11 du paquet 4 (17/10/2026 : TDB-07, EVT-11, PRV-11, DUE-05, HAB-04, VEI-03, VEI-06, AUD-07, AUD-11 et AUD-14 — partiels jusque-là —, AUD-15), et les 13 du paquet 5 (18/10/2026 : EVT-09, EVT-10, EVT-17, PRV-07, DUE-03, VEI-10, VEI-11, AUD-08, AUD-09, AUD-13 — partiel jusque-là —, DOC-12, CNF-03, CNF-05). 16 éléments partiels (◐), qui restent ouverts : PRD-13, SEC-07, QUA-28 (lot 1), SEC-09 (lot 2), TDB-15, UX-11, QUA-25 (constatés le 15/10/2026), PRD-12, EVT-15, UX-06, TDB-12, QUA-23, QUA-26, DOC-13 (paquet 1), QUA-11 (paquet 2), HAB-10 (paquet 5). 11 éléments remplacés (↪) par la refonte des actions : ACT-04 à ACT-11, ACT-14 à ACT-16. Reste : 198 éléments ouverts (P1 : 10 · P2 : 79 · P3 : 109), 216,5–641 j ; par classe : C1 : 122 (104–289 j) · C2 : 41 (54,5–168 j) · C3 : 14 (19,5–60 j) · C4 : 21 (38,5–124 j). Dans les tableaux, le statut précède l'intitulé et la colonne « Classe » donne la dépendance ; sous chaque élément, une note décrit ce qui a été livré et les réserves, ce qui reste, ou l'effet de la refonte des actions. Les preuves `fichier:ligne` décrivent l'état au commit `e8e3a3c`, sauf pour ACT-17 à ACT-42 (état au 15/10/2026).

**Réserves des lots 1 et 2**, à reprendre dans les paquets de la feuille de route (détail sous chaque élément) :

- **SEC-01, SEC-02, SEC-03** — un changement de rôle ou de groupe Entra s'applique à la connexion suivante (12 h au plus), et le site de rattachement est figé dans la session à la connexion ; au-delà de la limite de groupes du jeton (overage), les sites accordés par groupe sont ignorés (pas d'appel Microsoft Graph) ; la signature du jeton d'identité n'est pas vérifiée (canal TLS jugé suffisant ; sinon `enableNonRepudiationChecks`). Depuis le lot 2, une première connexion exige l'adresse vérifiée (`email`, `xms_edov`) d'un domaine de `VIGIE_EMAIL_DOMAINS`, direction comprise : le tenant doit déclarer ces revendications facultatives.
- **PRD-01, QUA-01** — l'image Docker fige les origines admises des server actions à la construction (le reverse proxy doit transmettre `Host` ou `X-Forwarded-Host`) ; connexion Entra non éprouvée dans le conteneur ; la CI n'a pas encore tourné sur GitHub.
- **ACT-01** — après le déploiement de la migration 0004 sur une base existante : sauvegarde, puis `vigie-db reprise-liens` (essai) et `--appliquer` (`docs/EXPLOITATION.md` § 6) ; sans reprise, les actions existantes n'apparaissent plus sur leur fiche source.
  **Réserves levées (15/10/2026)** — la résolution d'une référence texte n'existe plus (lien explicite seulement, posé à la création par le QHSE) ; `reprise-liens` lit `actions.legacy_origin` après 0005.
- **SEC-09** (◐) — métadonnées EXIF des photos retirées côté navigateur seulement ; non traités : suivi d'un signalement anonyme par code (EVT-28), « Régénérer le QR » depuis l'éditeur de zones de la carte.
- **Textes à faire valider par le responsable QHSE** — libellés de l'arrêté du 31 mai 2021 et des cinq qualifications de déchets (**DOC-02**), rubriques R. 4512-9 et R. 4511-10 du plan de prévention (**PRV-02**).
- **PRV-02, PRV-03** — un plan de prévention obligatoire ne peut plus être signé tant qu'une des six rubriques requises est vide (plans existants à compléter) ; la date de délivrance d'un permis est tirée du journal en attendant une colonne (**PRV-04**).
- **DOC-02** — non traités : courtier et négociant, éco-organisme, numéros de notification et de document de mouvement, plusieurs transporteurs par enlèvement, déclaration RNDTS / Trackdéchets (**INT-10**) ; taux de valorisation toujours calculé d'après le code R/D.
- **UX-01, UX-03** — rendu à 375 px et 1 280 px à vérifier dans un navigateur réel ; `/evenements` déborde encore à 375 px (lignes de la liste) ; `autoFocus` ne peut pas orienter le premier champ d'une fenêtre.
- **TDB-05** — l'état lu d'une échéance reste attaché à son lien d'origine (les échéances de coactivité, dont le lien porte désormais `&site=`, réapparaissent une fois non lues).
- **DUE-01, TDB-01** — le Salarié voit sur `/risques` les références, intitulés, échéances et statuts des actions de prévention du DUERP ; un chef de service ou de projet responsable QHSE d'un site reçoit aussi les alertes de niveau DUERP (consultation du CSE, PAPRIPACT), que seuls les validateurs traitent.
- **AUD-03, AUD-06** — `savePlanItem` ne modifie plus la planification d'un élément existant (« Reporter… » seulement) ; la première saisie du compte rendu d'une revue exige « Tous les sites ».
- **Revue du lot 2 : points mineurs non corrigés** — **SEC-06** : pièces médicales gardées une heure dans le cache du navigateur (poste partagé ; levé au paquet 3 : servies sans cache) ; **EVT-01** : aide de saisie sur les lésions limitée à l'intitulé et à la description, pièces médicales d'un AT requalifié invisibles ; **EVT-03** : date d'envoi des réserves motivées au lieu de leur réception, retard non signalé ; **PRV-01** : plan devenu obligatoire en cours de travaux compté comme écart ; **DUE-02** : programme figé sans rappel des mentions de L. 4121-3-1 ; **AUD-04** : fiche résumée d'une action hors périmètre visible dans « Mes contributions » (revue clôturée) ; **ACT-01** : référence saisie en texte rattachée sans contrôle `canEdit` de l'écran source (tombe si la création reste réservée au QHSE, ACT-22), reprise ouverte aux actions postérieures à 0004 et sans trace sur la source, création depuis une filière absente de son historique ; **SEC-02** : « Tous les sites » proposé à tort par « Créer l'action » sur plusieurs écrans (refusé à l'enregistrement ; levé par ACT-20, site unique) ; **UX-03** : focus perdu à la fermeture du panneau des notifications.
- **Journal** — **DOC-04**, **DOC-10** et **VEI-04** livrés au paquet 3 (17/10/2026) ; restent **VEI-05** (action clôturée, réserve ouverte), **DOC-03** (relances à un propriétaire sorti) et **DOC-20** (filières d'un site archivé proposées).

**Contenu.** 338 éléments : 309 vérifiés dans le code à l'inventaire du 10/10/2026, chacun avec sa preuve `fichier:ligne` (chemins depuis la racine du dépôt, lignes au commit `e8e3a3c`), 24 ajoutés le 15/10/2026 par la refonte des actions QSE et 5 après les réponses du service QHSE du même jour. Charge totale indicative à l'inventaire : 309,5–895 jours, soit de l'ordre de 1,4 à 4 années-développeur ; les lots 1 et 2 en représentaient 54–158 j. Après le lot 2 : 252–730 j ; au 15/10/2026, après l'ajout de la refonte (22,5–64 j) et le retrait des éléments livrés ou remplacés : 266–773 j ; après le paquet 1 et les 5 éléments ajoutés : 250–730 j.

**Lecture.**

- **Priorité** — **P0** : bloque une mise en production. **P1** : à traiter avant l'usage réel (obligation réglementaire, donnée fausse ou perdue, droit d'accès). **P2** : important, à planifier. **P3** : confort, dette, amélioration.
- **Taille** — **S** < 1 j · **M** 1–3 j · **L** 3–10 j · **XL** > 10 j (aucun élément XL : les gros sujets sont découpés). Estimations indicatives pour un développeur qui connaît le code, hors recette et coordination ; la charge d'un ensemble est la somme des bornes basses (S = 0,5 j) et hautes.
- **Réf** — préfixe du groupe + numéro, stable : à citer dans les tickets et les commits. Dans chaque groupe, les éléments sont triés par priorité.
- **Dépend de** — prérequis technique ou décision externe ; les décisions et éléments attendus sont regroupés en [§ 19](#19-questions-ouvertes).
- **Statut** — ✅ livré (réserves éventuelles dans la note sous l'élément) · ◐ partiel : l'élément reste ouvert, la note dit ce qui a été livré et ce qui reste · ↪ remplacé : repris par un élément plus récent (cité dans la colonne « Classe » et dans la note), ne compte plus dans le reste à faire · sans marque : à faire.
- **Classe** — ce qui conditionne le démarrage : **C1** prêt à développer (aucune dépendance externe, décisions prises) · **C2** à valider (une décision interne rapide du responsable produit ou du service QHSE ; question au § 19) · **C3** en attente d'éléments (informations, documents ou données à fournir : règle, extraction, procédure, avis du DPO) · **C4** dépend d'un tiers technique (système externe ou infrastructure : API, tenant Microsoft, messagerie, hébergement). La réponse fait passer l'élément en C1, ou en C3 ou C4 si elle appelle un document ou un système. « — » pour un élément livré.
- **PA** — accolé à la classe : l'élément touche un écran dont le formulaire Power Apps est attendu (événements et NC, prévention, DUERP, habilitations, veille, audits, documents, environnement). Il reste développable, mais son contenu peut changer à réception du formulaire (voir § 2).

## 1. Synthèse

Éléments encore ouverts au 18/10/2026, après les lots 1 et 2, l'ajout de la refonte des actions QSE, la livraison de ses paquets 1 et 2 et celle des paquets 3, 4 et 5 (les partiels ◐ comptent pour leur taille entière ; les éléments remplacés ↪ ne comptent plus). Aucun P0 ouvert : les sept bloquants ont été livrés au lot 1. Inventaire initial (10/10/2026) : 309 éléments (P0 : 7 · P1 : 50 · P2 : 129 · P3 : 123), 135 / 140 / 34, 309,5–895 j ; ajoutés le 15/10/2026 : 24 éléments (ACT-17 à ACT-40, P1 : 21 · P2 : 3), 22,5–64 j, puis 5 après les réponses du service QHSE (ACT-41, ACT-42, EVT-29, HAB-21, PRV-21 ; P2 : 3 · P3 : 2), 4,5–11 j.

| Groupe | Préfixe | P1 | P2 | P3 | Ouverts | dont ◐ | C1 | C2 | C3 | C4 | S / M / L | Charge restante (j) | ✅ Livrés |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|:-:|--:|--:|
| [Tableau de bord, échéances et navigation](#3-tableau-de-bord-échéances-et-navigation-tdb) | TDB | 1 | 1 | 9 | **11** | 2 | 8 | 3 | · | · | 7 / 4 / 0 | 7,5–19 | 7 |
| [Événements et signalement terrain](#4-événements-et-signalement-terrain-evt) | EVT | · | 11 | 3 | **14** | 1 | 7 | 7 | · | · | 4 / 8 / 2 | 16–48 | 15 |
| [Plan d'actions](#5-plan-dactions-act) | ACT | 3 | 1 | 2 | **6** | · | 1 | · | 3 | 2 | 3 / 2 / 1 | 6,5–19 | 25 |
| [Prévention et carte du site](#6-prévention-et-carte-du-site-prv) | PRV | · | 6 | 9 | **15** | · | 4 | 8 | 2 | 1 | 6 / 6 / 3 | 18–54 | 6 |
| [Risques / DUERP](#7-risques--duerp-due) | DUE | · | 4 | 9 | **13** | · | 10 | 2 | · | 1 | 6 / 6 / 1 | 12–34 | 7 |
| [Habilitations et formations](#8-habilitations-et-formations-hab) | HAB | · | 8 | 9 | **17** | 1 | 10 | 4 | · | 3 | 6 / 8 / 3 | 20–60 | 4 |
| [Veille et contrôles](#9-veille-et-contrôles-vei) | VEI | · | 3 | 7 | **10** | · | 9 | · | · | 1 | 4 / 6 / 0 | 8–22 | 8 |
| [Audits et revue de direction](#10-audits-et-revue-de-direction-aud) | AUD | · | 2 | 18 | **20** | · | 19 | 1 | · | · | 10 / 10 / 0 | 15–40 | 16 |
| [Documents et environnement](#11-documents-et-environnement-doc) | DOC | · | 4 | 11 | **15** | 1 | 8 | 4 | 2 | 1 | 8 / 4 / 3 | 17–50 | 8 |
| [Intégrations](#12-intégrations-int) | INT | 4 | 6 | 7 | **17** | · | 3 | · | 2 | 12 | 2 / 8 / 7 | 30–96 | · |
| [Imports, exports et impression](#13-imports-exports-et-impression-imp) | IMP | 1 | 6 | 2 | **9** | · | 2 | 7 | · | · | 2 / 5 / 2 | 12–37 | · |
| [Production et exploitation](#14-production-et-exploitation-prd) | PRD | 1 | 3 | · | **4** | 2 | 4 | · | · | · | 1 / 3 / 0 | 3,5–10 | 11 |
| [Sécurité et RGPD](#15-sécurité-et-rgpd-sec) | SEC | · | 5 | 1 | **6** | 2 | 4 | · | 2 | · | 2 / 3 / 1 | 7–21 | 8 |
| [Qualité, tests, performance et dette technique](#16-qualité-tests-performance-et-dette-technique-qua) | QUA | · | 4 | 15 | **19** | 5 | 18 | · | 1 | · | 7 / 11 / 1 | 17,5–50 | 9 |
| [UX et accessibilité](#17-ux-et-accessibilité-ux) | UX | · | 11 | 2 | **13** | 2 | 13 | · | · | · | 3 / 9 / 1 | 13,5–40 | 3 |
| [Conformité réglementaire transverse](#18-conformité-réglementaire-transverse-cnf) | CNF | · | 4 | 5 | **9** | · | 2 | 5 | 2 | · | 0 / 7 / 2 | 13–41 | 2 |
| **Total** | | **10** | **79** | **109** | **198** | 16 | **122** | **41** | **14** | **21** | 71 / 100 / 27 | **216,5–641** | **129** |

Plus 11 éléments remplacés (↪ ACT-04 à ACT-11, ACT-14 à ACT-16 : repris par les éléments de la refonte, 7–17 j), comptés ni ouverts ni livrés.

Par classe de dépendance et par priorité (ouverts et partiels ; contenu et ordre de réalisation au [§ 2](#2-feuille-de-route-par-classe-de-dépendance)) :

| Classe | P1 | P2 | P3 | Ouverts | dont PA | S / M / L | Charge (j) |
|---|--:|--:|--:|--:|--:|:-:|--:|
| **C1** Prêt à développer | 1 | 41 | 80 | **122** | 66 | 56 / 61 / 5 | 104–289 |
| **C2** À valider | 2 | 24 | 15 | **41** | 36 | 9 / 23 / 9 | 54,5–168 |
| **C3** En attente d'éléments | 2 | 6 | 6 | **14** | 7 | 5 / 5 / 4 | 19,5–60 |
| **C4** Dépend d'un tiers technique | 5 | 8 | 8 | **21** | 14 | 1 / 11 / 9 | 38,5–124 |
| **Total** | **10** | **79** | **109** | **198** | 123 | 71 / 100 / 27 | **216,5–641** |

Refonte des actions QSE (ACT-17 à ACT-42) : paquet 1 livré le 15/10/2026 ; restent ACT-34, ACT-36, ACT-39, ACT-41 et ACT-42 (C3 : 3 · C4 : 2, 5,5–17 j). Les P1 restants attendent une décision (TDB-03, IMP-01 : C2), des éléments (ACT-36, ACT-39 : C3) ou un tiers technique (INT-01 à INT-04, ACT-34 : C4) ; PRD-12 (◐, C1) garde ses autres tâches planifiées.

Par type (au 15/10/2026, avant le paquet 2 ; répartition par type des éléments de la refonte estimée : les types ne figurent pas dans les tableaux) :

| Type | Ouverts | dont P1 | dont C1 | ✅ Livrés |
|---|--:|--:|--:|--:|
| fonctionnel | 65 | 2 | 45 | 26 |
| conformité-réglementaire | 56 | 0 | 31 | 11 |
| bug | 26 | 0 | 25 | 18 |
| ux-accessibilité | 28 | 0 | 28 | 3 |
| intégration | 26 | 5 | 6 | 1 |
| dette-technique | 17 | 0 | 16 | 2 |
| import-export | 8 | 2 | 0 | · |
| production | 6 | 1 | 6 | 10 |
| qualité-tests | 4 | 0 | 3 | 6 |
| sécurité | 3 | 0 | 3 | 8 |
| performance | 3 | 0 | 3 | · |

## 2. Feuille de route par classe de dépendance

Depuis le 15/10/2026, la feuille de route range les éléments ouverts par classe de dépendance, de ce qui peut être fait sans attendre à ce qui attend une validation, des informations ou un système externe (définitions dans « Lecture », en tête du document). La classe 1 est découpée en paquets à réaliser dans l'ordre ; les classes 2 à 4 sont regroupées par décision à prendre, par élément attendu et par système externe, avec les éléments que chacun débloque. Une réponse fait passer les éléments cités en classe 1 (ou en classe 3 ou 4 quand elle appelle un document ou un système) : on les insère alors dans le paquet du même thème.

Règles communes : les éléments d'un même paquet qui ajoutent une colonne ou une table partagent une migration drizzle (une migration publiée ne se modifie jamais) ; toute nouvelle server action est testée pour ses droits, son site, son motif et son journal (`test/integration/`).

**Marque PA** — 123 éléments ouverts (C1 : 66 · C2 : 36 · C3 : 7 · C4 : 14) touchent un écran dont le formulaire Power Apps est attendu (événements et NC, prévention, DUERP, habilitations, veille, audits, documents, environnement). Ils restent développables, mais leurs champs et leurs règles peuvent changer à réception du formulaire : dans un paquet, commencer par les éléments sans marque, et placer après la réception du formulaire les éléments PA de son domaine s'il est annoncé à brève échéance. Le formulaire des actions, déjà reçu, n'en porte plus.

### Livré

- **Lot 1 — Mise en production (11/10/2026)** — 23 éléments (P0 : 7 · P1 : 16), 26,5–79 j : les sept bloquants (PRD-03, SEC-03, PRD-04, PRD-01, PRD-02, SEC-01, SEC-02), PRD-05, PRD-06, PRD-07, SEC-04, SEC-05, SEC-06, TDB-01, EVT-06, EVT-07, QUA-01 à QUA-07 ; livrés avec lui : PRD-09, PRD-11, PRD-15, QUA-13 ; partiels : PRD-13, SEC-07, QUA-28 (◐). Instance hébergée (image Docker, PostgreSQL), authentifiée (Entra ID, éprouvée avec un fournisseur factice), sauvegardée, sans données de démonstration, avec intégration continue et premiers tests.
- **Lot 2 — Fiabilisation et conformité prioritaire (12/10/2026)** — 28 éléments (P1), 27,5–79 j : TDB-02, TDB-04, TDB-05, EVT-01 à EVT-05, ACT-01, PRV-01 à PRV-03, DUE-01, DUE-02, HAB-01, VEI-01, VEI-02, AUD-01 à AUD-06, DOC-01, DOC-02, UX-01 à UX-03 ; terminés : TDB-01 et SEC-06 ; livrés avec lui : EVT-23, AUD-30, SEC-14 ; partiels : SEC-09, DOC-04, DOC-10 (◐) ; réserves de sécurité et d'exploitation du lot 1 levées. Une seule migration (`drizzle/0004_compliance.sql`), suivie de la reprise des liens d'origine des actions (`vigie-db reprise-liens`, `docs/EXPLOITATION.md` § 6) ; points mineurs non corrigés en tête du document.
- **Constaté le 15/10/2026** — DUE-11 (vue imprimable du DUERP, livrée avec DUE-01) et AUD-10 (journal des changements du programme faits par la revue, livré avec AUD-01) : ✅ ; TDB-15, AUD-11, AUD-14, UX-11, QUA-25 : ◐.
- **Paquet 1 — Refonte des actions QSE (15/10/2026)** — 19 éléments (P1 : 18 · P2 : 1) : ACT-17 à ACT-28 (dont ACT-22, décidé et appliqué), ACT-30 à ACT-33 (dont ACT-31, ajouté au paquet par la réponse du service QHSE), ACT-35, ACT-37 (décidé et appliqué), ACT-40 ; tranchés avec lui : ACT-13 ✅, ACT-38 clos sans objet, ACT-02 et ACT-29 décidés (C1) ; livrés avec lui : EVT-25, EVT-26, DUE-04, HAB-11 ; partiels : PRD-12, ACT-03, EVT-15, AUD-12, AUD-13, PRD-08, UX-06, TDB-06, TDB-12, QUA-09, QUA-11, QUA-23, QUA-26, DOC-13 (◐). Une seule migration (`drizzle/0005_actions_qse.sql`) porte le modèle et la reprise ; réponses du service QHSE du 15/10/2026 appliquées (création réservée au QHSE, 24 sources, aucune action QSE depuis Habilitations ni Prévention, autovérification admise, rappel du mercredi avec les Terminées) ; spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md).
- **Paquet 2 — Suites de la refonte des actions (17/10/2026)** — 7 éléments livrés (P2, C1) : ACT-02 (« Rattacher un élément » / « Détacher » un lien complémentaire depuis la fiche action, QHSE seulement), ACT-03 (historique de l'action tenu par les autres modules : site d'un événement, réserves d'un contrôle, programme de prévention), ACT-29 (onglet « Statistiques » de `/actions`, calculé, jamais stocké), TDB-06 (suite d'un signalement notifiée au déclarant), AUD-12 (une action relève d'une seule revue ; dossier d'une revue clôturée figé), PRD-08 (références des autres fiches tirées sous verrou dans la transaction de création), QUA-09 (jours de Paris partout) ; partiel : QUA-11 (veille et prévention ; restent risques, audits, environnement). Aucune migration. Restent du paquet : UX-05, UX-06 et les éléments PA (EVT-22, VEI-05, HAB-06, IMP-07).
- **Paquet 3 — Traçabilité et journal (17/10/2026)** — 13 éléments livrés (P2, C1) : TDB-09 (règle Seveso / plan de prévention d'un site journalisée, historique du site), EVT-12 (analyse, méthode et réception des signalements au journal), PRV-12 (carte du site journalisée, activité annulée avec motif au lieu d'être supprimée, `requireInSite`), DUE-06 (historiques des unités et des versions du DUERP), HAB-03 (exigences, attestations et fiche salarié journalisées, historiques de la case et de la fiche), VEI-04 (rattachements des exigences et contrôles dans leur historique), VEI-09 (« Dernier contrôle » et réserves changés par un contrôle enregistré seulement), DOC-04 (cycle de vie des documents journalisé, historique de la fiche), DOC-05 (pas de soumission ni d'approbation sans fichier), DOC-06 (renvoi en brouillon motivé, échéance de l'auteur), DOC-09 (filière archivée avec motif, plus supprimée), DOC-10 (relevés de consommation journalisés), SEC-11 (journal des consultations : pièces jointes, données de santé d'un AT, registre des accidents bénins). Historiques chargés à l'ouverture (`LazyChangeLog`, `loadEntityHistory` étendu, mêmes droits que l'écran). Une migration (`drizzle/0006_traceability_journal.sql` : colonnes d'annulation des activités, d'archivage des filières, de renvoi des versions, table `access_log` ; colonnes et table ajoutées, sans reprise). Réserves : zones et voies de la carte restent supprimables (journalisées) ; conservation du journal des consultations à fixer (SEC-10).
- **Paquet 4 — Cohérence des données et corrections (17/10/2026)** — 11 éléments livrés (P2, C1), avec DOC-05 (livré au paquet 3) : TDB-07 (état lu avec gravité et date d'échéance, retards triés par ancienneté ; les échéances déjà lues réapparaissent non lues une fois), EVT-11 (analyse des causes ni vidée ni remplacée par une méthode vide après « Actions », exigée à la clôture), PRV-11 (plan, permis et activités de la carte cohérents après modification), DUE-05 (unité d'un site archivé gardée sur son site, restauration refusée), HAB-04 (recyclage repris porté par l'action, conservé clos ou abandonné, historique dans la case), VEI-03 (échéance d'une exigence suivie par des contrôles = prochain contrôle), VEI-06 (contrôles rattachés et indicateur R. 4512-6 sur tout le périmètre), AUD-07 (plus de libellé d'audit codé en dur), AUD-11 (constats sur un audit réalisé, « Réalisé le » jamais perdu), AUD-14 (participants, synthèse et pilotes exigés avant le visa), AUD-15 (visa réservé à la direction). Une migration (`drizzle/0007_qualification_renewals.sql` : colonnes `actions.qualification_person_id` / `qualification_title_id` remplies depuis `qualification_requirements.renewal_action_id`, colonne supprimée ; `docs/EXPLOITATION.md` § 6).
- **Paquet 5 — Conformité réglementaire (18/10/2026)** — 13 éléments livrés (P2, C1, PA) : EVT-09 (maladie professionnelle réservée aux rôles habilités aux données de santé, questionnaire employeur à 30 jours francs ; accident de trajet hors TF1 / TG), EVT-10 (synthèse imprimable de la DAT et feuille d'accident), EVT-17 (traitement des produits non conformes, quantité, coût de non-qualité), PRV-07 (date, nom et qualité des signataires), DUE-03 (transmission au SPST, dépôt sur le portail), VEI-10 (sites concernés, lien officiel, texte joint), VEI-11 (résultat du contrôle, défavorable signalé), AUD-08 (cycle de 3 ans, renouvellement, suspension), AUD-09 (écart majeur, observation, délai de réponse), AUD-13 (objectifs QHSE mesurables calculés ; cible TF1 tirée de l'objectif — partiel jusque-là), DOC-12 (BSD refusé ou accepté partiellement), CNF-03 (bilan annuel SSCT d'après les statistiques d'ACT-29), CNF-05 (contexte, parties intéressées, risques et opportunités) ; partiel : HAB-10 (prérequis entre titres, catégories et niveaux ; aptitude médicale selon HAB-02). Une migration (`drizzle/0010_regulatory_compliance.sql` : colonnes ajoutées, toutes facultatives ou avec valeur par défaut, et tables `qhse_objectives`, `context_items`, sans reprise ; `pub_journal` écarte aussi les maladies professionnelles ; `docs/EXPLOITATION.md` § 6). Points appliqués par défaut et libellés à relire par le service QHSE : [§ 19](#19-questions-ouvertes).

### Vue d'ensemble

| Classe | Éléments | dont P1 | Charge (j) | Démarrage |
|---|--:|--:|--:|---|
| **C1** Prêt à développer | 122 | 1 | 104–289 | tout de suite, dans l'ordre des paquets 2 à 15 (paquets 1, 3, 4 et 5 livrés — paquet 5 hors aptitude médicale de HAB-10 —, paquet 2 livré hors UX-05, UX-06 et éléments PA) |
| **C2** À valider | 41 | 2 | 54,5–168 | à la réponse (décisions ci-dessous, questions au [§ 19](#19-questions-ouvertes)) |
| **C3** En attente d'éléments | 14 | 2 | 19,5–60 | à réception de l'élément attendu |
| **C4** Dépend d'un tiers technique | 21 | 5 | 38,5–124 | quand le système externe est disponible |
| **Total** | **198** | **10** | **216,5–641** | |

### Classe 1 — Prêt à développer (122 éléments, 104–289 j)

Aucune dépendance externe et décisions prises. Ordre recommandé : la refonte des actions d'abord (paquet 1, livré le 15/10/2026), puis ses suites (paquets 2 et 10) ; ensuite les P2, puis les P3, par thème. Le paquet 1 regroupait tous les P1 de la classe 1 (les 16 éléments de la refonte et PRD-12) ; seul PRD-12 (◐) reste en P1 de classe 1 ; les autres P1 attendent une décision (TDB-03 et IMP-01 : C2), des éléments (ACT-36, ACT-39 : C3) ou un tiers technique (INT-01 à INT-04, ACT-34 : C4).

#### Paquet 1 — Refonte des actions QSE : livré le 15/10/2026

Voir « Livré » ci-dessus. Restent de la refonte : ACT-34 (compte d'envoi des e-mails, C4), ACT-36 et ACT-39 (numéros AC et import de l'extraction Power Apps, C3), ACT-41 (C4) et ACT-42 (C3) ; la bascule de Power Apps vers Vigie attend ACT-36 et ACT-39, l'envoi réel du rappel par e-mail attend ACT-34. Suites de classe 1 : paquets 2 et 10.

#### Paquet 2 — Suites de la refonte des actions (P2 · 14 éléments, 16–48 j) : livré le 17/10/2026, sauf UX-05, UX-06 et les éléments PA

À enchaîner après le paquet 1 : ces éléments réutilisent le nouveau modèle (notifications, fil, preuves, filtres, fiche) ou en dépendent. Livrés le 17/10/2026 (✅) : ACT-02, ACT-03, ACT-29, TDB-06, AUD-12, PRD-08, QUA-09 ; partiel (◐) : QUA-11 ; aucune migration (les références des autres fiches réutilisent la table de numérotation `action_counters`, portée « ref:<préfixe> »). Restent : EVT-22, VEI-05, HAB-06, IMP-07 (PA, à placer après la réception des formulaires Power Apps de leurs écrans), UX-05, UX-06 et la fin de QUA-11 (risques, audits, environnement).

- **ACT-03** ✅ Tracer les changements d'action faits par les autres modules — S · livré le 17/10/2026
- **ACT-02** ✅ Rattacher une action existante depuis toutes les sources — M · livré le 17/10/2026 : « Rattacher » / « Détacher » un lien complémentaire depuis la fiche action
- **ACT-29** ✅ Statistiques mensuelles — M · livré le 17/10/2026 : état du plan à la fin du mois, dernière date cible
- **TDB-06** ✅ Notifications d'information (réaffectation d'une action, suite d'un signalement) — M · livré le 17/10/2026
- **EVT-22** Espace salarié mobile (mes actions, mes habilitations) — L · PA · après ACT-24 et ACT-25
- **VEI-05** Écart ou réserve dont l'action est clôturée : relancer pour boucler — M · PA · après ACT-23
- **AUD-12** ✅ Rattacher une action d'une autre revue la déplace — S · livré le 17/10/2026
- **HAB-06** Session de formation collective et recyclage groupé — L · PA · après ACT-20
- **IMP-07** Impression des fiches événement et action — M · PA · fiche action après ACT-23
- **PRD-08** ✅ Numéros de référence sûrs — S · livré le 17/10/2026 (même mécanisme qu'ACT-35)
- **QUA-09** ✅ Dates en UTC — S · livré le 17/10/2026
- **QUA-11** ◐ Historiques à l'ouverture d'une fiche — M · actions (ACT-24), veille et prévention livrées ; restent risques, audits, environnement
- **UX-05** Photos : galerie et allègement — M · avec SEC-09
- **UX-06** Mise en page tablette — M · vue des actions après ACT-27

#### Paquet 3 — Traçabilité et journal (P2 · 12 éléments, 8–20 j) : livré le 17/10/2026

Règle du projet : chaque écriture tracée par `logChange` dans sa transaction, jamais de suppression physique, motif obligatoire. Livrés le 17/10/2026 (✅) : les 12 éléments, et DOC-05 (paquet 4) avec DOC-04 ; une migration (`drizzle/0006_traceability_journal.sql`). Voir « Livré » ci-dessus.

- **TDB-09** ✅ Traçabilité des sites : journaliser la règle Seveso / PP et afficher l'historique — S · livré le 17/10/2026
- **EVT-12** ✅ Journal : analyse, méthode et réception des signalements terrain — S · livré le 17/10/2026
- **PRV-12** ✅ Carte du site : journal, annulation plutôt que suppression, sites archivés — M · PA · livré le 17/10/2026
- **DUE-06** ✅ Historique des unités en vigueur et des versions jamais affiché — S · PA · livré le 17/10/2026
- **HAB-03** ✅ Journal des habilitations : compléter et afficher — M · livré le 17/10/2026
- **VEI-04** ✅ Rattachements d'actions absents du journal des exigences et contrôles — S · livré le 17/10/2026
- **VEI-09** ✅ Modifier « Dernier contrôle » contourne l'historique — S · livré le 17/10/2026
- **DOC-04** ✅ Journal du cycle de vie des documents — M · PA · avec DOC-05 et DOC-06 · livré le 17/10/2026
- **DOC-06** ✅ Renvoi en brouillon sans motif — S · PA · livré le 17/10/2026
- **DOC-09** ✅ Archivage d'une filière déchets — S · PA · livré le 17/10/2026
- **DOC-10** ✅ Journal des filières et relevés — S · PA · livré le 17/10/2026
- **SEC-11** ✅ Consultations tracées — M · livré le 17/10/2026

#### Paquet 4 — Cohérence des données et corrections (P2 · 12 éléments, 7–16 j) : livré le 17/10/2026

Corrections côté serveur et contrôles de saisie, sans décision attendue. Livrés le 17/10/2026 (✅) : les 11 éléments restants (DOC-05 l'était avec le paquet 3) ; une migration (`drizzle/0007_qualification_renewals.sql`, HAB-04). Voir « Livré » ci-dessus.

- **TDB-07** ✅ État lu : clé avec date d'échéance et gravité, retards triés par ancienneté — M · avant TDB-10 · livré le 17/10/2026
- **EVT-11** ✅ Analyse des causes vidable ou méthode changeable après « Actions » — S · PA · livré le 17/10/2026
- **PRV-11** ✅ Cohérence plan, permis et activités après modification — S · PA · livré le 17/10/2026
- **DUE-05** ✅ Unités sur un site archivé déplacées en silence — S · PA · livré le 17/10/2026
- **HAB-04** ✅ Les anciens recyclages perdent leur lien vers l'habilitation — M · livré le 17/10/2026
- **VEI-03** ✅ Échéance figée d'une exigence suivie par des contrôles — S · livré le 17/10/2026
- **VEI-06** ✅ Exigence jugée sur le seul site sélectionné — S · livré le 17/10/2026
- **AUD-07** ✅ Supprimer le libellé d'audit codé en dur — S · livré le 17/10/2026
- **AUD-11** ✅ Contrôles de saisie des constats — S · livré le 17/10/2026
- **AUD-14** ✅ Contrôles avant clôture et visa — S · PA · livré le 17/10/2026
- **AUD-15** ✅ Visa de la direction possible par l'animateur QHSE — S · livré le 17/10/2026
- **DOC-05** ✅ Version approuvée sans fichier — S · PA · livré le 17/10/2026 avec le paquet 3

#### Paquet 5 — Conformité réglementaire (P2 · 14 éléments, 14,5–43 j) : livré le 18/10/2026, sauf l'aptitude médicale de HAB-10

Contenus fixés par les textes ; libellés réglementaires à faire relire par le service QHSE à la recette (non bloquant, liste au [§ 19](#19-questions-ouvertes)). Livrés le 18/10/2026 (✅) : 13 éléments, AUD-13 compris (partiel jusque-là) ; partiel (◐) : HAB-10 (aptitude médicale selon HAB-02) ; une migration (`drizzle/0010_regulatory_compliance.sql`). Voir « Livré » ci-dessus.

- **EVT-09** ✅ Maladies professionnelles et accidents de trajet — M · PA · livré le 18/10/2026
- **EVT-10** ✅ Synthèse imprimable de la DAT et feuille d'accident — M · PA · livré le 18/10/2026
- **EVT-17** ✅ Traitement des produits non conformes et coût de non-qualité — M · PA · livré le 18/10/2026
- **PRV-07** ✅ Signataires du plan et date de signature EU — S · PA · livré le 18/10/2026
- **DUE-03** ✅ Transmission de chaque version au SPST et dépôt sur le portail — S · PA · livré le 18/10/2026
- **HAB-10** ◐ Niveaux, catégories CACES et prérequis entre titres — M · PA · livré le 18/10/2026 hors aptitude médicale (selon HAB-02)
- **VEI-10** ✅ Applicabilité par site et référence du texte — M · PA · livré le 18/10/2026
- **VEI-11** ✅ Résultat du contrôle réalisé — M · PA · livré le 18/10/2026
- **AUD-08** ✅ Cycle de certification : renouvellement, suspension, historique — M · PA · livré le 18/10/2026
- **AUD-09** ✅ Types de constat : écart majeur, observation, délai de réponse — M · PA · livré le 18/10/2026
- **AUD-13** ✅ Objectifs QHSE mesurables reliés aux indicateurs — L · PA · livré le 18/10/2026
- **DOC-12** ✅ Statuts de BSD refus et acceptation partielle — S · PA · livré le 18/10/2026
- **CNF-03** ✅ Bilan annuel SSCT — M · PA · statistiques d'ACT-29 · livré le 18/10/2026
- **CNF-05** ✅ Contexte et risques du système de management — M · PA · livré le 18/10/2026

#### Paquet 6 — Fonctions des modules (P2 · 11 éléments, 9–25 j)

Filtres, pièces jointes, liens profonds et échéances qui manquent aux écrans existants.

- **EVT-13** Filtres de la liste : blessure, étape, pilote, période, gravité, ancienneté — M · PA · prérequis de TDB-12
- **EVT-14** Événements liés sur les fiches contrôle et document — M · PA
- **PRV-10** Situations de coactivité : état « maîtrisée » — M · PA
- **DUE-09** Pièces jointes : DUERP signé par version et justificatifs des risques — M · PA
- **HAB-09** Prévision des recyclages à 12 mois et plan de formation — M · PA
- **VEI-07** Rattachement explicite d'une exigence à un indicateur (linkedTo) — S · PA · prérequis de VEI-12
- **VEI-08** Pièces jointes à compléter ou retirer après coup — S · PA
- **AUD-16** Échéances : décisions sans suite, prochaine revue non planifiée — S · PA
- **AUD-17** Pièces jointes de la revue — M · PA
- **DOC-08** Lien profond vers un enlèvement ou une filière — S · PA
- **DOC-11** Pièces jointes d'un enlèvement — M · PA

#### Paquet 7 — Terrain et mobile (P2 · 4 éléments, 4–12 j)

Développement et tests sur localhost ; la recette d'installation (PWA) attend l'hôte HTTPS cible.

- **EVT-19** Rattacher l'événement à sa zone et protéger les zones porteuses de QR — M · PA · QR périmé selon la réponse d'EVT-18
- **EVT-20** Signalement installable (PWA) — M · recette sur l'hôte HTTPS cible
- **UX-07** Liste puis fiche sur petit écran — M · PA
- **UX-08** Carte du site tactile — M

#### Paquet 8 — Exploitation, sécurité et tests (P2 · 11 éléments, 11,5–34 j)

Robustesse de l'instance de production et filet de tests.

- **PRD-10** Journalisation serveur — S
- **PRD-13** ◐ Stockage des pièces jointes — M
- **PRD-14** Application Mac client du serveur — M · recette sur le serveur central
- **SEC-07** ◐ Limitation de débit et quotas — M
- **SEC-08** Validation et service des pièces jointes — M · avec QUA-19
- **SEC-09** ◐ Anonymat des signalements côté serveur — S
- **INT-06** Import PP par IA : coût — M
- **IMP-04** Helper CSV commun — S
- **QUA-08** Tests de bout en bout Playwright — L · plan d'actions après ACT-40
- **QUA-10** Tests de l'import de plan de prévention — M · PA
- **QUA-12** Modifications simultanées — M

#### Paquet 9 — UX et accessibilité (P2 · 7 éléments, 8–24 j)

Composants communs (formulaires, coque, retours d'état) ; `nocturne.css` reste intact.

- **UX-04** Erreurs de formulaire accessibles — S · avant ou avec ACT-20
- **UX-09** Contraste — M
- **UX-10** Icônes et infobulles — M
- **UX-11** ◐ Structure sémantique et clavier de la coque — M
- **UX-12** Uniformiser filtres et liens profonds — L · PA · convention d'URL d'ACT-27
- **UX-13** Élément introuvable partout — S
- **UX-14** Retours d'état — M

#### Paquet 10 — Suites de la refonte des actions (P3 · 11 éléments, 8,5–23 j)

Corrections et dette que la refonte réécrit ou conditionne : à faire juste après elle.

- **ACT-12** Action issue d'une coactivité sans plan : origine non cliquable — S · actions reprises seulement
- **TDB-12** Liens du tableau de bord vers des listes vraiment filtrées — M · PA · après EVT-13 et ACT-27
- **DOC-13** Action liée d'une version : contrôles contournés — S · PA · avec ACT-28
- **DUE-14** Déplacement d'un risque : rang et site des actions — S · PA · site unique d'ACT-20
- **AUD-28** Plusieurs actions par constat — M · PA · après ACT-23
- **QUA-17** Échéances et badges : coût par page — M · après ACT-28
- **QUA-20** Dater le jeu de démonstration — M · avec ACT-19
- **QUA-22** Motif unifié — S
- **QUA-23** États annulé et archivé — M · avancement dans la migration 0005
- **QUA-24** Code mort et knip — S · après la refonte
- **QUA-26** Découper les gros fichiers — M · seed avec ACT-19

#### Paquet 11 — Échéances et tableau de bord (P3 · 11 éléments, 5,5–11 j)

Responsables, horizons, état lu et exactitude des indicateurs.

- **TDB-10** Purge des états lus et commentaire de schéma obsolète — S · après TDB-07
- **TDB-11** Marquer lue une échéance ouverte depuis À faire ou le tableau de bord — S
- **TDB-13** Exactitude des KPI du tableau de bord — S · PA
- **TDB-14** Carte « Veille réglementaire » après la date d'application — S · PA
- **TDB-15** ◐ Indiquer le site en vue « Tous les sites » — S
- **TDB-16** Horizons d'échéances centralisés et groupes de À faire — S
- **TDB-17** Titres d'onglet du tableau de bord et de À faire — S
- **PRV-19** Échéances de coactivité sans personne concernée — S · PA
- **AUD-18** Compléter les échéances du programme — S
- **DOC-14** Échéances documentaires — S · PA
- **DOC-19** Relevés de consommation : responsable absent, sites sans relevé non suivis — S · PA

#### Paquet 12 — Cohérence, droits et traçabilité (P3 · 12 éléments, 7–16 j)

Petites corrections de droits et de saisie, rétablissements motivés.

- **DUE-12** Rattachement non tracé entre deux risques au même danger — S · PA
- **DUE-15** Validateur sorti de l'effectif — S · PA
- **HAB-12** Droits sur les titres suivis communs à tous les sites — S
- **HAB-14** Vue Salarié : habilitations filtrées par le site — S
- **HAB-17** Lien profond : filtres mémorisés écrasés et messages imprécis — S
- **VEI-16** Annulation d'une évaluation saisie par erreur — S
- **AUD-23** Règle « revue de direction » trop large — S
- **AUD-25** Rétablir un constat annulé — S
- **AUD-31** Contrôles de dates et de doublons — S
- **AUD-34** Rectificatif d'une revue clôturée — M · PA
- **AUD-36** Décision de revue abandonnée ou reformulée après la séance : statut, motif, ancien libellé — M · PA
- **DOC-20** Filières d'un site archivé proposées — S · PA

#### Paquet 13 — Conformité et fonctions métier (P3 · 23 éléments, 22,5–66 j)

Fonctions nouvelles sans décision attendue ; plusieurs touchent des écrans dont le formulaire Power Apps est attendu (PA).

- **PRV-17** Interventions longues : inspections et réunions périodiques — M · PA
- **DUE-17** Vue d'ensemble du DUERP toutes unités — M · PA
- **DUE-19** Mesures liées aux contrôles, documents et habilitations — L · PA
- **DUE-20** Unités de travail reliées aux zones du plan de site — M · PA
- **HAB-13** Efficacité des formations et sensibilisation (ISO §7.2-7.3) — M · PA
- **HAB-18** Indicateurs de compétences dans la revue — S · PA
- **VEI-12** Indicateurs calculés : registre des déchets et certification ISO 9001 — M · PA · après VEI-07
- **VEI-14** Métrologie : étalonnage des équipements de mesure — M · PA
- **VEI-15** Registre de sécurité consolidé et observations des organismes — M · PA
- **VEI-18** Périodicité de réévaluation propre à chaque exigence — S · PA
- **AUD-20** Audits hors programme en vrais audits — M · PA
- **AUD-21** Plusieurs éléments par ligne et par mois — M · PA
- **AUD-22** Rattacher programme, constats et certifications à un site — M · PA
- **AUD-24** Gestion des lignes et reconduction annuelle — M · PA
- **AUD-26** Impression du programme annuel — S · PA
- **AUD-27** Auditeur interne lié à une personne — M · PA
- **AUD-33** Constats des audits fournisseurs dans la section Fournisseurs — S · PA
- **AUD-35** Carte de revue : perception client et ressources — S · PA
- **DOC-15** Revue périodique sans modification — M · PA
- **DOC-17** Conservation des enregistrements et documents externes — M · PA
- **CNF-08** Situations d'urgence — M · PA
- **CNF-11** Gestion des changements — M
- **SEC-13** Droits d'accès d'un salarié — M

#### Paquet 14 — Ergonomie des écrans (P3 · 13 éléments, 7,5–17 j)

Filtres, préremplissage, lisibilité et aide.

- **EVT-24** « Nouvel événement » prérempli depuis contrôle, risque, document, environnement — S · PA
- **EVT-27** Vue déclarant : photos et périmètre de /evenements — S · PA
- **PRV-14** Filtres projet et entreprise, accès direct à la fiche entreprise — S · PA
- **DUE-13** Unités homonymes indiscernables sous « Tous les sites » — S · PA
- **DUE-16** Matrice G × P accessible et filtrante — S · PA
- **DUE-18** Suggestions de familles de dangers — S · PA
- **HAB-15** Réordonnancement des titres suivis — S · PA
- **HAB-16** Matrice : filtre par titre, site visible, colonne figée — S · PA
- **VEI-13** Filtres, recherche et tri — M · PA
- **AUD-19** Lien profond vers un référentiel — S
- **AUD-29** Liste des constats : filtres et audits sans constat — S · PA
- **UX-15** Dossier de revue sur téléphone — S
- **UX-16** Aide en ligne — M

#### Paquet 15 — Dette technique et outillage (P3 · 10 éléments, 7,5–20 j)

Factorisation, outillage et import des plans de prévention.

- **QUA-14** Sortir les règles métier des composants — M
- **QUA-16** Recette visuelle et contrôle d'accessibilité (axe-core) — M · axe-core tout de suite, captures après la refonte
- **QUA-18** requireEditor commun — S
- **QUA-19** Factoriser le contrôle des pièces jointes — S
- **QUA-21** Pagination des événements — M · PA
- **QUA-25** ◐ Helpers mutualisés — S
- **QUA-27** AGENTS.md — S
- **QUA-28** ◐ Environnement de développement — S
- **INT-13** Import PP par IA : appel long et configuration — M
- **INT-14** Import PP : plusieurs pages et HEIC — M

### Classe 2 — À valider (41 éléments, 54,5–168 j)

Une décision interne rapide du responsable produit ou du service QHSE. Chaque décision ci-dessous cite les éléments qu'elle débloque et ce qu'ils deviennent après la réponse ; la question complète figure au [§ 19](#19-questions-ouvertes).

#### Suites des réponses du service QHSE du 15/10/2026 (2 éléments, 1–2 j)

Les sept questions de la refonte (ACT-22, ACT-37, ACT-29, ACT-31, ACT-38, ACT-02, ACT-13) ont reçu leur réponse le 15/10/2026 (§ 5 et § 19) ; deux réponses ouvrent une question sur un autre écran.

- **Droits sur les événements après leur déclaration** — L'encadrement garde-t-il la modification et l'avancement des événements de son site, ou seul le QHSE modifie et suit l'événement déclaré ? *(auprès de : service QHSE, avec le formulaire Power Apps Événements)* Débloque : **EVT-29** (P2 · S · PA) Événement déclaré par tous, modifié et suivi par le service QHSE.
- **Mesures immédiates d'un plan de prévention** — À la clôture d'un plan après un écart R. 4512-6, demander une trace des mesures immédiates (aucune action QSE n'est plus exigée) ? *(auprès de : service QHSE)* Débloque : **PRV-21** (P3 · S · PA) Clôture d'un plan après un écart R. 4512-6 : mesures immédiates hors actions QSE.

#### Levée des reports d'imports et d'exports (9 éléments, 12,5–39 j)

- **Heures travaillées (base du TF1/TG)** — Lever le report « aucune saisie ni import » ? saisie mensuelle dans Vigie ou import (paie, Lucca, Cursus) ? heures de l'effectif seulement, intérimaires exclus ? *(auprès de : responsable produit)* Débloque : **TDB-03** (P1 · M) Saisie mensuelle des heures travaillées (base du TF1/TG) ; **IMP-01** (P1 · M) Import des heures travaillées. Après la réponse : saisie manuelle → C1 ; import de la paie → C3 (exemple de fichier) ; Cursus → C4 (INT-03). À traiter ensemble.
- **Import du personnel Lucca** — Lever le report, ou attendre Cursus (INT-03), source de vérité RH cible ? *(auprès de : responsable produit)* Débloque : **IMP-02** (P2 · M · PA) Import du personnel Lucca. Après la réponse : oui → C1 (import CSV avec aperçu) ; sinon attendre INT-03.
- **Import Excel de la veille** — Lever le report pour l'import du tableau de veille actuel ? *(auprès de : responsable produit, service QHSE)* Débloque : **IMP-03** (P2 · L · PA) Import Excel de la veille. Après la réponse : oui → C3 (exemple du fichier actuel).
- **Exports CSV des événements et de la veille** — Lever le report ? (les actions sont retirées : pas d'export Excel, décision du service QHSE) *(auprès de : responsable produit)* Débloque : **IMP-05** (P2 · M · PA) Exports CSV événements et veille. Après la réponse : oui → C1, sur le helper d'IMP-04.
- **Export de la matrice des habilitations** — Lever le report pour l'export ? *(auprès de : responsable produit)* Débloque : **IMP-06** (P2 · M · PA) Export et impression de la matrice des habilitations. Après la réponse : l'impression navigateur se fait sans attendre (à scinder en C1) ; l'export attend la réponse.
- **Exports de la liste maîtresse, des plans et des permis** — Lever le report ? *(auprès de : responsable produit)* Débloque : **IMP-08** (P3 · S · PA) Exports : liste maîtresse, plans et permis. Après la réponse : les vues imprimables existent déjà ; oui → C1.
- **Plan de prévention régénéré au format importé** — Lever le report pour générer le PDF (pdf-lib) ? *(auprès de : responsable produit)* Débloque : **IMP-09** (P3 · L · PA) Plan régénéré au format importé. Après la réponse : le format pourra changer avec le formulaire Power Apps Prévention.
- **Archivage PDF des enregistrements figés** — Lever le report pour archiver en PDF, côté serveur, le dossier de revue et les versions du DUERP dans Documents maîtrisés ? *(auprès de : responsable produit)* Débloque : **AUD-32** (P3 · M · PA) Archiver les enregistrements figés en PDF et dans Documents maîtrisés. Après la réponse : oui → C1.

#### Périmètre : données tenues dans Vigie ou ailleurs, nouveaux registres (13 éléments, 25–81 j)

- **Suivi de l'état de santé au travail** — VIP, SIR, aptitude et visites de reprise tenus dans Cursus (lus par INT-03) ou saisis dans Vigie ? *(auprès de : responsable produit, RH)* Débloque : **HAB-02** (P2 · L · PA) Suivi de l'état de santé au travail : VIP, SIR, aptitude, reprise. Après la réponse : Cursus → C4 ; Vigie → dates seulement, données de santé (`HEALTH_LABELS`), avis du DPO pour l'aptitude.
- **Arrêts de travail** — Périodes d'arrêt saisies dans Vigie par le service QHSE, ou venues de la paie ou de Cursus ? *(auprès de : responsable produit, service QHSE)* Débloque : **EVT-08** (P2 · M · PA) Suivi de l'arrêt de travail : périodes, reprise, jours perdus calculés. Après la réponse : Vigie → C1 ; paie ou Cursus → C4 ; données de santé dans les deux cas.
- **Exigences par poste ou par activité** — Lever le hors-périmètre ? poste saisi dans Vigie ou lu dans Cursus ? *(auprès de : responsable produit)* Débloque : **HAB-07** (P2 · L · PA) Exigences par poste ou par activité. Après la réponse : Vigie → C1 ; Cursus → C4 (INT-03).
- **Registre des dangers graves et imminents** — Registre tenu dans Vigie ? avis du représentant du CSE saisi par lui ou recopié et imprimé ? ou registre papier ? *(auprès de : responsable produit, service QHSE)* Débloque : **CNF-01** (P2 · M · PA) Registre des dangers graves et imminents. Après la réponse : nouveau type d'événement : le formulaire Power Apps Événements peut le couvrir.
- **Instances CSE et CSSCT** — Réunions, PV et consultations suivis dans Vigie par le QHSE, ou par les RH dans un autre outil ? quelles instances ? *(auprès de : responsable produit, RH)* Débloque : **CNF-02** (P2 · M) Instances CSE / CSSCT. Après la réponse : oui → nouveau module rattaché aux consultations du DUERP.
- **Produits chimiques** — Inventaire, FDS et CMR tenus dans Vigie, ou dans l'outil actuel d'évaluation du risque chimique, Vigie gardant un lien ? *(auprès de : service QHSE)* Débloque : **CNF-06** (P2 · L · PA) Produits chimiques. Après la réponse : gros module (L) rattaché aux Risques.
- **Causeries et quarts d'heure sécurité** — Tenus dans Vigie, ou dans Cursus avec les formations ? support actuel à reprendre ? *(auprès de : service QHSE, RH)* Débloque : **CNF-09** (P3 · M · PA) Communication et sensibilisation. Après la réponse : « Causerie QSE » est une des 22 sources des actions.
- **Dotation des EPI** — Tenue dans Vigie, dans Cursus ou dans l'outil de magasin ou d'achats ? support actuel ? *(auprès de : service QHSE, achats)* Débloque : **CNF-10** (P3 · M · PA) EPI. Après la réponse : données par salarié : à articuler avec Cursus.
- **Rejets eaux et air** — Suivi nécessaire (ICPE, autosurveillance imposée par arrêté) ? *(auprès de : service QHSE)* Débloque : **DOC-21** (P3 · L · PA) Suivi des rejets eaux et air. Après la réponse : oui → C3 (points de rejet, paramètres, valeurs limites) ; non → élément retiré.
- **Vigilance des entreprises extérieures** — Attestations URSSAF, Kbis et assurance suivies par les achats hors de Vigie, ou par le QHSE dans la fiche entreprise ? *(auprès de : responsable produit, achats)* Débloque : **PRV-09** (P2 · L · PA) Dossier entreprise extérieure : pièces de vigilance, intervenants, accueil. Après la réponse : achats → l'élément se réduit aux intervenants et à l'accueil sécurité.
- **Transporteurs et protocoles de sécurité** — Transporteurs gérés comme des entreprises extérieures ? modèle de protocole à reprendre ? *(auprès de : service QHSE)* Débloque : **PRV-05** (P2 · M · PA) Protocoles de sécurité de chargement et déchargement. Après la réponse : modèle de protocole à fournir avec la réponse s'il existe.
- **Plans de prévention reçus des clients** — Interventions d'EPC2i chez ses clients à suivre dans Vigie ? *(auprès de : responsable produit)* Débloque : **PRV-20** (P3 · L · PA) Plans de prévention reçus des clients. Après la réponse : oui → saisie manuelle avec pièce jointe, puis rattachement par l'API Keystone (C4) ; non → hors périmètre.
- **Recherche globale** — Recherche dans l'en-tête, tous modules, filtrée par site et droits, alors que la maquette n'en prévoit pas ? *(auprès de : responsable produit)* Débloque : **TDB-18** (P3 · M) Recherche globale dans l'en-tête. Après la réponse : oui → de préférence après les formulaires Power Apps des autres modules (références et intitulés à chercher).

#### Droits et validations (7 éléments, 5,5–15 j)

- **Clôture d'un événement autre qu'un AT** — Réservée aux approbateurs (animateur QHSE, direction) ? *(auprès de : responsable produit, service QHSE)* Débloque : **EVT-16** (P2 · S · PA) Clôture d'un événement réservée aux approbateurs ? Après la réponse : réponse probable oui, par analogie avec les actions (le QHSE fait avancer et termine).
- **Révision d'un document par son propriétaire en consultation seule** — Peut-il rédiger et soumettre la révision, l'approbation restant au QHSE ? sinon, réserver le choix du propriétaire ? *(auprès de : responsable produit, service QHSE)* Débloque : **DOC-03** (P2 · M · PA) Propriétaire en consultation seule : ni révision ni échéances.
- **Auteur et approbateur d'une version** — Interdire à l'auteur d'approuver sa version, ou l'autoriser en le signalant (site à un seul animateur) ? *(auprès de : responsable produit, service QHSE)* Débloque : **DOC-18** (P3 · S · PA) Séparation rédaction et approbation. Après la réponse : même question que l'indépendance du vérificateur des actions (ACT-13).
- **Accès de l'encadrement à Environnement** — Ouvrir l'écran au chef de service et au chef de projet ? en consultation ou en saisie ? *(auprès de : responsable produit)* Débloque : **DOC-22** (P3 · S · PA) Accès de l'encadrement à Environnement. Après la réponse : penser à `ROLE_ROUTES` et aux tests de cloisonnement.
- **Dépôt d'une attestation par le salarié** — Le salarié dépose-t-il lui-même l'attestation, validée ensuite par le QHSE ? *(auprès de : responsable produit, service QHSE)* Débloque : **HAB-19** (P3 · M · PA) Vue Salarié : titres archivés et dépôt de son attestation. Après la réponse : l'affichage des titres archivés se fait sans attendre.
- **Sortie d'un salarié** — Bloquer la sortie tant qu'il porte des responsabilités ouvertes, ou les réaffecter en masse ? *(auprès de : responsable produit)* Débloque : **HAB-05** (P2 · M · PA) Sortie d'un salarié : responsabilités ouvertes et échéances postérieures. Après la réponse : à terme, la sortie viendra de Cursus.
- **Archivage d'un site** — Bloquer, avertir avec le décompte, ou transférer en masse les éléments ouverts ? *(auprès de : responsable produit)* Débloque : **TDB-08** (P2 · M) Archivage d'un site : avertir des éléments encore ouverts.

#### Règles métier, délais et seuils (10 éléments, 10,5–31 j)

- **Délais des échéances d'un événement** — Délai d'analyse après la qualification ; pilote sorti ; actions terminées sans « Efficacité vérifiée » ; seule action annulée ; action rouverte sur un événement clos ? *(auprès de : service QHSE)* Débloque : **EVT-15** (P2 · M · PA) Échéances événement manquantes. Après la réponse : le service QHSE peut répondre avec le formulaire Power Apps Événements.
- **Code de poste stable des QR codes** — QR code porteur d'un code de poste indépendant de l'identifiant de zone ? *(auprès de : service QHSE)* Débloque : **EVT-18** (P2 · M · PA) Formulaire terrain : choix du site et QR code périmé. Après la réponse : le choix du site sur le formulaire terrain se livre sans attendre ; le QR périmé se traite avec EVT-19.
- **Date et heure réelles d'un signalement** — Ajouter la date et l'heure des faits au formulaire terrain ? *(auprès de : service QHSE)* Débloque : **EVT-21** (P2 · L · PA) File d'attente hors ligne des signalements. Après la réponse : la file hors ligne et la clé d'idempotence n'en dépendent pas (après EVT-20).
- **Suivi d'un signalement anonyme** — Risque de ré-identification acceptable ? avis du DPO ? *(auprès de : responsable produit, DPO)* Débloque : **EVT-28** (P3 · M · PA) Suivi d'un signalement anonyme par code. Après la réponse : avis du DPO demandé → C3 jusqu'à l'avis.
- **Réévaluation du DUERP après un accident** — Quelle gravité impose une réévaluation, voire une nouvelle version ? *(auprès de : service QHSE)* Débloque : **DUE-07** (P2 · M · PA) Réévaluation après accident et mise à jour du DUERP déclenchée.
- **Contenu figé d'une version du DUERP** — Instantané au jour de la validation ou de l'archivage ? *(auprès de : service QHSE)* Débloque : **DUE-10** (P2 · M · PA) Contenu d'une version figé à la validation.
- **Clôture d'un permis de feu** — Interdire la clôture avant la fin de la surveillance (2 h) ou tracer un écart ? *(auprès de : service QHSE)* Débloque : **PRV-04** (P2 · M · PA) Traçabilité de la délivrance, de la check-list et de la clôture des permis. Après la réponse : la traçabilité (migration) se fait sans attendre.
- **Inspection commune préalable tardive** — Refus, ou écart tracé comme pour R. 4512-6 ? *(auprès de : service QHSE)* Débloque : **PRV-06** (P2 · S · PA) Inspection commune « préalable » acceptée après le début des travaux.
- **Seuil de 400 heures** — Par opération (plan par plan) ou cumul de l'entreprise extérieure sur 12 mois ? *(auprès de : service QHSE)* Débloque : **PRV-13** (P3 · S · PA) Cumul des heures d'une entreprise extérieure sur 12 mois.
- **Validité et prolongation des permis** — Durée maximale ? prolongation admise, par qui, combien de fois, avec quel motif ? *(auprès de : service QHSE)* Débloque : **PRV-16** (P3 · S · PA) Validité des permis : durée maximale et prolongation. Après la réponse : avec PRV-15 si la procédure PR-QHSE-005 le prévoit.

### Classe 3 — En attente d'éléments (14 éléments, 19,5–60 j)

Informations, documents ou données à fournir. Chaque élément attendu cite qui le fournit et ce qu'il débloque.

#### Refonte des actions QSE (3 éléments, 4,5–14 j)

- **Règle actuelle de numérotation AC** — *de : service QHSE (recherche en cours ; question gardée pour plus tard le 15/10/2026).* Attendu : compteur repartant à 0001 chaque année (AC-270001 au début de 2027) ou continu, nombre de chiffres après l'année. Débloque : **ACT-36** (P1 · S) Format des numéros AC-AA####. Remarque : d'ici là, Vigie garde le format « A-n » et n'émet aucun numéro AC (ACT-35) ; ACT-39 attend aussi cette règle.
- **Extraction de toutes les actions Power Apps** — *de : propriétaire de l'application Power Apps (fournie plus tard).* Attendu : fichier (Excel ou CSV) avec ses colonnes (site, responsable en e-mail ou en nom), l'historique des commentaires et les pièces jointes, et un échantillon pour les tests. Débloque : **ACT-39** (P1 · L) Import de l'extraction Power Apps. Remarque : reprise de toutes les actions existantes avec leur numéro AC ; décision sur les responsables absents de Vigie à prendre à réception (point 16 de la spécification).
- **Référentiels d'équipements, de clients et de fournisseurs** — *de : responsable produit, équipes Keystone et Codex.* Attendu : référentiel des équipements et sous-équipements, des clients et des fournisseurs, avec leurs identifiants et leur système propriétaire. Débloque : **ACT-42** (P3 · M) Rattacher une action à un équipement, un sous-équipement, un client ou un fournisseur. Remarque : souhait du service QHSE du 15/10/2026.

#### Documents et méthodes du service QHSE (7 éléments, 10,5–33 j)

- **Procédure des permis et modèles complémentaires** — *de : service QHSE (ou utilisateur, s'il s'agit de formulaires Power Apps).* Attendu : PR-QHSE-005 et modèles des permis de consignation, d'espace confiné, de travail en hauteur et de fouille, avec leurs check-lists. Débloque : **PRV-15** (P3 · M · PA) Permis complémentaires : consignation, espace confiné, hauteur, fouille. Remarque : règle de validité des permis (PRV-16) si la procédure la prévoit.
- **Titres exigés par type de permis** — *de : service QHSE.* Attendu : correspondance entre type de permis et titres d'habilitation des intervenants (PR-QHSE-005). Débloque : **PRV-08** (P2 · M · PA) Intervenants des permis reliés au personnel et aux habilitations. Remarque : dépend aussi de HAB-10 (niveaux, catégories) ; Cursus deviendra la source des titres sans bloquer.
- **Procédures applicables à chaque écran** — *de : service QHSE.* Attendu : références réelles des procédures (événements, actions, DUERP, habilitations, veille, audits, documents, environnement). Débloque : **DOC-16** (P3 · S · PA) Liens « Procédure » sur les autres écrans. Remarque : si l'association écran → procédure devient un réglage dans Documents : C1.
- **Méthode d'analyse environnementale** — *de : service QHSE.* Attendu : liste des aspects et impacts, grille de cotation, critère de significativité (éventuellement le formulaire Power Apps du domaine). Débloque : **DOC-23** (P3 · L · PA) Aspects et impacts environnementaux. Remarque : source « Analyse environnementale » des actions.
- **Évaluation des fournisseurs** — *de : service QHSE ou achats.* Attendu : grille actuelle (critères, notation, seuils, fréquence) et liste des fournisseurs ; lien avec les entreprises extérieures de la prévention. Débloque : **CNF-04** (P2 · L · PA) Évaluation des fournisseurs.
- **Satisfaction client** — *de : service QHSE ou service commercial.* Attendu : questionnaire actuel (questions, échelle, fréquence, destinataires) et résultats récents. Débloque : **CNF-07** (P3 · M · PA) Satisfaction client.
- **Scans et photos réels de plans de prévention** — *de : service QHSE.* Attendu : scans et photos anonymisés de plans remplis sur le formulaire de l'entreprise, et une clé API de test. Débloque : **QUA-15** (P3 · M · PA) Jeu d'essai des scans. Remarque : l'envoi de documents réels attend l'avis du DPO (INT-07).

#### Avis du DPO (3 éléments, 4–12 j)

- **Durées de conservation** — *de : DPO.* Attendu : durées par catégorie (AT et santé, salariés sortis, signalements, pièces jointes, journaux), règles de purge ou d'anonymisation, registre des traitements. Débloque : **SEC-10** (P2 · L) Registre des traitements et durées de conservation. Remarque : fixe aussi la conservation du journal des consultations (SEC-11).
- **Mentions d'information** — *de : DPO.* Attendu : texte des mentions de l'article 13 pour le signalement et la fiche salarié. Débloque : **SEC-12** (P2 · S) Mentions d'information RGPD. Remarque : l'emplacement peut être préparé, pas le texte.
- **Envoi des plans de prévention au service d'IA** — *de : DPO.* Attendu : avis sur l'envoi (données des intervenants, fournisseur hors UE) et sur la journalisation d'un extrait de la réponse. Débloque : **INT-07** (P2 · S) Import PP par IA : confidentialité. Remarque : selon l'avis : consentement à chaque envoi, envoi manuel, extrait retiré du journal.

#### Équipe Keystone (1 élément, 0,5–1 j)

- **Adresse de Keystone et forme des liens** — *de : équipe Keystone.* Attendu : URL de production (`KEYSTONE_URL`) et forme des liens vers un projet et vers une affectation. Débloque : **INT-08** (P2 · S) Liens directs vers Keystone. Remarque : C4 si Keystone n'a pas encore d'URL stable.

Élément attendu sans blocage : les **formulaires Power Apps des autres modules** (événements et NC, prévention, DUERP, habilitations, veille, audits, documents, environnement), à transmettre par l'utilisateur ; chacun fera l'objet d'une spécification, comme celle des actions, et pourra modifier les 145 éléments marqués PA (point 18 de la spécification des actions).

### Classe 4 — Dépend d'un tiers technique (21 éléments, 38,5–124 j)

Système externe ou infrastructure : API, tenant Microsoft, messagerie, hébergement. Le développement peut parfois commencer sur un bouchon (fournisseur OIDC factice, transport de test), mais l'élément n'est livré qu'une fois le système disponible.

- **Messagerie de l'entreprise : compte d'envoi des e-mails** — *auprès de : informatique.* Attendu : relais SMTP (hôte, port, compte, SPF/DKIM du domaine) ou Microsoft Graph `Mail.Send` limité à une boîte d'envoi dédiée, avec le consentement de l'administrateur du tenant. Éléments : **ACT-34** (P1 · S) Compte d'envoi des e-mails ; **INT-04** (P1 · L) Notifications sortantes e-mail, Teams, push. Remarque : ACT-33 se développe et se teste sans (transport « fichier ») ; seul l'envoi réel du rappel du mercredi attend ce compte.
- **Signature électronique et accès des entreprises extérieures** — *auprès de : informatique, achats.* Attendu : compte d'envoi des e-mails ou service de signature électronique, lien signé pour les entreprises extérieures, hébergement public. Éléments : **PRV-18** (P3 · L · PA) Signature à distance ou envoi du plan à l'entreprise extérieure.
- **Microsoft Entra ID : tenant réel** — *auprès de : administrateur du tenant.* Attendu : inscription de Vigie (et de Keystone pour l'API), personnes réelles ; flux iCalendar joignable depuis Internet en HTTPS. Éléments : **INT-11** (P3 · L) API Vigie pour Keystone ; **INT-17** (P3 · M) Flux iCalendar des échéances. Remarque : l'inscription conditionne aussi la mise en service (SEC-01, livré et éprouvé avec un fournisseur factice), la recette d'EVT-22 et ACT-34 par Graph.
- **Socle des connecteurs** — *auprès de : équipes Keystone, Cursus ; hébergement.* Attendu : API d'au moins un système pour éprouver le socle, serveur cible autorisant les flux sortants. Éléments : **INT-01** (P1 · L) Socle commun des connecteurs. Remarque : la planification (PRD-12) est livrée avec ACT-33.
- **API Keystone** — *auprès de : équipe Keystone.* Attendu : projets, affectations, responsables de projet, données fournisseurs et clients, compte de service. Éléments : **INT-02** (P1 · L) Connecteur Keystone : projets et affectations ; **INT-05** (P2 · M · PA) Projets Keystone référencés par identifiant ; **INT-12** (P3 · M · PA) Filtre « Mes projets » ; **INT-15** (P3 · M · PA) Indicateurs fournisseurs et satisfaction depuis Keystone ; **VEI-17** (P3 · M · PA) Projets Keystone concernés : rattachement et critère ; **ACT-41** (P2 · M) Actions des projets Keystone remontées dans le plan d'actions. Remarque : INT-02 d'abord ; PRV-20 s'y ajoute si la réponse est oui.
- **API Cursus** — *auprès de : équipe Cursus, RH.* Attendu : personnel (matricule, statut, date d'entrée, contrat, poste, date de naissance), formations et titres, effectifs et expositions, services et destinataires. Éléments : **INT-03** (P1 · L · PA) Connecteur Cursus : personnel ; **INT-09** (P2 · L · PA) Formations avec Cursus ; **HAB-08** (P2 · M · PA) Date d'entrée, contrat et formation sécurité à l'embauche ; **HAB-20** (P3 · M · PA) Jeunes travailleurs : dérogation aux travaux réglementés ; **DUE-08** (P2 · M · PA) Facteurs de pénibilité et effectifs exposés ; **DOC-07** (P2 · L · PA) Diffusion contrôlée et prise de connaissance ; **HAB-21** (P2 · M · PA) Habilitations et formations en consultation seule pour le service QHSE. Remarque : INT-03 d'abord ; DOC-07 suppose aussi le tenant Entra ; HAB-02, EVT-08 et HAB-07 s'y ajoutent selon les réponses.
- **Trackdéchets** — *auprès de : établissement (compte Trackdéchets).* Attendu : jeton API ; les SIRET des sites sont saisissables depuis DOC-02. Éléments : **INT-10** (P2 · L · PA) Connecteur Trackdéchets. Remarque : DOC-12 aligne les statuts de BSD en amont.
- **Légifrance** — *auprès de : plateforme PISTE.* Attendu : compte et identifiants OAuth. Éléments : **INT-16** (P3 · M · PA) Alerte Légifrance. Remarque : VEI-10 (URL Légifrance saisie) se fait sans attendre.

## 3. Tableau de bord, échéances et navigation (TDB)

18 éléments — P1 : 5 · P2 : 4 · P3 : 9 — charge indicative 13,5–36 j.

Au 17/10/2026 : 7 livrés (✅ TDB-01, TDB-02, TDB-04, TDB-05, TDB-06, TDB-07, TDB-09) · 2 partiels (◐ TDB-12, TDB-15) — reste 11 éléments ouverts (C1 : 8 · C2 : 3 ; PA : 3), charge indicative 7,5–19 j.

| Réf | Élément | Priorité | Taille | Dépend de | Classe |
|---|---|:-:|:-:|---|:-:|
| TDB-01 | ✅ Destinataires des alertes : un animateur QHSE par site, tiré des données | **P1** | M | Migration sites.qhseLeadId ; rôles réels Entra ID | — |
| TDB-02 | ✅ Échéances masquées pour un responsable sans accès à l'écran source | **P1** | M | — | — |
| TDB-03 | Saisie mensuelle des heures travaillées (base du TF1/TG) | **P1** | M | Levée du report « aucune saisie/import » | C2 |
| TDB-04 | ✅ TF1/TG : fenêtre de 12 mois, mois manquants et « — » sans heures | **P1** | S | — | — |
| TDB-05 | ✅ « Mes échéances » consolidées tous sites | **P1** | M | — | — |
| TDB-06 | ✅ Notifications d'information (réaffectation d'une action, suite d'un signalement) | P2 | M | ACT-30 | — |
| TDB-07 | ✅ État lu : clé avec date d'échéance et gravité, retards triés par ancienneté | P2 | M | — | — |
| TDB-08 | Archivage d'un site : avertir des éléments encore ouverts | P2 | M | — | C2 |
| TDB-09 | ✅ Traçabilité des sites : journaliser la règle Seveso / PP et afficher l'historique | P2 | S | — | — |
| TDB-10 | Purge des états lus et commentaire de schéma obsolète | P3 | S | TDB-07 | C1 |
| TDB-11 | Marquer lue une échéance ouverte depuis À faire ou le tableau de bord | P3 | S | — | C1 |
| TDB-12 | ◐ Liens du tableau de bord vers des listes vraiment filtrées | P3 | M | EVT-13 ; ACT-27 | C1 · PA |
| TDB-13 | Exactitude des KPI du tableau de bord | P3 | S | — | C1 · PA |
| TDB-14 | Carte « Veille réglementaire » après la date d'application | P3 | S | — | C1 · PA |
| TDB-15 | ◐ Indiquer le site en vue « Tous les sites » | P3 | S | — | C1 |
| TDB-16 | Horizons d'échéances centralisés et groupes de À faire | P3 | S | — | C1 |
| TDB-17 | Titres d'onglet du tableau de bord et de À faire | P3 | S | — | C1 |
| TDB-18 | Recherche globale dans l'en-tête | P3 | M | — | C2 |

- **TDB-01** — Les alertes de tous les domaines et le pilote par défaut des recyclages visent QHSE_LEAD, une personne de démonstration fixe. Il faut un responsable QHSE par site (dans « Gérer les sites »), utilisé par les load\*Signals. (preuve : src/lib/domain.ts:301-304 ; src/components/skills/common.tsx:16,41 ; src/lib/data/skills.ts:254-265 ; src/lib/data/events.ts:318-326 ; src/lib/data/risks.ts:486-487 ; src/lib/data/actions.ts:303 ; src/lib/data/audits.ts:272,282 ; src/lib/data/review.ts:639-650 ; src/db/schema.ts:10-22)
  ✅ **Livré (12/10/2026)** — colonne `sites.qhse_lead_id`, modifiable dans « Gérer les sites » ; `loadQhseLeads()` adresse les alertes au responsable du site concerné (poste vacant : animateurs QHSE, « responsable à désigner ») ; lot 2 : alertes DUERP par unité au responsable QHSE du site de l'unité (`unitRiskTodos`, test à deux sites et deux responsables), le validateur ne reçoit plus que les alertes de niveau DUERP.
  *Question : Un animateur par site ou un seul ? Qui reçoit les alertes si le poste est vacant ?*
- **TDB-02** — loadVisibleTodo écarte les échéances dont le lien vise un écran fermé au rôle, même pour leur responsable (visite S. Benali, audit E. Dubois, contributions de revue). (preuve : src/lib/data/todo.ts:32-36 ; src/lib/data/review.ts:623-625 ; src/lib/data/audits.ts:259-267 ; src/lib/domain.ts:276-287 ; src/db/seed.ts:263,306)
  ✅ **Livré (12/10/2026)** — règle pure `visibleTodo` (`src/lib/todo-visibility.ts`) : le responsable d'une échéance (`ownerIds`) la garde même quand l'écran source lui est fermé, avec un lien vers la vue en lecture (`readHref`, par exemple « Mes contributions ») ou sans lien ; un écran en consultation seule ne montre que les échéances de la personne ; données de santé jamais révélées, responsable compris.
  *Question : Vue en lecture de l'élément, ou échéance sans lien ?*
- **TDB-03** — hours_worked n'est rempli que par le seed (10/2025-09/2026). Ajouter saveHoursWorked (site, mois, requireApprover), une fenêtre depuis le KPI TF1 et un signal « heures de M-1 non saisies ». (preuve : src/db/seed.ts:349-354 ; src/lib/data/dashboard.ts:25,38-40 ; src/lib/data/review.ts:97,113)
  *Question : Saisie manuelle ou import (paie, Lucca, Cursus) ? Intérimaires inclus ?*
- **TDB-04** — La comparaison de chaînes inclut un 13e mois, les mois manquants gonflent les taux sans avertissement, et 0 heure affiche TF1 0,0. Extraire une fonction pure testée utilisée par le tableau de bord et la revue. (preuve : src/lib/data/dashboard.ts:37-40,66 ; src/lib/data/review.ts:113,364-369)
  ✅ **Livré (12/10/2026)** — TF1/TG par la fonction pure `safetyRates` sur les 12 derniers mois complets (`lastFullMonths`) ; sans heures : « — » et « Heures travaillées non saisies » ; mois manquants signalés (« Heures manquantes : … », ton d'alerte), y compris le mois d'un AT avec arrêt d'un site sans heures saisies (l'accident prouve l'activité) ; accidents de l'effectif seulement (`workforceAccident` : ni intérimaire, déclaré par l'ETT, ni personne extérieure), comme le KPI « Jours sans accident avec arrêt » et la pyramide ; même calcul dans le dossier de revue.
- **TDB-05** — Notifications et À faire ne couvrent que le site sélectionné : une personne ne voit pas ses échéances d'un autre site. (preuve : src/lib/data/todo.ts:21-28 ; src/lib/data/notifications.ts:24-34 ; src/lib/queries.ts:39-42 ; src/lib/session.ts:31,52-58)
  ✅ **Livré (12/10/2026)** — « Toutes » = échéances du site sélectionné que le rôle peut traiter, plus celles de la personne sur tous les sites de son périmètre (nom court du site affiché) ; server action `openTodo` : sélectionne le site de l'échéance (ou « Tous les sites ») puis ouvre le lien ; badges des écrans limités au site sélectionné, badge « À faire » sur tout le périmètre. Réserve : l'état lu reste attaché au lien d'origine (les échéances de coactivité, dont le lien porte désormais `&site=`, réapparaissent une fois non lues).
  *Question : Consolider tous sites pour chaque personne, indépendamment du sélecteur ?*
- **TDB-06** — La cloche ne contient que des échéances : rien quand une action est confiée ou réaffectée, ni pour le déclarant quand son signalement est qualifié, classé ou clôturé. (preuve : src/lib/data/notifications.ts:24-34 ; src/server/plan.ts:117-146)
  **À revoir avec ACT-30 (15/10/2026)** — la notification « action confiée » est livrée par ACT-30 (table de notifications d'information réutilisable, dans la cloche seulement, jamais par e-mail) ; restent la réaffectation d'une action (proposition non bloquante d'ACT-30) et l'information du déclarant quand son signalement est qualifié, classé ou clôturé.
  ◐ **Partiel (15/10/2026, paquet 1)** — livré : notifications d'information stockées (« Action confiée » à la création et à la réaffectation, commentaires et preuves du responsable au QHSE), cloche réutilisable. Reste : information du déclarant quand son signalement est qualifié, classé ou clôturé.
  ✅ **Livré (17/10/2026, paquet 2)** — suite d'un signalement : son déclarant nominatif (`declarant_id`, jamais un signalement anonyme ni un déclarant externe sans compte) reçoit une notification stockée « Suite de votre signalement » quand il est qualifié, classé sans suite ou clôturé (`notifyReportOutcome`, `src/server/notify.ts`, dans la transaction de `advanceEvent` / `dismissEvent`), sauf s'il est l'auteur du changement ; intitulé de l'événement seul (aucune donnée de santé), lien vers « Mes signalements » (`/signaler/mes-signalements/<id>`), gardé tant qu'il en est le déclarant ; cloche seulement, aucun e-mail, aucune migration (type `signalement_suite`, entité `event`). La réaffectation d'une action était livrée par ACT-30.
- **TDB-07** — todoKey ignore la date et le ton : une échéance récurrente ou aggravée reste lue. Les retards ont tous la date du jour. Ajouter dueOn à TodoItem, à la clé et au tri. (preuve : src/lib/domain.ts:319-336 ; src/lib/data/watch.ts:265-298 ; src/lib/data/audits.ts:259-275 ; src/lib/data/review.ts:640-650)
  ✅ **Livré (17/10/2026, paquet 4)** — `TodoItem.dueOn` (date d'échéance réelle, aussi pour un retard daté du jour) renseigné par les signaux des actions, audits, certificats, contrôles, exigences, habilitations, DUERP, revues, plans et permis, documents, déchets et relevés, AT ; clé d'état lu `todoKey` = base (type|lien|intitulé ou `key`) | gravité | `dueOn` — une échéance aggravée (à venir → dépassée) ou récurrente (nouvelle date) redevient non lue, un retard garde sa clé de jour en jour ; retards triés par ancienneté (`byUrgency`, cloche), puis les échéances à venir par date. Sans migration : les états lus enregistrés avant (clés sans gravité ni date) ne correspondent plus, chaque échéance déjà lue réapparaît non lue une seule fois ; les anciennes clés restent dans `notification_reads` (purge : TDB-10).
- **TDB-08** — archiveSite ne vérifie que le dernier site actif. Afficher le décompte des éléments ouverts, voire bloquer ou proposer un transfert. (preuve : src/server/sites.ts:71-94 ; src/components/SitesManager.tsx:84-90)
  **À revoir avec ACT-20 (15/10/2026)** — un transfert en masse vers un autre site doit garder la règle du site unique des actions.
  *Question : Blocage ou avertissement ? Transfert en masse ?*
- **TDB-09** — saveSiteRule n'appelle pas logChange alors qu'elle change rétroactivement les écarts ; l'historique des sites n'est affiché nulle part. (preuve : src/server/sites.ts:121-138 ; src/components/SitesManager.tsx:21-68)
  ✅ **Livré (17/10/2026, paquet 3)** — la règle de prévention d'un site (classement Seveso, plan dès la première minute) est journalisée sur le site dans la transaction de `saveSiteRule` (détail ancien → nouveau, « écarts des interventions recalculés ») ; historique du site chargé à l'ouverture (`LazyChangeLog` « site », validateurs, quel que soit le site sélectionné) dans « Gérer les sites › Modifier » et dans la fenêtre de la règle (Prévention).
- **TDB-10** — notification_reads grossit sans limite et le commentaire du schéma décrit une purge supprimée. (preuve : src/server/notifications.ts:28-40 ; src/db/schema.ts:646-652)
  **À revoir avec ACT-30 et ACT-33 (15/10/2026)** — la purge doit couvrir aussi la table des notifications d'information et le journal d'envoi des e-mails ; le prérequis « tâches planifiées » est déjà couvert par la maintenance horaire (`src/db/maintenance.ts`) ; à faire après TDB-07, dont les nouvelles clés multiplient les états lus périmés.
  **Mise à jour (15/10/2026)** — la purge doit aussi couvrir `notifications` et `action_reminder_sends` (paquet 1).
- **TDB-11** — Seul le clic dans la cloche appelle markNotificationsRead. (preuve : src/app/(app)/a-faire/page.tsx:64 ; src/app/(app)/page.tsx:102-104 ; src/components/NotificationBell.tsx:62)
- **TDB-12** — « Actions en retard », « > 30 j » et les trois barres AT ouvrent des listes non filtrées. (preuve : src/lib/data/dashboard.ts:63-68,76-78 ; src/app/(app)/actions/page.tsx:55-75 ; src/app/(app)/evenements/page.tsx:38-44)
  **À revoir avec ACT-27 (15/10/2026)** — les KPI « Actions en retard » et « > 30 j » ouvrent la vue générale filtrée (`?retard=1`) ; les barres AT attendent les filtres d'EVT-13 (filtre par blessure réservé à `canSeeHealth`).
  ◐ **Partiel (15/10/2026, paquet 1)** — livré : « Actions en retard » ouvre `/actions?retard=1`. Reste : « > 30 j » et les barres AT (filtres d'EVT-13).
- **TDB-13** — « 7 derniers jours » compte par date des faits, la note Contrôles cite le premier et non le plus en retard, une NC sans origine n'a pas de barre, la NC « Réclamation client » est fusionnée avec les RC. (preuve : src/lib/data/dashboard.ts:44,52,57-59,67,69,84,101 ; src/lib/domain.ts:52)
  **À revoir avec ACT-29 (15/10/2026)** — les KPI d'actions du tableau de bord sont à revoir avec les statistiques de la refonte.
- **TDB-14** — La carte reste « Applicable au [date passée] ». Afficher « depuis le » avec l'état de conformité ou retirer de la une. (preuve : src/app/(app)/page.tsx:147-155 ; src/lib/data/dashboard.ts:87,110-123)
- **TDB-15** — Échéances et derniers signalements n'indiquent pas le site (TodoItem sans site). (preuve : src/lib/domain.ts:319-331 ; src/app/(app)/page.tsx:95-108,122 ; src/app/(app)/a-faire/page.tsx:73-75)
  ◐ **Partiel (constaté le 15/10/2026)** — livré avec TDB-05 : « À faire » affiche le site des échéances qui portent sur un autre site du périmètre. Reste : le site des échéances et des derniers signalements en vue « Tous les sites », sur le tableau de bord et dans « À faire ».
- **TDB-16** — Prévention et coactivité ont leurs constantes à 15 j ; À faire range tout au-delà de 15 j dans « Contrôles à 30 jours ». (preuve : src/components/prevention/model.ts:12 ; src/lib/data/prevention.ts:682 ; src/components/sitemap/model.ts:8 ; src/lib/data/sitemap.ts:310 ; src/lib/data/dashboard.ts:155-160)
- **TDB-17** — Ces deux pages n'exportent pas de metadata.title. (preuve : src/app/(app)/page.tsx:1-13 ; src/app/(app)/a-faire/page.tsx:1-14 ; src/app/layout.tsx:9-12)
- **TDB-18** — Recherche par référence ou intitulé, filtrée par site et droits, vers les liens profonds existants. Hors maquette. (preuve : src/components/PageHeader.tsx:7-22)
  *Question : Souhaitée alors que la maquette n'en prévoit pas ?*

## 4. Événements et signalement terrain (EVT)

29 éléments — P1 : 7 · P2 : 16 · P3 : 6 — charge indicative 30,5–89 j.

Au 18/10/2026 : 15 livrés (✅ EVT-01, EVT-02, EVT-03, EVT-04, EVT-05, EVT-06, EVT-07, EVT-09, EVT-10, EVT-11, EVT-12, EVT-17, EVT-23, EVT-25, EVT-26) · 1 partiel (◐ EVT-15) — reste 14 éléments ouverts (C1 : 7 · C2 : 7 ; PA : 13), charge indicative 16–48 j.

| Réf | Élément | Priorité | Taille | Dépend de | Classe |
|---|---|:-:|:-:|---|:-:|
| EVT-01 | ✅ Accident du travail : victime, circonstances et rubriques de la DAT | **P1** | L | Décision RGPD données de santé ; people en attendant Cursus | — |
| EVT-02 | ✅ Clôture d'un AT sans déclaration CPAM : l'obligation disparaît | **P1** | S | — | — |
| EVT-03 | ✅ Délai CPAM : 48 h hors dimanches et fériés, à compter de la connaissance | **P1** | S | Calendrier des jours fériés dans src/lib/dates.ts | — |
| EVT-04 | ✅ Registre des accidents bénins | **P1** | M | Victime et lésions de l'AT | — |
| EVT-05 | ✅ Qualification : exiger les données propres au type | **P1** | S | — | — |
| EVT-06 | ✅ « Nouveau signalement » : lieu de démonstration et cible du bouton | **P1** | S | — | — |
| EVT-07 | ✅ Parcours terrain authentifié et signalement sans compte | **P1** | L | Entra ID | — |
| EVT-08 | Suivi de l'arrêt de travail : périodes, reprise, jours perdus calculés | P2 | M | Décision : saisie ou paie / Cursus | C2 · PA |
| EVT-09 | ✅ Maladies professionnelles et accidents de trajet | P2 | M | Victime de l'AT | — |
| EVT-10 | ✅ Synthèse imprimable de la DAT et feuille d'accident | P2 | M | Victime de l'AT | — |
| EVT-11 | ✅ Analyse des causes vidable ou méthode changeable après « Actions » | P2 | S | — | — |
| EVT-12 | ✅ Journal : analyse, méthode et réception des signalements terrain | P2 | S | — | — |
| EVT-13 | Filtres de la liste : blessure, étape, pilote, période, gravité, ancienneté | P2 | M | — | C1 · PA |
| EVT-14 | Événements liés sur les fiches contrôle et document | P2 | M | — | C1 · PA |
| EVT-15 | ◐ Échéances événement manquantes | P2 | M | — | C2 · PA |
| EVT-16 | Clôture d'un événement réservée aux approbateurs ? | P2 | S | — | C2 · PA |
| EVT-17 | ✅ Traitement des produits non conformes et coût de non-qualité | P2 | M | — | — |
| EVT-18 | Formulaire terrain : choix du site et QR code périmé | P2 | M | — | C2 · PA |
| EVT-19 | Rattacher l'événement à sa zone et protéger les zones porteuses de QR | P2 | M | — | C1 · PA |
| EVT-20 | Signalement installable (PWA) | P2 | M | HTTPS | C1 |
| EVT-21 | File d'attente hors ligne des signalements | P2 | L | PWA | C2 · PA |
| EVT-22 | Espace salarié mobile (mes actions, mes habilitations) | P2 | L | ACT-24, ACT-25 ; Entra ID (recette) | C1 · PA |
| EVT-29 | Événement déclaré par tous, modifié et suivi par le service QHSE | P2 | S | Formulaire Power Apps Événements | C2 · PA |
| EVT-23 | ✅ Formulaire événement : le champ Site propose des sites refusés | P3 | S | — | — |
| EVT-24 | « Nouvel événement » prérempli depuis contrôle, risque, document, environnement | P3 | S | — | C1 · PA |
| EVT-25 | ✅ Fiche événement : action annulée ou clôturée ouverte en modification | P3 | S | ACT-21 | — |
| EVT-26 | ✅ « Plan d'actions → » filtré sur l'événement | P3 | S | ACT-27 | — |
| EVT-27 | Vue déclarant : photos et périmètre de /evenements | P3 | S | — | C1 · PA |
| EVT-28 | Suivi d'un signalement anonyme par code | P3 | M | — | C2 · PA |

- **EVT-01** — Ajouter victime (salarié, intérimaire, externe), heure, horaire, siège et nature des lésions, témoins, date de connaissance, réserves (Cerfa 14463), avec accès restreint. (preuve : src/db/schema.ts:73-107 ; src/components/events/EventEditButton.tsx:120-134)
  ✅ **Livré (12/10/2026)** — rubriques de la DAT sur la fiche d'un AT : victime (salarié de l'effectif, intérimaire avec son entreprise de travail temporaire, ou personne extérieure), heure, horaire de travail, date de connaissance (`knownAt`), activité, circonstances, témoins, tiers ; nature et siège des lésions, soins, réserves, pièces médicales : données de santé (`HEALTH_LABELS`, `attachments.health`, direction et animateur QHSE) ; obligation de déclaration selon la victime (`declarationDuty`) : l'entreprise déclare l'accident d'un salarié, informe l'ETT sous 24 h pour un intérimaire (R. 412-2 CSS), ne déclare pas celui d'une personne extérieure ; composants `AccidentFields` et `AccidentSection`. Réserves : l'aide de saisie sur les lésions ne porte que sur l'intitulé et la description (pas sur circonstances, activité ni mesures immédiates, visibles de l'encadrement) ; un AT requalifié en un autre type garde ses pièces médicales, qui ne s'affichent plus (fiche médicale rendue pour un AT seulement).
  *Question : Quels champs tenir dans Vigie et qui peut lire les lésions ?*
- **EVT-02** — Un AT peut être clôturé sans cpamDeclaredOn et l'échéance sort alors des signaux. Bloquer dans advanceBlocker ou garder le signal. (preuve : src/lib/data/events.ts:324 ; src/components/events/shared.ts:16-39,49-53)
  ✅ **Livré (12/10/2026)** — clôture d'un AT réservée à l'animateur QHSE et à la direction, refusée tant que la déclaration CPAM n'est pas saisie, sauf inscription au registre des accidents bénins ou motif tracé (`waiveCpamDeclaration` / `cancelCpamWaiver`, journalisés) ; intérimaire ou personne extérieure : clôture après le motif « déclaration par l'ETT » ou « par l'employeur de la victime » ; l'échéance reste visible quelle que soit l'étape.
  *Question : Bloquer la clôture ou garder l'échéance visible ?*
- **EVT-03** — Le délai est occurredOn + 2 jours calendaires (R. 441-3 CSS non respecté). Ajouter aussi l'échéance des réserves motivées (10 jours francs). (preuve : src/lib/data/events.ts:117,325 ; src/lib/domain.ts:34 ; src/lib/dates.ts:19)
  ✅ **Livré (12/10/2026)** — `src/components/events/deadlines.ts` (fonction pure testée) : 48 h à compter de la connaissance (`knownAt`, à défaut l'enregistrement dans Vigie, ou l'escalade depuis le registre bénin), dimanches et jours fériés exclus (Pâques calculée), option par site « Alsace-Moselle » (Vendredi saint, 26 décembre ; case de « Gérer les sites ») ; délai des réserves motivées (10 jours, reporté au premier jour ni samedi, ni dimanche, ni férié) affiché sur la fiche ; intérimaire : information de l'ETT sous 24 h d'heure à heure (`ettDeadline`) ; accident bénin : inscription au registre (ou déclaration) dans les mêmes 48 h ; aucune échéance pour une personne extérieure. Réserve : la date saisie est celle de l'envoi des réserves (« adressées le »), pas de leur réception par la caisse, et une date postérieure au délai reste affichée sans alerte.
  *Question : Point de départ : date de l'accident ou createdAt ? Fériés Alsace-Moselle ?*
- **EVT-04** — Le libellé existe mais pas le registre (R. 441-3, D. 441-1 CSS) : vue imprimable par site, secouriste SST valide, bascule en déclaration si arrêt ultérieur. (preuve : src/lib/data/events.ts:113-115 ; src/components/events/shared.ts:55-56)
  ✅ **Livré (12/10/2026)** — registre par site (`benign_accidents`, numérotation continue sous verrou), inscription d'un AT sans arrêt ni soins médicaux (premiers soins), d'une victime de l'effectif (ni intérimaire ni personne extérieure), une fois saisies les mentions du registre (victime, lieu, circonstances, nature et siège des lésions), avec le donneur de soins (secouriste du travail dont le titre est valide à la date des soins : case « Secourisme » des titres suivis), visa enregistré par sa date, escalade vers la CPAM, annulation motivée ; page imprimable `/evenements/registre-benin` (A4 paysage) ; réservé à la direction et à l'animateur QHSE (redirection dans `src/proxy.ts` aussi).
  *Question : Registre par site ou unique ? Visa de la victime dans Vigie ?*
- **EVT-05** — Seul le pilote est exigé : un AT sans blessure sort du TF1/TG, une NC sans origine tombe dans « Autre ». (preuve : src/components/events/shared.ts:22-24 ; src/server/events.ts:191-192 ; src/lib/data/dashboard.ts:35,58,77)
  ✅ **Livré (12/10/2026)** — champs obligatoires à la qualification selon le type (`QUALIFICATION_FIELDS`, `src/lib/domain.ts`) : contrôlés par `advanceEvent`, non effaçables une fois l'événement qualifié (`saveEvent`), signalés dans le formulaire.
  *Question : Quels champs obligatoires à la qualification ?*
- **EVT-06** — /apercu-mobile crée de vrais événements avec DEMO_POST et un cadre iPhone même sur téléphone. Viser /signaler sur mobile et retirer le poste codé en dur. (preuve : src/app/(app)/apercu-mobile/page.tsx:17,40-46 ; src/components/PageHeader.tsx:18 ; src/app/(app)/page.tsx:125)
  ✅ **Livré (11/10/2026)** — « Nouveau signalement » ouvre `/signaler` (formulaire réel, responsive) ; `/apercu-mobile` et le poste de démonstration réservés à la démonstration.
  *Question : Cible en production selon le rôle ?*
- **EVT-07** — createReport repose sur le cookie de démonstration. Choisir : Entra sur mobile, borne partagée ou formulaire public anonyme protégé. (preuve : src/server/events.ts:475-526 ; src/lib/session.ts:14-34 ; src/lib/domain.ts:272 ; src/app/signaler/page.tsx:13-19)
  ✅ **Réserve levée (12/10/2026)** — nombre de proxys de confiance pour `X-Forwarded-For` (`VIGIE_TRUSTED_PROXIES`, `clientIpFrom`) ; purge des empreintes d'IP à l'ouverture de la base puis toutes les heures (`src/db/maintenance.ts`), table `report_rate_limits` exclue des sauvegardes ; signalement anonyme : photos renommées et canal neutre (**SEC-09**, ◐ : EXIF retiré côté navigateur seulement).
  ✅ **Livré (11/10/2026)** — Personne connectée : signalement en son nom, « Mes signalements ». Sans compte : QR code de poste à jeton HMAC (`VIGIE_REPORT_SECRET`, `map_zones.qr_version`, « Régénérer le QR » dans `/signaler/postes`), formulaire anonyme ou nominatif déclaratif (nom, entreprise), champ piège, photos contrôlées, limite de débit en base (`report_rate_limits`, par client puis par poste). Réserves : la limite par adresse IP suppose un reverse proxy qui réécrit `X-Forwarded-For` (sinon contournable ; aucun réglage du nombre de proxys de confiance, `src/lib/report-guard.ts`) ; les empreintes d'IP ne sont purgées qu'au signalement suivant et figurent dans les sauvegardes (clé = `VIGIE_REPORT_SECRET`) ; noms d'origine des photos et `reported_via='session'` conservés pour un signalement anonyme (**SEC-09**) ; non traités : journal de `createReport` (**EVT-12**), suivi d'un anonyme par code (**EVT-28**), « Régénérer le QR » depuis l'éditeur de zones de la carte.
  *Question : Comment signalent intérimaires et entreprises extérieures ?*
- **EVT-08** — lostDays est saisi à la main et vaut 0 s'il manque. Gérer les périodes d'arrêt (prolongation, rechute, reprise), calculer TG, signaler visite de reprise (R. 4624-31) et pré-reprise. (preuve : src/server/events.ts:193 ; src/lib/data/dashboard.ts:40 ; src/components/events/EventEditButton.tsx:125-127)
  *Question : Dates d'arrêt saisies par la QHSE ou venues de la paie / Cursus ?*
- **EVT-09** — Ajouter les types MP (R. 461-9) et accident de trajet, ce dernier exclu du TF1/TG. (preuve : src/lib/domain.ts:14-23 ; src/lib/data/dashboard.ts:35-40)
  ✅ **Livré (18/10/2026, paquet 5)** — type « Maladie professionnelle » (MP) : événement réservé à l'animateur QHSE et à la direction (`canSeeEventType` : absent des listes, fiches, indicateurs, échéances, pièces jointes et server actions des autres rôles, « Événement introuvable »), jamais signalé depuis le terrain ; intitulé imposé « Maladie professionnelle » (ni victime ni maladie), sans rattachement ; tableau, maladie, certificat médical initial, déclaration reçue de la CPAM et questionnaire employeur (échéance de santé à 30 jours francs de sa réception, R. 461-9 CSS) dans `HEALTH_LABELS` ; pièces médicales admises. Accident de trajet (case « Accident de trajet », `events.commute`, L. 411-2) : déclaré comme un AT (48 h, rubriques de la DAT), exclu du TF1, du TG, des jours sans accident et de la pyramide (`workforceAccident`). Réserve : délais de la caisse (réserves motivées d'une MP) non suivis — à confirmer (§ 19, paquet 5).
- **EVT-10** — Vue d'impression navigateur des rubriques DAT pour net-entreprises et feuille d'accident (L. 441-5). (preuve : aucune occurrence de « Cerfa » ni de vue d'impression DAT dans src ; src/db/schema.ts:73-107)
  ✅ **Livré (18/10/2026, paquet 5)** — « Synthèse DAT » de la fiche d'un AT (`/evenements/imprimer/<id>`, animateur QHSE et direction, `HEALTH_PAGES`, consultation tracée) : rubriques à reporter sur net-entreprises.fr (Cerfa 14463 : établissement et SIRET, victime, accident, lésions, témoins, tiers, déclaration et réserves), puis feuille d'accident à remettre à la victime (Cerfa 11383, L. 441-5) avec cadres de remise. Pas de génération du Cerfa officiel.
- **EVT-11** — La règle n'est vérifiée qu'au passage à l'étape 3 : un événement peut être clôturé sans analyse. (preuve : src/components/events/shared.ts:25-28 ; src/server/events.ts:160-172,406-408)
  ✅ **Livré (17/10/2026, paquet 4)** — à partir de l'étape « Actions », l'analyse de la méthode retenue ne se vide plus et la méthode ne change que pour une méthode déjà renseignée (`analysisChangeBlocker`, `saveAnalysis`, `setAnalysisMethod`, refus sans écriture) ; la clôture exige encore l'analyse (fiche reprise ou vidée auparavant), après les autres contrôles de l'étape (`advanceBlocker`). Les autres méthodes restent modifiables. Réserve : les événements du jeu de démonstration aux étapes 3 et 4 sans analyse doivent la recevoir avant leur clôture.
- **EVT-12** — saveAnalysis, setAnalysisMethod et createReport n'écrivent pas de change_log (byId: null pour un anonyme). (preuve : src/server/events.ts:160-172,361-414,475-526 ; src/server/changelog.ts:33-34)
  ✅ **Livré (17/10/2026, paquet 3)** — `setAnalysisMethod` (méthode ancienne → nouvelle), `saveAnalysis` (« Analyse des causes (méthode) saisie / modifiée / vidée », sans le contenu, qui peut décrire l'accident ; même contenu : rien) et `createReport` (réception : « Signalement reçu depuis Vigie », « … sans compte (QR code du poste …) », « Signalement anonyme reçu ») journalisés dans leur transaction ; auteur = déclarant connecté, jamais pour un signalement anonyme ou sans compte (`byId` null, affiché « Vigie »).
- **EVT-13** — La liste ne filtre que par onglet, type, origine et texte. (preuve : src/app/(app)/evenements/page.tsx:38-57)
  **À revoir avec ACT-27 (15/10/2026)** — aligner sur les filtres de la vue générale des actions (pas de vues enregistrées) ; filtre « blessure » réservé à `canSeeHealth` ; prérequis de TDB-12.
- **EVT-14** — Un événement pointe vers un contrôle ou un document, mais ces fiches ne listent pas leurs événements (ni les actions clôturées du document). (preuve : src/lib/data/events.ts:61-86 ; src/lib/data/watch.ts:85-98 ; src/lib/data/documents.ts:156-158)
- **EVT-15** — Ajouter : délai d'analyse, pilote sorti de l'effectif, toutes actions clôturées sans passage à « Efficacité vérifiée », seule action annulée, action rouverte sur événement clos. (preuve : src/lib/data/events.ts:303-334 ; src/server/plan-ui.ts:24-30,98-130)
  **À revoir avec ACT-18 et ACT-23 (15/10/2026)** — « Efficacité vérifiée » quand les actions liées sont Vérifiées ou Abandonnées ; cas de l'action de suite d'une vérification non efficace sur un événement clos (point 12 de la spécification).
  *Question : Quels délais retenir ?*
  ◐ **Partiel (15/10/2026, paquet 1)** — livré : « Efficacité vérifiée » exige des actions liées Vérifiées ou Abandonnées ; action de suite ouverte sur un événement clos : échéance « Événement clos — action de suite ouverte : décider d'une réouverture » au responsable QHSE du site. Reste : délai d'analyse, pilote sorti, seule action abandonnée (questions au § 19).
- **EVT-16** — advanceEvent n'exige que requireManager alors que réouverture et classement exigent requireApprover. (preuve : src/server/events.ts:38-40,71-73,101-103)
  *Question : Qui valide la clôture ?*
- **EVT-17** — Ajouter décision de traitement (retouche, rebut, dérogation, retour), quantités et coût (ISO 9001 §8.7). (preuve : src/db/schema.ts:73-107)
  ✅ **Livré (18/10/2026, paquet 5)** — NC et réclamation client : décision de traitement (retouche ou reprise, rebut, acceptation par dérogation, retour au fournisseur), quantité concernée, coût de non-qualité (k€ HT, colonne `nc_cost_keur` partagée avec Keystone par la vue `pub_non_conformites`) et précisions (autorité et conditions obligatoires pour une dérogation), journalisés ; coût de non-qualité repris par les objectifs QHSE (AUD-13).
- **EVT-18** — Sans QR, le site n'est pas modifiable (premier site sous « Tous ») ; un QR de zone supprimée vide le lieu sans message. (preuve : src/server/events.ts:498-499 ; src/components/ReportForm.tsx:215 ; src/app/signaler/page.tsx:18-19 ; src/lib/data/events.ts:284-292)
  *Question : Code de poste stable indépendant de l'id de zone ?*
- **EVT-19** — L'événement ne garde que le lieu en texte ; deleteZone invalide les QR imprimés sans avertir. Ajouter zoneId, archivage de zone, lien vers le QR. (preuve : src/db/schema.ts:79 ; src/server/sitemap.ts:109-123 ; src/components/sitemap/dialogs.tsx:58-63)
- **EVT-20** — Manifeste, icônes, service worker pour /signaler, zones sûres iOS. (preuve : src/app/layout.tsx:9-14 ; src/app/signaler/page.tsx:9 ; public/ (plans/ seulement))
- **EVT-21** — Brouillon IndexedDB renvoyé au retour du réseau, clé d'idempotence, date et heure réelles de l'événement. (preuve : src/components/ReportForm.tsx:169-180 ; src/server/events.ts:510)
  *Question : Ajouter date et heure au formulaire terrain ?*
- **EVT-22** — Le parcours terrain n'offre que Signaler et Mes signalements ; ajouter Démarrer / Déclarer réalisée avec photo et ses échéances. (preuve : src/app/signaler/ (page.tsx, mes-signalements/, postes/) ; src/server/plan-ui.ts:18-22)
  **À revoir avec ACT-24 et ACT-25 (15/10/2026)** — le salarié responsable consulte ses actions, commente dans le fil et joint des preuves (photo) ; il ne les démarre ni ne les déclare plus réalisées (décision du 15/10/2026, § 20). La partie « mes actions » se fait après la refonte ; « mes habilitations » dépend du formulaire Power Apps Habilitations et, à terme, de Cursus.
- **EVT-23** — Tous les sites actifs sont listés alors que le serveur refuse tout autre site que le sélectionné. (preuve : src/components/events/EventEditButton.tsx:102-104 ; src/app/(app)/evenements/page.tsx:77,335 ; src/lib/guard.ts:32-37 ; src/server/events.ts:228-232)
  ✅ **Livré (12/10/2026)** — `options.sites` = exactement les sites qu'accepte `requireInSite(…, { create: true })` (`writableSites()`, `src/lib/guard.ts`), `options.allSites` pour « Tous les sites » ; test de concordance des deux règles.
- **EVT-24** — Seuls plan et permis préremplissent ; l'environnement renvoie vers /signaler?type=ENV. (preuve : src/lib/data/events.ts:340-356 ; src/app/(app)/environnement/page.tsx:278)
- **EVT-25** — Le clic ouvre le formulaire que le serveur refuse ensuite ; idem quand l'événement est verrouillé. (preuve : src/components/events/EventActions.tsx:31 ; src/app/(app)/evenements/page.tsx:342-345,402 ; src/server/plan.ts:51-52)
  **À revoir avec ACT-21 (15/10/2026)** — la fiche d'une action s'ouvre en lecture pour qui n'est pas QHSE ; seul le QHSE modifie ; nouveaux avancements Abandonnée et Vérifiée.
  ✅ **Livré (15/10/2026, paquet 1)** — depuis la fiche événement, seul le QHSE modifie une action non abandonnée ; les autres rôles ouvrent la fiche du plan d'actions en lecture.
- **EVT-26** — Pointer vers /actions?q=&lt;référence> avec les clôturées. (preuve : src/components/events/EventActions.tsx:45 ; src/app/(app)/actions/page.tsx:55,75)
  **À revoir avec ACT-27 (15/10/2026)** — « Plan d'actions → » ouvre la vue générale filtrée sur l'événement (une action n'a qu'un événement lié), historique compris.
  ✅ **Livré (15/10/2026, paquet 1)** — « Plan d'actions → » ouvre `/actions?q=<événement>&etat=historique`.
- **EVT-27** — Le détail mobile n'affiche que le nombre de photos ; /evenements filtre le Salarié par site alors que « Mes signalements » est tous sites. (preuve : src/components/events/MyReportDetail.tsx:92-97 ; src/app/(app)/evenements/page.tsx:50,244 ; src/lib/queries.ts:29-33)
  **À revoir avec ACT-18 (15/10/2026)** — statuts d'actions montrés au déclarant alignés sur les avancements de la refonte.
- **EVT-28** — Code secret remis à l'envoi, ouvrant un détail en lecture sans identifier l'auteur. (preuve : src/components/ReportForm.tsx:192-193 ; src/lib/data/events.ts:209-213)
  *Question : Risque de ré-identification acceptable ?*
- **EVT-29** — Réponse du service QHSE du 15/10/2026 : « tout le monde a la possibilité de déclarer un évènement QSE, qui peut être modifié et suivi par QHSE ». Aujourd'hui l'encadrement (pilote) modifie et fait avancer l'événement (`requireManager`). Revoir les droits de modification et d'avancement de l'écran Événements avec son formulaire Power Apps. (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md) § 22)
  *Classe C2 — Question au service QHSE, avec le formulaire Power Apps Événements : l'encadrement garde-t-il la modification et l'avancement des événements de son site ?*

## 5. Plan d'actions (ACT)

42 éléments (16 à l'inventaire du 10/10/2026, 24 ajoutés le 15/10/2026 par la refonte des actions QSE, 2 après les réponses du service QHSE du même jour) — P1 : 22 · P2 : 8 · P3 : 12 — charge indicative 37–103 j.

Au 17/10/2026 : 25 livrés (✅ ACT-01, ACT-13, ACT-17, ACT-18, ACT-19, ACT-20, ACT-21, ACT-22, ACT-23, ACT-24, ACT-25, ACT-26, ACT-27, ACT-28, ACT-30, ACT-32, ACT-33, ACT-35, ACT-37, ACT-40, ACT-31, ACT-38, ACT-02, ACT-03, ACT-29) · 11 remplacés (↪ ACT-04, ACT-05, ACT-06, ACT-07, ACT-08, ACT-09, ACT-10, ACT-11, ACT-14, ACT-15, ACT-16) — reste 6 éléments ouverts (C1 : 1 · C3 : 3 · C4 : 2), charge indicative 6,5–19 j.

**Refonte des actions QSE (15/10/2026).** Le formulaire Power Apps « Créer Actions QSE », deux tours de réponses du service QHSE et les arbitrages de l'utilisateur du 15/10/2026 redéfinissent le plan d'actions : dix avancements conduits par le service QHSE, vérification d'efficacité planifiée dès la création avec actions de suite, responsable qui consulte ses actions, commente et joint des preuves, 22 sources, un seul site et au plus un événement ou un audit liés, numéro unique jamais réattribué, notification à la création (cloche seulement) et rappel du mercredi (cloche et e-mail), vue générale filtrable et statistiques mensuelles, reprise de toutes les actions Power Apps. Spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md) (points ouverts : § 22, repris au [§ 19](#19-questions-ouvertes)). 24 éléments ajoutés (ACT-17 à ACT-40, second tableau) ; 11 éléments remplacés (↪), qui ne comptent plus dans le reste à faire ; ACT-01 ✅, ACT-02, ACT-03, ACT-12 et ACT-13 à revoir avec la refonte (note sous chaque élément).

| Réf | Élément | Priorité | Taille | Dépend de | Classe |
|---|---|:-:|:-:|---|:-:|
| ACT-01 | ✅ Rattacher les actions Prévention, Documents et Environnement par un vrai lien | **P1** | L | Script de reprise par originRef | — |
| ACT-02 | ✅ Rattacher une action existante depuis toutes les sources | P2 | M | — | — |
| ACT-03 | ✅ Tracer les changements d'action faits par les autres modules | P2 | S | — | — |
| ACT-04 | ↪ Historique de l'action : tous les champs modifiés | P2 | S | — | ↪ ACT-20 |
| ACT-05 | ↪ Motif obligatoire pour rouvrir une action clôturée | P2 | S | — | ↪ ACT-21 |
| ACT-06 | ↪ Champ Site des « Nouvelle action » ouvertes depuis les autres écrans | P3 | S | — | ↪ ACT-20 |
| ACT-07 | ↪ Sélecteur « Événement lié » : exclure les événements fermés aux actions | P3 | S | — | ↪ ACT-20 |
| ACT-08 | ↪ Origine Risques ou Revue de direction : choisir la source à la création | P3 | S | — | ↪ ACT-20 |
| ACT-09 | ↪ Report d'échéance motivé et échéance initiale conservée | P3 | M | Migration drizzle | ↪ ACT-17, ACT-21 |
| ACT-10 | ↪ Date, auteur et commentaire de réalisation | P3 | M | Migration drizzle | ↪ ACT-21, ACT-24, ACT-25 |
| ACT-11 | ↪ Fiabiliser saveAction (pilote, dates, longueurs) | P3 | S | — | ↪ ACT-20 |
| ACT-12 | Action issue d'une coactivité sans plan : origine non cliquable | P3 | S | — | C1 |
| ACT-13 | ✅ Jugement « Efficacité insuffisante » et indépendance du vérificateur | P3 | S | ACT-23 | — |
| ACT-14 | ↪ Vérifications d'efficacité hors des échéances du pilote salarié | P3 | S | — | ↪ ACT-23, ACT-28 |
| ACT-15 | ↪ Filtre de statut et lien profond « en retard » | P3 | S | — | ↪ ACT-27 |
| ACT-16 | ↪ Indicateurs de performance du plan d'actions | P3 | M | Date de réalisation ; échéance initiale | ↪ ACT-29 |

Refonte des actions QSE (ajoutés le 15/10/2026 ; spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md)) :

| Réf | Élément | Priorité | Taille | Dépend de | Classe |
|---|---|:-:|:-:|---|:-:|
| ACT-17 | ✅ Modèle de données des actions QSE (schéma et migration) | **P1** | M | — | — |
| ACT-18 | ✅ Listes et règles du domaine Actions | **P1** | S | — | — |
| ACT-19 | ✅ Reprise des actions existantes de Vigie | **P1** | M | ACT-17, ACT-18 | — |
| ACT-20 | ✅ Formulaire « Créer une action » aligné sur Power Apps | **P1** | M | ACT-17, ACT-18 | — |
| ACT-21 | ✅ Avancement et droits : QHSE et responsable | **P1** | M | ACT-17, ACT-18 | — |
| ACT-22 | ✅ Encadrement hors QHSE et transitions faites par les autres écrans | **P1** | S | ACT-21 | — |
| ACT-23 | ✅ Vérification d'efficacité et actions de suite | **P1** | M | ACT-20, ACT-21 | — |
| ACT-24 | ✅ Fil de commentaires daté et signé | **P1** | M | ACT-17, ACT-21 | — |
| ACT-25 | ✅ Preuves jointes par le responsable | **P1** | S | ACT-21, ACT-24 | — |
| ACT-26 | ✅ Pointage et coûts | **P1** | S | ACT-20, ACT-23 | — |
| ACT-27 | ✅ Vue générale et filtres | **P1** | M | ACT-18, ACT-21 | — |
| ACT-28 | ✅ Adapter les écrans qui créent ou lisent des actions | **P1** | L | ACT-18, ACT-20, ACT-21 | — |
| ACT-30 | ✅ Notification « Action confiée » dans la cloche | **P1** | M | ACT-17 | — |
| ACT-32 | ✅ Rappel du mercredi dans Vigie | **P1** | S | ACT-18, ACT-27 | — |
| ACT-33 | ✅ Rappel du mercredi par e-mail : contenu, planification, journal d'envoi | **P1** | M | ACT-32, PRD-12 | — |
| ACT-34 | Compte d'envoi des e-mails | **P1** | S | ACT-33 | C4 |
| ACT-35 | ✅ Numérotation unique, jamais réattribuée | **P1** | S | ACT-17 | — |
| ACT-36 | Format des numéros AC-AA#### | **P1** | S | ACT-35 | C3 |
| ACT-37 | ✅ Source des actions créées par Habilitations, Prévention, Environnement et audits fournisseurs | **P1** | S | ACT-18 | — |
| ACT-39 | Import de l'extraction Power Apps | **P1** | L | ACT-17, ACT-18, ACT-20, ACT-24, ACT-26, ACT-35, ACT-36, ACT-37 | C3 |
| ACT-40 | ✅ Tests de bout en bout et de migration de la refonte | **P1** | M | ACT-19, ACT-21, ACT-23, ACT-24, ACT-25, ACT-30, ACT-32, ACT-33 | — |
| ACT-29 | ✅ Statistiques mensuelles | P2 | M | ACT-21, ACT-23, ACT-27 | — |
| ACT-31 | ✅ Avertir le QHSE des commentaires et preuves du responsable | P2 | S | ACT-24, ACT-25, ACT-30 | — |
| ACT-38 | ✅ Priorité proposée d'après le niveau de risque — sans objet | P2 | S | ACT-20 | — |
| ACT-41 | Actions des projets Keystone remontées dans le plan d'actions | P2 | M | API Keystone (INT-02) | C4 |
| ACT-42 | Rattacher une action à un équipement, un sous-équipement, un client ou un fournisseur | P3 | M | Référentiels à identifier (Keystone, Codex ?) | C3 |

- **ACT-01** — Ces écrans retrouvent leurs actions par originRef : modifier la référence, la date ou la filière d'un enlèvement détache l'action sans trace. Ajouter des types plan, permit, document, waste, stream au registre action-links et migrer. (preuve : src/lib/data/prevention.ts:372,383,453,516 ; src/server/prevention.ts:321,386 ; src/lib/data/environment.ts:142-145,238-239,314 ; src/lib/data/documents.ts:157 ; src/lib/action-links.ts:52-311 (type `plan` = programme d'audit, lignes 132-153) ; src/components/actions/ActionDetail.tsx:64-67 (originRef modifiable))
  **À revoir avec ACT-17 et ACT-22 (15/10/2026)** — les colonnes de source restent les éléments liés ; `origin` est remplacé par `source` (22 valeurs) ; `reprise-liens` et `src/lib/origin-links.ts` sont adaptés aux sources ; la réserve « référence texte rattachée sans `canEdit` » tombe si la création reste réservée au QHSE (ACT-22).
  ✅ **Livré (12/10/2026)** — colonnes `actions.prevention_plan_id`, `permit_id`, `document_id`, `waste_stream_id`, `waste_entry_id` (migration 0004), posées à la création (lien explicite de l'écran ou référence résolue, `src/lib/origin-links.ts`) et journalisées sur l'action et sur la source ; origine verrouillée ensuite ; les écrans Prévention, Documents et Environnement lisent ces colonnes ; reprise idempotente des références textuelles : `npm run db:reprise-liens [-- --appliquer]` (`vigie-db reprise-liens` dans l'image ; à lancer après le déploiement de 0004, `docs/EXPLOITATION.md` § 6), d'office sur une base de démonstration ; une filière qui porte une action (annulée comprise) n'est plus supprimable. Réserves : une référence saisie en texte et résolue n'est pas soumise au droit de modifier l'écran source (`canEdit`), contrairement au lien explicite — un rôle en consultation peut ainsi rattacher l'action et écrire dans l'historique de la source ; la reprise examine aussi les actions créées après 0004 dont la référence était alors sans fiche, et ne journalise que sur l'action ; la création depuis une filière n'écrit rien dans l'historique de la filière (`logAs` absent).
  *Question : Colonnes dédiées ou table action_links ? Origine verrouillée ?*
- **ACT-02** — Événement, habilitation, document, plan et permis n'ont pas LinkActionButton ; la fiche action ne permet pas d'ajouter ou détacher une source. (preuve : Utilisations de LinkActionButton limitées à src/components/watch/\*, review/ReviewPanel.tsx, audits/\*, risks/RiskSheet.tsx ; src/components/prevention/PlanDialogs.tsx:419-430 (liste sans « Rattacher ») ; src/components/actions/ActionDetail.tsx:137-153 (sources affichées, sans ajout ni détachement) ; src/lib/action-links.ts:230-263 (type qualification sans bouton))
  **À revoir avec ACT-20 (15/10/2026)** — un seul événement ou audit lié par action, source non modifiable après création ; le maintien des rattachements complémentaires (risque, exigence, contrôle, recyclage) est à confirmer par le service QHSE (point 10 de la spécification, § 19) : selon la réponse, l'élément est développé tel quel ou abandonné.
  **Décidé (15/10/2026)** — un seul événement ou audit lié, posé à la création (jamais rattaché ni détaché ensuite, livré par ACT-20) ; les rattachements complémentaires (risque, exigence, contrôle, document, revue, décision) sont **gardés**, réservés au QHSE (`LinkActionButton`, `linkAction` / `unlinkAction`) ; habilitations, plans de prévention et permis n'en reçoivent plus (pas d'action QSE). Reste : « Rattacher » / « Détacher » un lien complémentaire depuis la fiche de l'action (la fiche n'a pas la valeur du lien). Passe en classe C1. Rattacher une action à un équipement, un client ou un fournisseur : **ACT-42**.
  ✅ **Livré (17/10/2026, paquet 2)** — fiche action : « Rattacher un élément » (type, puis élément : risque du DUERP, exigence, contrôle, version de document en révision, revue, décision de revue ; éléments du site de l'action ou communs, encore ouverts aux actions, sans ceux déjà liés ni une autre revue) et « Détacher » (confirmation en ligne) sur chaque lien complémentaire (`COMPLEMENTARY_LINK_KINDS`, `src/lib/action-rules.ts`) ; QHSE seulement, sur le site de l'action, action non close pour rattacher, non abandonnée pour détacher (mêmes règles que `linkAction` / `unlinkAction`) ; le lien « kind:args » n'est envoyé qu'au QHSE (`PlanSource.link`), les éléments proposés sont calculés à l'ouverture de la fiche (`linkTargets`). Journal de l'action et de la source inchangé.
- **ACT-03** — Le recyclage passe l'action en « verify » par UPDATE direct (date passée reprise) et la cascade de site d'un événement n'écrit rien : passer par applyActionStatus et logChange. (preuve : src/server/skills.ts:155-159 ; src/server/events.ts:306-310)
  **À revoir avec ACT-21 et ACT-22 (15/10/2026)** — le recyclage enregistré ne fait plus passer l'action « verify » par écriture directe (`src/server/skills.ts:152`) : règle tranchée par ACT-22, passage par le cycle de vie d'ACT-21 et `logChange` ; la trace de la cascade de site d'un événement se fait dès maintenant.
  ◐ **Partiel (15/10/2026)** — l'enregistrement d'une formation ne touche plus aucune action (pas d'action QSE pour un recyclage, réponse du service QHSE) : la moitié « recyclage » est sans objet. Reste : la cascade du site d'un événement vers ses actions n'écrit rien dans le journal des actions (`src/server/events.ts`).
  ✅ **Livré (17/10/2026, paquet 2)** — historique de l'action tenu, dans la transaction de l'écriture, quand un autre module la modifie : changement de site d'un événement (« Site modifié avec l'événement EV-… », détail Site), nouvelles réserves d'un contrôle et annulation d'un enregistrement qui rétablit d'autres réserves (« Détachée de … », motif de l'annulation), inscription et retrait au programme de prévention (PAPRIPACT, création du programme comprise). Réserve : à l'enregistrement d'un contrôle, l'entrée est écrite après le stockage du rapport, comme celle du contrôle.
- **ACT-04** — diffFields ignore verifyDueOn, kind et description. (preuve : src/server/plan.ts:116-121)
  ↪ **Remplacé par ACT-20 (15/10/2026)** — journal de tous les champs du nouveau formulaire (`diffFields`), y compris ceux qu'ignore aujourd'hui `saveAction` (vérification planifiée, description).
  Livré avec ACT-20 le 15/10/2026.
- **ACT-05** — « Rouvrir » ne demande aucun motif. (preuve : src/components/actions/ActionDetail.tsx:267-270 ; src/server/plan-ui.ts:75-78 ; src/server/plan-core.ts:38-45)
  ↪ **Remplacé par ACT-21 (15/10/2026)** — réouverture d'une action Vérifiée réservée au QHSE, motif obligatoire ; retours entre paliers (20 à 80 %) sans motif, comme l'a demandé le service QHSE ; un constat « non efficace » ne rouvre pas l'action : il crée une action de suite (ACT-23).
  Livré avec ACT-21 le 15/10/2026.
- **ACT-06** — Seul /actions filtre les sites ; ailleurs l'utilisateur choisit un site que saveAction refuse. (preuve : src/server/plan.ts:72-81 ; src/components/ActionFormDialog.tsx:91-95 ; src/app/(app)/actions/page.tsx:63 (filtre seulement ici) ; options.sites complet passé par evenements/page.tsx:81, audits/page.tsx:28, veille/page.tsx:25, environnement/page.tsx:40, risques/page.tsx:140)
  ↪ **Remplacé par ACT-20 (15/10/2026)** — site unique obligatoire, pris dans les sites du périmètre (`writableSites()`), plus de « Tous les sites » pour une action (réponse du service QHSE) ; lève aussi la réserve de SEC-02.
  Livré avec ACT-20 le 15/10/2026.
- **ACT-07** — La liste inclut l'étape « Efficacité vérifiée », refusée au rattachement. (preuve : src/lib/data/options.ts:37-39 ; src/components/events/shared.ts:6,42-46)
  ↪ **Remplacé par ACT-20 (15/10/2026)** — repris tel quel : le sélecteur d'événement de la source n'offre que les événements encore ouverts aux actions (`addActionBlocker`).
  Livré avec ACT-20 le 15/10/2026.
- **ACT-08** — Seules les origines événement ont un sélecteur ; une action « Risques » ou « Revue » n'est rattachée à aucun risque ni revue. (preuve : src/components/ActionFormDialog.tsx:41,63-78 ; src/lib/domain.ts:96 (EVENT_ORIGINS = ev, client))
  ↪ **Remplacé par ACT-20 (15/10/2026)** — l'élément lié se choisit selon la source (risque, revue, décision, constat, exigence, contrôle, document ; correspondance des 22 sources au § 12 de la spécification) ; sources sans équivalent (Habilitations, Prévention, Environnement, audits fournisseurs) : ACT-37.
  Livré avec ACT-20 le 15/10/2026.
- **ACT-09** — dueOn est écrasé librement, ce qui efface le retard. Ajouter un report avec motif, initial_due_on et le nombre de reports. (preuve : src/server/plan.ts:40,99,117,120 (échéance tracée seulement dans change_log) ; src/db/schema.ts:131-153 (pas d'initial_due_on ni de compteur de reports))
  ↪ **Remplacé par ACT-17 et ACT-21 (15/10/2026)** — « Reportée » est un avancement à part, posé par le QHSE sans motif obligatoire ; la date cible n'est modifiée que par le QHSE et la date cible initiale est conservée (`initial_due_on`, base du respect des dates cibles d'ACT-29) ; la question « motif obligatoire, report réservé aux approbateurs ? » est tranchée.
  *Question : Motif obligatoire et report réservé aux approbateurs ?*
  Livré avec ACT-17 et ACT-21 le 15/10/2026.
- **ACT-10** — « Déclarer réalisée » ne stocke que la date de vérification prévue. (preuve : src/server/plan-core.ts:33-36 ; src/components/actions/ActionDetail.tsx:72-87 ; src/db/schema.ts:131-153 (ni done_on, ni done_by_id, ni done_note))
  ↪ **Remplacé par ACT-21, ACT-24 et ACT-25 (15/10/2026)** — date effective saisie au passage « Terminée » (auteur au journal), fil de commentaires, preuves facultatives ; la question « preuve obligatoire ? » est tranchée : non.
  *Question : Preuve obligatoire ?*
  Livré avec ACT-21, ACT-24 et ACT-25 le 15/10/2026.
- **ACT-11** — Pilote non vérifié (erreur de clé étrangère, salarié sorti), date impossible acceptée, description sans maximum, vérification avant échéance. (preuve : src/server/plan.ts:37-42,99 ; src/lib/forms.ts:10,51-55)
  ↪ **Remplacé par ACT-20 (15/10/2026)** — repris dans la réécriture de `saveAction` : responsable pris dans le personnel actif (`withCurrent`), dates contrôlées (date impossible refusée, vérification postérieure à la date cible), longueurs bornées.
  Livré avec ACT-20 le 15/10/2026.
- **ACT-12** — L'origine « Coactivité JJ/MM/AAAA » n'a pas de lien vers /prevention/carte. (preuve : src/components/sitemap/SiteMapScreen.tsx:232 ; src/lib/data/actions.ts:179-183,208-209 (repli vers /prevention) ; src/app/(app)/prevention/carte/page.tsx:27 (paramètre date))
  **À revoir avec ACT-37 (15/10/2026)** — le lien vers `/prevention/carte?date=…&site=…` se corrige dès maintenant ; seule la source portée par une action de coactivité dépend d'ACT-37.
  **Mise à jour (15/10/2026)** — Prévention ne crée plus d'action QSE (réponse du service QHSE) : reste seulement le lien vers `/prevention/carte` des actions de coactivité reprises (source à compléter).
- **ACT-13** — Les non-valideurs peuvent juger l'efficacité ; l'animateur peut vérifier sa propre action. (preuve : src/components/actions/ActionDetail.tsx:259-261 ; src/server/plan-ui.ts:25-29,55 ; src/server/plan-core.ts:28-31 ; src/lib/domain.ts:293-294)
  **À revoir avec ACT-23 (15/10/2026)** — jugement d'efficacité réservé au QHSE (tranché par le service QHSE, appliqué par ACT-21 et ACT-23) ; reste l'indépendance du vérificateur (point 13 de la spécification) : proposition non bloquante d'ACT-23, autorisé et signalé sur la fiche.
  ✅ **Livré (15/10/2026, paquet 1)** — jugement d'efficacité réservé au QHSE (`verifyAction`, `requireApprover`) ; un animateur QHSE peut vérifier une action dont il est responsable, sans restriction ni marque (réponse du service QHSE du 15/10/2026).
- **ACT-14** — Le pilote salarié reçoit une alerte urgente sur une vérification qu'il ne peut pas faire. (preuve : src/lib/data/actions.ts:302-307 ; src/lib/data/todo.ts (filtre isMine du Salarié dans loadVisibleTodo))
  ↪ **Remplacé par ACT-23 et ACT-28 (15/10/2026)** — les échéances de vérification vont au responsable QHSE du site seulement (`loadQhseLeads`), jamais au responsable de l'action.
  Livré avec ACT-23 et ACT-28 le 15/10/2026.
- **ACT-15** — Ajouter ?statut=, renvoyer vers l'historique quand le plan est vide, afficher la date de clôture en vue Liste. (preuve : src/app/(app)/actions/page.tsx:25-26,69-83,181-189,244 ; src/lib/data/dashboard.ts:68 (lien sans filtre retard))
  ↪ **Remplacé par ACT-27 (15/10/2026)** — filtre d'avancement (dont « En retard »), lien profond `?retard=1`, renvoi vers l'historique, date de clôture en vue Liste ; ni vues enregistrées ni export (décision du service QHSE).
  Livré avec ACT-27 le 15/10/2026.
- **ACT-16** — Taux à l'échéance, délai moyen, efficacité au premier contrôle, répartition par origine (ISO 9001 §9.3.2). (preuve : src/lib/data/dashboard.ts:68 (seul KPI action : retards) ; src/lib/data/review.ts:454-470 (répartition par origine déjà présente))
  ↪ **Remplacé par ACT-29 (15/10/2026)** — statistiques mensuelles demandées par le service QHSE (avancement, source, domaine, responsable, niveau de risque, taux de retard, délai moyen de clôture, taux d'efficacité, ouvertes et clôturées, respect des dates cibles).

**Refonte des actions QSE — ACT-17 à ACT-40** (ajoutés le 15/10/2026) :

- **ACT-17** — Une seule migration drizzle (0005) pour toute la refonte (docs/specs/actions-qse.md § 4 et § 20) : colonnes opened_on (date d'ouverture), priority, domain, problem, detail (remplace title et description), source (remplace origin, 22 valeurs), initial_due_on, done_on (date effective), verify_method, effective (efficace / non efficace), new_risk, risk_level (0 à 4), hours, estimated_cost, actual_cost (€ TTC), follows_action_id et follow_reason ; status aux dix valeurs d'avancement ; closed_on = date de vérification ; kind supprimé après reprise ; site obligatoire à toute création (null gardé pour les lignes reprises « à compléter »). Tables action_comments (fil, retrait motivé), action_counters (numérotation sous verrou), notifications (notifications d'information par personne), journal d'envoi des e-mails (personne, semaine, statut). Libellé d'affichage actionLabel() (première ligne du détail, 90 caractères) à la place de l'intitulé. Instantané drizzle, drizzle/checksums.json (db:check -- --enregistrer), jeu de démonstration réécrit. Preuve : src/db/schema.ts:211-243 (title, description, origin, status todo/doing/verify/done/cancelled, kind ; ni date d'ouverture, priorité, domaine, problème, nature et date de vérification, niveau de risque, pointage ni coûts). (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  ✅ **Livré (15/10/2026, paquet 1)** — migration unique `drizzle/0005_actions_qse.sql` (une instruction par morceau, contraintes CHECK des 10 avancements, des 24 sources, des priorités, domaines, natures, niveaux 0–4 et motifs de suite), tables `action_comments`, `action_counters`, `notifications` (avec `comment_id`), `action_reminder_sends`, `attachments.comment_id`, colonne `actions.legacy_origin` (ancienne origine gardée pour `reprise-liens` et le complément d'ACT-37, à supprimer ensuite), instantané et `drizzle/checksums.json` ; `db:check` gagne l'étape 5b (forme de la base migrée identique à l'instantané : types, défauts, contraintes, index, `src/db/shape.ts`). Jeu de démonstration réécrit (`src/db/seeds/actions.ts`). Réserve : `legacy_origin` à retirer par une migration ultérieure.
- **ACT-18** — Constantes dans src/lib/domain.ts (spec § 5, § 6, § 12) : avancement (10 valeurs ; groupes ouverte, en attente, réalisée, close ; libellés Power Apps pour l'import), priorités, domaines, niveaux de risque 0 à 4, natures de vérification, 22 sources avec leur cible Vigie (événement, audit, risque, exigence, contrôle, revue, document, environnement ou libre). Règles pures testées : transitions permises ; actionLate() (en retard si À faire, Budgétée ou initiée ou 20 à 80 % et date cible passée ; jamais Reportée, Terminée, Vérifiée ni Abandonnée) ; vérification en retard ; groupes du Kanban ; rapprochement des libellés sans accents, casse ni espaces. Remplace ACTION_COLUMNS, ACTION_STATUSES, PLAN_SCOPES, ORIGINS, EVENT_ORIGINS (src/lib/domain.ts:95-137) et actionColumn (src/lib/queries.ts:62). (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  ✅ **Livré (15/10/2026, paquet 1)** — `src/lib/action-keys.ts` (clés sans import), `src/lib/domain.ts` (`AVANCEMENT` et groupes, `ACTION_SOURCES` : 24 sources avec cible, chemin et précision AST-EST / Réserves, `SOURCE_LINK_KINDS`), règles pures `src/lib/action-rules.ts` (retards, Kanban, transitions, à compléter, dates, droits, source imposée `admissibleSources`, liens des suites `followUpLinkMode`, filtres d'URL) et types `src/lib/action-view.ts`, testés (`action-rules.test.ts`, `domain.test.ts`).
- **ACT-19** — Dans la migration d'ACT-17, SQL déterministe sans valeur inventée (spec § 18) : todo → À faire ; doing → Budgétée ou initiée ; verify → Terminée (date effective tirée du journal « Déclarée réalisée ») ; done → Vérifiée (Efficace, constat et date de vérification repris) ; cancelled → Abandonnée (motif conservé) ; title + description → détail ; origin → source (ev, client, risk, docs ; audit selon la ligne du programme ; watch selon contrôle ou exigence ; rev selon décision « objectif »). Origines env, skills, prevention, description du problème, domaine, priorité et site null laissés vides et marqués « à compléter » (filtre de la vue générale, échéance du QHSE, champ exigé à la modification suivante). kind supprimé et gardé dans une entrée de journal « Reprise du modèle Power Apps » par action. Bases concernées : démonstration, application Mac, essais (aucune base de production). Test : test/integration/migration-0005.test.ts sur une base 0004 peuplée (et demo-upgrade.test.ts pour la mise à niveau du jeu de démonstration). Complété par ACT-37 pour les sources des origines env, skills, prevention. (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  *Classe C1 — aucun blocage (proposition « En cours » → « Budgétée ou initiée » confirmable sans retard : bases de démonstration et d'essai seulement).*
  ✅ **Livré (15/10/2026, paquet 1)** — reprise SQL déterministe dans 0005 (test : `test/integration/migration-0005.test.ts`, PGlite et PostgreSQL ; `db:test-migrate` sur une sauvegarde 0004 réelle) : avancements, détail, sources (Revues de direction → Revue de direction ; annulée sans l'élément qui décide → source non déterminée), journal « Reprise du modèle Power Apps », compteur. Révisée par les réponses du 15/10/2026 : `env` → Déchets, audit « Fournisseurs » → Audit fournisseur, `skills` et `prevention` → source à compléter (le QHSE les abandonne avec un motif). Réserves : bases de démonstration mises à niveau différentes d'une base neuve (écarts listés par `migration-0005`) ; journal de reprise daté de l'heure réelle.
- **ACT-20** — Réécrire ActionFields et NewActionButton (src/components/ActionFormDialog.tsx) et saveAction (src/server/plan.ts:37) dans l'ordre et avec les champs du formulaire Power Apps (spec § 4) : date d'ouverture affichée (date du jour, non modifiable) ; responsable (personnel actif, withCurrent) ; avancement À faire à la création ; priorité ; date cible ; source et élément lié choisi selon la source (événements ouverts aux actions seulement, ACT-07 ; constats et éléments du programme ; risques ; exigences ; contrôles ; revues et décisions ; documents) ou référence d'origine ; domaine proposé par la source ; description du problème ; détail de l'action ; vérification planifiée obligatoire dès la création ; niveau de risque ; coûts ; site unique obligatoire (plus de « Tous les sites », sites de writableSites()). Contrôles serveur (ACT-11) : dates cohérentes, longueurs, responsable actif ; source et élément lié verrouillés après création ; un seul événement ou audit lié ; aide de saisie sans donnée de santé (actions issues d'un AT). Journal de tous les champs modifiés (diffFields, ACT-04). ActionDefaults (detail, problem, source, domain) pour les écrans qui créent des actions. (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  ✅ **Livré (15/10/2026, paquet 1)** — formulaire dans l'ordre Power Apps (`src/components/ActionFormDialog.tsx`), `saveAction` réécrit (`src/server/plan.ts`, `src/server/action-create.ts`) : source imposée par l'élément lié (`admissibleSources`), un seul événement ou audit posé à la création, site unique obligatoire, dates et longueurs contrôlées sur les seules valeurs modifiées (reprise tolérée), responsable actif, journal de tous les champs. Réserves : l'aide « accident du travail » reste une aide de saisie (aucun contrôle serveur du texte) ; la source d'une action reprise vide se complète parmi les sources admises par ses éléments événement/audit, sinon les 24.
- **ACT-21** — Cycle de vie du spec § 6 : paliers libres À faire ↔ Budgétée ou initiée ↔ 20 à 80 % (retour en arrière admis) ; Reportée sans motif obligatoire, depuis et vers toute valeur ouverte ; Terminée (date effective obligatoire) et retour depuis Terminée ; Abandonnée (motif obligatoire, detachAllLinks, définitif) ; réouverture d'une action Vérifiée avec motif (ACT-05) ; refus d'un changement devenu caduc (avancement affiché envoyé). Toutes les transitions et modifications réservées au QHSE (animateur QHSE et direction : requireApprover puis requireInSite). Le responsable consulte ses actions sur tous les sites, commente et joint des preuves, sans transition : fin de « Démarrer » et « Déclarer réalisée » pour le pilote salarié (PILOT_MOVES, src/server/plan-ui.ts:20 ; décision du § 20 « Rôle Salarié » modifiée le 15/10/2026). Fiche action : boutons du nouveau cycle (src/components/actions/ActionDetail.tsx), lecture seule pour les autres rôles. Règle de création isolée (canCreateAction) pour accueillir la réponse d'ACT-22 ; journal structuré des changements d'avancement (base des statistiques). (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  *Classe C1 — aucun blocage (Direction comptée dans le QHSE comme pour toutes les validations de Vigie : confirmation non bloquante).*
  ✅ **Livré (15/10/2026, paquet 1)** — cycle de vie (`moveAction`, `reopenAction` motivé, `abandonAction` motivé et définitif) réservé au QHSE (`requireApprover` + `requireInSite`), journal structuré `status` (`fromKey`/`toKey`) ; le responsable consulte ses actions sur tous les sites, commente et joint des preuves, sans transition ; refus d'un avancement devenu caduc. Une action Vérifiée ne change de nature, de constat, de résultat ni de date de vérification que par « Rouvrir » puis une nouvelle vérification.
- **ACT-22** — Trancher puis appliquer les droits de l'encadrement qui n'est pas responsable de l'action : création depuis un écran source (aujourd'hui requireManager ; un chef de service pilote d'un événement crée ses actions, et l'étape « Actions » exige une action liée, src/components/events/shared.ts:49) ; consultation du plan de son périmètre (ROLES, readOnly 'actions') ; sort des transitions automatiques des autres écrans (recyclage enregistré : passage direct à « verify », src/server/skills.ts:152, alors que « Terminée » est réservé au QHSE). Proposition : création permise à qui peut modifier l'écran source (formulaire complet, gestion ensuite par le QHSE) ; plan du périmètre en lecture seule ; recyclage : commentaire automatique « Formation enregistrée le … » et échéance du QHSE. Les écrans sources concernés pourront évoluer avec leurs formulaires Power Apps. (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  ✅ **Livré (15/10/2026, paquet 1)** — décidé par le service QHSE le 15/10/2026 : « les actions QSE sont créées uniquement par le service QHSE » ; création, modification, transitions et liens complémentaires réservés au QHSE (`canCreateAction(role)`), l'encadrement lit le plan de son périmètre en lecture seule (À faire, tableau de bord, cloche et badges ne lui montrent plus les échéances des actions dont il n'est pas responsable), aucune transition automatique depuis un autre écran (les recyclages ne créent plus d'action). Les actions créées par un chef de service ou de projet dans un projet Keystone : **ACT-41** ; « événement modifié et suivi par le QHSE » : **EVT-29**.
- **ACT-23** — Fenêtre « Vérifier l'efficacité » (QHSE, action Terminée, spec § 7) : date de vérification = date de clôture, nature (audit/visite, écrit, réunion, visuelle, autre), constat obligatoire, résultat Efficace / Non efficace, case « Nouveau risque généré » avec la description du risque, pointage proposé. Non efficace : l'action passe Vérifiée et une nouvelle action pré-remplie (source, élément lié, domaine, priorité, niveau de risque, site, responsable ; problème « Action … jugée non efficace le … : constat ») et liée (follows_action_id, follow_reason) est enregistrée dans la même transaction ; nouveau risque : même mécanisme ; deux suites si les deux. Suite rattachée à l'élément lié quand il accepte encore une action, sinon référence et lien vers l'action précédente. Échéances de vérification (15 jours, dépassée) adressées au responsable QHSE du site seulement (ACT-14). Remplace « Clôturer — efficacité vérifiée » et « Efficacité insuffisante » (src/server/plan-ui.ts:43, src/server/plan-core.ts:23). (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  *Classe C1 — aucun blocage (indépendance du vérificateur et suite sur un événement clos : propositions par défaut, non bloquantes).*
  ✅ **Livré (15/10/2026, paquet 1)** — fenêtre « Vérifier l'efficacité » (nature, constat, résultat, nouveau risque, pointage) ; Non efficace et/ou Nouveau risque : action(s) de suite enregistrées dans la même transaction (`follows_action_id`, `follow_reason`), liens repris selon `followUpLinkMode` (élément de la source repris, éléments à action unique déplacés vers la première suite, journalisés sur les deux actions et la source) ; événement clos : référence gardée et échéance « Événement clos — action de suite ouverte » au responsable QHSE du site ; échéances de vérification au responsable QHSE du site. Autovérification admise sans marque (réponse du service QHSE).
- **ACT-24** — Table action_comments (ACT-17) ; fil chronologique sur la fiche (date et heure de Paris, auteur et rôle, texte, pièces jointes au commentaire) ; ajout par le responsable et le QHSE (requireInSite, contrôle « responsable ou QHSE ») à tout avancement ; pas de modification ; retrait par l'auteur ou le QHSE avec motif (ReasonButton), texte masqué, jamais supprimé ; logChange à l'ajout et au retrait ; fil et historique chargés à l'ouverture de la fiche et non pour toute la liste (QUA-11 ; src/lib/data/actions.ts:149 charge les journaux de toutes les actions) ; Salarié : commentaires de ses actions seulement (charge RSC) ; aide de saisie sans donnée de santé. Aujourd'hui : aucun commentaire, seul le journal des modifications (src/db/schema.ts:821). (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  ✅ **Livré (15/10/2026, paquet 1)** — fil `action_comments` daté (heure de Paris), signé (auteur et rôle), pièces jointes au commentaire (`attachments.comment_id`), retrait motivé par l'auteur ou le QHSE (texte gardé en base, jamais envoyé au navigateur ; preuves du commentaire retiré visibles du QHSE seulement) ; fil et historique chargés à l'ouverture de la fiche ; Salarié : ses actions seulement (test e2e). Réserve : le nom d'une preuve d'un commentaire retiré reste dans l'historique du QHSE.
- **ACT-25** — Adapter addActionFiles et removeActionFile (src/server/plan.ts:178 et 206 ; aujourd'hui tout l'encadrement ou le pilote) : ajout par le responsable et le QHSE, seules ou avec un commentaire (pièces du commentaire rattachées à lui) ; jamais sur une action Abandonnée ; retrait d'une pièce ajoutée par erreur par son auteur ou le QHSE tant que l'action n'est pas Vérifiée ; journalisé ; preuve jamais exigée (question d'ACT-10 tranchée par le formulaire Power Apps) ; affichage dans le bloc Preuves et dans le fil ; /fichiers (canReadAttachment) ouvert au responsable et aux rôles qui voient l'action. (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  ✅ **Livré (15/10/2026, paquet 1)** — `addActionFiles` / `removeActionFile` : responsable (tous sites) ou QHSE (site), jamais sur une Abandonnée ; retrait par son auteur responsable ou le QHSE tant que l'action n'est pas Vérifiée, ligne et journal dans la même transaction (fichier effacé après validation) ; `/fichiers` ouvert au responsable. Réserve : fichier orphelin si la transaction d'ajout échoue (PRD-13).
- **ACT-26** — Pointage (heures, une valeur, saisie par le QHSE à la clôture dans la fenêtre de vérification, corrigeable ensuite par le QHSE), coût estimé et coût réel (€ TTC, sans le temps, saisis par le QHSE à tout moment) ; bloc « Pointage et coûts » de la fiche ; totaux des actions affichées dans la vue Liste ; journal ; la ligne du PAPRIPACT propose le coût estimé de l'action (DUE-02, coût de ligne figé avec le programme). Aujourd'hui : coût seulement sur les lignes du programme annuel (src/db/schema.ts:328-334). (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  ✅ **Livré (15/10/2026, paquet 1)** — pointage (vérification, corrigeable ensuite), coûts estimé et réel (€ TTC), bloc « Pointage et coûts », totaux de la vue Liste, journal ; PAPRIPACT : coût estimé de l'action proposé à l'ajout d'une ligne (TTC du plan, HT du programme : à confirmer, DUE-02).
- **ACT-27** — Vue Liste par défaut (N°, Date, Responsable, Avancement avec retard, Priorité, Date cible, Source, Domaine, libellé, Site ; tri : retards puis date cible) ; Kanban regroupé en six colonnes (À faire, En cours, En retard, Reportée, Terminée — à vérifier, Vérifiée 30 j) ; vue Par responsable ; filtres portés par l'URL et communs aux vues : avancement (dont « Ouvertes » et « En retard »), responsable (dont « Mes actions »), source, priorité, texte libre (numéro, problème, détail, référence d'origine, motif d'abandon) ; affichage plan en cours, historique, Abandonnées ; filtre « À compléter » des actions reprises ou importées ; liens profonds ?avancement=, ?retard=1, ?responsable=, ?mes=1, ?source=, ?priorite=, ?q= (EVT-26, TDB-12, ACT-15). Pas de vues enregistrées ni d'export (décision du service QHSE). Aujourd'hui : filtres origine, pilote, texte (src/lib/data/actions.ts:273) et Kanban à cinq colonnes (src/components/actions/KanbanBoard.tsx:21). (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  ✅ **Livré (15/10/2026, paquet 1)** — vue Liste par défaut, Kanban en six colonnes, Par responsable, Abandonnées ; filtres d'URL communs (avancement dont Ouvertes / En retard, responsable dont « Mes actions », source, priorité, texte, « À compléter ») et liens profonds `?retard=1`, `?mes=1`, `?action=` ; anciens paramètres (`etat=annulees`, `vue=pilote`, `pilote=`) acceptés.
- **ACT-28** — Passer au nouveau modèle tous les écrans hors /actions (spec § 20). Création : EventActions, RiskSheet, FindingsCard, ProgramTimeline, ReviewPanel (siteId null aujourd'hui), RequirementsPanel, ControlsPanel, SkillMatrix, SkillAlerts, skills/common.tsx, PlanDialogs, PermitDialogs, SiteMapScreen, DocumentPanel, environment/parts.tsx : source, domaine proposé, problème pré-rempli, site unique, sans kind ni title. Lecture : blocages des étapes d'un événement (src/components/events/shared.ts:10-57 : Vérifiée ou Abandonnée = close), src/lib/data/risks.ts:126 et 219-268, review.ts:626-741 (répartition par source ; dossiers figés lus tels quels), dashboard.ts:113-133, documents.ts, environment.ts:398-414, skills.ts, audits.ts, prevention.ts, sitemap.ts, watch.ts, options.ts:47, action-links.ts (isClosedActionStatus, slotTaken), origin-links.ts et reprise-liens ; libellé actionLabel() à la place de l'intitulé ; échéances de loadActionSignals selon le spec § 15.3. Les écrans concernés pourront évoluer avec leurs formulaires Power Apps. (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  *Classe C1 — aucun blocage (les écrans Habilitations, Prévention, Environnement et audits fournisseurs gardent une source au choix du QHSE jusqu'à ACT-37 ; droits de création de l'encadrement par la règle isolée d'ACT-21, ajustée à la réponse d'ACT-22).*
  ✅ **Livré (15/10/2026, paquet 1)** — écrans au nouveau modèle : Événements (source Évènement QSE ou Réclamation client imposée, étape « Efficacité vérifiée » quand les actions liées sont Vérifiées ou Abandonnées), DUERP et PAPRIPACT, Audits (source selon la ligne du programme ; « Fournisseurs » → Audit fournisseur), Revue (Objectif QSE pour une décision « objectif » ; dossier par source, dossiers figés lus tels quels), Veille et contrôles, Documents (Revue documentaire), Environnement (Déchets ; action BSD : Déchets ou Veille), tableau de bord ; boutons de création pour le QHSE seulement (sinon « Les actions QSE sont créées par le service QHSE. ») ; **Habilitations et Prévention ne créent plus d'action** (réponses du 15/10/2026 : recyclages gérés par le RH, actions immédiates des plans de prévention), actions reprises en consultation ; écrans communs (audits, revue, veille) : action d'un site hors périmètre réduite à son numéro. Réserve : un plan de prévention se clôt désormais après un écart R. 4512-6 sans action QSE (**PRV-21**).
- **ACT-29** — Onglet « Statistiques » de /actions (?vue=statistiques, sans nouvelle route), calculé dans src/lib/queries.ts, jamais stocké, sur le site sélectionné ou le périmètre, pour un mois avec les 12 mois précédents : répartition par avancement, source, domaine, responsable et niveau de risque ; taux de retard ; délai moyen de clôture (date de vérification − date d'ouverture) ; taux d'efficacité (Efficace / Vérifiées) ; évolution mensuelle ouvertes / clôturées ; respect des dates cibles. État passé reconstitué par le journal structuré d'ACT-21 ; Abandonnées exclues des taux. Remplace ACT-16 ; la section « Plan d'actions » du dossier de revue passe aux sources. (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  **Décidé (15/10/2026)** — définitions tranchées par le service QHSE le 15/10/2026 : répartitions = état de tout le plan à la fin du mois ; respect des dates cibles mesuré à la **dernière** date cible (la date cible initiale, `initial_due_on`, reste affichée et journalisée). Journal structuré des avancements stocké depuis le paquet 1. Passe en classe C1.
  ✅ **Livré (17/10/2026, paquet 2)** — onglet « Statistiques » de `/actions` (`?vue=statistiques&mois=AAAA-MM`, QHSE et encadrement ; le Salarié revient à la liste de ses actions) : site sélectionné ou tout le périmètre ; mois choisi (24 derniers mois) ; actions ouvertes, taux de retard, délai moyen de clôture, taux d'efficacité, respect des dates cibles (dernière date cible) ; répartitions par avancement (Abandonnées comprises), source, domaine, responsable et niveau de risque (hors Abandonnées, dont ouvertes) ; évolution sur 12 mois (ouvertes, clôturées, abandonnées, en cours et taux de retard en fin de mois). Calcul pur `computeActionStats` (`src/lib/action-stats.ts`) sur `loadActionStats` (`src/lib/data/action-stats.ts`), jamais stocké ; état reconstitué par le journal structuré (entrées « status » et « reprise ») ; action reprise sans historique : avancement réputé atteint à la date de reprise, « À faire » avant. Réserves : responsable, source, domaine, niveau de risque et date cible sont les valeurs actuelles ; mois en cours arrêté à la date du jour.
- **ACT-30** — Première notification d'information de Vigie (aujourd'hui la cloche ne montre que des échéances calculées, src/lib/data/notifications.ts:24-34) : table notifications (ACT-17) ; à la création d'une action, notification à son responsable « Action … confiée par … » avec le lien vers la fiche ; aucune si le responsable est l'auteur ; jamais d'e-mail (décision du service QHSE) ; affichée dans la cloche avec les échéances, non lue jusqu'au clic ou « Tout marquer comme lu » (src/server/notifications.ts) ; réutilisable pour TDB-06. Proposition non bloquante : même notification quand le QHSE change le responsable. (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  ✅ **Livré (15/10/2026, paquet 1)** — table `notifications`, notification « Action A-n confiée par … » au responsable à la création et à la réaffectation (§ 22.15 confirmé), jamais d'e-mail ; cloche (`src/lib/data/notifications.ts`) : clé `notification:<id>`, non lue jusqu'au clic ou « Tout marquer comme lu », lien gardé seulement si la personne peut lire l'action. Réserve : la notification d'un ancien responsable reste listée, sans lien.
- **ACT-31** — Le responsable rend compte par le fil et les preuves, mais c'est le QHSE qui passe l'action « Terminée » : sans avertissement, le QHSE doit ouvrir chaque fiche. Proposition : notification d'information (ACT-30) au responsable QHSE du site de l'action pour chaque commentaire ou preuve ajouté par un responsable, regroupée par action et par jour. (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  ✅ **Livré (15/10/2026, paquet 1)** — décidé le 15/10/2026 et livré avec le paquet 1 : un commentaire ou une preuve ajouté par le responsable (hors QHSE) notifie **chaque animateur QHSE** (sauf l'auteur), une notification par commentaire et une par fichier, dans la transaction de l'écriture ; titre réécrit sans extrait au retrait du commentaire (`notifications.comment_id`) ; icône par type dans la cloche.
- **ACT-32** — Échéance calculée, sans tâche planifiée : chaque mercredi (heure de Paris, today(), VIGIE_TODAY en démonstration), un élément de la cloche pour chaque responsable ayant au moins une action en cours (À faire, Budgétée ou initiée, 20 à 80 %), tous sites : nombre d'actions, dont en retard ; clé d'état lu par semaine ISO ; visible jusqu'à sa lecture ou au mercredi suivant ; lien vers /actions?mes=1 (retards en tête et signalés) ; pas de synthèse QHSE. Proposition non bloquante : Reportées et Terminées exclues. (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  ✅ **Livré (15/10/2026, paquet 1)** — élément calculé de la cloche (jamais une échéance d'« À faire »), clé `rappel-actions|<semaine ISO>`, du mercredi jusqu'à sa lecture ou au mercredi suivant : actions ouvertes (retards d'abord) puis « Terminées — en attente de vérification » (réponse du 15/10/2026), Reportées exclues, tous sites ; lien `/actions?mes=1`.
- **ACT-33** — Le mercredi matin (heure configurable, 7 h de Paris par défaut), un e-mail par responsable ayant des actions en cours, à l'adresse de sa fiche (people.email) : objet « Vigie · vos actions QSE en cours (n, dont m en retard) », tableau (numéro, libellé, avancement, date cible, site), retards en tête et signalés, lien publicOrigin() ; personne sans adresse : notée au journal. Tâche planifiée (PRD-12, sur le modèle de src/db/maintenance.ts) ; journal d'envoi en base (un envoi par personne et par semaine, même après redémarrage ; nouvel essai en cas d'échec) ; transport abstrait, transport « fichier » en démonstration et dans les tests ; variables dans src/lib/env.ts (+ env.test.ts), .env.example et docs/EXPLOITATION.md § 4. Aujourd'hui : aucun envoi d'e-mail ni planificateur (package.json). (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  *Classe C1 — aucun blocage pour le développement (transport de test) ; l'envoi réel attend ACT-34.*
  ✅ **Livré (15/10/2026, paquet 1)** — e-mail du mercredi (`src/lib/action-reminder.ts`, `src/lib/action-reminder-job.ts`) : objet « Vigie · vos actions QSE en cours (n, dont m en retard) » (n = ouvertes + Terminées), deux tableaux, liens par `VIGIE_PUBLIC_URL` ; tâches planifiées `src/db/scheduler.ts` (PRD-12) ; journal `action_reminder_sends` (un envoi par personne et semaine, 5 essais, reprise d'un envoi bloqué après 30 min) ; transport abstrait `src/lib/mail/transport.ts` (`aucun` par défaut hors démonstration, `fichier`) ; variables `VIGIE_SCHEDULER`, `VIGIE_MAIL_TRANSPORT`, `VIGIE_MAIL_DIR`, `VIGIE_MAIL_FROM`, `VIGIE_REMINDER_TIME`. Réserves (`docs/EXPLOITATION.md` § 8) : démarrage paresseux à l'ouverture de la base, aucun rattrapage d'un mercredi passé serveur arrêté, doublon rare après une reprise ; aucun envoi réel avant ACT-34.
- **ACT-34** — Brancher le transport réel d'ACT-33 : relais SMTP de la messagerie de l'entreprise, ou Microsoft Graph sendMail (permission d'application Mail.Send limitée à une boîte d'envoi dédiée par une stratégie d'accès) ; secrets dans la configuration ; essai dans le tenant réel ; documentation d'exploitation (§ 3 et § 4 de docs/EXPLOITATION.md). (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  *Classe C4 — Compte d'envoi à fournir par l'informatique : relais SMTP (hôte, port, compte, SPF/DKIM du domaine) ou Microsoft Graph Mail.Send avec consentement de l'administrateur du tenant Entra et boîte d'envoi dédiée ; suppose l'inscription de Vigie dans le tenant (SEC-01)*
- **ACT-35** — Compteur en base (table action_counters, ACT-17) incrémenté sous verrou dans la transaction de création (aujourd'hui nextRef hors transaction, src/server/plan.ts:155 : doublon possible, PRD-08) ; contrainte d'unicité ; un numéro n'est jamais libéré (action abandonnée comprise) ; fonction de format isolée formatActionNumber() ; l'import positionne le compteur au-delà du plus grand numéro repris ; format actuel « A-n » conservé tant qu'ACT-36 n'est pas tranché ; actions existantes jamais renumérotées (liens, journal et rattachements en dépendent). (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  ✅ **Livré (15/10/2026, paquet 1)** — compteur `action_counters('A')` incrémenté dans la transaction de création, toujours au-delà du plus grand numéro vu (actions et journal), jamais réattribué ; format « A-n » (`formatActionNumber`) gardé jusqu'à ACT-36.
- **ACT-36** — Appliquer la règle de numérotation de Power Apps (AC + année sur deux chiffres + numéro, exemple AC-260150) dans formatActionNumber() et la portée du compteur (par année ou unique) ; aucun numéro AC émis par Vigie avant l'import de l'extraction (ACT-39), pour ne jamais attribuer un numéro déjà pris dans Power Apps. Hypothèse à vérifier : identifiant de l'élément de la liste SharePoint, donc compteur continu. (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  *Classe C3 — Règle actuelle de numérotation AC à fournir par le service QHSE (recherche en cours, question gardée pour plus tard par l'utilisateur) : le compteur repart-il à 0001 chaque année (AC-270001 au début de 2027) ou continue-t-il, et combien de chiffres après l'année ?*
- **ACT-37** — Les 22 sources du service QHSE n'ont pas d'équivalent pour des actions que Vigie crée aujourd'hui : recyclage planifié (origine skills), plan de prévention, permis et coactivité (prevention), filières, enlèvements et registre des déchets (env), audits fournisseurs (ligne « Fournisseurs » du programme). Décider la source imposée par ces écrans (ou les sources à ajouter à la liste) et le sens de « Réserves » (contrôle réglementaire ou réception de chantier) et d'« Analyse de risque (AST-EST) » pour leur élément lié ; compléter la reprise (ACT-19) des actions env, skills, prevention marquées « à compléter ». Proposition : Environnement → Analyse environnementale ; ajouter « Habilitations et formations » et « Prévention des entreprises extérieures », ou les rattacher à « Contrôle réglementaire » et « Analyse de risque (AST-EST) » ; audits fournisseurs → Audit interne ISO. Écrans concernés susceptibles d'évoluer avec leurs formulaires Power Apps. (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  ✅ **Livré (15/10/2026, paquet 1)** — décidé par le service QHSE le 15/10/2026 : 24 sources (les 22 + « Déchets » et « Audit fournisseur ») ; Environnement → Déchets ; ligne « Fournisseurs » du programme → Audit fournisseur ; aucune action QSE depuis Habilitations (recyclages gérés par le RH) ni depuis Prévention (actions immédiates des plans) ; « Réserves » = réserves de réception d'un chantier ou d'une installation ; AST = analyse de sécurité des tâches en contexte pyrotechnique, EST = étude de sécurité technique (précisions affichées sous la liste des sources) ; « Analyse environnementale » sans élément Vigie. Reprise : `env` → Déchets, `skills` et `prevention` → à compléter (abandon par le QHSE si besoin).
- **ACT-38** — La priorité est « en partie déduite du niveau de risque, ajustable » (service QHSE) : proposer la priorité dans le formulaire dès que le niveau de risque est saisi, sans écraser un choix du QHSE ; règle pure testée dans src/lib/domain.ts. (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  ✅ **Clos sans objet (15/10/2026)** — le service QHSE choisit librement la priorité, sans proposition : rien à développer.
- **ACT-39** — Commande npm run db:import-actions -- <fichier> [--appliquer] (vigie-db import-actions dans l'image) : essai sans écriture avec rapport (valeurs non reconnues, responsables introuvables, doublons, champs obligatoires manquants), puis application en transaction après sauvegarde, d'abord sur une copie restaurée (db:test-migrate). Colonnes et libellés rapprochés selon le spec § 19 ; numéro AC repris tel quel (clé d'idempotence), compteur positionné ; responsable par e-mail puis par nom ; site : colonne de l'extraction, sinon site du responsable, sinon « à compléter » ; événement ou audit lié par son numéro s'il existe dans Vigie, sinon référence d'origine ; commentaires et pièces jointes repris si l'extraction les porte ; journal « Importée de Power Apps » ; aucune notification. Tests sur un échantillon fourni avec l'extraction. (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  *Classe C3 — Extraction de toutes les actions Power Apps (format, colonnes dont site et responsable, historique des commentaires, pièces jointes) à fournir plus tard par le propriétaire de l'application ; règle de numérotation (ACT-36) ; décision, une fois l'extraction connue, sur les responsables absents de Vigie (créer la fiche ou refuser la ligne)*
- **ACT-40** — En plus des tests de chaque élément (droits, site, motif et journal de chaque nouvelle server action dans test/integration/) : mise à niveau d'une base 0004 peuplée (test/integration/migration-0005.test.ts, db:check) ; scénario complet création → paliers → Reportée → Terminée → Vérifiée non efficace → action de suite, sur PGlite et PostgreSQL ; rappel du mercredi avec VIGIE_TODAY ; e-mail par le transport fichier et idempotence du journal d'envoi ; cloisonnement du Salarié (commentaires, preuves, charge RSC : test/e2e/employee-payload.test.ts) ; route-access.test.ts si une page est ajoutée ; mise à jour de CLAUDE.md (avancement, sources, rôles du QHSE et du responsable, notifications d'information). (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md))
  ✅ **Livré (15/10/2026, paquet 1)** — tests de la refonte : migration d'une base 0004 peuplée (`migration-0005`, PGlite et PostgreSQL), édition d'une ligne reprise (`actions-legacy-edit`), scénario complet (`actions-scenario`), rappel du mercredi (`weekly-reminder`), e-mail et idempotence (`reminder-email`), cloisonnement du Salarié (`employee-isolation`, `test/e2e/employee-payload.test.ts` y compris la cloche), périmètre (`actions-perimeter`, `actions-plan-perimeter`), droits, site, motif et journal de chaque server action ; CLAUDE.md mis à jour.
- **ACT-41** — Réponse du service QHSE du 15/10/2026 : « un chef de service/projet peut créer une action uniquement dans un projet, qui sera remontée dans l'outil général de gestion des actions ». Recevoir de Keystone les actions créées dans un projet et les inscrire au plan d'actions (source, responsable, projet), sans droit de création dans Vigie pour l'encadrement (ACT-22). (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md) § 22)
  *Classe C4 — API Keystone (projets, actions de projet) : INT-02.*
- **ACT-42** — Souhait du service QHSE du 15/10/2026 : lier une action à un équipement, un sous-équipement, un client ou un fournisseur, en plus de son élément source et des liens complémentaires. Aucun référentiel d'équipements ni de clients et fournisseurs n'existe dans Vigie (champ texte « Équipement » des événements seulement). (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md) § 22)
  *Classe C3 — Référentiels à identifier : équipements et sous-équipements (Codex ?), clients et fournisseurs (Keystone ?), et leurs identifiants.*

## 6. Prévention et carte du site (PRV)

21 éléments — P1 : 3 · P2 : 9 · P3 : 9 — charge indicative 22,5–66 j.

Au 18/10/2026 : 6 livrés (✅ PRV-01, PRV-02, PRV-03, PRV-07, PRV-11, PRV-12) — reste 15 éléments ouverts (C1 : 4 · C2 : 8 · C3 : 2 · C4 : 1 ; PA : 15), charge indicative 18–54 j.

| Réf | Élément | Priorité | Taille | Dépend de | Classe |
|---|---|:-:|:-:|---|:-:|
| PRV-01 | ✅ Écarts R. 4512-6 passés non comptés | **P1** | M | — | — |
| PRV-02 | ✅ Contenu réglementaire du plan incomplet (R. 4512-8 et R. 4512-9) | **P1** | M | Migration drizzle | — |
| PRV-03 | ✅ Fiche imprimable d'un permis et registre par période | **P1** | S | — | — |
| PRV-04 | Traçabilité de la délivrance, de la check-list et de la clôture des permis | P2 | M | Migration drizzle | C2 · PA |
| PRV-05 | Protocoles de sécurité de chargement et déchargement | P2 | M | — | C2 · PA |
| PRV-06 | Inspection commune « préalable » acceptée après le début des travaux | P2 | S | — | C2 · PA |
| PRV-07 | ✅ Signataires du plan et date de signature EU | P2 | S | Migration drizzle | — |
| PRV-08 | Intervenants des permis reliés au personnel et aux habilitations | P2 | M | Niveaux d'habilitation ; Cursus | C3 · PA |
| PRV-09 | Dossier entreprise extérieure : pièces de vigilance, intervenants, accueil | P2 | L | Migration drizzle | C2 · PA |
| PRV-10 | Situations de coactivité : état « maîtrisée » | P2 | M | — | C1 · PA |
| PRV-11 | ✅ Cohérence plan, permis et activités après modification | P2 | S | — | — |
| PRV-12 | ✅ Carte du site : journal, annulation plutôt que suppression, sites archivés | P2 | M | — | — |
| PRV-13 | Cumul des heures d'une entreprise extérieure sur 12 mois | P3 | S | — | C2 · PA |
| PRV-14 | Filtres projet et entreprise, accès direct à la fiche entreprise | P3 | S | — | C1 · PA |
| PRV-15 | Permis complémentaires : consignation, espace confiné, hauteur, fouille | P3 | M | — | C3 · PA |
| PRV-16 | Validité des permis : durée maximale et prolongation | P3 | S | — | C2 · PA |
| PRV-17 | Interventions longues : inspections et réunions périodiques | P3 | M | — | C1 · PA |
| PRV-18 | Signature à distance ou envoi du plan à l'entreprise extérieure | P3 | L | Messagerie ou signature électronique | C4 · PA |
| PRV-19 | Échéances de coactivité sans personne concernée | P3 | S | — | C1 · PA |
| PRV-20 | Plans de prévention reçus des clients | P3 | L | Keystone | C2 · PA |
| PRV-21 | Clôture d'un plan après un écart R. 4512-6 : mesures immédiates hors actions QSE | P3 | S | Validation du service QHSE | C2 · PA |

- **PRV-01** — Seules les interventions en cours sans plan signé comptent ; une intervention terminée sans signature ou signée après démarrage ne laisse pas d'écart. (preuve : src/components/prevention/model.ts:104-107 (isInProgress, lacksSignedPlan), 120-121 (planEndIssue) ; src/lib/data/prevention.ts:265, 609-614, 660-668, 697-699 ; src/server/prevention.ts:270-272 et 284-302 (signature acceptée après startOn))
  ✅ **Livré (12/10/2026)** — écart R. 4512-6 = plan obligatoire signé (première signature complète, `first_signed_on`) après le début de l'intervention, ou intervention sans plan signé, sur 12 mois glissants ; compté dans les indicateurs (KPI « Écarts R. 4512-6 sur 12 mois », veille) et non dans le badge ; clôture ou annulation d'un plan signé en retard subordonnée à une action qui trace l'écart ; déplacer le début d'une intervention commencée exige un motif. Réserve : l'obligation est jugée sur les heures estimées actuelles ; un plan devenu obligatoire en cours de travaux (400 h atteintes, R. 4512-7 1°) puis signé est compté à tort comme signé après le début.
  *Question : Écart passé dans le badge ou seulement dans les indicateurs ?*
- **PRV-02** — Manquent effectif EE, sous-traitants, secours et évacuation, instructions, phases dangereuses, matériels prêtés. (preuve : src/db/schema.ts:443-468 ; src/components/prevention/PlanDialogs.tsx:101-155 ; src/app/(app)/prevention/imprimer/plan/[id]/page.tsx:75-137 (formData non imprimé, alors que la fiche l'affiche en PlanDialogs.tsx:210-228))
  ✅ **Livré (12/10/2026)** — contenu réglementaire en champs structurés (effectif et encadrant de l'entreprise extérieure, sous-traitance, cinq rubriques R. 4512-8, postes R. 4512-9) ; signature d'un plan obligatoire refusée tant qu'une des six rubriques requises est vide ; impression complétée (§ 5 et 6, annexe du formulaire importé). Réserve : libellés R. 4512-9 et R. 4511-10 à faire valider par le responsable QHSE ; les plans de production existants devront être complétés avant signature.
  *Question : Champs structurés ou sections libres du modèle importé ?*
- **PRV-03** — Un permis délivré ne s'imprime pas pour affichage ; le registre ne filtre pas par mois ou année. (preuve : src/components/prevention/PermitDialogs.tsx:331-342 (aucun lien d'impression) ; src/app/(app)/prevention/imprimer/permis/page.tsx:21-25 (filtres état et type seulement))
  ✅ **Livré (12/10/2026)** — fiche imprimable d'un permis (`/prevention/imprimer/permis/[id]`) ; registre filtré par année et mois (un permis compte dans chaque mois que couvre sa validité), « Tous, annulés compris », date de délivrance. Réserve : la date de délivrance est tirée du journal (« Permis délivré ») en attendant une colonne (**PRV-04**).
- **PRV-04** — Ni date-heure de délivrance, ni acceptation, ni fin réelle, ni auteur de clôture ou de ronde ; check-list sans historique ; clôture possible avant la fin de surveillance. (preuve : src/server/prevention.ts:559-572 (setPermitCheck sans logChange), 642-656 (closePermit sans contrôle de watchUntil) ; src/db/schema.ts:483-501 (aucun champ acceptation ou ronde) ; déjà tracé : src/server/prevention.ts:600-603, 651-654 et src/components/prevention/PermitDialogs.tsx:409)
  *Question : Interdire la clôture avant la fin des 2 h de surveillance ?*
- **PRV-05** — Protocole écrit exigé pour les transporteurs (R. 4515-4 à 11), signé des deux parties, avec révision. (preuve : aucune occurrence de « protocole » ni de « R. 4515 » dans src/ ni dans design/Vigie.dc.html)
  *Question : Transporteurs gérés comme entreprises extérieures ?*
- **PRV-06** — Seule la fin de l'intervention borne la date de l'inspection commune préalable. (preuve : src/server/prevention.ts:158)
  *Question : Refus strict ou écart tracé ?*
- **PRV-07** — Signature EU forcée au jour, sans nom ni qualité des signataires ; l'impression affiche le responsable du plan. (preuve : src/server/prevention.ts:259-276, 279-310 ; src/app/(app)/prevention/imprimer/plan/[id]/page.tsx:137-140)
  ✅ **Livré (18/10/2026, paquet 5)** — « Signer pour l'entreprise utilisatrice » ouvre un formulaire : date de signature (jamais future, jamais avant l'inspection commune), nom et qualité du signataire ; signature EE : nom et qualité obligatoires ; signataires journalisés, effacés avec les signatures par une modification, imprimés sur le plan (`signed_eu_name` / `signed_eu_quality`, `signed_ee_name` / `signed_ee_quality`).
- **PRV-08** — performer est un texte libre : choisir les intervenants internes et contrôler leurs titres valides à la délivrance. (preuve : src/db/schema.ts:490 ; src/components/prevention/PermitDialogs.tsx:166-168 ; src/server/prevention.ts:470 ; src/components/prevention/model.ts:152)
  *Question : Quels titres par type de permis ?*
- **PRV-09** — Ajouter assurance, attestation URSSAF (D. 8222-5), Kbis avec échéances, intervenants avec accueil sécurité, signaux d'expiration. (preuve : src/db/schema.ts:430-441 ; src/components/prevention/ContractorDialogs.tsx:62-68)
  *Question : Vigilance suivie par les achats ?*
- **PRV-10** — Une situation reste signalée après action ou report au plan, et des actions en double sont possibles. (preuve : src/lib/data/sitemap.ts:292-334 ; src/components/sitemap/SiteMapScreen.tsx:225-239 (originRef sans clé de situation), 637-638 ; src/server/sitemap.ts:392)
  **À revoir avec ACT-37 (15/10/2026)** — la source portée par l'action de coactivité suit la réponse d'ACT-37 ; la clé de situation et l'état « maîtrisée » n'en dépendent pas.
- **PRV-11** — savePlan ne contrôle pas les activités liées ; saveActivity accepte un permis clos ou hors période. (preuve : src/server/prevention.ts:181-197 ; src/server/sitemap.ts:256-259)
  ✅ **Livré (17/10/2026, paquet 4)** — un plan modifié garde sur son site, son entreprise et sa période les activités de la carte rattachées (non annulées), comme ses permis actifs ; un permis demandé modifié garde son site et son entreprise, et sa validité recoupe chaque activité rattachée ; une activité ne se rattache plus à un permis clos ou annulé (un rattachement existant reste admis) ni à un permis valable aucun de ses jours (`activityLinkIssues`, `permitActivityBlocker`, `src/components/prevention/model.ts`). Refus par champ, sans écriture.
- **PRV-12** — 11 mutations sur 12 sans logChange, activités supprimées physiquement, création acceptée sur un site archivé (pas de requireInSite). (preuve : src/server/sitemap.ts:67-75, 80-368 (aucun logChange hors 399), 110-123, 291-300 ; src/lib/guard.ts:32-37 (requireInSite non utilisé))
  ✅ **Livré (17/10/2026, paquet 3)** — toutes les écritures de la carte journalisées dans leur transaction : activités sur leur fiche (`site_activity` : création, modification avec le détail — entreprise, responsable, zone et voies par leur nom —, déplacement, annulation), zones, voies, plan de fond et échelle dans l'historique de la carte (`site_map`, identifiant du site) ; une activité ne se supprime plus : « Annuler l'activité » avec motif (`cancelActivity`, colonnes `cancelled_*`, migration `0006`), retirée de la carte, de la coactivité et des rattachements qui bloquent l'annulation d'un plan ; `requireInSite` après chargement partout (création sur un site actif du périmètre : plus de création sur un site archivé). Historiques à l'ouverture : fiche de l'activité, fenêtre « Échelle » (historique de la carte). Réserve : zones et voies (dessin du plan) restent supprimables, la suppression est journalisée sur la carte (et sur les activités concernées) ; le QR code d'une zone supprimée n'ouvre plus le signalement.
- **PRV-13** — Le seuil de 400 h est évalué plan par plan. (preuve : src/components/prevention/model.ts:71 ; src/components/prevention/PlanDialogs.tsx:113-114 (saisie manuelle « Total estimé »))
  *Question : Par opération ou cumul ?*
- **PRV-14** — Plans filtrés par phase seulement ; nom d'entreprise non cliquable. (preuve : src/app/(app)/prevention/page.tsx:61-64 ; src/components/prevention/PlanDialogs.tsx:337 ; src/components/prevention/PermitDialogs.tsx:372)
- **PRV-15** — Seuls permis de feu et d'essai existent. (preuve : src/components/prevention/model.ts:137-169)
  *Question : Permis prévus par PR-QHSE-005 ?*
- **PRV-16** — Aucune durée maximale ; un permis délivré ne se prolonge pas. (preuve : src/server/prevention.ts:481-493, 505)
- **PRV-17** — Un contrat annuel n'a qu'une inspection préalable. (preuve : src/db/schema.ts:455)
- **PRV-18** — La signature EE est saisie en interne. (preuve : src/server/prevention.ts:279-310 ; design/Vigie.dc.html:778)
  **À revoir avec ACT-34 (15/10/2026)** — le compte d'envoi des e-mails attendu pour le rappel du mercredi sert aussi à l'envoi du plan à l'entreprise extérieure.
- **PRV-19** — Les échéances de coactivité n'ont ni who ni ownerIds. (preuve : src/lib/data/sitemap.ts:321-330 ; src/lib/domain.ts:334)
- **PRV-20** — Les interventions EPC2i chez les clients ne sont pas suivies. (preuve : src/db/schema.ts:443-447)
  *Question : À suivre dans Vigie ?*
- **PRV-21** — Depuis le paquet 1 (réponse du service QHSE du 15/10/2026 : « les plans de prévention donnent lieu à des actions immédiates non enregistrées dans les actions QSE »), un plan de prévention se clôt ou s'annule après un écart R. 4512-6 sans action QSE (`planEndIssue`, `src/components/prevention/model.ts`) ; l'écart reste tracé par le plan et ses indicateurs. Faut-il demander à la clôture un motif « mesures immédiates prises » ? (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md) § 22)
  *Classe C2 — Question au service QHSE : trace des mesures immédiates à la clôture d'un plan après un écart ?*

## 7. Risques / DUERP (DUE)

20 éléments — P1 : 2 · P2 : 9 · P3 : 9 — charge indicative 19–54 j.

Au 18/10/2026 : 7 livrés (✅ DUE-01, DUE-02, DUE-03, DUE-04, DUE-05, DUE-06, DUE-11) — reste 13 éléments ouverts (C1 : 10 · C2 : 2 · C4 : 1 ; PA : 13), charge indicative 12–34 j.

| Réf | Élément | Priorité | Taille | Dépend de | Classe |
|---|---|:-:|:-:|---|:-:|
| DUE-01 | ✅ Mise à disposition du DUERP aux salariés, anciens salariés et instances | **P1** | M | — | — |
| DUE-02 | ✅ PAPRIPACT : programme annuel de prévention | **P1** | L | Suivi des consultations CSE | — |
| DUE-03 | ✅ Transmission de chaque version au SPST et dépôt sur le portail | P2 | S | Migration drizzle | — |
| DUE-04 | ✅ Annulation d'une action : détachement absent de l'historique du risque | P2 | S | — | — |
| DUE-05 | ✅ Unités sur un site archivé déplacées en silence | P2 | S | — | — |
| DUE-06 | ✅ Historique des unités en vigueur et des versions jamais affiché | P2 | S | — | — |
| DUE-07 | Réévaluation après accident et mise à jour du DUERP déclenchée | P2 | M | — | C2 · PA |
| DUE-08 | Facteurs de pénibilité et effectifs exposés | P2 | M | Effectifs (Cursus) | C4 · PA |
| DUE-09 | Pièces jointes : DUERP signé par version et justificatifs des risques | P2 | M | — | C1 · PA |
| DUE-10 | Contenu d'une version figé à la validation | P2 | M | — | C2 · PA |
| DUE-11 | ✅ Vue imprimable du document unique | P2 | M | — | — |
| DUE-12 | Rattachement non tracé entre deux risques au même danger | P3 | S | — | C1 · PA |
| DUE-13 | Unités homonymes indiscernables sous « Tous les sites » | P3 | S | — | C1 · PA |
| DUE-14 | Déplacement d'un risque : rang et site des actions | P3 | S | ACT-20 (site unique) | C1 · PA |
| DUE-15 | Validateur sorti de l'effectif | P3 | S | — | C1 · PA |
| DUE-16 | Matrice G × P accessible et filtrante | P3 | S | — | C1 · PA |
| DUE-17 | Vue d'ensemble du DUERP toutes unités | P3 | M | — | C1 · PA |
| DUE-18 | Suggestions de familles de dangers | P3 | S | — | C1 · PA |
| DUE-19 | Mesures liées aux contrôles, documents et habilitations | P3 | L | — | C1 · PA |
| DUE-20 | Unités de travail reliées aux zones du plan de site | P3 | M | — | C1 · PA |

- **DUE-01** — Salarié et Chef de projet n'ont aucun accès (R. 4121-4). Consultation en lecture et vue imprimable de la version en vigueur, trace des mises à disposition. (preuve : src/lib/domain.ts:268-269 ; src/app/(app)/risques/page.tsx:21 ; src/app/(app)/risques/export/route.ts:26-27 ; src/db/seed.ts:187 (exigence « mise à disposition des salariés et du CSE » marquée conforme))
  ✅ **Livré (12/10/2026)** — tout le DUERP en lecture pour tous les rôles (version en vigueur et versions archivées, dans le périmètre de la personne), sans les archives, les actions à rattacher, l'historique ni la liste du personnel pour les rôles en consultation ; impression `/risques/imprimer` (`?version=n`) ; registre des demandes d'accès (anciens salariés, CSE, médecin du travail, inspection, CARSAT : date, demandeur, version communiquée, canal), réservé aux validateurs, avec une échéance pour une demande en attente.
  *Question : Tout le DUERP ou l'unité du salarié ?*
- **DUE-02** — Construire le programme (L. 4121-3-1) à partir des actions rattachées aux risques, avec coût, ressources, indicateur, figé par année avec la consultation CSE. (preuve : src/db/schema.ts:131-153 (actions : ni coût, ni ressources, ni indicateur) ; src/db/schema.ts:200-203 (risk_actions) ; src/db/schema.ts:157-168 (duerp_versions sans programme rattaché))
  **À revoir avec ACT-26 (15/10/2026)** — coût estimé et coût réel portés par toutes les actions ; la ligne du PAPRIPACT propose le coût estimé de l'action et reste figée avec le programme ; la question « coût sur toutes les actions ? » est tranchée par le formulaire Power Apps.
  ✅ **Livré (12/10/2026)** — programme annuel par année (`prevention_programs`, `prevention_program_actions` : coût estimé, ressources, indicateur sur les lignes du programme seulement), prérempli depuis le DUERP, figé avec un instantané à la consultation du CSE, rouvert avec motif ; panneau `ProgramPanel`, impression `/risques/imprimer/programme?annee=`, échéances « consultation du CSE à saisir » et « programme à établir ». Réserve : un programme peut être figé sans coût ni indicateur sur ses lignes (champs optionnels, décision du lot 2), sans avertissement rappelant les mentions de L. 4121-3-1 (conditions d'exécution, indicateurs, coût, calendrier) ; l'impression ne signale que les lignes sans coût.
  *Question : Champs coût et ressources sur toutes les actions ?*
- **DUE-03** — Ajouter date de transmission SPST, échéance associée, et emplacement pour le futur dépôt numérique. (preuve : src/db/schema.ts:157-168 ; src/lib/data/risks.ts:498-500 ; src/components/risks/VersionDialogs.tsx:200-215 (formulaire de version sans transmission SPST))
  ✅ **Livré (18/10/2026, paquet 5)** — version du DUERP : « Transmise au SPST le » et « Déposée sur le portail numérique le » (dates jamais futures ni antérieures à la mise à jour, journalisées) ; échéance « Transmission au SPST à renseigner » tant que la version en vigueur ne l'a pas (comme la consultation du CSE) ; colonnes de la liste des versions, bandeau de l'écran. Le dépôt sur le portail n'est qu'une date (portail non ouvert).
- **DUE-04** — detachAllLinks n'appelle pas logAs ; l'état « Annulée » de la fiche n'est jamais atteint. (preuve : src/server/plan-ui.ts:116-124 ; src/lib/action-links.ts:92-94,346-354 ; src/components/risks/RiskSheet.tsx:172-176 (affichage « Annulée » inatteignable))
  **À revoir avec ACT-21 (15/10/2026)** — l'annulation devient l'avancement « Abandonnée » (motif obligatoire) ; la trace du détachement dans l'historique du risque se fait dès maintenant ; l'affichage d'une action abandonnée sur la fiche attend la réponse (§ 19).
  ✅ **Livré (15/10/2026, paquet 1)** — l'abandon d'une action (motif obligatoire) la détache et l'écrit dans l'historique du risque (« Action A-n abandonnée : détachée ») ; la fiche du risque ne la montre plus parmi ses actions ouvertes.
- **DUE-05** — Le Select omet le site archivé et enregistre le premier actif ; la restauration accepte un site archivé. (preuve : src/components/risks/UnitDialogs.tsx:38,48-49,105 ; src/lib/data/options.ts:34 ; src/server/risks.ts:257-258,335 ; src/server/sites.ts:80-90)
  ✅ **Livré (17/10/2026, paquet 4)** — l'éditeur d'unité garde le site archivé d'une unité comme choix (`withCurrent`, « (archivé) ») : modifier son libellé ne la déplace plus vers le premier site actif ; restaurer une unité d'un site archivé est refusé (« restaurez le site d'abord »).
- **DUE-06** — Ajouter ChangeLogList dans l'éditeur d'unité et « Versions du DUERP ». (preuve : src/lib/data/risks.ts:319-322 ; src/components/risks/UnitDialogs.tsx:81-130 ; src/components/risks/VersionDialogs.tsx (aucun ChangeLogList) ; src/server/risks.ts:432-435,468-475 (journalisé mais jamais affiché))
  ✅ **Livré (17/10/2026, paquet 3)** — historique de l'unité dans l'éditeur d'unité et de chaque version dans « Versions archivées », chargés à l'ouverture (`LazyChangeLog` « work_unit », « duerp_version »), à la saisie seulement (`canEdit` DUERP, comme l'historique des risques ; refusé au Salarié).
- **DUE-07** — Aucun signal quand un AT/PA est rattaché à un risque ou révèle un risque nouveau (R. 4121-2), ni trace « réévalué suite à EV-… ». (preuve : src/lib/data/risks.ts:241-247,482-520 ; src/app/(app)/evenements/page.tsx:306 ; src/server/risks.ts:114-118)
  *Question : Seuil de gravité imposant une nouvelle version ?*
- **DUE-08** — Ajouter effectif par unité et exposition par facteur au-delà des seuils (R. 4121-1-1). (preuve : src/db/schema.ts:170-198)
- **DUE-09** — Types 'duerp_version' et 'risk' absents des pièces jointes et de /fichiers. (preuve : src/lib/uploads.ts:75-111 ; src/db/schema.ts:58-59 ; src/components/risks/VersionDialogs.tsx:102-116)
- **DUE-10** — L'instantané est pris à la création de N+1 et ne garde que les identifiants d'actions. (preuve : src/server/risks.ts:420-425 ; src/lib/data/risks.ts:35,392,398-402)
  *Question : État au jour de la validation ou de l'archivage ?*
- **DUE-11** — Le DUERP ne sort qu'en CSV : page de garde, unités, cotations, plan d'actions, y compris versions archivées. (preuve : src/components/risks/ExportMenu.tsx:19-22 ; src/app/(app)/prevention/imprimer/print.css (modèle existant))
  ✅ **Livré (constaté le 15/10/2026)** — avec DUE-01 au lot 2 : `/risques/imprimer` (et `?version=n` pour une version archivée) imprime la mise à disposition, la méthode de cotation, les unités, les cotations brutes et résiduelles et les actions de prévention avec leur échéance et leur statut (références seulement pour une version archivée). Points éventuels de recette : page de garde distincte, récapitulatif du plan d'actions.
- **DUE-12** — linkAction compare les libellés « Unité · Danger » et non l'identifiant du risque. (preuve : src/server/links.ts:36,48-54,70-76 ; src/lib/action-links.ts:103)
- **DUE-13** — Sous « Tous les sites », deux unités homonymes sont indiscernables : afficher le site sous le libellé. (preuve : src/app/(app)/risques/page.tsx:110-113,166 ; src/server/risks.ts:261)
- **DUE-14** — saveRisk garde le rang et ne revérifie pas le site des actions liées. (preuve : src/server/risks.ts:92-108,126,172-179 ; src/server/links.ts:43)
  **À revoir avec ACT-20 (15/10/2026)** — avec le site unique des actions, déplacer un risque vers un autre site refuse les actions liées d'un autre site, ou demande leur détachement (même contrôle que `linkAction`).
- **DUE-15** — Le formulaire impose de réécrire le validateur historique. (preuve : src/components/risks/VersionDialogs.tsx:206-208 ; src/lib/data/options.ts:33 ; src/server/risks.ts:383 ; modèle : src/components/ActionFormDialog.tsx:50-52)
- **DUE-16** — Grille de div sans libellé ; lignes sans rôle. (preuve : src/app/(app)/risques/page.tsx:44-53,153-157 ; src/components/risks/RiskTable.tsx:22-28,61)
- **DUE-17** — Vue toutes unités : matrice globale, risques prioritaires, résiduels ≥ 8. (preuve : src/app/(app)/risques/page.tsx:37-62)
- **DUE-18** — Datalist inspirée INRS pour homogénéiser les libellés. (preuve : src/components/risks/RiskForm.tsx:65-67,80-82)
- **DUE-19** — Alerter quand une mesure de maîtrise liée n'est plus valide. (preuve : src/db/schema.ts:188 ; src/components/risks/RiskForm.tsx:80-82)
- **DUE-20** — Rattacher une zone à l'unité et proposer ses risques au signalement par QR. (preuve : src/db/schema.ts:170-178,589-596 ; src/app/signaler/page.tsx:11-17)

## 8. Habilitations et formations (HAB)

21 éléments — P1 : 1 · P2 : 10 · P3 : 10 — charge indicative 23–68 j.

Au 18/10/2026 : 4 livrés (✅ HAB-01, HAB-03, HAB-04, HAB-11) · 1 partiel (◐ HAB-10) — reste 17 éléments ouverts (C1 : 10 · C2 : 4 · C4 : 3 ; PA : 14), charge indicative 20–60 j.

| Réf | Élément | Priorité | Taille | Dépend de | Classe |
|---|---|:-:|:-:|---|:-:|
| HAB-01 | ✅ Contrôle des fichiers côté navigateur dans « Enregistrer une formation » | **P1** | S | — | — |
| HAB-02 | Suivi de l'état de santé au travail : VIP, SIR, aptitude, reprise | P2 | L | Cursus | C2 · PA |
| HAB-03 | ✅ Journal des habilitations : compléter et afficher | P2 | M | — | — |
| HAB-04 | ✅ Les anciens recyclages perdent leur lien vers l'habilitation | P2 | M | — | — |
| HAB-05 | Sortie d'un salarié : responsabilités ouvertes et échéances postérieures | P2 | M | — | C2 · PA |
| HAB-06 | Session de formation collective et recyclage groupé | P2 | L | ACT-20 | C1 · PA |
| HAB-07 | Exigences par poste ou par activité | P2 | L | Arbitrage (hors périmètre précédemment) | C2 · PA |
| HAB-08 | Date d'entrée, contrat et formation sécurité à l'embauche | P2 | M | Cursus | C4 · PA |
| HAB-21 | Habilitations et formations en consultation seule pour le service QHSE (données du RH) | P2 | M | Cursus (INT-03) ; formulaire Power Apps | C4 · PA |
| HAB-09 | Prévision des recyclages à 12 mois et plan de formation | P2 | M | — | C1 · PA |
| HAB-10 | ◐ Niveaux, catégories CACES et prérequis entre titres | P2 | M | HAB-02 (aptitude médicale) | C1 · PA |
| HAB-11 | ✅ Vue Salarié : lien mort vers l'action de recyclage | P3 | S | — | — |
| HAB-12 | Droits sur les titres suivis communs à tous les sites | P3 | S | — | C1 |
| HAB-13 | Efficacité des formations et sensibilisation (ISO §7.2-7.3) | P3 | M | — | C1 · PA |
| HAB-14 | Vue Salarié : habilitations filtrées par le site | P3 | S | — | C1 |
| HAB-15 | Réordonnancement des titres suivis | P3 | S | — | C1 · PA |
| HAB-16 | Matrice : filtre par titre, site visible, colonne figée | P3 | S | — | C1 · PA |
| HAB-17 | Lien profond : filtres mémorisés écrasés et messages imprécis | P3 | S | — | C1 |
| HAB-18 | Indicateurs de compétences dans la revue | P3 | S | — | C1 · PA |
| HAB-19 | Vue Salarié : titres archivés et dépôt de son attestation | P3 | M | — | C2 · PA |
| HAB-20 | Jeunes travailleurs : dérogation aux travaux réglementés | P3 | M | Cursus | C4 · PA |

- **HAB-01** — Au-delà de 11 Mo la server action plante ; réutiliser checkPickedFiles. (preuve : src/components/skills/TrainingForm.tsx:115-117 (Input sans contrôle, consigne « 10 Mo par fichier ») ; src/components/watch/parts.tsx:15-24 (checkPickedFiles, FILES_HINT) ; next.config.ts:6 (bodySizeLimit 11mb) ; src/server/skills.ts:52-56,112 (checkFiles jamais atteint au-delà de la limite) ; src/components/form.tsx:32-38 (useActionState sans repli))
  ✅ **Livré (12/10/2026)** — taille et nombre des fichiers contrôlés dans le navigateur (`pickedFilesError`, mêmes limites que le serveur) pour « Enregistrer une formation » et les formulaires de documents.
- **HAB-02** — Dates des visites sans contenu médical (R. 4624-10 à 31) avec échéances. (preuve : src/db/schema.ts:24-39 (people : name, job, siteId, service, leftOn, aucune donnée de suivi de santé) ; aucune occurrence de visite ou aptitude dans src/ ; CLAUDE.md « Cursus, propriétaire des données personnelles des employés »)
  *Question : Tenu dans Cursus ou dans Vigie ?*
- **HAB-03** — setRequirement et les attestations ne sont pas tracés ; l'historique écrit n'est affiché nulle part ; qualification sans logAs. (preuve : src/server/skills.ts:195-231 (attestations sans logChange), 237-265 (setRequirement sans logChange), 293-296 (« Fiche salarié modifiée » sans details) ; src/lib/action-links.ts:230-263 (qualification sans logAs, à comparer aux lignes 99, 123, 147) ; src/components/skills/SkillMatrix.tsx:188 (HistoryTable seul, aucun ChangeLogList))
  ✅ **Livré (17/10/2026, paquet 3)** — journalisés dans leur transaction : exigence « requis pour ce salarié » posée ou retirée (`qualification_requirement`, « personne|titre », y compris quand une formation la pose), attestation jointe ou retirée (sur la formation ; retrait : ligne supprimée et journal dans la même transaction, fichier effacé ensuite), fiche salarié modifiée avec le détail des champs (`diffFields`) ; liens repris d'une action de recyclage tracés sur la case (`logAs`). Historiques à l'ouverture, à la saisie seulement : case de la matrice (« Historique des modifications » : formations, attestations, exigence) et fiche salarié.
- **HAB-04** — Le seul champ renewalActionId est écrasé ou supprimé. (preuve : src/db/schema.ts:297-301 (un seul renewalActionId) ; src/lib/action-links.ts:232-261 (attach écrase, detach/detachAll remettent à null, sources lit le seul champ courant) ; src/server/skills.ts:261 (delete de l'exigence) ; src/lib/data/skills.ts:128-129 (actions clôturées ignorées))
  ✅ **Livré (17/10/2026, paquet 4)** — l'habilitation d'une action de recyclage reprise est portée par l'action (`actions.qualification_person_id` / `qualification_title_id`, migration `0007_qualification_renewals` : reprise de `qualification_requirements.renewal_action_id`, colonne supprimée) ; jamais détachée (abandon compris, `keptOnCancel`) ni effacée quand le titre n'est plus requis ; la case de la matrice montre le recyclage ouvert et les « Actions de recyclage précédentes » (closes, la plus récente d'abord). Aucun nouveau lien (aucune action QSE pour un recyclage, 15/10/2026).
- **HAB-05** — Seuls les recyclages ouverts sont vérifiés ; réintégration possible sur site archivé. (preuve : src/server/skills.ts:332-333 (seul openRenewals est vérifié), 343-358 (reinstatePerson sans contrôle de site actif) ; src/lib/guard.ts:32-37 ; src/lib/data/skills.ts:165-170 (leavingOn conservé, aucune borne de date), 259-285 (signaux sans comparaison à leftOn) ; src/lib/data/options.ts:33 (seules les listes de choix excluent les sortis))
  **À revoir avec ACT-20 (15/10/2026)** — le responsable d'une action reste obligatoire et pris dans le personnel actif : la sortie d'un salarié doit traiter ses actions ouvertes.
  *Question : Bloquer ou réaffecter en masse ?*
- **HAB-06** — Saisie multi-salariés et action partagée (A-205). (preuve : src/components/skills/TrainingForm.tsx:92-100 (un seul personId et titleId) ; src/components/skills/SkillMatrix.tsx:190-205 (Planifier crée une action par case, pas de LinkActionButton) ; src/db/seed.ts:89 (A-205 collective) ; src/lib/action-links.ts:232-245)
  **À revoir avec ACT-20 (15/10/2026)** — l'action de recyclage créée automatiquement porte les nouveaux champs obligatoires (priorité, source, domaine, description du problème, vérification planifiée) : à développer après la refonte.
- **HAB-07** — Exigences case par case et alerte d'affectation sur tous les titres requis. (preuve : src/server/skills.ts:237-265 (exigence par case), 268-310 (savePerson sans exigences par défaut) ; src/lib/data/skills.ts:198-206 (lapses sur toutes les cases requises) ; src/components/skills/rules.ts:24-30 ; src/db/schema.ts:321-328 (activity en texte libre))
- **HAB-08** — Ajouter date d'entrée, type de contrat, poste à risques ; générer l'accueil sécurité (L. 4141-2) et la formation renforcée CDD/intérim (L. 4154-2). (preuve : src/db/schema.ts:24-39 (pas de date d'entrée ni de contrat) ; src/db/seed.ts:28 (« Monteur · arrivé le 28/09 » dans job), 233 (titre accueil), 290 (constat intérimaires) ; src/server/skills.ts:300-309 (création sans exigence))
- **HAB-09** — Vue « À prévoir » par mois et titre. (preuve : src/lib/domain.ts:152 (SKILL_SOON_DAYS = 60), 312 (TODO_HORIZON_DAYS = 15) ; src/components/skills/rules.ts:50-56 (renewalDue limité au besoin immédiat) ; src/lib/queries.ts:70-76)
- **HAB-10** — Autorisation de conduite conditionnée au CACES et à l'aptitude (R. 4323-56). (preuve : src/db/schema.ts:286-301 (pas de niveau, catégorie ni prérequis) ; src/db/seed.ts:233-234 (elec, r484, r489, conduite indépendants) ; src/lib/queries.ts:70-76 (état calculé sans dépendance))
  ◐ **Partiel (18/10/2026, paquet 5)** — livré : titres prérequis d'un titre (au moins un en cours de validité, ex. autorisation de conduite : CACES R484 ou R489, R. 4323-56 ; ni soi-même, ni archivé, ni circulaire), état calculé « Prérequis non valide » de la matrice et échéance ; catégories ou niveaux obtenus saisis avec la formation d'un titre qui en porte (« Catégories CACES », « Indices d'habilitation »), journalisés. Reste : aptitude médicale à la conduite, selon la réponse de HAB-02 (donnée de santé, avis du DPO) — rien n'est stocké d'ici là.
- **HAB-11** — L'action est pilotée par la QHSE, invisible au Salarié. (preuve : src/components/skills/common.tsx:16,41 (pilote = QHSE_LEAD), 90 et 101 (liens /actions?action=) ; src/components/skills/SkillMatrix.tsx:160 ; src/components/skills/SkillAlerts.tsx:78,116 ; src/lib/data/actions.ts:252-265 (Salarié non pilote : action introuvable))
  **À revoir avec ACT-21 (15/10/2026)** — le responsable consulte ses actions (décision du 15/10/2026), mais le pilote d'un recyclage est le responsable QHSE du site : afficher le recyclage sans lien pour le Salarié.
  ✅ **Livré (15/10/2026, intégration du paquet 1)** — une action de recyclage reprise qu'on ne peut pas lire (`canReadAction` : Salarié qui n'en est pas responsable) est réduite à son numéro, sans lien vers la fiche ; aucune nouvelle action de recyclage n'est créée.
- **HAB-12** — Un chef de service peut renommer ou archiver un titre utilisé par tous les sites. (preuve : src/server/skills.ts:42-46 (requireSkillsEditor), 361-435 (saveTitle, archiveTitle, restoreTitle sans requireApprover) ; src/lib/domain.ts:267 (Chef de service avec skills modifiable), 298-299 (canEdit) ; src/db/schema.ts:286-295 (pas de siteId))
- **HAB-13** — Évaluation à froid des formations. (preuve : src/db/schema.ts:305-318 (qualifications sans champ d'évaluation) ; src/server/skills.ts:157-158 (seule l'action de recyclage passe à 'verify') ; src/db/schema.ts:144-145 (efficacyNote sur actions uniquement))
- **HAB-14** — La vue Salarié est filtrée par le site sélectionné : ignorer ce filtre pour lui. (preuve : src/lib/data/skills.ts:160 (filtre de site), 233-234 (restriction Salarié après ce filtre), 253 et 286 (signaux eux aussi filtrés par site) ; src/app/(app)/layout.tsx:8,18 (siteOptions pour tous les rôles))
- **HAB-15** — Ordre des colonnes = ordre de création. (preuve : src/components/skills/TitlesManager.tsx:100-111 (Modifier et Archiver seulement) ; src/server/skills.ts:387-389 (sort = max + 1) ; src/lib/data/skills.ts:109 (orderBy sort))
- **HAB-16** — Manquent filtre titre et site ; colonne Salarié non sticky. (preuve : src/components/skills/SkillMatrix.tsx:317-329 (filtres sans titre), 396-401 (overflowX, minWidth 880, th Salarié non sticky), 414-419 (méta sans site) ; src/app/vigie.css:30 (seul sticky))
- **HAB-17** — Un lien profond écrase les filtres mémorisés (writeFilter) ; un titre archivé est ignoré sans message. (preuve : src/components/skills/SkillMatrix.tsx:296-298 (writeFilter persistant) ; src/app/(app)/habilitations/page.tsx:38-41 (titre archivé ignoré sans message), 49 (message regroupé))
- **HAB-18** — Ajouter à la revue : taux de conformité, formations sur 12 mois, recyclages en retard. (preuve : src/lib/data/review.ts:547-559 (skillCounts et skillAlerts seuls) ; src/components/review/DossierView.tsx:523-535)
- **HAB-19** — Archive transmise mais non affichée ; pas de dépôt avec validation. (preuve : src/lib/data/skills.ts:234 (archive filtrée et transmise) ; src/components/skills/SkillMatrix.tsx:177 (canAdd={canManage}), 280 et 394 (puce Sortis exclue pour self), 353-369 (TitlesButton sous !self))
- **HAB-20** — Suivre la déclaration de dérogation, valable 3 ans (R. 4153-40). (preuve : src/db/schema.ts:24-39 (people sans date de naissance ni statut) ; aucune table de déclaration de dérogation dans src/db/schema.ts)
- **HAB-21** — Réponse du service QHSE du 15/10/2026 : « c'est le service RH qui gère cette partie-là ; nous devons juste pouvoir consulter ces données ». Aucune action QSE n'est plus créée depuis l'écran (paquet 1) ; la saisie des formations et des exigences dans Vigie est à retirer quand Cursus fournira les données (INT-03, INT-09), l'écran devenant une consultation. (spécification : [`docs/specs/actions-qse.md`](specs/actions-qse.md) § 22)
  *Classe C4 — API Cursus (formations, titres) ; contenu selon le formulaire Power Apps Habilitations.*

## 9. Veille et contrôles (VEI)

18 éléments — P1 : 2 · P2 : 9 · P3 : 7 — charge indicative 13–34 j.

Au 18/10/2026 : 8 livrés (✅ VEI-01, VEI-02, VEI-03, VEI-04, VEI-06, VEI-09, VEI-10, VEI-11) — reste 10 éléments ouverts (C1 : 9 · C4 : 1 ; PA : 9), charge indicative 8–22 j.

| Réf | Élément | Priorité | Taille | Dépend de | Classe |
|---|---|:-:|:-:|---|:-:|
| VEI-01 | ✅ Pilote, responsable ou site effacés en silence | **P1** | S | — | — |
| VEI-02 | ✅ Réserves sans action de levée absentes des échéances | **P1** | S | — | — |
| VEI-03 | ✅ Échéance figée d'une exigence suivie par des contrôles | P2 | S | — | — |
| VEI-04 | ✅ Rattachements d'actions absents du journal des exigences et contrôles | P2 | S | — | — |
| VEI-05 | Écart ou réserve dont l'action est clôturée : relancer pour boucler | P2 | M | ACT-23 | C1 · PA |
| VEI-06 | ✅ Exigence jugée sur le seul site sélectionné | P2 | S | — | — |
| VEI-07 | Rattachement explicite d'une exigence à un indicateur (linkedTo) | P2 | S | — | C1 · PA |
| VEI-08 | Pièces jointes à compléter ou retirer après coup | P2 | S | — | C1 · PA |
| VEI-09 | ✅ Modifier « Dernier contrôle » contourne l'historique | P2 | S | — | — |
| VEI-10 | ✅ Applicabilité par site et référence du texte | P2 | M | — | — |
| VEI-11 | ✅ Résultat du contrôle réalisé | P2 | M | — | — |
| VEI-12 | Indicateurs calculés : registre des déchets et certification ISO 9001 | P3 | M | linkedTo éditable | C1 · PA |
| VEI-13 | Filtres, recherche et tri | P3 | M | — | C1 · PA |
| VEI-14 | Métrologie : étalonnage des équipements de mesure | P3 | M | — | C1 · PA |
| VEI-15 | Registre de sécurité consolidé et observations des organismes | P3 | M | — | C1 · PA |
| VEI-16 | Annulation d'une évaluation saisie par erreur | P3 | S | — | C1 |
| VEI-17 | Projets Keystone concernés : rattachement et critère | P3 | M | Connecteur Keystone | C4 · PA |
| VEI-18 | Périodicité de réévaluation propre à chaque exigence | P3 | S | — | C1 · PA |

- **VEI-01** — Sans withCurrent, l'enregistrement efface pilote sorti ou site archivé. (preuve : src/app/(app)/veille/page.tsx:25 ; src/lib/data/options.ts:33-34,49-50 ; src/components/watch/RequirementsPanel.tsx:442 ; src/components/watch/ControlsPanel.tsx:378,406,411 ; src/server/watch.ts:257,271-273)
  ✅ **Livré (12/10/2026)** — pilote ou responsable sorti de l'effectif et site archivé conservés à la modification (`withCurrent`, `src/lib/form-options.ts`), signalés sous le champ ; le serveur refuse de les choisir pour un nouvel enregistrement.
- **VEI-02** — Une réserve sans action de levée n'a ni signal ni badge ; proposer aussi « Créer une action » sur un contrôle dépassé sans réserve. (preuve : src/lib/data/watch.ts:264-272,303-304 ; src/components/watch/ControlsPanel.tsx:109-110,255)
  ✅ **Livré (12/10/2026)** — contrôle avec réserves sans action de levée : échéance en retard (rouge) comptée dans le badge Veille ; « Rattacher » et « Créer une action » (préremplie, échéance à 15 jours) sur un contrôle en retard sans action.
- **VEI-03** — L'échéance d'une exigence suivie par des contrôles est figée : la calculer depuis le prochain contrôle rattaché. (preuve : src/lib/data/watch.ts:148-151,155,160,282,287-290 ; src/db/seed.ts:188,423)
  ✅ **Livré (17/10/2026, paquet 4)** — exigence suivie par des contrôles (rattachés, actifs) : échéance = prochain contrôle (`requirementDue`, `src/lib/queries.ts`), affichée « JJ/MM/AAAA · prochain contrôle (…) » sur l'écran et dans le dossier de revue ; la date saisie, figée, n'est plus utilisée (aide du formulaire) et ne déclenche plus d'échéance « date d'application » (le contrôle signale la sienne).
- **VEI-04** — requirement et control sans logAs ; détachements de recordControl non tracés. (preuve : src/lib/action-links.ts:155-201 (pas de logAs, cf. 99,123,147) ; src/server/links.ts:52-53,74-75 ; src/server/plan.ts:139-140 ; src/server/watch.ts:326,334,358,447,452)
  ✅ **Livré (17/10/2026, paquet 3)** — exigence et contrôle portent `logAs` : rattachement, détachement, création depuis l'écran, abandon et reprise par une action de suite tracés aussi dans leur historique ; le détachement de l'action de levée par de nouvelles réserves (ou l'annulation d'un enregistrement) est écrit sur le contrôle comme sur l'action.
- **VEI-05** — L'action clôturée laisse l'écart ou la réserve ouvert : proposer « Réévaluer » et « Lever les réserves », avec un signal. (preuve : src/lib/data/watch.ts:166,283-284 ; src/components/watch/RequirementsPanel.tsx:354-367 ; src/components/watch/ControlsPanel.tsx:258-271)
  **À revoir avec ACT-23 (15/10/2026)** — relance de l'écart ou de la réserve après une vérification « Efficace » seulement ; non efficace, l'action de suite prend le relais.
- **VEI-06** — Contrôles et indicateurs filtrés par site alors que l'exigence vaut pour l'entreprise. (preuve : src/lib/data/watch.ts:99-105,148,152,171 ; src/lib/data/prevention.ts:660-668)
  ✅ **Livré (17/10/2026, paquet 4)** — contrôles rattachés à une exigence lus sur tout le périmètre de la personne, avec leur site (l'onglet « Contrôles périodiques » reste filtré par site) ; indicateur R. 4512-6 de la veille (`loadPreventionCompliance`) calculé sur tout le périmètre.
- **VEI-07** — Lien par texte du domaine ou regex ; ajouter un Select. (preuve : src/server/watch.ts:95 ; src/db/seed.ts:411 ; src/lib/data/watch.ts:101-104 ; src/lib/data/environment.ts:104,196-200)
- **VEI-08** — Ajout après saisie impossible ; preuve d'évaluation non retirable. (preuve : src/server/watch.ts:460-479 ; src/components/watch/ControlsPanel.tsx:344-345,466-468 ; src/components/watch/RequirementsPanel.tsx:341)
- **VEI-09** — Modifier « Dernier contrôle » met la date à jour directement, sans contrôle enregistré ni détachement des actions. (preuve : src/server/watch.ts:282-288 (cf. 326) ; src/components/watch/ControlsPanel.tsx:413-422 ; src/lib/data/watch.ts:214-215)
  ✅ **Livré (17/10/2026, paquet 3)** — à la modification d'un contrôle, « Dernier contrôle » et « Réserves en cours » sont en lecture (non envoyés) et refusés par `saveControl` s'ils changent : ils ne changent que par « Enregistrer un contrôle » ou l'annulation d'un enregistrement (historique, détachement de l'action de levée). La création garde les deux champs.
- **VEI-10** — Ajouter à l'exigence les sites concernés, l'URL Légifrance et la pièce du texte. (preuve : src/db/schema.ts:207-230 ; src/lib/data/watch.ts:260,275)
  ✅ **Livré (18/10/2026, paquet 5)** — exigence : sites concernés (aucun : tous ; fixés par le périmètre complet seulement), lien vers le texte officiel (https, Légifrance ou EUR-Lex), texte joint (pièces `requirement`, ajout et retrait journalisés) ; liste filtrée sur le site sélectionné, échéance rattachée au seul site concerné.
- **VEI-11** — Saisir le résultat du contrôle : favorable, avec réserves, défavorable, mise à l'arrêt. (preuve : src/db/schema.ts:253-271 ; src/lib/queries.ts:63-68 ; src/server/watch.ts:307-336)
  ✅ **Livré (18/10/2026, paquet 5)** — résultat obligatoire du contrôle enregistré : favorable, favorable avec réserves (réserves exigées), défavorable, mise à l'arrêt ; affiché dans l'historique et le statut ; un dernier contrôle défavorable ou à l'arrêt est signalé (échéance en retard) jusqu'à un nouveau contrôle favorable. Les saisies antérieures restent sans résultat.
- **VEI-12** — BSD manquants et état de certification dans indicatorOf. (preuve : src/lib/data/watch.ts:101-104 ; src/lib/data/environment.ts:196-200,322-337)
- **VEI-13** — Filtres par évaluation, domaine, pilote et responsable ; tri par échéance. (preuve : src/app/(app)/veille/page.tsx:46-49,103-108 ; src/lib/data/watch.ts:91-92)
- **VEI-14** — Catégorie métrologie, hors tolérance ouvrant une NC. (preuve : src/db/schema.ts:232-271)
- **VEI-15** — Registre imprimable par site (L. 4711-1) et mises en demeure. (preuve : src/db/schema.ts:232-271 (notes l. 259) ; src/components/watch/ControlsPanel.tsx:299-364 ; src/app/vigie.css:190-192)
- **VEI-16** — Annuler une évaluation saisie par erreur, avec motif, et recalculer l'évaluation courante. (preuve : src/db/schema.ts:274-282 ; src/server/watch.ts:131-180)
- **VEI-17** — Table requirement_projects et critère plus fin. (preuve : src/lib/data/watch.ts:66-73 ; src/components/watch/RequirementsPanel.tsx:312-315 ; src/db/schema.ts:220-222)
- **VEI-18** — Une seule constante de 12 mois pour toutes les exigences. (preuve : src/lib/domain.ts:142 ; src/lib/data/watch.ts:154,292 ; src/db/schema.ts:207-230)

## 10. Audits et revue de direction (AUD)

36 éléments — P1 : 6 · P2 : 11 · P3 : 19 — charge indicative 28,5–77 j.

Au 18/10/2026 : 16 livrés (✅ AUD-01, AUD-02, AUD-03, AUD-04, AUD-05, AUD-06, AUD-07, AUD-08, AUD-09, AUD-10, AUD-11, AUD-12, AUD-13, AUD-14, AUD-15, AUD-30) — reste 20 éléments ouverts (C1 : 19 · C2 : 1 ; PA : 15), charge indicative 15–40 j.

| Réf | Élément | Priorité | Taille | Dépend de | Classe |
|---|---|:-:|:-:|---|:-:|
| AUD-01 | ✅ Lier programme d'audit et revues de direction par reviewId | **P1** | M | Migration drizzle | — |
| AUD-02 | ✅ Accès en lecture aux audits pour leurs responsables | **P1** | S | — | — |
| AUD-03 | ✅ Reporter ou annuler un élément du programme | **P1** | M | Migration drizzle | — |
| AUD-04 | ✅ Contributeurs de revue sans accès à l'écran Audits | **P1** | M | — | — |
| AUD-05 | ✅ Section 1 du dossier : décisions sans action et actions annulées | **P1** | S | — | — |
| AUD-06 | ✅ Dossier figé calculé à la clôture, pas à la séance | **P1** | M | — | — |
| AUD-07 | ✅ Supprimer le libellé d'audit codé en dur | P2 | S | — | — |
| AUD-08 | ✅ Cycle de certification : renouvellement, suspension, historique | P2 | M | — | — |
| AUD-09 | ✅ Types de constat : écart majeur, observation, délai de réponse | P2 | M | — | — |
| AUD-10 | ✅ Journaliser les changements du programme faits par la revue | P2 | S | — | — |
| AUD-11 | ✅ Contrôles de saisie des constats | P2 | S | — | — |
| AUD-12 | ✅ Rattacher une action d'une autre revue la déplace | P2 | S | ACT-20 (source unique) | — |
| AUD-13 | ✅ Objectifs QHSE mesurables reliés aux indicateurs | P2 | L | — | — |
| AUD-14 | ✅ Contrôles avant clôture et visa | P2 | S | — | — |
| AUD-15 | ✅ Visa de la direction possible par l'animateur QHSE | P2 | S | — | — |
| AUD-16 | Échéances : décisions sans suite, prochaine revue non planifiée | P2 | S | — | C1 · PA |
| AUD-17 | Pièces jointes de la revue | P2 | M | — | C1 · PA |
| AUD-18 | Compléter les échéances du programme | P3 | S | — | C1 |
| AUD-19 | Lien profond vers un référentiel | P3 | S | — | C1 |
| AUD-20 | Audits hors programme en vrais audits | P3 | M | — | C1 · PA |
| AUD-21 | Plusieurs éléments par ligne et par mois | P3 | M | — | C1 · PA |
| AUD-22 | Rattacher programme, constats et certifications à un site | P3 | M | Migration drizzle | C1 · PA |
| AUD-23 | Règle « revue de direction » trop large | P3 | S | — | C1 |
| AUD-24 | Gestion des lignes et reconduction annuelle | P3 | M | — | C1 · PA |
| AUD-25 | Rétablir un constat annulé | P3 | S | — | C1 |
| AUD-26 | Impression du programme annuel | P3 | S | — | C1 · PA |
| AUD-27 | Auditeur interne lié à une personne | P3 | M | — | C1 · PA |
| AUD-28 | Plusieurs actions par constat | P3 | M | ACT-23 | C1 · PA |
| AUD-29 | Liste des constats : filtres et audits sans constat | P3 | S | — | C1 · PA |
| AUD-30 | ✅ Revue annulée : échéance du programme | P3 | S | Lien reviewId | — |
| AUD-31 | Contrôles de dates et de doublons | P3 | S | — | C1 |
| AUD-32 | Archiver les enregistrements figés en PDF et dans Documents maîtrisés | P3 | M | Arbitrage exports | C2 · PA |
| AUD-33 | Constats des audits fournisseurs dans la section Fournisseurs | P3 | S | — | C1 · PA |
| AUD-34 | Rectificatif d'une revue clôturée | P3 | M | — | C1 · PA |
| AUD-35 | Carte de revue : perception client et ressources | P3 | S | — | C1 · PA |
| AUD-36 | Décision de revue abandonnée ou reformulée après la séance : statut, motif, ancien libellé | P3 | M | Migration drizzle | C1 · PA |

- **AUD-01** — Lien par égalité de dates ; verrouiller les cellules de revue et ajouter « Ouvrir la revue ». (preuve : src/server/review.ts:66-81 (planItemsOf par plannedOn, ensurePlanItem sans lien si le mois est pris) ; src/server/review.ts:96-103,229-232 ; src/lib/data/audits.ts:252,262 (pendingReviews par date) ; src/components/audits/ProgramTimeline.tsx:113-117,194-292 (élément de revue modifiable comme un audit, sans lien vers la revue) ; src/db/schema.ts:346-361 (pas de reviewId))
  ✅ **Livré (12/10/2026)** — `audit_plan_items.review_id` (unique) : programme et revues liés, cellules verrouillées (« Ouvrir la revue »), « Au programme : … » ou « Hors programme annuel » sur la fiche de revue, modifications du programme par une revue journalisées ; annuler une revue annule son élément de programme (**AUD-30**).
- **AUD-02** — Chef de service et de projet sans écran Audits ; utiliser canEdit. (preuve : src/lib/domain.ts:267-268 ; src/app/(app)/audits/page.tsx:17,24 (guard puis canManage au lieu de canEdit) ; src/server/audits.ts:27-31 (canSee seulement) ; src/lib/data/todo.ts:34 (échéances filtrées par canOpen) ; src/db/seed.ts:263-267 (responsables E. Dubois et S. Benali))
  ✅ **Livré (12/10/2026)** — écran Audits ouvert en consultation aux chefs de service et de projet (boutons de saisie masqués, écritures refusées par `canEdit`, listes des formulaires absentes de la charge de la page) ; leurs éléments et échéances visibles.
- **AUD-03** — Seule la suppression existe ; année non modifiable. (preuve : src/components/audits/ProgramTimeline.tsx:138-141,211 (DeleteButton seul, year en champ caché) ; src/server/audits.ts:283-306 (delete physique, refus si action, constat ou rapport) ; src/lib/data/audits.ts:73-74,261-264 (état « late » permanent))
  ✅ **Livré (12/10/2026)** — « Reporter… » (`reschedulePlanItem`, date d'origine conservée dans `postponed_from`) et « Annuler l'élément » (`cancelPlanItem`, motif) remplacent la suppression ; liste repliable « Éléments annulés » ; `savePlanItem` ne change plus la planification d'un élément existant.
- **AUD-04** — Les contributeurs sans accès à l'écran Audits ne peuvent pas contribuer : vue « Mes contributions » et lecture du compte rendu. (preuve : src/lib/data/review.ts:624-625,637-645 ; src/server/review.ts:27-31,314-316 ; src/db/seed.ts:299,304,306)
  ✅ **Livré (12/10/2026)** — page « Mes contributions » (`/audits/contributions`, ouverte à tous les rôles) : la personne coche elle-même les éléments de revue qui lui sont confiés (`setReviewItemDone`), voit les décisions et les actions qu'elle pilote ; échéances de contribution avec ce lien en lecture ; `/revue-de-direction` renvoie les rôles sans accès au dossier vers cette page. Réserve (périmètre, **SEC-02**) : pour une revue clôturée, les décisions viennent du dossier figé, construit sous « Tous les sites » : la fiche résumée de l'action (intitulé, pilote, statut, échéance) y est montrée même quand l'action est sur un site hors du périmètre du participant.
- **AUD-05** — Le suivi des revues précédentes omet les décisions sans action et les actions annulées : ISO 9001 §9.3.2 a incomplet. (preuve : src/lib/data/review.ts:194,356-361 ; src/lib/queries.ts:45 ; src/lib/data/review.ts:200 (seules les décisions de la revue courante sont lues))
  ✅ **Livré (12/10/2026)** — section 1 du dossier (`reviewFollowUp`) : décisions sans action au plan et actions annulées (avec leur motif) ; anciens dossiers (v1) affichés comme avant.
- **AUD-06** — L'instantané calcule la période et les indicateurs à la date de clôture, pas à la date de la séance. (preuve : src/lib/data/review.ts:301-302 ; src/server/review.ts:268-273 ; src/lib/domain.ts:230)
  ✅ **Livré (12/10/2026)** — dossier calculé à la date de la séance (`buildReviewDossier(…, { asOf })`), figé à la saisie du compte rendu (`holdReview`, « Tous les sites » requis) puis repris à la clôture ; instantanés v2 (`seance` / `cloture`), v1 toujours lus.
- **AUD-07** — DEFAULT_AUDIT préremplit le libellé d'audit des constats. (preuve : src/lib/data/audits.ts:65 ; src/app/(app)/audits/page.tsx:11,48 ; src/components/audits/FindingsCard.tsx:138,237)
  ✅ **Livré (17/10/2026, paquet 4)** — `DEFAULT_AUDIT` supprimé : un constat hors programme part d'un libellé vide.
- **AUD-08** — Échéance de certification visible à 15 j seulement ; ni cycle de 3 ans, ni renouvellement, ni suspension, ni historique. (preuve : src/lib/data/audits.ts:283-288 ; src/lib/domain.ts:182,312 (CERT_SOON_DAYS = 30, TODO_HORIZON_DAYS = 15) ; src/lib/queries.ts:140-148 ; src/db/schema.ts:332-343)
  ✅ **Livré (18/10/2026, paquet 5)** — cycle de certification : certificat de 3 ans au plus (ISO/IEC 17021-1, refus sinon) ; « Renouveler le certificat » (nouveau cycle, le précédent au journal) ; suspension par l'organisme (date, motif) et levée motivée, statut « Certificat suspendu » et échéance ; fin de validité signalée à 30 jours (au lieu de 15) ; « audit de renouvellement à programmer » à 6 mois de la fin de validité sans audit programmé avant. Historique : journal du référentiel.
- **AUD-09** — Trois types seulement (écart mineur, piste, point fort) : ajouter écart majeur, observation et délai de réponse. (preuve : src/lib/domain.ts:161-165 ; src/db/schema.ts:369 (kind : ecart_mineur | piste | point_fort) ; src/lib/data/audits.ts:271-274)
  ✅ **Livré (18/10/2026, paquet 5)** — types « Écart majeur » et « Observation » ; délai de réponse d'un écart (« Réponse attendue le », jamais avant le constat, ignoré pour les autres types), journalisé ; échéance datée du délai, puis en retard.
- **AUD-10** — ensurePlanItem et moveReview sans logChange. (preuve : src/server/review.ts:71-81,96-103,232)
  ✅ **Livré (constaté le 15/10/2026)** — avec AUD-01 au lot 2 : `ensurePlanItem` et `moveReview` journalisent sur l'élément du programme le rattachement, la création et le déplacement faits par la revue, avec le détail des champs modifiés (`src/server/review.ts`, `diffFields`).
- **AUD-11** — Constat accepté sur un audit futur ; la date « Réalisé le » est perdue si la case n'est pas cochée. (preuve : src/server/audits.ts:224 (doneOn null si non coché) ; src/server/audits.ts:327,337-341 (aucun contrôle item.done, foundOn ??= plannedOn))
  ◐ **Partiel (constaté le 15/10/2026)** — livré : une date de constat future est refusée. Reste : constat accepté sur un audit non réalisé (aucun contrôle de `item.done`, `foundOn ??= plannedOn`) et date « Réalisé le » perdue quand la case n'est pas cochée.
  ✅ **Livré (17/10/2026, paquet 4)** — un constat se rattache à un audit réalisé et en vigueur (refus sinon ; un constat existant garde son audit, toujours proposé dans la liste) ; liste « Audit » limitée aux audits réalisés, bouton « Ajouter un constat » de la fenêtre d'un élément remplacé par « Déclarez l'audit réalisé… » tant qu'il ne l'est pas ; « Réalisé le » saisi sans la case cochée refusé (sauf la date déjà enregistrée d'une réalisation qu'on annule).
- **AUD-12** — Rattacher une action déjà liée à une autre revue réécrit son reviewId sans contrôle. (preuve : src/lib/action-links.ts:265-271,285-296)
  **À revoir avec ACT-20 (15/10/2026)** — rattacher l'action d'une autre revue est refusé (source unique, verrouillée).
  ◐ **Partiel (15/10/2026, paquet 1)** — livré : rattacher à une revue (ou à une de ses décisions) une action qui relève d'une autre revue est refusé. Reste : les autres contrôles de rattachement d'une revue.
  ✅ **Livré (17/10/2026, paquet 2)** — une action relève d'une seule revue : sa revue ou celle d'une décision qu'elle porte (ligne reprise sans `review_id`) — rattacher à une autre revue ou à ses décisions est refusé ; détacher la revue est refusé tant qu'une décision de cette revue est portée par l'action ; dossier d'une revue clôturée ou annulée figé (détacher la revue ou une décision refusé) ; rien n'est écrit en cas de refus (`detachBlocked`, `src/lib/action-links.ts`).
- **AUD-13** — TF1_TARGET constant ; objectifs de revue en texte libre (ISO §6.2, §9.1). (preuve : src/lib/data/dashboard.ts:13,66 ; src/lib/data/review.ts:369 ; src/db/schema.ts:416-426)
  **À revoir avec ACT-20 (15/10/2026)** — la source « Objectif QSE » vise les décisions de revue de nature « objectif », puis l'entité objectif quand elle existera.
  ◐ **Partiel (15/10/2026, paquet 1)** — livré : la source « Objectif QSE » est imposée aux actions des décisions de revue de nature « objectif ». Reste : objectifs mesurables reliés aux indicateurs (TF1 cible…).
  ✅ **Livré (18/10/2026, paquet 5)** — carte « Objectifs QHSE » de l'écran Audits (`qhse_objectives`) : objectif d'une année, d'un site ou de tous les sites, indicateur calculé (TF1, TG, AT avec arrêt, remontées PA + SD, NC, réclamations, coût de non-qualité, actions efficaces, actions en retard, contrôles dépassés), cible, pilote, décision de revue « objectif » facultative ; valeur et état calculés à l'affichage, jamais stockés ; archivage motivé, historique ; cible TF1 du tableau de bord et du dossier de revue tirée de l'objectif (plus de `TF1_TARGET`) ; section « Objectifs QHSE » du dossier de revue (§9.3.2 c).
- **AUD-14** — Clôture et visa ne vérifient ni les participants, ni le compte rendu, ni les décisions sans pilote. (preuve : src/server/review.ts:184-194,257-266,401-402)
  ◐ **Partiel (constaté le 15/10/2026)** — livré : la clôture exige le compte rendu (revue « tenue »). Reste : contrôles des participants et des décisions sans pilote avant la clôture et le visa.
  ✅ **Livré (17/10/2026, paquet 4)** — avant le visa : participants de l'entreprise, synthèse de la séance et pilote de chaque décision exigés (`reviewCloseBlockers`, `src/lib/review-rules.ts`), affichés à la place du bouton « Clôturer » ; refus sans écriture.
- **AUD-15** — Le visa n'exige que requireApprover, que l'animateur QHSE satisfait : le réserver à la direction. (preuve : src/server/review.ts:33-38,256-259 ; src/lib/domain.ts:294)
  ✅ **Livré (17/10/2026, paquet 4)** — visa (clôture, dossier figé) réservé à la direction (`canSignReview`) ; l'animateur QHSE prépare, saisit le compte rendu et annule une revue planifiée, la carte indique « En attente du visa de la direction ».
- **AUD-16** — Aucune échéance pour une décision restée sans suite ni pour une prochaine revue non planifiée (ISO 9001 §9.3.1). (preuve : src/lib/data/review.ts:623-654)
- **AUD-17** — Ajouter les types de pièces jointes review et review_item. (preuve : src/db/schema.ts:59-60 ; src/lib/uploads.ts:71-113)
- **AUD-18** — Un élément sans date n'a pas d'échéance ; un élément en retard double l'échéance de son action porteuse. (preuve : src/lib/data/audits.ts:259-267 (horizon conditionné à p.plannedOn, retard sans exclusion de l'action) ; src/lib/data/actions.ts:298,304-305 (doublon évité seulement pour l'à venir))
- **AUD-19** — Les échéances de certification renvoient vers /audits sans ouvrir le référentiel : accepter ?referentiel=&lt;id>. (preuve : src/lib/data/audits.ts:282 (href '/audits') ; src/app/(app)/audits/page.tsx:20,41 (aucun paramètre referentiel, CertificationCards sans initialId))
- **AUD-20** — Les constats hors programme ne portent qu'un libellé libre, sans date ni auditeur. (preuve : src/server/audits.ts:319-322 ; src/lib/data/audits.ts:143 (groupe hors programme : year, date et auditor à null, reports vide))
  **À revoir avec ACT-20 (15/10/2026)** — utile au lien d'une action à un audit par son numéro, demandé par le service QHSE.
- **AUD-21** — Le serveur refuse un second élément sur la même ligne et le même mois : lever la contrainte. (preuve : src/server/audits.ts:217-221 ; src/server/review.ts:83-93 ; src/components/audits/ProgramTimeline.tsx:166)
- **AUD-22** — Programme, constats et certifications n'ont pas de siteId ni de filtre par site. (preuve : src/db/schema.ts:332-377 (aucun siteId) ; src/lib/data/audits.ts:85-96 (aucun filtre currentSiteId))
- **AUD-23** — Un élément est reconnu comme revue de direction par /revue/i.test : tout libellé contenant « revue » est concerné. (preuve : src/components/audits/shared.ts:17-23)
- **AUD-24** — Lignes du programme ni renommables ni masquables ; pas de reconduction du programme N-1. (preuve : src/lib/data/audits.ts:205-209 ; src/server/audits.ts:167-268 (aucune action de ligne ni de copie))
- **AUD-25** — Un constat annulé ne peut pas être rétabli : ajouter cette action, avec motif. (preuve : src/server/audits.ts:363-390 (aucune fonction restoreFinding) ; src/server/audits.ts:334 (constat annulé non modifiable))
- **AUD-26** — Le programme annuel d'audit ne s'imprime pas (ISO 9001 §9.2). (preuve : src/app/(app)/audits/page.tsx:37-56 (pas de PrintButton) ; src/app/vigie.css:190-192 ; src/lib/data/review.ts:396-417 (programme dans le dossier))
- **AUD-27** — L'auditeur est un texte libre, sans lien vers une personne ni contrôle de qualification. (preuve : src/db/schema.ts:358 ; src/server/audits.ts:186)
- **AUD-28** — Un constat ne porte qu'une action (actionId unique). (preuve : src/db/schema.ts:371 ; src/lib/action-links.ts (rattachement à un seul emplacement))
  **À revoir avec ACT-23 (15/10/2026)** — action de suite d'une vérification non efficace et lien action → audit (n°) : si ce lien est porté par l'action, un constat a de fait plusieurs actions ; à traiter avec la refonte, pas avant.
- **AUD-29** — Seules des puces par audit filtrent la liste ; les audits sans constat n'y apparaissent pas. (preuve : src/components/audits/FindingsCard.tsx:85,105-118 ; src/lib/data/audits.ts:134-153 (groupes construits à partir des seuls constats))
- **AUD-30** — L'élément de programme d'une revue annulée reste en place et passe « à confirmer ». (preuve : src/server/review.ts:297-300 ; src/lib/data/audits.ts:252,262)
  ✅ **Livré (12/10/2026)** — annuler une revue de direction annule son élément de programme (lien `review_id`, **AUD-01**).
- **AUD-31** — Éléments après la revue, échéance passée, plusieurs revues planifiées. (preuve : src/server/review.ts:50-55,128,341,402)
- **AUD-32** — Archiver en PDF, et dans les documents maîtrisés, le dossier de revue et les versions DUERP figés. (preuve : src/server/review.ts:256-282 ; src/components/review/DossierView.tsx:45 (impression navigateur seulement) ; src/lib/data/documents.ts:168-197 (aucun lien avec les revues))
- **AUD-33** — Les constats d'audits fournisseurs, déjà chargés, sont rangés dans la section Audits et non Fournisseurs. (preuve : src/lib/data/review.ts:419-432 ; src/lib/data/review.ts:442-452 (constats regroupés dans la section Audits))
- **AUD-34** — Une revue clôturée ne peut être corrigée : rectificatif tracé après visa. (preuve : src/server/review.ts:199,322,353,414 ; src/lib/data/review.ts:52)
- **AUD-35** — La perception client et les ressources ne sont pas affichées sur la carte de revue. (preuve : src/components/review/ReviewPanel.tsx:133-139 ; src/components/review/DossierView.tsx:172,548)
- **AUD-36** — Une fois la revue tenue, une décision ne peut plus être retirée ni déclarée abandonnée avec un motif : seul son intitulé se réécrit, et le journal ne garde que le nouveau texte. Ajouter un statut « abandonnée » motivé (qui, quand, pourquoi), affiché barré dans la carte et le dossier, et l'ancien libellé dans le journal. Le dernier lot l'a écarté pour ne pas ajouter de migration. (preuve : src/server/review.ts:436-447 (retrait refusé hors « planifiée », message « corrigez leur intitulé ») ; src/server/review.ts:417 (journal : nouveau texte seul, sans details) ; src/db/schema.ts:417-426 (review_decisions sans cancelledAt ni cancelReason) ; src/components/review/ReviewDialogs.tsx:96-98 (« Retirer » seulement avant la séance, via canDelete) ; previous-run.md:856)

## 11. Documents et environnement (DOC)

23 éléments — P1 : 2 · P2 : 10 · P3 : 11 — charge indicative 22–62 j.

Au 18/10/2026 : 8 livrés (✅ DOC-01, DOC-02, DOC-04, DOC-05, DOC-06, DOC-09, DOC-10, DOC-12) · 1 partiel (◐ DOC-13) — reste 15 éléments ouverts (C1 : 8 · C2 : 4 · C3 : 2 · C4 : 1 ; PA : 15), charge indicative 17–50 j.

| Réf | Élément | Priorité | Taille | Dépend de | Classe |
|---|---|:-:|:-:|---|:-:|
| DOC-01 | ✅ Document : propriétaire sorti ou site archivé remplacé | **P1** | S | — | — |
| DOC-02 | ✅ Registre des déchets : mentions de l'arrêté du 31 mai 2021 | **P1** | M | SIRET des sites | — |
| DOC-03 | Propriétaire en consultation seule : ni révision ni échéances | P2 | M | — | C2 · PA |
| DOC-04 | ✅ Journal du cycle de vie des documents | P2 | M | — | — |
| DOC-05 | ✅ Version approuvée sans fichier | P2 | S | — | — |
| DOC-06 | ✅ Renvoi en brouillon sans motif | P2 | S | — | — |
| DOC-07 | Diffusion contrôlée et prise de connaissance | P2 | L | Cursus ; Entra ID | C4 · PA |
| DOC-08 | Lien profond vers un enlèvement ou une filière | P2 | S | — | C1 · PA |
| DOC-09 | ✅ Archivage d'une filière déchets | P2 | S | — | — |
| DOC-10 | ✅ Journal des filières et relevés | P2 | S | — | — |
| DOC-11 | Pièces jointes d'un enlèvement | P2 | M | — | C1 · PA |
| DOC-12 | ✅ Statuts de BSD refus et acceptation partielle | P2 | S | — | — |
| DOC-13 | ◐ Action liée d'une version : contrôles contournés | P3 | S | ACT-28 | C1 · PA |
| DOC-14 | Échéances documentaires | P3 | S | — | C1 · PA |
| DOC-15 | Revue périodique sans modification | P3 | M | — | C1 · PA |
| DOC-16 | Liens « Procédure » sur les autres écrans | P3 | S | Procédures du service QHSE | C3 · PA |
| DOC-17 | Conservation des enregistrements et documents externes | P3 | M | — | C1 · PA |
| DOC-18 | Séparation rédaction et approbation | P3 | S | — | C2 · PA |
| DOC-19 | Relevés de consommation : responsable absent, sites sans relevé non suivis | P3 | S | — | C1 · PA |
| DOC-20 | Filières d'un site archivé proposées | P3 | S | — | C1 · PA |
| DOC-21 | Suivi des rejets eaux et air | P3 | L | — | C2 · PA |
| DOC-22 | Accès de l'encadrement à Environnement | P3 | S | — | C2 · PA |
| DOC-23 | Aspects et impacts environnementaux | P3 | L | — | C3 · PA |

- **DOC-01** — Sans withCurrent, l'enregistrement remplace en silence un propriétaire sorti ou un site archivé. (preuve : src/components/documents/DocumentForms.tsx:114-115,125-126 ; src/lib/data/options.ts:31-32,49 ; src/components/form.tsx:79-86 ; src/server/documents.ts:23-39)
  ✅ **Livré (12/10/2026)** — à la modification d'un document, le propriétaire sorti ou le site archivé sont conservés (indication sous le champ) ; un propriétaire sorti ou un site archivé ne peuvent pas être choisis ; modification des métadonnées journalisée (propriétaire, site et type par leurs libellés).
- **DOC-02** — Mentions manquantes au registre : SIRET, récépissé du transporteur, traitement final. (preuve : src/db/schema.ts:533-567 ; src/db/schema.ts:10-22 (sites sans SIRET) ; src/lib/data/environment.ts:447-450 ; src/components/environment/model.ts:1-3)
  ✅ **Livré (12/10/2026)** — mentions de l'arrêté du 31 mai 2021 : SIRET de l'établissement (`saveSiteSiret`, journalisé), POP, qualification, SIRET et adresse du collecteur, récépissé, SIRET et adresse de l'installation de destination, transporteur (SIRET, adresse, récépissé), adresse d'enlèvement ; contrôles purs (SIRET, TVA intracommunautaire), mentions manquantes signalées (filtre, échéance par site et par année), export CSV dans l'ordre de l'arrêté. Réserves : courtier et négociant, éco-organisme, numéros de notification et de document de mouvement, plusieurs transporteurs par enlèvement et déclaration RNDTS / Trackdéchets (**INT-10**) non traités ; taux de valorisation toujours calculé d'après le code R/D ; libellés de l'arrêté à faire valider par le responsable QHSE.
- **DOC-03** — Un propriétaire en consultation seule ne peut pas réviser son document et loadDocumentSignals ne lui renvoie rien sans canEdit. (preuve : src/lib/domain.ts:267-269 ; src/lib/data/documents.ts:268 ; src/server/documents.ts:67-71 ; src/components/documents/DocumentForms.tsx:68 ; src/db/seeds/documents.ts:41,75,84,108,116,124)
- **DOC-04** — Seul obsoleteDocument écrit dans le journal ; les autres étapes du cycle de vie ne sont pas tracées. (preuve : src/server/documents.ts:97-351 (aucun logChange) ; src/server/documents.ts:377 (seul appel) ; src/server/documents.ts:320 ; src/db/schema.ts:518-529)
  ◐ **Partiel (12/10/2026)** — livré : modification des métadonnées d'un document journalisée (propriétaire, site, type). Reste : les autres étapes du cycle de vie (versions, approbation, diffusion).
  ✅ **Livré (17/10/2026, paquet 3)** — cycle de vie journalisé sur le document dans la transaction de chaque étape : création, révision ou relance, brouillon modifié (objet), fichier joint, remplacé ou retiré, soumission, approbation (version précédente archivée), renvoi en brouillon (motif, DOC-06), abandon d'un brouillon (motif désormais obligatoire), action liée à une version (aussi sur le document). Historique du document chargé à l'ouverture de la fiche (`LazyChangeLog` « document », à la saisie seulement).
- **DOC-05** — Une version peut être approuvée sans fichier joint. (preuve : src/server/documents.ts:285-306 ; src/components/documents/DocumentPanel.tsx (ConfirmForm submit : note « Aucun fichier », ConfirmForm approve : aucun contrôle))
  ✅ **Livré (17/10/2026, paquet 3)** — livré avec le paquet 3 : une version ne se soumet ni ne s'approuve sans son fichier (`submitVersion`, `approveVersion` ; boutons désactivés avec l'explication). Les versions en revue du jeu de démonstration, sans fichier, se renvoient en brouillon pour être complétées.
- **DOC-06** — Le renvoi en brouillon ne demande pas de motif et ne crée pas d'échéance pour l'auteur. (preuve : src/server/documents.ts:309-324 ; src/components/documents/DocumentPanel.tsx (mode 'return' : ConfirmForm sans champ motif) ; src/lib/data/documents.ts:265-295)
  ✅ **Livré (17/10/2026, paquet 3)** — « Renvoyer en brouillon » exige les corrections demandées (`ReasonForm`, motif journalisé) ; date et motif gardés sur la version (`document_versions.returned_on`, `return_reason`, migration `0006`) et affichés sur la fiche ; échéance « Révision documentaire » de l'auteur (`loadDocumentSignals`) jusqu'à la nouvelle soumission, qui la lève.
- **DOC-07** — La diffusion est un texte libre : destinataires structurés et accusé de prise de connaissance. (preuve : src/db/schema.ts:513 ; design/Vigie.dc.html:778 (docs : « diffusion contrôlée »))
- **DOC-08** — Les fiches d'enlèvement et de filière s'ouvrent en état local, sans lien profond. (preuve : src/components/environment/WasteRegister.tsx:38 ; src/components/environment/StreamsPanel.tsx:36 ; src/lib/data/actions.ts:185-188)
- **DOC-09** — Une filière ne peut qu'être supprimée : ajouter l'archivage. (preuve : src/server/environment.ts:217-234 ; src/db/schema.ts:533-544 (pas d'archivedAt))
  ✅ **Livré (17/10/2026, paquet 3)** — « Archiver la filière » (motif obligatoire, `archiveWasteStream`) remplace la suppression ; une filière archivée n'est plus proposée pour un nouvel enlèvement (refusée par `saveWasteEntry`, un enlèvement déjà inscrit reste modifiable) ni modifiable, reste listée (« Archivée », en fin de liste) avec son registre, ses actions et son historique ; « Réactiver la filière » avec motif (`restoreWasteStream`, site actif du périmètre). Colonnes `archived_*` (migration `0006`). La création d'une action depuis une filière est aussi tracée sur la filière (`logAs`).
- **DOC-10** — Filières et relevés modifiés sans logChange. (preuve : src/server/environment.ts:164-215 ; src/server/environment.ts:218-234 ; src/server/environment.ts:242-282)
  ◐ **Partiel (12/10/2026)** — livré : filières journalisées (création, modification, historique affiché). Reste : relevés de consommation.
  ✅ **Livré (17/10/2026, paquet 3)** — relevés de consommation journalisés par site et par mois (`consumption`, « site|AAAA-MM-01 » : valeur précédente → nouvelle par énergie, saisie, modification ou effacement), dans la transaction ; historique du mois dans la fenêtre de saisie (chargé à l'ouverture).
- **DOC-11** — Joindre bordereau et certificat à un enlèvement. (preuve : src/lib/uploads.ts:71-112 ; src/components/environment/WasteRegister.tsx:111-160)
- **DOC-12** — Quatre statuts de BSD seulement : ajouter refus et acceptation partielle. (preuve : src/components/environment/model.ts:9-15,21)
  ✅ **Livré (18/10/2026, paquet 5)** — statuts de BSD « Refusé » et « Accepté partiellement » : motif obligatoire, quantité refusée (toute la quantité pour un refus, la part saisie sinon), journalisés et affichés sur l'enlèvement ; taux de valorisation calculé sur la quantité acceptée.
- **DOC-13** — L'action liée à une version est lue par readAction au lieu de checkActionLink : les contrôles de rattachement sont contournés. (preuve : src/server/documents.ts:43-49,105,183,240 ; src/lib/action-links.ts:324-330 ; src/server/links.ts:17-31,38-58)
  **À revoir avec ACT-28 (15/10/2026)** — `DocumentPanel` fait partie des écrans qui créent des actions : corriger avec leur adaptation.
  ◐ **Partiel (15/10/2026, paquet 1)** — livré : changer l'action liée d'une version suit les règles de `linkAction` (QHSE, action ni Vérifiée ni Abandonnée, site) et se journalise sur les actions. Reste : passer par `checkActionLink` lui-même.
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
  **À revoir avec ACT-37 (15/10/2026)** — les actions de source « Analyse environnementale » pourront se rattacher aux aspects et impacts.

## 12. Intégrations (INT)

17 éléments — P1 : 4 · P2 : 6 · P3 : 7 — charge indicative 30–96 j.

Au 15/10/2026 : aucun livré — reste 17 éléments ouverts (C1 : 3 · C3 : 2 · C4 : 12 ; PA : 7), charge indicative 30–96 j.

| Réf | Élément | Priorité | Taille | Dépend de | Classe |
|---|---|:-:|:-:|---|:-:|
| INT-01 | Socle commun des connecteurs | **P1** | L | Hébergement | C4 |
| INT-02 | Connecteur Keystone : projets et affectations | **P1** | L | API Keystone | C4 |
| INT-03 | Connecteur Cursus : personnel | **P1** | L | API Cursus | C4 · PA |
| INT-04 | Notifications sortantes e-mail, Teams, push | **P1** | L | Compte d'envoi ; Entra ID ; ACT-33 | C4 |
| INT-05 | Projets Keystone référencés par identifiant | P2 | M | API Keystone (INT-02) | C4 · PA |
| INT-06 | Import PP par IA : coût | P2 | M | — | C1 |
| INT-07 | Import PP par IA : confidentialité | P2 | S | DPO | C3 |
| INT-08 | Liens directs vers Keystone | P2 | S | Adresse de Keystone | C3 |
| INT-09 | Formations avec Cursus | P2 | L | Cursus | C4 · PA |
| INT-10 | Connecteur Trackdéchets | P2 | L | Jeton API | C4 · PA |
| INT-11 | API Vigie pour Keystone | P3 | L | Entra ID | C4 |
| INT-12 | Filtre « Mes projets » | P3 | M | Keystone | C4 · PA |
| INT-13 | Import PP par IA : appel long et configuration | P3 | M | — | C1 |
| INT-14 | Import PP : plusieurs pages et HEIC | P3 | M | — | C1 |
| INT-15 | Indicateurs fournisseurs et satisfaction depuis Keystone | P3 | M | Keystone | C4 · PA |
| INT-16 | Alerte Légifrance | P3 | M | API Légifrance | C4 · PA |
| INT-17 | Flux iCalendar des échéances | P3 | M | Entra ID | C4 |

- **INT-01** — Client HTTP, journal de synchronisation, planification et écran « Connecteurs » communs à Keystone, Cursus et Trackdéchets. (preuve : .env.example:19-26 (variables commentées seulement) ; package.json:14-29 (aucune dépendance de planification ou de synchro) ; src/lib/domain.ts:238-258 (aucun écran Connecteurs dans SCREENS/NAV))
  **À revoir avec ACT-33 (15/10/2026)** — la planification relève de PRD-12, livré avec ACT-33 ; restent le client HTTP, le journal de synchronisation et l'écran « Connecteurs ».
- **INT-02** — keystone_projects et les affectations ne sont alimentées que par le seed : les synchroniser depuis Keystone. (preuve : src/db/seed.ts:136-147,347,462 (seule source des tables) ; src/db/schema.ts:48-54,320-328 ; src/lib/data/skills.ts:112,198-211)
- **INT-03** — Origine de la fiche, matricule, synchronisation et champs verrouillés quand la donnée vient de Cursus (source de vérité RH). (preuve : src/components/skills/SkillMatrix.tsx:356 ; src/components/skills/PersonForm.tsx:69,100 ; src/db/schema.ts:24-39 (pas de source ni de matricule) ; src/server/skills.ts:267,314)
  **À revoir avec ACT-39 (15/10/2026)** — rapprocher par Cursus les fiches de responsables créées par l'import Power Apps (point 16 de la spécification).
- **INT-04** — Récapitulatif périodique et alertes immédiates hors de la cloche. (preuve : src/lib/data/notifications.ts:24-34 (cloche seulement) ; src/db/schema.ts:25-39 (people sans e-mail) ; package.json:14-29 (ni client e-mail ni planificateur))
  **À revoir avec ACT-33 et ACT-34 (15/10/2026)** — le canal e-mail (gabarit, planification, journal, transport) est construit par ACT-33 et ACT-34 pour le rappel du mercredi ; restent les alertes immédiates, Teams et push ; la notification de création d'une action n'est jamais envoyée par e-mail.
  **Mise à jour (15/10/2026)** — canal e-mail construit par ACT-33 (gabarit, planification, journal, transport `fichier`) ; envoi réel : ACT-34.
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

Au 15/10/2026 : aucun livré — reste 9 éléments ouverts (C1 : 2 · C2 : 7 ; PA : 7), charge indicative 12–37 j.

| Réf | Élément | Priorité | Taille | Dépend de | Classe |
|---|---|:-:|:-:|---|:-:|
| IMP-01 | Import des heures travaillées | **P1** | M | Levée du report | C2 |
| IMP-02 | Import du personnel Lucca | P2 | M | Levée du report | C2 · PA |
| IMP-03 | Import Excel de la veille | P2 | L | Levée du report | C2 · PA |
| IMP-04 | Helper CSV commun | P2 | S | — | C1 |
| IMP-05 | Exports CSV événements et veille | P2 | M | Levée du report ; helper CSV | C2 · PA |
| IMP-06 | Export et impression de la matrice des habilitations | P2 | M | Levée du report (export) | C2 · PA |
| IMP-07 | Impression des fiches événement et action | P2 | M | ACT-23 (fiche action) | C1 · PA |
| IMP-08 | Exports : liste maîtresse, plans et permis | P3 | S | Levée du report ; helper CSV | C2 · PA |
| IMP-09 | Plan régénéré au format importé | P3 | L | Levée du report | C2 · PA |

- **IMP-01** — Import depuis la paie (le TF1/TG vaut 0 sans heures). (preuve : src/db/schema.ts:41-46 (table hours_worked) ; src/db/seed.ts:350-354 (seule source des heures) ; src/lib/data/dashboard.ts:25,38-40 (TF1/TG à 0 sans heures) ; src/lib/data/review.ts:97,364-367 ; aucune server action dans src/server/)
- **IMP-02** — Import CSV avec aperçu avant écriture. (preuve : src/components/skills/SkillMatrix.tsx:355 (bouton Soon désactivé) ; src/server/skills.ts:97-422 (aucune action d'import) ; maquette design/Vigie.dc.html:410)
  **À revoir avec ACT-39 (15/10/2026)** — l'import de l'extraction Power Apps pourra aussi créer des fiches de responsables (point 16 de la spécification).
- **IMP-03** — Import du tableau de veille existant avec aperçu. (preuve : src/app/(app)/veille/page.tsx:75-77 (bouton désactivé) ; src/server/watch.ts:70-461 (aucune action d'import) ; parseurs réutilisables : src/lib/pp-import/docx.ts (fflate + fast-xml-parser) ; maquette design/Vigie.dc.html:366)
- **IMP-04** — csvCell, fileSlug, BOM et séparateur « ; » existent en deux copies. (preuve : src/lib/data/risks.ts:447-473 et src/lib/data/environment.ts:452-475 (csvCell, fileSlug, BOM/« ; » dupliqués) ; src/app/(app)/risques/export/route.ts:12-21 et src/app/(app)/environnement/registre/route.ts:22-29 (en-têtes Content-Disposition dupliqués))
- **IMP-05** — Exports reportés ; suivre le modèle de l'export DUERP. (preuve : src/app/(app)/evenements/, src/app/(app)/actions/, src/app/(app)/veille/ (uniquement page.tsx, aucun route.ts) ; modèle : src/app/(app)/risques/export/route.ts:12-56)
  **À revoir avec la refonte des actions (15/10/2026)** — actions retirées du périmètre (pas d'export Excel des actions, décision du service QHSE) ; restent les événements et la veille.
- **IMP-06** — Matrice exportable et imprimable pour les audits. (preuve : src/app/(app)/habilitations/page.tsx (seul fichier, pas de route d'export ni de vue d'impression) ; src/components/skills/SkillMatrix.tsx:352-366 (barre d'outils sans export/impression) ; src/app/vigie.css:190-192)
- **IMP-07** — Feuille d'impression générique pour les fiches ouvertes en fenêtre modale. (preuve : src/app/vigie.css:190-192 (règle print minimale) ; src/components/Dialog.tsx:13 (fiches en dialog modal) ; PrintButton utilisé seulement dans src/components/review/DossierView.tsx:45, src/app/signaler/postes/page.tsx:31, src/app/(app)/prevention/imprimer/ ; src/app/(app)/prevention/imprimer/permis/page.tsx:16 (registre seulement, pas de fiche permis individuelle))
  **À revoir avec ACT-23 (15/10/2026)** — fiche action imprimable après la refonte (nouveaux blocs de la fiche) ; la fiche événement pourra changer avec le formulaire Power Apps Événements.
- **IMP-08** — Exports reportés de la liste maîtresse des documents et des plans/permis. (preuve : src/app/(app)/documents/page.tsx (seul fichier, aucun export) ; src/app/(app)/prevention/ (vues imprimer/ présentes, aucun route.ts CSV) ; modèle : src/app/(app)/environnement/registre/route.ts)
- **IMP-09** — Régénérer le plan de prévention dans le format du formulaire importé (pdf-lib). (preuve : src/lib/pp-import/pdf-form.ts:1-7 (lecture seule avec pdf-lib) ; aucune génération PDF dans src/ ; impression navigateur seulement : src/app/(app)/prevention/imprimer/plan/[id]/page.tsx)

## 14. Production et exploitation (PRD)

15 éléments — P0 : 4 · P1 : 4 · P2 : 7 — charge indicative 11,5–31 j.

Au 17/10/2026 : 11 livrés (✅ PRD-01, PRD-02, PRD-03, PRD-04, PRD-05, PRD-06, PRD-07, PRD-08, PRD-09, PRD-11, PRD-15) · 2 partiels (◐ PRD-12, PRD-13) — reste 4 éléments ouverts (C1 : 4), charge indicative 3,5–10 j.

| Réf | Élément | Priorité | Taille | Dépend de | Classe |
|---|---|:-:|:-:|---|:-:|
| PRD-01 | ✅ Hébergement et empaquetage | **P0** | M | — | — |
| PRD-02 | ✅ Sauvegarde, restauration et chiffrement | **P0** | M | — | — |
| PRD-03 | ✅ Mode démonstration explicite (VIGIE_DEMO) | **P0** | S | — | — |
| PRD-04 | ✅ Base de production sans jeu de démonstration | **P0** | M | — | — |
| PRD-05 | ✅ PGlite ou PostgreSQL | **P1** | M | — | — |
| PRD-06 | ✅ Règles et tests de migration | **P1** | M | — | — |
| PRD-07 | ✅ URL publique des QR codes | **P1** | S | — | — |
| PRD-12 | ◐ Tâches planifiées | **P1** | M | — (livré avec ACT-33) | C1 |
| PRD-08 | ✅ Numéros de référence sûrs | P2 | S | ACT-35 | — |
| PRD-09 | ✅ Configuration centralisée | P2 | S | — | — |
| PRD-10 | Journalisation serveur | P2 | S | — | C1 |
| PRD-11 | ✅ Supervision et santé | P2 | S | — | — |
| PRD-13 | ◐ Stockage des pièces jointes | P2 | M | — | C1 |
| PRD-14 | Application Mac client du serveur | P2 | M | — | C1 |
| PRD-15 | ✅ Documentation d'exploitation | P2 | S | — | — |

- **PRD-01** — Sortie standalone, HTTPS, volume persistant pour la base et les pièces jointes ; aujourd'hui seul le serveur local du Mac existe. (preuve : next.config.ts:3-7 (pas d'output standalone) ; package.json:6-9 (seuls next dev/start --port 3200) ; aucun Dockerfile ni compose dans le dépôt ; src/db/index.ts:20,23 et src/lib/uploads.ts:12 (base, dossier drizzle/ et pièces résolus depuis process.cwd()) ; src/app/actions.ts:13,18 (cookies sans secure/httpOnly) ; desktop-app/README.md:99 (serveur limité à ::1, « Vigie n'a pas d'authentification »))
  ✅ **Livré (11/10/2026)** — Sortie `standalone` (`VIGIE_STANDALONE=1`), `Dockerfile` multi-étapes (utilisateur non root, `HEALTHCHECK` sur `/api/sante`, outil `vigie-db` embarqué), `docker-compose.yml` (Vigie, PostgreSQL 16, volumes base, pièces jointes et sauvegardes ; HTTPS par reverse proxy ou profil Caddy `https`), chemins de données absolus hors du dossier de l'application ; installation : `docs/EXPLOITATION.md`. Réserves : l'image fige à sa construction les origines admises des server actions (le proxy doit transmettre `Host` ou `X-Forwarded-Host`) ; connexion Entra non éprouvée dans le conteneur.
- **PRD-02** — Sauvegarde de la base et des fichiers (avant chaque migration), procédure de restauration, pièces jointes chiffrées au repos. (preuve : src/db/index.ts:19-24 (PGlite sur disque local, migration au démarrage sans sauvegarde préalable) ; src/lib/uploads.ts:12,28-30 (fichiers écrits en clair dans .data/uploads) ; package.json:13 (seul script : db:reset = rm -rf .data) ; aucun script de sauvegarde ou de restauration dans scripts/)
  ✅ **Réserve levée (12/10/2026)** — restauration et essai de migration : archive en clair refusée quand `VIGIE_UPLOAD_KEY` est définie, sauf `--accepter-clair` ; empreinte SHA-256 de chaque pièce jointe dans le manifeste, contrôlée (pièce manquante, en double, non déclarée ou modifiée) ; PGlite : copie ouverte en mémoire d'abord, base actuelle sauvegardée, dossier vidé et rechargé sur place (plus d'`EBUSY` dans l'image), remis en état en cas d'échec ; `VIGIE_UPLOAD_DIR` et `VIGIE_BACKUP_DIR` refusés dans `VIGIE_DATA_DIR` (au démarrage et à la restauration).
  ✅ **Livré (11/10/2026)** — `npm run db:backup` / `db:restore` / `db:list` (`scripts/vigie-db.ts`, `vigie-db` dans l'image) : `pg_dump -Fc` ou `dumpDataDir` (PGlite), archive des pièces jointes, manifeste horodaté, chiffrement de l'archive ; sauvegarde automatique avant toute migration en attente (`VIGIE_BACKUP_BEFORE_MIGRATE`) ; pièces jointes chiffrées au repos (AES-256-GCM, `VIGIE_UPLOAD_KEY`, rotation par `VIGIE_UPLOAD_KEY_PREVIOUS`, `npm run uploads:encrypt`). Réserves : une archive en clair est restaurée même quand une clé est configurée (pièces jointes vérifiées par leur nombre seulement, `src/db/backup.ts`) ; `restore --remplacer` d'une base PGlite échoue dans l'image Docker (`/data/pglite` est un point de montage, `EBUSY`) ; les sauvegardes emportent la table `report_rate_limits` (voir EVT-07).
- **PRD-03** — setRole, VIGIE_TODAY et le sélecteur de rôle ne doivent fonctionner qu'avec VIGIE_DEMO activé. (preuve : src/app/actions.ts:11-15 (setRole sans contrôle d'environnement) ; src/components/Sidebar.tsx:103-124 (sélecteur de rôle toujours affiché) ; src/lib/dates.ts:9-11 (VIGIE_TODAY honoré partout, sans validation) ; .env.example:6 (VIGIE_TODAY=2026-10-09 renseigné par défaut) ; src/lib/domain.ts:272 (DEFAULT_ROLE = Animateur QHSE sans cookie))
  ✅ **Livré (11/10/2026)** — `VIGIE_DEMO=1` (posé par `npm run dev`, `npm run start:demo` et l'application Mac, `VIGIE_DESKTOP=1`) active seul le sélecteur de rôle, `setRole`, `VIGIE_TODAY` (validée, refusée hors démonstration), le jeu de démonstration et `/apercu-mobile` ; hors démonstration, connexion Entra obligatoire, jamais de rôle par défaut (`src/lib/env.ts`, `src/lib/auth/demo.ts`).
- **PRD-04** — Seed conditionnel (démo seulement) et suppression des dépendances aux personnes du seed (ROLES.personId, QHSE_LEAD). (preuve : src/db/index.ts:24 (seed à chaque ouverture) ; src/db/seed.ts:329-331 (toute base vide reçoit le jeu de démonstration) ; src/lib/domain.ts:264-269,302 (ROLES.personId et QHSE_LEAD = identifiants du seed) ; src/lib/session.ts:28 (people.find(...)! : plantage si ces personnes n'existent pas) ; src/lib/data/actions.ts:303, audits.ts:272-282, risks.ts:486-487 (QHSE_LEAD propriétaire des alertes))
  ✅ **Livré (11/10/2026)** — Jeu de démonstration chargé en démonstration seulement ; `ROLES.personId` et `QHSE_LEAD` remplacés par `src/lib/demo.ts` et `loadQhseLeads()` ; base de production vide : écran « Créer le premier site » (direction, animateur QHSE, `src/components/Bootstrap.tsx`) ; écrans testés sur une base sans site ni personne (`test/integration/bootstrap.test.ts`).
- **PRD-05** — Une seule instance PGlite par processus et un seul serveur sur la base : décider du moteur de production. (preuve : src/db/index.ts:4-6,16-34 (instance PGlite unique par processus) ; src/db/seed.ts:3 et src/db/seeds/types.ts (type PgliteDatabase) ; desktop-app/README.md:52-57,101 (contrainte d'un seul serveur sur la base))
  ✅ **Livré (11/10/2026)** — Tranché : PostgreSQL en production (`DATABASE_URL`, `node-postgres`), PGlite en démonstration et sur le Mac ; type commun `Db` / `Tx` (`src/db/types.ts`), migrations par le migrator du moteur ; suite d'intégration exécutée sur les deux moteurs (`TEST_DATABASE_URL`).
- **PRD-06** — Ne plus modifier une migration publiée (0002 l'a été à la main) ; tester les migrations sur une copie de base avant déploiement. (preuve : src/db/index.ts:23 (migrate au démarrage, sans sauvegarde ni test préalable) ; drizzle/0002_traceability.sql et drizzle/meta/0002_snapshot.json (modifiés à la main au dernier run) ; package.json:5-14 (aucun script de test) ; pas de dossier .github ni de fichier \*.test.\* ; README.md:12 (db:reset recommandé après une modification du schéma))
  ✅ **Réserve levée (12/10/2026)** — base migrée par une version plus récente de Vigie refusée avant toute sauvegarde, migration ou chargement (`NewerDatabaseError`, `/api/sante` en 503).
  ✅ **Livré (11/10/2026)** — Règle « une migration publiée ne se modifie jamais » (CLAUDE.md) ; `drizzle/checksums.json` et `npm run db:check` (empreintes, journal, `drizzle-kit check`, écart schéma/migrations, application à une base vide) ; `npm run db:test-migrate <sauvegarde>` ; en CI. Réserve : une base migrée par une version plus récente n'est pas refusée au démarrage (`MigrationState.newer` calculé mais inutilisé, `src/db/migrations.ts`).
- **PRD-07** — Les QR codes dépendent de l'en-tête Host (repli localhost) : fixer VIGIE_PUBLIC_URL. (preuve : src/lib/data/events.ts:294-299 (appOrigin d'après x-forwarded-host/host, repli http://localhost:3200) ; utilisé par src/app/signaler/postes/page.tsx:19 et src/app/(app)/apercu-mobile/page.tsx:31)
  ✅ **Livré (11/10/2026)** — URL des QR codes tirée de `VIGIE_PUBLIC_URL` (`publicOrigin()`, `src/lib/public-url.ts`), jamais de l'en-tête Host ; repli sur l'origine locale en démonstration.
- **PRD-08** — Les références (A-n, PP-, etc.) sont calculées par max + 1 hors transaction : risque de doublon en écritures simultanées. (preuve : src/server/plan.ts:128-131 (A-n hors transaction) ; src/server/prevention.ts:78,227-228,542-543 ; src/server/documents.ts:112-114 ; src/server/environment.ts:209-211 ; src/server/audits.ts:99-102 ; src/server/pp-import.ts:502-504 ; à l'inverse src/server/events.ts:344-345 calcule dans la transaction ; src/lib/forms.ts:89-92 (nextRef))
  **À revoir avec ACT-35 (15/10/2026)** — la numérotation sûre des actions est traitée par ACT-35 (compteur sous verrou, jamais réattribué) ; restent les autres références (EE-, PP-, permis, documents, FD-, cert-), à passer au même mécanisme.
  ◐ **Partiel (15/10/2026, paquet 1)** — livré : numérotation des actions sous verrou, jamais réattribuée (ACT-35). Reste : les autres références (PP-, EE-, permis, documents, FD-, cert-).
  ✅ **Livré (17/10/2026, paquet 2)** — `nextEntityReference` (`src/server/references.ts`) : compteur par préfixe dans la table de numérotation `action_counters` (portée « ref:<préfixe> », sans migration), upsert verrouillant dans la transaction de création, toujours au-delà des références existantes et journalisées (fiche supprimée : jamais réattribuée) ; entreprises (EE-), plans (PP-), permis, documents (référence automatique), filières (FD-), référentiels (cert-) et événements (EV-, signalement terrain compris). Réserve : l'import d'un plan de prévention réserve sa référence avant d'enregistrer le fichier source (référence perdue, jamais réattribuée, si la création échoue). `nextRef` ne sert plus qu'à l'aperçu de la référence proposée d'un document.
- **PRD-09** — Variables d'environnement lues et validées en un seul module (zod). (preuve : src/lib/dates.ts:10 (VIGIE_TODAY renvoyé tel quel) ; src/db/index.ts:20 (VIGIE_DATA_DIR) ; src/lib/uploads.ts:12 (VIGIE_UPLOAD_DIR) ; src/lib/pp-import/ai.ts:20-34 (VIGIE_AI_IMPORT, ANTHROPIC_API_KEY) ; package.json:25 (zod disponible))
  ✅ **Livré (11/10/2026)** — `src/lib/env.ts` (zod, seule lecture de `process.env`, erreurs explicites au démarrage par `src/instrumentation.ts`) et `src/lib/config.ts` côté application ; `.env.example` réécrit (production, Docker Compose, démonstration).
- **PRD-10** — Erreurs serveur journalisées avec leur référence (instrumentation.ts). (preuve : src/app/(app)/error.tsx:8,17-19 et src/app/error.tsx:8,19 (référence affichée, console.error côté client seulement) ; aucun src/instrumentation.ts ; les console.error serveur se limitent à src/server/pp-import.ts:118-540)
- **PRD-11** — Route /api/sante contrôlant aussi la base. (preuve : pas de dossier src/app/api ; seule route handler : src/app/fichiers/[id]/route.ts ; desktop-app/README.md:43 (sonde /_next/static/vigie-desktop-probe, sans contrôle de la base))
  ✅ **Livré (11/10/2026)** — `/api/sante` interroge la base (200 ou 503, sans détail interne), ouverte sans session ; `HEALTHCHECK` de l'image et sonde de la CI.
- **PRD-12** — Calculer les échéances hors requête utilisateur (prérequis des notifications sortantes et des purges). (preuve : src/lib/data/todo.ts:22-37 (échéances calculées seulement dans une requête, via getSession et le site sélectionné) ; src/lib/data/notifications.ts:13-35 (notifications dans l'application uniquement) ; aucune bibliothèque d'envoi d'e-mail ni planificateur dans package.json:15-30)
  **À revoir avec ACT-33 (15/10/2026)** — prérequis du rappel du mercredi par e-mail, à livrer avec lui : priorité relevée en P1 ; une seule exécution par tâche même avec plusieurs instances (verrou ou journal en base).
  ◐ **Partiel (15/10/2026, paquet 1)** — livré : planificateur `src/db/scheduler.ts` (registre de tâches construit à l'ouverture de la base, `VIGIE_SCHEDULER`, une exécution par tâche et par personne grâce au journal `action_reminder_sends`), requête sans session des actions d'une personne pour le rappel. Reste : échéances de `todo.ts` encore calculées dans une requête (session, site sélectionné), autres tâches planifiées (purges TDB-10, INT-04).
- **PRD-13** — Dossier persistant hors cwd, type réel du fichier, nettoyage des orphelins si l'insertion échoue. (preuve : src/lib/uploads.ts:12 (dossier relatif à cwd) ; src/lib/uploads.ts:17-20 (type MIME déclaré par le client) ; src/lib/uploads.ts:24-36 (writeFile puis insert, sans transaction ni nettoyage en cas d'échec) ; src/server/events.ts:526 (photos enregistrées après la création de l'événement))
  ◐ **Partiel (11/10/2026)** — livré : dossier persistant absolu hors du dossier de l'application (`VIGIE_UPLOAD_DIR`), chiffrement au repos (PRD-02). Reste : type réel du fichier (octets) et nettoyage des fichiers orphelins si l'insertion échoue.
- **PRD-14** — L'application Mac doit pouvoir ouvrir l'URL du serveur central au lieu de localhost:3200. (preuve : desktop-app/Sources/AppConfig.swift:41-42 (baseURL et probeURL figées sur localhost:3200) ; desktop-app/Sources/AppConfig.swift:46-52 (isAppURL : seuls localhost, 127.0.0.1 et ::1 sur le port 3200) ; desktop-app/README.md:99)
- **PRD-15** — Procédures d'installation, sauvegarde, mise à jour et restauration. (preuve : README.md:5-12 (démarrage dev et db:reset seulement) ; README.md:29 (« suppression des risques », périmé) ; aucune section exploitation, sauvegarde ou mise à jour ; .env.example présent mais orienté démonstration (VIGIE_TODAY renseigné à la ligne 6))
  ✅ **Livré (11/10/2026)** — `docs/EXPLOITATION.md` : installation (Docker Compose ou Node.js), inscription Entra ID, configuration, reverse proxy, sauvegarde et restauration, mise à jour, rotation des secrets, supervision.

## 15. Sécurité et RGPD (SEC)

14 éléments — P0 : 3 · P1 : 3 · P2 : 6 · P3 : 2 — charge indicative 15–44 j.

Au 17/10/2026 : 8 livrés (✅ SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-11, SEC-14) · 2 partiels (◐ SEC-07, SEC-09) — reste 6 éléments ouverts (C1 : 4 · C3 : 2), charge indicative 7–21 j.

| Réf | Élément | Priorité | Taille | Dépend de | Classe |
|---|---|:-:|:-:|---|:-:|
| SEC-01 | ✅ Authentification Microsoft Entra ID | **P0** | L | Tenant Entra | — |
| SEC-02 | ✅ Rôles et périmètre de sites depuis Entra | **P0** | M | Entra ID | — |
| SEC-03 | ✅ Identifiants stables sur la fiche personne | **P0** | S | — | — |
| SEC-04 | ✅ Contrôle de l'hôte (DNS rebinding) | **P1** | S | — | — |
| SEC-05 | ✅ En-têtes HTTP et cookies | **P1** | S | — | — |
| SEC-06 | ✅ Données de santé des AT restreintes | **P1** | M | — | — |
| SEC-07 | ◐ Limitation de débit et quotas | P2 | M | — | C1 |
| SEC-08 | Validation et service des pièces jointes | P2 | M | — | C1 |
| SEC-09 | ◐ Anonymat des signalements côté serveur | P2 | S | — | C1 |
| SEC-10 | Registre des traitements et durées de conservation | P2 | L | DPO | C3 |
| SEC-11 | ✅ Consultations tracées | P2 | M | — | — |
| SEC-12 | Mentions d'information RGPD | P2 | S | — | C3 |
| SEC-13 | Droits d'accès d'un salarié | P3 | M | — | C1 |
| SEC-14 | ✅ Redirection 307 avant le streaming | P3 | S | — | — |

- **SEC-01** — OIDC, session signée, contrôle dans proxy.ts, retrait de setRole. (preuve : src/lib/session.ts:12-18 (rôle lu dans un cookie, sinon rôle par défaut) ; src/lib/domain.ts:272 (DEFAULT_ROLE = 'Animateur QHSE') ; src/app/actions.ts:11-15 (setRole accessible à tous) ; pas de src/proxy.ts ; package.json:14-29 (aucune dépendance OIDC/MSAL/Auth.js))
  ✅ **Réserve levée (12/10/2026)** — première connexion : rapprochement ou création de fiche seulement par l'adresse de la revendication `email` vérifiée (`xms_edov`) et d'un domaine de `VIGIE_EMAIL_DOMAINS`, sinon page « Compte Microsoft non rattaché », sans rien écrire ; une adresse non vérifiée ne remplace jamais celle de la fiche.
  ✅ **Livré (11/10/2026)** — OIDC code + PKCE avec `openid-client` (`/auth/connexion`, `/auth/retour`, `/auth/deconnexion`), session dans un cookie chiffré et signé (`jose`, `VIGIE_SESSION_SECRET`, 8 h glissantes, 12 h au plus), `src/proxy.ts` : connexion exigée hors routes publiques, `setRole` réservé à la démonstration ; éprouvé avec un fournisseur factice (`scripts/oidc-mock.mjs`, `scripts/e2e-auth.sh` : 68 contrôles). Réserves : rôle et groupes relus à la connexion suivante (12 h au plus) ; signature JWS du jeton d'identité non vérifiée (canal TLS jugé suffisant, `enableNonRepudiationChecks` non appelé dans `src/lib/auth/oidc.ts`) ; à la première connexion, la fiche est rapprochée par `email`, `preferred_username` ou `upn`, revendications modifiables et non vérifiées pour un invité (n'accepter l'e-mail que si `xms_edov` le garantit, domaines configurés) ; inscription dans le tenant réel à faire (`docs/EXPLOITATION.md` § 3).
- **SEC-02** — Rôle et sites autorisés tirés d'Entra ; site par défaut = site de rattachement ; setSite limité au périmètre. (preuve : src/lib/domain.ts:264-272 (ROLES → personId en dur) ; src/lib/session.ts:28-33 (utilisateur déduit du rôle, site lu dans un cookie, sinon premier site actif, sans tenir compte du site de rattachement) ; src/app/actions.ts:17-19 (setSite sans contrôle du périmètre) ; src/lib/guard.ts:32-37 (requireInSite contrôle le site sélectionné, pas les sites autorisés à l'utilisateur))
  **À revoir avec ACT-20 (15/10/2026)** — la réserve sur « Tous les sites », proposé à tort par « Créer l'action », sera levée par ACT-20 (site unique).
  ✅ **Réserve levée (12/10/2026)** — listes de sites des formulaires limitées au périmètre (`writableSites()`, `options.allSites`) ; `loadLinkedAction` traite une action hors périmètre comme introuvable. Réserve : « Créer l'action » (`ActionFormDialog`) propose « Tous les sites » quand les options de l'écran ne portent pas `allSites` (risques, veille, habilitations, prévention, environnement, documents) ; un chef de service restreint se le voit ensuite refuser par `saveAction`. Voir aussi la réserve d'**AUD-04**.
  ✅ **Livré (11/10/2026)** — Rôles applicatifs Entra (`Vigie.Direction`… surchargeables par `ENTRA_ROLE_*`, le plus élevé l'emporte ; aucun : « Accès non autorisé ») ; périmètre : tous les sites pour la direction et l'animateur QHSE, sinon site de rattachement + `VIGIE_SITE_GROUPS` ; site par défaut = site de rattachement ; `setSite`, `requireInSite` et `/fichiers` refusent un site hors périmètre. Réserves : au-delà de la limite de groupes du jeton (overage), les sites accordés par groupe sont ignorés (pas d'appel Microsoft Graph) ; le site de rattachement est aussi scellé dans la session, si bien qu'une personne mutée garde son ancien site jusqu'à 12 h (`src/lib/auth/person.ts`) ; les listes de sites des formulaires ignorent le périmètre (**EVT-23**, `src/lib/data/options.ts`, `loadLinkedAction`).
  **Réserve levée (15/10/2026)** — « Tous les sites » n'est plus proposé par « Créer l'action » (site unique, ACT-20).
- **SEC-03** — Ajouter objectId Entra, e-mail et matricule ; ne plus dédoublonner ni identifier par le nom. (preuve : src/db/schema.ts:25-39 (people : id, nom, poste, site, aucun e-mail, objectId ni matricule) ; src/server/skills.ts:283 (doublon détecté par le nom) ; src/server/skills.ts:302 (identifiant tiré du nom : uniqueId(personSlug(name))))
  ✅ **Réserve levée (12/10/2026)** — rapprochement par e-mail seulement sur adresse vérifiée d'un domaine de l'entreprise (voir SEC-01).
  ✅ **Livré (11/10/2026)** — `people.entra_object_id` (unique), `email` (unique sans tenir compte de la casse), `matricule` (unique), `last_role`, `last_login_at` (migration `drizzle/0003_production.sql`) ; identifiant généré, plus de dédoublonnage par le nom ; à la connexion : rapprochement par objectId, sinon par e-mail, sinon création de la fiche (`src/lib/auth/person.ts`). Réserve : le rapprochement par e-mail se fie à des revendications modifiables (voir SEC-01).
- **SEC-04** — Refuser les hôtes inconnus dans proxy.ts et restreindre serverActions.allowedOrigins. (preuve : pas de src/proxy.ts ; next.config.ts:3-7 (aucune liste d'hôtes ni serverActions.allowedOrigins) ; src/app/fichiers/[id]/route.ts:5-9 (droit déduit du seul cookie de rôle) ; src/lib/domain.ts:272 (sans cookie, rôle Animateur QHSE) ; desktop-app/README.md:99 (« Vigie n'a pas d'authentification »))
  ✅ **Livré (11/10/2026)** — `src/proxy.ts` refuse (400) tout hôte hors `VIGIE_ALLOWED_HOSTS` et l'hôte de `VIGIE_PUBLIC_URL` (en-têtes `Host` et `X-Forwarded-Host` ; localhost admis en démonstration et pour `/api/sante`) ; `serverActions.allowedOrigins` restreint.
- **SEC-05** — CSP, HSTS, poweredByHeader: false ; cookies httpOnly et secure. (preuve : next.config.ts:3-7 (ni headers() ni poweredByHeader: false) ; src/app/actions.ts:13 et 18 (cookies sans httpOnly ni secure) ; src/app/fichiers/[id]/route.ts:16 (seul en-tête de sécurité présent, nosniff))
  ✅ **Réserve levée (12/10/2026)** — hors démonstration, `VIGIE_PUBLIC_URL` doit être en `https://` (`http://` admis pour localhost seulement).
  ✅ **Livré (11/10/2026)** — `poweredByHeader: false` ; CSP à nonce (`frame-ancestors 'none'`), HSTS en HTTPS, `Referrer-Policy`, `Permissions-Policy` (caméra pour le signalement), `nosniff` (`src/proxy.ts`, `src/lib/security.ts`) ; cookies `httpOnly`, `SameSite=Lax`, `Secure` et préfixe `__Host-` en HTTPS. Réserve : hors démonstration, `VIGIE_PUBLIC_URL` accepte encore une adresse `http://` autre que localhost, et le cookie de session part alors sans `Secure` (`src/lib/env.ts`) : exiger `https://`.
- **SEC-06** — Blessure, jours perdus et déclaration CPAM visibles par tout rôle qui voit les événements : les limiter aux rôles habilités. (preuve : src/app/(app)/evenements/page.tsx:300-301 (blessure, jours perdus et déclaration CPAM affichés à tout rôle qui voit les événements) ; src/app/(app)/evenements/page.tsx:47-50 (seul le Salarié est filtré) ; src/db/schema.ts:92-95 (injury, lostDays, cpamDeclaredOn))
  ✅ **Livré (12/10/2026)** — blessure, jours perdus, déclaration CPAM et données médicales réservés à la direction et à l'animateur QHSE (`canSeeHealth`, `HEALTH_LABELS`) ; lot 2 : nature et siège des lésions, soins et réserves en champs restreints (**EVT-01**), pièces jointes médicales (`attachments.health`, refusées par `/fichiers`, reclassement « médical » sans retour), aide de saisie et avertissement sur l'intitulé et la description d'un AT, intitulé neutre « Accident · lieu » pour un signalement terrain ; nom d'une pièce reclassée médicale retiré du journal des autres rôles. Réserves : KPI « Jours sans accident avec arrêt » et pyramide conservés (agrégats, décision du lot 2) ; `/fichiers` sert toute pièce, médicale comprise, avec `Cache-Control: private, max-age=3600` et la déconnexion ne vide pas le cache du navigateur (poste partagé) ; voir aussi les réserves d'**EVT-01**.
- **SEC-07** — Limites par utilisateur et par période sur le signalement, les fichiers et l'import IA. (preuve : src/server/events.ts:475-494 (createReport : contrôles par requête seulement, aucune limite par utilisateur ou par période) ; src/server/pp-import.ts:79 (seule la limite côté Anthropic est gérée) ; src/lib/uploads.ts:17-21 (pas de quota de stockage))
  ◐ **Partiel (11/10/2026)** — livré : limite de débit du signalement sans compte (par client et par poste, en base, EVT-07). Reste : limites par utilisateur connecté (signalement, fichiers, import IA) et quotas de stockage.
- **SEC-08** — Contrôle des octets réels (magic bytes) et antivirus ; types Office anciens à reconsidérer. (preuve : src/lib/uploads.ts:10 (liste blanche de types MIME, dont application/msword et vnd.ms-excel) ; src/lib/uploads.ts:17-21 (contrôle fondé sur file.type déclaré, ni octets réels ni antivirus) ; src/lib/uploads.ts:33 (type MIME et nom de fichier client enregistrés tels quels) ; src/app/fichiers/[id]/route.ts:12-14)
- **SEC-09** — Retirer EXIF et noms de fichiers d'origine côté serveur pour les signalements anonymes. (preuve : src/server/events.ts:489-494 (aucun nettoyage des métadonnées côté serveur) ; src/server/events.ts:520-526 (saveUpload garde fichier et nom d'origine, seul uploadedBy est mis à null) ; src/components/ReportForm.tsx:37-58 (EXIF retiré seulement côté client, base du nom de fichier conservée))
  ◐ **Partiel (12/10/2026)** — livré : signalement anonyme : canal neutre (`reported_via = 'terrain'`), photos renommées « photo-n » côté navigateur et côté serveur (`anonymousPhoto`, `src/lib/report-guard.ts`). Reste : retrait des métadonnées EXIF côté serveur (seulement côté navigateur aujourd'hui).
- **SEC-10** — Durées de conservation par donnée, purge et anonymisation (salariés sortis, AT). (preuve : src/lib/data/risks.ts:17-18 (seul le DUERP a une durée, un simple libellé) ; src/db/schema.ts:35-38 (salarié sorti conservé sans limite) ; src/db/schema.ts:92-95 (données AT sans durée de conservation) ; aucun job ni action de purge ou d'anonymisation dans src/server)
- **SEC-11** — Journal des accès aux données sensibles et aux fichiers, en plus des modifications. (preuve : src/app/fichiers/[id]/route.ts:5-18 (aucune trace de consultation) ; src/db/schema.ts:634-644 (change_log limité aux modifications) ; src/app/(app)/evenements/page.tsx:66 (seul le journal des modifications est chargé))
  ✅ **Livré (17/10/2026, paquet 3)** — journal des consultations (`access_log`, migration `0006`, distinct de `change_log`) : toute pièce servie par `/fichiers` (pièce médicale marquée), fiche d'un AT ouverte avec ses données de santé, registre des accidents bénins ouvert ; une entrée par personne, nature et élément sur 10 min (`logAccess`, `src/server/access-log.ts`, jamais bloquant). Bloc « Consultations » de la fiche événement pour les rôles habilités aux données de santé (`loadEventAccesses`). Pièce médicale servie sans cache (`no-store`, réserve SEC-06 levée). Réserves : durée de conservation et purge à fixer avec le DPO (SEC-10) ; pas de vue d'ensemble des consultations (requête en base) ; consultations des autres écrans non tracées.
- **SEC-12** — Mentions de l'article 13 sur le signalement et la fiche salarié. (preuve : src/components/ReportForm.tsx:298-301 (option d'anonymat sans mention d'information) ; src/components/skills/PersonForm.tsx:100 ; aucune occurrence de « RGPD », « CNIL » ou « données personnelles » sous forme de mention dans src)
- **SEC-13** — Vue par personne de toutes ses données pour répondre à une demande d'accès. (preuve : src/lib/data/skills.ts:229-234 (vue limitée à soi, sur la matrice seulement) ; src/app/(app)/evenements/page.tsx:47-50 ; src/lib/data/actions.ts:234 (filtres « mes données » éparpillés, sans fiche par personne))
- **SEC-14** — Les gardes redirigent pendant le rendu, après envoi du squelette : faire la redirection dans proxy.ts. (preuve : src/lib/guard.ts:7-11 (redirect() pendant le rendu) ; src/app/(app)/loading.tsx (squelette envoyé avant la redirection) ; pas de src/proxy.ts pour faire la redirection avant le rendu)
  ✅ **Livré (12/10/2026)** — `src/lib/auth/route-access.ts` : `src/proxy.ts` redirige (307) avant le rendu une page dont l'écran est fermé au rôle, le registre des accidents bénins hors données de santé, `/signaler/postes` hors encadrement, et répond 404 pour `/apercu-mobile` hors démonstration ; `route-access.test.ts` vérifie la table contre les appels `guard()` des pages, qui restent en place.

## 16. Qualité, tests, performance et dette technique (QUA)

28 éléments — P1 : 7 · P2 : 6 · P3 : 15 — charge indicative 28–81 j.

Au 17/10/2026 : 9 livrés (✅ QUA-01, QUA-02, QUA-03, QUA-04, QUA-05, QUA-06, QUA-07, QUA-09, QUA-13) · 5 partiels (◐ QUA-11, QUA-23, QUA-25, QUA-26, QUA-28) — reste 19 éléments ouverts (C1 : 18 · C3 : 1 ; PA : 3), charge indicative 17,5–50 j.

| Réf | Élément | Priorité | Taille | Dépend de | Classe |
|---|---|:-:|:-:|---|:-:|
| QUA-01 | ✅ Intégration continue | **P1** | S | — | — |
| QUA-02 | ✅ typecheck sur un clone neuf | **P1** | S | — | — |
| QUA-03 | ✅ Vitest et tests des règles pures | **P1** | L | — | — |
| QUA-04 | ✅ Tests d'intégration des server actions | **P1** | L | Vitest | — |
| QUA-05 | ✅ Recette des server actions jamais exécutées | **P1** | M | — | — |
| QUA-06 | ✅ Non-régression du cloisonnement Salarié | **P1** | M | — | — |
| QUA-07 | ✅ Corriger addMonths en fin de mois | **P1** | S | — | — |
| QUA-08 | Tests de bout en bout Playwright | P2 | L | — | C1 |
| QUA-09 | ✅ Dates en UTC | P2 | S | — | — |
| QUA-10 | Tests de l'import de plan de prévention | P2 | M | — | C1 · PA |
| QUA-11 | ◐ Historiques à l'ouverture d'une fiche | P2 | M | — | C1 |
| QUA-12 | Modifications simultanées | P2 | M | — | C1 |
| QUA-13 | ✅ README et CLAUDE.md à jour | P2 | S | — | — |
| QUA-14 | Sortir les règles métier des composants | P3 | M | — | C1 |
| QUA-15 | Jeu d'essai des scans | P3 | M | — | C3 · PA |
| QUA-16 | Recette visuelle et contrôle d'accessibilité (axe-core) | P3 | M | — | C1 |
| QUA-17 | Échéances et badges : coût par page | P3 | M | ACT-28 | C1 |
| QUA-18 | requireEditor commun | P3 | S | — | C1 |
| QUA-19 | Factoriser le contrôle des pièces jointes | P3 | S | — | C1 |
| QUA-20 | Dater le jeu de démonstration | P3 | M | — | C1 |
| QUA-21 | Pagination des événements | P3 | M | — | C1 · PA |
| QUA-22 | Motif unifié | P3 | S | — | C1 |
| QUA-23 | ◐ États annulé et archivé | P3 | M | ACT-17 (migration 0005) | C1 |
| QUA-24 | Code mort et knip | P3 | S | ACT-40 (refonte livrée) | C1 |
| QUA-25 | ◐ Helpers mutualisés | P3 | S | — | C1 |
| QUA-26 | ◐ Découper les gros fichiers | P3 | M | — | C1 |
| QUA-27 | AGENTS.md | P3 | S | — | C1 |
| QUA-28 | ◐ Environnement de développement | P3 | S | — | C1 |

- **QUA-01** — Pipeline typecheck, lint et build sur chaque push. (preuve : package.json:5-13 (scripts dev/build/start/lint/typecheck/db:\*, aucun test) ; .github/ absent ; git remote origin = github.com/Yhumiii27/Vigie)
  ✅ **Livré (11/10/2026)** — `.github/workflows/ci.yml` : types, lint, tests PGlite puis PostgreSQL (service `postgres:16`), `db:check`, construction, cloisonnement Salarié sur le serveur construit, image Docker et sonde de santé ; Node de `.nvmrc`. Réserve : pas encore exécutée sur GitHub.
- **QUA-02** — tsc échoue tant que .next/types n'est pas généré : lancer next typegen avant tsc. (preuve : package.json:10 ("typecheck": "tsc --noEmit") ; .gitignore:57 (next-env.d.ts) ; next-env.d.ts:3-4 importe ./.next/types/routes.d.ts ; src/app/(app)/a-faire/page.tsx:14, src/app/fichiers/[id]/route.ts:5 (PageProps/RouteContext générés))
  ✅ **Livré (11/10/2026)** — `npm run typecheck` = `next typegen && tsc --noEmit`.
- **QUA-03** — Tests unitaires des règles des domaines (statuts, échéances, dates, coactivité). (preuve : src/lib/queries.ts:1 (import 'server-only'), :57-77 (actionColumn, controlStatus, skillState) ; src/lib/dates.ts:23-27 ; src/components/prevention/model.ts, src/components/sitemap/coactivity.ts ; package.json:5-13 sans script test)
  ✅ **Livré (11/10/2026)** — Vitest (`npm test`, `vitest.config.mts`) ; tests des règles pures à côté des modules (dates, domaine, requêtes, étapes des événements, prévention, coactivité, habilitations, risques, formulaires, configuration, chiffrement, jetons, sécurité, proxy, authentification).
- **QUA-04** — Server actions testées sur une base PGlite en mémoire (droits, site, journal). (preuve : src/db/index.ts:19-25 (open : PGlite(dir) + migrate + seed), :28-34 (instance globale) ; src/lib/session.ts:14-35 (cookies()) ; src/server/\*.ts (≈125 « export async function »))
  ✅ **Livré (11/10/2026)** — `test/integration/` : base de démonstration neuve par fichier (`freshDemoDatabase()`, `actAs()`, `changeLog()` de `test/helpers.ts`, `next/headers`, `next/cache` et `next/navigation` simulés) ; droits, site, motif et journal ; PGlite en mémoire ou PostgreSQL (`TEST_DATABASE_URL`, une base par fichier) ; 36 fichiers, 268 tests au total.
- **QUA-05** — Les actions prévention et habilitations du dernier lot n'ont jamais été appelées : recette manuelle ou automatisée. (preuve : previous-run.md:235 (actions prévention « not exercised »), :332 (habilitations : « None of the new server actions were called »), :575 (≈20 actions appelées), corrections postérieures « I did not run the app » ; src/server/prevention.ts:260-459 (signPlanEu, recordPlanEeSignature, closePlan, cancelPlan, deletePlan, add/removePlanAttachment) ; src/server/skills.ts:97-422)
  ✅ **Livré (11/10/2026)** — Actions prévention (`signPlanEu`, `recordPlanEeSignature`, `closePlan`, `cancelPlan`, `deletePlan`, pièces jointes) et habilitations exécutées par `test/integration/prevention-actions.test.ts` et `skills-actions.test.ts`.
- **QUA-06** — Vérifier que la charge RSC envoyée au Salarié ne contient que ses données. (preuve : src/lib/uploads.ts:71-110 (canReadAttachment) ; src/lib/data/todo.ts:32-36 (loadVisibleTodo, isMine) ; previous-run.md, section Review fixes « Salarié data leak in the page payload (evenements/page.tsx) »)
  ✅ **Livré (11/10/2026)** — Chargements du Salarié (`test/integration/employee-isolation.test.ts`) et charge RSC des pages sur le serveur construit (`test/e2e/employee-payload.test.ts`, `VIGIE_E2E_URL`, en CI).
- **QUA-07** — addMonths déborde au mois suivant (31/01 + 1 mois = 03/03) : échéances repoussées ; utiliser la version bornée. (preuve : src/lib/dates.ts:23-27 (setUTCMonth sans borne) ; src/server/skills.ts:130 (expiresOn = addMonths(...)) ; src/components/skills/TrainingForm.tsx:26 ; src/lib/data/documents.ts:126 ; src/server/risks.ts:428 ; src/components/watch/period.ts:7-12 (version bornée))
  ✅ **Livré (11/10/2026)** — `addMonths` borné à la fin du mois (31/01 + 1 mois = 28/02 ou 29/02), version unique dans `src/lib/dates.ts` (`src/components/watch/period.ts` supprimé), testée (`src/lib/dates.test.ts`).
- **QUA-08** — Parcours principaux par rôle. (preuve : package.json:32-41 (devDependencies sans @playwright/test) ; src/lib/domain.ts:264-269 (5 rôles et écrans))
  **À revoir avec ACT-40 (15/10/2026)** — commencer par les parcours stables (connexion, signalement, habilitations), puis le plan d'actions une fois la refonte livrée.
- **QUA-09** — Plusieurs dates du jour sont calculées en UTC : un helper parisDay commun. (preuve : src/lib/data/actions.ts:83 (isoDay) ; src/lib/attachments.ts:32 (addedOn) ; src/lib/data/audits.ts:113 ; src/lib/data/review.ts:169,602 ; src/lib/data/sites.ts:23 ; src/components/skills/TitlesManager.tsx:34)
  **À revoir avec ACT-17 (15/10/2026)** — la partie Actions (`src/lib/data/actions.ts`) est réécrite par la refonte : y appliquer le helper ; les autres modules ensuite.
  ◐ **Partiel (15/10/2026, paquet 1)** — livré : `parisDay` (`src/lib/dates.ts`) dans le code des actions. Reste : les autres modules.
  ✅ **Livré (17/10/2026, paquet 2)** — `parisDay` (`src/lib/dates.ts`) pour toute date du jour tirée d'un horodatage : pièces jointes (`addedOn`), annulations des constats, éléments du programme et revues, archivage des sites et des titres de formation, annulation d'un enlèvement ; copies locales remplacées (`src/server/events.ts`, `src/lib/data/events.ts`, risques, veille, documents).
- **QUA-10** — Tests sur les formulaires d'exemple et leurs résultats attendus. (preuve : samples/README.md:5-11 (résultats attendus) ; src/lib/pp-import/pdf-form.ts, docx.ts, mapping.ts ; scripts/pp-samples.mjs)
- **QUA-11** — Les journaux sont chargés pour toute la liste : les charger à l'ouverture de la fiche. (preuve : src/lib/data/actions.ts:149 (loadChangeLogs('action', toutes les actions)) ; src/components/actions/ActionDetail.tsx:287 ; src/lib/data/risks.ts:320, prevention.ts:375-377, audits.ts:98-100, watch.ts:122-123, documents.ts:182)
  **À revoir avec ACT-24 (15/10/2026)** — la fiche action charge son fil de commentaires et son historique à l'ouverture (ACT-24) ; restent les autres écrans (risques, prévention, audits, veille, documents).
  ◐ **Partiel (15/10/2026, paquet 1)** — livré : fil et historique d'une action chargés à l'ouverture de sa fiche. Reste : risques, prévention, audits, veille, documents.
  ◐ **Partiel (17/10/2026, paquet 2)** — livré : historique chargé au premier dépliage (`LazyChangeLog`, server action `loadEntityHistory`, `src/server/history.ts` : écran ouvert au rôle et fiche du site sélectionné) pour les exigences et contrôles (veille), les plans de prévention et les entreprises extérieures ; celui des permis reste chargé avec la liste (date de délivrance, PRV-04). Reste : risques, audits (constats, programme, référentiels), environnement (filières, enlèvements).
- **QUA-12** — Écriture conditionnelle (version ou updatedAt) pour éviter qu'une modification en écrase une autre. (preuve : src/server/events.ts:305 (update events set v where id) ; src/server/events.ts:316-319 (nextEventId) ; src/lib/forms.ts:89-92 (nextRef) ; src/server/risks.ts:39-40 (isUniqueViolation, seul cas traité))
  **À revoir avec ACT-35 (15/10/2026)** — la numérotation des actions passe sous verrou ; le contrôle des modifications simultanées reste à faire partout.
- **QUA-13** — Routes, date de démonstration et conventions (requireInSite, logChange, archivage) à mettre à jour. (preuve : README.md:12 (VIGIE_TODAY=2026-10-06), :24-40 (table des routes incomplète), :29 (« suppression des risques ») ; .env.example:6 ; CLAUDE.md, section Conventions (pas de requireInSite / logChange / archivage) ; src/lib/guard.ts:32, src/server/changelog.ts)
  ✅ **Livré (11/10/2026)** — README (démarrage démonstration et production, routes, vérifications) et CLAUDE.md (configuration, mode démonstration, session et périmètre, `requireInSite`, `logChange`, archivage, migrations, tests) mis à jour.
- **QUA-14** — Le serveur importe des règles depuis src/components : les déplacer dans src/lib/rules. (preuve : src/server/watch.ts:6 et src/lib/data/watch.ts:5 (addMonthsClamped depuis components/watch/period) ; src/server/prevention.ts:11, src/server/sitemap.ts:6-8, src/server/skills.ts:5, src/lib/data/sitemap.ts:5-13, src/lib/action-links.ts:5 (imports @/components))
  **À revoir avec ACT-18 (15/10/2026)** — les règles des actions passent dans le domaine avec ACT-18 ; déplacer les autres domaines après leur éventuelle refonte Power Apps.
- **QUA-15** — Mesurer la précision de l'IA sur des scans et photos. (preuve : samples/ (plan-de-prevention-exemple.pdf/.docx, vierge.pdf seulement) ; samples/README.md (section « Scans et photos ») ; src/lib/pp-import/scan.ts, ai.ts)
- **QUA-16** — Captures d'écran comparées et contrôle d'accessibilité axe-core en trois tailles d'écran. (preuve : package.json:5-13 (aucun script de test visuel ni axe-core) ; design/Vigie.dc.html (maquette de référence))
- **QUA-17** — Les 11 loaders d'échéances tournent à chaque page : filtrage SQL, index, cache. (preuve : src/app/(app)/layout.tsx:8 (loadCounters à chaque page) ; src/lib/data/todo.ts:22-29 (11 loaders) ; src/lib/queries.ts:29-31,40-42 (select complet puis filter inSite))
  **À revoir avec ACT-28 (15/10/2026)** — `loadActionSignals` est réécrit par la refonte (spécification § 15.3) : mesurer et optimiser après.
- **QUA-18** — Sept gardes d'écriture par domaine : un requireEditor fondé sur canEdit. (preuve : src/server/risks.ts:21-35 ; src/server/audits.ts:27-31 ; src/server/review.ts:27-38 ; src/server/watch.ts:21-26 ; src/server/skills.ts:42-45 ; src/server/environment.ts:21-23 ; src/server/documents.ts:67-70 ; src/lib/domain.ts:298-299 (canEdit))
  **À revoir avec ACT-21 (15/10/2026)** — le plan d'actions passe à `requireApprover` ; factoriser les autres domaines sur `canEdit`.
- **QUA-19** — Contrôles de lot de fichiers dupliqués côté serveur et client : checkFileBatch commun. (preuve : src/server/events.ts:426-427,488 ; src/server/plan.ts:164-165 ; src/server/audits.ts:50-51 ; src/server/watch.ts:43-44 ; src/server/skills.ts:53-54 ; src/server/prevention.ts:418 ; src/components/Attachments.tsx:48-51, watch/parts.tsx:17-20, prevention/PlanDialogs.tsx:33-36)
- **QUA-20** — ≈420 dates en dur dans le seed : dates relatives ou date de démonstration figée et documentée. (preuve : src/lib/dates.ts:9-12 (today, VIGIE_TODAY) ; src/db/seed.ts et src/db/seeds/\*.ts (≈420 dates « '20XX-MM-JJ ») ; .env.example:6 (VIGIE_TODAY=2026-10-09) ; decisions.md (« Hors périmètre : … dates relatives du seed »))
  **À revoir avec ACT-19 (15/10/2026)** — le jeu de démonstration des actions est réécrit par la refonte : y passer aux dates relatives (proposition : relatives à la date du jour à l'amorçage, `VIGIE_TODAY` restant possible).
- **QUA-21** — Tous les événements sont chargés puis filtrés en mémoire : filtre SQL et pagination. (preuve : src/lib/queries.ts:29-33 (loadSiteEvents : select from events puis filter inSite) ; src/app/(app)/evenements/page.tsx (aucun slice ni limit))
- **QUA-22** — Saisie et validation du motif (annulation, archivage, réouverture) par formReader.reason partout. (preuve : src/lib/forms.ts:69-74 (reason) ; src/server/plan-ui.ts:101 ; src/server/sites.ts:16,77 ; src/server/watch.ts:35-38 ; src/lib/domain.ts:99-101)
  **À revoir avec ACT-21 (15/10/2026)** — `plan-ui.ts` est réécrit par ACT-21 (abandon et réouverture avec motif) : traiter les autres modules.
- **QUA-23** — La convention d'états n'est qu'un commentaire : contraintes CHECK en base. (preuve : src/db/schema.ts:3-6 (convention en commentaire) ; schema.ts : aucun check() (seuls index l.318 et l.644))
  **À revoir avec ACT-17 (15/10/2026)** — les valeurs d'avancement des actions changent : poser leurs contraintes dans la migration de la refonte (0005) et regrouper les autres dans une même migration.
  ◐ **Partiel (15/10/2026, paquet 1)** — livré : contraintes CHECK des actions (avancement, source, priorité, domaine, nature, niveau de risque, motif de suite) dans 0005. Reste : les autres tables.
- **QUA-24** — Réexports, alias et fonctions inutilisés ; ajouter knip. (preuve : src/components/audits/PrintButton.tsx:1-2 ; src/components/ui.tsx:49 (OutOfScope) ; src/lib/action-links.ts:366 (openActionIds) ; src/lib/pp-import/text.ts:207 (parseDate) ; src/components/documents/meta.ts:34 ; src/lib/domain.ts:100-101,303-304)
  **À revoir avec ACT-40 (15/10/2026)** — à lancer après la refonte, qui retire du code (`kind`, `title`, `origin`, transitions du pilote).
- **QUA-25** — withCurrent (server-only) et nextSort recopiés : les partager. (preuve : src/lib/data/options.ts:1,49-50 (withCurrent, server-only) ; src/components/audits/ProgramTimeline.tsx:205-207 et src/components/ActionFormDialog.tsx:50 (copies inline) ; src/server/audits.ts:33 et src/server/review.ts:42 (nextSort))
  ◐ **Partiel (constaté le 15/10/2026)** — livré : `withCurrent` partagé dans `src/lib/form-options.ts`. Reste : copies en ligne dans `ProgramTimeline.tsx` et `ActionFormDialog.tsx` (ce dernier réécrit par ACT-20), `nextSort` recopié dans `src/server/audits.ts` et `src/server/review.ts`.
- **QUA-26** — Seed et prévention à découper comme les seeds déjà séparés. (preuve : src/db/seed.ts (531 l., 57 Ko) vs src/db/seeds/{documents,environment,prevention,sitemap}.ts ; src/server/prevention.ts (678 l., 42 Ko) ; src/lib/data/prevention.ts (739 l.))
  **À revoir avec ACT-19 (15/10/2026)** — découper le seed avec la réécriture du jeu de démonstration des actions ; la prévention après son formulaire Power Apps.
  ◐ **Partiel (15/10/2026, paquet 1)** — livré : jeu de démonstration des actions dans `src/db/seeds/actions.ts`. Reste : le reste de `seed.ts` et la prévention.
- **QUA-27** — Committer AGENTS.md ou passer par agentRules dans next.config. (preuve : next.config.ts:3-7 (pas d'agentRules) ; node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/agentRules.md ; .gitignore (pas d'AGENTS.md) ; previous-run.md:327,374,577)
- **QUA-28** — Hook de démarrage de session, champ engines et version de Node figée. (preuve : .claude/launch.json (seul fichier) ; package.json:1-42 (pas d'engines) ; absence de .nvmrc / .node-version)
  ◐ **Partiel (11/10/2026)** — livré : champ `engines` (Node ≥ 22) et `.nvmrc`. Reste : hook de démarrage de session.

## 17. UX et accessibilité (UX)

16 éléments — P1 : 3 · P2 : 11 · P3 : 2 — charge indicative 15,5–45 j.

Au 15/10/2026 : 3 livrés (✅ UX-01, UX-02, UX-03) · 2 partiels (◐ UX-06, UX-11) — reste 13 éléments ouverts (C1 : 13 ; PA : 2), charge indicative 13,5–40 j.

| Réf | Élément | Priorité | Taille | Dépend de | Classe |
|---|---|:-:|:-:|---|:-:|
| UX-01 | ✅ Navigation mobile | **P1** | M | — | — |
| UX-02 | ✅ Formulaire terrain : zoom iOS, cibles, dictée | **P1** | S | — | — |
| UX-03 | ✅ Fenêtres modales | **P1** | S | — | — |
| UX-04 | Erreurs de formulaire accessibles | P2 | S | — | C1 |
| UX-05 | Photos : galerie et allègement | P2 | M | — | C1 |
| UX-06 | ◐ Mise en page tablette | P2 | M | ACT-27 (vue des actions) | C1 |
| UX-07 | Liste puis fiche sur petit écran | P2 | M | — | C1 · PA |
| UX-08 | Carte du site tactile | P2 | M | — | C1 |
| UX-09 | Contraste | P2 | M | — | C1 |
| UX-10 | Icônes et infobulles | P2 | M | — | C1 |
| UX-11 | ◐ Structure sémantique et clavier de la coque | P2 | M | — | C1 |
| UX-12 | Uniformiser filtres et liens profonds | P2 | L | — | C1 · PA |
| UX-13 | Élément introuvable partout | P2 | S | — | C1 |
| UX-14 | Retours d'état | P2 | M | — | C1 |
| UX-15 | Dossier de revue sur téléphone | P3 | S | — | C1 |
| UX-16 | Aide en ligne | P3 | M | — | C1 |

- **UX-01** — Barre latérale empilée sur téléphone : tiroir de navigation, cloche à largeur adaptable. (preuve : src/app/vigie.css:194-199 (sidebar en position statique et empilée, pas de tiroir) ; src/app/(app)/layout.tsx:17-19 ; src/components/NotificationBell.tsx:40 (width: 380 fixe) ; src/components/PageHeader.tsx:18 (lien vers /apercu-mobile au lieu de /signaler) ; src/app/(app)/apercu-mobile/page.tsx:39 (IOSDevice width={390}))
  ✅ **Livré (12/10/2026)** — barre supérieure et tiroir de navigation sur téléphone (`AppShell` : reste de la page inaccessible tant qu'il est ouvert, Échap ou fond pour fermer, focus rendu au bouton), `aria-current`, panneau des notifications à la largeur de l'écran, boutons d'en-tête qui passent à la ligne. Réserve : rendu à 375 px et 1 280 px à vérifier dans un navigateur réel ; `/evenements` déborde encore à 375 px (lignes de la liste des événements).
- **UX-02** — Champs à 16 px (zoom iOS), cibles tactiles de 44 px, micro proposé seulement si la dictée est disponible, radiogroup nommé. (preuve : src/components/ReportForm.tsx:235,249 (fontSize 13.5) ; src/app/vigie.css:152 (.vg-form .input 13px) ; src/components/ReportForm.tsx:240 (bouton « Modifier » padding 0), 250-251 (micro 30 px), 279-280 (retrait 26 px), 93-95 (micro sans détection préalable), 290-291 (radiogroup sans aria-label))
  ✅ **Livré (12/10/2026)** — `/signaler` et `ReportForm` : champs en 16 px (pas de zoom iOS), cibles de 44 px, dictée (bouton micro quand le navigateur la propose), retrait d'une photo ; champs des fenêtres en 16 px sur téléphone.
- **UX-03** — Nom accessible, titre sémantique, fermeture au clic extérieur sans perte de saisie. (preuve : src/components/Dialog.tsx:18 (dialog sans aria-labelledby), 25 (titre en div, pas en titre de section), 19 (fermeture sur clic dont la cible est le dialog, sans vérifier le mousedown ni une saisie en cours), 59 (icône du DialogButton sans aria-hidden))
  ✅ **Livré (12/10/2026)** — `Dialog` nommé par son titre (`<h2>`), clic extérieur sans effet si la saisie a commencé ou si l'appui a débuté dans la fenêtre, Échap demande confirmation quand une saisie est en cours, focus sur le premier champ. Réserves : `autoFocus` de React ne pose aucun attribut et ne peut pas orienter ce choix ; le panneau des notifications, fermé par Échap ou par un clic sur une échéance, ne rend pas le focus à la cloche.
- **UX-04** — Erreurs reliées aux champs (aria-describedby) et focus sur la première erreur. (preuve : src/components/form.tsx:59 (span .vg-field-error sans id), 71/76/82 (aria-invalid sans aria-describedby, id={name}), 35-41 (aucun focus sur l'erreur après l'échec) ; src/components/watch/RequirementsPanel.tsx:483 et src/components/audits/ProgramTimeline.tsx:256 (Field sans name))
  **À revoir avec ACT-20 (15/10/2026)** — composant commun : le nouveau formulaire des actions en profitera ; à faire de préférence avant lui ou avec lui.
- **UX-05** — Choix depuis la galerie et réduction/nettoyage EXIF partagés (shrinkPhoto) pour toutes les pièces jointes. (preuve : src/components/ReportForm.tsx:258 (capture="environment"), 38-60 (shrinkPhoto local au composant) ; src/components/Attachments.tsx:44-60 (envoi des fichiers d'origine, sans réduction ni nettoyage EXIF))
  **À revoir avec ACT-25 (15/10/2026)** — utile aux preuves photo du responsable ; à faire avec SEC-09 (EXIF retiré côté serveur).
- **UX-06** — Mises en page 768-1180 px (un seul point de rupture à 760 px aujourd'hui). (preuve : src/app/vigie.css:28-29 (.vg-side width 236px), 194 (seul point de rupture à 760 px) ; src/app/(app)/evenements/page.tsx:97 (minmax(320px) en auto-fit, une seule colonne sous ~946 px) ; src/components/actions/KanbanBoard.tsx:21 (repeat(5, minmax(200px))))
  **À revoir avec ACT-27 (15/10/2026)** — le Kanban des actions passe à six colonnes regroupées au lieu de cinq colonnes de statut ; la vue des actions se traite après ACT-27, les écrans susceptibles d'être refondus après leur formulaire Power Apps.
  ◐ **Partiel (15/10/2026, paquet 1)** — livré : Kanban des actions en six colonnes regroupées, défilement horizontal dans le tableau seulement. Reste : mises en page tablette (768–1 180 px) des écrans.
- **UX-07** — Sur petit écran, la fiche s'affiche sous la liste sans défilement ni retour. (preuve : src/app/(app)/evenements/page.tsx:97 (grille auto-fit, fiche sous la liste), 131 (Link scroll={false} sans défilement vers la fiche ni retour) ; src/app/(app)/risques/page.tsx:107 (gridTemplateColumns 'minmax(200px, 216px) minmax(0, 1fr)' sans repli mobile))
- **UX-08** — Pincement pour zoomer et sélection au toucher. (preuve : src/components/sitemap/MapCanvas.tsx:188-197 (gesture.current mono-pointeur), 200-207 (survol seulement au pointermove) ; src/components/sitemap/sitemap.module.css:10 (touch-action: none) ; boutons de zoom existants en MapCanvas.tsx:535-538)
- **UX-09** — Textes secondaires en neutral-600 (#75798c), parfois en 10 px, à mettre au contraste AA : jeton plus contrasté dans vigie.css (nocturne.css reste intact). (preuve : src/app/nocturne.css:25 (--color-neutral-600 #75798c, à ne pas modifier) ; texte en neutral-600 dans src/app/vigie.css:49 (.vg-eyebrow 10px), 182 ; src/components/Sidebar.tsx:123 ; src/components/actions/ActionDetail.tsx:181 ; src/components/watch/parts.tsx:53 ; src/components/prevention/parts.tsx:79 ; src/components/skills/SkillMatrix.tsx:417 ; src/components/Attachments.tsx:81,121)
- **UX-10** — Icônes décoratives en aria-hidden, boutons à icône seule nommés, infobulles accessibles au clavier. (preuve : &lt;i className="ph …"> sans aria-hidden : src/components/Sidebar.tsx:56,58,88 ; src/components/Dialog.tsx:59 ; src/components/PageHeader.tsx:18 ; src/components/NotificationBell.tsx:32. Bouton à icône seule nommé par title : src/components/risks/UnitDialogs.tsx:74 (label="" + tooltip). Infobulles en title : src/components/NotificationBell.tsx:51, src/components/Sidebar.tsx:103,122)
- **UX-11** — aria-current, menus clavier (aria-haspopup, flèches, focus), régions nommées, lien d'évitement. (preuve : src/components/Sidebar.tsx:87 (pas d'aria-current), 55-78 et 102-121 (menus sans aria-haspopup, gestion du focus ni flèches), 47 et 82 (aside et nav sans aria-label) ; src/app/(app)/layout.tsx:17-19 (pas de lien d'évitement))
  ◐ **Partiel (constaté le 15/10/2026)** — livré avec UX-01 : `aria-current` dans la navigation, barre latérale nommée (`aside aria-label`), `main`. Reste : lien d'évitement, `nav` nommée, menus du site et du rôle au clavier (`aria-haspopup`, flèches, focus).
- **UX-12** — Une convention d'URL unique pour filtres, archives et fiche ouverte. (preuve : src/app/(app)/veille/page.tsx:38-41 (archives=1 / statut=archives) ; src/app/(app)/evenements/page.tsx:85 (etat=classes) ; src/components/documents/DocumentRegister.tsx:38-44 (?doc via history.replaceState) ; src/components/skills/SkillMatrix.tsx:62-69,277-278 (filtres en localStorage, recherche en état local) ; src/lib/data/dashboard.ts:66 (KPI vers type=AT sans filtre d'arrêt))
  **À revoir avec ACT-27 (15/10/2026)** — convention d'URL à reprendre de la vue générale des actions (`?avancement=`, `?responsable=`, `?q=`…), appliquée écran par écran.
- **UX-13** — Bandeau MissingNotice quand un lien profond vise un élément inconnu, au lieu d'un repli silencieux. (preuve : src/lib/data/review.ts:59-65 (pickReview se rabat sur une autre revue) ; src/lib/data/audits.ts:198-203 (?element / ?constat inconnus ignorés) ; src/app/(app)/apercu-mobile/page.tsx:23-29,40-44 (?sel inconnu → liste) ; src/components/documents/DocumentRegister.tsx:48-58 (aucun bandeau pour un ?doc inconnu))
- **UX-14** — Indicateurs d'attente, erreurs et confirmations après enregistrement. (preuve : src/components/Sidebar.tsx:42,64,115 (useTransition sans pending ni gestion d'erreur pour setSite et setRole) ; src/components/form.tsx:35 (fermeture après succès sans confirmation) ; src/components/sitemap/SiteMapScreen.tsx:110,194-209 (enregistrement sans indicateur) ; même schéma en src/components/watch/ControlsPanel.tsx:304, src/components/prevention/PermitDialogs.tsx:255, src/components/review/ReviewPanel.tsx:35)
- **UX-15** — Tableaux du dossier sans conteneur à défilement horizontal. (preuve : src/components/review/DossierView.tsx:106,114,126,185,… (table.rd-table sans conteneur overflow-x) ; src/components/review/dossier-parts.tsx:95 ; src/app/revue-de-direction/dossier.css:35-39,58-63 (rien sur les tableaux en mobile))
- **UX-16** — Glossaire des indicateurs (TF1, TG…) et entrée « Aide ». (preuve : src/lib/data/dashboard.ts:66 (KPI « TF1 · 12 mois glissants » / « TG » sans définition) ; src/components/Sidebar.tsx:97-125 (aucune entrée Aide) ; seule définition existante : src/components/review/DossierView.tsx:93)
  **À revoir avec ACT-29 (15/10/2026)** — glossaire étendu aux taux de la refonte (retard, efficacité, délai de clôture).

## 18. Conformité réglementaire transverse (CNF)

11 éléments — P2 : 6 · P3 : 5 — charge indicative 15–47 j.

Au 18/10/2026 : 2 livrés (✅ CNF-03, CNF-05) — reste 9 éléments ouverts (C1 : 2 · C2 : 5 · C3 : 2 ; PA : 7), charge indicative 13–41 j.

| Réf | Élément | Priorité | Taille | Dépend de | Classe |
|---|---|:-:|:-:|---|:-:|
| CNF-01 | Registre des dangers graves et imminents | P2 | M | — | C2 · PA |
| CNF-02 | Instances CSE / CSSCT | P2 | M | — | C2 |
| CNF-03 | ✅ Bilan annuel SSCT | P2 | M | — | — |
| CNF-04 | Évaluation des fournisseurs | P2 | L | — | C3 · PA |
| CNF-05 | ✅ Contexte et risques du système de management | P2 | M | — | — |
| CNF-06 | Produits chimiques | P2 | L | — | C2 · PA |
| CNF-07 | Satisfaction client | P3 | M | — | C3 · PA |
| CNF-08 | Situations d'urgence | P3 | M | — | C1 · PA |
| CNF-09 | Communication et sensibilisation | P3 | M | — | C2 · PA |
| CNF-10 | EPI | P3 | M | — | C2 · PA |
| CNF-11 | Gestion des changements | P3 | M | — | C1 |

- **CNF-01** — Registre DGI (L. 4131-1 et L. 4132-2) : type d'événement, salariés exposés, représentant du CSE, avis. (preuve : src/lib/domain.ts:14-23 (EVENT_TYPES : AT, PA, SD, NC, RC, ENV, pas de type DGI) ; src/db/schema.ts:73-108 (events sans champs salariés exposés, représentant du CSE ou avis) ; rg « danger grave|imminent|L. 4132 » dans src : aucun résultat)
- **CNF-02** — Réunions, ordres du jour et PV des instances. (preuve : src/db/schema.ts:164 (duerpVersions.cseConsultedOn, seule donnée CSE) ; src/db/schema.ts:388 (reviews.externalParticipants, texte libre) ; aucune table de réunion CSE/CSSCT parmi les pgTable de src/db/schema.ts)
- **CNF-03** — Bilan annuel santé, sécurité et conditions de travail présenté au CSE (L. 2312-27). (preuve : src/components/review/DossierView.tsx:83-552 (sections ISO 9001 §9.3 uniquement, pas de rapport ni de programme SSCT) ; rg « PAPRIPACT|programme annuel de prévention|rapport annuel » dans src : aucun résultat ; src/lib/data/dashboard.ts (TF1/TG calculés sur hoursWorked du seed))
  **À revoir avec ACT-29 (15/10/2026)** — les statistiques de la refonte alimentent le bilan ; TF1/TG restent « — » sans heures travaillées (TDB-03).
  ✅ **Livré (18/10/2026, paquet 5)** — « Bilan SSCT » de l'écran Évaluation des risques (`/risques/bilan-ssct?annee=`, animateur QHSE et direction) : bilan imprimable de l'année (par défaut l'année écoulée, site sélectionné) — accidents du travail, de trajet, d'intérimaires et de personnes extérieures, jours perdus, TF1 / TG, maladies professionnelles, presque-accidents et situations dangereuses ; actions Sécurité et Santé du plan d'après les statistiques d'ACT-29 (ouvertes, vérifiées, efficacité, retard, liste des actions vérifiées) ; versions du DUERP (CSE, SPST) ; programmes annuels de prévention de l'année et de la suivante ; contrôles, plans de prévention, formations. Calculé, jamais stocké ; à compléter par l'employeur avant présentation au CSE.
- **CNF-04** — Fournisseurs comme entité évaluée (ISO 9001 §8.4) au lieu d'une simple origine de NC. (preuve : src/lib/domain.ts:52 (NC_ORIGINS : « Fournisseurs » simple catégorie) ; src/db/schema.ts:91 (events.ncOrigin texte, pas de supplierId) ; src/components/review/DossierView.tsx:178-218 (synthèse existante) ; src/db/schema.ts:430-442 (contractors réservé à la prévention))
- **CNF-05** — Enjeux, parties intéressées, risques et opportunités (ISO 9001 §4.1, §6.1). (preuve : src/components/review/DossierView.tsx:83-552 (sections listées : aucune pour les enjeux, parties intéressées ou risques et opportunités) ; rg « enjeu|parties int|opportunit » dans src : seulement l'aide de ReviewDialogs.tsx:84)
  ✅ **Livré (18/10/2026, paquet 5)** — carte « Contexte, risques et opportunités » de l'écran Audits (`context_items`) : enjeux externes et internes (§4.1), parties intéressées et leurs attentes (§4.2), risques et opportunités avec leur traitement obligatoire (§6.1) ; saisie par l'animateur QHSE et la direction, archivage motivé, historique ; section du dossier de revue (§9.3.2 b et e).
- **CNF-06** — Inventaire des produits, FDS et repérage des CMR. (preuve : src/db/seed.ts:162 (« FDS » en texte libre dans existingMeasures d'un risque) ; aucune table produit chimique ou FDS dans src/db/schema.ts ; rg « CMR » : seulement prevention/model.ts:15 et pp-import/text.ts:32)
- **CNF-07** — Enquêtes de satisfaction en plus du texte libre de la revue. (preuve : src/db/schema.ts:389 (reviews.customerPerception, texte libre) ; src/components/review/ReviewDialogs.tsx:134 ; src/components/review/DossierView.tsx:149-176 (section alimentée par les RC et le texte libre))
- **CNF-08** — Situations d'urgence identifiées et exercices planifiés et tracés. (preuve : src/components/audits/ProgramTimeline.tsx:222 (exercices seulement suggérés comme ligne libre du programme) ; src/lib/domain.ts:167-170 (PLAN_TRACK_KINDS sans type exercice) ; aucune table pour les situations d'urgence dans src/db/schema.ts)
- **CNF-09** — Causeries et quarts d'heure sécurité avec participants. (preuve : src/db/schema.ts:513 (documents.distribution, texte libre) ; src/db/schema.ts:286-319 (trainingTitles et qualifications par personne, pas de session collective) ; rg « causerie|quart d'heure » dans src : aucun résultat)
- **CNF-10** — Dotation des EPI par salarié. (preuve : src/db/seed.ts:214 (« EPI antichute » = contrôle global) ; src/db/schema.ts:232-250 (controls par équipement, pas par salarié) ; design/Vigie.dc.html:745 ; aucune table de dotation EPI)
- **CNF-11** — Demandes de changement maîtrisées (ISO 9001 §8.1.3 / §6.3). (preuve : src/db/schema.ts:634-644 (change_log = journal d'audit des fiches, pas de MOC) ; aucune table de demande de changement dans src/db/schema.ts)

## 19. Questions ouvertes

Décisions et éléments attendus avant ou pendant le développement. Tout élément ouvert de classe C2 (décision) ou C3 (élément attendu) figure ci-dessous avec sa question ; le [§ 2](#2-feuille-de-route-par-classe-de-dépendance) les regroupe par décision et par élément attendu, avec les éléments débloqués.

### Prérequis et arbitrages externes

| Prérequis ou arbitrage | Classe | Éléments concernés |
|---|:-:|---|
| Tenant Microsoft Entra ID (inscription de l'application, rôles applicatifs, groupes de sites, revendications `email` et `xms_edov`) — requis pour la mise en service ; SEC-01, SEC-02, TDB-01 et EVT-07 sont livrés et éprouvés avec un fournisseur factice (`docs/EXPLOITATION.md` § 3) | C4 | INT-11, INT-17, DOC-07 ; recette d'EVT-22 ; ACT-34 par Microsoft Graph |
| Compte d'envoi des e-mails de la messagerie (relais SMTP ou Microsoft Graph `Mail.Send`, informatique) — requis pour le rappel du mercredi par e-mail (décision du 15/10/2026) | C4 | ACT-34, INT-04, PRV-18 |
| API Keystone (projets, affectations, responsables, fournisseurs) | C4 | INT-01, INT-02, INT-05, INT-12, INT-15, VEI-17 ; PRV-20 selon la réponse |
| API Cursus (personnel, formations, effectifs) | C4 | INT-01, INT-03, INT-09, HAB-08, HAB-20, DUE-08, DOC-07 ; HAB-02, EVT-08, HAB-07 selon les réponses |
| Jeton API Trackdéchets (les SIRET des sites sont saisissables depuis DOC-02) | C4 | INT-10 |
| API Légifrance (PISTE) | C4 | INT-16 |
| Hébergement cible et HTTPS (serveur, nom DNS, certificat) — moteur tranché le 11/10/2026 : PostgreSQL, image Docker derrière un reverse proxy HTTPS | C4 | INT-01, INT-17, PRV-18 ; recette d'EVT-20 et de PRD-14 |
| Avis du DPO (conservation, mentions, IA, santé) | C3 | SEC-10, SEC-12, INT-07, QUA-15 ; EVT-28 et HAB-02 (aptitude) si l'avis est demandé |
| Levée des reports (saisie et imports, exports, exigences par poste) | C2 | TDB-03, IMP-01, IMP-02, IMP-03, IMP-05, IMP-06, IMP-08, IMP-09, AUD-32, HAB-07 |
| Règle actuelle de numérotation AC (service QHSE, recherche en cours ; question gardée pour plus tard le 15/10/2026) | C3 | ACT-36, puis ACT-39 |
| Extraction de toutes les actions Power Apps (propriétaire de l'application, fournie plus tard) | C3 | ACT-39 |
| Formulaires Power Apps des autres modules (utilisateur) — non bloquant : chaque formulaire sera spécifié à sa réception | PA | les 145 éléments marqués PA |
| Procédures, modèles et grilles du service QHSE | C3 | PRV-08, PRV-15, DOC-16, DOC-23, CNF-04, CNF-07, QUA-15 |
| Adresse de Keystone en production et forme des liens vers un projet et une affectation (équipe Keystone) | C3 | INT-08 |
| Suivi des consultations CSE (DUE-02 livré avec la date de consultation du programme) | C2 | CNF-02 |

### Refonte des actions QSE : points ouverts

D'après le § 22 de la spécification ([`docs/specs/actions-qse.md`](specs/actions-qse.md)) ; points 3 à 13 et 15 tranchés par le service QHSE le 15/10/2026. « Bloquant » : l'élément cité attend la réponse ; « non » : la proposition de la spécification s'applique par défaut et la réponse peut la corriger sans retarder le développement.

| # | Point | Classe | Auprès de | Bloquant | Élément |
|--:|---|:-:|---|:-:|---|
| 1 | Numérotation AC : compteur annuel ou continu, nombre de chiffres après l'année | C3 | service QHSE (recherche en cours) | oui | ACT-36 |
| 2 | Extraction Power Apps : format, colonnes (site, responsable en e-mail ou en nom), historique des commentaires, pièces jointes | C3 | propriétaire de l'application | oui | ACT-39 |
| 3 | Création d'une action par l'encadrement hors QHSE depuis un écran source — *tranché le 15/10/2026 : QHSE seulement (ACT-22)* | ✅ | responsable produit, service QHSE | tranché | ACT-22 |
| 4 | Consultation du plan par l'encadrement hors QHSE — *tranché le 15/10/2026 : lecture du plan du périmètre (ACT-22)* | ✅ | responsable produit | tranché | ACT-22 |
| 5 | Recyclage enregistré : « Terminée » d'office, ou commentaire et échéance du QHSE — *tranché le 15/10/2026 : aucune action QSE pour un recyclage (ACT-22, ACT-37)* | ✅ | service QHSE | tranché | ACT-22 |
| 6 | Source des actions d'Habilitations, Prévention, Environnement et audits fournisseurs ; sens de « Réserves » et d'« AST-EST » — *tranché le 15/10/2026 : Déchets, Audit fournisseur ; aucune action depuis Habilitations ni Prévention ; sens de « Réserves » et d'« AST-EST » précisés (ACT-37)* | ✅ | service QHSE | tranché | ACT-37 |
| 7 | Correspondance niveau de risque → priorité proposée — *tranché le 15/10/2026 : aucune proposition (ACT-38 sans objet)* | ✅ | service QHSE | tranché | ACT-38 |
| 8 | Statistiques : état à la fin du mois ou actions ouvertes dans le mois ; date cible initiale ou actuelle — *tranché le 15/10/2026 : état à la fin du mois ; dernière date cible (ACT-29)* | ✅ | service QHSE | tranché | ACT-29 |
| 9 | Avertir le QHSE d'un commentaire ou d'une preuve du responsable — *tranché le 15/10/2026 : tous les animateurs QHSE, une notification par commentaire ou preuve (ACT-31)* | ✅ | service QHSE | tranché | ACT-31 |
| 10 | Rattachements complémentaires en plus de la source unique — *tranché le 15/10/2026 : gardés, QHSE seulement (ACT-02)* | ✅ | service QHSE | tranché | ACT-02 |
| 11 | Actions Reportées et Terminées dans le rappel du mercredi (proposition : exclues) — *tranché le 15/10/2026 : Terminées comprises, Reportées exclues* | ✅ | service QHSE | tranché | ACT-32, ACT-33 |
| 12 | Action de suite d'une vérification non efficace sur un événement clos — *tranché le 15/10/2026 : proposition confirmée* | ✅ | service QHSE | tranché | ACT-23 |
| 13 | Indépendance du vérificateur — *tranché le 15/10/2026 : autovérification admise, sans marque* | ✅ | service QHSE | tranché | ACT-23, ACT-13 |
| 14 | Reprise : « En cours » devient « Budgétée ou initiée » ou « 20 % » (bases de démonstration et d'essai) — *proposition appliquée par défaut (paquet 1)* | C2 | responsable produit | non | ACT-19 |
| 15 | Notification quand le QHSE change le responsable d'une action — *tranché le 15/10/2026 : oui (confirmé)* | ✅ | service QHSE | tranché | ACT-30 |
| 16 | Responsables de l'extraction absents de Vigie : créer leur fiche ou refuser la ligne | C2 / C3 | responsable produit, avec l'extraction | oui | ACT-39, INT-03 |
| 17 | Direction comptée dans le « service QHSE » pour les droits sur les actions — *proposition appliquée par défaut (paquet 1)* | C2 | responsable produit | non | ACT-21 |
| 18 | Autres formulaires Power Apps (événements, audits…) : écrans sources et éléments liés susceptibles de changer | C3 | utilisateur | non | ACT-28, éléments PA |
| 19 | Compte d'envoi des e-mails ; heure d'envoi du rappel (proposition : mercredi 7 h) | C4 | informatique | oui (envoi réel) | ACT-34 |

### Paquet 5 (conformité réglementaire) : points appliqués par défaut, à confirmer par le service QHSE

Livré le 18/10/2026. Lecture la plus prudente retenue là où le backlog ne tranchait pas ; non bloquant : la réponse peut corriger la règle sans reprise de données (« non » : proposition appliquée par défaut).

| # | Point à confirmer | Élément | Bloquant |
|--:|---|---|:-:|
| 1 | Une maladie professionnelle est **réservée à l'animateur QHSE et à la direction** dans son ensemble (liste, fiche, échéances, pièces jointes), sans rattachement (risque, équipement, document) et avec l'intitulé imposé « Maladie professionnelle » ; seul son numéro et cet intitulé paraissent dans une action liée. Faut-il ouvrir la fiche (sans les champs de santé) à son pilote d'un autre rôle ? | EVT-09 | non |
| 2 | Délais d'une maladie professionnelle : seul le retour du questionnaire employeur (30 jours francs après réception, R. 461-9 CSS) est suivi ; réserves motivées de l'employeur et consultation du dossier (délais de la caisse) non suivies. À compléter ? | EVT-09 | non |
| 3 | Accident de trajet exclu aussi des « jours sans accident avec arrêt » et de la pyramide (en plus du TF1 / TG), et inscriptible au registre des accidents bénins comme un AT : à confirmer. | EVT-09 | non |
| 4 | Aptitude médicale à la conduite (R. 4323-56) : rien n'est stocké tant que HAB-02 (suivi de l'état de santé : Cursus ou Vigie, avis du DPO) n'est pas tranché ; un titre prérequis vaut dès qu'**au moins un** des titres listés est valide (CACES R484 **ou** R489 pour l'autorisation de conduite). | HAB-10 | oui (aptitude) |
| 5 | Transmission du DUERP au SPST : échéance « à renseigner » dès la mise à jour (aucun délai réglementaire chiffré) ; dépôt sur le portail numérique : date seulement, sans échéance tant que le portail n'est pas ouvert. | DUE-03 | non |
| 6 | Certification : alerte « audit de renouvellement à programmer » à **6 mois** de la fin de validité, fin de validité signalée à 30 jours, certificat refusé au-delà de **3 ans** après son émission (ISO/IEC 17021-1). Délais à confirmer avec l'organisme. | AUD-08 | non |
| 7 | Objectifs QHSE : valeurs calculées sur tout le périmètre de l'objectif (site ou tous les sites), quel que soit le périmètre de la personne qui consulte (agrégats seulement) ; cible « ne pas dépasser » comprise au sens large (TF1 ≤ 4 pour « TF1 < 4 » de la revue) ; liste des dix indicateurs à valider. | AUD-13 | non |
| 8 | Lien vers le texte d'une exigence limité à Légifrance et EUR-Lex (https) ; sites concernés fixés par le périmètre complet seulement (direction, animateur QHSE). | VEI-10 | non |
| 9 | Contrôle défavorable ou mise à l'arrêt : signalé jusqu'à un nouveau contrôle favorable, sans blocage d'autre écran (permis, affectations). | VEI-11 | non |
| 10 | BSD refusé ou accepté partiellement : aucune échéance ; le déchet repris s'inscrit comme un nouvel enlèvement ; taux de valorisation calculé sur la quantité acceptée. | DOC-12 | non |
| 11 | Bilan SSCT : année écoulée par défaut, site sélectionné, actions des domaines Sécurité et Santé ; réservé à l'animateur QHSE et à la direction jusqu'à sa présentation au CSE (accidentologie). | CNF-03 | non |
| 12 | Signataires du plan de prévention : nom et qualité saisis librement (pas une fiche du personnel). | PRV-07 | non |

**Libellés réglementaires à relire à la recette** (non bloquant) : « Maladie professionnelle », « Tableau de maladie professionnelle », « Certificat médical initial du », « Déclaration reçue de la CPAM le », « Questionnaire employeur reçu le / retourné le » et l'aide « À retourner à la caisse sous 30 jours francs (R. 461-9) » ; « Accident de trajet (domicile – travail, ou travail – lieu de repas) » et son aide (L. 411-2) ; la synthèse de la DAT (« rubriques à reporter sur net-entreprises.fr (Cerfa 14463) », « Feuille d'accident du travail · à remettre à la victime », Cerfa 11383, L. 441-5) ; traitements « Retouche ou reprise », « Rebut », « Acceptation par dérogation », « Retour au fournisseur » ; « Transmise au SPST le » (R. 4121-4), « Déposée sur le portail numérique le » (L. 4121-3-1) ; « Titres prérequis », « Prérequis non valide », « Catégories CACES », « Indices d'habilitation » ; résultats « Favorable », « Favorable avec réserves », « Défavorable », « Mise à l'arrêt » ; « Écart majeur », « Observation », « Réponse attendue le » ; « Renouveler le certificat », « Suspension par l'organisme », « Lever la suspension » et le refus « 3 ans au plus (ISO/IEC 17021-1) » ; statuts de BSD « Refusé », « Accepté partiellement » ; libellés des dix indicateurs d'objectif ; natures du contexte (enjeux externes et internes §4.1, parties intéressées §4.2, risques et opportunités §6.1) ; titres et rubriques du « Bilan annuel santé, sécurité et conditions de travail » (L. 2312-27).

### Questions par élément (80 : 55 ouvertes — C2 : 41 · C3 : 14 — et 25 tranchées : 3 au lot 1, 12 au lot 2, 10 le 15/10/2026)

**Tableau de bord, échéances et navigation**

- **TDB-01** *Destinataires des alertes : un animateur QHSE par site, tiré des données* — Un animateur par site ou un seul ? Qui reçoit les alertes si le poste est vacant ? *Tranché (11/10/2026) : un responsable QHSE par site, désigné dans « Gérer les sites » ; poste vacant : les animateurs QHSE, avec la mention « responsable à désigner ».*
- **TDB-02** *Échéances masquées pour un responsable sans accès à l'écran source* — Vue en lecture de l'élément, ou échéance sans lien ? *Tranché (12/10/2026) : l'échéance reste visible pour son responsable, avec un lien vers une vue en lecture quand elle existe, sinon sans lien.*
- **TDB-03** *Saisie mensuelle des heures travaillées (base du TF1/TG)* — **C2** · Lever le report « aucune saisie ni import » pour les heures travaillées ? Si oui : saisie mensuelle manuelle dans Vigie (par site, animateur QHSE ou direction) ou import (paie, Lucca, Cursus) ? Heures de l'effectif seulement, intérimaires exclus, comme le TF1/TG depuis le lot 2 ? *Depuis le lot 2 (12/10/2026), TF1/TG, jours sans accident et pyramide ne comptent que les accidents de l'effectif (intérimaires et personnes extérieures exclus), cohérents avec des heures de l'effectif : à confirmer avec la réponse.*
- **TDB-05** *« Mes échéances » consolidées tous sites* — Consolider tous sites pour chaque personne, indépendamment du sélecteur ? *Tranché (12/10/2026) : oui : « Mes échéances » sur tous les sites du périmètre de la personne, indépendamment du sélecteur de site.*
- **TDB-08** *Archivage d'un site : avertir des éléments encore ouverts* — **C2** · Archivage d'un site qui porte encore des éléments ouverts (événements, actions, contrôles, plans, documents) : faut-il bloquer, avertir avec le décompte, ou proposer un transfert en masse vers un autre site ?
- **TDB-18** *Recherche globale dans l'en-tête* — **C2** · Veut-on une recherche globale dans l'en-tête (par référence ou intitulé, tous modules, filtrée par site et droits), alors que la maquette n'en prévoit pas ?

**Événements et signalement terrain**

- **EVT-01** *Accident du travail : victime, circonstances et rubriques de la DAT* — Quels champs tenir dans Vigie et qui peut lire les lésions ? *En partie tranché (11/10/2026) : les données de santé d'un AT sont réservées à la direction et à l'animateur QHSE (SEC-06).* *Tranché (12/10/2026) : rubriques de la DAT (victime, date, heure et lieu, activité, circonstances, objet en cause, témoins, tiers, lésions, arrêt, soins) ; lésions, soins, certificat médical et pièces jointes médicales réservés à la direction et à l'animateur QHSE.*
- **EVT-02** *Clôture d'un AT sans déclaration CPAM : l'obligation disparaît* — Bloquer la clôture ou garder l'échéance visible ? *Tranché (12/10/2026) : clôture refusée tant que la déclaration n'est pas saisie, sauf inscription au registre des accidents bénins ou motif tracé.*
- **EVT-03** *Délai CPAM : 48 h hors dimanches et fériés, à compter de la connaissance* — Point de départ : date de l'accident ou createdAt ? Fériés Alsace-Moselle ? *Tranché (12/10/2026) : à compter de la connaissance de l'accident par l'employeur (`knownAt`, par défaut l'enregistrement dans Vigie), dimanches et fériés nationaux exclus ; option « Alsace-Moselle » par site.*
- **EVT-04** *Registre des accidents bénins* — Registre par site ou unique ? Visa de la victime dans Vigie ? *Tranché (12/10/2026) : un registre par site, imprimable pour le visa papier de la victime et du donneur de soins (visa enregistré par sa date).*
- **EVT-05** *Qualification : exiger les données propres au type* — Quels champs obligatoires à la qualification ? *Tranché (12/10/2026) : AT : victime, circonstances, lieu ; PA et SD : lieu, gravité potentielle ; NC : origine ; RC : client et référence ; ENV : aspect et milieu (`QUALIFICATION_FIELDS`).*
- **EVT-06** *« Nouveau signalement » : lieu de démonstration et cible du bouton* — Cible en production selon le rôle ? *Tranché (11/10/2026) : `/signaler` pour tous les rôles ; l'aperçu mobile reste à la démonstration.*
- **EVT-07** *Parcours terrain authentifié et signalement sans compte* — Comment signalent intérimaires et entreprises extérieures ? *Tranché (11/10/2026) : sans compte, par le QR code du poste (jeton signé), anonymement ou avec nom et entreprise déclarés.*
- **EVT-08** *Suivi de l'arrêt de travail : périodes, reprise, jours perdus calculés* — **C2** · Les périodes d'arrêt (arrêt initial, prolongation, rechute, reprise) sont-elles saisies dans Vigie par le service QHSE, ou viendront-elles de la paie ou de Cursus ?
- **EVT-15** *Échéances événement manquantes* — **C2** · Quels délais retenir pour les nouvelles échéances d'un événement ? Analyse des causes : combien de jours après la qualification ? Pilote sorti de l'effectif. Toutes les actions terminées sans passage à « Efficacité vérifiée ». Seule action annulée. Action rouverte sur un événement clos.
- **EVT-16** *Clôture d'un événement réservée aux approbateurs ?* — **C2** · La clôture d'un événement autre qu'un AT est-elle réservée aux approbateurs (animateur QHSE, direction), comme la réouverture et le classement sans suite ? Elle est aujourd'hui ouverte à l'encadrement.
- **EVT-18** *Formulaire terrain : choix du site et QR code périmé* — **C2** · Le QR code de poste doit-il porter un code de poste stable, indépendant de l'identifiant de la zone de la carte, pour que les QR imprimés restent valables quand la zone est redessinée ou remplacée ?
- **EVT-21** *File d'attente hors ligne des signalements* — **C2** · Faut-il ajouter au formulaire terrain la date et l'heure réelles des faits ? Aujourd'hui, c'est l'heure d'envoi qui fait foi, ce qui est faux pour un signalement envoyé plus tard depuis la file hors ligne.
- **EVT-28** *Suivi d'un signalement anonyme par code* — **C2** · Accepte-t-on le risque de ré-identification d'un signalement anonyme suivi par code secret (détail en lecture : étape, mesures immédiates, actions, sans l'analyse) ? Faut-il demander l'avis du DPO ?
- **EVT-29** *Événement déclaré par tous, modifié et suivi par le service QHSE* — **C2** · L'encadrement garde-t-il la modification et l'avancement des événements de son site, ou seul le QHSE modifie et suit l'événement déclaré ? (service QHSE, avec le formulaire Power Apps Événements)

**Plan d'actions**

- **ACT-01** *Rattacher les actions Prévention, Documents et Environnement par un vrai lien* — Colonnes dédiées ou table action_links ? Origine verrouillée ? *Tranché (12/10/2026) : colonnes dédiées sur `actions`, origine verrouillée après la création, reprise des références textuelles par script.*
- **ACT-02** *Rattacher une action existante depuis toutes les sources* — Le QHSE a répondu « un seul événement ou audit lié, une seule source » : faut-il encore pouvoir rattacher une action existante à d'autres fiches (risque, exigence, contrôle, habilitation, document, plan, permis) et l'en détacher depuis la fiche action ? Ou le rattachement se limite-t-il à la source posée à la création ? (responsable produit et service QHSE) *Tranché (15/10/2026) : rattachements complémentaires gardés (risque, exigence, contrôle, document, revue, décision), réservés au QHSE ; jamais un second événement ni audit ; plus aucun lien vers une habilitation, un plan de prévention ou un permis (pas d'action QSE). Lier aussi un équipement, un client ou un fournisseur : ACT-42.*
- **ACT-09** *Report d'échéance motivé et échéance initiale conservée* — Motif obligatoire et report réservé aux approbateurs ? *Tranché (15/10/2026) : « Reportée » est posé par le QHSE sans motif obligatoire ; seul le QHSE modifie la date cible, la date cible initiale est conservée (élément remplacé par ACT-17 et ACT-21).*
- **ACT-10** *Date, auteur et commentaire de réalisation* — Preuve obligatoire ? *Tranché (15/10/2026) : preuve facultative ; date effective saisie par le QHSE au passage « Terminée » (élément remplacé par ACT-21, ACT-24 et ACT-25).*
- **ACT-13** *Jugement « Efficacité insuffisante » et indépendance du vérificateur* — Un animateur QHSE peut-il vérifier l'efficacité d'une action dont il est lui-même responsable, ou la vérification revient-elle alors à un autre membre du QHSE ou à la direction ? (service QHSE) *Tranché (15/10/2026) : autovérification admise sans restriction ni marque ; jugement d'efficacité réservé au QHSE.*
- **ACT-22** *Encadrement hors QHSE et transitions faites par les autres écrans* — Questions au responsable produit et au service QHSE : 1) hors QHSE, l'encadrement peut-il créer une action depuis un écran source qu'il peut modifier (événement, risque, contrôle…) ? 2) voit-il en lecture le plan d'actions de son périmètre, ou seulement ses propres actions ? 3) un recyclage enregistré fait-il passer l'action « Terminée » d'office, ou seulement un commentaire automatique et une échéance pour le QHSE ? *Tranché (15/10/2026) : les actions QSE sont créées uniquement par le service QHSE ; l'encadrement lit le plan de son périmètre ; un recyclage ne donne pas lieu à une action QSE (le RH gère les formations). Actions créées dans un projet Keystone : ACT-41 ; événement modifié et suivi par le QHSE : EVT-29.*
- **ACT-29** *Statistiques mensuelles* — Questions au service QHSE : 1) les répartitions mensuelles portent-elles sur l'état du plan à la fin du mois, ou sur les actions ouvertes dans le mois ? 2) le respect des dates cibles se mesure-t-il à la date cible initiale ou à la dernière date cible ? (proposition : état à la fin du mois ; date cible initiale) *Tranché (15/10/2026) : état de tout le plan à la fin du mois ; respect des dates cibles mesuré à la dernière date cible.*
- **ACT-31** *Avertir le QHSE des commentaires et preuves du responsable* — Question au service QHSE : faut-il avertir le QHSE dans la cloche quand un responsable commente ou joint une preuve, et qui (responsable QHSE du site, ou tous les animateurs QHSE) ? *Tranché (15/10/2026) : oui, tous les animateurs QHSE, une notification par commentaire ou par preuve (livré avec le paquet 1).*
- **ACT-36** *Format des numéros AC-AA####* — **C3** · élément attendu : règle actuelle de numérotation AC à fournir par le service QHSE (recherche en cours, question gardée pour plus tard par l'utilisateur) : le compteur repart-il à 0001 chaque année (AC-270001 au début de 2027) ou continue-t-il, et combien de chiffres après l'année ?
- **ACT-37** *Source des actions créées par Habilitations, Prévention, Environnement et audits fournisseurs* — Questions au service QHSE : 1) quelle source pour une action créée depuis Habilitations (recyclage), Prévention (plan, permis, coactivité), Environnement (déchets) et un audit fournisseur : une des 22, ou une source à ajouter ? 2) « Réserves » désigne-t-il les réserves des contrôles réglementaires ou les réserves de réception des chantiers ? 3) que recouvre « Analyse de risque (AST-EST) » ? *Tranché (15/10/2026) : 24 sources (« Déchets » et « Audit fournisseur » ajoutées) ; aucune action QSE depuis Habilitations ni Prévention ; « Réserves » = réserves de réception d'un chantier ou d'une installation ; AST = analyse de sécurité des tâches en contexte pyrotechnique, EST = étude de sécurité technique.*
- **ACT-38** *Priorité proposée d'après le niveau de risque* — Question au service QHSE : quelle priorité pour chaque niveau de risque ? (proposition : niveau 4 → Urgent, niveau 3 → Moyen terme, niveaux 0 à 2 → Long terme) *Tranché (15/10/2026) : priorité au libre choix du QHSE, sans proposition (élément clos sans objet).*
- **ACT-39** *Import de l'extraction Power Apps* — **C3** · élément attendu : extraction de toutes les actions Power Apps (format, colonnes dont site et responsable, historique des commentaires, pièces jointes) à fournir plus tard par le propriétaire de l'application ; règle de numérotation (ACT-36) ; décision, une fois l'extraction connue, sur les responsables absents de Vigie (créer la fiche ou refuser la ligne)
- **ACT-42** *Rattacher une action à un équipement, un sous-équipement, un client ou un fournisseur* — **C3** · élément attendu : référentiels des équipements et sous-équipements (Codex ?), des clients et des fournisseurs (Keystone ?), avec leurs identifiants.

**Prévention et carte du site**

- **PRV-01** *Écarts R. 4512-6 passés non comptés* — Écart passé dans le badge ou seulement dans les indicateurs ? *Tranché (12/10/2026) : dans les indicateurs (veille, revue), pas dans le badge.*
- **PRV-02** *Contenu réglementaire du plan incomplet (R. 4512-8 et R. 4512-9)* — Champs structurés ou sections libres du modèle importé ? *Tranché (12/10/2026) : champs structurés, sections libres du modèle importé conservées.*
- **PRV-04** *Traçabilité de la délivrance, de la check-list et de la clôture des permis* — **C2** · Faut-il interdire la clôture d'un permis de feu avant la fin de la surveillance après travaux (watchUntil, 2 h), ou l'accepter en traçant un écart ? (service QHSE)
- **PRV-05** *Protocoles de sécurité de chargement et déchargement* — **C2** · Les transporteurs (opérations de chargement et de déchargement, R. 4515-4 à R. 4515-11) se gèrent-ils comme des entreprises extérieures (même fiche, même onglet) ? Existe-t-il un modèle de protocole de sécurité à reprendre ? (service QHSE)
- **PRV-06** *Inspection commune « préalable » acceptée après le début des travaux* — **C2** · Une inspection commune préalable datée après le début des travaux : refus à l'enregistrement, ou acceptation avec un écart tracé, à la manière des écarts R. 4512-6 de PRV-01 ? (service QHSE)
- **PRV-08** *Intervenants des permis reliés au personnel et aux habilitations* — **C3** · élément attendu : correspondance entre type de permis et titres d'habilitation exigés des intervenants : à fournir par le service QHSE (procédure des permis, PR-QHSE-005). Cursus deviendra ensuite la source des habilitations, sans bloquer l'élément : les titres sont déjà dans Vigie.
- **PRV-09** *Dossier entreprise extérieure : pièces de vigilance, intervenants, accueil* — **C2** · Les pièces de vigilance des entreprises extérieures (attestation URSSAF tous les 6 mois selon D. 8222-5, Kbis, assurance) sont-elles suivies par les achats, hors de Vigie, ou par le QHSE dans la fiche entreprise ? (responsable produit, avec les achats)
- **PRV-13** *Cumul des heures d'une entreprise extérieure sur 12 mois* — **C2** · Le seuil de 400 h (R. 4512-7) s'évalue-t-il par opération, plan par plan comme aujourd'hui, ou en cumulant les heures d'une entreprise extérieure sur 12 mois glissants, tous plans confondus ? (service QHSE)
- **PRV-15** *Permis complémentaires : consignation, espace confiné, hauteur, fouille* — **C3** · élément attendu : procédure PR-QHSE-005 et modèles des permis complémentaires (consignation, espace confiné, travail en hauteur, fouille) avec leurs check-lists : à fournir par le service QHSE, ou par l'utilisateur s'il s'agit de formulaires Power Apps.
- **PRV-16** *Validité des permis : durée maximale et prolongation* — **C2** · Quelle durée maximale de validité pour un permis (feu, essai, et futurs types) ? La prolongation d'un permis délivré est-elle admise, par qui, combien de fois, avec quel motif ? (service QHSE, d'après PR-QHSE-005 si la procédure le prévoit)
- **PRV-20** *Plans de prévention reçus des clients* — **C2** · Les plans de prévention reçus des clients (interventions d'EPC2i chez ses clients) sont-ils à suivre dans Vigie ? (responsable produit)
- **PRV-21** *Clôture d'un plan après un écart R. 4512-6 : mesures immédiates hors actions QSE* — **C2** · À la clôture d'un plan de prévention après un écart R. 4512-6, demander une trace des mesures immédiates (aucune action QSE n'est plus exigée) ? (service QHSE)

**Risques / DUERP**

- **DUE-01** *Mise à disposition du DUERP aux salariés, anciens salariés et instances* — Tout le DUERP ou l'unité du salarié ? *Tranché (12/10/2026) : tout le DUERP en lecture pour tous les rôles, registre des demandes d'accès, version imprimable.*
- **DUE-02** *PAPRIPACT : programme annuel de prévention* — Champs coût et ressources sur toutes les actions ? *Tranché (12/10/2026) : coût, ressources et indicateur sur les lignes du programme seulement (optionnels).*
- **DUE-04** *Annulation d'une action : détachement absent de l'historique du risque* — Une action annulée (« Abandonnée » après la refonte des actions) reste-t-elle affichée, grisée, sur la fiche du risque, ou en est-elle détachée avec une trace dans l'historique du risque ? (service QHSE) *Tranché (15/10/2026) : sans réponse attendue : l'action abandonnée est détachée du risque avec une trace dans son historique (proposition de la spécification, livrée avec le paquet 1).*
- **DUE-07** *Réévaluation après accident et mise à jour du DUERP déclenchée* — **C2** · Quelle gravité d'un AT ou d'un presque-accident impose une réévaluation, voire une nouvelle version du DUERP (par exemple : tout AT avec arrêt, toute gravité potentielle élevée) ? (service QHSE)
- **DUE-10** *Contenu d'une version figé à la validation* — **C2** · Le contenu d'une version du DUERP se fige-t-il au jour de sa validation (instantané complet : unités, cotations, mesures, actions avec leur statut) ou au jour de son archivage ? (service QHSE)

**Habilitations et formations**

- **HAB-02** *Suivi de l'état de santé au travail : VIP, SIR, aptitude, reprise* — **C2** · Le suivi de l'état de santé au travail (dates des VIP, SIR, aptitude, visites de reprise) est-il tenu dans Cursus, et lu par le connecteur INT-03, ou saisi dans Vigie ? *La réponse débloque aussi l'aptitude médicale à la conduite de HAB-10 (◐ depuis le paquet 5 : rien n'est stocké d'ici là).*
- **HAB-05** *Sortie d'un salarié : responsabilités ouvertes et échéances postérieures* — **C2** · À la sortie d'un salarié : bloquer la sortie tant qu'il porte des responsabilités ouvertes (actions dont il est responsable, pilotages, échéances postérieures à la date de sortie), ou proposer de les réaffecter en masse ?
- **HAB-07** *Exigences par poste ou par activité* — **C2** · Lever le hors-périmètre des exigences par poste ou par activité, décidé auparavant ? Si oui, le poste est-il saisi dans Vigie ou lu dans Cursus ?
- **HAB-19** *Vue Salarié : titres archivés et dépôt de son attestation* — **C2** · Le salarié peut-il déposer lui-même l'attestation d'une formation, qui ne compte qu'après validation par le service QHSE ?

**Audits et revue de direction**

- **AUD-32** *Archiver les enregistrements figés en PDF et dans Documents maîtrisés* — **C2** · Lever le report des exports pour archiver en PDF, côté serveur, le dossier de revue et les versions figées du DUERP, et les classer dans Documents maîtrisés ?

**Documents et environnement**

- **DOC-03** *Propriétaire en consultation seule : ni révision ni échéances* — **C2** · Le propriétaire d'un document dont le rôle n'a que la consultation sur Documents (chef de service, chef de projet, salarié) peut-il rédiger et soumettre la révision de son propre document, l'approbation restant au QHSE ? Sinon, faut-il réserver le choix du propriétaire aux rôles qui modifient Documents ? (responsable produit, service QHSE)
- **DOC-16** *Liens « Procédure » sur les autres écrans* — **C3** · élément attendu : références réelles des procédures applicables à chaque écran (événements, actions, DUERP, habilitations, veille, audits, documents, environnement), à fournir par le service QHSE ; seule PR-QHSE-005 (prévention) est connue
- **DOC-18** *Séparation rédaction et approbation* — **C2** · Faut-il interdire à l'auteur d'une version de l'approuver lui-même (approbation par un autre animateur QHSE ou par la direction), ou l'autoriser en le signalant sur la fiche, pour les sites qui n'ont qu'un animateur ? (responsable produit, service QHSE)
- **DOC-21** *Suivi des rejets eaux et air* — **C2** · Le suivi des rejets eaux et air est-il nécessaire (sites soumis à autorisation, enregistrement ou déclaration ICPE, autosurveillance imposée par arrêté) ? Si oui, les points de rejet, paramètres et valeurs limites devront être fournis (C3) ; sinon, retirer l'élément (service QHSE)
- **DOC-22** *Accès de l'encadrement à Environnement* — **C2** · Faut-il ouvrir l'écran Environnement au chef de service et au chef de projet, et si oui en consultation seule ou en saisie (enlèvements, relevés) sur les sites de leur périmètre ? (responsable produit)
- **DOC-23** *Aspects et impacts environnementaux* — **C3** · élément attendu : méthode actuelle d'analyse environnementale du service QHSE (liste des aspects et impacts, grille de cotation, critère de significativité), à laquelle renvoie la source « Analyse environnementale » des actions ; éventuellement le formulaire Power Apps du domaine

**Intégrations**

- **INT-07** *Import PP par IA : confidentialité* — **C3** · élément attendu : avis du DPO sur l'envoi des plans de prévention au service d'IA (données personnelles des intervenants, fournisseur hors UE) et sur la journalisation d'un extrait de la réponse
- **INT-08** *Liens directs vers Keystone* — **C3** · élément attendu : adresse de Keystone en production et forme des liens vers un projet et vers une affectation (équipe Keystone, variable KEYSTONE_URL)

**Imports, exports et impression**

- **IMP-01** *Import des heures travaillées* — **C2** · Lever le report des imports pour les heures travaillées (base du TF1/TG) ? Si oui : saisie mensuelle dans Vigie ou import de la paie (exemple d'export à fournir ensuite, C3), et intérimaires inclus ou non (question de TDB-03) (responsable produit)
- **IMP-02** *Import du personnel Lucca* — **C2** · Lever le report pour un import CSV du personnel Lucca, ou attendre Cursus, source de vérité RH cible (INT-03), sachant que l'import Power Apps des actions pourra aussi créer des fiches (point 16) ? (responsable produit)
- **IMP-03** *Import Excel de la veille* — **C2** · Lever le report pour l'import du tableau de veille Excel ? Si oui, un exemple du fichier actuel sera nécessaire (C3) (responsable produit, service QHSE)
- **IMP-05** *Exports CSV événements et veille* — **C2** · Lever le report des exports CSV pour les événements et la veille ? (responsable produit)
- **IMP-06** *Export et impression de la matrice des habilitations* — **C2** · Lever le report pour l'export de la matrice des habilitations ? (responsable produit)
- **IMP-08** *Exports : liste maîtresse, plans et permis* — **C2** · Lever le report des exports de la liste maîtresse des documents et des plans et permis ? (responsable produit)
- **IMP-09** *Plan régénéré au format importé* — **C2** · Lever le report pour régénérer le plan de prévention au format du formulaire importé (PDF, pdf-lib) ? (responsable produit)

**Sécurité et RGPD**

- **SEC-10** *Registre des traitements et durées de conservation* — **C3** · élément attendu : avis du DPO : durées de conservation par catégorie de données (AT et données de santé, salariés sortis, signalements, pièces jointes, journaux), règles de purge ou d'anonymisation, registre des traitements.
- **SEC-12** *Mentions d'information RGPD* — **C3** · élément attendu : texte des mentions d'information (art. 13 RGPD) à fournir ou valider par le DPO : responsable du traitement, finalités, base légale, destinataires, durées (SEC-10), droits et contact du DPO.

**Qualité, tests, performance et dette technique**

- **QUA-15** *Jeu d'essai des scans* — **C3** · élément attendu : scans et photos réels de plans de prévention remplis sur le formulaire de l'entreprise (anonymisés), à fournir par le service QHSE, plus une clé API Anthropic de test. L'envoi de documents réels à l'API attend l'avis du DPO (INT-07).

**Conformité réglementaire transverse**

- **CNF-01** *Registre des dangers graves et imminents* — **C2** · Le registre spécial des dangers graves et imminents est-il tenu dans Vigie ? Si oui, l'avis daté et signé du représentant du CSE est-il saisi par lui-même (droit à prévoir pour un Salarié) ou recopié par le QHSE et imprimé pour signature, comme le registre des accidents bénins ? Sinon, le registre reste-t-il sur papier, Vigie ne traçant que l'événement DGI ?
- **CNF-02** *Instances CSE / CSSCT* — **C2** · Les réunions CSE et CSSCT (ordres du jour, PV, consultations sur le DUERP, le PAPRIPACT et le bilan annuel) sont-elles suivies dans Vigie par le QHSE, ou par les RH dans un autre outil ? Quelles instances et quels établissements ?
- **CNF-04** *Évaluation des fournisseurs* — **C3** · élément attendu : grille actuelle d'évaluation des fournisseurs (critères, notation, seuils, fréquence, fournisseurs concernés) et liste des fournisseurs, à fournir par le service QHSE ou les achats. Préciser aussi si les entreprises extérieures de la prévention sont les mêmes fiches.
- **CNF-06** *Produits chimiques* — **C2** · L'inventaire des produits chimiques, les FDS et le repérage des CMR sont-ils tenus dans Vigie, ou restent-ils dans l'outil actuel d'évaluation du risque chimique (source « Analyse de risque chimique » des actions : Seirich, Excel…), Vigie ne gardant qu'un lien ?
- **CNF-07** *Satisfaction client* — **C3** · élément attendu : questionnaire de satisfaction client actuel (questions, échelle, fréquence, destinataires) et résultats récents, à fournir par le service QHSE ou le service commercial.
- **CNF-09** *Communication et sensibilisation* — **C2** · Les causeries et quarts d'heure sécurité (thème, animateur, participants, émargement) sont-ils tenus dans Vigie, ou dans Cursus avec les formations ? Existe-t-il un support actuel (formulaire Power Apps, feuille d'émargement) à reprendre ?
- **CNF-10** *EPI* — **C2** · La dotation des EPI par salarié (remise, taille, renouvellement, émargement) est-elle tenue dans Vigie, dans Cursus ou dans l'outil de magasin ou d'achats ? Existe-t-il un support actuel à reprendre ?

## 20. Hors périmètre / décidé

Rappel des décisions déjà prises, qui s'appliquent à tous les éléments ci-dessus.

- **Jamais de suppression physique** d'un enregistrement métier tracé : on annule, classe sans suite ou archive, avec un motif obligatoire (qui, quand, pourquoi). Éléments archivés ou annulés masqués par défaut, visibles par filtre. Suppression tolérée seulement pour un brouillon jamais diffusé ou une pièce jointe ajoutée par erreur avant clôture (d'où **AUD-03**, **AUD-36**, **DOC-09**, **PRV-12**, **EVT-19**).
- **Imports et exports reportés** : pas d'import Lucca ni Excel, pas de saisie ni d'import des heures travaillées, pas de nouveaux exports CSV ; les boutons « à venir » restent en place. **TDB-03**, **IMP-01** à **IMP-03**, **IMP-05**, **IMP-06**, **IMP-08** et **IMP-09** attendent la levée de ce report ; **IMP-04** (refonte du CSV existant) et **IMP-07** (impression) n'en dépendent pas. Les actions sortent d'**IMP-05** (pas d'export Excel des actions, décision du service QHSE du 15/10/2026) ; l'import de l'extraction Power Apps des actions (**ACT-39**) n'est pas concerné par le report : il remplace l'application actuelle.
- **Connecteurs non implémentés** (Keystone, Cursus, Trackdéchets ; Entra ID est branché depuis le lot 1) : les emplacements « à venir » sont conservés. Cursus est la source de vérité RH cible ; Lucca reste la source provisoire du personnel.
- **Décisions du lot 1** (11/10/2026) : PostgreSQL en production, choisi par `DATABASE_URL`, et PGlite en démonstration et dans l'application Mac ; image Docker générique et `docker-compose.yml`, HTTPS par un reverse proxy ; signalement sans compte par QR code de poste à jeton signé, anonyme ou nominatif déclaratif, avec limite de débit, « Mes signalements » étant réservé aux personnes connectées ; données de santé d'un AT visibles et modifiables par la direction et l'animateur QHSE seulement, absentes de la charge des autres rôles ; un responsable QHSE par site.
- **Rôle Salarié** : ne voit que ses propres données (habilitations, signalements, actions). Responsable d'une action, il la consulte, commente dans le fil et joint des preuves, sans la faire avancer : décision modifiée le 15/10/2026 (il ne déclare plus ses actions réalisées ; l'avancement est géré par le service QHSE, **ACT-21**, **EVT-22**). **QUA-06** protège ce cloisonnement.
- **Indicateurs calculés, jamais stockés** (TF1/TG, retards, échéances, statuts) dans `src/lib/queries.ts`.
- **Exigences par poste** : hors périmètre jusqu'ici ; **HAB-07** demande l'arbitrage.
- **Décisions du 15/10/2026 — refonte des actions QSE** ([`docs/specs/actions-qse.md`](specs/actions-qse.md)) : le formulaire Power Apps « Créer Actions QSE » et les réponses du service QHSE font référence ; avancement en dix valeurs conduit par le service QHSE (animateur QHSE et direction, comme pour toutes les validations de Vigie), « Terminée » et « Vérifiée » comprises ; vérification d'efficacité planifiée dès la création, constat « non efficace » ou « nouveau risque généré » → nouvelle action pré-remplie et liée ; responsable obligatoire, pris dans le personnel, qui consulte ses actions, commente et joint des preuves ; un seul site, une seule source, au plus un événement ou un audit liés ; plus de nature C/P ni d'intitulé court ; numéro unique jamais réattribué, format AC-AA#### en attente de la règle actuelle ; notification à la création dans Vigie seulement ; rappel du mercredi des actions en cours dans Vigie et par e-mail, sans synthèse pour le QHSE ; pas de vues enregistrées ni d'export Excel des actions ; reprise de toutes les actions Power Apps, avec leur numéro AC, à partir de l'extraction fournie par le propriétaire de l'application. **Réponses du service QHSE (3ᵉ tour, 15/10/2026)**, appliquées par le paquet 1 : actions QSE créées uniquement par le service QHSE (l'encadrement lit le plan de son périmètre) ; aucune action QSE pour un recyclage ni depuis un plan de prévention ; 24 sources (« Déchets » et « Audit fournisseur » ajoutées) ; rattachements complémentaires gardés ; autovérification admise ; priorité au libre choix ; rappel du mercredi avec les Terminées ; commentaire ou preuve du responsable signalé à tous les animateurs QHSE.
- **Formulaires Power Apps** : les formulaires Power Apps du service QHSE font référence pour les écrans qu'ils couvrent ; les formulaires des autres modules seront transmis puis spécifiés à leur réception, et peuvent modifier les éléments marqués PA.
- **Anciennement hors périmètre, désormais au backlog** : recherche globale (**TDB-18**), tests et CI (**QUA-01** à **QUA-08**), dates relatives du jeu de démonstration (**QUA-20**).
- **`src/app/nocturne.css`** est une copie du design system, à ne pas modifier : les corrections visuelles passent par `src/app/vigie.css` (**UX-09**).
