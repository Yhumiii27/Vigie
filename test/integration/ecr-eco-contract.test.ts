import '../next-mocks';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { freshDemoDatabase } from '../helpers';
import { getDb } from '@/db';

// D12 (lot 5 de M-02) : Matrix définit les publications vigie.pub_ordres_modification, pub_eco_approbations,
// pub_eco_effectivite et pub_demandes_modification (contrat D12 v1, M-18) sur les tables de Vigie. Ce test exécute leurs
// définitions, recopiées dans docs/specs/modifications-techniques.md, sur la base de démonstration (PGlite, ou PostgreSQL
// avec TEST_DATABASE_URL) : colonnes et types du contrat, valeurs du jeu. Aucune vue pub_ n'est créée par Vigie.

freshDemoDatabase();

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => ((await (await getDb()).execute(q)) as unknown as { rows: Row[] }).rows;

function referenceQuery(view: string) {
  const doc = readFileSync(path.join(process.cwd(), 'docs', 'specs', 'modifications-techniques.md'), 'utf8');
  const block = new RegExp(`<!-- requete-reference:debut ${view} -->\\s*\`\`\`sql\\n([\\s\\S]*?)\`\`\`\\s*<!-- requete-reference:fin -->`).exec(doc);
  if (!block) throw new Error(`Requête de référence de ${view} introuvable`);
  expect(block[1]).not.toMatch(/\bvigie\./);
  return block[1].trim();
}

const CONTRACTS: Record<string, [string, string][]> = {
  pub_ordres_modification: [
    ['number', 'text'], ['title', 'text'], ['eco_type', 'text'], ['status', 'text'], ['interchangeability', 'text'], ['from_revision', 'text'],
    ['to_revision', 'text'], ['cost_eur', 'numeric'], ['schedule_days', 'integer'], ['stock_impact', 'text'], ['document_refs', 'ARRAY'],
    ['codex_doc_ids', 'ARRAY'], ['requested_by_name', 'text'], ['requested_by_matricule', 'text'], ['raised_on', 'date'],
    ['pending_dispositions', 'integer'], ['locked', 'boolean'], ['parts', 'ARRAY'], ['projects', 'ARRAY'], ['released_at', 'timestamp with time zone'],
    ['vigie_updated_at', 'timestamp with time zone'],
  ],
  pub_eco_approbations: [
    ['eco_number', 'text'], ['approval_key', 'text'], ['decision', 'text'], ['approver_text', 'text'], ['decided_by_name', 'text'],
    ['decided_by_matricule', 'text'], ['decided_at', 'timestamp with time zone'],
  ],
  pub_eco_effectivite: [
    ['eco_number', 'text'], ['target_type', 'text'], ['target_ref', 'text'], ['label', 'text'], ['disposition', 'text'], ['is_automatic', 'boolean'],
    ['note', 'text'], ['fitted_part_ref', 'text'], ['fitted_revision', 'text'], ['position', 'integer'],
  ],
  pub_demandes_modification: [
    ['id', 'text'], ['kind', 'text'], ['doc_id', 'text'], ['requester_id', 'text'], ['requester_name', 'text'], ['requester_matricule', 'text'],
    ['reason', 'text'], ['description', 'text'], ['status', 'text'], ['eco_ref', 'text'], ['modifier_id', 'text'], ['decision_note', 'text'],
    ['source', 'text'], ['subject', 'text'], ['project_code', 'text'], ['part_ref', 'text'], ['event_id', 'text'], ['created_at', 'timestamp with time zone'],
    ['decided_at', 'timestamp with time zone'], ['implemented_at', 'timestamp with time zone'], ['codex_revision', 'text'],
  ],
};

describe('publications de D12 : requêtes de référence (contrat D12 v1 de Matrix)', () => {
  for (const [view, contract] of Object.entries(CONTRACTS)) {
    it(`${view} : colonnes du contrat dans l’ordre, types attendus ; aucune vue pub_ créée par Vigie`, async () => {
      const temp = `${view}_reference`;
      await (await getDb()).execute(sql.raw(`CREATE OR REPLACE TEMP VIEW ${temp} AS ${referenceQuery(view)}`));
      const cols = await rows(sql`select column_name, data_type from information_schema.columns where table_name = ${temp} order by ordinal_position`);
      expect(cols.map((c) => [c.column_name, c.data_type])).toEqual(contract);
      const [{ n }] = await rows(sql`select count(*)::int as n from information_schema.views where table_name = ${view} and table_schema = current_schema()`);
      expect(n).toBe(0);
    });
  }

  it('valeurs du jeu : ordre en approbation non verrouillé, ordre libéré, tableaux ordonnés', async () => {
    const published = await rows(sql.raw(`SELECT number, status, pending_dispositions, locked, document_refs, codex_doc_ids, parts, projects,
      released_at IS NOT NULL AS released, cost_eur::text AS cost FROM (${referenceQuery('pub_ordres_modification')}) q ORDER BY number`));
    expect(published).toEqual([
      {
        number: 'ECO-2026-001', status: 'in_approval', pending_dispositions: 1, locked: false, document_refs: ['Plan ARB-MAL-045 indice C', 'PRO-QUA-0006'],
        codex_doc_ids: ['PRO-QUA-0006'], parts: ['ARB-MAL-045'], projects: ['K-2025-077'], released: false, cost: '1850.00',
      },
      {
        number: 'ECO-2026-002', status: 'released', pending_dispositions: 0, locked: false, document_refs: ['PRO-QUA-0005'], codex_doc_ids: ['PRO-QUA-0005'],
        parts: ['VER-HYD-300'], projects: ['K-2024-097'], released: true, cost: '4200.00',
      },
      {
        number: 'ECO-2026-003', status: 'draft', pending_dispositions: 0, locked: false, document_refs: [], codex_doc_ids: [], parts: ['CAP-PRS-400'],
        projects: [], released: false, cost: '0.00',
      },
    ]);
    const approvals = await rows(sql.raw(`SELECT eco_number, approval_key, decision, approver_text FROM (${referenceQuery('pub_eco_approbations')}) q WHERE eco_number = 'ECO-2026-001' ORDER BY approval_key`));
    expect(approvals.map((a) => [a.approval_key, a.decision])).toEqual([['englead', 'ok'], ['pm', 'pending'], ['quality', 'pending']]);
    const targets = await rows(sql.raw(`SELECT target_ref, disposition FROM (${referenceQuery('pub_eco_effectivite')}) q WHERE eco_number = 'ECO-2026-001' ORDER BY position`));
    expect(targets).toEqual([
      { target_ref: 'K-2025-042', disposition: 'update' }, { target_ref: 'K-2025-077', disposition: 'update' },
      { target_ref: 'MCH-031', disposition: 'retrofit' }, { target_ref: 'MCH-035', disposition: null },
    ]);
    const requests = await rows(sql.raw(`SELECT id, requester_id, status, eco_ref, doc_id, codex_revision FROM (${referenceQuery('pub_demandes_modification')}) q ORDER BY id`));
    expect(requests).toEqual([
      { id: 'ECR-2026-001', requester_id: 'jwagner', status: 'submitted', eco_ref: null, doc_id: 'PRO-QUA-0001', codex_revision: null },
      { id: 'ECR-2026-002', requester_id: 'lmoreau', status: 'implemented', eco_ref: 'ECO-2026-002', doc_id: 'PRO-QUA-0005', codex_revision: 'C' },
      { id: 'ECR-2026-003', requester_id: 'vigie', status: 'accepted', eco_ref: 'ECO-2026-001', doc_id: null, codex_revision: null },
    ]);
  });
});
