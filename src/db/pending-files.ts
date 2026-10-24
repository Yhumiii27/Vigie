// Fichiers écrits pendant une transaction (PRD-13) : une pièce jointe est écrite sur disque avant sa ligne, dans la
// transaction de l'écriture (saveUpload(…, { db: tx })). Si la transaction est annulée (erreur, limite, conflit), ses
// fichiers sont effacés aussitôt : aucun fichier orphelin. db.transaction() (src/db/index.ts) ouvre ce contexte ; un arrêt
// brutal du processus entre l'écriture et la validation laisse un orphelin, retiré par la maintenance (sweepOrphanUploads).
// Module sans 'server-only' ni dépendance : testé dans test/integration/uploads-storage.test.ts.

import { AsyncLocalStorage } from 'node:async_hooks';
import { unlink } from 'node:fs/promises';

type Pending = { files: string[] };
const store = new AsyncLocalStorage<Pending>();

/** Inscrit un fichier écrit dans la transaction en cours (sans transaction en cours : rien). */
export function trackTransactionFile(file: string) {
  store.getStore()?.files.push(file);
}

/**
 * Exécute une transaction ; si elle échoue, les fichiers inscrits pendant celle-ci sont effacés, puis l'erreur est relancée.
 * Transaction imbriquée dans une autre (même contexte) : les fichiers restent à la charge de la transaction extérieure.
 */
export async function withTransactionFiles<T>(run: () => Promise<T>): Promise<T> {
  if (store.getStore()) return run();
  const pending: Pending = { files: [] };
  try {
    return await store.run(pending, run);
  } catch (err) {
    await Promise.all(pending.files.map((f) => unlink(f).catch(() => {})));
    throw err;
  }
}
