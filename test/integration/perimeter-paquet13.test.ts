import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieJar, form } from '../next-mocks';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadAuditSignals, loadAudits } from '@/lib/data/audits';
import { loadPersonalData, loadPersonalDataPeople } from '@/lib/data/personal-data';
import { resetConfig } from '@/lib/env';
import type { Role } from '@/lib/domain';
import { renewProgram, savePlanItem } from '@/server/audits';
import { freshDemoDatabase } from '../helpers';

// Paquet 13, seconde moitié — périmètre restreint (session Entra ID sur le jeu de démonstration) : programme, constats et
// certifications d'un site hors périmètre jamais lus ni écrits (AUD-22), reconduction et lignes réservées au périmètre
// complet (AUD-24), données d'une personne hors périmètre jamais révélées (SEC-13).

const SECRET = 'secret-de-session-des-tests-perimetre-paquet13-0123';
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

async function actAsEntra(pid: string, role: Role, sites: string[] | null, site: string) {
  const { sealSession } = await import('@/lib/auth/cookie');
  const now = Math.floor(Date.now() / 1000);
  cookieJar.clear();
  cookieJar.set('__Host-vigie_session', await sealSession({ pid, role, sites, oid: `oid-${pid}`, auth: now, seen: now }, SECRET));
  cookieJar.set('vigie_site', site);
}

describe('AUD-22 : périmètre restreint', () => {
  it('audit du site A hors périmètre : ni affiché, ni dans les échéances, ni modifiable', async () => {
    const [client] = await (await getDb()).select().from(t.auditPlanItems).where(eq(t.auditPlanItems.label, 'Client A'));
    // Chef de projet rattaché au site B, sans autre site accordé.
    await actAsEntra('jpetit', 'Chef de projet', [], 'ville-b');
    const data = await loadAudits({ year: '2026', element: String(client.id) });
    expect(data.plan.some((p) => p.id === client.id)).toBe(false);
    expect(data.missingElement).toBe(true);
    expect((await loadAuditSignals()).todo.some((x) => x.siteId === 'ville-a')).toBe(false);
    // Animateur QHSE rattaché au site B, périmètre restreint : écriture refusée, reconduction réservée au périmètre complet.
    await actAsEntra('jpetit', 'Animateur QHSE', [], 'ville-b');
    expect(await savePlanItem({}, form({ id: String(client.id), track: client.track, label: client.label, doneOn: client.doneOn!, siteId: 'ville-a' })))
      .toEqual({ error: 'Cet élément appartient à un site hors de votre périmètre.', fieldErrors: { siteId: 'Cet élément appartient à un site hors de votre périmètre.' } });
    expect(await renewProgram({}, form({ year: '2027' }))).toEqual({ error: 'Élément commun à tous les sites : réservé à la direction et à l’animateur QHSE.' });
  });
});

describe('SEC-13 : données d’une personne hors périmètre', () => {
  it('ni proposée ni lue', async () => {
    await actAsEntra('clefevre', 'Animateur QHSE', [], 'ville-b');
    // clefevre est rattachée au site A : son périmètre restreint couvre son site de rattachement.
    const people = (await loadPersonalDataPeople()).map(([id]) => id);
    expect(people).toContain('sbenali');
    await actAsEntra('jpetit', 'Direction', [], 'ville-b');
    const restricted = (await loadPersonalDataPeople()).map(([id]) => id);
    expect(restricted).toContain('amartin');
    expect(restricted).not.toContain('sbenali');
    expect(await loadPersonalData('sbenali')).toBeNull();
    expect(await loadPersonalData('amartin')).not.toBeNull();
  });
});
