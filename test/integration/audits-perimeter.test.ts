import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieJar } from '../next-mocks';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadAudits } from '@/lib/data/audits';
import { resetConfig } from '@/lib/env';
import type { Role } from '@/lib/domain';
import { freshDemoDatabase } from '../helpers';

// Actions des constats et du programme d'audit (communs à l'entreprise, ACT-28) : lues sur tout le périmètre de la
// personne, quel que soit le site sélectionné ; une action hors de son périmètre n'est citée que par son numéro (ni
// libellé, ni responsable, ni constat d'efficacité). Session Entra ID (périmètre restreint) sur le jeu de démonstration.

const SECRET = 'secret-de-session-des-tests-audits-perimetre-0123';
const ENTRA_ENV = {
  VIGIE_PUBLIC_URL: 'https://vigie.exemple.fr', VIGIE_SESSION_SECRET: SECRET,
  ENTRA_TENANT_ID: 'tenant', ENTRA_CLIENT_ID: 'client', ENTRA_CLIENT_SECRET: 'secret',
};

freshDemoDatabase();
beforeAll(() => {
  delete process.env.VIGIE_DEMO;
  delete process.env.VIGIE_TODAY;
  Object.assign(process.env, ENTRA_ENV);
  resetConfig();
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

describe('actions des constats d’audit et périmètre', () => {
  it('site sélectionné quelconque : l’action du périmètre reste citée ; hors périmètre, son numéro seul', async () => {
    const db = await getDb();
    // Constat qui porte une action du site A (jeu de démonstration).
    const [row] = await db.select({ id: t.findingActions.findingId, actionId: t.findingActions.actionId }).from(t.findingActions)
      .innerJoin(t.actions, eq(t.actions.id, t.findingActions.actionId)).where(eq(t.actions.siteId, 'ville-a')).limit(1);
    expect(row, 'constat portant une action du site A').toBeDefined();
    const findingOf = async () => (await loadAudits({})).auditGroups.flatMap((g) => g.findings).find((f) => f.id === row.id)!;

    // Direction (tous les sites), site B sélectionné : action du site A lue.
    await actAsEntra('hmarchand', 'Direction', null, 'ville-b');
    expect((await findingOf()).actions[0].action).toMatchObject({ id: row.actionId, title: expect.any(String) });

    // Chef de projet rattaché au site B, sans autre site accordé : numéro seul, aucune donnée de l'action.
    await actAsEntra('jpetit', 'Chef de projet', [], 'ville-b');
    const f = await findingOf();
    expect(f.actions).toEqual([{ id: row.actionId, action: null }]);
  });
});
