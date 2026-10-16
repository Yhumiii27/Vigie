import '../next-mocks';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb, schema as t, type DbOrTx } from '@/db';
import type { Avancement } from '@/lib/domain';
import { canReadAttachment, saveUpload, type FileSession } from '@/lib/uploads';
import { StaleActionError, insertComment, nextActionNumber, writeAvancement } from '@/server/action-core';
import {
  actionCommentTitle, actionCommentWithdrawnTitle, actionConfieeTitle, actionProofTitle, notify, qhseAnimatorIds, textExcerpt, withdrawCommentNotifications,
} from '@/server/notify';
import { changeLog, file, freshDemoDatabase } from '../helpers';

// Primitives d'écriture du plan d'actions (src/server/action-core.ts, src/server/notify.ts) et règles de lecture des
// preuves (src/lib/uploads.ts, plan du paquet 1 § 2.9–2.11) sur une base de démonstration neuve (compteur à 222).
// PGlite, et PostgreSQL avec TEST_DATABASE_URL (créations simultanées réellement concurrentes).

freshDemoDatabase();

/** Action minimale insérée hors compteur (numéro imposé). */
async function insertAction(db: DbOrTx, id: string, o: { status?: Avancement; siteId?: string | null; pilotId?: string } = {}) {
  await db.insert(t.actions).values({
    id, openedOn: '2026-10-01', pilotId: o.pilotId ?? 'sbenali', status: o.status ?? 'a_faire', dueOn: '2026-10-30', initialDueOn: '2026-10-30',
    originRef: 'Réf. test', detail: `Action ${id}`, siteId: o.siteId === undefined ? 'ville-a' : o.siteId,
  });
}
const counter = async () => (await (await getDb()).select().from(t.actionCounters))[0];
/** Création réelle : numéro tiré et action insérée dans la même transaction. */
const draw = async () => (await getDb()).transaction(async (tx) => {
  const id = await nextActionNumber(tx);
  await insertAction(tx, id);
  return id;
});
const row = async (id: string) => (await (await getDb()).select().from(t.actions).where(eq(t.actions.id, id)))[0];

describe('nextActionNumber (ACT-35, D14)', () => {
  it('numéros successifs après le compteur du jeu (222), dans la transaction de création', async () => {
    const db = await getDb();
    expect(await counter()).toEqual({ scope: 'A', last: 222 });
    const first = await db.transaction(async (tx) => {
      const id = await nextActionNumber(tx);
      await insertAction(tx, id);
      return id;
    });
    const second = await db.transaction(async (tx) => {
      const id = await nextActionNumber(tx);
      await insertAction(tx, id);
      return id;
    });
    expect([first, second]).toEqual(['A-223', 'A-224']);
    expect(await counter()).toEqual({ scope: 'A', last: 224 });
  });

  it('transaction annulée : le compteur revient en arrière, le numéro n’a jamais existé', async () => {
    const db = await getDb();
    await expect(db.transaction(async (tx) => {
      expect(await nextActionNumber(tx)).toBe('A-225');
      throw new Error('annulation');
    })).rejects.toThrow('annulation');
    expect(await counter()).toEqual({ scope: 'A', last: 224 });
  });

  it('numéro déjà vu (inséré hors compteur, ou présent au journal seulement) : saut au-delà du plus grand numéro vu', async () => {
    const db = await getDb();
    await insertAction(db, 'A-225');
    await db.insert(t.changeLog).values({ entityType: 'action', entityId: 'A-227', action: 'create', summary: 'Action créée', byId: 'clefevre' });
    const ids = [await draw(), await draw()];
    // A-225 existe (collision) : le plus grand numéro vu est A-227 (journal) ; A-226, jamais vu, reste un trou.
    expect(ids).toEqual(['A-228', 'A-229']);
    expect(await counter()).toEqual({ scope: 'A', last: 229 });
  });

  it('compteur en retard : numérotation croissante, toujours au-delà du plus grand numéro vu (jamais un trou plus bas)', async () => {
    const db = await getDb();
    // Compteur ramené à 5 : A-6, jamais vu, n'est pas donné après A-229 (spec § 14 : numéros dans l'ordre de création).
    await db.update(t.actionCounters).set({ last: 5 });
    expect(await draw()).toBe('A-230');
    expect(await counter()).toEqual({ scope: 'A', last: 230 });
    // Compteur revenu sous des numéros existants : idem (identifiant hors format ignoré).
    await db.update(t.actionCounters).set({ last: 222 });
    await insertAction(db, 'A-12345678901');
    expect(await draw()).toBe('A-231');
    expect(await counter()).toEqual({ scope: 'A', last: 231 });
  });

  it('compteur absent (base vide) : créé, puis porté au-delà du plus grand numéro vu', async () => {
    const db = await getDb();
    await db.delete(t.actionCounters);
    await insertAction(db, 'A-1');
    expect(await draw()).toBe('A-232');
    expect(await counter()).toEqual({ scope: 'A', last: 232 });
  });

  it('cinq créations simultanées : cinq numéros distincts (verrou de la ligne du compteur)', async () => {
    const ids = await Promise.all(Array.from({ length: 5 }, () => draw()));
    expect(new Set(ids).size).toBe(5);
    expect([...ids].sort()).toEqual(['A-233', 'A-234', 'A-235', 'A-236', 'A-237']);
    expect(await counter()).toEqual({ scope: 'A', last: 237 });
  });
});

describe('notify (ACT-30, ACT-31)', () => {
  it('ajoute une notification et renvoie son id ; rien pour soi-même ni sans destinataire', async () => {
    const db = await getDb();
    const base = { type: 'action_confiee' as const, entityType: 'action' as const, entityId: 'A-223', href: '/actions?action=A-223', byId: 'clefevre' };
    const id = await notify(db, { ...base, personId: 'tnguyen', title: actionConfieeTitle('A-223', '[C. Lefèvre]', 'Action A-223') });
    expect(id).toEqual(expect.any(Number));
    const [n] = await db.select().from(t.notifications).where(eq(t.notifications.id, id!));
    expect(n).toMatchObject({ personId: 'tnguyen', type: 'action_confiee', entityId: 'A-223', byId: 'clefevre', readAt: null, title: 'Action A-223 confiée par [C. Lefèvre] : Action A-223' });
    expect(await notify(db, { ...base, personId: 'clefevre', title: 'soi-même' })).toBeNull();
    expect(await notify(db, { ...base, personId: null, title: 'personne' })).toBeNull();
    expect(await notify(db, { ...base, personId: '', title: 'vide' })).toBeNull();
    expect(await db.select().from(t.notifications).where(eq(t.notifications.entityId, 'A-223'))).toHaveLength(1);
  });

  it('notification d’un commentaire (commentId) : son retrait réécrit le titre sans extrait, lue ou non (D23)', async () => {
    const db = await getDb();
    const commentId = await db.transaction((tx) => insertComment(tx, { actionId: 'A-214', authorId: 'sbenali', authorRole: 'Chef de service', body: 'Blessure au poignet de M. X' }));
    const n = { type: 'action_commentaire' as const, entityType: 'action' as const, entityId: 'A-214', href: '/actions?action=A-214', byId: 'sbenali', commentId };
    const title = actionCommentTitle('A-214', '[S. Benali]', 'Blessure au poignet de M. X');
    const unread = await notify(db, { ...n, personId: 'clefevre', title });
    const read = await notify(db, { ...n, personId: 'hmarchand', title });
    await db.update(t.notifications).set({ readAt: new Date() }).where(eq(t.notifications.id, read!));
    const other = await notify(db, { ...n, commentId: null, personId: 'clefevre', title: 'Autre notification' });
    expect(await db.transaction((tx) => withdrawCommentNotifications(tx, { id: commentId, actionId: 'A-214', author: '[S. Benali]' }))).toBe(2);
    const rows = await db.select().from(t.notifications).where(eq(t.notifications.entityId, 'A-214'));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(unread!)).toMatchObject({ commentId, title: 'A-214 : commentaire de [S. Benali] — (commentaire retiré)', readAt: null });
    expect(byId.get(read!)!.title).toBe(actionCommentWithdrawnTitle('A-214', '[S. Benali]'));
    expect(byId.get(other!)).toMatchObject({ commentId: null, title: 'Autre notification' });
    expect(rows.some((r) => r.title.includes('poignet'))).toBe(false);
  });

  it('dans une transaction annulée : aucune notification', async () => {
    const db = await getDb();
    await expect(db.transaction(async (tx) => {
      await notify(tx, { personId: 'tnguyen', type: 'action_confiee', entityType: 'action', entityId: 'A-224', title: 'x', href: '/actions?action=A-224', byId: 'clefevre' });
      throw new Error('annulation');
    })).rejects.toThrow('annulation');
    expect(await db.select().from(t.notifications).where(eq(t.notifications.entityId, 'A-224'))).toEqual([]);
  });

  it('animateurs QHSE : dernier rôle connu « Animateur QHSE », présents à l’effectif (date du jour)', async () => {
    const db = await getDb();
    expect(await qhseAnimatorIds(db)).toEqual(['clefevre']);
    await db.update(t.people).set({ lastRole: 'Animateur QHSE' }).where(eq(t.people.id, 'ylambert')); // sorti le 30/09
    await db.update(t.people).set({ lastRole: 'Animateur QHSE' }).where(eq(t.people.id, 'kbernard'));
    expect(await qhseAnimatorIds(db)).toEqual(['kbernard', 'clefevre']);
    await db.update(t.people).set({ lastRole: null }).where(eq(t.people.id, 'kbernard'));
    await db.update(t.people).set({ lastRole: null }).where(eq(t.people.id, 'ylambert'));
  });

  it('libellés : action confiée, commentaire (extrait de 80 caractères, preuves nommées), preuve', () => {
    expect(actionConfieeTitle('A-221', '[C. Lefèvre]', 'Agrandir l’abri')).toBe('Action A-221 confiée par [C. Lefèvre] : Agrandir l’abri');
    const long = `${'mot '.repeat(30)}fin`;
    const title = actionCommentTitle('A-215', '[T. Nguyen]', long);
    expect(title.startsWith('A-215 : commentaire de [T. Nguyen] — ')).toBe(true);
    expect(title.length).toBe('A-215 : commentaire de [T. Nguyen] — '.length + 80);
    expect(title.endsWith('…')).toBe(true);
    expect(actionCommentTitle('A-215', '[T. Nguyen]', 'Texte\n  sur deux lignes', ['a.pdf'])).toBe('A-215 : commentaire de [T. Nguyen] — Texte sur deux lignes · preuve « a.pdf »');
    expect(actionCommentTitle('A-215', '[T. Nguyen]', 'Voir', ['a.pdf', 'b.jpg'])).toBe('A-215 : commentaire de [T. Nguyen] — Voir · preuves « a.pdf », « b.jpg »');
    expect(actionProofTitle('A-215', '[T. Nguyen]', 'photo.jpg')).toBe('A-215 : preuve « photo.jpg » ajoutée par [T. Nguyen]');
    expect(textExcerpt('  a  b ')).toBe('a b');
  });
});

describe('writeAvancement (D11)', () => {
  it('applique l’avancement et le patch ; journal « status » au détail structuré (libellés et clés)', async () => {
    const db = await getDb();
    await insertAction(db, 'A-300', { status: 'p40' });
    const a = await row('A-300'); // lue avant la transaction (PGlite : une seule connexion)
    await db.transaction(async (tx) => {
      await writeAvancement(tx, a, 'terminee', {
        byId: 'clefevre', patch: { doneOn: '2026-10-08', verifyDueOn: '2026-10-20' }, details: [{ field: 'Date effective', from: null, to: '08/10/2026' }],
      });
    });
    expect(await row('A-300')).toMatchObject({ status: 'terminee', doneOn: '2026-10-08', verifyDueOn: '2026-10-20' });
    const [entry] = await changeLog('action', 'A-300');
    expect(entry).toMatchObject({ action: 'status', summary: 'Terminée le 08/10/2026', byId: 'clefevre', reason: null });
    expect(entry.details).toEqual([
      { field: 'Avancement', from: '40 %', to: 'Terminée — à vérifier', fromKey: 'p40', toKey: 'terminee' },
      { field: 'Date effective', from: null, to: '08/10/2026' },
    ]);
  });

  it('résumé et motif fournis ; vérification non efficace (résultat lu dans le patch)', async () => {
    const db = await getDb();
    const terminee = await row('A-300');
    await db.transaction((tx) => writeAvancement(tx, terminee, 'verifiee', {
      byId: 'hmarchand', patch: { closedOn: '2026-10-09', effective: false, verifyMethod: 'visuelle', efficacyNote: 'Constat', verifiedById: 'hmarchand' },
    }));
    expect((await changeLog('action', 'A-300')).at(-1)).toMatchObject({ summary: 'Vérifiée : non efficace', byId: 'hmarchand' });
    const verifiee = await row('A-300');
    await db.transaction((tx) => writeAvancement(tx, verifiee, 'terminee', { byId: 'clefevre', reason: 'Constat à revoir', summary: 'Rouverte' }));
    const last = (await changeLog('action', 'A-300')).at(-1)!;
    expect(last).toMatchObject({ summary: 'Rouverte', reason: 'Constat à revoir' });
    expect((last.details as { fromKey: string; toKey: string }[])[0]).toMatchObject({ fromKey: 'verifiee', toKey: 'terminee' });
  });

  it('transition non permise : erreur, rien n’est écrit (ni l’action ni le journal)', async () => {
    const db = await getDb();
    const before = await changeLog('action', 'A-300');
    const a300 = await row('A-300');
    for (const to of ['terminee', 'reportee'] as const) {
      await expect(db.transaction((tx) => writeAvancement(tx, a300, to, { byId: 'clefevre' }))).rejects.toThrow(/non permis/);
    }
    await insertAction(db, 'A-301', { status: 'abandonnee' });
    const a301 = await row('A-301');
    await expect(db.transaction((tx) => writeAvancement(tx, a301, 'a_faire', { byId: 'clefevre' }))).rejects.toThrow(/non permis/);
    expect(await row('A-300')).toMatchObject({ status: 'terminee' });
    expect(await changeLog('action', 'A-300')).toEqual(before);
    expect(await changeLog('action', 'A-301')).toEqual([]);
  });

  it('avancement changé entre-temps : StaleActionError, rien n’est écrit ; numéro et avancement jamais pris du patch', async () => {
    const db = await getDb();
    await insertAction(db, 'A-302', { status: 'a_faire' });
    const stale = await row('A-302');
    await db.update(t.actions).set({ status: 'p20' }).where(eq(t.actions.id, 'A-302'));
    await expect(db.transaction((tx) => writeAvancement(tx, stale, 'p40', { byId: 'clefevre' }))).rejects.toBeInstanceOf(StaleActionError);
    expect(await row('A-302')).toMatchObject({ status: 'p20' });
    expect(await changeLog('action', 'A-302')).toEqual([]);
    const fresh = await row('A-302');
    await db.transaction((tx) => writeAvancement(tx, fresh, 'p40', { byId: 'clefevre', patch: { id: 'A-999', status: 'verifiee', priority: 'urgent' } }));
    expect(await row('A-302')).toMatchObject({ id: 'A-302', status: 'p40', priority: 'urgent' });
    expect(await row('A-999')).toBeUndefined();
    expect((await changeLog('action', 'A-302'))[0]).toMatchObject({ summary: 'Avancement : 20 % → 40 %' });
  });
});

describe('insertComment (ACT-24)', () => {
  it('commentaire daté, signé du rôle de l’auteur ; journal « Commentaire ajouté » sans recopier le texte (D23)', async () => {
    const db = await getDb();
    const at = new Date('2026-10-08T07:30:00Z');
    const id = await db.transaction((tx) => insertComment(tx, { actionId: 'A-302', authorId: 'sbenali', authorRole: 'Chef de service', body: 'Texte du commentaire confidentiel', at }));
    const [c] = await db.select().from(t.actionComments).where(eq(t.actionComments.id, id));
    expect(c).toMatchObject({ actionId: 'A-302', authorId: 'sbenali', authorRole: 'Chef de service', body: 'Texte du commentaire confidentiel', withdrawnAt: null });
    expect(c.createdAt.getTime()).toBe(at.getTime());
    const last = (await changeLog('action', 'A-302')).at(-1)!;
    expect(last).toMatchObject({ action: 'comment', summary: 'Commentaire ajouté', byId: 'sbenali', details: null });
    expect(JSON.stringify(last)).not.toContain('confidentiel');
  });

  it('commentaire vide ou trop long refusé par la base ; transaction annulée : ni commentaire ni journal', async () => {
    const db = await getDb();
    const before = (await changeLog('action', 'A-302')).length;
    await expect(db.transaction((tx) => insertComment(tx, { actionId: 'A-302', authorId: 'clefevre', authorRole: 'Animateur QHSE', body: '' }))).rejects.toThrow();
    await expect(db.transaction((tx) => insertComment(tx, { actionId: 'A-302', authorId: 'clefevre', authorRole: 'Animateur QHSE', body: 'x'.repeat(4001) }))).rejects.toThrow();
    expect(await changeLog('action', 'A-302')).toHaveLength(before);
  });
});

describe('preuves des actions : enregistrement et lecture (src/lib/uploads.ts, D10, D19, D23)', () => {
  const session = (role: FileSession['role'], id: string, allowedSiteIds: string[] | null = null): FileSession => ({ role, user: { id }, allowedSiteIds });
  const proofOf = async (actionId: string) => (await (await getDb()).select().from(t.attachments)
    .where(and(eq(t.attachments.entityType, 'action'), eq(t.attachments.entityId, actionId))))[0];

  it('saveUpload dans la transaction de l’écriture : ligne avec son commentaire ; annulée : aucune ligne', async () => {
    const db = await getDb();
    const saved = await db.transaction(async (tx) => {
      const commentId = await insertComment(tx, { actionId: 'A-302', authorId: 'sbenali', authorRole: 'Chef de service', body: 'Avec preuve' });
      return saveUpload(file('preuve.pdf'), 'action', 'A-302', 'sbenali', { db: tx, commentId });
    });
    expect(saved).toMatchObject({ entityType: 'action', entityId: 'A-302', uploadedBy: 'sbenali', commentId: expect.any(Number), health: false });
    await expect(db.transaction(async (tx) => {
      await saveUpload(file('annulee.pdf'), 'action', 'A-302', 'sbenali', { db: tx });
      throw new Error('annulation');
    })).rejects.toThrow('annulation');
    expect((await db.select().from(t.attachments).where(eq(t.attachments.entityId, 'A-302'))).map((a) => a.fileName)).toEqual(['preuve.pdf']);
  });

  it('responsable : preuves de son action quel que soit son site (D19) ; hors périmètre sinon refusé', async () => {
    const a215 = await proofOf('A-215'); // site A, responsable tnguyen (Salarié)
    const a214 = await proofOf('A-214'); // site A, responsable sbenali (Chef de service)
    expect(await canReadAttachment(a215, session('Salarié', 'tnguyen', ['ville-b']))).toBe(true);
    expect(await canReadAttachment(a214, session('Chef de service', 'sbenali', ['ville-b']))).toBe(true);
    expect(await canReadAttachment(a214, session('Chef de service', 'lmoreau', ['ville-b']))).toBe(false);
    expect(await canReadAttachment(a214, session('Chef de service', 'lmoreau', ['ville-a']))).toBe(true);
    expect(await canReadAttachment(a214, session('Chef de projet', 'edubois'))).toBe(true);
    expect(await canReadAttachment(a214, session('Salarié', 'tnguyen'))).toBe(false);
    expect(await canReadAttachment(a215, session('Salarié', 'mgirard'))).toBe(false);
  });

  it('preuve d’un commentaire retiré : QHSE seulement, même pour son auteur responsable (D23)', async () => {
    const proof = await proofOf('A-209'); // commentaire retiré de jpetit, responsable de A-209 (site B)
    expect(proof.commentId).toEqual(expect.any(Number));
    expect(await canReadAttachment(proof, session('Chef de service', 'jpetit'))).toBe(false);
    expect(await canReadAttachment(proof, session('Chef de projet', 'edubois'))).toBe(false);
    expect(await canReadAttachment(proof, session('Animateur QHSE', 'clefevre'))).toBe(true);
    expect(await canReadAttachment(proof, session('Direction', 'hmarchand'))).toBe(true);
    // Ligne construite hors base (sans commentId) : acceptée par le contrôle (type AttachmentAccess).
    const { commentId: _omit, ...plain } = await proofOf('A-214');
    void _omit;
    expect(await canReadAttachment(plain, session('Animateur QHSE', 'clefevre'))).toBe(true);
  });
});
