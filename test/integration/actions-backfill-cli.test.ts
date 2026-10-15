import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '@/db/migrations';

// Reprise des liens d'origine des actions (ACT-01, npm run db:reprise-liens = vigie-db reprise-liens), exécutée comme en production
// (processus séparé, variables d'environnement) sur une base PGlite migrée : essai, application, relance idempotente.
// Depuis la migration 0005, l'origine lue est l'ancienne origine conservée par la reprise (actions.legacy_origin) : les
// actions créées ensuite (legacy_origin vide) ne sont jamais examinées.

const ROOT = path.resolve(__dirname, '../..');
const TSX = path.join(ROOT, 'node_modules/tsx/dist/cli.mjs');

let dir: string;
let env: NodeJS.ProcessEnv;

function backfill(...args: string[]) {
  const r = spawnSync(process.execPath, [TSX, '--conditions=react-server', 'scripts/vigie-db.ts', 'reprise-liens', ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 120_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

async function withDb<T>(fn: (db: PGlite) => Promise<T>): Promise<T> {
  const db = new PGlite(path.join(dir, 'pglite'));
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}
const linksOf = () => withDb(async (db) => (await db.query<{ id: string; document_id: string | null; prevention_plan_id: string | null }>(
  'select id, document_id, prevention_plan_id from actions order by id')).rows);
const linkLogs = () => withDb(async (db) => (await db.query<{ entity_id: string; summary: string; by_id: string | null }>(
  "select entity_id, summary, by_id from change_log where entity_type = 'action' and action = 'link' order by id")).rows);

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vigie-reprise-liens-'));
  env = { ...process.env };
  delete env.DATABASE_URL;
  Object.assign(env, { VIGIE_DATA_DIR: path.join(dir, 'pglite'), VIGIE_UPLOAD_DIR: path.join(dir, 'uploads'), VIGIE_BACKUP_DIR: path.join(dir, 'backups') });
  await withDb(async (db) => {
    await migrate(drizzle(db), { migrationsFolder: MIGRATIONS_DIR });
    await db.exec(`
      insert into sites (id, label, sort) values ('ville-a', 'Site A', 1);
      insert into people (id, name, site_id) values ('clefevre', '[C. Lefèvre]', 'ville-a');
      insert into documents (id, title, type, process, owner_id) values ('PR-QHSE-002', 'Traitement des non-conformités', 'procedure', 'QHSE', 'clefevre');
      insert into actions (id, opened_on, detail, legacy_origin, source, origin_ref, site_id, pilot_id, due_on, initial_due_on, status) values
        ('A-001', '2026-10-01', 'Réviser la procédure', 'docs', 'revue_documentaire', 'PR-QHSE-002 après REX', 'ville-a', 'clefevre', '2026-11-15', '2026-11-15', 'a_faire'),
        ('A-002', '2026-10-01', 'Plan supprimé', 'prevention', null, 'PP-2026-099', 'ville-a', 'clefevre', '2026-11-15', '2026-11-15', 'a_faire'),
        ('A-003', '2026-10-01', 'Événement', 'ev', 'evenement', 'EV-2026-001', 'ville-a', 'clefevre', '2026-11-15', '2026-11-15', 'initiee'),
        -- Action créée après la migration 0005 (legacy_origin vide) : jamais examinée, même si sa référence désigne un document.
        ('A-004', '2026-10-12', 'Action récente', null, 'revue_documentaire', 'PR-QHSE-002', 'ville-a', 'clefevre', '2026-11-15', '2026-11-15', 'a_faire');
    `);
  });
}, 120_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('npm run db:reprise-liens', () => {
  it('essai, puis --appliquer, puis relance', async () => {
    const dry = backfill();
    expect(dry.out).toContain('essai, aucune écriture');
    expect(dry.out).toContain('2 actions Prévention, Documents ou Environnement examinées, 0 déjà rattachée');
    expect(dry.out).toContain('A-001 → document PR-QHSE-002');
    expect(dry.out).toContain('A-002 « PP-2026-099 » : Aucun plan de prévention ni permis de cette référence.');
    expect(dry.code).toBe(0);
    expect((await linksOf()).find((a) => a.id === 'A-001')?.document_id).toBeNull();
    expect(await linkLogs()).toEqual([]);

    const applied = backfill('--appliquer');
    expect(applied.out).toContain('liens enregistrés');
    expect(applied.out).toContain('Rattachées (1) :');
    expect(applied.code).toBe(0);
    expect(await linksOf()).toEqual([
      { id: 'A-001', document_id: 'PR-QHSE-002', prevention_plan_id: null },
      { id: 'A-002', document_id: null, prevention_plan_id: null },
      { id: 'A-003', document_id: null, prevention_plan_id: null },
      { id: 'A-004', document_id: null, prevention_plan_id: null },
    ]);
    expect(await linkLogs()).toEqual([{ entity_id: 'A-001', summary: "Origine rattachée : document PR-QHSE-002 (reprise de la référence d'origine)", by_id: null }]);

    const again = backfill('--appliquer');
    expect(again.out).toContain('1 déjà rattachée');
    expect(again.out).toContain('Aucun lien posé.');
    expect(again.code).toBe(0);
    expect(await linkLogs()).toHaveLength(1);
  });

  it('option inconnue, base absente : refus explicite', async () => {
    const unknown = backfill('--appliquer', '--tout');
    expect(unknown.code).toBe(2);
    expect(unknown.out).toContain('Option inconnue : --tout');
    const missing = spawnSync(process.execPath, [TSX, '--conditions=react-server', 'scripts/vigie-db.ts', 'reprise-liens'], {
      cwd: ROOT, env: { ...env, VIGIE_DATA_DIR: path.join(dir, 'absente') }, encoding: 'utf8', timeout: 120_000,
    });
    expect(missing.status).toBe(1);
    expect(`${missing.stdout}${missing.stderr}`).toContain('Aucune base PGlite');
  });
});
