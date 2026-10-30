import '../next-mocks';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { actAs, changeLog, freshDemoDatabase } from '../helpers';
import { getDb, schema as t } from '@/db';
import { resetConfig } from '@/lib/env';
import { aiQuotaProblem, clearScanCache, loadAiUsage } from '@/server/ai-usage';
import { createPlanFromImport, detectPpImport, savePpTemplate } from '@/server/pp-import';

// Import du plan de prévention (QUA-10) : détection sur les formulaires d'exemple, modèle reconnu, création du plan
// (droits, site, journal, fichier joint) ; lecture d'un scan par l'API Claude simulée (INT-06 : consommation journalisée,
// cache d'un même fichier, plafonds). Aucun appel réel à l'API.

const api = vi.hoisted(() => ({ calls: 0, response: null as unknown, last: null as null | Record<string, unknown> }));
vi.mock('@anthropic-ai/sdk', () => {
  class AnthropicError extends Error {}
  class APIError extends AnthropicError { status?: number }
  const sub = () => class extends APIError {};
  class Anthropic {
    static AnthropicError = AnthropicError;
    static APIError = APIError;
    static AuthenticationError = sub();
    static PermissionDeniedError = sub();
    static NotFoundError = sub();
    static RateLimitError = sub();
    static BadRequestError = sub();
    static APIConnectionError = sub();
    static APIConnectionTimeoutError = sub();
    static InternalServerError = sub();
    // INT-13 : appel en flux (stream puis finalMessage).
    beta = { messages: { stream: (params: Record<string, unknown>) => { api.calls++; api.last = params; return { finalMessage: async () => api.response }; } } };
  }
  return { default: Anthropic };
});

freshDemoDatabase();

const sample = (name: string, type: string) => new File([readFileSync(path.join(process.cwd(), 'samples', name))], name, { type });
const PDF = 'application/pdf';
const detect = (f: File, templateId?: number) => {
  const fd = new FormData();
  fd.append('file', f, f.name);
  if (templateId) fd.set('templateId', String(templateId));
  return detectPpImport(fd);
};
/** Réponse de l'API simulée : deux cases et un champ lus sur le scan. */
const scanResponse = (usage = { input_tokens: 4200, output_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }) => ({
  model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null, usage,
  content: [{ type: 'text', text: JSON.stringify({
    isPreventionPlan: true, warnings: [],
    fields: [
      { key: 'risques.travail_hauteur', label: 'Travail en hauteur', section: "Risques d'interférence", kind: 'checkbox', checked: true, value: null, page: 1 },
      { key: 'risques.bruit', label: 'Bruit', section: "Risques d'interférence", kind: 'checkbox', checked: false, value: null, page: 1 },
      { key: 'entreprise.raison_sociale', label: 'Raison sociale', section: 'Entreprise extérieure', kind: 'text', checked: null, value: 'Entreprise Chaudronnerie Soudure', page: 1 },
    ],
  }) }],
});
/** Photo de formulaire (JPEG minimal). */
const photo = (n: number) => new File([Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, n)])], `scan-${n}.jpg`, { type: 'image/jpeg' });

describe('détection et création du plan depuis les formulaires d’exemple', () => {
  it('droits : encadrement et QHSE seulement', async () => {
    actAs('Salarié', 'all');
    expect(await detect(sample('plan-de-prevention-vierge.pdf', PDF))).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it('PDF vierge puis rempli : modèle enregistré et reconnu par son empreinte', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const blank = await detect(sample('plan-de-prevention-vierge.pdf', PDF));
    expect(blank).toMatchObject({ ok: true, format: 'pdf_form', matchedTemplateId: null, ai: { used: false } });
    if (!blank.ok) throw new Error();
    expect(blank.fields).toHaveLength(42);
    const mapping = Object.fromEntries(blank.fields.map((f) => [f.key, { section: f.section ?? 'Formulaire', label: f.label }]));
    const saved = await savePpTemplate({}, (() => {
      const fd = new FormData();
      Object.entries({ name: 'Formulaire Seveso (test)', format: 'pdf_form', signature: blank.signature!, mapping: JSON.stringify(mapping) }).forEach(([k, v]) => fd.set(k, v));
      return fd;
    })());
    expect(saved).toMatchObject({ ok: true });
    const filled = await detect(sample('plan-de-prevention-exemple.pdf', PDF));
    expect(filled).toMatchObject({ ok: true, format: 'pdf_form', signature: blank.signature, matchedTemplateId: Number(saved.id) });
  });

  it('création : plan « À signer », fichier source joint, entreprise existante, journal', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const fd = new FormData();
    const f = sample('plan-de-prevention-exemple.pdf', PDF);
    fd.append('file', f, f.name);
    Object.entries({
      format: 'pdf_form', sections: '[]', contractorId: 'EE-004', siteId: 'ville-a', title: "Remplacement d'un tronçon d'air comprimé",
      location: 'Atelier usinage', startOn: '2026-10-12', endOn: '2026-10-16', estimatedHours: '60', dangerousWork: '1',
      inspectionOn: '2026-10-06', measures: 'Balisage, permis de feu, surveillance 2 h après les points chauds.', signedEuOn: '2026-10-07',
    }).forEach(([k, v]) => fd.set(k, v));
    const r = await createPlanFromImport({}, fd);
    expect(r).toMatchObject({ ok: true, id: expect.stringMatching(/^PP-2026-\d{3}$/) });
    const db = await getDb();
    const [plan] = await db.select().from(t.preventionPlans).where(eq(t.preventionPlans.id, r.id!));
    expect(plan).toMatchObject({ status: 'a_signer', contractorId: 'EE-004', dangerousWork: true, signedEuOn: '2026-10-07' });
    const [att] = await db.select().from(t.attachments).where(eq(t.attachments.id, plan.importedFromId!));
    expect(att).toMatchObject({ entityId: r.id, mimeType: PDF, fileName: 'plan-de-prevention-exemple.pdf' });
    expect((await changeLog('prevention_plan', r.id!)).map((e) => e.action)).toEqual(['create']);
  });

  it('création : site hors du périmètre refusé, fichier non conforme refusé', async () => {
    actAs('Chef de service', 'ville-a');
    const fd = new FormData();
    const html = new File(['<html><script>alert(1)</script></html>'], 'plan.pdf', { type: PDF });
    fd.append('file', html, html.name);
    Object.entries({ format: 'pdf_form', sections: '[]', contractorId: 'EE-004', siteId: 'ville-a', title: 'x', location: 'y', startOn: '2026-10-12', endOn: '2026-10-16', estimatedHours: '10' })
      .forEach(([k, v]) => fd.set(k, v));
    expect(await createPlanFromImport({}, fd)).toMatchObject({ error: expect.stringMatching(/ne correspond pas à un format accepté/) });
  });
});

describe('lecture d’un scan par l’API Claude (INT-06)', () => {
  beforeAll(() => {
    Object.assign(process.env, { VIGIE_AI_IMPORT: '1', ANTHROPIC_API_KEY: 'cle-de-test', VIGIE_AI_DAILY_SCANS: '2' });
    resetConfig();
    clearScanCache();
  });
  afterAll(() => {
    for (const k of ['VIGIE_AI_IMPORT', 'ANTHROPIC_API_KEY', 'VIGIE_AI_DAILY_SCANS']) delete process.env[k];
    resetConfig();
  });

  it('consommation journalisée, même fichier servi par le cache, plafond par personne', async () => {
    actAs('Animateur QHSE', 'ville-a');
    api.response = scanResponse();
    const first = await detect(photo(1));
    expect(first).toMatchObject({ ok: true, format: 'scan', ai: { used: true, available: true } });
    if (first.ok) expect(first.fields.map((f) => f.key)).toEqual(['risques.travail_hauteur', 'risques.bruit', 'entreprise.raison_sociale']);
    expect(api.calls).toBe(1);
    const db = await getDb();
    const rows = await db.select().from(t.aiUsage);
    expect(rows).toEqual([expect.objectContaining({
      personId: 'clefevre', feature: 'pp_scan', model: 'claude-opus-5-5', servedModel: 'claude-opus-5-5', outcome: 'ok',
      inputTokens: 4200, outputTokens: 900, fileHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    })]);
    // Même fichier : aucun nouvel appel, lecture « cache » hors plafond.
    expect(await detect(photo(1))).toMatchObject({ ok: true, ai: { used: true } });
    expect(api.calls).toBe(1);
    expect((await db.select().from(t.aiUsage)).map((r) => r.outcome)).toEqual(['ok', 'cache']);
    expect(await loadAiUsage('clefevre')).toEqual({ monthCalls: 1, monthTokens: 5100, personDay: 1 });
    // Deuxième fichier : admis (2 lectures par 24 h), le troisième est refusé sans appel.
    expect(await detect(photo(2))).toMatchObject({ ok: true, ai: { used: true } });
    const third = await detect(photo(3));
    expect(third).toMatchObject({ ok: true, ai: { used: false, error: expect.stringMatching(/Plafond de 2 lectures automatiques/) } });
    expect(api.calls).toBe(2);
  });

  it('refus du service : appel journalisé « refus », jetons comptés', async () => {
    actAs('Direction', 'all');
    api.response = { ...scanResponse({ input_tokens: 3000, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }), stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] };
    const r = await detect(photo(9));
    expect(r).toMatchObject({ ok: true, ai: { used: false, error: expect.stringMatching(/refusée/) } });
    const db = await getDb();
    const [last] = (await db.select().from(t.aiUsage)).slice(-1);
    expect(last).toMatchObject({ outcome: 'refus', inputTokens: 3000 });
  });

  it('plafonds (règle pure)', () => {
    const limits = { dailyScansPerPerson: 3, monthlyTokens: 1000 };
    expect(aiQuotaProblem({ monthTokens: 0, personDay: 2 }, limits)).toBeNull();
    expect(aiQuotaProblem({ monthTokens: 0, personDay: 3 }, limits)).toMatch(/Plafond de 3/);
    expect(aiQuotaProblem({ monthTokens: 1000, personDay: 0 }, limits)).toMatch(/mensuel/);
    expect(aiQuotaProblem({ monthTokens: 10 ** 9, personDay: 0 }, { ...limits, monthlyTokens: 0 })).toBeNull();
  });
});

describe('import de plusieurs pages, HEIC, modèle configurable (INT-13, INT-14)', () => {
  beforeAll(() => {
    Object.assign(process.env, { VIGIE_AI_IMPORT: '1', ANTHROPIC_API_KEY: 'cle-de-test' });
    resetConfig();
    clearScanCache();
  });
  afterAll(() => {
    for (const k of ['VIGIE_AI_IMPORT', 'ANTHROPIC_API_KEY', 'VIGIE_AI_MODEL', 'VIGIE_AI_TIMEOUT']) delete process.env[k];
    resetConfig();
  });
  const detectAll = (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('file', f, f.name));
    return detectPpImport(fd);
  };
  const heic = () => new File([Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(100)])], 'IMG_0001.jpg', { type: 'image/jpeg' });

  it('plusieurs photos : lues en une fois, pages dans l’ordre, appel en flux avec repli côté serveur', async () => {
    actAs('Animateur QHSE', 'ville-a');
    api.response = scanResponse();
    const before = api.calls;
    const r = await detectAll([photo(21), photo(22), photo(23)]);
    expect(r).toMatchObject({ ok: true, format: 'scan', pageCount: 3, fileName: 'scan-21.jpg (+ 2 pages)', ai: { used: true } });
    expect(api.calls).toBe(before + 1);
    const params = api.last as { model: string; max_tokens: number; fallbacks?: string; betas: string[]; messages: { content: { type: string; text?: string }[] }[] };
    expect(params).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 64_000, fallbacks: 'default' });
    expect(params.betas).toContain('server-side-fallback-2026-07-01');
    const content = params.messages[0].content;
    expect(content.map((b) => b.type)).toEqual(['image', 'image', 'image', 'text']);
    expect(content[3].text).toMatch(/fourni en 3 images/);
  });

  it('plusieurs fichiers : photos seulement, 8 pages au plus ; HEIC refusé d’après son contenu, sans appel', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const calls = api.calls;
    expect(await detectAll([photo(31), sample('plan-de-prevention-vierge.pdf', PDF)])).toMatchObject({ ok: false, error: expect.stringMatching(/photos des pages/) });
    expect(await detectAll(Array.from({ length: 9 }, (_, i) => photo(40 + i)))).toMatchObject({ ok: false, error: expect.stringMatching(/8 pages au plus/) });
    expect(await detectAll([heic()])).toMatchObject({ ok: false, error: expect.stringMatching(/HEIC/) });
    expect(await detectAll([new File(['x'], 'IMG.HEIC', { type: 'image/heic' })])).toMatchObject({ ok: false, error: expect.stringMatching(/HEIC/) });
    expect(api.calls).toBe(calls);
  });

  it('modèle configuré (VIGIE_AI_MODEL) : journalisé, sans repli s’il ne l’accepte pas', async () => {
    Object.assign(process.env, { VIGIE_AI_MODEL: 'claude-haiku-5-5', VIGIE_AI_TIMEOUT: '900' });
    resetConfig();
    actAs('Animateur QHSE', 'ville-a');
    api.response = { ...scanResponse(), model: 'claude-haiku-5-5' };
    expect(await detectAll([photo(61)])).toMatchObject({ ok: true, ai: { used: true } });
    expect(api.last).toMatchObject({ model: 'claude-haiku-5-5' });
    expect(api.last).not.toHaveProperty('fallbacks');
    expect((api.last as { betas: string[] }).betas).toEqual(['structured-outputs-2025-12-15']);
    const db = await getDb();
    const [last] = (await db.select().from(t.aiUsage)).slice(-1);
    expect(last).toMatchObject({ model: 'claude-haiku-5-5', outcome: 'ok' });
    delete process.env.VIGIE_AI_MODEL;
    delete process.env.VIGIE_AI_TIMEOUT;
    resetConfig();
  });

  it('création depuis plusieurs pages : première page source du plan, autres pages jointes, journal', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const fd = new FormData();
    [photo(71), photo(72)].forEach((f) => fd.append('file', f, f.name));
    Object.entries({
      format: 'scan', sections: '[]', contractorId: 'EE-004', siteId: 'ville-a', title: 'Peinture du hall',
      location: 'Hall 2', startOn: '2026-10-12', endOn: '2026-10-16', estimatedHours: '30',
    }).forEach(([k, v]) => fd.set(k, v));
    const r = await createPlanFromImport({}, fd);
    expect(r).toMatchObject({ ok: true });
    const db = await getDb();
    const [plan] = await db.select().from(t.preventionPlans).where(eq(t.preventionPlans.id, r.id!));
    const atts = await db.select().from(t.attachments).where(eq(t.attachments.entityId, r.id!));
    expect(atts.map((a) => a.fileName).sort()).toEqual(['scan-71.jpg', 'scan-72.jpg']);
    expect(atts.find((a) => a.id === plan.importedFromId)?.fileName).toBe('scan-71.jpg');
    expect((plan.formData as { source: { fileName: string } }).source.fileName).toBe('scan-71.jpg (+ 1 page)');
    expect((await changeLog('prevention_plan', r.id!)).map((e) => e.action)).toEqual(['create']);
    // Plusieurs fichiers hors scan : refusé.
    const bad = new FormData();
    [photo(73), photo(74)].forEach((f) => bad.append('file', f, f.name));
    Object.entries({ format: 'pdf_form', sections: '[]', contractorId: 'EE-004', siteId: 'ville-a', title: 'x', location: 'y', startOn: '2026-10-12', endOn: '2026-10-16', estimatedHours: '10' })
      .forEach(([k, v]) => bad.set(k, v));
    expect(await createPlanFromImport({}, bad)).toMatchObject({ error: expect.stringMatching(/Plusieurs pages/) });
  });
});
