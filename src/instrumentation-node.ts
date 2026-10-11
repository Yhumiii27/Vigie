import { ConfigError, nextRuntime, readConfig } from './lib/env';

/**
 * La configuration (src/lib/env.ts) est validée dès le démarrage : une variable manquante ou invalide arrête le serveur
 * (code 1) avec un message explicite, au lieu de servir des pages en erreur. Rien à valider pendant `next build`.
 */
export async function registerNode() {
  if (nextRuntime().phase === 'phase-production-build') return;
  try {
    readConfig();
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    // Le superviseur (Docker, application Mac) affiche ce message au lieu de pages en erreur.
    console.error(`[vigie] ${err.message}`);
    process.exit(1);
  }
}
