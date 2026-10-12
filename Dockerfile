# Image de mise en ligne de Vigie (Coolify ou tout hébergeur Docker).
# - Port interne : 3000.
# - Données : /data (base PGlite dans /data/db, pièces jointes dans /data/uploads) — y monter un volume
#   persistant, sinon elles sont perdues à chaque déploiement.
FROM node:22-bookworm-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# La base éventuellement créée pendant le build ne doit pas rester dans l'image.
RUN npm run build && rm -rf .data

ENV NODE_ENV=production \
    VIGIE_DATA_DIR=/data/db \
    VIGIE_UPLOAD_DIR=/data/uploads \
    TZ=Europe/Paris

EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "--port", "3000", "--hostname", "0.0.0.0"]
