import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieJar } from '../next-mocks';
import { freshDemoDatabase, lastLog } from '../helpers';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import type { Role } from '@/lib/domain';
import { resetConfig } from '@/lib/env';
import { loadWatch } from '@/lib/data/watch';
import { linkAction, unlinkAction } from '@/server/links';

// Périmètre de sites (SEC-02) des écrans du flux E2, en session Entra ID (pattern de perimeter-options) :
// - Documents : rattacher à une révision de Codex une action hors du périmètre, ou en détacher une, est refusé sans nommer son site ;
// - Veille : une exigence vaut pour toute l'entreprise, mais l'action qui lui est rattachée n'est décrite (libellé,
//   avancement, date cible) qu'à qui peut la lire (canReadAction) : hors périmètre, numéro seul.
// Sans VIGIE_TODAY (hors démonstration) : dates de test en 2027.

const SECRET = 'secret-de-session-des-tests-perimetre-e2-0123456789abcdef';
const ENTRA_ENV = {
  VIGIE_PUBLIC_URL: 'https://vigie.exemple.fr', VIGIE_SESSION_SECRET: SECRET,
  ENTRA_TENANT_ID: 'tenant', ENTRA_CLIENT_ID: 'client', ENTRA_CLIENT_SECRET: 'secret',
};
const OUTSIDE = 'Cet élément appartient à un site hors de votre périmètre.';

async function insertAction(id: string, siteId: string) {
  await (await getDb()).insert(t.actions).values({
    id, openedOn: '2026-10-01', pilotId: 'hmarchand', status: 'a_faire', priority: 'moyen_terme', dueOn: '2027-03-31', initialDueOn: '2027-03-31',
    source: 'comex', originRef: 'COMEX de test', domain: 'securite', problem: 'Problème de test', detail: `Action de test ${id}`,
    verifyDueOn: '2027-04-30', siteId,
  });
}

freshDemoDatabase();
beforeAll(async () => {
  delete process.env.VIGIE_DEMO;
  delete process.env.VIGIE_TODAY;
  Object.assign(process.env, ENTRA_ENV);
  resetConfig();
  await insertAction('A-T90', 'site_b');
  await insertAction('A-T91', 'site_a');
});
afterAll(() => {
  for (const k of Object.keys(ENTRA_ENV)) delete process.env[k];
  resetConfig();
});

/** Session Entra ID scellée (personne, rôle, sites accordés ou null = tous) et site sélectionné. */
async function actAsEntra(pid: string, role: Role, sites: string[] | null, site: string) {
  const { sealSession } = await import('@/lib/auth/cookie');
  const now = Math.floor(Date.now() / 1000);
  cookieJar.clear();
  cookieJar.set('__Host-vigie_session', await sealSession({ pid, role, sites, oid: `oid-${pid}`, auth: now, seen: now }, SECRET));
  cookieJar.set('vigie_site', site);
}

/** Révision ouverte dans Codex d'un document commun à tous les sites (lot 4 de M-02), sans action. */
const OPEN_REVISION = 'docversion:PRO-HSE-0001:C';
const revisionAction = async () => (await (await getDb()).select().from(t.documentActions)
  .where(and(eq(t.documentActions.codexId, 'PRO-HSE-0001'), eq(t.documentActions.revision, 'C'))))[0]?.actionId;

describe('Documents : action d’une révision hors du périmètre', () => {
  it('rattachement refusé sans nommer le site, rien écrit', async () => {
    await actAsEntra('clefevre', 'Animateur QHSE', ['site_a'], 'site_a');
    const r = await linkAction(OPEN_REVISION, 'A-T90');
    expect(r).toEqual({ error: OUTSIDE });
    expect(JSON.stringify(r)).not.toMatch(/site_b|Ville B/i);
    expect(await revisionAction()).toBeUndefined();
    expect(await lastLog('action', 'A-T90')).toBeUndefined();
  });

  it('détacher d’une révision une action hors du périmètre : refusé, action conservée ; dans le périmètre : journalisé', async () => {
    await actAsEntra('clefevre', 'Animateur QHSE', null, 'all');
    expect(await linkAction(OPEN_REVISION, 'A-T90')).toEqual({});
    expect(await revisionAction()).toBe('A-T90');
    await actAsEntra('clefevre', 'Animateur QHSE', ['site_a'], 'site_a');
    expect(await unlinkAction(OPEN_REVISION, 'A-T90')).toEqual({ error: OUTSIDE });
    expect(await revisionAction()).toBe('A-T90');
    await actAsEntra('clefevre', 'Animateur QHSE', null, 'all');
    expect(await unlinkAction(OPEN_REVISION, 'A-T90')).toEqual({});
    expect(await revisionAction()).toBeUndefined();
    expect(await lastLog('action', 'A-T90')).toMatchObject({ action: 'unlink' });
  });
});

describe('Veille : action d’une exigence hors du périmètre', () => {
  it('Chef de service restreint au site A : numéro seul ; périmètre complet : action décrite', async () => {
    const db = await getDb();
    const [req] = await db.select().from(t.requirements).limit(1);
    await db.update(t.requirements).set({ actionId: 'A-T90' }).where(eq(t.requirements.id, req.id));
    await actAsEntra('sbenali', 'Chef de service', ['site_a'], 'site_a');
    const restricted = (await loadWatch()).requirements.find((r) => r.id === req.id)!;
    expect(restricted.actionId).toBe('A-T90');
    expect(restricted.action).toBeNull();
    // Sa propre action, quel que soit son site (D19) : décrite.
    await db.update(t.actions).set({ pilotId: 'sbenali' }).where(eq(t.actions.id, 'A-T90'));
    expect((await loadWatch()).requirements.find((r) => r.id === req.id)!.action).toMatchObject({ id: 'A-T90' });
    await db.update(t.actions).set({ pilotId: 'hmarchand' }).where(eq(t.actions.id, 'A-T90'));
    await actAsEntra('clefevre', 'Animateur QHSE', null, 'all');
    const full = (await loadWatch()).requirements.find((r) => r.id === req.id)!;
    expect(full.action).toMatchObject({ id: 'A-T90', label: 'Action de test A-T90' });
  });
});
