import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieJar, form } from '../next-mocks';
import { freshDemoDatabase, lastLog } from '../helpers';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import type { Role } from '@/lib/domain';
import { resetConfig } from '@/lib/env';
import { loadWatch } from '@/lib/data/watch';
import { reviseDocument, updateDraft } from '@/server/documents';

// Périmètre de sites (SEC-02) des écrans du flux E2, en session Entra ID (pattern de perimeter-options) :
// - Documents : rattacher à une version une action hors du périmètre, ou en détacher une, est refusé sans nommer son site ;
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
  await insertAction('A-T90', 'ville-b');
  await insertAction('A-T91', 'ville-a');
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

/** Document commun à tous les sites, en vigueur, sans révision en cours (révisable). */
async function commonDocument() {
  const db = await getDb();
  const [docs, versions] = await Promise.all([db.select().from(t.documents), db.select().from(t.documentVersions)]);
  return docs.filter((d) => !d.siteId).map((d) => d.id).sort().find((id) => {
    const vs = versions.filter((v) => v.documentId === id);
    return vs.some((v) => v.status === 'approuve') && !vs.some((v) => v.status === 'brouillon' || v.status === 'en_revue');
  })!;
}
const draftOf = async (documentId: string) => (await (await getDb()).select().from(t.documentVersions)
  .where(and(eq(t.documentVersions.documentId, documentId), eq(t.documentVersions.status, 'brouillon'))))[0];

describe('Documents : action d’une version hors du périmètre', () => {
  it('rattachement à une révision refusé sans nommer le site, rien écrit', async () => {
    const doc = await commonDocument();
    await actAsEntra('clefevre', 'Animateur QHSE', ['ville-a'], 'ville-a');
    const r = await reviseDocument({}, form({ documentId: doc, summary: 'Révision', actionId: 'A-T90' }));
    expect(r.fieldErrors?.actionId).toBe(OUTSIDE);
    expect(JSON.stringify(r)).not.toMatch(/ville-b|Ville B/i);
    expect(await draftOf(doc)).toBeUndefined();
    expect(await lastLog('action', 'A-T90')).toBeUndefined();
  });

  it('détacher d’une version une action hors du périmètre : refusé, action conservée ; dans le périmètre : journalisé', async () => {
    const doc = await commonDocument();
    // Révision créée sous le périmètre complet avec l'action du site B.
    await actAsEntra('clefevre', 'Animateur QHSE', null, 'all');
    expect(await reviseDocument({}, form({ documentId: doc, summary: 'Révision', actionId: 'A-T90' }))).toEqual({ ok: true, id: doc });
    const v = await draftOf(doc);
    expect(v.actionId).toBe('A-T90');
    await actAsEntra('clefevre', 'Animateur QHSE', ['ville-a'], 'ville-a');
    const r = await updateDraft({}, form({ versionId: String(v.id), summary: v.summary, actionId: 'A-T91' }));
    expect(r.fieldErrors?.actionId).toBe(OUTSIDE);
    expect((await draftOf(doc)).actionId).toBe('A-T90');
    expect(await lastLog('action', 'A-T91')).toBeUndefined();
    // Retour au périmètre complet : remplacement accepté, journalisé sur les deux actions.
    await actAsEntra('clefevre', 'Animateur QHSE', null, 'all');
    expect(await updateDraft({}, form({ versionId: String(v.id), summary: v.summary, actionId: 'A-T91' }))).toEqual({ ok: true, id: doc });
    expect(await lastLog('action', 'A-T90')).toMatchObject({ action: 'unlink', summary: `Détachée de ${doc} · version ${v.version}` });
    expect(await lastLog('action', 'A-T91')).toMatchObject({ action: 'link', summary: `Rattachée à ${doc} · version ${v.version}` });
  });
});

describe('Veille : action d’une exigence hors du périmètre', () => {
  it('Chef de service restreint au site A : numéro seul ; périmètre complet : action décrite', async () => {
    const db = await getDb();
    const [req] = await db.select().from(t.requirements).limit(1);
    await db.update(t.requirements).set({ actionId: 'A-T90' }).where(eq(t.requirements.id, req.id));
    await actAsEntra('sbenali', 'Chef de service', ['ville-a'], 'ville-a');
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
