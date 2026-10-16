'use client';

// Fenêtre « Changer l'avancement » de la fiche (moveAction, § 6.2) : paliers libres, Reportée, reprise, Terminée, retour
// d'une Terminée vers une valeur ouverte. Vérifier, rouvrir et abandonner ont leurs propres fenêtres.

import { useState } from 'react';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { moveTargets } from '@/lib/action-rules';
import type { ActionDetailView } from '@/lib/action-view';
import { ACTION_TEXT_MAX, AVANCEMENT, type Avancement } from '@/lib/domain';
import type { FormState } from '@/lib/forms';
import { moveAction } from '@/server/plan-ui';
import { defaultMoveTarget, moveFields } from './form-helpers';

export function MoveForm({ detail, from, today, verifyDefault, onDone, onCancel }: {
  detail: ActionDetailView; from: Avancement; today: string; verifyDefault: string; onDone: (s: FormState) => void; onCancel: () => void;
}) {
  const [to, setTo] = useState<Avancement | ''>(defaultMoveTarget(from));
  const f = moveFields(from, to, detail);
  const targets = moveTargets(from).map((s) => [s, AVANCEMENT[s].label] as const);
  return (
    <ActionForm action={moveAction} hidden={{ id: detail.id, from }} submitLabel="Enregistrer l’avancement" submitIcon="ph-arrows-clockwise"
      onDone={onDone} onCancel={onCancel}>
      <Field name="to" label="Nouvel avancement" hint={`Actuel : ${AVANCEMENT[from].label}.`}>
        <Select name="to" options={targets} value={to} placeholder="Choisir…" required autoFocus onChange={(e) => setTo(e.target.value as Avancement | '')} />
      </Field>
      {f.notice && <p className="vg-step-note">{f.notice}</p>}
      {(f.doneOn || f.verifyDueOn || f.dueOn) && (
        <FormRow>
          {f.doneOn && (
            <Field name="doneOn" label="Date effective" hint="Entre la date d’ouverture et aujourd’hui.">
              <Input name="doneOn" type="date" defaultValue={today} min={detail.openedOn} max={today} required />
            </Field>
          )}
          {f.verifyDueOn && (
            <Field name="verifyDueOn" label="Vérification planifiée" hint="L’action n’en avait pas.">
              <Input name="verifyDueOn" type="date" defaultValue={verifyDefault} min={today} required />
            </Field>
          )}
          {f.dueOn && (
            <Field name="dueOn" label="Date cible" hint="Revoyez-la si elle est passée (journalisée).">
              <Input name="dueOn" type="date" defaultValue={detail.dueOn} min={today} />
            </Field>
          )}
        </FormRow>
      )}
      <Field name="comment" label="Commentaire" hint={f.kind === 'report' ? 'Facultatif : motif du report, ajouté au fil.' : 'Facultatif : ajouté au fil de commentaires.'}>
        <TextArea name="comment" rows={2} maxLength={ACTION_TEXT_MAX} />
      </Field>
    </ActionForm>
  );
}
