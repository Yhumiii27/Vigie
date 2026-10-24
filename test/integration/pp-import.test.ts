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

const api = vi.hoisted(() => ({ calls: 0, response: null as unknown }));
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
    beta = { messages: { create: async () => { api.calls++; return api.response; } } };
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
