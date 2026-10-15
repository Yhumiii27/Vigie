#!/bin/sh
# Démarrage du conteneur Vigie : en root, rend les dossiers de données à l'utilisateur vigie (volume /data créé par une
# image antérieure, ou monté par l'hébergeur avec le propriétaire root), puis lance la commande en vigie ; sinon, la lance
# telle quelle (hébergeur qui impose un utilisateur non root : les volumes doivent alors lui appartenir).
set -e
if [ "$(id -u)" = "0" ]; then
  for dir in "$VIGIE_DATA_DIR" "$VIGIE_UPLOAD_DIR" "$VIGIE_BACKUP_DIR"; do
    case "$dir" in /data/*) mkdir -p "$dir" && find "$dir" ! -user vigie -exec chown vigie:vigie {} + ;; esac
  done
  [ -n "$VIGIE_BACKUP_DIR" ] && [ -d "$VIGIE_BACKUP_DIR" ] && chmod 700 "$VIGIE_BACKUP_DIR"
  exec su-exec vigie "$@"
fi
exec "$@"
