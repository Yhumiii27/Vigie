import '../next-mocks';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { form } from '../next-mocks';
import { DEMO_TODAY, actAs, freshDemoDatabase } from '../helpers';
import { getDb } from '@/db';
import { loadProcessSafetyStudies } from '@/lib/data/process-safety';
import { cancelProcessSafetyStudy, saveProcessSafetyStudy } from '@/server/process-safety';

// VG-03 (demande d'Arche du 01/11/2026) : Matrix définit la publication `vigie.pub_etudes_securite` (décision M-18) d'après la
// requête de référence de docs/specs/etudes-securite.md. Ce test exécute cette requête, lue dans le document, sur la base de
// démonstration (PGlite, ou PostgreSQL avec TEST_DATABASE_URL) : colonnes et types du contrat, valeurs égales à celles de
// l'écran (loadProcessSafetyStudies). Aucune vue n'est créée par Vigie : la requête passe par une vue temporaire de session.

freshDemoDatabase();

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => ((await (await getDb()).execute(q)) as unknown as { rows: Row[] }).rows;

/** Requête de référence du document, date du jour remplacée par celle du jeu (le retard dépend du jour de lecture). */
function referenceQuery() {
  const doc = readFileSync(path.join(process.cwd(), 'docs', 'specs', 'etudes-securite.md'), 'utf8');
  const block = /<!-- requete-reference:debut -->\s*```sql\n([\s\S]*?)```\s*<!-- requete-reference:fin -->/.exec(doc);
  if (!block) throw new Error('Requête de référence introuvable dans docs/specs/etudes-securite.md');
  const today = "(now() AT TIME ZONE 'Europe/Paris')::date";
  expect(block[1]).toContain(today);
  return block[1].replace(today, `DATE '${DEMO_TODAY}'`).trim();
}

const CONTRACT: [string, string][] = [
  ['etude_ref', 'text'], ['capex_code', 'text'], ['projet_code', 'text'], ['jalon', 'text'], ['type', 'text'], ['statut', 'text'],
  ['seance_le', 'date'], ['conclue_le', 'date'], ['conclusion', 'text'], ['animateur', 'text'], ['rapport_ref', 'text'],
  ['recommandations', 'integer'], ['recommandations_ouvertes', 'integer'], ['recommandations_en_retard', 'integer'], ['reserves_bloquantes', 'integer'],
  ['lien', 'text'], ['maj_le', 'timestamp with time zone'],
];

describe('pub_etudes_securite : requête de référence (contrat Arche § 2.5)', () => {
  it('colonnes du contrat dans l’ordre, types attendus ; aucune vue pub_ créée par Vigie', async () => {
    await (await getDb()).execute(sql.raw(`CREATE OR REPLACE TEMP VIEW etudes_reference AS ${referenceQuery()}`));
    const cols = await rows(sql`select column_name, data_type from information_schema.columns
      where table_name = 'etudes_reference' order by ordinal_position`);
    expect(cols.map((c) => [c.column_name, c.data_type])).toEqual(CONTRACT);
    const [{ n }] = await rows(sql`select count(*)::int as n from information_schema.views where table_name = 'pub_etudes_securite'`);
    expect(n).toBe(0);
  });

  it('valeurs du jeu de démonstration, égales à celles de l’écran ; étude annulée publiée « annulee »', async () => {
    actAs('Animateur QHSE', 'all');
    expect(await saveProcessSafetyStudy({}, form({ siteId: 'ville-b', keystoneProjectCode: 'K-2025-042', milestone: 'HS6', type: 'aspd', status: 'planifiee', sessionOn: '2026-12-01' }))).toEqual({ ok: true, id: 'ES-004' });
    expect(await cancelProcessSafetyStudy({}, form({ id: 'ES-004', reason: 'Projet suspendu' }))).toEqual({ ok: true, id: 'ES-004' });
    const published = await rows(sql.raw(`SELECT etude_ref, capex_code, projet_code, jalon, type, statut, seance_le::text AS seance_le, conclue_le::text AS conclue_le,
      conclusion, animateur, rapport_ref, recommandations, recommandations_ouvertes, recommandations_en_retard, reserves_bloquantes, lien,
      maj_le IS NOT NULL AS maj_connue FROM (${referenceQuery()}) q ORDER BY etude_ref`));
    expect(published).toEqual([
      {
        etude_ref: 'ES-001', capex_code: 'CPX-APM-2026-01', projet_code: null, jalon: 'HS2', type: 'hazid', statut: 'validee', seance_le: '2026-06-11', conclue_le: '2026-06-19',
        conclusion: 'favorable', animateur: '[C. Lefèvre]', rapport_ref: 'NOT-CPX-APM-2026-01-002', recommandations: 0, recommandations_ouvertes: 0,
        recommandations_en_retard: 0, reserves_bloquantes: 0, lien: '/risques?vue=etudes&etude=ES-001', maj_connue: true,
      },
      {
        etude_ref: 'ES-002', capex_code: 'CPX-APM-2026-01', projet_code: null, jalon: 'HS3', type: 'hazop', statut: 'validee', seance_le: '2026-09-04', conclue_le: '2026-09-09',
        conclusion: 'reserves', animateur: '[Bureau d’études procédés]', rapport_ref: 'NOT-CPX-APM-2026-01-004', recommandations: 3, recommandations_ouvertes: 2,
        recommandations_en_retard: 1, reserves_bloquantes: 1, lien: '/risques?vue=etudes&etude=ES-002', maj_connue: true,
      },
      {
        etude_ref: 'ES-003', capex_code: 'CPX-APM-2026-01', projet_code: null, jalon: 'PSSR', type: 'pssr', statut: 'planifiee', seance_le: '2026-11-03', conclue_le: null,
        conclusion: null, animateur: '[C. Lefèvre]', rapport_ref: null, recommandations: 0, recommandations_ouvertes: 0,
        recommandations_en_retard: 0, reserves_bloquantes: 0, lien: '/risques?vue=etudes&etude=ES-003', maj_connue: true,
      },
      {
        etude_ref: 'ES-004', capex_code: null, projet_code: 'K-2025-042', jalon: 'HS6', type: 'aspd', statut: 'annulee', seance_le: '2026-12-01', conclue_le: null,
        conclusion: null, animateur: null, rapport_ref: null, recommandations: 0, recommandations_ouvertes: 0,
        recommandations_en_retard: 0, reserves_bloquantes: 0, lien: '/risques?vue=etudes&etude=ES-004', maj_connue: true,
      },
    ]);
    // Mêmes valeurs que l'écran (statut, décomptes, conclusion, animateur).
    const { studies, cancelled } = await loadProcessSafetyStudies();
    for (const s of [...studies, ...cancelled]) {
      const p = published.find((r) => r.etude_ref === s.id)!;
      expect([p.statut, p.conclusion, p.animateur ?? '', p.recommandations, p.recommandations_ouvertes, p.recommandations_en_retard, p.reserves_bloquantes], s.id)
        .toEqual([s.status, s.conclusion, s.facilitator, s.counts.total, s.counts.open, s.counts.late, s.counts.blocking]);
    }
  });

  it('maj_le suit le journal de l’étude et de ses recommandations', async () => {
    const majOf = async () => {
      const [r] = await rows(sql.raw(`SELECT maj_le FROM (${referenceQuery()}) q WHERE etude_ref = 'ES-002'`));
      return new Date(r.maj_le as string | Date).getTime();
    };
    const before = await majOf();
    const [last] = await rows(sql`select max(l.at) as at from change_log l join actions a on l.entity_type = 'action' and l.entity_id = a.id where a.safety_study_id = 'ES-002'`);
    expect(before).toBeGreaterThanOrEqual(new Date(last.at as string | Date).getTime());
    await (await getDb()).execute(sql`insert into change_log (entity_type, entity_id, action, summary, by_id) values ('action', 'A-192', 'comment', 'Commentaire ajouté', 'sbenali')`);
    expect(await majOf()).toBeGreaterThan(before);
  });
});
