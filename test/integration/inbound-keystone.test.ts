import '../next-mocks';
import { describe, expect, it } from 'vitest';
import { and, desc, eq, sql } from 'drizzle-orm';
import { form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { getDb, schema as t } from '@/db';
import { loadEventInbound, loadInboundOverview, loadInboundSignals } from '@/lib/data/inbound';
import { acknowledgeInboundRequest, processInboundNow } from '@/server/connectors';
import { revertEvent } from '@/server/events';
import { processInboundRequests } from '@/server/inbound';

// D13 (lot 3 de la convergence M-02), décisions CV-07 et CV-08 du 04/11/2026 : Keystone signale l'avancement d'une NC de
// projet par vigie.pub_signaler_avancement_nc (migration 0026), qui dépose seulement une demande dans inbound_requests ;
// Vigie la traite avec ses règles et son journal (src/server/inbound.ts). Numéro de NC = référence EV-… (nc_number tenu
// par le déclencheur events_nc_number). PGlite, ou PostgreSQL avec TEST_DATABASE_URL (schéma vigie).

freshDemoDatabase();

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => ((await (await getDb()).execute(q)) as unknown as { rows: Row[] }).rows;
const SIGNATURE = 'text, text, text, text, text, text, text, text, text, timestamptz, text, text, text, text';

type Call = {
  numero?: string | null; projet?: string | null; nature?: string | null; depuis?: string | null; cible?: string | null; decision?: string | null;
  commentaire?: string | null; acteur?: string | null; role?: string | null; id: string; activite?: string | null; article?: string | null; livrable?: string | null;
};

/** Appel de la fonction comme Keystone le ferait (arguments typés, aucun SQL dynamique) ; renvoie l'identifiant de la demande. */
async function call(c: Call): Promise<number> {
  const [r] = await rows(sql`select pub_signaler_avancement_nc(${c.numero ?? null}, ${c.projet ?? null}, ${c.nature ?? null}, ${c.depuis ?? null},
    ${c.cible ?? null}, ${c.decision ?? null}, ${c.commentaire ?? null}, ${c.acteur ?? null}, ${c.role ?? null}, ${'2026-10-09T08:00:00Z'}::timestamptz,
    ${c.id}, ${c.activite ?? null}, ${c.article ?? null}, ${c.livrable ?? null}) as id`);
  return Number(r.id);
}

/** Code SQLSTATE d'une erreur de la base (PGlite ou node-postgres, éventuellement enveloppée par Drizzle). */
async function sqlState(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code;
  }
  return undefined;
}

const request = async (id: number) => (await (await getDb()).select().from(t.inboundRequests).where(eq(t.inboundRequests.id, id)))[0];
const event = async (id: string) => (await (await getDb()).select().from(t.events).where(eq(t.events.id, id)))[0];
const countRequests = async () => (await rows(sql`select count(*)::int as n from inbound_requests`))[0].n;

describe('CV-07 : numéro de NC = référence EV-… de Vigie', () => {
  it('nc_number recopie la référence des NC de projet (déclencheur), publiée par pub_non_conformites', async () => {
    const db = await getDb();
    const ncs = await db.select({ id: t.events.id, type: t.events.type, project: t.events.keystoneProjectCode, nc: t.events.ncNumber }).from(t.events);
    for (const e of ncs) expect(e.nc, e.id).toBe(e.type === 'NC' && e.project ? e.id : null);
    const published = await rows(sql`select project_code, number, vigie_ref from pub_non_conformites order by number`);
    expect(published.length).toBeGreaterThanOrEqual(4);
    for (const p of published) expect(p.number).toBe(p.vigie_ref);
    // Changement de type ou de projet : le numéro suit, sans écriture du code.
    await db.update(t.events).set({ keystoneProjectCode: null }).where(eq(t.events.id, 'EV-2026-125'));
    expect((await event('EV-2026-125')).ncNumber).toBeNull();
    await db.update(t.events).set({ keystoneProjectCode: 'K-2026-007' }).where(eq(t.events.id, 'EV-2026-125'));
    expect((await event('EV-2026-125')).ncNumber).toBe('EV-2026-125');
  });
});

describe('vigie.pub_signaler_avancement_nc', () => {
  it('protégée : SECURITY DEFINER, search_path fixé au schéma de Vigie puis pg_temp, aucune exécution pour PUBLIC', async () => {
    const [f] = await rows(sql`select p.prosecdef as definer, p.proconfig::text as config, n.nspname as schema,
        (select count(*)::int from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'pub_signaler_avancement_nc'`);
    expect(f.definer).toBe(true);
    expect(f.public_exec).toBe(0);
    expect(f.config).toContain(`search_path=${f.schema}, pg_temp`);
    expect(f.schema).toBe(process.env.TEST_DATABASE_URL ? 'vigie' : 'public');
    // Un seul objet de ce nom (Matrix accorde l'exécution d'une fonction pub_ de nom unique).
    expect((await rows(sql`select count(*)::int as n from pg_proc where proname = 'pub_signaler_avancement_nc'`))[0].n).toBe(1);
  });

  it.runIf(!!process.env.TEST_DATABASE_URL)('PostgreSQL : un rôle quelconque ne peut pas l’exécuter (droit accordé par Matrix seulement)', async () => {
    const role = `vigie_essai_${Date.now()}`;
    await rows(sql.raw(`create role ${role} nologin`));
    try {
      const [r] = await rows(sql.raw(`select has_function_privilege('${role}', 'vigie.pub_signaler_avancement_nc(${SIGNATURE})', 'EXECUTE') as can`));
      expect(r.can).toBe(false);
      const [tbl] = await rows(sql.raw(`select has_table_privilege('${role}', 'vigie.inbound_requests', 'INSERT') as can`));
      expect(tbl.can).toBe(false);
    } finally {
      await rows(sql.raw(`drop role ${role}`));
    }
  });

  it('appelant non inscrit (session_user hors inbound_callers) : refusé, rien n’est déposé', async () => {
    const before = await countRequests();
    expect(await sqlState(call({ numero: 'EV-2026-125', projet: 'K-2026-007', nature: 'step', depuis: 'containment', cible: 'root_cause', id: 'ks-0' }))).toBe('P0V01');
    expect(await countRequests()).toBe(before);
  });

  it('arguments invalides : refusés (P0V02), rien n’est déposé', async () => {
    // Démonstration et tests : le session_user de la base d'essai est inscrit comme appelant (jamais en production).
    await rows(sql`insert into inbound_callers (role, tool, label) values (session_user, 'keystone', 'Keystone') on conflict do nothing`);
    const before = await countRequests();
    for (const bad of [
      { numero: 'NCR-029', projet: 'K-2026-007', nature: 'step', depuis: 'containment', cible: 'root_cause', id: 'ks-bad-1' },
      { numero: 'EV-2026-125', projet: 'K-2026-007', nature: 'cloturer', id: 'ks-bad-2' },
      { numero: 'EV-2026-125', projet: 'K-2026-007', nature: 'step', cible: 'root_cause', id: 'ks-bad-3' },
      { numero: 'EV-2026-125', projet: 'K-2026-007', nature: 'verification', depuis: 'verification', id: 'ks-bad-4' },
      { numero: 'EV-2026-125', projet: null, nature: 'step', depuis: 'containment', cible: 'root_cause', id: 'ks-bad-5' },
      { numero: 'EV-2026-125', projet: 'K-2026-007', nature: 'references', id: 'ks-bad-6' },
      { numero: 'EV-2026-125', projet: 'K-2026-007', nature: 'step', depuis: 'containment', cible: 'root_cause', id: '' },
      { numero: 'EV-2026-125', projet: 'K-2026-007', nature: 'step', depuis: 'containment', cible: 'root_cause', commentaire: 'x'.repeat(2001), id: 'ks-bad-8' },
    ] as Call[]) expect(await sqlState(call(bad)), JSON.stringify(bad).slice(0, 80)).toBe('P0V02');
    expect(await countRequests()).toBe(before);
  });

  it('dépose seulement une demande « reçue » (aucune écriture sur la NC) ; même identifiant externe : même demande', async () => {
    const before = await event('EV-2026-125');
    const logs = (await changeLog('event', 'EV-2026-125')).length;
    const id = await call({ numero: 'EV-2026-125', projet: 'K-2026-007', nature: 'step', depuis: 'containment', cible: 'root_cause', commentaire: 'Analyse lancée chez nous', acteur: '[G. Comte]', role: 'quality', id: 'ks-1' });
    expect(await call({ numero: 'EV-2026-125', projet: 'K-2026-007', nature: 'step', depuis: 'containment', cible: 'root_cause', id: 'ks-1' })).toBe(id);
    expect(await request(id)).toMatchObject({
      kind: 'nc_step', status: 'received', processedAt: null, targetRef: 'EV-2026-125', projectCode: 'K-2026-007', externalId: 'ks-1', tool: 'keystone',
      payload: { kind: 'step', fromStatus: 'containment', targetStatus: 'root_cause', comment: 'Analyse lancée chez nous', actor: { name: '[G. Comte]', role: 'quality' }, recordedAt: '2026-10-09T08:00:00.000Z' },
    });
    expect((await rows(sql`select count(*)::int as n from inbound_requests where external_id = 'ks-1'`))[0].n).toBe(1);
    expect(await event('EV-2026-125')).toEqual(before);
    expect((await changeLog('event', 'EV-2026-125')).length).toBe(logs);
  });
});

describe('traitement par Vigie (règles et journal de Vigie)', () => {
  it('passage d’étape appliqué, journalisé avec l’appelant Keystone, traité une seule fois', async () => {
    const db = await getDb();
    const [pending] = await db.select().from(t.inboundRequests).where(eq(t.inboundRequests.externalId, 'ks-1'));
    const r1 = await processInboundRequests(db);
    expect(r1).toMatchObject({ processed: 1, applied: 1, rejected: 0, failed: 0 });
    expect(await request(pending.id)).toMatchObject({ status: 'applied', resultCode: null, eventId: 'EV-2026-125', result: 'Étape « Analyse des causes » franchie dans Vigie.' });
    expect((await event('EV-2026-125')).step).toBe(2);
    const [step] = await db.select().from(t.eventSteps).where(eq(t.eventSteps.eventId, 'EV-2026-125')).orderBy(desc(t.eventSteps.id)).limit(1);
    expect(step).toMatchObject({ kind: 'advance', fromStep: 1, toStep: 2, byId: null, inboundRequestId: pending.id });
    const log = await lastLog('event', 'EV-2026-125');
    expect(log).toMatchObject({ byId: null, action: 'status', summary: `Keystone (${String(pending.caller)}) : étape « Analyse des causes » franchie (demande n° ${pending.id})` });
    expect(log!.details).toEqual(expect.arrayContaining([
      { field: 'Étape', from: 'Qualifié', to: 'Analyse des causes' },
      { field: 'Personne déclarée par Keystone', from: null, to: '[G. Comte] (quality)' },
      { field: 'Commentaire', from: null, to: 'Analyse lancée chez nous' },
    ]));
    // Idempotence : un second passage ne retraite rien ; un nouvel appel de même identifiant ne crée rien.
    expect(await processInboundRequests(db)).toMatchObject({ processed: 0 });
    expect(await call({ numero: 'EV-2026-125', projet: 'K-2026-007', nature: 'step', depuis: 'containment', cible: 'root_cause', id: 'ks-1' })).toBe(pending.id);
    expect(await processInboundRequests(db)).toMatchObject({ processed: 0 });
    expect((await event('EV-2026-125')).step).toBe(2);
  });

  it('refus par les règles d’étape de Vigie (analyse et action exigées), état périmé, qualification et clôture refusées', async () => {
    const db = await getDb();
    const blocked = await call({ numero: 'EV-2026-125', projet: 'K-2026-007', nature: 'step', depuis: 'root_cause', cible: 'corrective_action', id: 'ks-2' });
    const stale = await call({ numero: 'EV-2026-125', projet: 'K-2026-007', nature: 'step', depuis: 'containment', cible: 'root_cause', id: 'ks-3' });
    const qualify = await call({ numero: 'EV-2026-133', projet: 'K-2026-007', nature: 'step', depuis: 'open', cible: 'containment', id: 'ks-4' });
    await processInboundRequests(db);
    expect(await request(blocked)).toMatchObject({ status: 'rejected', resultCode: 'refused', eventId: 'EV-2026-125' });
    expect((await request(blocked)).result).toMatch(/analyse des causes/i);
    expect(await request(stale)).toMatchObject({ status: 'rejected', resultCode: 'stale' });
    // EV-2026-133 n'est pas une NC de projet : même réponse qu'un numéro inconnu, demande non rattachée.
    expect(await request(qualify)).toMatchObject({ status: 'rejected', resultCode: 'not_found', eventId: null });
    expect((await event('EV-2026-125')).step).toBe(2);
  });

  it('jamais un AT, une maladie professionnelle, ni une NC d’un autre projet ; aucune donnée de santé touchée', async () => {
    const db = await getDb();
    const [at] = await db.select().from(t.events).where(eq(t.events.type, 'AT')).limit(1);
    await db.update(t.events).set({ keystoneProjectCode: 'K-2025-042' }).where(eq(t.events.id, at.id));
    await db.update(t.events).set({ keystoneProjectCode: 'K-2025-042' }).where(eq(t.events.id, 'EV-2026-134'));
    const before = { at: await event(at.id), mp: await event('EV-2026-134') };
    const ids = [
      await call({ numero: at.id, projet: 'K-2025-042', nature: 'step', depuis: 'root_cause', cible: 'corrective_action', id: 'ks-at' }),
      await call({ numero: 'EV-2026-134', projet: 'K-2025-042', nature: 'references', article: 'ART-1', id: 'ks-mp' }),
      await call({ numero: 'EV-2026-112', projet: 'K-2025-042', nature: 'references', article: 'ART-1', id: 'ks-other-project' }),
    ];
    await processInboundRequests(db);
    for (const id of ids) {
      const r = await request(id);
      expect(r).toMatchObject({ status: 'rejected', resultCode: 'not_found', eventId: null });
      expect(r.result).not.toMatch(/accident|maladie|MP|AT/);
    }
    expect(await event(at.id)).toEqual(before.at);
    expect(await event('EV-2026-134')).toEqual(before.mp);
  });

  it('références Keystone : posées si vides, refusées si Vigie a une autre valeur', async () => {
    const db = await getDb();
    const ok = await call({ numero: 'EV-2026-125', projet: 'K-2026-007', nature: 'references', activite: 'ACT-BE-01', livrable: 'LIV-12', id: 'ks-ref-1' });
    const conflict = await call({ numero: 'EV-2026-125', projet: 'K-2026-007', nature: 'references', activite: 'ACT-BE-99', id: 'ks-ref-2' });
    await processInboundRequests(db);
    expect(await request(ok)).toMatchObject({ status: 'applied' });
    expect(await event('EV-2026-125')).toMatchObject({ keystoneActivityCode: 'ACT-BE-01', keystoneDeliverableNumber: 'LIV-12' });
    expect(await request(conflict)).toMatchObject({ status: 'rejected', resultCode: 'refused' });
    const log = await lastLog('event', 'EV-2026-125');
    expect(log).toMatchObject({ byId: null, action: 'update' });
    expect(log!.summary).toContain('Keystone');
    expect(log!.details).toEqual(expect.arrayContaining([{ field: 'Activité Keystone', from: null, to: 'ACT-BE-01' }]));
  });

  it('vérification : proposée au QHSE (échéance), sans changer l’étape ; levée quand le QHSE change l’étape', async () => {
    const db = await getDb();
    expect((await event('EV-2026-112')).step).toBe(4);
    const id = await call({ numero: 'EV-2026-112', projet: 'K-2024-097', nature: 'verification', depuis: 'verification', decision: 'approved', id: 'ks-verif' });
    await processInboundRequests(db);
    expect(await request(id)).toMatchObject({ status: 'applied', eventId: 'EV-2026-112' });
    expect((await event('EV-2026-112')).step).toBe(4);
    actAs('Animateur QHSE', 'site_a');
    const keys = (await loadInboundSignals()).todo.map((x) => x.key);
    expect(keys).toContain(`keystone-verification|${id}`);
    expect(await revertEvent({}, form({ id: 'EV-2026-112', reason: 'Proposition de Keystone examinée : actions à compléter' }))).toMatchObject({ ok: true });
    expect((await loadInboundSignals()).todo.map((x) => x.key)).not.toContain(`keystone-verification|${id}`);
  });
});

describe('échéances, fiche et onglet « Connecteurs »', () => {
  it('refus : échéance du QHSE jusqu’à sa prise en compte motivée (journal) ; jamais pour le Salarié', async () => {
    const db = await getDb();
    const [refused] = await db.select().from(t.inboundRequests).where(eq(t.inboundRequests.externalId, 'ks-2'));
    actAs('Animateur QHSE', 'site_a');
    const item = (await loadInboundSignals()).todo.find((x) => x.key === `keystone-refus|${refused.id}`);
    expect(item).toMatchObject({ siteId: 'site_a', href: '/evenements?etat=tous&sel=EV-2026-125' });
    expect(item!.ownerIds!.length).toBeGreaterThan(0);
    actAs('Salarié', 'site_a');
    expect((await loadInboundSignals()).todo).toEqual([]);
    expect((await loadEventInbound('EV-2026-125')).items).toEqual([]);
    actAs('Chef de service', 'site_a');
    expect(await acknowledgeInboundRequest({}, form({ id: String(refused.id), reason: 'Vu' }))).toMatchObject({ error: expect.any(String) });
    // L'encadrement lit les demandes appliquées de la NC, pas les refus.
    expect((await loadEventInbound('EV-2026-125')).items.every((r) => r.status !== 'rejected')).toBe(true);
    actAs('Animateur QHSE', 'site_a');
    expect((await loadEventInbound('EV-2026-125')).items.some((r) => r.status === 'rejected' && r.result)).toBe(true);
    expect(await acknowledgeInboundRequest({}, form({ id: String(refused.id), reason: '' }))).toMatchObject({ fieldErrors: { reason: expect.any(String) } });
    expect(await acknowledgeInboundRequest({}, form({ id: String(refused.id), reason: 'Keystone renverra la demande après l’analyse' }))).toMatchObject({ ok: true });
    expect(await request(refused.id)).toMatchObject({ acknowledgedById: 'clefevre', acknowledgeReason: 'Keystone renverra la demande après l’analyse' });
    expect(await lastLog('inbound_request', refused.id)).toMatchObject({ action: 'acknowledge', byId: 'clefevre', reason: 'Keystone renverra la demande après l’analyse' });
    expect((await loadInboundSignals()).todo.map((x) => x.key)).not.toContain(`keystone-refus|${refused.id}`);
    expect(await acknowledgeInboundRequest({}, form({ id: String(refused.id), reason: 'Encore' }))).toMatchObject({ error: 'Refus déjà pris en compte.' });
  });

  it('demande non traitée depuis plus d’un jour : échéance ; « Traiter maintenant » (QHSE) la traite', async () => {
    const db = await getDb();
    const [row] = await db.insert(t.inboundRequests).values({
      caller: 'keystone_app', tool: 'keystone', kind: 'nc_references', externalId: 'ks-old', targetRef: 'EV-2026-130', projectCode: 'K-2025-042',
      payload: { kind: 'references', deliverableNumber: 'LIV-7' }, receivedAt: new Date('2026-10-06T08:00:00Z'),
    }).returning();
    actAs('Animateur QHSE', 'site_a');
    expect((await loadInboundSignals()).todo.find((x) => x.key === `keystone-attente|${row.id}`)).toMatchObject({ overdue: true, tone: 'danger', dueOn: '2026-10-07' });
    expect((await loadInboundOverview()).counts.received).toBe(1);
    actAs('Chef de service', 'site_a');
    expect(await processInboundNow()).toMatchObject({ error: expect.any(String) });
    actAs('Animateur QHSE', 'site_a');
    expect(await processInboundNow()).toMatchObject({ ok: true, message: expect.stringContaining('1 demande(s) traitée(s)') });
    expect(await request(row.id)).toMatchObject({ status: 'applied' });
    expect((await loadInboundSignals()).todo.map((x) => x.key)).not.toContain(`keystone-attente|${row.id}`);
    const overview = await loadInboundOverview();
    expect(overview.counts.received).toBe(0);
    expect(overview.rejected.every((r) => r.status === 'rejected' && !r.acknowledged)).toBe(true);
  });

  it('démonstration : une demande appliquée et une refusée (échéance du responsable QHSE du site)', async () => {
    const db = await getDb();
    const demo = await db.select().from(t.inboundRequests).where(and(eq(t.inboundRequests.caller, 'keystone_app'), sql`${t.inboundRequests.externalId} like 'demo-%'`));
    expect(demo.map((r) => r.status).sort()).toEqual(['applied', 'rejected']);
    expect((await event('EV-2026-130')).partRef).toBe('ARB-MAL-045');
  });
});
