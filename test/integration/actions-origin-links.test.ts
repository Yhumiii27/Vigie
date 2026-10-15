import { describe, expect, it, vi } from 'vitest';
import { cookieJar, form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { actionCount, actionRow, editFields, insertAction, NEW_ACTION } from './actions-helpers';
import { and, count, eq, inArray } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { ORIGIN_LOCKED } from '@/lib/action-links';
import { NON_QSE_LINK_MESSAGE } from '@/lib/action-rules';
import type { AuthState } from '@/lib/auth';
import { backfillActionLinks } from '@/lib/origin-links';
import { linkAction, unlinkAction } from '@/server/links';
import { saveAction } from '@/server/plan';
import { abandonAction } from '@/server/plan-ui';

// Sources d'origine des actions Documents et Environnement (ACT-01), côté écritures : posées à la création par le lien
// explicite de l'écran seulement (plus de lien déduit de la référence d'origine, réserve d'ACT-01 levée), contrôlées
// (service QHSE, site, source annulée), journalisées dans l'historique de l'action et de la source, verrouillées ensuite,
// conservées à l'abandon. Plans de prévention et permis : aucune action QSE (15/10/2026). Reprise des références
// textuelles des actions reprises (legacy_origin) par backfillActionLinks. L'affichage des sources sur la fiche est testé
// par actions-plan (flux C, loadActionDetail) ; les écrans sources par leurs propres tests (flux E2).
// Jeu de démonstration au 09/10/2026 : A-208 → PR-QHSE-002 (tous sites), A-219 → filière FD-04 (site A), A-218 →
// enlèvement FD-11 du 19/08/2026 (site B), A-178 « Registre des déchets 2026 ».

// Identité imposée par un test (périmètre restreint), sinon celle de la démonstration (rôle choisi).
const auth = vi.hoisted(() => ({ override: null as AuthState | null }));
vi.mock('@/lib/auth', async (orig) => {
  const real = await orig<typeof import('@/lib/auth')>();
  return { ...real, getAuthState: async () => auth.override ?? real.getAuthState() };
});

freshDemoDatabase();

const OTHER_SITE = 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.';

const db = () => getDb();
const entryId = async (streamId: string, removedOn: string) =>
  (await (await db()).select({ id: t.wasteEntries.id }).from(t.wasteEntries)
    .where(and(eq(t.wasteEntries.streamId, streamId), eq(t.wasteEntries.removedOn, removedOn))))[0].id;

/** Champs d'une nouvelle action liée à `link` (source imposée par l'élément). */
const fields = (source: string, link: string | null, extra: Record<string, string> = {}) => ({
  ...NEW_ACTION, source, originRef: link ? '' : 'Référence libre', ...(link ? { link } : {}), ...extra,
});
const create = async (source: string, link: string | null, extra: Record<string, string> = {}) => {
  const r = await saveAction({}, form(fields(source, link, extra)));
  expect(r, `${source} · ${link}`).toMatchObject({ ok: true });
  return actionRow(r.id!);
};

describe('création : source d’origine posée par le lien explicite seulement', () => {
  it('hors QHSE : refusé (ACT-22)', async () => {
    const before = await actionCount();
    for (const role of ['Salarié', 'Chef de projet', 'Chef de service'] as const) {
      actAs(role);
      expect(await saveAction({}, form(fields('revue_documentaire', 'document:PR-QHSE-002')))).toEqual({ error: 'Les actions QSE sont créées par le service QHSE.' });
    }
    expect(await actionCount()).toBe(before);
  });

  it('document : colonne posée, création journalisée sur l’action et sur le document', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const a = await create('revue_documentaire', 'document:PR-QHSE-002');
    expect(a).toMatchObject({ documentId: 'PR-QHSE-002', originRef: 'PR-QHSE-002', siteId: 'ville-a' });
    expect(await lastLog('action', a.id)).toMatchObject({ action: 'create', byId: 'clefevre' });
    expect(await lastLog('document', 'PR-QHSE-002')).toMatchObject({ action: 'link', summary: `Action ${a.id} créée et rattachée`, byId: 'clefevre' });
  });

  it('référence d’origine qui nomme une fiche, sans lien : simple texte (plus de résolution)', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const before = (await changeLog('document', 'PR-QHSE-002')).length;
    const a = await create('revue_documentaire', null, { originRef: 'PR-QHSE-002 révision après REX levage' });
    expect(a).toMatchObject({ documentId: null, preventionPlanId: null, wasteStreamId: null, originRef: 'PR-QHSE-002 révision après REX levage' });
    expect((await changeLog('document', 'PR-QHSE-002')).length).toBe(before);
    expect(await create('dechets', null, { originRef: 'FD-04' })).toMatchObject({ wasteStreamId: null });
  });

  it('environnement : filière, enlèvement (journal de l’enlèvement), registre annuel sans fiche', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await create('dechets', 'wastestream:FD-04')).toMatchObject({ wasteStreamId: 'FD-04', wasteEntryId: null, originRef: 'FD-04', source: 'dechets' });
    const entry = await entryId('FD-04', '2026-02-11');
    const a = await create('dechets', `wasteentry:${entry}`);
    expect(a).toMatchObject({ wasteEntryId: entry, wasteStreamId: null, originRef: 'FD-04 · 11/02/2026' });
    expect(await lastLog('waste_entry', entry)).toMatchObject({ action: 'link', summary: `Action ${a.id} créée et rattachée` });
    expect(await create('dechets', null, { originRef: 'Registre des déchets 2026' })).toMatchObject({ wasteStreamId: null, wasteEntryId: null });
    expect(await saveAction({}, form(fields('analyse_environnementale', 'wastestream:FD-04')))).toMatchObject({ fieldErrors: { source: "Source incompatible avec l'élément lié." } });
  });

  it('plan de prévention, permis : aucune action QSE', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const before = await actionCount();
    expect(await saveAction({}, form(fields('comex', 'preventionplan:PP-2026-015')))).toMatchObject({ fieldErrors: { link: NON_QSE_LINK_MESSAGE } });
    expect(await saveAction({}, form(fields('comex', 'permit:PF-2026-031')))).toMatchObject({ fieldErrors: { link: NON_QSE_LINK_MESSAGE } });
    expect(await actionCount()).toBe(before);
  });

  it('source d’un autre site, site de l’action différent de celui de la source, source annulée : refusés', async () => {
    const before = await actionCount();
    const fd11 = await entryId('FD-11', '2026-08-19');
    actAs('Animateur QHSE', 'ville-a');
    expect(await saveAction({}, form(fields('dechets', `wasteentry:${fd11}`)))).toEqual({ error: OTHER_SITE, fieldErrors: { link: OTHER_SITE } });
    actAs('Animateur QHSE', 'all');
    expect(await saveAction({}, form(fields('dechets', `wasteentry:${fd11}`, { siteId: 'ville-a' })))).toMatchObject({
      error: expect.stringContaining("L'action doit concerner le site de son élément lié (FD-11 · 19/08/2026)"), fieldErrors: { siteId: expect.any(String) },
    });
    const entry = await entryId('FD-04', '2026-02-11');
    await (await db()).update(t.wasteEntries).set({ cancelledAt: new Date(), cancelledById: 'clefevre', cancelReason: 'Doublon (test)' }).where(eq(t.wasteEntries.id, entry));
    expect(await saveAction({}, form(fields('dechets', `wasteentry:${entry}`)))).toMatchObject({ error: 'Enlèvement annulé : rattachement impossible.' });
    await (await db()).update(t.wasteEntries).set({ cancelledAt: null, cancelledById: null, cancelReason: null }).where(eq(t.wasteEntries.id, entry));
    expect(await actionCount()).toBe(before);
    // Même source sur son site : acceptée.
    actAs('Animateur QHSE', 'ville-b');
    expect(await create('dechets', `wasteentry:${fd11}`, { siteId: 'ville-b' })).toMatchObject({ wasteEntryId: fd11, siteId: 'ville-b' });
  });

  it('périmètre restreint : élément hors périmètre refusé sans rien en révéler', async () => {
    // Animateur QHSE rattaché au site B (site de rattachement toujours dans le périmètre), sites accordés : B seulement.
    auth.override = { status: 'authenticated', identity: { personId: 'jpetit', role: 'Animateur QHSE', siteIds: ['ville-b'] } };
    cookieJar.set('vigie_site', 'ville-b');
    try {
      expect(await saveAction({}, form(fields('dechets', 'wastestream:FD-04', { siteId: 'ville-b' })))).toEqual({
        error: 'Cet élément appartient à un site hors de votre périmètre.', fieldErrors: { link: 'Cet élément appartient à un site hors de votre périmètre.' },
      });
    } finally {
      auth.override = null;
      cookieJar.delete('vigie_site');
    }
  });
});

describe('origine verrouillée après la création', () => {
  it('modification : source d’origine conservée, absente du détail journalisé', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const a = await actionRow('A-219');
    expect(await saveAction({}, form(editFields(a, { detail: `${a.detail} (précisé)` })))).toEqual({ ok: true, id: 'A-219' });
    expect(await actionRow('A-219')).toMatchObject({ wasteStreamId: 'FD-04', originRef: 'FD-04', source: 'dechets' });
    const log = await lastLog('action', 'A-219');
    expect(log).toMatchObject({ action: 'update', summary: "Modifiée : détail de l'action" });
    expect(JSON.stringify(log?.details)).not.toContain('Origine');
  });

  it('changement de site : refusé hors du site de la source', async () => {
    actAs('Animateur QHSE', 'all');
    const a = await actionRow('A-219');
    expect(await saveAction({}, form(editFields(a, { siteId: 'ville-b' })))).toMatchObject({
      error: expect.stringContaining("L'action doit concerner le site de son élément lié"), fieldErrors: { siteId: expect.any(String) },
    });
    expect((await actionRow('A-219')).siteId).toBe('ville-a');
  });

  it('rattacher ou détacher une source d’origine après coup : refusé', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const before = (await changeLog('action', 'A-219')).length;
    expect(await linkAction('document:PR-QHSE-002', 'A-201')).toEqual({ error: ORIGIN_LOCKED });
    expect(await unlinkAction('wastestream:FD-04', 'A-219')).toEqual({ error: ORIGIN_LOCKED });
    expect((await actionRow('A-219')).wasteStreamId).toBe('FD-04');
    expect((await actionRow('A-201')).documentId).toBeNull();
    expect((await changeLog('action', 'A-219')).length).toBe(before);
    // Droits vérifiés d'abord : un Salarié reçoit le refus de son rôle.
    actAs('Salarié');
    expect(await linkAction('document:PR-QHSE-002', 'A-201')).toEqual({ error: "Réservé à l'animateur QHSE et à la direction." });
  });

  it('abandon : la source d’origine reste rattachée, absente des liens détachés', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const a = await create('revue_documentaire', 'document:PR-QHSE-005');
    expect(await abandonAction({}, form({ id: a.id, from: 'a_faire', reason: 'Doublon de test' }))).toMatchObject({ ok: true });
    expect(await actionRow(a.id)).toMatchObject({ status: 'abandonnee', documentId: 'PR-QHSE-005' });
    const log = await lastLog('action', a.id);
    expect(log).toMatchObject({ action: 'status', reason: 'Doublon de test', details: [{ field: 'Avancement', toKey: 'abandonnee' }] });
  });
});

describe('reprise des références d’origine (backfillActionLinks, npm run db:reprise-liens) : actions reprises seulement', () => {
  const NULLS = { preventionPlanId: null, permitId: null, documentId: null, wasteStreamId: null, wasteEntryId: null };

  it('essai sans écriture, puis liens posés et journalisés une seule fois, jamais pour une action postérieure à 0005', async () => {
    const d = await db();
    const fd11 = await entryId('FD-11', '2026-08-19');
    await insertAction('A-T01', { legacyOrigin: 'env', originRef: 'FD-11 · 19/08/2026', siteId: 'ville-b' });
    await insertAction('A-T02', { legacyOrigin: 'docs', originRef: 'IT-MON-012 révision C' });
    await insertAction('A-T03', { legacyOrigin: 'prevention', originRef: 'PP-2099-001' });
    await insertAction('A-T04', { legacyOrigin: 'env', originRef: 'FD-04 · 01/01/2026' });
    // Lien déjà posé (autre que celui de la référence) : jamais remplacé.
    await insertAction('A-T05', { legacyOrigin: 'prevention', originRef: 'PP-2026-015', preventionPlanId: 'PP-2026-013' });
    await insertAction('A-T06', { legacyOrigin: 'env', originRef: 'Registre des déchets 2026' });
    // Action postérieure à 0005 (legacy_origin vide) dont la référence nomme une fiche : jamais rattachée.
    await insertAction('A-T07', { legacyOrigin: null, originRef: 'PR-QHSE-002', ...NULLS });
    const logged = async () => (await d.select({ n: count() }).from(t.changeLog).where(and(eq(t.changeLog.entityType, 'action'), eq(t.changeLog.action, 'link'))))[0].n;
    const logsBefore = await logged();

    const dry = await backfillActionLinks(d, { apply: false });
    expect(dry.applied).toBe(false);
    const byId = new Map(dry.linked.map((l) => [l.actionId, l]));
    expect(byId.get('A-T01')).toMatchObject({ column: 'wasteEntryId', target: String(fd11), label: `enlèvement du registre des déchets FD-11 · 19/08/2026 · n° ${fd11}` });
    expect(byId.get('A-T02')).toMatchObject({ column: 'documentId', target: 'IT-MON-012' });
    expect(byId.get('A-T04')).toMatchObject({ column: 'wasteStreamId', target: 'FD-04', note: expect.stringContaining('Aucun enlèvement FD-04 le 01/01/2026') });
    expect(byId.has('A-T05')).toBe(false);
    expect(byId.has('A-T07')).toBe(false);
    expect(dry.unresolved).toEqual(expect.arrayContaining([
      { actionId: 'A-T06', origin: 'env', originRef: 'Registre des déchets 2026', reason: 'Registre annuel des déchets : aucune fiche source.' },
      { actionId: 'A-T03', origin: 'prevention', originRef: 'PP-2099-001', reason: 'Aucun plan de prévention ni permis de cette référence.' },
    ]));
    expect(dry.unresolved.some((u) => u.actionId === 'A-T07')).toBe(false);
    expect(dry.examined).toBe(dry.alreadyLinked + dry.linked.length + dry.unresolved.length);
    expect((await actionRow('A-T02')).documentId).toBeNull();
    expect(await logged()).toBe(logsBefore);

    const applied = await backfillActionLinks(d, { apply: true });
    expect(applied).toMatchObject({ applied: true, linked: dry.linked, unresolved: dry.unresolved });
    const rows = new Map((await d.select().from(t.actions).where(inArray(t.actions.id, ['A-T01', 'A-T02', 'A-T03', 'A-T05', 'A-T07']))).map((r) => [r.id, r]));
    expect(rows.get('A-T01')?.wasteEntryId).toBe(fd11);
    expect(rows.get('A-T02')?.documentId).toBe('IT-MON-012');
    expect(rows.get('A-T03')).toMatchObject(NULLS);
    expect(rows.get('A-T05')).toMatchObject({ preventionPlanId: 'PP-2026-013', permitId: null });
    expect(rows.get('A-T07')).toMatchObject(NULLS);
    expect(await lastLog('action', 'A-T02')).toMatchObject({
      action: 'link', byId: null, summary: "Origine rattachée : document IT-MON-012 (reprise de la référence d'origine)",
      details: [{ field: 'Origine', from: null, to: 'document IT-MON-012' }],
    });
    expect(await logged()).toBe(logsBefore + dry.linked.length);

    // Relance : rien à poser, aucune écriture.
    const again = await backfillActionLinks(d, { apply: true });
    expect(again).toMatchObject({ applied: true, linked: [], unresolved: dry.unresolved, alreadyLinked: dry.alreadyLinked + dry.linked.length });
    expect(await logged()).toBe(logsBefore + dry.linked.length);
  });
});
