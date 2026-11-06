import '../next-mocks';
import { createHmac } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { form } from '../next-mocks';
import { actAs, freshDemoDatabase, lastLog } from '../helpers';
import { getDb, schema as t } from '@/db';
import { resetConfig } from '@/lib/env';
import { OUTBOUND_MAX_ATTEMPTS } from '@/lib/rules/outbound';
import { sendOutboundNow } from '@/server/connectors';
import { decideEcr } from '@/server/engineering';
import { sendOutboundMessages } from '@/server/outbound';
import { entityVersion } from '@/server/versions';

// File d'envoi vers Codex (D12, lot 5 de M-02) : décisions sur les demandes de modification de Codex envoyées à son webhook
// POST <VIGIE_CODEX_URL>/api/integrations/vigie (jeton et signature HMAC), reprises espacées, refus définitif, mise en œuvre
// constatée par la réponse de Codex ; sans configuration, les messages restent « à envoyer » ; jamais de secret ni de corps
// au journal du serveur.

freshDemoDatabase();

const TOKEN = 'jeton-de-test-du-webhook-codex-0123456789';
const SECRET = 'secret-de-test-de-signature-codex-0123456789';
const NOTE = 'Note confidentielle de décision';

function configure(on: boolean) {
  if (on) Object.assign(process.env, { VIGIE_CODEX_URL: 'https://codex.exemple.fr', VIGIE_CODEX_WEBHOOK_TOKEN: TOKEN, VIGIE_CODEX_WEBHOOK_SECRET: SECRET });
  else for (const k of ['VIGIE_CODEX_URL', 'VIGIE_CODEX_WEBHOOK_TOKEN', 'VIGIE_CODEX_WEBHOOK_SECRET']) delete process.env[k];
  resetConfig();
}
afterAll(() => configure(false));

const messages = async () => (await getDb()).select().from(t.outboundMessages).orderBy(t.outboundMessages.id);
const ecr = async (id: string) => (await (await getDb()).select().from(t.ecrs).where(eq(t.ecrs.id, id)))[0];
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('file d’envoi vers Codex', () => {
  it('décision de Vigie : message « à envoyer » ; sans adresse ni identifiants, rien n’est envoyé (pas d’erreur)', async () => {
    configure(false);
    actAs('Animateur QHSE', 'all');
    const version = await entityVersion(await getDb(), 'ecr', 'ECR-2026-001');
    expect(await decideEcr({}, form({ id: 'ECR-2026-001', decision: 'accepted', modifierRef: 'jwagner', note: NOTE, version }))).toEqual({ ok: true, id: 'ECR-2026-001' });
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await sendOutboundMessages(await getDb(), { fetchImpl })).toEqual({ sent: 0, retried: 0, failed: 0, skipped: ['codex'] });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await messages()).filter((m) => m.status === 'pending').map((m) => m.entityId)).toEqual(['ECR-2026-001']);
    expect(await sendOutboundNow()).toMatchObject({ ok: true, message: expect.stringContaining('non configuré') });
  });

  it('envoi signé (Bearer et HMAC-SHA256 de « horodatage.corps ») ; 200 « implemented » : demande mise en œuvre, révision ; aucun secret au journal', async () => {
    configure(true);
    const out: string[] = [];
    const spies = [vi.spyOn(process.stdout, 'write'), vi.spyOn(process.stderr, 'write')].map((s) => s.mockImplementation((chunk) => { out.push(String(chunk)); return true; }));
    const fetchImpl = vi.fn<typeof fetch>(async () => reply(200, { ok: true, requestId: 'ECR-2026-001', status: 'implemented', revision: 'D' }));
    try {
      expect(await sendOutboundMessages(await getDb(), { fetchImpl })).toMatchObject({ sent: 1, retried: 0, failed: 0 });
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://codex.exemple.fr/api/integrations/vigie');
    const headers = init!.headers as Record<string, string>;
    const body = String(init!.body);
    expect(JSON.parse(body)).toEqual({ requestId: 'ECR-2026-001', accepted: true, ecoRef: null, modifierId: 'jwagner', note: NOTE });
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    const ts = headers['X-Codex-Timestamp'];
    expect(headers['X-Codex-Signature']).toBe(`v1=${createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex')}`);
    expect(await ecr('ECR-2026-001')).toMatchObject({ status: 'implemented', codexRevision: 'D', notifyStatus: 'sent', notifyAttempts: 1, notifyError: null });
    expect(await lastLog('ecr', 'ECR-2026-001')).toMatchObject({ byId: null, summary: 'Codex : décision appliquée, révision D ouverte' });
    const logged = out.join('');
    expect(logged).toContain('outbound.send');
    for (const secret of [TOKEN, SECRET, NOTE, 'jwagner']) expect(logged).not.toContain(secret);
    // Message envoyé : jamais renvoyé.
    expect(await sendOutboundMessages(await getDb(), { fetchImpl })).toMatchObject({ sent: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('5xx, 429 (Retry-After) et erreur réseau : reprise espacée ; au-delà de la limite : refusé', async () => {
    configure(true);
    const db = await getDb();
    let clock = new Date('2026-10-09T10:00:00Z');
    const [m] = await db.insert(t.outboundMessages).values({
      target: 'codex', kind: 'ecr_decision', entityType: 'ecr', entityId: 'ECR-2026-002', payload: { requestId: 'ECR-2026-002', accepted: true, ecoRef: 'ECO-2026-002', modifierId: null, note: null },
      nextAttemptAt: clock,
    }).returning();
    const now = () => clock;
    const row = async () => (await db.select().from(t.outboundMessages).where(eq(t.outboundMessages.id, m.id)))[0];
    await sendOutboundMessages(db, { fetchImpl: async () => reply(503, { error: 'disabled' }), now });
    expect(await row()).toMatchObject({ status: 'pending', attempts: 1, lastStatus: 503, lastError: 'HTTP 503 disabled' });
    expect((await row()).nextAttemptAt.toISOString()).toBe('2026-10-09T10:01:00.000Z');
    // Avant l'heure de reprise : rien n'est envoyé.
    const early = vi.fn<typeof fetch>();
    await sendOutboundMessages(db, { fetchImpl: early, now });
    expect(early).not.toHaveBeenCalled();
    clock = new Date('2026-10-09T10:02:00Z');
    await sendOutboundMessages(db, { fetchImpl: async () => reply(429, { error: 'rate_limited' }, { 'retry-after': '600' }), now });
    expect((await row()).nextAttemptAt.toISOString()).toBe('2026-10-09T10:12:00.000Z');
    clock = new Date('2026-10-09T11:00:00Z');
    await sendOutboundMessages(db, { fetchImpl: async () => { throw new TypeError('fetch failed'); }, now });
    expect(await row()).toMatchObject({ status: 'pending', attempts: 3, lastError: 'Codex injoignable', lastStatus: null });
    await db.update(t.outboundMessages).set({ attempts: OUTBOUND_MAX_ATTEMPTS - 1, nextAttemptAt: clock }).where(eq(t.outboundMessages.id, m.id));
    await sendOutboundMessages(db, { fetchImpl: async () => reply(500, {}), now });
    expect(await row()).toMatchObject({ status: 'failed', attempts: OUTBOUND_MAX_ATTEMPTS, lastError: expect.stringContaining('abandon') });
  });

  it('4xx : refus définitif (pas de reprise), journal de la demande', async () => {
    configure(true);
    const db = await getDb();
    actAs('Animateur QHSE', 'all');
    const created = await (await import('@/server/engineering')).saveEcr({}, form({ kind: 'modification', subject: 'part', partRef: 'RED-RD5-010', title: 'Essai', ecrReason: 'Essai', siteId: 'site_a' }));
    // Demande de Vigie : jamais transmise à Codex (Codex ne connaît que les siennes).
    expect(await decideEcr({}, form({ id: created.id!, decision: 'rejected', note: 'Non', version: await entityVersion(db, 'ecr', created.id!) }))).toMatchObject({ ok: true });
    expect((await messages()).some((x) => x.entityId === created.id)).toBe(false);
    const [m] = await db.insert(t.outboundMessages).values({
      target: 'codex', kind: 'ecr_decision', entityType: 'ecr', entityId: 'ECR-2026-002', payload: { requestId: 'ECR-2026-002', accepted: false, ecoRef: null, modifierId: null, note: null },
    }).returning();
    await sendOutboundMessages(db, { fetchImpl: async () => reply(409, { error: 'already_decided', status: 'implemented' }) });
    expect((await db.select().from(t.outboundMessages).where(eq(t.outboundMessages.id, m.id)))[0]).toMatchObject({ status: 'failed', attempts: 1, lastError: 'HTTP 409 already_decided' });
    expect(await ecr('ECR-2026-002')).toMatchObject({ notifyStatus: 'failed', status: 'implemented' });
    expect(await lastLog('ecr', 'ECR-2026-002')).toMatchObject({ summary: 'Décision refusée par Codex : HTTP 409 already_decided' });
  });
});
