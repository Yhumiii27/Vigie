import { describe, expect, it, vi } from 'vitest';
import { cookieJar, form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { and, count, eq, inArray } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { ORIGIN_LOCKED } from '@/lib/action-links';
import type { AuthState } from '@/lib/auth';
import { loadLinkedAction } from '@/lib/data/actions';
import { backfillActionLinks } from '@/lib/origin-links';
import { linkAction, unlinkAction } from '@/server/links';
import { saveAction } from '@/server/plan';
import { cancelAction } from '@/server/plan-ui';

// Sources d'origine des actions Prévention, Documents et Environnement (ACT-01) : posées à la création (lien explicite ou
// référence d'origine résolue), contrôlées (droits, site, source annulée), journalisées dans l'historique de l'action et de
// la source, verrouillées ensuite ; reprise idempotente des références textuelles des actions existantes.
// Jeu de démonstration au 09/10/2026 : A-206 → PP-2026-012 (site B), A-216 → PF-2026-031, A-208 → PR-QHSE-002 (tous sites),
// A-219 → filière FD-04 (site A), A-218 → enlèvement FD-11 du 19/08/2026 (site B), A-178 « Registre des déchets 2026 ».

// Identité imposée par un test (périmètre restreint), sinon celle de la démonstration (rôle choisi).
const auth = vi.hoisted(() => ({ override: null as AuthState | null }));
vi.mock('@/lib/auth', async (orig) => {
  const real = await orig<typeof import('@/lib/auth')>();
  return { ...real, getAuthState: async () => auth.override ?? real.getAuthState() };
});

freshDemoDatabase();

const DENIED = 'Votre rôle ne permet pas cette modification.';
const OTHER_SITE = 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.';

const db = () => getDb();
const action = async (id: string) => (await (await db()).select().from(t.actions).where(eq(t.actions.id, id)))[0];
const actionCount = async () => (await (await db()).select({ n: count() }).from(t.actions))[0].n;
const entryId = async (streamId: string, removedOn: string) =>
  (await (await db()).select({ id: t.wasteEntries.id }).from(t.wasteEntries)
    .where(and(eq(t.wasteEntries.streamId, streamId), eq(t.wasteEntries.removedOn, removedOn))))[0].id;

/** Champs d'une nouvelle action (site sélectionné par défaut). */
const fields = (origin: string, originRef: string, extra: Record<string, string> = {}) => ({
  title: `Action de test · ${originRef}`, origin, originRef, pilotId: 'clefevre', dueOn: '2026-11-15', kind: 'P', siteId: '', ...extra,
});
const create = async (origin: string, originRef: string, extra: Record<string, string> = {}) => {
  const r = await saveAction({}, form(fields(origin, originRef, extra)));
  expect(r, `${origin} · ${originRef}`).toMatchObject({ ok: true });
  return action(r.id!);
};

describe('création : source d’origine posée par la référence ou par le lien de l’écran', () => {
  it('Salarié : refusé', async () => {
    actAs('Salarié');
    const before = await actionCount();
    expect(await saveAction({}, form(fields('prevention', 'PP-2026-015')))).toEqual({ error: DENIED });
    expect(await actionCount()).toBe(before);
  });

  it('plan de prévention : colonne posée, création journalisée sur l’action et sur le plan', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const a = await create('prevention', 'PP-2026-015');
    expect(a).toMatchObject({ preventionPlanId: 'PP-2026-015', permitId: null, originRef: 'PP-2026-015', siteId: 'ville-a' });
    expect(await lastLog('action', a.id)).toMatchObject({ action: 'create', byId: 'clefevre' });
    expect(await lastLog('prevention_plan', 'PP-2026-015')).toMatchObject({ action: 'link', summary: `Action ${a.id} créée et rattachée`, byId: 'clefevre' });
    // Premier mot de la référence ; permis par lien explicite de l'écran appelant.
    expect(await create('prevention', 'PP-2026-013 · coactivité du 09/10')).toMatchObject({ preventionPlanId: 'PP-2026-013' });
    const permit = await create('prevention', 'PF-2026-031', { link: 'permit:PF-2026-031' });
    expect(permit).toMatchObject({ permitId: 'PF-2026-031', preventionPlanId: null });
    expect(await lastLog('permit', 'PF-2026-031')).toMatchObject({ action: 'link', summary: `Action ${permit.id} créée et rattachée` });
  });

  it('document : référence résolue sans droit de saisie sur l’écran Documents, lien explicite réservé', async () => {
    actAs('Chef de projet', 'ville-a'); // Documents en consultation seule
    const a = await create('docs', 'PR-QHSE-002 révision après REX levage');
    expect(a).toMatchObject({ documentId: 'PR-QHSE-002' });
    expect(await lastLog('document', 'PR-QHSE-002')).toMatchObject({ action: 'link', summary: `Action ${a.id} créée et rattachée`, byId: 'edubois' });
    const before = await actionCount();
    expect(await saveAction({}, form(fields('docs', 'PR-QHSE-002', { link: 'document:PR-QHSE-002' })))).toEqual({ error: DENIED });
    expect(await actionCount()).toBe(before);
  });

  it('environnement : filière, enlèvement (journal de l’enlèvement), registre annuel sans fiche source', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await create('env', 'FD-04')).toMatchObject({ wasteStreamId: 'FD-04', wasteEntryId: null });
    const entry = await entryId('FD-04', '2026-02-11');
    const a = await create('env', 'FD-04 · 11/02/2026');
    expect(a).toMatchObject({ wasteEntryId: entry, wasteStreamId: null });
    expect(await lastLog('waste_entry', entry)).toMatchObject({ action: 'link', summary: `Action ${a.id} créée et rattachée` });
    expect(await create('env', 'Registre des déchets 2026')).toMatchObject({ wasteStreamId: null, wasteEntryId: null });
    expect(await create('prevention', 'Coactivité 09/10/2026')).toMatchObject({ preventionPlanId: null, permitId: null });
  });

  it('source d’un autre site, site de l’action différent de celui de la source : refusés', async () => {
    const before = await actionCount();
    actAs('Animateur QHSE', 'ville-a');
    expect(await saveAction({}, form(fields('prevention', 'PP-2026-012')))).toEqual({
      error: `Référence d'origine PP-2026-012 : cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.`,
      fieldErrors: { originRef: OTHER_SITE },
    });
    actAs('Animateur QHSE', 'all');
    expect(await saveAction({}, form(fields('prevention', 'PP-2026-012', { siteId: 'ville-a' })))).toEqual({
      error: "L'action doit concerner le site de sa source (PP-2026-012) : choisissez ce site.",
      fieldErrors: { siteId: 'Site différent de celui de la source.' },
    });
    expect(await saveAction({}, form(fields('env', 'FD-11 · 19/08/2026', { siteId: 'ville-a' })))).toMatchObject({ fieldErrors: { siteId: expect.any(String) } });
    expect(await actionCount()).toBe(before);
    // Même source sur son site : acceptée.
    actAs('Animateur QHSE', 'ville-b');
    expect(await create('prevention', 'PP-2026-012')).toMatchObject({ preventionPlanId: 'PP-2026-012', siteId: 'ville-b' });
  });

  it('périmètre restreint : référence d’une fiche hors périmètre gardée en texte, sans rien en révéler', async () => {
    auth.override = { status: 'authenticated', identity: { personId: 'jpetit', role: 'Chef de service', siteIds: ['ville-b'] } };
    cookieJar.set('vigie_site', 'ville-b');
    try {
      const plan = (await changeLog('prevention_plan', 'PP-2026-015')).length;
      expect(await create('prevention', 'PP-2026-015', { pilotId: 'jpetit' })).toMatchObject({ preventionPlanId: null, originRef: 'PP-2026-015', siteId: 'ville-b' });
      expect((await changeLog('prevention_plan', 'PP-2026-015')).length).toBe(plan);
      expect(await create('prevention', 'PP-2026-012', { pilotId: 'jpetit' })).toMatchObject({ preventionPlanId: 'PP-2026-012' });
      // Lien explicite vers une fiche hors périmètre : refus de requireInSite.
      expect(await saveAction({}, form(fields('prevention', 'PP-2026-015', { pilotId: 'jpetit', link: 'preventionplan:PP-2026-015' })))).toEqual({
        error: 'Cet élément appartient à un site hors de votre périmètre.',
      });
    } finally {
      auth.override = null;
      cookieJar.delete('vigie_site');
    }
  });

  it('source annulée, lien sans rapport avec l’origine : refusés sans rien créer', async () => {
    const before = await actionCount();
    actAs('Animateur QHSE', 'ville-b');
    expect(await saveAction({}, form(fields('prevention', 'PP-2026-010')))).toEqual({ error: 'Plan de prévention annulé : rattachement impossible.' });
    actAs('Animateur QHSE', 'ville-a');
    expect(await saveAction({}, form(fields('prevention', 'PF-2026-028')))).toEqual({ error: 'Permis annulé : rattachement impossible.' });
    const entry = await entryId('FD-04', '2026-02-11');
    await (await db()).update(t.wasteEntries).set({ cancelledAt: new Date(), cancelledById: 'clefevre', cancelReason: 'Doublon (test)' }).where(eq(t.wasteEntries.id, entry));
    expect(await saveAction({}, form(fields('env', `FD-04 · 11/02/2026 · n° ${entry}`)))).toEqual({ error: 'Enlèvement annulé : rattachement impossible.' });
    await (await db()).update(t.wasteEntries).set({ cancelledAt: null, cancelledById: null, cancelReason: null }).where(eq(t.wasteEntries.id, entry));
    expect(await saveAction({}, form(fields('docs', 'PR-QHSE-002', { link: 'preventionplan:PP-2026-015' })))).toEqual({
      error: "Ce rattachement ne correspond pas à l'origine de l'action.", fieldErrors: { origin: "Ce rattachement ne correspond pas à l'origine de l'action." },
    });
    expect(await actionCount()).toBe(before);
  });
});

describe('origine verrouillée après la création', () => {
  it('modification : origine, référence et source conservées, absentes du détail journalisé', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const a216 = await action('A-216');
    expect(await saveAction({}, form({
      id: 'A-216', title: `${a216.title} (précisé)`, origin: 'docs', originRef: 'PR-QHSE-002', pilotId: a216.pilotId, dueOn: a216.dueOn, kind: a216.kind, siteId: 'ville-a',
    }))).toEqual({ ok: true, id: 'A-216' });
    expect(await action('A-216')).toMatchObject({ origin: 'prevention', originRef: 'PF-2026-031', permitId: 'PF-2026-031', documentId: null, title: `${a216.title} (précisé)` });
    const log = await lastLog('action', 'A-216');
    expect(log).toMatchObject({ action: 'update', summary: 'Modifiée : titre' });
    expect(JSON.stringify(log?.details)).not.toContain('Origine');
  });

  it('changement de site : refusé hors du site de la source', async () => {
    actAs('Animateur QHSE', 'all');
    const a219 = await action('A-219');
    expect(await saveAction({}, form({
      id: 'A-219', title: a219.title, pilotId: a219.pilotId, dueOn: a219.dueOn, kind: a219.kind, siteId: 'ville-b',
    }))).toEqual({ error: "L'action doit concerner le site de sa source (FD-04) : choisissez ce site.", fieldErrors: { siteId: 'Site différent de celui de la source.' } });
    expect((await action('A-219')).siteId).toBe('ville-a');
  });

  it('rattacher ou détacher une source d’origine après coup : refusé', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const before = (await changeLog('action', 'A-216')).length;
    expect(await linkAction('preventionplan:PP-2026-015', 'A-201')).toEqual({ error: ORIGIN_LOCKED });
    expect(await unlinkAction('permit:PF-2026-031', 'A-216')).toEqual({ error: ORIGIN_LOCKED });
    expect((await action('A-216')).permitId).toBe('PF-2026-031');
    expect((await action('A-201')).preventionPlanId).toBeNull();
    expect((await changeLog('action', 'A-216')).length).toBe(before);
    // Droits vérifiés d'abord : un Salarié reçoit le refus de son rôle.
    actAs('Salarié');
    expect(await linkAction('preventionplan:PP-2026-015', 'A-201')).toEqual({ error: DENIED });
  });

  it('annulation : la source d’origine reste rattachée et lisible', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const a = await create('prevention', 'PP-2026-016');
    expect(await cancelAction({}, form({ id: a.id, from: 'todo', reason: 'Doublon de test' }))).toMatchObject({ ok: true });
    expect(await action(a.id)).toMatchObject({ status: 'cancelled', preventionPlanId: 'PP-2026-016' });
    const log = await lastLog('action', a.id);
    expect(log).toMatchObject({ action: 'cancel', reason: 'Doublon de test', details: null });
    const { action: view } = await loadLinkedAction(a.id);
    expect(view?.sources[0]).toMatchObject({ label: 'PP-2026-016', href: '/prevention?plan=PP-2026-016', detachOnCancel: false });
  });
});

describe('fiche action : sources réelles, plus de lien déduit du texte', () => {
  it('plan, document, enlèvement, registre annuel', async () => {
    actAs('Animateur QHSE', 'all');
    const plan = await (await db()).select({ title: t.preventionPlans.title }).from(t.preventionPlans).where(eq(t.preventionPlans.id, 'PP-2026-012'));
    expect((await loadLinkedAction('A-206')).action?.sources).toEqual([{ label: 'PP-2026-012', detail: plan[0].title, href: '/prevention?plan=PP-2026-012', detachOnCancel: false }]);
    expect((await loadLinkedAction('A-208')).action?.sources[0]).toMatchObject({ label: 'PR-QHSE-002', href: '/documents?doc=PR-QHSE-002' });
    expect((await loadLinkedAction('A-218')).action?.sources[0]).toMatchObject({ label: 'FD-11 · 19/08/2026', href: '/environnement?annee=2026&filiere=FD-11' });
    expect((await loadLinkedAction('A-219')).action?.sources[0]).toMatchObject({ label: 'FD-04', href: '/environnement?filiere=FD-04' });
    expect((await loadLinkedAction('A-178')).action?.sources).toEqual([{ label: 'Registre des déchets 2026', href: '/environnement?vue=bsd-manquants&annee=2026' }]);
    // Référence textuelle sans source (base non reprise) : renvoi vers l'écran d'origine seulement.
    await (await db()).insert(t.actions).values({ id: 'A-T90', title: 'Sans source', origin: 'prevention', originRef: 'PP-2026-013', siteId: 'ville-a', pilotId: 'clefevre', dueOn: '2026-11-30', status: 'todo', kind: 'P' });
    expect(await loadLinkedAction('A-T90')).toMatchObject({ action: { sources: [{ label: 'PP-2026-013', href: '/prevention' }], sourcesFallback: true } });
  });

  it('Salarié pilote : référence du plan sans lien ni intitulé (écran Prévention fermé)', async () => {
    await (await db()).insert(t.actions).values({
      id: 'A-T91', title: 'Baliser la zone', origin: 'prevention', originRef: 'PP-2026-012', preventionPlanId: 'PP-2026-012', siteId: 'ville-b',
      pilotId: 'tnguyen', dueOn: '2026-11-30', status: 'todo', kind: 'P',
    });
    actAs('Salarié', 'all');
    const { action: view } = await loadLinkedAction('A-T91');
    expect(view?.sources).toEqual([{ label: 'PP-2026-012', href: null, detachOnCancel: false }]);
  });
});

describe('écrans sources : actions retrouvées par les colonnes, plus par la référence textuelle', () => {
  it('plan (premier mot de la référence), permis, document, filière et enlèvement', async () => {
    const { loadPrevention } = await import('@/lib/data/prevention');
    const { loadEnvironment } = await import('@/lib/data/environment');
    const { loadDocuments } = await import('@/lib/data/documents');
    actAs('Animateur QHSE', 'ville-a');
    const onPlan = await create('prevention', 'PP-2026-013 · relance signature');
    const prevention = await loadPrevention();
    const plan = prevention.plans.find((p) => p.id === 'PP-2026-013');
    expect(plan?.actions.map((a) => a.id)).toContain(onPlan.id);
    expect(prevention.permits.find((p) => p.id === 'PF-2026-031')?.actions.map((a) => a.id)).toContain('A-216');
    // Action liée au permis : pas sur le plan, même si sa référence nommait le plan.
    expect(prevention.plans.flatMap((p) => p.actions).map((a) => a.id)).not.toContain('A-216');

    const docs = await loadDocuments();
    expect(docs.rows.find((d) => d.id === 'PR-QHSE-002')?.reviewActions.map((a) => a.id)).toContain('A-208');

    const env = await loadEnvironment(2026);
    expect(env.streams.find((s) => s.id === 'FD-04')?.actions.map((a) => a.id)).toContain('A-219');
    actAs('Animateur QHSE', 'ville-b');
    const envB = await loadEnvironment(2026);
    const fd11 = await entryId('FD-11', '2026-08-19');
    expect(envB.entries.find((e) => e.id === fd11)?.actions.map((a) => a.id)).toEqual(['A-218']);
    // La filière liste aussi les actions de ses enlèvements.
    expect(envB.streams.find((s) => s.id === 'FD-11')?.actions.map((a) => a.id)).toContain('A-218');
    cookieJar.clear();
  });
});

describe('reprise des références d’origine (backfillActionLinks, npm run db:reprise-liens)', () => {
  const NULLS = { preventionPlanId: null, permitId: null, documentId: null, wasteStreamId: null, wasteEntryId: null };

  it('essai sans écriture, puis liens posés et journalisés une seule fois, sans jamais remplacer un lien', async () => {
    const d = await db();
    const fd11 = await entryId('FD-11', '2026-08-19');
    // Base antérieure à la migration 0004 : colonnes vides ; références variées.
    await d.update(t.actions).set(NULLS);
    const extra = { siteId: 'ville-a', pilotId: 'clefevre', dueOn: '2026-11-30', status: 'todo', kind: 'P' } as const;
    await d.insert(t.actions).values([
      { ...extra, id: 'A-T01', title: 'Relance BSD', origin: 'env', originRef: 'FD-11 · 19/08/2026', siteId: 'ville-b' },
      { ...extra, id: 'A-T02', title: 'Réviser IT', origin: 'docs', originRef: 'IT-MON-012 révision C' },
      { ...extra, id: 'A-T03', title: 'Plan disparu', origin: 'prevention', originRef: 'PP-2099-001' },
      { ...extra, id: 'A-T04', title: 'Filière', origin: 'env', originRef: 'FD-04 · 01/01/2026' },
      // Lien déjà posé (autre que celui de la référence) : jamais remplacé.
      { ...extra, id: 'A-T05', title: 'Déjà rattachée', origin: 'prevention', originRef: 'PP-2026-015', preventionPlanId: 'PP-2026-013' },
    ]);
    const logged = async () => (await d.select({ n: count() }).from(t.changeLog).where(and(eq(t.changeLog.entityType, 'action'), eq(t.changeLog.action, 'link'))))[0].n;
    const logsBefore = await logged();

    const dry = await backfillActionLinks(d, { apply: false });
    expect(dry.applied).toBe(false);
    const byId = new Map(dry.linked.map((l) => [l.actionId, l]));
    expect(byId.get('A-206')).toEqual({ actionId: 'A-206', column: 'preventionPlanId', target: 'PP-2026-012', label: 'plan de prévention PP-2026-012' });
    expect(byId.get('A-216')).toMatchObject({ column: 'permitId', target: 'PF-2026-031' });
    expect(byId.get('A-208')).toMatchObject({ column: 'documentId', target: 'PR-QHSE-002' });
    expect(byId.get('A-219')).toMatchObject({ column: 'wasteStreamId', target: 'FD-04' });
    expect(byId.get('A-218')).toMatchObject({ column: 'wasteEntryId', target: String(fd11), label: `enlèvement du registre des déchets FD-11 · 19/08/2026 · n° ${fd11}` });
    expect(byId.get('A-220')).toMatchObject({ column: 'preventionPlanId', target: 'PP-2026-008' });
    expect(byId.get('A-T01')).toMatchObject({ column: 'wasteEntryId', target: String(fd11) });
    expect(byId.get('A-T02')).toMatchObject({ column: 'documentId', target: 'IT-MON-012' });
    expect(byId.get('A-T04')).toMatchObject({ column: 'wasteStreamId', target: 'FD-04', note: expect.stringContaining('Aucun enlèvement FD-04 le 01/01/2026') });
    expect(byId.has('A-T05')).toBe(false);
    expect(dry.unresolved).toEqual(expect.arrayContaining([
      { actionId: 'A-178', origin: 'env', originRef: 'Registre des déchets 2026', reason: 'Registre annuel des déchets : aucune fiche source.' },
      { actionId: 'A-T03', origin: 'prevention', originRef: 'PP-2099-001', reason: 'Aucun plan de prévention ni permis de cette référence.' },
    ]));
    expect(dry.alreadyLinked).toBe(1);
    expect(dry.examined).toBe(dry.alreadyLinked + dry.linked.length + dry.unresolved.length);
    expect((await action('A-206')).preventionPlanId).toBeNull();
    expect(await logged()).toBe(logsBefore);

    const applied = await backfillActionLinks(d, { apply: true });
    expect(applied).toMatchObject({ applied: true, linked: dry.linked, unresolved: dry.unresolved, alreadyLinked: 1 });
    const rows = new Map((await d.select().from(t.actions).where(inArray(t.actions.id, ['A-206', 'A-216', 'A-208', 'A-219', 'A-218', 'A-220', 'A-T01', 'A-T03', 'A-T05']))).map((r) => [r.id, r]));
    expect(rows.get('A-206')?.preventionPlanId).toBe('PP-2026-012');
    expect(rows.get('A-216')?.permitId).toBe('PF-2026-031');
    expect(rows.get('A-208')?.documentId).toBe('PR-QHSE-002');
    expect(rows.get('A-219')?.wasteStreamId).toBe('FD-04');
    expect(rows.get('A-218')?.wasteEntryId).toBe(fd11);
    expect(rows.get('A-220')?.preventionPlanId).toBe('PP-2026-008');
    expect(rows.get('A-T01')?.wasteEntryId).toBe(fd11);
    expect(rows.get('A-T03')).toMatchObject(NULLS);
    expect(rows.get('A-T05')).toMatchObject({ preventionPlanId: 'PP-2026-013', permitId: null });
    expect(await lastLog('action', 'A-206')).toMatchObject({
      action: 'link', byId: null, summary: "Origine rattachée : plan de prévention PP-2026-012 (reprise de la référence d'origine)",
      details: [{ field: 'Origine', from: null, to: 'plan de prévention PP-2026-012' }],
    });
    expect(await logged()).toBe(logsBefore + dry.linked.length);

    // Relance : rien à poser, aucune écriture.
    const again = await backfillActionLinks(d, { apply: true });
    expect(again).toMatchObject({ applied: true, linked: [], unresolved: dry.unresolved, alreadyLinked: dry.alreadyLinked + dry.linked.length });
    expect(await logged()).toBe(logsBefore + dry.linked.length);
  });
});
