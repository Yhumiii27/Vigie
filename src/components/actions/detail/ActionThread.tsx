'use client';

// Fil de commentaires d'une action (§ 9, ACT-24) : chronologique, daté (heure de Paris) et signé ; jamais modifié ; un
// commentaire retiré reste au fil sans son texte (jamais envoyé au navigateur, D23). Ajout : responsable et QHSE
// (preuves jointes si `canAttach`), avec l'aide de saisie « aucune donnée de santé ».

import { useState } from 'react';
import { ActionForm, Field, TextArea } from '@/components/form';
import { ReasonButton } from '@/components/ReasonDialog';
import { canWithdrawComment, type ActionRights } from '@/lib/action-rules';
import type { ActionCommentView } from '@/lib/action-view';
import { ATTACH_ACCEPT, fileIcon, fmtSize } from '@/lib/attachments';
import { ACTION_TEXT_MAX } from '@/lib/domain';
import { addActionComment, withdrawActionComment } from '@/server/action-comments';
import { AT_HEALTH_WARNING, NO_HEALTH_REMINDER, commentAnchor, commentMeta, pickedFilesError } from './form-helpers';

export function ActionThread({ actionId, comments, rights, currentUserId, writable, healthWarning }: {
  actionId: string; comments: ActionCommentView[]; rights: ActionRights; currentUserId: string;
  /** Écriture admise ici (QHSE sur le site de l'action, responsable de tout site). */
  writable: boolean; healthWarning: boolean;
}) {
  const [filesError, setFilesError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  return (
    <section className="vg-action-block" aria-label="Fil de commentaires">
      <h6 className="vg-h6">Fil{comments.length > 0 && <span style={{ color: 'var(--vg-text-muted)' }}> · {comments.length}</span>}</h6>
      {comments.length === 0 ? (
        <div className="vg-muted" style={{ fontSize: 12 }}>Aucun commentaire.</div>
      ) : (
        <ol className="vg-thread">
          {comments.map((c) => (
            <li key={c.id} id={commentAnchor(c.id)} className={c.withdrawn ? 'is-withdrawn' : undefined}>
              <div className="vg-thread-meta">{commentMeta(c)}</div>
              {c.withdrawn ? (
                <p className="vg-thread-withdrawn">
                  <i className="ph ph-eye-slash" aria-hidden /> Commentaire retiré le {c.withdrawn.atLabel} par {c.withdrawn.by}{c.withdrawn.reason ? ` : ${c.withdrawn.reason}` : ''}
                </p>
              ) : (
                <p className="vg-thread-body">{c.body}</p>
              )}
              {c.files.length > 0 && (
                <ul className="vg-thread-files">
                  {c.files.map((f) => (
                    <li key={f.id}>
                      <a href={f.url} target="_blank" rel="noopener" className="vg-link"><i className={`ph ${fileIcon(f.mime)}`} aria-hidden /> {f.name}</a>
                      <span className="vg-muted"> · {fmtSize(f.size)}{f.commentWithdrawn ? ' · commentaire retiré' : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
              {writable && canWithdrawComment(rights, { authorId: c.authorId, withdrawn: !!c.withdrawn }, currentUserId) && (
                <ReasonButton action={withdrawActionComment} hidden={{ id: c.id }} label="Retirer" icon="ph-eye-slash" className="vg-text-btn"
                  title="Retirer le commentaire" kicker={actionId} submitLabel="Retirer le commentaire"
                  message={c.files.length
                    ? 'Le commentaire reste au fil sous la mention « Commentaire retiré », sans son texte. Ses preuves jointes ne seront plus visibles que du service QHSE, qui peut les retirer une à une.'
                    : 'Le commentaire reste au fil sous la mention « Commentaire retiré », sans son texte.'} />
              )}
            </li>
          ))}
        </ol>
      )}

      {writable && rights.canComment && (
        <ActionForm key={formKey} action={addActionComment} hidden={{ actionId }} encType="multipart/form-data" submitLabel="Publier" submitIcon="ph-paper-plane-tilt"
          onDone={() => { setFilesError(null); setFormKey((k) => k + 1); }}>
          {healthWarning && <div role="note" className="vg-warn-note"><i className="ph ph-first-aid" aria-hidden /><span>{AT_HEALTH_WARNING}</span></div>}
          <Field name="body" label="Ajouter un commentaire" hint={NO_HEALTH_REMINDER}>
            <TextArea name="body" rows={3} maxLength={ACTION_TEXT_MAX} required />
          </Field>
          {rights.canAttach && (
            <Field name="files" label="Preuves jointes" hint={filesError ? <span className="vg-warn-text">{filesError}</span> : 'Facultatif : photos, PV, attestations.'}>
              <input id="files" name="files" type="file" multiple accept={ATTACH_ACCEPT} className="input"
                onChange={(e) => setFilesError(pickedFilesError(Array.from(e.target.files ?? [])))} />
            </Field>
          )}
        </ActionForm>
      )}
    </section>
  );
}
