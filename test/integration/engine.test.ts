import { describe, expect, it, vi } from 'vitest';
import { freshDemoDatabase } from '../helpers';
import { count, isNull } from 'drizzle-orm';
import { getDb, getDbEngine, schema as t } from '@/db';

// Moteur des tests d'intégration (QUA-04) : PGlite en mémoire par défaut, PostgreSQL avec TEST_DATABASE_URL
// (base neuve par fichier, test/setup-postgres.ts). Migrations et jeu de démonstration identiques sur les deux moteurs.

// Route de santé appelée hors d'une requête Next.js : connection() (rendu dynamique) neutralisé.
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));

freshDemoDatabase();

describe('moteur de la base de test', () => {
  it('PostgreSQL avec TEST_DATABASE_URL, sinon PGlite ; base propre au fichier', async () => {
    expect(await getDbEngine()).toBe(process.env.TEST_DATABASE_URL ? 'postgres' : 'pglite');
    if (process.env.TEST_DATABASE_URL) expect(process.env.DATABASE_URL).toMatch(/\/vigie_test_\d+_[0-9a-f]{8}$/);
  });
  it('migrations et jeu de démonstration appliqués', async () => {
    const db = await getDb();
    const [[people], [activeSites], [events]] = await Promise.all([
      db.select({ n: count() }).from(t.people), db.select({ n: count() }).from(t.sites).where(isNull(t.sites.archivedAt)), db.select({ n: count() }).from(t.events),
    ]);
    expect([people.n, activeSites.n, events.n]).toEqual([13, 2, 22]);
  });
  it('route de santé : 200 et moteur de la base, sans détail interne', async () => {
    const { GET } = await import('@/app/api/sante/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ statut: 'ok', base: process.env.TEST_DATABASE_URL ? 'postgres' : 'pglite' });
  });
});
