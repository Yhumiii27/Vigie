import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { actionRow, NEW_ACTION } from './actions-helpers';
import { asc, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { EVENT_AUDIT_LOCKED } from '@/lib/action-links';
import { loadActionTargets } from '@/lib/data/actions';
import { loadAudits, loadAuditSignals } from '@/lib/data/audits';
import { loadReviewDossierPage, type DossierFinding } from '@/lib/data/review';
import { cancelFinding } from '@/server/audits';
import { linkAction, unlinkAction } from '@/server/links';
import { saveAction } from '@/server/plan';
import { abandonAction } from '@/server/plan-ui';

// AUD-28 : plusieurs actions par constat d'audit (table finding_actions, migration 0016). Une action ne porte qu'un constat,
// posé à sa création (EVENT_AUDIT_LOCKED, D20) ; un constat en porte plusieurs. Jeu de démonstration au 09/10/2026 :
// constat 5 (piste, audit interne Achats) sans action — échéance « sans action » ; constat 1 porte A-188.

freshDemoDatabase();

const actionsOf = async (findingId: number) =>
  (await (await getDb()).select().from(t.findingActions).where(eq(t.findingActions.findingId, findingId)).orderBy(asc(t.findingActions.actionId))).map((r) => r.actionId);
const findingView = async (id: number) => (await loadAudits({ constat: String(id) })).auditGroups.flatMap((g) => g.findings).find((f) => f.id === id)!;
const create = async (link: string, source: string) => {
  const r = await saveAction({}, form({ ...NEW_ACTION, link, source, originRef: '' }));
  expect(r).toMatchObject({ ok: true });
  return r.id!;
};

describe('plusieurs actions par constat (AUD-28)', () => {
  it('deux actions créées depuis le même constat : toutes deux rattachées, listées sur le constat, échéance « sans action » levée', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect((await loadAuditSignals()).todo.some((x) => x.href === '/audits?constat=5')).toBe(true);
    // Constat déjà porteur d'une action : toujours proposé par le sélecteur du plan.
    const first = await create('finding:5', 'audit_interne');
    expect((await loadActionTargets()).some((o) => o.value === 'finding:5')).toBe(true);
    const second = await create('finding:5', 'audit_interne');
    expect(await actionsOf(5)).toEqual([first, second].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true })));
    expect((await findingView(5)).actions.map((a) => a.id)).toEqual([first, second]);
    expect((await findingView(5)).actions[0].action).toMatchObject({ id: first });
    expect((await loadAuditSignals()).todo.some((x) => x.href === '/audits?constat=5')).toBe(false);
    expect((await changeLog('audit_finding', 5)).filter((e) => e.action === 'link').map((e) => e.summary))
      .toEqual([`Action ${first} créée et rattachée`, `Action ${second} créée et rattachée`]);
  });

  it('une action ne porte qu’un constat, fixé à sa création : ni rattachement ni détachement ensuite', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const [first] = await actionsOf(5);
    expect(await linkAction('finding:1', first)).toEqual({ error: EVENT_AUDIT_LOCKED });
    expect(await unlinkAction('finding:5', first)).toEqual({ error: EVENT_AUDIT_LOCKED });
    expect(await linkAction('finding:5', 'A-188')).toEqual({ error: EVENT_AUDIT_LOCKED });
    expect(await actionsOf(1)).toEqual(['A-188']);
  });

  it('abandon d’une des actions : détachée du constat (journal du constat), l’autre reste', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const [first, second] = await actionsOf(5);
    expect(await abandonAction({}, form({ id: first, from: 'a_faire', reason: 'Doublon' }))).toMatchObject({ ok: true });
    expect(await actionsOf(5)).toEqual([second]);
    expect(await lastLog('audit_finding', 5)).toMatchObject({ action: 'unlink', summary: `Action ${first} abandonnée : détachée`, reason: 'Doublon' });
  });

  it('dossier de revue : le constat cite toutes ses actions', async () => {
    actAs('Animateur QHSE', 'all');
    const db = await getDb();
    const [second] = await actionsOf(5);
    const third = await create('finding:5', 'audit_interne');
    const [planned] = await db.select().from(t.reviews).where(eq(t.reviews.status, 'planifiee'));
    const page = await loadReviewDossierPage({ revue: String(planned.id) });
    if (page.mode !== 'live') throw new Error(`dossier calculé attendu (${page.mode})`);
    const finding = (page.dossier.audits.auditGroups.flatMap((g) => g.findings) as DossierFinding[]).find((f) => f.id === 5)!;
    expect(finding.actions!.map((a) => a.id)).toEqual([second, third]);
    expect(finding.actions![1].action).toMatchObject({ id: third, href: `/actions?action=${third}` });
    expect(finding).not.toHaveProperty('actionId');
  });

  it('annulation du constat : ses actions restent au plan, l’annulation est inscrite à l’historique de chacune', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const ids = await actionsOf(5);
    expect(ids).toHaveLength(2);
    expect(await cancelFinding({}, form({ id: '5', reason: 'Constat saisi en double' }))).toEqual({ ok: true, id: '5' });
    expect(await lastLog('audit_finding', 5)).toMatchObject({ action: 'cancel', summary: `Constat annulé (les actions ${ids.join(', ')} restent au plan d'actions)` });
    for (const id of ids) {
      expect(await lastLog('action', id)).toMatchObject({ action: 'update', summary: expect.stringMatching(/^Constat d'origine annulé/), reason: 'Constat saisi en double' });
      expect((await actionRow(id)).status).toBe('a_faire');
    }
    expect(await actionsOf(5)).toEqual(ids);
  });
});
