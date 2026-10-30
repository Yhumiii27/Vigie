#!/usr/bin/env bash
# Environnement de développement reproductible de Vigie (QUA-28) : Node de .nvmrc, dépendances du package-lock.json,
# types générés, PostgreSQL local facultatif pour les tests d'intégration. Aucun secret : la démonstration n'exige
# aucune variable, et le rôle PostgreSQL de test (vigie/vigie, superutilisateur local) est celui de la CI.
#
#   scripts/dev-setup.sh               # contrôle de Node, npm ci, next typegen
#   scripts/dev-setup.sh --postgres    # en plus : rôle « vigie » sur le PostgreSQL local (sudo -u postgres), pour
#                                      # TEST_DATABASE_URL=postgres://vigie:vigie@127.0.0.1:5432/postgres npm test
#   scripts/dev-setup.sh --no-install  # sans npm ci (dépendances déjà installées)
#
# Ensuite : npm run dev (http://localhost:3200, démonstration) ; vérifications : scripts/dev-check.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

postgres=0
install=1
for arg in "$@"; do
  case "$arg" in
    --postgres) postgres=1 ;;
    --no-install) install=0 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Option inconnue : $arg (--postgres, --no-install)" >&2; exit 2 ;;
  esac
done

want="$(tr -d ' \n\r' < .nvmrc)"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js absent : installez Node $want (nvm install, fnm install ou volta install node@$want)." >&2
  exit 1
fi
have="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$have" != "$want" ]; then
  echo "Node $have détecté, Node $want attendu (.nvmrc, comme la CI) : nvm use, fnm use ou volta pin node@$want." >&2
  exit 1
fi
echo "Node $(node -v) (attendu : $want, .nvmrc)."

if [ "$install" = 1 ]; then
  npm ci --no-audit --no-fund
fi
# Types des routes (LayoutProps, PageProps) : next-env.d.ts et .next/types ne sont pas versionnés.
npx next typegen >/dev/null
echo "Types des routes générés (next typegen)."

if [ "$postgres" = 1 ]; then
  if ! command -v psql >/dev/null 2>&1; then
    echo "PostgreSQL absent : installez PostgreSQL 16 (même version majeure que docker-compose.yml et la CI), ou lancez" >&2
    echo "  docker run -d --name vigie-pg -p 5432:5432 -e POSTGRES_USER=vigie -e POSTGRES_PASSWORD=vigie postgres:16" >&2
    exit 1
  fi
  if command -v pg_ctlcluster >/dev/null 2>&1; then
    # Debian, Ubuntu : grappe « main » de la première version installée, démarrée si besoin.
    version="$(ls /etc/postgresql 2>/dev/null | sort -n | head -1)"
    if [ -n "$version" ]; then pg_ctlcluster "$version" main start 2>/dev/null || true; fi
  fi
  # Rôle de test créé s'il manque (SQL lu sur l'entrée standard : aucun guillemet à protéger).
  if [ "$(id -u)" = 0 ] && id postgres >/dev/null 2>&1; then as_postgres=(su postgres -s /bin/sh -c 'psql -X -q -v ON_ERROR_STOP=1');
  elif command -v sudo >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then as_postgres=(sudo -u postgres psql -X -q -v ON_ERROR_STOP=1);
  else as_postgres=(psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres); fi
  "${as_postgres[@]}" <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vigie') THEN CREATE ROLE vigie LOGIN SUPERUSER PASSWORD 'vigie'; END IF;
END $$;
SQL
  PGPASSWORD=vigie psql -X -q -h 127.0.0.1 -U vigie -d postgres -c 'select 1' >/dev/null
  echo "PostgreSQL prêt : TEST_DATABASE_URL=postgres://vigie:vigie@127.0.0.1:5432/postgres npm test"
fi

echo "Prêt : npm run dev (http://localhost:3200, démonstration) ; vérifications : scripts/dev-check.sh."
