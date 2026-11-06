import '../next-mocks';
import { afterEach, describe, expect, it } from 'vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { form } from '../next-mocks';
import { actAs, freshDemoDatabase } from '../helpers';
import { getDb, schema as t } from '@/db';
import { installForeignSubstitutes, substituteTable } from '@/db/foreign-substitutes';
import { loadDocumentSignals, loadDocuments, resolveDocuments } from '@/lib/data/documents';
import { loadEventDetail } from '@/lib/data/events';
import { loadRisks } from '@/lib/data/risks';
import { loadVisibleTodo } from '@/lib/data/todo';
import { resetConfig } from '@/lib/env';
import { unavailableMessage } from '@/lib/foreign/labels';
import { codexDocumentHref, confReadable, inRegisterScope } from '@/lib/rules/documents';
import { linkRiskMeasure } from '@/server/risks';

// Lot 4 de la convergence M-02 (D10, décision CV-05 du 05/11/2026) : documents lus dans Codex. Périmètre du registre
// (C-06 : départements QUA / HSE sans rattachement, site), confidentialité par rôle, consultation du Salarié, ancien
// identifiant (alias), document cité hors du périmètre toujours résolu, actions et événements rattachés, mesure de maîtrise
// (DUE-19), échéances (revues, circuits), lien profond vers Codex (VIGIE_CODEX_URL) et source indisponible.

freshDemoDatabase();

const exec = async (q: string) => (await getDb()).execute(sql.raw(q));
const reinstall = async () => installForeignSubstitutes(await getDb(), { engine: 'pglite', demo: true });
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

afterEach(() => {
  delete process.env.VIGIE_CODEX_URL;
  resetConfig();
});

describe('règles pures', () => {
  it('périmètre QHSE et confidentialité', () => {
    expect(inRegisterScope({ attachment: 'none', department: 'HSE' })).toBe(true);
    expect(inRegisterScope({ attachment: 'project', department: 'QUA' })).toBe(false);
    expect(inRegisterScope({ attachment: 'none', department: 'ACH' })).toBe(false);
    expect(['public', 'restreint', 'interne'].every((c) => confReadable(c, false))).toBe(true);
    expect(confReadable('confidentiel', false)).toBe(false);
    expect(confReadable('confidentiel', true)).toBe(true);
    expect(confReadable('tres_confidentiel', true)).toBe(false);
    expect(codexDocumentHref(null, 'PRO-QUA-0002')).toBeNull();
    expect(codexDocumentHref('https://codex.exemple.fr/', 'PRO QUA')).toBe('https://codex.exemple.fr/documents/PRO%20QUA');
  });
});

describe('registre lu dans Codex', () => {
  it('QHSE, tous les sites : documents QUA / HSE sans rattachement, confidentiel compris, hors périmètre exclu', async () => {
    actAs('Animateur QHSE', 'all');
    const data = await loadDocuments();
    expect(data.source.ok).toBe(true);
    const list = ids(data.rows);
    expect(list).toContain('PRO-QUA-0002');
    expect(list).toContain('PRO-HSE-0005'); // confidentiel
    expect(list).not.toContain('PRO-ACH-0001'); // département Achats
    expect(data.aliasOf['PR-QHSE-002']).toBe('PRO-QUA-0002');
    const doc = data.rows.find((r) => r.id === 'PRO-QUA-0006')!;
    // Révision ouverte en validation (circuit), révision liée à l'action A-212 (document_actions), conservation par type.
    expect(doc).toMatchObject({ revInForce: 'B', revWorking: 'C', inForce: true, retention: '3 ans après remplacement', codexHref: null });
    expect(doc.circuit).toMatchObject({ revision: 'C', steps: [{ label: 'Responsable qualité', current: true }, { label: 'Direction', current: false }] });
    expect(doc.revisions[0]).toMatchObject({ letter: 'C', status: 'in_review', action: { id: 'A-212' } });
    expect(doc.events.map((e) => e.id)).toEqual(['EV-2026-130']);
    // Action d'origine (actions.document_id, ACT-01).
    expect(data.rows.find((r) => r.id === 'PRO-QUA-0002')!.openActions.map((a) => a.id)).toContain('A-208');
    expect(data.kpis.find((k) => k.key === 'retard')!.value).toBe(3);
  });

  it('site sélectionné : document d’un autre site signalé « ailleurs » ; document commun gardé', async () => {
    actAs('Animateur QHSE', 'site_b');
    const data = await loadDocuments();
    expect(ids(data.rows)).not.toContain('PRO-HSE-0003');
    expect(ids(data.rows)).toContain('PRO-HSE-0004');
    expect(data.elsewhere['PRO-HSE-0003']).toBeTruthy();
  });

  it('encadrement : confidentiel absent ; Salarié : documents en vigueur seulement, sans circuit ni actions', async () => {
    actAs('Chef de service', 'site_a');
    expect(ids((await loadDocuments()).rows)).not.toContain('PRO-HSE-0005');
    actAs('Salarié', 'site_a');
    const reader = await loadDocuments({ readOnly: true });
    expect(reader.rows.every((r) => r.inForce && !r.circuit && !r.openActions.length && !r.events.length)).toBe(true);
    expect(ids(reader.rows)).not.toContain('PRO-HSE-0003'); // brouillon jamais en vigueur
    expect(reader.unavailable['PRO-HSE-0003']).toBe('draft');
    expect(reader.unavailable['PRO-QUA-0007']).toBe('retired');
    expect(reader.rows.find((r) => r.id === 'PRO-QUA-0006')!.revisions.map((r) => r.letter)).toEqual(['B']);
  });

  it('lien profond vers Codex avec VIGIE_CODEX_URL', async () => {
    process.env.VIGIE_CODEX_URL = 'https://codex.exemple.fr';
    resetConfig();
    actAs('Animateur QHSE', 'all');
    expect((await loadDocuments()).rows.find((r) => r.id === 'PRO-QUA-0002')!.codexHref).toBe('https://codex.exemple.fr/documents/PRO-QUA-0002');
  });
});

describe('documents cités par les fiches de Vigie', () => {
  it('résolu par identifiant ou alias, hors du périmètre du registre compris ; titre confidentiel masqué', async () => {
    actAs('Chef de service', 'site_a');
    const r = await resolveDocuments(['IT-USI-004', 'PRO-ACH-0001', 'PRO-HSE-0005', 'XX-INCONNU']);
    expect(r.byRef.get('IT-USI-004')).toMatchObject({ id: 'PRO-QUA-0006', inRegister: true, href: '/documents?doc=PRO-QUA-0006' });
    expect(r.byRef.get('PRO-ACH-0001')).toMatchObject({ inRegister: false, href: null, readable: true });
    expect(r.byRef.get('PRO-HSE-0005')).toMatchObject({ readable: false });
    expect(r.byRef.has('XX-INCONNU')).toBe(false);
  });

  it('événement : document du registre ou hors périmètre affiché', async () => {
    actAs('Animateur QHSE', 'site_a');
    expect((await loadEventDetail('EV-2026-130'))!.links.document).toMatchObject({ id: 'PRO-QUA-0006', label: expect.stringContaining('PRO-QUA-0006 · Contrôle'), href: '/documents?doc=PRO-QUA-0006' });
    await (await getDb()).update(t.events).set({ documentId: 'PRO-ACH-0001' }).where(eq(t.events.id, 'EV-2026-130'));
    expect((await loadEventDetail('EV-2026-130'))!.links.document).toMatchObject({ id: 'PRO-ACH-0001', label: 'PRO-ACH-0001 · Passation des commandes d’achat', href: '' });
    await (await getDb()).update(t.events).set({ documentId: 'PRO-QUA-0006' }).where(eq(t.events.id, 'EV-2026-130'));
  });

  it('mesure de maîtrise (DUE-19) : état lu dans Codex, choix contrôlé contre la vue', async () => {
    actAs('Animateur QHSE', 'site_a');
    const db = await getDb();
    const [link] = await db.select().from(t.riskMeasureLinks).where(and(eq(t.riskMeasureLinks.kind, 'document'), isNull(t.riskMeasureLinks.removedAt)));
    expect(link.documentId).toBe('PRO-HSE-0002');
    const measure = (await loadRisks()).risks.find((r) => r.id === link.riskId)!.measures.find((m) => m.kind === 'document')!;
    expect(measure).toMatchObject({ targetId: 'PRO-HSE-0002', valid: true, tone: 'warn', state: expect.stringContaining('revue périodique dépassée') });
    // Brouillon jamais en vigueur : refusé ; document en vigueur : lié et journalisé.
    expect(await linkRiskMeasure({}, form({ riskId: String(link.riskId), kind: 'document', targetId: 'PRO-HSE-0003' }))).toMatchObject({ fieldErrors: { targetId: expect.any(String) } });
    expect(await linkRiskMeasure({}, form({ riskId: String(link.riskId), kind: 'document', targetId: 'PRO-QUA-0003' }))).toMatchObject({ ok: true });
  });
});

describe('échéances documentaires (DOC-14)', () => {
  it('revue dépassée au propriétaire (matricule), circuit à la personne de l’étape en cours, clés stables', async () => {
    actAs('Animateur QHSE', 'all');
    const { todo } = await loadDocumentSignals();
    expect(todo.find((x) => x.key === 'revue-documentaire|PRO-QUA-0002')).toMatchObject({ kind: 'Revue documentaire', overdue: true, ownerIds: ['lmoreau'], siteId: null });
    expect(todo.find((x) => x.key === 'validation-documentaire|PRO-HSE-0001|C')).toMatchObject({ kind: 'Validation documentaire', ownerIds: ['hmarchand'], title: expect.stringContaining('(direction)') });
    expect(todo.find((x) => x.key === 'validation-documentaire|PRO-QUA-0006|C')).toMatchObject({ ownerIds: ['lmoreau'], siteId: 'site_a' });
    // Encadrement : ses seules échéances (propriétaire), écran Documents en consultation.
    actAs('Chef de service', 'site_a');
    const visible = (await loadVisibleTodo()).filter((x) => x.href?.startsWith('/documents'));
    expect(visible.every((x) => x.ownerIds?.includes('sbenali'))).toBe(true);
  });
});

describe('Codex indisponible', () => {
  it('bandeau, aucune échéance par document, une échéance commune ; choix refusé avec le message de la source', async () => {
    await exec('drop view codex.pub_documents');
    try {
      actAs('Animateur QHSE', 'all');
      const data = await loadDocuments();
      expect(data.source).toEqual({ ok: false, message: unavailableMessage('documents') });
      expect(data.rows).toEqual([]);
      expect((await loadDocumentSignals()).todo).toMatchObject([{ key: 'documents-codex-indisponible', siteId: null }]);
      // Mesure liée : jamais signalée à tort ; nouveau choix refusé.
      const db = await getDb();
      const [link] = await db.select().from(t.riskMeasureLinks).where(and(eq(t.riskMeasureLinks.kind, 'document'), eq(t.riskMeasureLinks.documentId, 'PRO-HSE-0002')));
      actAs('Animateur QHSE', 'site_a');
      expect((await loadRisks()).risks.find((r) => r.id === link.riskId)!.measures.find((m) => m.targetId === 'PRO-HSE-0002')).toMatchObject({ valid: true, state: 'Donnée de Codex indisponible' });
      expect(await linkRiskMeasure({}, form({ riskId: String(link.riskId), kind: 'document', targetId: 'PRO-QUA-0001' }))).toMatchObject({ fieldErrors: { targetId: unavailableMessage('documents') } });
      // Événement : identifiant seul, état de la source.
      expect((await loadEventDetail('EV-2026-130'))!.links.document).toMatchObject({ id: 'PRO-QUA-0006', label: 'PRO-QUA-0006', status: { label: 'Codex indisponible' } });
    } finally {
      await reinstall();
    }
    expect((await exec(`select count(*)::int as n from codex.${substituteTable('pub_documents')}`) as unknown as { rows: { n: number }[] }).rows[0].n).toBeGreaterThan(0);
  });
});
