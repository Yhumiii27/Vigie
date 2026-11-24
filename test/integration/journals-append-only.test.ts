import '../next-mocks';
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { freshDemoDatabase } from '../helpers';
import { getDb } from '@/db';

// VG-N03 (Norma § 4) : les journaux d'audit (change_log, access_log) sont en ajout seul, tenus par la base
// (migration 0035) : mise à jour, suppression et troncature refusées par un déclencheur (SQLSTATE P0V04), en PGlite
// comme sur PostgreSQL (TEST_DATABASE_URL). L'ajout reste possible.

freshDemoDatabase();

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => ((await (await getDb()).execute(q)) as unknown as { rows: Row[] }).rows;

/** Code SQLSTATE de l'erreur levée par la requête (cause d'une erreur de Drizzle comprise), sinon null. */
async function sqlState(q: ReturnType<typeof sql>): Promise<string | null> {
  try {
    await (await getDb()).execute(q);
    return null;
  } catch (error) {
    let e: unknown = error;
    for (let i = 0; i < 4 && e; i += 1) {
      const code = (e as { code?: unknown }).code;
      if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
      e = (e as { cause?: unknown }).cause;
    }
    return String((error as Error).message ?? error);
  }
}

describe('journaux d’audit en ajout seul (VG-N03)', () => {
  it('change_log : ajout admis ; mise à jour, suppression et troncature refusées', async () => {
    const [added] = await rows(sql`insert into change_log (entity_type, entity_id, action, summary)
      values ('test', 'vg-n03', 'create', 'Essai du journal en ajout seul') returning id`);
    const id = Number(added.id);
    expect(id).toBeGreaterThan(0);
    expect(await sqlState(sql`update change_log set summary = 'modifié' where id = ${id}`)).toBe('P0V04');
    expect(await sqlState(sql`delete from change_log where id = ${id}`)).toBe('P0V04');
    expect(await sqlState(sql`truncate change_log`)).toBe('P0V04');
    const [kept] = await rows(sql`select summary from change_log where id = ${id}`);
    expect(kept.summary).toBe('Essai du journal en ajout seul');
  });

  it('access_log : ajout admis ; mise à jour, suppression et troncature refusées', async () => {
    const [added] = await rows(sql`insert into access_log (kind, entity_type, entity_id)
      values ('fichier', 'test', 'vg-n03') returning id`);
    const id = Number(added.id);
    expect(await sqlState(sql`update access_log set entity_id = 'autre' where id = ${id}`)).toBe('P0V04');
    expect(await sqlState(sql`delete from access_log where id = ${id}`)).toBe('P0V04');
    expect(await sqlState(sql`truncate access_log`)).toBe('P0V04');
    const [kept] = await rows(sql`select entity_id from access_log where id = ${id}`);
    expect(kept.entity_id).toBe('vg-n03');
  });

  it('les déclencheurs sont posés sur les deux journaux', async () => {
    const triggers = await rows(sql`select tgname from pg_trigger where not tgisinternal
      and tgrelid in ('change_log'::regclass, 'access_log'::regclass) order by tgname`);
    expect(triggers.map((r) => r.tgname)).toEqual([
      'access_log_append_only', 'access_log_no_truncate', 'change_log_append_only', 'change_log_no_truncate',
    ]);
  });
});
