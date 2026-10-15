// Démarrage du serveur (Node.js) : validation de la configuration, voir src/instrumentation-node.ts.
// (`process.env.NEXT_RUNTIME` est remplacé à la compilation par Next.js : seule lecture directe hors src/lib/env.ts.)

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await (await import('./instrumentation-node')).registerNode();
}
