#!/usr/bin/env bash
# Vérification de bout en bout de l'authentification Microsoft Entra ID (SEC-01, SEC-02, SEC-04, SEC-05), avec curl
# (fichiers de cookies, redirections suivies) et le fournisseur OIDC factice (scripts/oidc-mock.mjs).
#
# Prérequis :
#   1. base peuplée par le jeu de démonstration : démarrer une fois Vigie avec VIGIE_DEMO=1 et la même DATABASE_URL ;
#   2. fournisseur factice : node scripts/oidc-mock.mjs --port 55480 --redirect "$APP" ;
#   3. Vigie construit (npm run build) et lancé hors démonstration (next start) avec :
#        VIGIE_PUBLIC_URL=$APP  VIGIE_SESSION_SECRET=…  DATABASE_URL=…  VIGIE_UPLOAD_DIR=$UPLOAD_DIR
#        ENTRA_TENANT_ID=vigie-test ENTRA_CLIENT_ID=vigie ENTRA_CLIENT_SECRET=secret-de-test
#        ENTRA_ISSUER=http://127.0.0.1:55480/vigie-test/v2.0
#        VIGIE_SITE_GROUPS=grp-ville-a:ville-a,grp-ville-b:ville-b
#        VIGIE_EMAIL_DOMAINS=epc2i.example
#
# Usage : APP=http://localhost:3291 MOCK=http://127.0.0.1:55480 VIGIE_SESSION_SECRET=… \
#         PSQL="psql postgres://vigie@127.0.0.1:5432/vigie" UPLOAD_DIR=/chemin/uploads scripts/e2e-auth.sh
# PSQL et UPLOAD_DIR sont facultatifs (contrôles en base et pièces jointes par site). Code de sortie : nombre d'échecs.

set -u
APP=${APP:-http://localhost:3291}
MOCK=${MOCK:-http://127.0.0.1:55480}
PSQL=${PSQL:-}
UPLOAD_DIR=${UPLOAD_DIR:-}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
FAILS=0

ok() { echo "  ok    $1"; }
ko() { echo "  ÉCHEC $1"; FAILS=$((FAILS + 1)); }
check() { if [ "$2" = "$3" ]; then ok "$1"; else ko "$1 (obtenu « $2 », attendu « $3 »)"; fi; }
contains() { if grep -q -- "$3" <<<"$2"; then ok "$1"; else ko "$1 (« $3 » absent)"; fi; }
absent() { if grep -q -- "$3" <<<"$2"; then ko "$1 (« $3 » présent)"; else ok "$1"; fi; }
sql() { [ -n "$PSQL" ] && $PSQL -Atc "$1"; }

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
location() { curl -s -o /dev/null -w '%{redirect_url}' "$@" | sed "s#^$APP##"; }
jar() { echo "$WORK/jar-$1"; }

# Connexion complète : compte choisi chez le fournisseur, puis GET $APP<chemin> en suivant les redirections.
# Affiche « <code> <chemin final> » et garde la page dans $WORK/<compte>.html.
login() {
  local user=$1 path=${2:-/}
  rm -f "$(jar "$user")"
  curl -s -o /dev/null -c "$(jar "$user")" -b "$(jar "$user")" "$MOCK/_mock/login?user=$user"
  curl -s -L -c "$(jar "$user")" -b "$(jar "$user")" -o "$WORK/$user.html" -w '%{http_code} %{url_effective}' "$APP$path" | sed "s#$APP##"
}
session_cookie() { grep -E 'vigie_session' "$(jar "$1")" | awk '{print $7}'; }
selected_site() { grep -o 'vg-site-btn[^<]*<i[^>]*></i><span[^>]*>[^<]*' "$1" | sed -e 's/.*>//' -e "s/&#x27;/'/g"; }

# Server action setSite(siteId) : « cookie » si le site est accepté, « refus » sinon.
SET_SITE=$(python3 - "$ROOT/.next/server/server-reference-manifest.json" <<'EOF'
import json, sys
m = json.load(open(sys.argv[1]))
print(next((k for k, v in m.get('node', {}).items() if v.get('exportedName') == 'setSite'), ''))
EOF
)
set_site() {
  local out
  out=$(curl -s -D - -o /dev/null -b "$(jar "$1")" -X POST "$APP/" -H "Next-Action: $SET_SITE" -H 'Content-Type: text/plain;charset=UTF-8' \
    -H 'Accept: text/x-component' -H "Origin: $APP" --data "[\"$2\"]")
  if grep -qi "set-cookie: vigie_site=$2" <<<"$out"; then echo cookie; else echo refus; fi
}

# Session forgée (expirations) : mêmes clés que src/lib/auth/cookie.ts.
forge() { (cd "$ROOT" && npx tsx -e "
import { sealSession } from './src/lib/auth/cookie.ts';
const now = Math.floor(Date.now() / 1000);
sealSession({ pid: 'clefevre', role: 'Animateur QHSE', sites: null, oid: 'x', auth: now - $1, seen: now - $2 }, process.env.VIGIE_SESSION_SECRET!).then((t) => console.log(t));
"); }

HOST=${APP#*://}

echo "1. En-têtes et hôtes (SEC-04, SEC-05)"
H=$(curl -s -D - -o /dev/null "$APP/auth/acces")
contains "CSP à nonce" "$H" "script-src 'self' 'nonce-"
contains "frame-ancestors 'none'" "$H" "frame-ancestors 'none'"
contains "nosniff" "$H" "X-Content-Type-Options: nosniff"
contains "Permissions-Policy (caméra)" "$H" "camera=(self)"
absent "pas de X-Powered-By" "$H" "X-Powered-By"
[[ $APP == http://* ]] && absent "pas de HSTS en HTTP" "$H" "Strict-Transport-Security"
check "hôte inconnu refusé" "$(code -H 'Host: vigie.attaquant.example' "$APP/")" 400
check "X-Forwarded-Host inconnu refusé" "$(code -H 'X-Forwarded-Host: vigie.attaquant.example' "$APP/")" 400
check "127.0.0.1 refusé (hors démonstration)" "$(code -H "Host: 127.0.0.1:${HOST##*:}" "$APP/")" 400
check "route de santé depuis localhost : hôte admis" "$([ "$(code -H 'Host: localhost:1' "$APP/api/sante")" = 400 ] && echo refus || echo admis)" admis
check "POST d'une origine inconnue refusé" "$(code -X POST -H 'Origin: http://vigie.attaquant.example' "$APP/")" 403

echo "2. Sans session (SEC-01)"
check "page → connexion (avec retour)" "$(location "$APP/evenements?onglet=1")" "/auth/connexion?retour=%2Fevenements%3Fonglet%3D1"
check "pièce jointe → connexion" "$(location "$APP/fichiers/att-a")" "/auth/connexion?retour=%2Ffichiers%2Fatt-a"
check "server action sans session : 401" "$(code -X POST -H "Origin: $APP" -H "Next-Action: $SET_SITE" --data '["ville-a"]' "$APP/")" 401
check "cookie de rôle de démonstration ignoré" "$(location -b 'vigie_role=Direction' "$APP/")" "/auth/connexion?retour=%2F"
check "session falsifiée ignorée" "$(location -b 'vigie_session=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..AAAA.BBBB.CCCC' "$APP/")" "/auth/connexion?retour=%2F"
R=$(curl -s -D - -o /dev/null "$APP/evenements")
contains "refus du proxy : CSP fermée" "$R" "default-src 'none'"
contains "refus du proxy : jamais mis en cache" "$R" "no-store"
check "/signaler sans jeton → connexion (proxy)" "$(location "$APP/signaler")" "/auth/connexion?retour=%2Fsignaler"
contains "/signaler?jeton=… inconnu, sans session : page « QR code non reconnu » (EVT-07)" "$(curl -s "$APP/signaler?jeton=jeton-de-poste-0123456789")" "QR code non reconnu"
check "retour de connexion avec un state inconnu" "$(location "$APP/auth/retour?code=x&state=inconnu")" "/auth/acces?motif=echec"
L=$(curl -s -o /dev/null -w '%{redirect_url}' "$APP/auth/connexion?retour=%2Faudits")
contains "connexion : PKCE S256" "$L" "code_challenge_method=S256"
contains "connexion : nonce et state" "$L" "nonce="
contains "connexion : URI de retour publique" "$L" "redirect_uri=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$APP/auth/retour")"

echo "3. Connexions et rôles (SEC-01, SEC-02, SEC-03)"
check "animateur QHSE : connexion, retour à la page demandée" "$(login animateur '/evenements')" "200 /evenements"
contains "animateur : nom de la fiche rapprochée par e-mail" "$(cat "$WORK/animateur.html")" "C. Lefèvre"
[ -n "$PSQL" ] && check "animateur : objectId enregistré, dernier rôle" "$(sql "select entra_object_id is not null, last_role from people where id='clefevre'")" "t|Animateur QHSE"
check "animateur : « Tous les sites » proposé" "$(set_site animateur all)" cookie
check "animateur : site B" "$(set_site animateur ville-b)" cookie
check "direction (Salarié + Direction) : rôle le plus élevé" "$(login direction / >/dev/null; grep -o '>Direction</span>' "$WORK/direction.html" | head -1)" ">Direction</span>"
check "chef de service (e-mail en majuscules) : connexion" "$(login chefservice)" "200 /"
[ -n "$PSQL" ] && check "chef de service : fiche sbenali rapprochée" "$(sql "select count(*) from people where id='sbenali' and entra_object_id is not null")" 1
check "chef de service : site de rattachement par défaut" "$(selected_site "$WORK/chefservice.html")" "Site de [Ville A] — siège et ateliers"
check "chef de service : site B hors périmètre refusé" "$(set_site chefservice ville-b)" refus
check "chef de service : « Tous les sites » refusé" "$(set_site chefservice all)" refus
check "chef de service : site A accepté" "$(set_site chefservice ville-a)" cookie
check "salarié + groupe site B : connexion" "$(login salarie /evenements)" "200 /evenements"
check "salarié : site B accordé par groupe" "$(set_site salarie ville-b)" cookie
check "salarié : « Tous les sites » refusé" "$(set_site salarie all)" refus
check "salarié : cookie de site B → site B" "$(curl -s -b "$(jar salarie)" -b 'vigie_site=ville-b' "$APP/evenements" -o "$WORK/s2.html"; selected_site "$WORK/s2.html")" "Site de [Ville B] — zone d'essais"
check "salarié : écran fermé → accueil du rôle avant le rendu (SEC-14)" "$(location -b "$(jar salarie)" "$APP/veille")" "/evenements"
check "salarié : tableau de bord → accueil du rôle (SEC-14)" "$(location -b "$(jar salarie)" "$APP/")" "/evenements"
check "salarié : QR codes des postes → /signaler (SEC-14)" "$(location -b "$(jar salarie)" "$APP/signaler/postes")" "/signaler"
check "aperçu mobile hors démonstration : 404 (SEC-14)" "$(code -b "$(jar salarie)" "$APP/apercu-mobile")" 404
check "chef de projet du site B : connexion" "$(login essais)" "200 /"
check "chef de projet : cookie visant le site A → site B (rattachement)" "$(curl -s -b "$(jar essais)" -b 'vigie_site=ville-a' "$APP/" -o "$WORK/e2.html"; selected_site "$WORK/e2.html")" "Site de [Ville B] — zone d'essais"
check "nouvel utilisateur (salarié) : fiche créée, accueil du rôle" "$(login nouveau)" "200 /evenements"
if [ -n "$PSQL" ]; then
  check "nouvel utilisateur : site = premier site accordé, groupe inconnu ignoré" "$(sql "select site_id, last_role, email from people where entra_object_id is not null and name='Nina Rousseau'")" "ville-b|Salarié|n.rousseau@epc2i.example"
  check "nouvel utilisateur : création journalisée" "$(sql "select count(*) from change_log c join people p on p.id = c.entity_id where p.name='Nina Rousseau' and c.action='create'")" 1
fi
check "nouvel utilisateur : 2e connexion, même fiche" "$(login nouveau >/dev/null; sql "select count(*) from people where name='Nina Rousseau'" || echo 1)" 1
check "sans rôle Vigie : accès non autorisé" "$(login sansrole)" "200 /auth/acces?motif=non-autorise"
check "sans rôle : pas de cookie de session" "$(session_cookie sansrole)" ""
[ -n "$PSQL" ] && check "sans rôle : fiche non associée" "$(sql "select entra_object_id is null from people where id='proux'")" t
check "salarié sorti de l'effectif : refusé" "$(login parti)" "200 /auth/acces?motif=non-autorise"
check "non affecté à l'application (AADSTS50105) : refusé" "$(login nonaffecte)" "200 /auth/acces?motif=non-autorise"
check "adresse non vérifiée (xms_edov faux) : compte non rattaché" "$(login nonverifie)" "200 /auth/acces?motif=adresse"
contains "… page « Compte Microsoft non rattaché »" "$(cat "$WORK/nonverifie.html")" "Compte Microsoft non rattaché"
check "adresse non vérifiée : pas de cookie de session" "$(session_cookie nonverifie)" ""
[ -n "$PSQL" ] && check "adresse non vérifiée : fiche visée (mgirard) non associée" "$(sql "select entra_object_id is null from people where id='mgirard'")" t
check "domaine hors entreprise : compte non rattaché" "$(login horsdomaine)" "200 /auth/acces?motif=adresse"
[ -n "$PSQL" ] && check "domaine hors entreprise : aucune fiche créée" "$(sql "select count(*) from people where name='P. Durand (prestataire)'")" 0
check "retour vers une autre origine neutralisé" "$(login animateur '/auth/connexion?retour=https%3A%2F%2Fvigie.attaquant.example%2F')" "200 /"

if [ -n "$PSQL" ] && [ -n "$UPLOAD_DIR" ]; then
  echo "4. Pièces jointes et périmètre de sites"
  mkdir -p "$UPLOAD_DIR" && printf 'site A\n' >"$UPLOAD_DIR/att-a" && printf 'site B\n' >"$UPLOAD_DIR/att-b"
  sql "insert into attachments (id, entity_type, entity_id, file_name, mime_type, size, storage_path, uploaded_by) values
    ('att-a','event','EV-2026-125','a.txt','text/plain',7,'att-a','edubois'), ('att-b','event','EV-2026-109','b.txt','text/plain',7,'att-b','jpetit')
    on conflict (id) do nothing" >/dev/null
  check "animateur : pièce du site A" "$(code -b "$(jar animateur)" "$APP/fichiers/att-a")" 200
  check "animateur : pièce du site B" "$(code -b "$(jar animateur)" "$APP/fichiers/att-b")" 200
  check "chef de service (site A) : pièce du site A" "$(code -b "$(jar chefservice)" "$APP/fichiers/att-a")" 200
  check "chef de service (site A) : pièce du site B → 404" "$(code -b "$(jar chefservice)" "$APP/fichiers/att-b")" 404
  check "chef de projet (site B) : pièce du site A → 404" "$(code -b "$(jar essais)" "$APP/fichiers/att-a")" 404
  check "chef de projet (site B) : pièce du site B" "$(code -b "$(jar essais)" "$APP/fichiers/att-b")" 200
fi

echo "5. Expiration et renouvellement de la session"
if [ -n "${VIGIE_SESSION_SECRET:-}" ]; then
  check "inactivité > 8 h : reconnexion" "$(location -b "vigie_session=$(forge 32400 32400)" "$APP/")" "/auth/connexion?retour=%2F"
  check "plus de 12 h après la connexion : reconnexion" "$(location -b "vigie_session=$(forge 43300 60)" "$APP/")" "/auth/connexion?retour=%2F"
  R=$(curl -s -D - -o /dev/null -b "vigie_session=$(forge 3600 600)" "$APP/")
  contains "activité après 10 min : session renouvelée" "$R" "vigie_session="
  contains "cookie de session httpOnly, SameSite=Lax" "$R" "HttpOnly; SameSite=lax"
  absent "pas de renouvellement à chaque requête" "$(curl -s -D - -o /dev/null -b "vigie_session=$(forge 3600 30)" "$APP/")" "vigie_session="
else
  echo "  (VIGIE_SESSION_SECRET absent : contrôles d'expiration ignorés)"
fi

echo "6. Déconnexion"
check "déconnexion depuis un autre site (Sec-Fetch-Site: cross-site) : sans effet" "$(location -b "$(jar salarie)" -H 'Sec-Fetch-Site: cross-site' "$APP/auth/deconnexion")" "/"
check "… session toujours valide" "$(code -b "$(jar salarie)" "$APP/evenements")" 200
check "déconnexion : session Microsoft terminée, page « déconnecté »" "$(curl -s -L -c "$(jar salarie)" -b "$(jar salarie)" -o /dev/null -w '%{http_code} %{url_effective}' "$APP/auth/deconnexion" | sed "s#$APP##")" "200 /auth/deconnecte"
check "déconnexion : cookie de session effacé" "$(session_cookie salarie)" ""
check "après déconnexion : connexion requise" "$(location -b "$(jar salarie)" "$APP/")" "/auth/connexion?retour=%2F"

echo
if [ "$FAILS" -eq 0 ]; then echo "Tous les contrôles sont passés."; else echo "$FAILS contrôle(s) en échec."; fi
exit "$FAILS"
