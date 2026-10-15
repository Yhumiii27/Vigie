# syntax=docker/dockerfile:1
# Image de Vigie (PRD-01) : serveur Next.js autonome (sortie standalone), utilisateur non root, données dans /data.
#
#   docker build -t vigie .                        (réseau requis : npm, polices Google, paquets Alpine)
#   docker compose up -d                           Vigie + PostgreSQL, voir docker-compose.yml
#
# Image générique : aucune variable n'est figée à la construction ; la configuration (src/lib/env.ts) est lue et
# validée au démarrage du conteneur, qui s'arrête avec un message explicite si elle est incomplète.
# Installation, configuration Entra ID, sauvegardes et mises à jour : docs/EXPLOITATION.md.

ARG NODE_VERSION=22
# Version majeure du serveur PostgreSQL utilisé : pg_dump et pg_restore (sauvegardes) doivent être de la même version.
ARG PG_MAJOR=16

# ─── Dépendances (développement compris : construction) ─────────────────────
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ─── Construction : serveur autonome + outil vigie-db ───────────────────────
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 VIGIE_STANDALONE=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm run build:ops && mkdir -p public

# ─── Exécution ──────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runtime
ARG PG_MAJOR
RUN apk add --no-cache tini su-exec tzdata postgresql${PG_MAJOR}-client \
 && addgroup -S -g 10001 vigie && adduser -S -D -H -u 10001 -G vigie -h /app vigie \
 && mkdir -p /data/db /data/uploads /data/backups /data/mails && chown -R vigie:vigie /data && chmod 700 /data/backups
WORKDIR /app
# Chemins de données absolus, hors du dossier de l'application (volumes) ; base PostgreSQL : DATABASE_URL.
# /data/db et /data/uploads : mêmes chemins que la première image Coolify (un volume /data existant reste lu).
# /data/mails : e-mails du transport « fichier » (VIGIE_MAIL_TRANSPORT=fichier, défaut d'une image en démonstration) ;
# l'application, en lecture seule pour vigie, ne peut pas écrire dans /app/.data.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 TZ=Europe/Paris \
    VIGIE_DATA_DIR=/data/db VIGIE_UPLOAD_DIR=/data/uploads VIGIE_BACKUP_DIR=/data/backups VIGIE_MAIL_DIR=/data/mails
# Application en lecture seule pour l'utilisateur vigie (fichiers à root) ; seuls /data et le cache Next.js s'écrivent.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY --chmod=755 docker/vigie-db /usr/local/bin/vigie-db
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/vigie-entrypoint
RUN mkdir -p .next/cache && chown vigie:vigie .next/cache
# Démarrage en root le temps de rendre /data à l'utilisateur vigie (volume créé par une image antérieure, propriété de
# root), puis serveur lancé en vigie (su-exec) ; lancé directement en non-root si l'hébergeur l'impose.
EXPOSE 3000
VOLUME ["/data/db", "/data/uploads", "/data/backups", "/data/mails"]
# Route de santé : 200 quand la base répond (src/app/api/sante/route.ts). Premier démarrage : migrations, sauvegarde.
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/sante').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/vigie-entrypoint"]
CMD ["node", "server.js"]
