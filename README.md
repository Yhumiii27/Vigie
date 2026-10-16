# Vigie — pilotage QHSE

Application web du système EPC2i : signalements terrain, plan d'actions unique, DUERP, habilitations, veille réglementaire, contrôles périodiques, audits et revue de direction, plans de prévention et permis, documents maîtrisés, environnement et déchets.

## Démarrer

### Démonstration et développement

```bash
npm install
npm run dev        # http://localhost:3200, mode démonstration
```

`npm run dev` démarre en **mode démonstration** (`VIGIE_DEMO=1`) : sélecteur de rôle, aperçu mobile, base PGlite créée dans `.data/vigie` au premier lancement, migrée puis remplie avec le jeu de données de démonstration. `npm run db:reset` (serveur arrêté) repart de zéro — nécessaire après toute modification du jeu de données. Les pièces jointes sont stockées dans `.data/uploads`. `VIGIE_TODAY=2026-10-09` (démonstration seulement, dans `.env.local`) fige la date de référence des calculs sur celle du jeu de démonstration. `npm run start:demo` sert la compilation de production (`npm run build`) en démonstration. Aucune variable n'est requise : `.env.example` (section « Démonstration ») liste les réglages facultatifs.

### Production

Image Docker et `docker-compose.yml` (Vigie, PostgreSQL 16, volumes pour les pièces jointes et les sauvegardes), derrière un reverse proxy HTTPS ou avec le profil Caddy :

```bash
cp .env.example .env && chmod 600 .env   # POSTGRES_PASSWORD, VIGIE_PUBLIC_URL, VIGIE_SESSION_SECRET, VIGIE_REPORT_SECRET,
                                         # VIGIE_UPLOAD_KEY, ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET
docker compose up -d --build                   # Vigie sur 127.0.0.1:3000, derrière votre reverse proxy
docker compose --profile https up -d --build   # ou Caddy sur 80/443 (VIGIE_DOMAIN, certificat Let's Encrypt)
curl -s http://127.0.0.1:3000/api/sante        # {"statut":"ok","base":"postgres",…}
```

Hors démonstration (image Docker, ou `npm run build && npm start` sur un serveur Node.js 22) : aucun jeu de démonstration ni sélecteur de rôle ; `DATABASE_URL` choisit PostgreSQL (sinon PGlite dans `VIGIE_DATA_DIR`) ; `VIGIE_PUBLIC_URL` est obligatoire, et l'authentification Microsoft Entra ID aussi (page « Configuration incomplète » tant qu'elle n'est pas configurée, jamais de rôle par défaut). Une base vide ouvre l'écran « Créer le premier site » (direction, animateur QHSE). Toutes les variables sont décrites dans `.env.example` et validées au démarrage par `src/lib/env.ts` : une valeur invalide arrête le serveur avec la liste des variables à corriger. Inscription de l'application dans Entra ID, reverse proxy, sauvegardes (`npm run db:backup`, `db:restore`, sauvegarde automatique avant migration), mises à jour (dont la reprise des liens d'origine des actions après la migration 0004 : `npm run db:reprise-liens`) et rotation des secrets : [`docs/EXPLOITATION.md`](docs/EXPLOITATION.md).

Essai de la connexion sans tenant Entra : `node scripts/oidc-mock.mjs` (fournisseur OIDC factice) puis `scripts/e2e-auth.sh` (parcours complet avec curl ; prérequis en tête du script).

### Vérifications

```bash
npm run typecheck   # next typegen puis tsc
npm run lint
npm test            # Vitest : tests unitaires et d'intégration, PGlite en mémoire
TEST_DATABASE_URL=postgres://vigie@127.0.0.1:5432/postgres npm test   # intégration sur PostgreSQL (une base neuve par fichier)
npm run db:check    # migrations publiées inchangées, schéma = migrations, application à une base vide
```

`VIGIE_E2E_URL=http://localhost:3200 npx vitest run test/e2e` contrôle la charge des pages du Salarié contre `npm run start:demo`. Intégration continue : `.github/workflows/ci.yml` (Node de `.nvmrc`). Une migration publiée ne se modifie jamais : voir `CLAUDE.md`.

## Application Mac

```bash
bash desktop-app/build.sh   # construit Vigie.app et l'installe sur le Bureau (~/Desktop/Vigie.app)
```

Double-cliquer sur l'icône Vigie ouvre l'application dans une fenêtre native (AppKit + WKWebView). Si un serveur répond déjà sur le port 3200 (`npm run dev`), elle l'utilise sans jamais l'arrêter. Sinon elle compile si besoin (`npm run build`), lance `next start --port 3200`, joignable depuis ce Mac seulement, puis arrête ce serveur à sa fermeture. Si iCloud synchronise le Bureau, `bash desktop-app/build.sh --applications` installe l'application dans `~/Applications` avec un lien sur le Bureau. Journal : `~/Library/Logs/Vigie/server.log`. Détails, dépannage et limites : [`desktop-app/README.md`](desktop-app/README.md).

## Écrans

| Route | Écran | Contenu |
|---|---|---|
| `/` | Tableau de bord QHSE | KPI calculés, pyramide, NC par origine, échéances à 15 j (tous domaines, cliquables), derniers signalements, veille à la une |
| `/a-faire` | À faire | Échéances et retards de tous les domaines du site sélectionné, filtres par domaine et « Mes échéances » (celles de la personne sur tous les sites de son périmètre, y compris d'un écran qui lui est fermé), marquage lu |
| `/evenements` | Signalements et événements | Filtres, recherche, ouverts/tous, fiche modifiable, workflow à 6 étapes (qualification selon le type, règles « Actions » et « Efficacité vérifiée »), analyse des causes éditable (5M, arbre, 5 pourquoi, 8D), actions liées, pièces jointes ; accident du travail : rubriques de la déclaration (victime, circonstances, témoins ; lésions, soins, réserves et pièces médicales réservées à la direction et à l'animateur QHSE), délai CPAM de 48 h, clôture subordonnée à la déclaration |
| `/evenements/registre-benin` | Registre des accidents bénins | Registre d'un site (`?site=`), imprimable pour le visa de la victime et du donneur de soins ; direction et animateur QHSE |
| `/actions` | Plan d'actions unique | Kanban, liste, par pilote ; filtres origine, pilote, « Mes actions », recherche ; fiche action avec cycle à lancer → en cours → efficacité à vérifier → clôturée ; lien direct `?action=A-214` |
| `/risques` | Évaluation des risques (DUERP) | Unités de travail, matrice brut/résiduel, ajout, modification et archivage motivé des risques, actions de réduction, export CSV, versions archivées avec instantanés ; en lecture pour tous les rôles ; registre des demandes d'accès ; programme annuel de prévention (PAPRIPACT, `?onglet=programme`) |
| `/risques/imprimer`, `/risques/imprimer/programme` | Impressions du DUERP | DUERP en vigueur ou archivé (`?version=`), programme annuel de prévention (`?annee=`) |
| `/habilitations` | Habilitations et formations | Matrice salariés × titres, enregistrement des formations, exigences par salarié, recyclages planifiés, alerte affectation Keystone, salariés et titres suivis |
| `/veille` | Veille et contrôles | Exigences réglementaires (évaluation datée, actions d'écart), contrôles périodiques (filtres de statut, contrôles réalisés avec rapport, historique) |
| `/audits` | Audits et certifications | Certifications, programme annuel (éléments reportés ou annulés avec motif, revues de direction liées), constats et actions, préparation de la revue de direction ; en consultation pour les chefs de service et de projet |
| `/audits/contributions` | Mes contributions | Éléments de revue de direction confiés à la personne (à cocher), décisions et actions qu'elle pilote ; ouvert à tous les rôles |
| `/revue-de-direction` | Dossier de revue de direction | Dossier consolidé imprimable (ouvert depuis /audits), calculé à la date de la séance et figé au compte rendu |
| `/prevention` | Plans de prévention et permis | Règle Seveso seuil haut (plan écrit et signé dès la première minute, réglable par site), plans R. 4512-6 (inspection commune, contenu R. 4512-8 et R. 4512-9, signatures, écarts passés sur 12 mois), permis de feu / d'essai avec check-lists (délivrance bloquée sans plan signé), entreprises extérieures |
| `/prevention/import` | Import d'un plan de prévention | Formulaire PDF remplissable, Word (.docx) ou scan : détection des champs et cases cochées, modèles de correspondance, vérification puis création du plan (fichier source joint) |
| `/prevention/carte` | Carte du site et coactivité | Plan de masse par site (schéma par défaut ou plan importé), zones, voies d'accès communes, activités internes et externes, détection des situations de coactivité par jour |
| `/prevention/imprimer/plan/[id]`, `/prevention/imprimer/permis`, `/prevention/imprimer/permis/[id]` | Impressions de la prévention | Plan de prévention, registre des permis par période (`?annee=&mois=`), fiche d'un permis |
| `/documents` | Documents maîtrisés (ISO 9001 §7.5) | Registre filtrable, fiche document, cycle brouillon → en revue → approuvée, révisions, obsolescence, revues périodiques et actions liées |
| `/environnement` | Environnement et déchets | Registre chronologique des déchets (BSD et mentions de l'arrêté du 31 mai 2021 manquants, SIRET de l'établissement, export CSV `/environnement/registre`), filières, consommations, événements environnementaux |
| `/signaler` | Signalement terrain | Formulaire mobile (bouton « Nouveau signalement » ; cible des QR codes de poste : `/signaler?jeton=…`, ouverte sans compte avec un jeton valide), photos, dictée vocale, mode anonyme ou nom et entreprise déclarés |
| `/signaler/postes` | QR codes des postes | Étiquettes imprimables par zone de la carte, « Régénérer le QR » (révoque l'ancienne étiquette) |
| `/apercu-mobile` | Aperçu mobile | Formulaire terrain dans un cadre de téléphone, sur un poste de démonstration (démonstration seulement) |
| `/signaler/mes-signalements` | Mes signalements | Suivi des signalements nominatifs de la personne connectée (étape, progression) ; les anonymes n'y figurent pas |
| `/auth/connexion`, `/auth/retour`, `/auth/deconnexion` | Connexion Entra ID | Hors démonstration : connexion OIDC, retour du fournisseur, déconnexion ; `/auth/acces` explique un refus (configuration incomplète, accès non autorisé, compte Microsoft non rattaché) |
| `/api/sante` | Route de santé | 200 si la base répond, 503 sinon (sonde du conteneur et de la supervision) |

Le **site** choisi en haut de la barre latérale filtre les données (événements, actions, contrôles, unités de travail, personnel, prévention, déchets) ; « Tous les sites » consolide. Hors démonstration, une personne n'accède qu'aux sites de son périmètre (tous pour la direction et l'animateur QHSE ; sinon son site de rattachement et les sites accordés par groupe Entra). Chaque site a un **responsable QHSE** (« Gérer les sites… »), destinataire de ses alertes ; poste vacant : alertes aux animateurs QHSE, « responsable à désigner ». Le **rôle** (Animateur QHSE, Direction, Chef de service, Chef de projet, Salarié) vient du rôle applicatif Entra ID hors démonstration et se change depuis le bloc utilisateur en démonstration ; il filtre la navigation, les notifications et les droits (le salarié consulte et signale ; l'animateur QHSE et la direction valident : clôture d'action, approbation de documents, versions du DUERP).

## Architecture

- `design/` — bundle de la maquette (référence, exclu du build et du lint).
- `src/db/` — schéma Drizzle, ouverture de la base (PostgreSQL ou PGlite, type commun `Db`), jeu de démonstration (`seed.ts` + `seeds/` par domaine).
- `src/lib/env.ts` / `src/lib/config.ts` — configuration validée (seule lecture de `process.env`) ; `src/lib/demo.ts` — identités du mode démonstration ; `src/lib/auth/` — fournisseurs d'identité de la session.
- `src/lib/queries.ts` — chargements de base filtrés par site et règles de calcul partagées ; `src/lib/data/<domaine>.ts` — chargements par écran ; `todo.ts` / `notifications.ts` — échéances et alertes transverses.
- `src/lib/session.ts` — session de la requête (`getSession()` : rôle, fiche, site sélectionné, périmètre) ; `src/lib/guard.ts` — gardes d'écran et de droits ; `src/proxy.ts` — hôtes admis, connexion requise, CSP.
- `src/server/<domaine>.ts` — server actions (validation `formReader`, droits `requireManager` / `requireApprover`, site `requireInSite`, journal `logChange`).
- `src/components/` — `Dialog`, `form` (formulaires branchés sur les server actions), `ActionFormDialog` (création d'action depuis n'importe quel écran), composants par domaine.
- `src/app/fichiers/[id]` — service des pièces jointes (droits et périmètre de sites ; fichiers chiffrés au repos par `src/lib/uploads.ts`).
- `scripts/vigie-db.ts` — sauvegarde, restauration, contrôle et essai des migrations ; `test/` — tests d'intégration et de bout en bout ; `docker/`, `Dockerfile`, `docker-compose.yml` — image et déploiement.

## Pas encore branché

- Imports (Excel, Lucca CSV) et connecteurs Keystone / Cursus / Trackdéchets : boutons désactivés « à venir ». Suite du développement : [`docs/RESTE-A-FAIRE.md`](docs/RESTE-A-FAIRE.md).
- Lecture des formulaires scannés : désactivée par défaut, car le document est envoyé à l'API Claude (Anthropic). Pour l'activer : `VIGIE_AI_IMPORT=1` et une clé `ANTHROPIC_API_KEY`. Les PDF remplissables et les fichiers Word sont lus localement. Des formulaires d'exemple sont dans `samples/` (`node scripts/pp-samples.mjs` pour les régénérer).
- Authentification Microsoft Entra ID : en démonstration, le rôle se choisit dans le menu utilisateur (`src/lib/auth/demo.ts`) ; hors démonstration, connexion OIDC (code + PKCE, `/auth/connexion`, `/auth/retour`, `/auth/deconnexion`), session dans un cookie chiffré (`src/lib/auth/`), rôle tiré des rôles applicatifs Entra et sites des groupes (`VIGIE_SITE_GROUPS`). `src/proxy.ts` refuse les hôtes inconnus, renvoie vers la connexion sans session et pose la CSP. Test sans tenant : `node scripts/oidc-mock.mjs` (fournisseur factice) et `scripts/e2e-auth.sh` (parcours complet avec curl).
- Données Keystone (projets, affectations) : référentiel local en attendant l'intégration.

## Mise en ligne (Docker, Coolify)

Le `Dockerfile` à la racine produit l'image décrite dans [`docs/EXPLOITATION.md`](docs/EXPLOITATION.md) (serveur autonome, utilisateur non root, route de santé `/api/sante`). Réglages à donner à l'hébergeur (Coolify ou autre) :

| Réglage | Valeur |
| --- | --- |
| Port interne | `3000` |
| Volume persistant | `/data` : base PGlite dans `/data/db` (sans `DATABASE_URL`), pièces jointes dans `/data/uploads`, sauvegardes dans `/data/backups` — mêmes chemins que la première image Coolify : un volume existant est repris tel quel |
| Instance de démonstration | `VIGIE_DEMO=1` et `VIGIE_PUBLIC_URL=https://<domaine>` (hôte admis) : jeu de démonstration, sélecteur de rôle, aucune connexion |
| Production | variables de [`docs/EXPLOITATION.md`](docs/EXPLOITATION.md) § 4 : `VIGIE_PUBLIC_URL` (https), Entra ID, secrets, `DATABASE_URL` recommandé |

Sans `VIGIE_DEMO=1` ni configuration Entra ID, le serveur s'arrête au démarrage ou affiche « Configuration incomplète ». Une instance de démonstration n'a pas d'authentification : protéger l'accès au niveau de l'hébergeur (authentification HTTP de Coolify, par exemple).
