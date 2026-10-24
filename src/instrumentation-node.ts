import type { Instrumentation } from 'next';
import { ConfigError, nextRuntime, readConfig } from './lib/env';
import { errorFields, log, pathOnly } from './lib/log';

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
    log.error('config.invalid', err.message);
    process.exit(1);
  }
  log.info('server.start', 'Serveur Vigie démarré', { demo: readConfig().demo, node: process.version });
}

/**
 * Erreur serveur capturée par Next.js (PRD-10) : journalisée avec sa référence (`digest`, affichée à l'utilisateur par les
 * pages d'erreur), la route et le contexte. Ni en-têtes (cookies), ni paramètres d'URL (filtres, jeton de poste), ni corps.
 */
export function logRequestError(
  err: unknown,
  request: Parameters<Instrumentation.onRequestError>[1],
  context: Parameters<Instrumentation.onRequestError>[2],
) {
  log.error('request.error', 'Erreur serveur', {
    ...errorFields(err),
    method: request.method,
    path: pathOnly(request.path),
    route: context.routePath,
    routeType: context.routeType,
  });
}
