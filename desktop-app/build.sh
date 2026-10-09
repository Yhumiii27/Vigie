#!/usr/bin/env bash
# Construit Vigie.app (application Mac native : AppKit + WKWebView) et l'installe sur le Bureau.
#
#   bash desktop-app/build.sh                 compile, signe (ad hoc) et installe ~/Desktop/Vigie.app
#   bash desktop-app/build.sh --applications  installe dans ~/Applications/Vigie.app, avec sur le Bureau
#                                             un lien Vigie.app (conseillé si iCloud synchronise le Bureau)
#   bash desktop-app/build.sh --no-quit       ne ferme pas Vigie s'il est ouvert (nouvelle version au
#                                             prochain lancement)
#   bash desktop-app/build.sh --no-install    compile et signe seulement : desktop-app/build/Vigie.app
#   VIGIE_INSTALL_DIR=/autre/dossier bash desktop-app/build.sh   installe ailleurs que sur le Bureau
#
# Prérequis : outils de ligne de commande Apple (swiftc, sips, iconutil, codesign) — Xcode n'est
# pas nécessaire — et Node.js pour faire tourner Vigie. Voir desktop-app/README.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"
BUILD_DIR="$SCRIPT_DIR/build"
APP="$BUILD_DIR/Vigie.app"
INSTALL_DIR="${VIGIE_INSTALL_DIR:-$HOME/Desktop}"
TARGET="arm64-apple-macos13.0"
INSTALL=1
QUIT_RUNNING=1
USE_APPLICATIONS=0

for arg in "$@"; do
  case "$arg" in
    --no-install) INSTALL=0 ;;
    --no-quit) QUIT_RUNNING=0 ;;
    --applications) USE_APPLICATIONS=1 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Option inconnue : $arg (voir --help)" >&2; exit 2 ;;
  esac
done

step() { printf '\n==> %s\n' "$*"; }
warn() { printf 'Attention : %s\n' "$*" >&2; }
die() { printf 'Erreur : %s\n' "$*" >&2; exit 1; }

# --- Vérifications -----------------------------------------------------------------------------

command -v swiftc >/dev/null 2>&1 \
  || die "swiftc introuvable. Installez les outils de ligne de commande : xcode-select --install"
for tool in sips iconutil codesign plutil ditto; do
  command -v "$tool" >/dev/null 2>&1 || die "outil système introuvable : $tool"
done
[ -f "$PROJECT_DIR/package.json" ] || die "package.json introuvable dans $PROJECT_DIR"

SDK_ARGS=()
if SDK_PATH="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null)" && [ -n "$SDK_PATH" ]; then
  SDK_ARGS=(-sdk "$SDK_PATH")
fi

# Dossier de Node.js inscrit dans l'application : une app lancée depuis le Finder ne voit pas le
# PATH du Terminal. Elle cherche aussi Homebrew, /usr/local, nvm, Volta… si ce dossier disparaît.
if NODE_BIN="$(command -v node 2>/dev/null)" && [ -n "$NODE_BIN" ]; then
  NODE_DIR="$(dirname "$NODE_BIN")"
  echo "Node.js : $NODE_BIN ($("$NODE_BIN" --version 2>/dev/null || echo 'version inconnue'))"
else
  NODE_DIR="/opt/homebrew/bin"
  warn "node introuvable dans le PATH ; dossier par défaut retenu : $NODE_DIR (brew install node)"
fi
[ -d "$PROJECT_DIR/node_modules/next" ] || warn "node_modules incomplet : lancez « npm install » dans $PROJECT_DIR"

echo "Projet  : $PROJECT_DIR"

# --- Paquet .app -------------------------------------------------------------------------------

step "Préparation de $APP"
rm -rf "$APP" "$BUILD_DIR/Vigie.iconset"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

step "Icône (dessinée par icon/make_icon.swift)"
swiftc -O -swift-version 6 -parse-as-library -target "$TARGET" ${SDK_ARGS[@]+"${SDK_ARGS[@]}"} \
  "$SCRIPT_DIR/icon/make_icon.swift" "$SCRIPT_DIR/Sources/BrandMark.swift" \
  -o "$BUILD_DIR/make_icon"
"$BUILD_DIR/make_icon" "$BUILD_DIR/Vigie-1024.png"
ICONSET="$BUILD_DIR/Vigie.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$BUILD_DIR/Vigie-1024.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$BUILD_DIR/Vigie-1024.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/Vigie.icns"

step "Compilation de l'application (swiftc, $TARGET)"
swiftc -O -swift-version 6 -target "$TARGET" ${SDK_ARGS[@]+"${SDK_ARGS[@]}"} \
  -module-name Vigie -framework AppKit -framework WebKit \
  "$SCRIPT_DIR"/Sources/*.swift \
  -o "$APP/Contents/MacOS/Vigie"

step "Info.plist"
PLIST="$APP/Contents/Info.plist"
cp "$SCRIPT_DIR/Resources/Info.plist" "$PLIST"
plutil -replace VigieProjectPath -string "$PROJECT_DIR" "$PLIST"
plutil -replace VigieNodeDir -string "$NODE_DIR" "$PLIST"
plutil -lint "$PLIST"
printf 'APPL????' > "$APP/Contents/PkgInfo"

step "Signature ad hoc"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

if [ "$INSTALL" -eq 0 ]; then
  printf '\nApplication construite : %s\n' "$APP"
  exit 0
fi

# --- Installation ------------------------------------------------------------------------------

# Vrai si le dossier (ou l'un de ses parents) est synchronisé par un fournisseur de fichiers
# (iCloud Drive pour le Bureau et les Documents, par exemple).
in_file_provider_domain() {
  local dir="$1"
  while [ -n "$dir" ] && [ "$dir" != "/" ]; do
    xattr -p com.apple.file-provider-domain-id "$dir" >/dev/null 2>&1 && return 0
    dir="$(dirname "$dir")"
  done
  return 1
}

if [ "$USE_APPLICATIONS" -eq 1 ]; then
  BUNDLE_DIR="${VIGIE_APP_DIR:-$HOME/Applications}"
  LINK="$INSTALL_DIR/Vigie.app"
else
  BUNDLE_DIR="$INSTALL_DIR"
  LINK=""
fi
DEST="$BUNDLE_DIR/Vigie.app"
step "Installation dans $BUNDLE_DIR"

RUNNING_PATTERN='/Vigie\.app/Contents/MacOS/Vigie$'
KEPT_RUNNING=0
if pgrep -f "$RUNNING_PATTERN" >/dev/null 2>&1; then
  if [ "$QUIT_RUNNING" -eq 1 ]; then
    # Demande de fermeture comme avec ⌘Q (événement Apple), comprise par toutes les versions de Vigie,
    # qui arrête proprement le serveur lancé ; SIGTERM en dernier recours.
    echo "Vigie est ouvert : fermeture avant remplacement…"
    osascript -e 'tell application id "com.epc2i.vigie" to quit' >/dev/null 2>&1 || true
    for _ in $(seq 1 150); do
      pgrep -f "$RUNNING_PATTERN" >/dev/null 2>&1 || break
      sleep 0.1
    done
    if pgrep -f "$RUNNING_PATTERN" >/dev/null 2>&1; then
      pkill -TERM -f "$RUNNING_PATTERN" 2>/dev/null || true
      for _ in $(seq 1 100); do
        pgrep -f "$RUNNING_PATTERN" >/dev/null 2>&1 || break
        sleep 0.1
      done
    fi
    if pgrep -f "$RUNNING_PATTERN" >/dev/null 2>&1; then
      die "Vigie est toujours ouvert : quittez-le (⌘Q), puis relancez ce script."
    fi
  else
    # L'application ouverte continue avec son code déjà chargé : le paquet est remplacé (nouveaux
    # fichiers, pas de réécriture en place), et la nouvelle version servira au prochain lancement.
    echo "Vigie est ouvert : il reste ouvert (--no-quit)."
    KEPT_RUNNING=1
  fi
fi

mkdir -p "$BUNDLE_DIR"
SYNCED=0
if in_file_provider_domain "$BUNDLE_DIR"; then
  SYNCED=1
  # Dossier synchronisé (iCloud Drive) : le paquet est exclu de la synchronisation (macOS 14 ou plus
  # récent), pour qu'il ne soit ni envoyé sur iCloud ni retiré du disque par l'optimisation du stockage.
  # L'attribut est posé avant l'arrivée du paquet dans le dossier synchronisé.
  xattr -w 'com.apple.fileprovider.ignore#P' 1 "$APP" 2>/dev/null || true
fi
if [ -L "$DEST" ]; then rm -f "$DEST"; else rm -rf "$DEST"; fi
# Déplacement (même volume) plutôt que copie : le paquet arrive d'un bloc avec ses attributs, et il
# n'en reste qu'un exemplaire (Spotlight, « Ouvrir avec »).
if ! mv "$APP" "$DEST" 2>/dev/null; then
  ditto "$APP" "$DEST"
  rm -rf "$APP"
fi
touch "$DEST"

if [ -n "$LINK" ]; then
  # Lien sur le Bureau vers l'application (remplace une ancienne copie du paquet).
  if [ -L "$LINK" ]; then rm -f "$LINK"; elif [ -e "$LINK" ]; then rm -rf "$LINK"; fi
  mkdir -p "$INSTALL_DIR"
  ln -s "$DEST" "$LINK"
  echo "Lien : $LINK -> $DEST"
fi

# Vérification stricte de la signature. Sur un dossier synchronisé par iCloud Drive, iCloud peut
# ajouter au paquet un attribut com.apple.FinderInfo, que --strict refuse alors que la signature reste
# valide : c'est signalé comme tel, jamais présenté comme une vérification réussie.
# Message de codesign --strict dû à l'attribut com.apple.FinderInfo (« Finder information, or similar detritus »).
is_icloud_detritus() {
  case "$1" in
    *detritus*|*FinderInfo*) return 0 ;;
    *) return 1 ;;
  esac
}
verify_installed() {
  xattr -d com.apple.FinderInfo "$DEST" 2>/dev/null || true
  local output
  if output="$(codesign --verify --deep --strict "$DEST" 2>&1)"; then
    return 0
  fi
  codesign --verify --deep "$DEST" || die "signature invalide après installation : $DEST"
  if [ "$SYNCED" -eq 1 ] && is_icloud_detritus "$output"; then
    return 1
  fi
  die "vérification stricte refusée : $output"
}
STRICT_OK=1
verify_installed || STRICT_OK=0
if [ "$SYNCED" -eq 1 ] && [ "$STRICT_OK" -eq 1 ]; then
  # iCloud agit avec un temps de retard : seconde vérification quelques secondes plus tard.
  sleep 4
  if ! output="$(codesign --verify --deep --strict "$DEST" 2>&1)"; then
    codesign --verify --deep "$DEST" || die "signature invalide après installation : $DEST"
    is_icloud_detritus "$output" || die "vérification stricte refusée : $output"
    STRICT_OK=0
  fi
fi
if [ "$STRICT_OK" -eq 1 ]; then
  echo "Signature vérifiée (codesign --verify --deep --strict) : $DEST"
else
  warn "vérification stricte (codesign --strict) refusée : iCloud Drive synchronise $BUNDLE_DIR et a ajouté au paquet un attribut com.apple.FinderInfo."
  warn "La signature elle-même est valide (vérification non stricte réussie) et l'application s'ouvre normalement."
  warn "Pour une installation hors iCloud : bash desktop-app/build.sh --applications"
fi

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
[ -x "$LSREGISTER" ] && "$LSREGISTER" -f "$DEST" >/dev/null 2>&1 || true

printf '\nVigie.app installée : %s\n' "$DEST"
if [ "$KEPT_RUNNING" -eq 1 ]; then
  echo "Vigie était ouvert et l'est resté : quittez-le (⌘Q) puis rouvrez-le pour utiliser la nouvelle version."
fi
echo "Double-cliquez sur l'icône Vigie du Bureau pour l'ouvrir. Journal : ~/Library/Logs/Vigie/server.log"
