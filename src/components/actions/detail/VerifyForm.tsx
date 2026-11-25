'use client';

// Fenêtre « Vérifier l'efficacité » (verifyAction, § 7, ACT-23) : une seule <form>, champs des actions de suite préfixés
// ne_ (non efficace) et nr_ (nouveau risque), sans ActionFields imbriqué (identifiants de champs en double). Source,
// élément lié et référence d'origine des suites sont repris de l'action vérifiée par le serveur, jamais lus du formulaire.

import { useState } from 'react';
import { ActionForm, Checkbox, Field, FormRow, Input, Radios, Select, TextArea } from '@/components/form';
import type { ActionDetailView, ActionFormOptions } from '@/lib/action-view';
import { ACTION_TEXT_MAX, FOLLOW_REASONS, type Avancement, type FollowReason } from '@/lib/domain';
import type { FormState } from '@/lib/forms';
import { verifyAction } from '@/server/plan-ui';
import {
  DOMAIN_OPTIONS, FOLLOW_UP_PREFIX, PRIORITY_OPTIONS, RISK_LEVEL_OPTIONS, VERIFY_METHOD_OPTIONS, followUpPrefill, numberField,
} from './form-helpers';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

export function VerifyForm({ detail, from, options, today, verifyDefault, onDone, onCancel }: {
  /** Avancement affiché à l'ouverture (Terminée) : un avancement changé entre-temps fait refuser la vérification. */
  detail: ActionDetailView; from: Avancement; options: ActionFormOptions; today: string; verifyDefault: string; onDone: (s: FormState) => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const RESULTS = [['efficace', t('Effective')], ['non_efficace', t('Not effective')]] as const;
  const [closedOn, setClosedOn] = useState(today);
  const [note, setNote] = useState('');
  const [result, setResult] = useState('');
  const [newRisk, setNewRisk] = useState(false);
  const minClosed = detail.doneOn ?? detail.openedOn;
  return (
    <ActionForm action={verifyAction} hidden={{ id: detail.id, from }} submitLabel={t('Save the verification')} submitIcon="ph-seal-check"
      onDone={onDone} onCancel={onCancel}>
      <FormRow>
        <Field name="closedOn" label={t('Verification date')} hint={t('Closure date of the action.')}>
          <Input name="closedOn" type="date" value={closedOn} min={minClosed} max={today} required onChange={(e) => setClosedOn(e.target.value)} />
        </Field>
        <Field name="verifyMethod" label={t('Nature of the verification')}>
          <Select name="verifyMethod" options={VERIFY_METHOD_OPTIONS} defaultValue="" placeholder={t('Choose…')} required autoFocus />
        </Field>
      </FormRow>
      <Field name="efficacyNote" label={t('Verification finding')} hint={t('What was verified, how and with what result.')}>
        <TextArea name="efficacyNote" rows={3} maxLength={ACTION_TEXT_MAX} required value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <FormRow>
        <Field name="effective" label={t('Result')}>
          <Radios name="effective" options={RESULTS} value={result} onChange={setResult} />
        </Field>
        <Field name="hours" label={t('Time logged (h)')} hint={t('Time actually spent; can be corrected later.')}>
          <Input name="hours" type="number" inputMode="decimal" step="0.01" min="0" defaultValue={numberField(detail.hours)} />
        </Field>
      </FormRow>
      <Field name="newRisk" label={t('QHSE remark')}>
        <Checkbox name="newRisk" label={t('New risk generated')} checked={newRisk} onChange={setNewRisk} />
      </Field>

      {(result === 'non_efficace' || newRisk) && (
        <p className="vg-step-note">
          {fill(t('Source, linked item and origin reference of {id} are taken over by the follow-up action; the verification and the follow-up are saved together.'), { id: detail.id })}
        </p>
      )}
      {result === 'non_efficace' && (
        <FollowUpSection reason="non_efficace" detail={detail} options={options} today={today} verifyDefault={verifyDefault} closedOn={closedOn} note={note} />
      )}
      {newRisk && (
        <FollowUpSection reason="nouveau_risque" detail={detail} options={options} today={today} verifyDefault={verifyDefault} closedOn={closedOn} note={note} />
      )}
    </ActionForm>
  );
}

/** Section « Nouvelle action (non efficace | nouveau risque) », pré-remplie d'après l'action vérifiée. */
function FollowUpSection({ reason, detail, options, today, verifyDefault, closedOn, note }: {
  reason: FollowReason; detail: ActionDetailView; options: ActionFormOptions; today: string; verifyDefault: string; closedOn: string; note: string;
}) {
  const { t } = useI18n();
  const p = FOLLOW_UP_PREFIX[reason];
  const prefill = followUpPrefill(detail, reason, { closedOn, note, people: options.people, sites: options.sites });
  // Problème pré-rempli suivi tant qu'il n'a pas été retouché (constat saisi après l'ouverture de la section).
  const [problem, setProblem] = useState<string | null>(null);
  const n = (name: string) => `${p}${name}`;
  return (
    <fieldset className="vg-fieldset">
      <legend>{fill(t('New action ({reason})'), { reason: FOLLOW_REASONS[reason].toLowerCase() })}</legend>
      <Field name={n('problem')} label={reason === 'nouveau_risque' ? t('Description of the risk') : t('Description of the problem')}>
        <TextArea name={n('problem')} rows={2} maxLength={ACTION_TEXT_MAX} required value={problem ?? prefill.problem}
          onChange={(e) => setProblem(e.target.value)} />
      </Field>
      <Field name={n('detail')} label={t('Detail of the action')}>
        <TextArea name={n('detail')} rows={3} maxLength={ACTION_TEXT_MAX} required />
      </Field>
      <FormRow>
        <Field name={n('pilotId')} label={t('Owner')}>
          <Select name={n('pilotId')} options={options.people} defaultValue={prefill.pilotId} placeholder={t('Choose…')} required />
        </Field>
        <Field name={n('priority')} label={t('Priority')}>
          <Select name={n('priority')} options={PRIORITY_OPTIONS} defaultValue={prefill.priority} placeholder={t('Choose…')} required />
        </Field>
      </FormRow>
      <FormRow>
        <Field name={n('dueOn')} label={t('Target date')}>
          <Input name={n('dueOn')} type="date" min={today} required />
        </Field>
        <Field name={n('verifyDueOn')} label={t('Planned verification')}>
          <Input name={n('verifyDueOn')} type="date" min={today} defaultValue={verifyDefault} required />
        </Field>
      </FormRow>
      <FormRow>
        <Field name={n('domain')} label={t('Domain')}>
          <Select name={n('domain')} options={DOMAIN_OPTIONS} defaultValue={prefill.domain} placeholder={t('Choose…')} required />
        </Field>
        <Field name={n('riskLevel')} label={t('Risk level')}>
          <Select name={n('riskLevel')} options={RISK_LEVEL_OPTIONS} defaultValue={prefill.riskLevel} placeholder="—" />
        </Field>
      </FormRow>
      <Field name={n('siteId')} label={t('Site')} hint={t('That of the linked item when it has one.')}>
        <Select name={n('siteId')} options={options.sites} defaultValue={prefill.siteId} placeholder={t('Choose…')} required />
      </Field>
    </fieldset>
  );
}
