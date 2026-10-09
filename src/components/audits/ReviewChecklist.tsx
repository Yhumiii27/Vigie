'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { Dialog } from '@/components/Dialog';
import { ActionForm, Checkbox, Field, Input } from '@/components/form';
import { Aside, CardHead, Icon } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import type { ReviewItem } from '@/lib/data/audits';
import { deleteReviewItem, saveReviewItem, setReviewDate, setReviewItemDone } from '@/server/audits';
import { DeleteButton, DialogFooter } from './parts';
import styles from './audits.module.css';

type Editing = { kind: 'item'; id: number | null } | { kind: 'date' } | null;

/** Check-list de préparation de la revue de direction et accès au dossier imprimable. */
export function ReviewChecklist({ reviewOn, items, canManage, ownerSuggestions }: { reviewOn: string | null; items: ReviewItem[]; canManage: boolean; ownerSuggestions: string[] }) {
  const [list, setDone] = useOptimistic(items, (state, { id, done }: { id: number; done: boolean }) => state.map((r) => (r.id === id ? { ...r, done } : r)));
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const close = () => setEditing(null);
  const done = list.filter((r) => r.done).length;
  const item = editing?.kind === 'item' && editing.id != null ? items.find((r) => r.id === editing.id) : undefined;

  const toggle = (r: ReviewItem) => start(async () => {
    setError(null);
    setDone({ id: r.id, done: !r.done });
    const res = await setReviewItemDone(r.id, !r.done);
    if (res.error) setError(res.error);
  });

  return (
    <div className="card" style={{ gap: 8 }}>
      <CardHead title="Préparation de la revue de direction"
        aside={reviewOn ? <Aside>{fmtDate(reviewOn)} · {done}/{list.length} éléments fournis</Aside> : <Aside>Date à fixer</Aside>} />
      {list.map((r) => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 0', fontSize: 12.5 }}>
          {canManage ? (
            <button type="button" className={styles.check} aria-pressed={r.done} aria-label={r.label} title={r.done ? 'Marquer comme non fourni' : 'Marquer comme fourni'} onClick={() => toggle(r)}>
              <Icon name={r.done ? 'ph-check-circle' : 'ph-circle'} size={15} style={{ color: r.done ? TONE.ok.dot : 'var(--color-neutral-600)' }} />
            </button>
          ) : (
            <Icon name={r.done ? 'ph-check-circle' : 'ph-circle'} size={15} style={{ color: r.done ? TONE.ok.dot : 'var(--color-neutral-600)' }} />
          )}
          {canManage ? (
            <button type="button" className={styles.textBtn} title="Modifier l'élément" onClick={() => setEditing({ kind: 'item', id: r.id })}
              style={{ flex: 1, color: r.done ? 'var(--color-neutral-400)' : 'var(--color-text)' }}>{r.label}</button>
          ) : (
            <span style={{ flex: 1, color: r.done ? 'var(--color-neutral-400)' : 'var(--color-text)' }}>{r.label}</span>
          )}
          <span style={{ fontSize: 11, color: 'var(--color-neutral-500)', whiteSpace: 'nowrap' }}>{r.owner}</span>
        </div>
      ))}
      {!list.length && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', padding: '4px 0' }}>Aucun élément à préparer pour l&apos;instant.</div>}
      {error && <div role="alert" style={{ fontSize: 11.5, color: 'var(--tone-danger-fg)' }}>{error}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <a href="/revue-de-direction" target="_blank" rel="noopener" className="btn btn-primary vg-btn-sm">
          <i className="ph ph-file-text" style={{ fontSize: 13 }} />Générer le dossier de revue
        </a>
        {canManage && (
          <>
            <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setEditing({ kind: 'item', id: null })}>
              <i className="ph ph-plus" style={{ fontSize: 13 }} />Ajouter un élément
            </button>
            {reviewOn && (
              <button type="button" className="btn btn-ghost vg-btn-sm" onClick={() => setEditing({ kind: 'date' })}>
                <i className="ph ph-calendar-blank" style={{ fontSize: 13 }} />Date de la revue
              </button>
            )}
          </>
        )}
      </div>

      <Dialog open={!!editing} onClose={close} kicker={reviewOn ? `Revue de direction du ${fmtDate(reviewOn)}` : 'Revue de direction'} width={500}
        title={editing?.kind === 'date' ? 'Date de la revue' : item ? "Modifier l'élément" : 'Nouvel élément à préparer'}>
        {editing?.kind === 'date' && reviewOn && (
          <ActionForm action={setReviewDate} onDone={close} onCancel={close} hidden={{ from: reviewOn }} submitLabel="Reporter la revue">
            <Field name="to" label="Nouvelle date" hint="La check-list et l'échéance de la revue au programme annuel sont reportées à cette date.">
              <Input name="to" type="date" defaultValue={reviewOn} autoFocus />
            </Field>
          </ActionForm>
        )}
        {editing?.kind === 'item' && (
          <>
            <ActionForm action={saveReviewItem} onDone={close} onCancel={close} submitLabel={item ? 'Enregistrer' : 'Ajouter'}
              hidden={{ id: item?.id, reviewOn: item ? undefined : reviewOn }}>
              <Field name="label" label="Élément d'entrée de la revue" hint="Ex. Performance des fournisseurs, Résultats des audits internes.">
                <Input name="label" defaultValue={item?.label} autoFocus />
              </Field>
              <Field name="owner" label="Fourni par" hint="Contributeur et date attendue (ex. [L. Moreau] · 20/11), ou « Vigie · automatique ».">
                <Input name="owner" list="vg-review-owners" defaultValue={item?.owner} />
              </Field>
              <datalist id="vg-review-owners">
                {ownerSuggestions.map((o) => <option key={o} value={o} />)}
              </datalist>
              {!item && !reviewOn && (
                <Field name="reviewOn" label="Date de la revue">
                  <Input name="reviewOn" type="date" />
                </Field>
              )}
              {!item && <Checkbox name="done" label="Déjà fourni" />}
            </ActionForm>
            {item && (
              <DialogFooter>
                <DeleteButton run={() => deleteReviewItem(item.id)} onDone={close} />
              </DialogFooter>
            )}
          </>
        )}
      </Dialog>
    </div>
  );
}
