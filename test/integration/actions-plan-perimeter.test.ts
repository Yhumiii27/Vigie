import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieJar } from '../next-mocks';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { parseActionFilters } from '@/lib/action-rules';
import type { Role } from '@/lib/domain';
import { resetConfig } from '@/lib/env';
import { canReadAttachment } from '@/lib/uploads';
import { loadActionDetail, loadActionPlan, loadActionTargets } from '@/lib/data/actions';
import { freshDemoDatabase } from '../helpers';

// Plan d'actions et périmètre (SEC-02, D19) avec des sessions Entra ID (périmètre = site de rattachement + sites
// accordés) : une action hors périmètre est introuvable sans que son site soit nommé ; une action d'un autre site du
// périmètre nomme ce site (« sélectionnez ce site ») ; le responsable lit sa propre action d'un site hors de son
// périmètre (fiche et preuves), sans rien d'autre de ce site. Jeu de démonstration, puis sessions Entra sur la même base.

const SECRET = 'secret-de-session-des-tests-perimetre-plan-0123456789';
const ENTRA_ENV = {
  VIGIE_PUBLIC_URL: 'https://vigie.exemple.fr', VIGIE_SESSION_SECRET: SECRET,
  ENTRA_TENANT_ID: 'tenant', ENTRA_CLIENT_ID: 'client', ENTRA_CLIENT_SECRET: 'secret',
};
const SITE_B = "Site de [Ville B] — zone d'essais";

freshDemoDatabase();
beforeAll(async () => {
  const db = await getDb();
  // Action du Salarié [T. Nguyen] (rattaché au site A) sur le site B, issue d'un signalement d'une collègue du site B.
  await db.insert(t.actions).values({
    id: 'A-960', detail: 'Vérifier la fixation des flexibles du banc BE-1', problem: 'Flexible mal fixé.', openedOn: '2026-10-01',
    initialDueOn: '2026-10-30', dueOn: '2026-10-30', verifyDueOn: '2026-11-30', status: 'a_faire', priority: 'moyen_terme', domain: 'securite',
    source: 'evenement', originRef: 'EV-2026-129', eventId: 'EV-2026-129', siteId: 'ville-b', pilotId: 'tnguyen',
  });
  await db.insert(t.attachments).values({
    id: 'att-a960', entityType: 'action', entityId: 'A-960', fileName: 'photo-fixation.jpg', mimeType: 'image/jpeg', size: 10,
    storagePath: 'x/att-a960', uploadedBy: 'tnguyen',
  });
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

const planIds = async (sp: Record<string, string> = {}) => (await loadActionPlan(parseActionFilters(sp))).items.map((a) => a.id);

describe('fiche d’une action et périmètre', () => {
  it('hors périmètre : introuvable, le site n’est jamais nommé', async () => {
    await actAsEntra('sbenali', 'Chef de service', ['ville-a'], 'ville-a');
    const res = await loadActionDetail('A-209'); // site B, autre responsable
    expect(res).toEqual({ payload: null, elsewhere: null });
    expect(JSON.stringify(res)).not.toContain('Ville B');
    expect(await planIds({ etat: 'historique' })).not.toContain('A-209');
  });

  it('autre site du périmètre : pas de fiche, son site nommé ; site sélectionné : la fiche', async () => {
    await actAsEntra('sbenali', 'Chef de service', ['ville-a', 'ville-b'], 'ville-a');
    expect(await loadActionDetail('A-209')).toEqual({ payload: null, elsewhere: SITE_B });
    await actAsEntra('sbenali', 'Chef de service', ['ville-a', 'ville-b'], 'ville-b');
    expect((await loadActionDetail('A-209')).payload?.detail.id).toBe('A-209');
  });

  it('ses propres actions d’un site hors périmètre : lisibles, signalées, sources en référence seule', async () => {
    await actAsEntra('sbenali', 'Chef de service', ['ville-a'], 'ville-a');
    const own = (await loadActionDetail('A-181')).payload!; // site B, il en est responsable
    expect(own.rights).toMatchObject({ responsible: true, elsewhere: SITE_B, canComment: true });
    expect(own.detail.sources.length).toBeGreaterThan(0);
    expect(own.detail.sources.every((s) => s.href === null && !s.detail)).toBe(true);
    expect(await planIds()).toContain('A-181');
  });

  it('Salarié restreint au site A : sa fiche du site B en entier (D19), sa preuve lisible ; rien d’autre du site B', async () => {
    await actAsEntra('tnguyen', 'Salarié', ['ville-a'], 'ville-a');
    const { payload } = await loadActionDetail('A-960');
    expect(payload?.detail).toMatchObject({ id: 'A-960', siteId: 'ville-b', problem: 'Flexible mal fixé.' });
    expect(payload?.detail.files.map((f) => f.name)).toEqual(['photo-fixation.jpg']);
    // Événement d'une collègue d'un site hors périmètre : référence seule.
    expect(payload?.detail.sources).toEqual([{ kind: 'event', label: 'EV-2026-129', href: null }]);
    expect(payload?.rights).toMatchObject({ responsible: true, canComment: true, canAttach: true, canEdit: false });
    expect((await planIds()).sort()).toEqual(['A-215', 'A-960']);
    const db = await getDb();
    const [proof] = await db.select().from(t.attachments).where(eq(t.attachments.id, 'att-a960'));
    const s = { role: 'Salarié' as const, user: { id: 'tnguyen' }, allowedSiteIds: ['ville-a'] };
    expect(await canReadAttachment(proof, s)).toBe(true);
    expect(await canReadAttachment({ ...proof, entityId: 'A-209' }, s)).toBe(false); // action d'autrui, site hors périmètre
    expect(await loadActionDetail('A-209')).toEqual({ payload: null, elsewhere: null });
  });

  it('animateur QHSE restreint : éléments proposés et plan limités à son périmètre', async () => {
    await actAsEntra('clefevre', 'Animateur QHSE', ['ville-a'], 'all');
    const targets = await loadActionTargets();
    expect(targets.some((x) => x.siteId === 'ville-b')).toBe(false);
    expect(targets.some((x) => x.value === 'event:EV-2026-131')).toBe(true);
    const ids = await planIds({ etat: 'historique' });
    expect(ids).not.toContain('A-209');
    expect(ids).toContain('A-203'); // la sienne, site B
  });
});
