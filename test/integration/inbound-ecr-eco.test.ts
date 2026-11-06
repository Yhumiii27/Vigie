import '../next-mocks';
import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { getDb, schema as t } from '@/db';
import { loadInboundSignals } from '@/lib/data/inbound';
import { processInboundRequests } from '@/server/inbound';

// D12 (lot 5 de la convergence M-02), décisions CV-06 et CV-08 : Codex crée une demande de modification par
// vigie.pub_creer_demande_modification (numéro ECR-AAAA-NNN réservé et rendu), Keystone fait avancer un ordre par
// vigie.pub_signaler_avancement_eco ; les deux fonctions ne font que déposer une demande dans inbound_requests, traitée par
// Vigie avec ses règles et son journal (src/server/inbound.ts). PGlite, ou PostgreSQL avec TEST_DATABASE_URL (schéma vigie).

freshDemoDatabase();

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => ((await (await getDb()).execute(q)) as unknown as { rows: Row[] }).rows;
const ECR_SIGNATURE = 'text, text, text, text, text, text, text, text, text, timestamptz';
const ECO_SIGNATURE = 'text, text, text, text, text, text, text, text, text, timestamptz, text';

/** Inscrit le session_user de la base d'essai comme appelant de l'outil (démonstration et tests seulement). */
const callerIs = (tool: 'codex' | 'keystone') =>
  rows(sql`insert into inbound_callers (role, tool, label) values (session_user, ${tool}, ${tool === 'codex' ? 'Codex' : 'Keystone'})
    on conflict (role) do update set tool = excluded.tool, label = excluded.label`);

type EcrCall = { id: string; nature?: string | null; document?: string | null; motif?: string | null; description?: string | null; ref?: string | null; nom?: string | null; matricule?: string | null; remplacant?: string | null };
async function createEcr(c: EcrCall): Promise<string> {
  const [r] = await rows(sql`select pub_creer_demande_modification(${c.id}, ${c.nature === undefined ? 'modification' : c.nature}, ${c.document === undefined ? 'PRO-HSE-0001' : c.document},
    ${c.motif === undefined ? 'Mettre à jour le logigramme' : c.motif}, ${c.description ?? null}, ${c.ref ?? 'jwagner'}, ${c.nom === undefined ? '[J. Wagner]' : c.nom},
    ${c.matricule ?? null}, ${c.remplacant ?? null}, ${'2026-10-09T08:00:00Z'}::timestamptz) as ref`);
  return String(r.ref);
}

type EcoCall = { id: string; numero?: string; nature?: string; cle?: string | null; decision?: string | null; depuis?: string | null; cible?: string | null; commentaire?: string | null; acteur?: string | null };
async function ecoProgress(c: EcoCall): Promise<number> {
  const [r] = await rows(sql`select pub_signaler_avancement_eco(${c.numero ?? 'ECO-2026-001'}, ${c.nature ?? 'approval'}, ${c.cle ?? null}, ${c.decision ?? null},
    ${c.depuis ?? null}, ${c.cible ?? null}, ${c.commentaire ?? null}, ${c.acteur ?? '[E. Dubois]'}, ${'pm'}, ${'2026-10-09T08:00:00Z'}::timestamptz, ${c.id}) as id`);
  return Number(r.id);
}

async function sqlState(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code;
  }
  return undefined;
}

const countRequests = async () => (await rows(sql`select count(*)::int as n from inbound_requests`))[0].n;
const request = async (ref: string, kind: string) => (await rows(sql`select * from inbound_requests where target_ref = ${ref} and kind = ${kind} order by id desc limit 1`))[0];
const ecr = async (id: string) => (await (await getDb()).select().from(t.ecrs).where(eq(t.ecrs.id, id)))[0];
const eco = async (id: string) => (await (await getDb()).select().from(t.ecos).where(eq(t.ecos.id, id)))[0];

describe('fonctions de D12 : protection', () => {
  for (const [name, signature] of [['pub_creer_demande_modification', ECR_SIGNATURE], ['pub_signaler_avancement_eco', ECO_SIGNATURE]] as const) {
    it(`${name} : SECURITY DEFINER, search_path fixé, aucune exécution pour PUBLIC, nom unique`, async () => {
      const [f] = await rows(sql`select p.prosecdef as definer, p.proconfig::text as config, n.nspname as schema,
          (select count(*)::int from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_exec
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = ${name}`);
      expect(f.definer).toBe(true);
      expect(f.public_exec).toBe(0);
      expect(f.config).toContain(`search_path=${f.schema}, pg_temp`);
      expect(f.schema).toBe(process.env.TEST_DATABASE_URL ? 'vigie' : 'public');
      expect((await rows(sql`select count(*)::int as n from pg_proc where proname = ${name}`))[0].n).toBe(1);
    });

    it.runIf(!!process.env.TEST_DATABASE_URL)(`${name} : PostgreSQL, un rôle quelconque ne peut pas l’exécuter`, async () => {
      const role = `vigie_essai_${Date.now()}`;
      await rows(sql.raw(`create role ${role} nologin`));
      try {
        const [r] = await rows(sql.raw(`select has_function_privilege('${role}', 'vigie.${name}(${signature})', 'EXECUTE') as can`));
        expect(r.can).toBe(false);
      } finally {
        await rows(sql.raw(`drop role ${role}`));
      }
    });
  }

  it('codex_app inscrit comme appelant de Codex par la migration ; keystone_app gardé', async () => {
    const callers = await rows(sql`select role, tool from inbound_callers where role in ('codex_app', 'keystone_app') order by role`);
    expect(callers).toEqual([{ role: 'codex_app', tool: 'codex' }, { role: 'keystone_app', tool: 'keystone' }]);
  });

  it('appelant non inscrit ou d’un autre outil : P0V01, rien n’est déposé', async () => {
    const before = await countRequests();
    expect(await sqlState(createEcr({ id: 'cx-0' }))).toBe('P0V01');
    expect(await sqlState(ecoProgress({ id: 'ks-0', cle: 'pm', decision: 'ok' }))).toBe('P0V01');
    await callerIs('keystone');
    expect(await sqlState(createEcr({ id: 'cx-0' }))).toBe('P0V01');
    await callerIs('codex');
    expect(await sqlState(ecoProgress({ id: 'ks-0', cle: 'pm', decision: 'ok' }))).toBe('P0V01');
    expect(await countRequests()).toBe(before);
  });
});

describe('Codex : création d’une demande de modification', () => {
  it('arguments invalides : P0V02, aucun numéro consommé ni demande déposée', async () => {
    await callerIs('codex');
    const before = await countRequests();
    for (const bad of [
      { id: '' }, { id: 'cx-b1', nature: 'retrait' }, { id: 'cx-b2', document: null }, { id: 'cx-b3', motif: ' ' }, { id: 'cx-b4', nom: null },
      { id: 'cx-b5', matricule: '9001' }, { id: 'cx-b6', motif: 'x'.repeat(2001) }, { id: 'cx-b7', document: 'PRO;DROP' },
    ] as EcrCall[]) expect(await sqlState(createEcr(bad)), JSON.stringify(bad).slice(0, 60)).toBe('P0V02');
    expect(await countRequests()).toBe(before);
  });

  it('rend un numéro ECR-AAAA-NNN réservé au-delà des numéros existants ; même identifiant externe : même numéro', async () => {
    await callerIs('codex');
    const ref = await createEcr({ id: 'cx-1', description: 'Ajouter l’étape de qualification des ECO', matricule: 'EMP-9007' });
    expect(ref).toMatch(/^ECR-2026-\d{3}$/);
    expect(Number(ref.slice(-3))).toBeGreaterThan(3); // ECR-2026-001 à 003 : jeu de démonstration
    expect(await createEcr({ id: 'cx-1' })).toBe(ref);
    const r = await request(ref, 'ecr_create');
    expect(r).toMatchObject({ status: 'received', tool: 'codex', project_code: null, external_id: 'cx-1' });
    expect(r.payload).toMatchObject({ kind: 'modification', documentId: 'PRO-HSE-0001', requester: { ref: 'jwagner', name: '[J. Wagner]', matricule: 'EMP-9007' } });
    // Aucune demande créée avant le traitement par Vigie.
    expect(await ecr(ref)).toBeUndefined();
    // Numéro suivant de Vigie (création dans l'écran) au-delà du numéro réservé.
    const second = await createEcr({ id: 'cx-2', document: 'PRO-QUA-0001' });
    expect(Number(second.slice(-3))).toBe(Number(ref.slice(-3)) + 1);
  });

  it('traitement : demande « À décider » créée avec le numéro réservé, journal « Codex (…) », site du document', async () => {
    const ref = String((await request(String((await rows(sql`select target_ref from inbound_requests where external_id = 'cx-1'`))[0].target_ref), 'ecr_create')).target_ref);
    const out = await processInboundRequests(await getDb());
    expect(out).toMatchObject({ failed: 0, deferred: 0 });
    expect(await ecr(ref)).toMatchObject({
      status: 'submitted', source: 'codex', subject: 'document', codexDocId: 'PRO-HSE-0001', requesterRef: 'jwagner', requesterMatricule: 'EMP-9007', siteId: null,
    });
    expect(await request(ref, 'ecr_create')).toMatchObject({ status: 'applied', ecr_id: ref });
    expect(await lastLog('ecr', ref)).toMatchObject({ action: 'create', byId: null, summary: expect.stringContaining('Codex (') });
    // Seconde demande sur PRO-QUA-0001, déjà visé par ECR-2026-001 (à décider) : créée « refusée » avec le motif, Codex prévenu.
    const second = String((await rows(sql`select target_ref from inbound_requests where external_id = 'cx-2'`))[0].target_ref);
    expect(await ecr(second)).toMatchObject({ status: 'rejected', decisionNote: expect.stringContaining('ECR-2026-001'), notifyStatus: 'pending' });
    expect(await request(second, 'ecr_create')).toMatchObject({ status: 'rejected', result_code: 'refused', ecr_id: second });
    const [msg] = await (await getDb()).select().from(t.outboundMessages).where(eq(t.outboundMessages.entityId, second));
    expect(msg).toMatchObject({ target: 'codex', status: 'pending', payload: { requestId: second, accepted: false } });
  });

  it('document inconnu de Codex : demande refusée d’office (introuvable) ; Codex indisponible : demande laissée reçue', async () => {
    await callerIs('codex');
    const unknown = await createEcr({ id: 'cx-3', document: 'PRO-XXX-9999' });
    const db = await getDb();
    await processInboundRequests(db);
    expect(await ecr(unknown)).toMatchObject({ status: 'rejected', decisionNote: expect.stringContaining('introuvable') });
    expect(await request(unknown, 'ecr_create')).toMatchObject({ result_code: 'not_found' });
    const later = await createEcr({ id: 'cx-4', document: 'PRO-QUA-0002' });
    await rows(sql.raw('alter view codex.pub_documents rename to pub_documents_absente'));
    try {
      expect(await processInboundRequests(db)).toMatchObject({ processed: 0, deferred: 1 });
      expect(await request(later, 'ecr_create')).toMatchObject({ status: 'received' });
    } finally {
      await rows(sql.raw('alter view codex.pub_documents_absente rename to pub_documents'));
    }
    expect(await processInboundRequests(db)).toMatchObject({ processed: 1, applied: 1 });
    expect(await ecr(later)).toMatchObject({ status: 'submitted' });
  });
});

describe('Keystone : avancement d’un ordre de modification', () => {
  it('arguments invalides : P0V02', async () => {
    await callerIs('keystone');
    for (const bad of [
      { id: 'ks-b1', numero: 'ECO-26-1', cle: 'pm', decision: 'ok' }, { id: 'ks-b2', nature: 'release' }, { id: 'ks-b3', cle: 'director', decision: 'ok' },
      { id: 'ks-b4', cle: 'pm', decision: 'maybe' }, { id: 'ks-b5', nature: 'step', depuis: 'draft' }, { id: 'ks-b6', cle: 'pm', decision: 'ok', commentaire: 'x'.repeat(2001) },
    ] as EcoCall[]) expect(await sqlState(ecoProgress(bad)), JSON.stringify(bad).slice(0, 60)).toBe('P0V02');
  });

  it('clé des chefs de projet approuvée : appliquée, journal Keystone, idempotente ; clé qualité refusée (décidée dans Vigie)', async () => {
    await callerIs('keystone');
    const id = await ecoProgress({ id: 'ks-1', cle: 'pm', decision: 'ok', commentaire: 'OK pour K-2025-077', acteur: '[E. Dubois]' });
    expect(await ecoProgress({ id: 'ks-1', cle: 'pm', decision: 'ok' })).toBe(id);
    const quality = await ecoProgress({ id: 'ks-2', cle: 'quality', decision: 'ok' });
    await processInboundRequests(await getDb());
    const [pm] = await (await getDb()).select().from(t.ecoApprovals).where(sql`${t.ecoApprovals.ecoId} = 'ECO-2026-001' and ${t.ecoApprovals.approvalKey} = 'pm'`);
    expect(pm).toMatchObject({ decision: 'ok', via: 'keystone', decidedByName: '[E. Dubois]', comment: 'OK pour K-2025-077', decidedById: null });
    const log = await lastLog('eco', 'ECO-2026-001');
    expect(log).toMatchObject({ action: 'approval', byId: null, summary: expect.stringContaining('Keystone (') });
    expect(log?.details).toEqual(expect.arrayContaining([{ field: 'Commentaire', from: null, to: 'OK pour K-2025-077' }]));
    expect((await rows(sql`select status, result_code from inbound_requests where id = ${quality}`))[0]).toEqual({ status: 'rejected', result_code: 'refused' });
    // Même décision renvoyée sous un autre identifiant : appliquée sans changement ; décision contraire : refusée.
    await ecoProgress({ id: 'ks-3', cle: 'pm', decision: 'ok' });
    const contrary = await ecoProgress({ id: 'ks-4', cle: 'pm', decision: 'rejected', commentaire: 'Non' });
    await processInboundRequests(await getDb());
    expect((await rows(sql`select status from inbound_requests where external_id = 'ks-3'`))[0].status).toBe('applied');
    expect((await rows(sql`select status, result_code from inbound_requests where id = ${contrary}`))[0]).toEqual({ status: 'rejected', result_code: 'refused' });
    expect((await eco('ECO-2026-001')).status).toBe('in_approval');
  });

  it('étape : état vu périmé (stale), étape non suivante (invalid), interchangeabilité manquante (refused), étape suivante appliquée', async () => {
    await callerIs('keystone');
    const stale = await ecoProgress({ id: 'ks-5', numero: 'ECO-2026-003', nature: 'step', depuis: 'impact_analysis', cible: 'in_approval' });
    const skip = await ecoProgress({ id: 'ks-6', numero: 'ECO-2026-003', nature: 'step', depuis: 'draft', cible: 'in_approval' });
    const ok = await ecoProgress({ id: 'ks-7', numero: 'ECO-2026-003', nature: 'step', depuis: 'draft', cible: 'impact_analysis' });
    const noInterchange = await ecoProgress({ id: 'ks-8', numero: 'ECO-2026-003', nature: 'step', depuis: 'impact_analysis', cible: 'in_approval' });
    await processInboundRequests(await getDb());
    const res = async (id: number) => (await rows(sql`select status, result_code from inbound_requests where id = ${id}`))[0];
    expect(await res(stale)).toEqual({ status: 'rejected', result_code: 'stale' });
    expect(await res(skip)).toEqual({ status: 'rejected', result_code: 'invalid' });
    expect(await res(ok)).toEqual({ status: 'applied', result_code: null });
    expect(await res(noInterchange)).toEqual({ status: 'rejected', result_code: 'refused' });
    expect((await eco('ECO-2026-003')).status).toBe('impact_analysis');
    expect((await changeLog('eco', 'ECO-2026-003')).some((l) => l.action === 'status' && l.byId === null)).toBe(true);
  });

  it('ordre inconnu ou libéré : introuvable ou refusé ; échéance du refus au QHSE (clé keystone-refus)', async () => {
    await callerIs('keystone');
    const unknown = await ecoProgress({ id: 'ks-9', numero: 'ECO-2026-999', cle: 'pm', decision: 'ok' });
    const released = await ecoProgress({ id: 'ks-10', numero: 'ECO-2026-002', cle: 'pm', decision: 'ok' });
    await processInboundRequests(await getDb());
    expect((await rows(sql`select result_code from inbound_requests where id = ${unknown}`))[0].result_code).toBe('not_found');
    expect((await rows(sql`select result_code, eco_id from inbound_requests where id = ${released}`))[0]).toEqual({ result_code: 'refused', eco_id: 'ECO-2026-002' });
    actAs('Animateur QHSE', 'all');
    const { todo } = await loadInboundSignals();
    expect(todo.find((x) => x.key === `keystone-refus|${released}`)).toMatchObject({ siteId: 'site_a', href: '/modifications-techniques?sel=ECO-2026-002' });
    expect(todo.find((x) => x.key === `keystone-refus|${unknown}`)).toMatchObject({ siteId: null });
  });
});
