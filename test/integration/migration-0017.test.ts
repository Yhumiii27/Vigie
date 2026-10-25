import '../next-mocks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_0004_MIGRATIONS, openLegacyBase, type LegacyBase } from '../fixtures/legacy-base';

// Migrations du paquet 10 sur la base de démonstration 0004 (test/fixtures/demo-0004.json), PGlite et PostgreSQL
// (TEST_DATABASE_URL) :
// - 0016_finding_actions (AUD-28) : l'action de chaque constat reprise dans finding_actions, colonne supprimée ;
// - 0017_state_constraints (QUA-23) : réparation sans perte (motif vide d'un élément ni archivé ni annulé → NULL), puis
//   toute autre incohérence fait échouer la migration avec la liste des contraintes, sans rien modifier (base laissée en
//   0016) ; une fois les lignes corrigées, la migration passe et les contraintes refusent toute nouvelle incohérence.

const BEFORE_0016 = 16; // 0000 à 0015
const BEFORE_0017 = 17; // 0000 à 0016

async function journalCount(base: LegacyBase) {
  const [{ n }] = (await base.query(`select count(*)::int as n from ${base.journal}`)).rows as { n: number }[];
  return n;
}

describe('migrations 0016 et 0017 sur une base existante', () => {
  let base: LegacyBase;
  beforeAll(async () => {
    base = await openLegacyBase({ reset: true });
    await base.migrateUpTo(DEMO_0004_MIGRATIONS);
    await base.loadFixture();
    await base.migrateUpTo(BEFORE_0016);
  });
  afterAll(async () => {
    await base?.close();
  });

  it('0016 : actions des constats reprises dans finding_actions, colonne audit_findings.action_id supprimée', async () => {
    const before = (await base.query('select id, action_id from audit_findings where action_id is not null order by id')).rows;
    expect(before.length).toBeGreaterThan(0);
    await base.migrateUpTo(BEFORE_0017);
    const after = (await base.query('select finding_id as id, action_id from finding_actions order by finding_id')).rows;
    expect(after).toEqual(before);
    const [{ n }] = (await base.query(`select count(*)::int as n from information_schema.columns where table_schema = $1 and table_name = 'audit_findings' and column_name = 'action_id'`, [base.schema])).rows as { n: number }[];
    expect(n).toBe(0);
  });

  it('0017 : incohérences signalées par contrainte, migration annulée, rien modifié', async () => {
    // Réparable sans perte : motif vide d'un risque non archivé.
    await base.query("update risks set archive_reason = '  ' where id = 3");
    // Non réparables : date sans motif, motif sans date, statut inconnu, revue annulée sans date d'annulation.
    await base.query("update risks set archived_at = now(), archive_reason = null where id = 4");
    await base.query("update sites set archive_reason = 'Fermé' where id = 'ville-b'");
    await base.query("update document_versions set status = 'perime' where id = (select min(id) from document_versions)");
    await base.query("update reviews set status = 'annulee' where id = (select min(id) from reviews)");
    const err = await base.migrateAll().then(() => null, (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    const message = `${err!.message} ${String((err as { cause?: unknown }).cause ?? '')}`;
    for (const name of ['risks_archive_check', 'sites_archive_check', 'document_versions_status_check', 'reviews_cancel_status_check']) {
      expect(message).toContain(`${name} : 1 ligne(s)`);
    }
    expect(message).toContain('QUA-23');
    expect(await journalCount(base)).toBe(BEFORE_0017);
    const [risk3] = (await base.query('select archive_reason from risks where id = 3')).rows;
    expect(risk3).toEqual({ archive_reason: '  ' }); // la réparation est annulée avec la migration
  });

  it('0017 : lignes corrigées, migration appliquée (réparation sans perte faite), contraintes actives', async () => {
    await base.query("update risks set archive_reason = 'Danger supprimé' where id = 4");
    await base.query("update sites set archive_reason = null where id = 'ville-b'");
    await base.query("update document_versions set status = 'archive' where id = (select min(id) from document_versions)");
    await base.query("update reviews set status = 'cloturee' where id = (select min(id) from reviews)");
    await base.migrateAll();
    expect(await journalCount(base)).toBeGreaterThan(BEFORE_0017);
    expect((await base.query('select archive_reason from risks where id = 3')).rows).toEqual([{ archive_reason: null }]);
    await expect(base.query("update risks set archived_at = now() where id = 5")).rejects.toThrow(/risks_archive_check/);
    await expect(base.query("update risks set archive_reason = 'x' where id = 5")).rejects.toThrow(/risks_archive_check/);
    await expect(base.query("update risks set archived_at = now(), archive_reason = ' ' where id = 5")).rejects.toThrow(/risks_archive_check/);
    await base.query("update risks set archived_at = now(), archive_reason = 'Motif' where id = 5");
    await expect(base.query("update events set type = 'XX' where id = (select min(id) from events)")).rejects.toThrow(/events_type_check/);
    await expect(base.query("update prevention_plans set status = 'annule' where cancelled_at is null")).rejects.toThrow(/prevention_plans_cancel_status_check/);
    await expect(base.query("update permits set status = 'annule' where cancel_reason is null")).rejects.toThrow(/permits_cancel_check/);
    await expect(base.query("update waste_entries set bsd_status = 'perdu' where id = (select min(id) from waste_entries)")).rejects.toThrow(/waste_entries_bsd_status_check/);
  });
});
