import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieJar, form } from '../next-mocks';
import { file, formWith, freshDemoDatabase } from '../helpers';
import { actionRow, editFields, insertAction, NEW_ACTION } from './actions-helpers';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import type { Role } from '@/lib/domain';
import { resetConfig } from '@/lib/env';
import { addActionComment, withdrawActionComment } from '@/server/action-comments';
import { linkAction, unlinkAction } from '@/server/links';
import { addActionFiles, removeActionFile, saveAction } from '@/server/plan';
import { abandonAction, moveAction, reopenAction, verifyAction } from '@/server/plan-ui';

// Périmètre de sites (SEC-02) des écritures du plan d'actions, en session Entra ID (pattern de perimeter-options) :
// le responsable commente et joint ses preuves sur ses actions de tout site (D19) mais ne fait aucune transition ;
// toute autre écriture sur une action hors périmètre est refusée sans nommer son site ; création et action de suite sur
// un site hors périmètre refusées. Sans VIGIE_TODAY (hors démonstration) : dates de test en 2027.

const SECRET = 'secret-de-session-des-tests-perimetre-actions-0123456789';
const ENTRA_ENV = {
  VIGIE_PUBLIC_URL: 'https://vigie.exemple.fr', VIGIE_SESSION_SECRET: SECRET,
  ENTRA_TENANT_ID: 'tenant', ENTRA_CLIENT_ID: 'client', ENTRA_CLIENT_SECRET: 'secret',
};
const OUTSIDE = 'Cet élément appartient à un site hors de votre périmètre.';
const APPROVERS_ONLY = "Réservé à l'animateur QHSE et à la direction.";

freshDemoDatabase();
beforeAll(async () => {
  delete process.env.VIGIE_DEMO;
  delete process.env.VIGIE_TODAY;
  Object.assign(process.env, ENTRA_ENV);
  resetConfig();
  const later = { dueOn: '2027-03-31', initialDueOn: '2027-03-31', verifyDueOn: '2027-04-30' };
  await insertAction('A-T80', { siteId: 'ville-b', pilotId: 'tnguyen', ...later });
  await insertAction('A-T81', { siteId: 'ville-b', pilotId: 'sbenali', status: 'terminee', doneOn: '2026-10-01', ...later });
  await insertAction('A-T82', { siteId: 'ville-a', pilotId: 'sbenali', status: 'terminee', doneOn: '2026-10-01', ...later });
  await insertAction('A-T83', { siteId: 'ville-b', pilotId: 'sbenali', status: 'abandonnee', cancelledAt: new Date(), cancelledById: 'clefevre', cancelReason: 'Test', ...later });
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

describe('responsable restreint au site A, action du site B (D19)', () => {
  it('Salarié : commente et joint ses preuves, sans transition', async () => {
    await actAsEntra('tnguyen', 'Salarié', ['ville-a'], 'ville-a');
    expect(await addActionComment({}, formWith({ actionId: 'A-T80', body: 'Fait ce matin.' }, { files: [file('photo.jpg', 'image/jpeg', 'jpg')] }))).toEqual({ ok: true, id: 'A-T80' });
    expect(await addActionFiles(formWith({ actionId: 'A-T80' }, { files: [file('pv.pdf')] }))).toEqual({ count: 1 });
    expect(await moveAction({}, form({ id: 'A-T80', from: 'a_faire', to: 'p20' }))).toEqual({ error: APPROVERS_ONLY });
    const [own] = await (await getDb()).select().from(t.attachments).where(and(eq(t.attachments.entityId, 'A-T80'), eq(t.attachments.fileName, 'pv.pdf')));
    expect(await removeActionFile(own.id)).toEqual({});
  });

  it('Chef de service : commente son action du site B, pas celle d’un autre', async () => {
    await actAsEntra('sbenali', 'Chef de service', ['ville-a'], 'ville-a');
    expect(await addActionComment({}, form({ actionId: 'A-T81', body: 'Contrôle fait.' }))).toEqual({ ok: true, id: 'A-T81' });
    expect(await addActionComment({}, form({ actionId: 'A-T80', body: 'Lecture' }))).toEqual({ error: 'Votre rôle ne permet pas cette modification.' });
  });
});

describe('QHSE restreint au site A : toute écriture sur une action du site B refusée, sans nommer le site', () => {
  it('modification, transitions, vérification, réouverture, abandon, fil, preuves, liens', async () => {
    const db = await getDb();
    const [comment] = await db.select().from(t.actionComments).where(eq(t.actionComments.actionId, 'A-T80'));
    const [proof] = await db.select().from(t.attachments).where(eq(t.attachments.entityId, 'A-T80'));
    await actAsEntra('clefevre', 'Animateur QHSE', ['ville-a'], 'ville-a');
    const results = [
      await saveAction({}, form(editFields(await actionRow('A-T80'), { priority: 'urgent' }))),
      await moveAction({}, form({ id: 'A-T80', from: 'a_faire', to: 'p20' })),
      await verifyAction({}, form({ id: 'A-T81', from: 'terminee', verifyMethod: 'ecrit', efficacyNote: 'Vu', effective: 'efficace' })),
      await reopenAction({}, form({ id: 'A-165', from: 'verifiee', reason: 'Test' })),
      await abandonAction({}, form({ id: 'A-T80', from: 'a_faire', reason: 'Test' })),
      await addActionComment({}, form({ actionId: 'A-T80', body: 'Hors périmètre' })),
      await withdrawActionComment({}, form({ id: String(comment.id), reason: 'Test' })),
      await addActionFiles(formWith({ actionId: 'A-T80' }, { files: [file()] })),
      await removeActionFile(proof.id),
      await linkAction('risk:13', 'A-T80'),
      await unlinkAction('risk:14', 'A-165'),
    ];
    for (const r of results) {
      expect(r).toEqual({ error: OUTSIDE });
      expect(JSON.stringify(r)).not.toMatch(/ville-b|Ville B/);
    }
    expect(await actionRow('A-T80')).toMatchObject({ status: 'a_faire', priority: 'moyen_terme' });
    expect((await actionRow('A-T81')).status).toBe('terminee');
  });

  it('avancement et état d’une action du site B jamais révélés : refus de périmètre avant tout autre contrôle', async () => {
    await actAsEntra('clefevre', 'Animateur QHSE', ['ville-a'], 'ville-a');
    const results = [
      // Avancement affiché périmé (A-T80 est À faire) : pas de « l'action a changé entre-temps ».
      await moveAction({}, form({ id: 'A-T80', from: 'p40', to: 'p60' })),
      await saveAction({}, form(editFields(await actionRow('A-T80'), { from: 'p40' }))),
      await verifyAction({}, form({ id: 'A-T80', from: 'terminee', verifyMethod: 'ecrit', efficacyNote: 'Vu', effective: 'efficace' })),
      // Action abandonnée ou vérifiée : pas de « consultation seule » ni de « vérifiée ou abandonnée ».
      await saveAction({}, form(editFields(await actionRow('A-T83')))),
      await addActionFiles(formWith({ actionId: 'A-T83' }, { files: [file()] })),
      await addActionComment({}, formWith({ actionId: 'A-T83', body: 'Avec preuve' }, { files: [file()] })),
      await linkAction('risk:13', 'A-T83'),
      await linkAction('risk:13', 'A-165'),
      await unlinkAction('risk:13', 'A-T83'),
    ];
    for (const r of results) expect(r).toEqual({ error: OUTSIDE });
  });

  it('création depuis un élément du site B (hors périmètre) refusée sans nommer le site', async () => {
    await actAsEntra('clefevre', 'Animateur QHSE', ['ville-a'], 'ville-a');
    const later = { dueOn: '2027-03-31', verifyDueOn: '2027-04-30' };
    const r = await saveAction({}, form({ ...NEW_ACTION, ...later, source: 'evenement', link: 'event:EV-2026-129', originRef: '', siteId: 'ville-a' }));
    expect(r).toMatchObject({ error: OUTSIDE, fieldErrors: { link: OUTSIDE } });
    expect(JSON.stringify(r)).not.toMatch(/ville-b|Ville B/);
  });

  it('création et action de suite sur le site B refusées', async () => {
    await actAsEntra('clefevre', 'Animateur QHSE', ['ville-a'], 'ville-a');
    const later = { dueOn: '2027-03-31', verifyDueOn: '2027-04-30' };
    expect(await saveAction({}, form({ ...NEW_ACTION, ...later, siteId: 'ville-b' }))).toMatchObject({ error: OUTSIDE });
    const ne = { ne_detail: 'Suite', ne_pilotId: 'sbenali', ne_priority: 'urgent', ne_dueOn: '2027-03-31', ne_verifyDueOn: '2027-04-30', ne_domain: 'securite', ne_siteId: 'ville-b' };
    expect(await verifyAction({}, form({ id: 'A-T82', from: 'terminee', verifyMethod: 'ecrit', efficacyNote: 'Non', effective: 'non_efficace', ...ne }))).toMatchObject({
      error: OUTSIDE, fieldErrors: { ne_siteId: OUTSIDE },
    });
    expect((await actionRow('A-T82')).status).toBe('terminee');
    // Même vérification avec une suite du site A : admise.
    expect(await verifyAction({}, form({ id: 'A-T82', from: 'terminee', verifyMethod: 'ecrit', efficacyNote: 'Non', effective: 'non_efficace', ...ne, ne_siteId: 'ville-a' }))).toMatchObject({ ok: true, ids: [expect.any(String)] });
  });
});
