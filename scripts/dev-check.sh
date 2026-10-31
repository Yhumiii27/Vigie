#!/usr/bin/env bash
# Vérifications avant de rendre la main ou d'ouvrir une demande de fusion (QUA-28), dans l'ordre de la CI
# (.github/workflows/ci.yml) : types, lint, code mort, tests (PGlite), migrations.
#
#   scripts/dev-check.sh          # vérifications rapides (quelques minutes)
#   scripts/dev-check.sh --pg     # en plus : tests d'intégration sur PostgreSQL (TEST_DATABASE_URL, par défaut le rôle
#                                 # local de scripts/dev-setup.sh --postgres)
#   scripts/dev-check.sh --build  # en plus : construction de démonstration (VIGIE_DEMO=1 npm run build)
#
# Parcours sur le serveur construit (cloisonnement du Salarié, Playwright) : README.md, § « Vérifications ».
set -euo pipefail
cd "$(dirname "$0")/.."

pg=0
build=0
for arg in "$@"; do
  case "$arg" in
    --pg) pg=1 ;;
    --build) build=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Option inconnue : $arg (--pg, --build)" >&2; exit 2 ;;
  esac
done

step() { echo; echo "── $1"; }
step "Types (next typegen + tsc)"; npm run typecheck
step "Lint"; npm run lint
step "Code mort (knip)"; npm run knip
step "Tests (PGlite en mémoire)"; npm test
if [ "$pg" = 1 ]; then
  step "Tests d'intégration (PostgreSQL)"
  TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgres://vigie:vigie@127.0.0.1:5432/postgres}" npx vitest run test/integration
fi
step "Migrations (db:check)"; npm run db:check
if [ "$build" = 1 ]; then
  step "Construction (démonstration)"; VIGIE_DEMO=1 npm run build
fi
echo; echo "Vérifications réussies."
