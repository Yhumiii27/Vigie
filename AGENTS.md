# Vigie — consignes pour les agents de code

Les conventions du projet (stack, données, droits, données de santé, tests, migrations, exploitation) sont dans [`CLAUDE.md`](CLAUDE.md) : le lire en entier avant toute modification ; il fait foi et n'est pas recopié ici. Reste à faire et notes de livraison : [`docs/RESTE-A-FAIRE.md`](docs/RESTE-A-FAIRE.md) ; installation et vérifications : [`README.md`](README.md) (§ « Environnement de développement »).

- Interface et identifiants de route en français, code en anglais ; réponses à l'utilisateur en français.
- Ne jamais commiter de secret ; ne jamais modifier une migration publiée ; ne jamais réécrire `test/fixtures/todo-golden.json` sans changement voulu.
- Avant de rendre la main : `npm run typecheck`, `npm run lint`, `npm run knip`, `npm test`, `npm run db:check` (`scripts/dev-check.sh` les enchaîne).

Le bloc ci-dessous est géré par `next dev` (`agentRules`, QUA-27) : le garder tel quel, `src/lib/agents-md.test.ts` vérifie qu'il est à jour.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
