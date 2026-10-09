# Vigie (QHSE) — notes projet

Outil QHSE du système EPC2i (avec Keystone, Codex, Cursus). Maquette source : `design/Vigie.dc.html` (+ `design/_ds/nocturne-…/` pour le design system).

## Next.js 16

Cette version de Next.js a des changements incompatibles avec les versions antérieures (API asynchrones `cookies()`, `params`, `searchParams`…). Lire le guide concerné dans `node_modules/next/dist/docs/` avant d'écrire du code.

## Conventions

- Stack : Next.js 16.4 (App Router) + React 19.3 + PGlite/Drizzle, comme Keystone et Codex. Port de dev : 3200.
- Données : `src/db/schema.ts` → `npm run db:generate` produit la migration dans `drizzle/` ; elle est appliquée à l'ouverture de la base (`src/db/index.ts`), puis `seed.ts` remplit une base vide.
- Les indicateurs (TF1/TG, retards, échéances, statuts de contrôles et d'habilitations) sont **calculés** dans `src/lib/queries.ts` à partir des données et de la date du jour — ne pas les stocker.
- Chargements par écran dans `src/lib/data/<domaine>.ts`, server actions dans `src/server/<domaine>.ts` (validation `formReader`, droits `requireManager` / `requireApprover`, `revalidatePath('/', 'layout')`). Les données portant un `siteId` sont filtrées avec `currentSiteId()` / `inSite`.
- Formulaires : `ActionForm` + `Field`/`Input`/`Select` (`src/components/form.tsx`) dans un `Dialog`/`DialogButton` ; création d'action depuis n'importe quel écran avec `NewActionButton` (champ `link` pour rattacher l'action à sa source).
- Toute nouvelle échéance transverse passe par `load<Domaine>Signals()` puis `src/lib/data/todo.ts` (tableau de bord, notifications) et `counters.ts` (badges).
- Libellés, tons, rôles et navigation : `src/lib/domain.ts`. Styles : `src/app/nocturne.css` (copie du DS, ne pas modifier) et `src/app/vigie.css`.
- Interface et identifiants de route en français ; code en anglais.

## Intégrations prévues

- Habilitations et formations : l'écran doit aussi communiquer avec l'outil **Cursus**, propriétaire des données personnelles des employés (source de vérité RH). Lucca reste la source d'import provisoire du personnel ; Cursus doit apparaître comme connecteur/source dans les futures itérations de cet écran.
- Keystone : projets liés aux événements, affectations du planning (alerte habilitation), projets concernés par la veille.
- Authentification Microsoft Entra ID : remplacera le sélecteur de rôle de démonstration (`src/lib/session.ts`).
