import { describe, expect, it } from 'vitest';
import '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { actionRow, insertAction } from './actions-helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadActionDetail } from '@/lib/data/actions';
import { linkAction, unlinkAction } from '@/server/links';

// Paquet 2 : « Rattacher » / « Détacher » un lien complémentaire depuis la fiche action (ACT-02) et contrôles de
// rattachement d'une revue (AUD-12). Jeu de démonstration au 09/10/2026 : A-214 (site A, 40 %) porte le risque 1 ; A-152
// (Vérifiée) et A-158 relèvent de la revue 1 (clôturée) par ses décisions 2 et 3 ; revue 3 planifiée ; contrôle 2 libre.

freshDemoDatabase();

const detailOf = async (id: string) => (await loadActionDetail(id)).payload?.detail;

describe('fiche action : liens et éléments rattachables (ACT-02)', () => {
  it('QHSE : lien des seuls liens complémentaires, éléments proposés du site de l’action, sans ceux déjà liés', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const d = (await detailOf('A-214'))!;
    expect(d.sources.find((s) => s.kind === 'risk')).toMatchObject({ link: 'risk:1' });
    expect(d.sources.find((s) => s.kind === 'event')).not.toHaveProperty('link');
    const values = d.linkTargets.map((o) => o.value);
    expect(values).toContain('control:2');
    expect(values).not.toContain('risk:1'); // déjà lié
    expect(values).not.toContain('control:6'); // site B
    expect(values.every((v) => /^(risk|requirement|control|docversion|review|reviewdecision):/.test(v))).toBe(true);
    expect(d.linkTargets.some((o) => o.kind === 'docversion')).toBe(true);
  });

  it('encadrement, responsable : ni lien ni élément proposé ; QHSE sur une action Vérifiée : aucun élément proposé', async () => {
    actAs('Chef de service', 'ville-a');
    const reader = (await detailOf('A-214'))!;
    expect(reader.linkTargets).toEqual([]);
    expect(reader.sources.some((s) => s.link)).toBe(false);
    actAs('Salarié', 'ville-a');
    expect((await detailOf('A-215'))!.linkTargets).toEqual([]);
    actAs('Animateur QHSE', 'ville-a');
    expect((await detailOf('A-176'))!.linkTargets).toEqual([]);
  });

  it('action déjà rattachée à une revue : aucune autre revue proposée', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const d = (await detailOf('A-184'))!;
    expect(d.linkTargets.filter((o) => o.kind === 'review')).toEqual([]);
  });

  it('rattacher puis détacher depuis la fiche : journal de l’action et de la source', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await linkAction('control:2', 'A-214')).toEqual({});
    expect(await lastLog('action', 'A-214')).toMatchObject({ action: 'link', summary: expect.stringContaining('Rattachée à'), byId: 'clefevre' });
    const d = (await detailOf('A-214'))!;
    expect(d.sources.find((s) => s.kind === 'control')).toMatchObject({ link: 'control:2' });
    expect(d.linkTargets.map((o) => o.value)).not.toContain('control:2');
    expect(await unlinkAction('control:2', 'A-214')).toEqual({});
    expect(await lastLog('action', 'A-214')).toMatchObject({ action: 'unlink', summary: expect.stringContaining('Détachée de') });
  });
});

describe('rattachements d’une revue (AUD-12)', () => {
  it('action portant une décision d’une autre revue (sans review_id) : rattacher à une autre revue ou à ses décisions refusé', async () => {
    actAs('Animateur QHSE', 'ville-a');
    await insertAction('A-T80');
    const db = await getDb();
    await db.update(t.reviewDecisions).set({ actionId: 'A-T80' }).where(eq(t.reviewDecisions.id, 4)); // décision de la revue 1
    const before = (await changeLog('action', 'A-T80')).length;
    expect(await linkAction('review:3', 'A-T80')).toEqual({ error: "L'action A-T80 relève déjà d'une autre revue de direction." });
    expect((await actionRow('A-T80')).reviewId).toBeNull();
    expect((await changeLog('action', 'A-T80')).length).toBe(before);
  });

  it('revue clôturée : détacher la revue ou une décision refusé, rien écrit', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const before = (await changeLog('action', 'A-158')).length;
    expect(await unlinkAction('reviewdecision:3', 'A-158')).toEqual({ error: 'Revue clôturée : son dossier est figé, le rattachement ne change plus.' });
    expect(await unlinkAction('review:1', 'A-158')).toEqual({ error: 'Revue clôturée : son dossier est figé, le rattachement ne change plus.' });
    expect((await actionRow('A-158')).reviewId).toBe(1);
    expect((await changeLog('action', 'A-158')).length).toBe(before);
  });

  it('revue en cours : la revue reste tant qu’une de ses décisions est portée par l’action ; détacher la décision d’abord', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const db = await getDb();
    const [decision] = await db.insert(t.reviewDecisions).values({ reviewId: 3, kind: 'decision', text: 'Décision de test', sort: 99 }).returning({ id: t.reviewDecisions.id });
    expect(await linkAction(`reviewdecision:${decision.id}`, 'A-184')).toEqual({});
    expect(await unlinkAction('review:3', 'A-184')).toEqual({ error: "L'action A-184 porte une décision de cette revue : détachez d'abord la décision." });
    expect(await unlinkAction(`reviewdecision:${decision.id}`, 'A-184')).toEqual({});
    expect((await actionRow('A-184')).reviewId).toBe(3); // la décision détachée, l'action reste rattachée à la revue
    expect(await unlinkAction('review:3', 'A-184')).toEqual({});
    expect((await actionRow('A-184')).reviewId).toBeNull();
  });
});
