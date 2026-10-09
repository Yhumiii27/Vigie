'use client';

import { useState } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input } from '@/components/form';
import type { TrainingTitle } from '@/lib/data/skills';
import { saveTitle } from '@/server/skills';

function TitleForm({ title, onDone }: { title?: TrainingTitle; onDone: () => void }) {
  return (
    <ActionForm action={saveTitle} onDone={onDone} onCancel={onDone} submitLabel={title ? 'Enregistrer' : 'Ajouter le titre'} hidden={{ id: title?.id }}>
      <FormRow>
        <Field name="label" label="Intitulé">
          <Input name="label" defaultValue={title?.label} placeholder="Ex. Habilitation soudure" maxLength={60} autoFocus />
        </Field>
        <Field name="validityMonths" label="Validité (mois)" hint="0 = sans échéance">
          <Input name="validityMonths" type="number" inputMode="numeric" min={0} max={240} step={1} defaultValue={title?.validityMonths ?? 36} />
        </Field>
      </FormRow>
    </ActionForm>
  );
}

/** Liste des titres suivis dans la matrice, avec leur durée de validité. */
function TitlesManager({ titles, canManage }: { titles: TrainingTitle[]; canManage: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const close = () => setEditing(null);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <table className="table" style={{ fontSize: 12.5 }}>
        <thead>
          <tr><th>Titre</th><th style={{ textAlign: 'right' }}>Validité</th>{canManage && <th aria-label="Actions" />}</tr>
        </thead>
        <tbody>
          {titles.map((t) => editing === t.id ? (
            <tr key={t.id}><td colSpan={3} style={{ padding: '10px 4px' }}><TitleForm title={t} onDone={close} /></td></tr>
          ) : (
            <tr key={t.id}>
              <td>{t.label}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--color-neutral-400)' }}>{t.validityMonths ? `${t.validityMonths} mois` : 'Sans échéance'}</td>
              {canManage && (
                <td style={{ textAlign: 'right', width: 1 }}>
                  <button type="button" className="vg-text-btn" disabled={editing !== null} onClick={() => setEditing(t.id)}>Modifier</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {canManage && (editing === 'new' ? (
        <div className="vg-inset" style={{ padding: 12 }}><TitleForm onDone={close} /></div>
      ) : (
        <button type="button" className="btn btn-secondary vg-btn-sm" style={{ justifySelf: 'start' }} disabled={editing !== null} onClick={() => setEditing('new')}>
          <i className="ph ph-plus" style={{ fontSize: 13 }} />Ajouter un titre
        </button>
      ))}
      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
        La validité sert à calculer l&apos;échéance des formations enregistrées ensuite ; les échéances déjà saisies ne sont pas recalculées.
      </p>
    </div>
  );
}

/** Bouton « Titres suivis » ouvrant la liste des titres. */
export function TitlesButton({ titles, canManage }: { titles: TrainingTitle[]; canManage: boolean }) {
  return (
    <DialogButton label="Titres suivis" icon="ph-list-checks" title="Titres suivis" kicker="Habilitations et formations" width={500}>
      {() => <TitlesManager titles={titles} canManage={canManage} />}
    </DialogButton>
  );
}
