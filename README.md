# Vigie — pilotage QHSE

Application web du système EPC2i : signalements terrain, plan d'actions unique, DUERP, habilitations, veille réglementaire, contrôles périodiques, audits et revue de direction, plans de prévention et permis, documents maîtrisés, environnement et déchets.

## Démarrer

```bash
npm install
npm run dev        # http://localhost:3200
```

La base PGlite est créée dans `.data/vigie` au premier lancement, migrée puis remplie avec le jeu de données de démonstration. `npm run db:reset` (serveur arrêté) repart de zéro — nécessaire après toute modification du schéma ou du jeu de données. Les pièces jointes sont stockées dans `.data/uploads`. `VIGIE_TODAY=2026-10-06` fige la date de référence des calculs.

## Application Mac

```bash
bash desktop-app/build.sh   # construit Vigie.app et l'installe sur le Bureau (~/Desktop/Vigie.app)
```

Double-cliquer sur l'icône Vigie ouvre l'application dans une fenêtre native (AppKit + WKWebView). Si un serveur répond déjà sur le port 3200 (`npm run dev`), elle l'utilise sans jamais l'arrêter. Sinon elle compile si besoin (`npm run build`), lance `next start --port 3200`, joignable depuis ce Mac seulement, puis arrête ce serveur à sa fermeture. Si iCloud synchronise le Bureau, `bash desktop-app/build.sh --applications` installe l'application dans `~/Applications` avec un lien sur le Bureau. Journal : `~/Library/Logs/Vigie/server.log`. Détails, dépannage et limites : [`desktop-app/README.md`](desktop-app/README.md).

## Écrans

| Route | Écran | Contenu |
|---|---|---|
| `/` | Tableau de bord QHSE | KPI calculés, pyramide, NC par origine, échéances à 15 j (tous domaines, cliquables), derniers signalements, veille à la une |
| `/evenements` | Signalements et événements | Filtres, recherche, ouverts/tous, fiche modifiable, workflow à 6 étapes (règles « Actions » et « Efficacité vérifiée »), analyse des causes éditable (5M, arbre, 5 pourquoi, 8D), actions liées, pièces jointes |
| `/actions` | Plan d'actions unique | Kanban, liste, par pilote ; filtres origine, pilote, « Mes actions », recherche ; fiche action avec cycle à lancer → en cours → efficacité à vérifier → clôturée ; lien direct `?action=A-214` |
| `/risques` | Évaluation des risques (DUERP) | Unités de travail, matrice brut/résiduel, ajout/modification/suppression des risques, actions de réduction, export CSV, versions archivées avec instantanés |
| `/habilitations` | Habilitations et formations | Matrice salariés × titres, enregistrement des formations, exigences par salarié, recyclages planifiés, alerte affectation Keystone, salariés et titres suivis |
| `/veille` | Veille et contrôles | Exigences réglementaires (évaluation datée, actions d'écart), contrôles périodiques (filtres de statut, contrôles réalisés avec rapport, historique) |
| `/audits` | Audits et certifications | Certifications, programme annuel éditable, constats et actions, préparation de la revue de direction |
| `/revue-de-direction` | Dossier de revue de direction | Dossier consolidé imprimable (ouvert depuis /audits) |
| `/prevention` | Plans de prévention et permis | Règle Seveso seuil haut (plan écrit et signé dès la première minute, réglable par site), plans R. 4512-6 (inspection commune, signatures), permis de feu / d'essai avec check-lists (délivrance bloquée sans plan signé), entreprises extérieures |
| `/prevention/import` | Import d'un plan de prévention | Formulaire PDF remplissable, Word (.docx) ou scan : détection des champs et cases cochées, modèles de correspondance, vérification puis création du plan (fichier source joint) |
| `/prevention/carte` | Carte du site et coactivité | Plan de masse par site (schéma par défaut ou plan importé), zones, voies d'accès communes, activités internes et externes, détection des situations de coactivité par jour |
| `/documents` | Documents maîtrisés (ISO 9001 §7.5) | Registre filtrable, fiche document, cycle brouillon → en revue → approuvée, révisions, obsolescence, revues périodiques et actions liées |
| `/environnement` | Environnement et déchets | Registre chronologique des déchets (BSD manquants), filières, consommations, événements environnementaux |
| `/apercu-mobile`, `/signaler` | Signalement terrain | Formulaire mobile (cible des QR codes : `/signaler?lieu=…`), photos, dictée vocale, mode anonyme |
| `/signaler/mes-signalements` | Mes signalements | Suivi des signalements nominatifs (étape, progression) ; les anonymes n'y figurent pas |

Le **site** choisi en haut de la barre latérale filtre les données (événements, actions, contrôles, unités de travail, personnel, prévention, déchets) ; « Tous les sites » consolide. Le **rôle** de démonstration (Animateur QHSE, Direction, Chef de service, Chef de projet, Salarié) se change depuis le bloc utilisateur : il filtre la navigation, les notifications et les droits (le salarié consulte et signale ; l'animateur QHSE et la direction valident : clôture d'action, approbation de documents, versions du DUERP).

## Architecture

- `design/` — bundle de la maquette (référence, exclu du build et du lint).
- `src/db/` — schéma Drizzle, ouverture PGlite, jeu de données (`seed.ts` + `seeds/` par domaine).
- `src/lib/queries.ts` — chargements de base filtrés par site et règles de calcul partagées ; `src/lib/data/<domaine>.ts` — chargements par écran ; `todo.ts` / `notifications.ts` — échéances et alertes transverses.
- `src/server/<domaine>.ts` — server actions (validation `formReader`, droits `requireManager` / `requireApprover`).
- `src/components/` — `Dialog`, `form` (formulaires branchés sur les server actions), `ActionFormDialog` (création d'action depuis n'importe quel écran), composants par domaine.
- `src/app/fichiers/[id]` — service des pièces jointes.

## Pas encore branché

- Imports (Excel, Lucca CSV) et connecteurs Cursus / Trackdéchets : boutons désactivés « à venir ».
- Lecture des formulaires scannés : désactivée par défaut, car le document est envoyé à l'API Claude (Anthropic). Pour l'activer : `VIGIE_AI_IMPORT=1` et une clé `ANTHROPIC_API_KEY`. Les PDF remplissables et les fichiers Word sont lus localement. Des formulaires d'exemple sont dans `samples/` (`node scripts/pp-samples.mjs` pour les régénérer).
- Authentification Microsoft Entra ID : le rôle se choisit dans le menu de démonstration (`src/lib/session.ts`).
- Données Keystone (projets, affectations) : référentiel local en attendant l'intégration.
