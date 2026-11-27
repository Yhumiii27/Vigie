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
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';

export function MoveForm({ detail, from, today, verifyDefault, onDone, onCancel }: {
  detail: ActionDetailView; from: Avancement; today: string; verifyDefault: string; onDone: (s: FormState) => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const [to, setTo] = useState<Avancement | ''>(defaultMoveTarget(from));
  const f = moveFields(from, to, detail);
  const targets = moveTargets(from).map((s) => [s, labelT(t)(AVANCEMENT[s].label)] as const);
  return (
    <ActionForm action={moveAction} hidden={{ id: detail.id, from }} submitLabel={t('Save the progress')} submitIcon="ph-arrows-clockwise"
      onDone={onDone} onCancel={onCancel}>
      <Field name="to" label={t('New progress')} hint={fill(t('Current: {status}.'), { status: labelT(t)(AVANCEMENT[from].label) })}>
        <Select name="to" options={targets} value={to} placeholder={t('Choose…')} required autoFocus onChange={(e) => setTo(e.target.value as Avancement | '')} />
      </Field>
      {f.notice && <p className="vg-step-note">{f.notice}</p>}
      {(f.doneOn || f.verifyDueOn || f.dueOn) && (
        <FormRow>
          {f.doneOn && (
            <Field name="doneOn" label={t('Actual date')} hint={t('Between the opening date and today.')}>
              <Input name="doneOn" type="date" defaultValue={today} min={detail.openedOn} max={today} required />
            </Field>
          )}
          {f.verifyDueOn && (
            <Field name="verifyDueOn" label={t('Planned verification')} hint={t('The action had none.')}>
              <Input name="verifyDueOn" type="date" defaultValue={verifyDefault} min={today} required />
            </Field>
          )}
          {f.dueOn && (
            <Field name="dueOn" label={t('Target date')} hint={t('Review it if it has passed (logged).')}>
              <Input name="dueOn" type="date" defaultValue={detail.dueOn} min={today} />
            </Field>
          )}
        </FormRow>
      )}
      <Field name="comment" label={t('Comment')} hint={f.kind === 'report' ? t('Optional: reason for postponing, added to the thread.') : t('Optional: added to the comment thread.')}>
        <TextArea name="comment" rows={2} maxLength={ACTION_TEXT_MAX} />
      </Field>
    </ActionForm>
  );
}
