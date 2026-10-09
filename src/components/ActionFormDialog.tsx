'use client';

import type { CSSProperties } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import type { FormOptions } from '@/lib/data/options';
import { saveAction } from '@/server/plan';

export type ActionDefaults = {
  id?: string;
  title?: string;
  description?: string | null;
  origin?: string;
  originRef?: string;
  eventId?: string | null;
  siteId?: string | null;
  pilotId?: string;
  dueOn?: string;
  kind?: 'C' | 'P';
  verifyDueOn?: string | null;
  /** Rattachement à créer (voir saveAction) : risk:12, finding:3, qualification:tnguyen:hauteur… */
  link?: string;
  /** Origine imposée par l'écran appelant (masque le choix). */
  lockOrigin?: boolean;
};

type Opts = Pick<FormOptions, 'people' | 'origins' | 'sites'>;

/** Formulaire de création / modification d'une action du plan d'actions unique. */
export function ActionFields({ options, defaults = {}, onDone, onCancel }: { options: Opts; defaults?: ActionDefaults; onDone: () => void; onCancel?: () => void }) {
  const editing = !!defaults.id;
  return (
    <ActionForm action={saveAction} onDone={onDone} onCancel={onCancel} submitLabel={editing ? 'Enregistrer' : "Créer l'action"}
      hidden={{ id: defaults.id, eventId: defaults.eventId, link: defaults.link, ...(defaults.lockOrigin ? { origin: defaults.origin, originRef: defaults.originRef } : {}) }}>
      <Field name="title" label="Action">
        <Input name="title" defaultValue={defaults.title} placeholder="Verbe d'action + objet (ex. Remplacer les élingues textiles…)" autoFocus />
      </Field>
      <Field name="description" label="Précisions" hint="Facultatif : périmètre, moyens, livrable attendu.">
        <TextArea name="description" defaultValue={defaults.description ?? ''} rows={2} />
      </Field>
      {!defaults.lockOrigin && (
        <FormRow>
          <Field name="origin" label="Origine">
            <Select name="origin" options={options.origins} defaultValue={defaults.origin ?? 'ev'} />
          </Field>
          <Field name="originRef" label="Référence d'origine" hint={defaults.eventId ? undefined : 'Ex. EV-2026-131, Audit interne juin 2026'}>
            <Input name="originRef" defaultValue={defaults.originRef} />
          </Field>
        </FormRow>
      )}
      <FormRow>
        <Field name="pilotId" label="Pilote">
          <Select name="pilotId" options={options.people} defaultValue={defaults.pilotId} placeholder="Choisir…" />
        </Field>
        <Field name="dueOn" label="Échéance">
          <Input name="dueOn" type="date" defaultValue={defaults.dueOn} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="kind" label="Nature">
          <Select name="kind" options={[['C', 'Corrective'], ['P', 'Préventive']]} defaultValue={defaults.kind ?? 'C'} />
        </Field>
        <Field name="siteId" label="Site">
          <Select name="siteId" options={options.sites} defaultValue={defaults.siteId ?? ''} placeholder="Tous les sites" />
        </Field>
      </FormRow>
      {editing && (
        <Field name="verifyDueOn" label="Vérification d'efficacité prévue le">
          <Input name="verifyDueOn" type="date" defaultValue={defaults.verifyDueOn ?? ''} />
        </Field>
      )}
    </ActionForm>
  );
}

/** Bouton « Nouvelle action » (ou libellé personnalisé) ouvrant le formulaire. */
export function NewActionButton({ options, defaults, label = 'Nouvelle action', className = 'btn btn-primary vg-btn-sm', icon = 'ph-plus', style, disabled, tooltip }: {
  options: Opts; defaults?: ActionDefaults; label?: string; className?: string; icon?: string; style?: CSSProperties; disabled?: boolean; tooltip?: string;
}) {
  return (
    <DialogButton label={label} icon={icon} className={className} style={style} disabled={disabled} tooltip={tooltip}
      title={defaults?.id ? `Modifier ${defaults.id}` : 'Nouvelle action'} kicker="Plan d'actions unique" width={560}>
      {(close) => <ActionFields options={options} defaults={defaults} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}
