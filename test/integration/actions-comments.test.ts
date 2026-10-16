import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, file, formWith, freshDemoDatabase, lastLog } from '../helpers';
import { insertAction, notificationsOf } from './actions-helpers';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { canReadAttachment } from '@/lib/uploads';
import { addActionComment, withdrawActionComment } from '@/server/action-comments';

// Fil de commentaires (ACT-24) et preuves jointes à un commentaire (ACT-25, D10) : responsable (ses actions, sans changer
// de site, D19) et service QHSE (site sélectionné), à tout avancement ; notification ACT-31 de chaque animateur QHSE pour
// un commentaire du responsable hors QHSE ; retrait motivé (D23 : texte conservé, preuves réservées au QHSE, titre des
// notifications réécrit). Jeu : [T. Nguyen] (Salarié) responsable de A-215 (site A) ; [C. Lefèvre] seule animatrice QHSE.

freshDemoDatabase();

const DENIED = 'Votre rôle ne permet pas cette modification.';
const OTHER_SITE = 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.';
const comment = (actionId: string, body: string, files: File[] = []) => addActionComment({}, formWith({ actionId, body }, { files }));
const commentsOf = async (actionId: string) => (await getDb()).select().from(t.actionComments).where(eq(t.actionComments.actionId, actionId)).orderBy(t.actionComments.id);
const filesOf = async (actionId: string) => (await getDb()).select().from(t.attachments).where(and(eq(t.attachments.entityType, 'action'), eq(t.attachments.entityId, actionId)));

describe('ajout', () => {
  it('responsable salarié : commentaire signé, preuves jointes, journal, une notification par animateur QHSE (ACT-31)', async () => {
    actAs('Salarié', 'ville-b'); // site sélectionné sans effet pour le responsable (D19)
    const before = (await notificationsOf('clefevre')).length;
    const r = await comment('A-215', 'Mode opératoire rédigé, en relecture par le chef d’équipe.', [file('mode-operatoire.pdf'), file('photo.jpg', 'image/jpeg', 'jpg')]);
    expect(r).toEqual({ ok: true, id: 'A-215' });
    const c = (await commentsOf('A-215')).at(-1)!;
    expect(c).toMatchObject({ authorId: 'tnguyen', authorRole: 'Salarié', body: 'Mode opératoire rédigé, en relecture par le chef d’équipe.', withdrawnAt: null });
    const files = (await filesOf('A-215')).filter((f) => f.commentId === c.id);
    expect(files.map((f) => f.fileName).sort()).toEqual(['mode-operatoire.pdf', 'photo.jpg']);
    expect(files.every((f) => f.uploadedBy === 'tnguyen')).toBe(true);
    const log = (await changeLog('action', 'A-215')).slice(-2);
    expect(log).toMatchObject([
      { action: 'comment', summary: 'Commentaire ajouté', byId: 'tnguyen' },
      { action: 'attach', summary: '2 preuves ajoutées avec un commentaire', details: [{ field: 'Fichier', to: 'mode-operatoire.pdf' }, { field: 'Fichier', to: 'photo.jpg' }] },
    ]);
    const added = (await notificationsOf('clefevre')).slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      type: 'action_commentaire', entityId: 'A-215', byId: 'tnguyen', commentId: c.id, href: '/actions?action=A-215', readAt: null,
      title: 'A-215 : commentaire de [T. Nguyen] — Mode opératoire rédigé, en relecture par le chef d’équipe. · preuves « mode-operatoire.pdf », « photo.jpg »',
    });
  });

  it('QHSE : commentaire sans notification, site sélectionné exigé ; encadrement non responsable refusé', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const before = (await notificationsOf('clefevre')).length;
    expect(await comment('A-215', 'Relecture faite, à diffuser.')).toEqual({ ok: true, id: 'A-215' });
    expect((await commentsOf('A-215')).at(-1)).toMatchObject({ authorId: 'clefevre', authorRole: 'Animateur QHSE' });
    expect((await notificationsOf('clefevre')).length).toBe(before);
    actAs('Animateur QHSE', 'ville-b');
    expect(await comment('A-215', 'Hors site')).toEqual({ error: OTHER_SITE });
    actAs('Chef de service', 'ville-a'); // [S. Benali], pas responsable de A-215
    expect(await comment('A-215', 'Lecture seule')).toEqual({ error: DENIED });
    actAs('Chef de projet', 'ville-a');
    expect(await comment('A-215', 'Lecture seule')).toEqual({ error: DENIED });
  });

  it('responsable de l’encadrement (Chef de service) : notification des animateurs QHSE', async () => {
    actAs('Chef de service', 'ville-a');
    expect(await comment('A-214', 'Élingues commandées.')).toEqual({ ok: true, id: 'A-214' });
    expect((await notificationsOf('clefevre')).at(-1)).toMatchObject({ type: 'action_commentaire', entityId: 'A-214', title: 'A-214 : commentaire de [S. Benali] — Élingues commandées.' });
  });

  it('texte obligatoire, 4 000 caractères ; action abandonnée : commentaire admis, preuve refusée ; fichiers contrôlés', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await comment('A-215', '')).toMatchObject({ fieldErrors: { body: 'Champ obligatoire.' } });
    expect(await comment('A-215', 'x'.repeat(4001))).toMatchObject({ fieldErrors: { body: '4000 caractères au maximum.' } });
    expect(await comment('A-215', 'Format', [file('script.exe', 'application/x-msdownload')])).toMatchObject({ error: expect.stringContaining('Format non accepté') });
    expect(await comment('A-180', 'Pour mémoire : doublon confirmé.')).toEqual({ ok: true, id: 'A-180' });
    expect(await comment('A-180', 'Avec preuve', [file()])).toMatchObject({ error: 'Action abandonnée : les preuves ne peuvent plus être jointes.' });
    expect(await addActionComment({}, form({ actionId: 'A-inconnue', body: 'x' }))).toEqual({ error: 'Action introuvable.' });
  });
});

describe('retrait (motif obligatoire, D23)', () => {
  it('auteur responsable : retiré, texte conservé, journal motivé, notification réécrite ; preuves réservées au QHSE', async () => {
    actAs('Salarié');
    const c = (await commentsOf('A-215')).find((x) => x.authorId === 'tnguyen' && x.body.startsWith('Mode opératoire'))!;
    expect(await withdrawActionComment({}, form({ id: String(c.id), reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await withdrawActionComment({}, form({ id: String(c.id), reason: 'Publié sur la mauvaise action.' }))).toEqual({ ok: true, id: 'A-215' });
    expect((await commentsOf('A-215')).find((x) => x.id === c.id)).toMatchObject({ withdrawnById: 'tnguyen', withdrawReason: 'Publié sur la mauvaise action.', body: c.body });
    expect(await lastLog('action', 'A-215')).toMatchObject({ action: 'comment_withdraw', summary: 'Commentaire retiré', reason: 'Publié sur la mauvaise action.', byId: 'tnguyen' });
    const [n] = (await notificationsOf('clefevre')).filter((x) => x.commentId === c.id);
    expect(n.title).toBe('A-215 : commentaire de [T. Nguyen] — (commentaire retiré)');
    expect(await withdrawActionComment({}, form({ id: String(c.id), reason: 'Encore' }))).toEqual({ error: 'Commentaire déjà retiré.' });

    const [proof] = (await filesOf('A-215')).filter((f) => f.commentId === c.id);
    expect(await canReadAttachment(proof, { role: 'Salarié', user: { id: 'tnguyen' }, allowedSiteIds: null })).toBe(false);
    expect(await canReadAttachment(proof, { role: 'Chef de service', user: { id: 'sbenali' }, allowedSiteIds: null })).toBe(false);
    expect(await canReadAttachment(proof, { role: 'Animateur QHSE', user: { id: 'clefevre' }, allowedSiteIds: null })).toBe(true);
  });

  it('commentaire d’autrui : refusé au responsable, admis pour le QHSE (site sélectionné)', async () => {
    const qhse = (await commentsOf('A-215')).find((x) => x.authorId === 'clefevre' && !x.withdrawnAt)!;
    actAs('Salarié');
    expect(await withdrawActionComment({}, form({ id: String(qhse.id), reason: 'Test' }))).toEqual({ error: DENIED });
    const jpetit = (await commentsOf('A-209')).find((x) => x.authorId === 'jpetit' && !x.withdrawnAt)!;
    actAs('Animateur QHSE', 'ville-a');
    expect(await withdrawActionComment({}, form({ id: String(jpetit.id), reason: 'Données personnelles' }))).toEqual({ error: OTHER_SITE });
    actAs('Animateur QHSE', 'ville-b');
    expect(await withdrawActionComment({}, form({ id: String(jpetit.id), reason: 'Données personnelles' }))).toEqual({ ok: true, id: 'A-209' });
    expect(await withdrawActionComment({}, form({ id: '999999', reason: 'x' }))).toEqual({ error: 'Commentaire introuvable.' });
  });
});

describe('lecture des preuves (canReadAttachment)', () => {
  it('responsable, encadrement lecteur du plan, autre Salarié', async () => {
    actAs('Animateur QHSE', 'ville-a');
    await insertAction('A-T40', { pilotId: 'tnguyen' });
    expect(await comment('A-T40', 'Photo jointe', [file('avant.jpg', 'image/jpeg', 'jpg')])).toMatchObject({ ok: true });
    const [proof] = await filesOf('A-T40');
    expect(await canReadAttachment(proof, { role: 'Salarié', user: { id: 'tnguyen' }, allowedSiteIds: ['ville-b'] })).toBe(true);
    expect(await canReadAttachment(proof, { role: 'Chef de projet', user: { id: 'edubois' }, allowedSiteIds: null })).toBe(true);
    expect(await canReadAttachment(proof, { role: 'Chef de service', user: { id: 'jpetit' }, allowedSiteIds: ['ville-b'] })).toBe(false);
    expect(await canReadAttachment(proof, { role: 'Salarié', user: { id: 'mgirard' }, allowedSiteIds: null })).toBe(false);
  });
});
