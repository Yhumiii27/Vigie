import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll } from 'vitest';

// Mode PostgreSQL des tests d'intégration (QUA-04) : avec TEST_DATABASE_URL (serveur PostgreSQL, base d'administration,
// ex. postgres://vigie@127.0.0.1:55433/postgres), chaque fichier de test/integration reçoit sa propre base vide, créée
// avant le fichier (DATABASE_URL) puis supprimée après. Les fichiers de test restent inchangés : getDb() ouvre
// PostgreSQL au lieu de PGlite en mémoire, applique les migrations et, en démonstration, le jeu de démonstration.
// Sans TEST_DATABASE_URL : PGlite en mémoire (VIGIE_DATA_DIR=memory://, posé par chaque fichier).
//   TEST_DATABASE_URL=postgres://vigie@127.0.0.1:55433/postgres npx vitest run test/integration

const admin = process.env.TEST_DATABASE_URL;

/** URL de la base `name` sur le serveur de `url`. */
function databaseUrl(url: string, name: string) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function onServer(sql: string) {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: admin, application_name: 'vigie-tests' });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

if (admin) {
  let name: string | null = null;

  beforeAll(async ({}, suite) => {
    const file = 'filepath' in suite ? suite.filepath : '';
    if (!/[\\/]test[\\/]integration[\\/]/.test(file)) return;
    name = `vigie_test_${process.pid}_${randomBytes(4).toString('hex')}`;
    await onServer(`create database "${name}"`);
    process.env.DATABASE_URL = databaseUrl(admin, name);
  });

  // Exécuté après les afterAll du fichier de test (ordre inverse d'enregistrement) : la base est déjà fermée.
  afterAll(async () => {
    if (!name) return;
    const { closeDb } = await import('@/db');
    await closeDb();
    delete process.env.DATABASE_URL;
    await onServer(`drop database if exists "${name}" with (force)`);
    name = null;
  });
}
