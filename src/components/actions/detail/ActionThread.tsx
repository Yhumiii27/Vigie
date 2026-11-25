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
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';
import { AT_HEALTH_WARNING, NO_HEALTH_REMINDER, commentAnchor, commentMeta, pickedFilesError } from './form-helpers';

export function ActionThread({ actionId, comments, rights, currentUserId, writable, healthWarning }: {
  actionId: string; comments: ActionCommentView[]; rights: ActionRights; currentUserId: string;
  /** Écriture admise ici (QHSE sur le site de l'action, responsable de tout site). */
  writable: boolean; healthWarning: boolean;
}) {
  const { t } = useI18n();
  const [filesError, setFilesError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  return (
    <section className="vg-action-block" aria-label={t('Comment thread')}>
      <h6 className="vg-h6">{t('Thread')}{comments.length > 0 && <span style={{ color: 'var(--vg-text-muted)' }}> · {comments.length}</span>}</h6>
      {comments.length === 0 ? (
        <div className="vg-muted" style={{ fontSize: 12 }}>{t('No comment.')}</div>
      ) : (
        <ol className="vg-thread">
          {comments.map((c) => (
            <li key={c.id} id={commentAnchor(c.id)} className={c.withdrawn ? 'is-withdrawn' : undefined}>
              <div className="vg-thread-meta">{commentMeta(c)}</div>
              {c.withdrawn ? (
                <p className="vg-thread-withdrawn">
                  <i className="ph ph-eye-slash" aria-hidden /> {fill(t('Comment withdrawn on {at} by {by}'), { at: c.withdrawn.atLabel, by: c.withdrawn.by })}{c.withdrawn.reason ? fill(t(': {impact}'), { impact: c.withdrawn.reason }) : ''}
                </p>
              ) : (
                <p className="vg-thread-body">{c.body}</p>
              )}
              {c.files.length > 0 && (
                <ul className="vg-thread-files">
                  {c.files.map((f) => (
                    <li key={f.id}>
                      <a href={f.url} target="_blank" rel="noopener" className="vg-link"><i className={`ph ${fileIcon(f.mime)}`} aria-hidden /> {f.name}</a>
                      <span className="vg-muted"> · {fmtSize(f.size)}{f.commentWithdrawn ? ` · ${t('comment withdrawn')}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
              {writable && canWithdrawComment(rights, { authorId: c.authorId, withdrawn: !!c.withdrawn }, currentUserId) && (
                <ReasonButton action={withdrawActionComment} hidden={{ id: c.id }} label={t('Withdraw')} icon="ph-eye-slash" className="vg-text-btn"
                  title={t('Withdraw the comment')} kicker={actionId} submitLabel={t('Withdraw the comment')}
                  message={c.files.length
                    ? t('The comment stays in the thread marked “Comment withdrawn”, without its text. Its attached evidence will then be visible only to the QHSE department, which can remove it one by one.')
                    : t('The comment stays in the thread marked “Comment withdrawn”, without its text.')} />
              )}
            </li>
          ))}
        </ol>
      )}

      {writable && rights.canComment && (
        <ActionForm key={formKey} action={addActionComment} hidden={{ actionId }} encType="multipart/form-data" submitLabel={t('Post')} submitIcon="ph-paper-plane-tilt"
          onDone={() => { setFilesError(null); setFormKey((k) => k + 1); }}>
          {healthWarning && <div role="note" className="vg-warn-note"><i className="ph ph-first-aid" aria-hidden /><span>{AT_HEALTH_WARNING}</span></div>}
          <Field name="body" label={t('Add a comment')} hint={NO_HEALTH_REMINDER}>
            <TextArea name="body" rows={3} maxLength={ACTION_TEXT_MAX} required />
          </Field>
          {rights.canAttach && (
            <Field name="files" label={t('Attached evidence')} hint={filesError ? <span className="vg-warn-text">{filesError}</span> : t('Optional: photos, reports, certificates.')}>
              <input id="files" name="files" type="file" multiple accept={ATTACH_ACCEPT} className="input"
                onChange={(e) => setFilesError(pickedFilesError(Array.from(e.target.files ?? [])))} />
            </Field>
          )}
        </ActionForm>
      )}
    </section>
  );
}
