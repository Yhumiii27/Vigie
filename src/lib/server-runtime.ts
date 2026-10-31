// Contexte du serveur Next.js pour les tâches planifiées (PRD-12). Module sans 'server-only' ni dépendance : lu par
// src/instrumentation-node.ts (démarrage du serveur) et src/db/scheduler.ts (paquets distincts : état porté par globalThis).
//
// Le planificateur démarre à l'ouverture de la base, souvent pendant la première requête : ses minuteries hériteraient du
// contexte asynchrone de cette requête (session, cookies, mémoïsation React.cache de la requête). Le contexte racine, pris
// au démarrage du serveur hors de toute requête, en isole les passages.

import { AsyncLocalStorage } from 'node:async_hooks';

type ServerRuntime = { root: <R>(fn: () => R) => R };
const KEY = Symbol.for('vigie.serverRuntime');
const store = globalThis as unknown as Record<symbol, ServerRuntime | undefined>;

/** Au démarrage du serveur Next.js (instrumentation, runtime Node.js), hors de toute requête : prend le contexte racine. */
export function markServerRuntime(): void {
  store[KEY] ??= { root: AsyncLocalStorage.snapshot() as <R>(fn: () => R) => R };
}

/** Serveur Next.js démarré (instrumentation passée) ; undefined dans les scripts et les tests. */
export function serverRuntime(): ServerRuntime | undefined {
  return store[KEY];
}

/** Exécute `fn` dans le contexte racine du serveur (hors requête) ; tel quel hors du serveur Next.js. */
export function inRootContext<R>(fn: () => R): R {
  const runtime = serverRuntime();
  return runtime ? runtime.root(fn) : fn();
}
