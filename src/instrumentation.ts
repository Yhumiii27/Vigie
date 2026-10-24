// Démarrage du serveur (Node.js) : validation de la configuration, voir src/instrumentation-node.ts.
// Erreurs serveur (rendu, server action, route, proxy) : journal structuré avec leur référence (PRD-10, onRequestError).
// (`process.env.NEXT_RUNTIME` est remplacé à la compilation par Next.js : seule lecture directe hors src/lib/env.ts.)

import type { Instrumentation } from 'next';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await (await import('./instrumentation-node')).registerNode();
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME === 'nodejs') await (await import('./instrumentation-node')).logRequestError(err, request, context);
};
