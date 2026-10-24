'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { actionHref, actionRights, canWithdrawComment } from '@/lib/action-rules';
import { ACTION_TEXT_MAX } from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { getSession } from '@/lib/session';
import { saveUpload } from '@/lib/uploads';
import { filesProblem, ownOrInSite } from './action-create';
import { insertComment } from './action-core';
import { logChange } from './changelog';
import { actionCommentTitle, notify, qhseAnimatorIds, withdrawCommentNotifications } from './notify';

// Fil de commentaires d'une action (ACT-24), daté et signé du rôle de l'auteur, jamais modifié ; preuves jointes à un
// commentaire (ACT-25, attachments.comment_id, D10). Auteurs : le responsable de l'action (ses actions, quel que soit leur
// site : D19, sans changer de site sélectionné) et le service QHSE (site sélectionné : requireInSite), à tout avancement
// — preuves refusées sur une action abandonnée. Commentaire du responsable hors QHSE : une notification à chaque
// animateur QHSE (ACT-31, ses preuves nommées dans le titre). Retrait motivé par l'auteur ou le QHSE : texte conservé en
// base, jamais renvoyé au navigateur ; ses preuves deviennent réservées au QHSE (D23, src/lib/uploads.ts) ; les
// notifications qui en portaient l'extrait sont réécrites.

const DENIED = 'Votre rôle ne permet pas cette modification.';

/** Ajoute un commentaire au fil d'une action, avec ses preuves éventuelles (ACT-24, ACT-25) : responsable ou QHSE. */
export async function addActionComment(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await getSession();
  const f = formReader(fd);
  const actionId = f.str('actionId', { required: true });
  const body = f.str('body', { required: true, max: ACTION_TEXT_MAX });
  const files = f.files('files');
  if (!actionId) return { error: 'Action introuvable.' };
  if (!f.ok) return f.state();

  const db = await getDb();
  const [a] = await db.select().from(t.actions).where(eq(t.actions.id, actionId));
  if (!a) return { error: 'Action introuvable.' };
  const rights = actionRights(session.role, session.user.id, a);
  if (!rights.canComment) return { error: DENIED };
  const blocked = await ownOrInSite(a, rights.responsible);
  if (blocked) return { error: blocked };
  if (files.length && !rights.canAttach) return { error: 'Action abandonnée : les preuves ne peuvent plus être jointes.', fieldErrors: { files: 'Action abandonnée.' } };
  const invalid = await filesProblem(files, session.user.id);
  if (invalid) return { error: invalid, fieldErrors: { files: invalid } };

  await db.transaction(async (tx) => {
    const commentId = await insertComment(tx, { actionId, authorId: session.user.id, authorRole: session.role, body });
    const names = files.map((file) => file.name.slice(0, 200) || 'fichier');
    for (const file of files) await saveUpload(file, 'action', actionId, session.user.id, { db: tx, commentId });
    if (files.length) {
      await logChange(tx, {
        entityType: 'action', entityId: actionId, action: 'attach', byId: session.user.id,
        summary: `${files.length} preuve${files.length > 1 ? 's' : ''} ajoutée${files.length > 1 ? 's' : ''} avec un commentaire`,
        details: names.map((name) => ({ field: 'Fichier', from: null, to: name })),
      });
    }
    // ACT-31 : commentaire du responsable (hors QHSE) → chaque animateur QHSE, une notification (preuves nommées).
    if (rights.responsible && !rights.qhse) {
      for (const personId of await qhseAnimatorIds(tx)) {
        await notify(tx, {
          personId, type: 'action_commentaire', entityType: 'action', entityId: actionId, byId: session.user.id, commentId,
          title: actionCommentTitle(actionId, session.user.name, body, names), href: actionHref(actionId),
        });
      }
    }
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: actionId };
}

/** Retire un commentaire (motif obligatoire) : son auteur ou le QHSE ; texte conservé en base, jamais renvoyé (D23). */
export async function withdrawActionComment(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await getSession();
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();

  const db = await getDb();
  const [c] = await db.select({ id: t.actionComments.id, actionId: t.actionComments.actionId, authorId: t.actionComments.authorId, withdrawnAt: t.actionComments.withdrawnAt, author: t.people.name })
    .from(t.actionComments).innerJoin(t.people, eq(t.actionComments.authorId, t.people.id)).where(eq(t.actionComments.id, id!));
  if (!c) return { error: 'Commentaire introuvable.' };
  const [a] = await db.select().from(t.actions).where(eq(t.actions.id, c.actionId));
  if (!a) return { error: 'Action introuvable.' };
  const rights = actionRights(session.role, session.user.id, a);
  if (!canWithdrawComment(rights, { authorId: c.authorId, withdrawn: false }, session.user.id)) return { error: DENIED };
  // Site avant l'état du commentaire : rien n'est révélé d'une action hors du site sélectionné ou du périmètre.
  const blocked = await ownOrInSite(a, rights.responsible);
  if (blocked) return { error: blocked };
  if (c.withdrawnAt) return { error: 'Commentaire déjà retiré.' };

  const done = await db.transaction(async (tx) => {
    const rows = await tx.update(t.actionComments).set({ withdrawnAt: new Date(), withdrawnById: session.user.id, withdrawReason: reason })
      .where(and(eq(t.actionComments.id, c.id), isNull(t.actionComments.withdrawnAt))).returning({ id: t.actionComments.id });
    if (!rows.length) return false;
    await logChange(tx, { entityType: 'action', entityId: a.id, action: 'comment_withdraw', summary: 'Commentaire retiré', reason, byId: session.user.id });
    await withdrawCommentNotifications(tx, { id: c.id, actionId: a.id, author: c.author });
    return true;
  });
  if (!done) return { error: 'Commentaire déjà retiré.' };
  revalidatePath('/', 'layout');
  return { ok: true, id: a.id };
}
