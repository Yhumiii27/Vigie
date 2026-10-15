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

const RESULTS = [['efficace', 'Efficace'], ['non_efficace', 'Non efficace']] as const;

export function VerifyForm({ detail, from, options, today, verifyDefault, onDone, onCancel }: {
  /** Avancement affiché à l'ouverture (Terminée) : un avancement changé entre-temps fait refuser la vérification. */
  detail: ActionDetailView; from: Avancement; options: ActionFormOptions; today: string; verifyDefault: string; onDone: (s: FormState) => void; onCancel: () => void;
}) {
  const [closedOn, setClosedOn] = useState(today);
  const [note, setNote] = useState('');
  const [result, setResult] = useState('');
  const [newRisk, setNewRisk] = useState(false);
  const minClosed = detail.doneOn ?? detail.openedOn;
  return (
    <ActionForm action={verifyAction} hidden={{ id: detail.id, from }} submitLabel="Enregistrer la vérification" submitIcon="ph-seal-check"
      onDone={onDone} onCancel={onCancel}>
      <FormRow>
        <Field name="closedOn" label="Date de vérification" hint="Date de clôture de l’action.">
          <Input name="closedOn" type="date" value={closedOn} min={minClosed} max={today} required onChange={(e) => setClosedOn(e.target.value)} />
        </Field>
        <Field name="verifyMethod" label="Nature de la vérification">
          <Select name="verifyMethod" options={VERIFY_METHOD_OPTIONS} defaultValue="" placeholder="Choisir…" required autoFocus />
        </Field>
      </FormRow>
      <Field name="efficacyNote" label="Constat de vérification" hint="Ce qui a été vérifié, comment et avec quel résultat.">
        <TextArea name="efficacyNote" rows={3} maxLength={ACTION_TEXT_MAX} required value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <FormRow>
        <Field name="effective" label="Résultat">
          <Radios name="effective" options={RESULTS} value={result} onChange={setResult} />
        </Field>
        <Field name="hours" label="Pointage (h)" hint="Temps réellement passé ; corrigeable ensuite.">
          <Input name="hours" type="number" inputMode="decimal" step="0.01" min="0" defaultValue={numberField(detail.hours)} />
        </Field>
      </FormRow>
      <Field name="newRisk" label="Remarque du QHSE">
        <Checkbox name="newRisk" label="Nouveau risque généré" checked={newRisk} onChange={setNewRisk} />
      </Field>

      {(result === 'non_efficace' || newRisk) && (
        <p className="vg-step-note">
          Source, élément lié et référence d’origine de {detail.id} sont repris par l’action de suite ; la vérification et la suite sont
          enregistrées ensemble.
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
  const p = FOLLOW_UP_PREFIX[reason];
  const prefill = followUpPrefill(detail, reason, { closedOn, note, people: options.people, sites: options.sites });
  // Problème pré-rempli suivi tant qu'il n'a pas été retouché (constat saisi après l'ouverture de la section).
  const [problem, setProblem] = useState<string | null>(null);
  const n = (name: string) => `${p}${name}`;
  return (
    <fieldset className="vg-fieldset">
      <legend>Nouvelle action ({FOLLOW_REASONS[reason].toLowerCase()})</legend>
      <Field name={n('problem')} label={reason === 'nouveau_risque' ? 'Description du risque' : 'Description du problème'}>
        <TextArea name={n('problem')} rows={2} maxLength={ACTION_TEXT_MAX} required value={problem ?? prefill.problem}
          onChange={(e) => setProblem(e.target.value)} />
      </Field>
      <Field name={n('detail')} label="Détail de l’action">
        <TextArea name={n('detail')} rows={3} maxLength={ACTION_TEXT_MAX} required />
      </Field>
      <FormRow>
        <Field name={n('pilotId')} label="Responsable">
          <Select name={n('pilotId')} options={options.people} defaultValue={prefill.pilotId} placeholder="Choisir…" required />
        </Field>
        <Field name={n('priority')} label="Priorité">
          <Select name={n('priority')} options={PRIORITY_OPTIONS} defaultValue={prefill.priority} placeholder="Choisir…" required />
        </Field>
      </FormRow>
      <FormRow>
        <Field name={n('dueOn')} label="Date cible">
          <Input name={n('dueOn')} type="date" min={today} required />
        </Field>
        <Field name={n('verifyDueOn')} label="Vérification planifiée">
          <Input name={n('verifyDueOn')} type="date" min={today} defaultValue={verifyDefault} required />
        </Field>
      </FormRow>
      <FormRow>
        <Field name={n('domain')} label="Domaine">
          <Select name={n('domain')} options={DOMAIN_OPTIONS} defaultValue={prefill.domain} placeholder="Choisir…" required />
        </Field>
        <Field name={n('riskLevel')} label="Niveau de risque">
          <Select name={n('riskLevel')} options={RISK_LEVEL_OPTIONS} defaultValue={prefill.riskLevel} placeholder="—" />
        </Field>
      </FormRow>
      <Field name={n('siteId')} label="Site" hint="Celui de l’élément lié quand il en a un.">
        <Select name={n('siteId')} options={options.sites} defaultValue={prefill.siteId} placeholder="Choisir…" required />
      </Field>
    </fieldset>
  );
}
