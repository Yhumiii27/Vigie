# VG-N04 — Tables déclarées dans le schéma `vigie` (proposition, 27 novembre 2026)

Point VG-N04 du reste à faire de Vigie (Norma, `reste-a-faire/vigie.json`) : `src/db/schema.ts` déclare ses 90 tables
avec `pgTable(…)` ; sur le serveur commun, `migrateServer()` (`src/db/migrations.ts`) réécrit `"public".` en `"vigie".`
au moment d'appliquer les migrations, et le pool pose `search_path=vigie`. Norma (`REGLES.md` § 4) demande des tables
déclarées dans le schéma de l'outil (`pgSchema(...).table(...)`, objet jamais exporté).

**Aucun code n'est changé par cette note** : le passage ne peut pas se faire sans risque ni sans décision du propriétaire.

## 1. Ce qui est déjà conforme

- Sur le serveur, tables, journal (`vigie.__drizzle_migrations`) et vues `pub_` sont dans `vigie` ; aucune migration ne
  contient `CREATE SCHEMA` ni `CREATE EXTENSION` ; `npm run db:check` (étape 6) contrôle la disposition et l'absence de
  toute mention de `public` après réécriture.
- `src/db/foreign.ts` déclare déjà les vues des autres outils par des `pgSchema` non exportés.

L'écart est donc de **forme de déclaration** (et PGlite dans `public`), pas de disposition sur le serveur.

## 2. Essai (copie jetable du dépôt, rien de commité)

`pgTable(` remplacé par `vigie.table(` avec `const vigie = pgSchema('vigie')` non exporté, puis `drizzle-kit generate` :

- drizzle-kit voit 90 tables **déplacées de `public` vers `vigie`** et pose, table par table, la question « créer ou
  déplacer » (mode interactif : impossible en CI) ;
- le choix par défaut (« créer ») produit une migration de 2 013 lignes : 90 `CREATE TABLE "vigie".…` puis
  90 `DROP TABLE "<table>" CASCADE` **non qualifiés**. Sur le serveur (`search_path=vigie`), elle échouerait au premier
  `CREATE TABLE` (table existante) ou, appliquée dans un autre ordre, **supprimerait les données de Vigie** ; en PGlite
  elle recréerait des tables vides ;
- le choix « déplacer » produirait des `ALTER TABLE "public".… SET SCHEMA "vigie"`, que `toServerSchema` réécrirait en
  `"vigie".… SET SCHEMA "vigie"` sur le serveur : sans objet au mieux, en erreur sinon.

Aucune de ces migrations n'est acceptable ; elles sont exactement la « migration de différence de schéma qui déplace les
tables » à éviter.

## 3. Options

### A — Garder `pgTable` + réécriture, dérogation inscrite dans Norma (recommandée à court terme)

- Rien ne bouge dans Vigie ; le propriétaire demande à Norma d'inscrire la dérogation (motif : base PGlite de
  démonstration et de l'application Mac dans `public`, migrations publiées depuis le 18/10/2026, réécriture contrôlée par
  `db:check`).
- Risque : nul pour les données ; l'écart de forme reste visible dans le reste à faire (point clos en « dérogation »).

### B — Passer à `pgSchema('vigie')`, PGlite repris dans `vigie` (lot dédié)

Travail, dans une seule PR, avec répétition sur une copie de base de l'application Mac et une sauvegarde serveur :

1. **Migration 0036 écrite à la main** : SQL sans effet (commentaire seul) sur les deux moteurs, instantané
   `drizzle/meta/0036_snapshot.json` produit par drizzle-kit avec le choix « déplacer » pour chaque table, puis SQL
   généré remplacé ; empreinte ajoutée à `drizzle/checksums.json`. Les migrations 0000 à 0035 restent intactes.
2. **PGlite repris dans `vigie`** (comme Codex, lot 11) : à l'ouverture, après la sauvegarde automatique, une base dont
   les tables sont dans `public` (et sans `vigie`) est reprise par `ALTER SCHEMA public RENAME TO vigie` puis
   `CREATE SCHEMA public` ; une base neuve reçoit `CREATE SCHEMA vigie` (permis en PGlite, jamais sur le serveur).
   PGlite applique alors les migrations par le même chemin que le serveur (`toServerSchema`, journal à décider :
   `drizzle.__drizzle_migrations` gardé ou déplacé dans `vigie`).
3. **Code et contrôles à reprendre** : `DB_LAYOUT`, `openPglite` (plus de `migrate()` de Drizzle), `db:check` étapes 5b
   et 6 (forme comparée dans le même schéma), `scripts/vigie-db.ts` (sauvegarde, restauration, `db:test-migrate`),
   restauration d'une **sauvegarde PGlite antérieure** (reprise à refaire après restauration), substituts des vues
   étrangères (`src/db/foreign-substitutes.ts`), `test/integration/server-layout.test.ts`,
   `published-columns-m18.test.ts`, `src/db/shape.test.ts`, déclaration du schéma à Matrix (`current_schema()`),
   SQL écrit à la main qui suppose `public`.
4. **Preuves** : une base PGlite de chaque version publiée reprise puis comparée (forme et lignes) à une base neuve ;
   une base serveur migrée de 0035 à 0036 sans aucun changement de forme (`db:check`), vues `pub_` de Matrix intactes ;
   ouverture d'une base de l'application Mac réelle (copie) avant diffusion.

- Risques : base de l'application Mac ou de démonstration rendue illisible si la reprise échoue à mi-chemin (d'où
  transaction + sauvegarde préalable + refus clair) ; restaurations d'anciennes sauvegardes ; prochaine version de
  drizzle-kit qui relirait l'instantané autrement ; effort estimé : un lot entier (2 à 3 jours avec la répétition).

### C — Passer à `pgSchema('vigie')` sur le serveur seulement

Impossible proprement : un même `schema.ts` sert les deux moteurs, et Drizzle refuse `pgSchema('public')`. Deux
déclarations ou un nom de schéma choisi à l'exécution casseraient drizzle-kit et les types. Écartée.

## 4. Ce que le propriétaire doit décider

1. **A ou B.** A : demande de dérogation à Norma (entrée de `dependances.json` ou note de `REGLES.md` § 4), VG-N04 clos
   « dérogation ». B : lot dédié planifié, avec répétition sur une copie de la base de l'application Mac.
2. Si B : la reprise automatique de PGlite à l'ouverture est-elle admise (comme Codex) ou faut-il une commande explicite
   (`vigie-db reprise-schema`) lancée par l'exploitant ?
3. Si B : les anciennes sauvegardes PGlite (avant 0036) doivent-elles rester restaurables (reprise après restauration),
   ou seulement par la version précédente de Vigie ?
