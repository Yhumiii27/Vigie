import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema as t } from '@/db';
import { MAINTENANCE_INTERVAL_MS, RATE_LIMIT_RETENTION_MS, purgeExpiredRateLimits } from '@/db/maintenance';
import { MIGRATIONS_DIR } from '@/db/migrations';
import { resetConfig } from '@/lib/env';

// Purge périodique des compteurs du signalement sans compte (réserve EVT-07 / SEC-09 du lot 1) : à l'ouverture de la
// base, puis toutes les heures, sans attendre un signalement ; la minuterie s'arrête à la fermeture. Base PGlite sur
// disque (même en mode PostgreSQL, DATABASE_URL retirée).

const HOUR = 3600_000;
let dir: string;

/** Clés des compteurs, triées. */
async function keys() {
  const db = await getDb();
  return (await db.select({ key: t.reportRateLimits.key }).from(t.reportRateLimits)).map((r) => r.key).sort();
}

/** Attend (5 s au plus) que la condition soit vraie : passage de maintenance asynchrone. */
async function eventually(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('condition non remplie en 5 s');
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vigie-maintenance-'));
  const client = new PGlite(path.join(dir, 'pglite'));
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
  const now = Date.now();
  await client.query('insert into report_rate_limits (key, window_start, hits) values ($1, $2, 3), ($3, $4, 1)', [
    'ip:ancien', new Date(now - 25 * HOUR).toISOString(), 'ip:recent', new Date(now - HOUR).toISOString(),
  ]);
  await client.close();
  delete process.env.DATABASE_URL;
  Object.assign(process.env, {
    VIGIE_DEMO: '1', VIGIE_DATA_DIR: path.join(dir, 'pglite'), VIGIE_BACKUP_DIR: path.join(dir, 'backups'), VIGIE_UPLOAD_DIR: path.join(dir, 'uploads'),
  });
  resetConfig();
  await closeDb();
});
afterAll(async () => {
  vi.useRealTimers();
  await closeDb();
  for (const k of ['VIGIE_DATA_DIR', 'VIGIE_BACKUP_DIR', 'VIGIE_UPLOAD_DIR']) delete process.env[k];
  resetConfig();
  await rm(dir, { recursive: true, force: true });
});

describe('maintenance périodique', () => {
  it('compteurs de plus de 24 h purgés à l’ouverture, puis toutes les heures ; minuterie arrêtée à la fermeture', async () => {
    // Seule la minuterie horaire est simulée (PGlite garde ses propres délais).
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await getDb();
    await eventually(async () => (await keys()).join() === 'ip:recent');
    expect(vi.getTimerCount()).toBe(1);

    // Compteur devenu ancien sans nouveau signalement : purgé au passage suivant.
    const db = await getDb();
    await db.insert(t.reportRateLimits).values({ key: 'post:ancien', windowStart: new Date(Date.now() - RATE_LIMIT_RETENTION_MS - HOUR), hits: 1 });
    expect(await keys()).toEqual(['ip:recent', 'post:ancien']);
    vi.advanceTimersByTime(MAINTENANCE_INTERVAL_MS);
    await eventually(async () => (await keys()).join() === 'ip:recent');

    await closeDb();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('purge directe : nombre de lignes supprimées, compteurs récents conservés', async () => {
    const db = await getDb();
    const now = new Date();
    await db.insert(t.reportRateLimits).values([
      { key: 'ip:a', windowStart: new Date(now.getTime() - 30 * HOUR), hits: 1 },
      { key: 'ip:b', windowStart: new Date(now.getTime() - 24 * HOUR - 1), hits: 1 },
      { key: 'ip:c', windowStart: new Date(now.getTime() - 23 * HOUR), hits: 1 },
    ]);
    // Le passage d'ouverture a pu purger avant : on compte ce qui reste d'ancien.
    const before = (await keys()).filter((k) => ['ip:a', 'ip:b'].includes(k)).length;
    expect(await purgeExpiredRateLimits(db, now)).toBe(before);
    expect(await keys()).toEqual(['ip:c', 'ip:recent']);
    expect(await purgeExpiredRateLimits(db, now)).toBe(0);
  });
});
