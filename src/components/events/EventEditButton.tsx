'use client';

import { useState } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import type { Option } from '@/lib/data/options';
import { EVENT_TYPES, EVENT_TYPE_KEYS, NC_ORIGINS, SEVERITY } from '@/lib/domain';
import type { FormState } from '@/lib/forms';
import { createEvent, saveEvent } from '@/server/events';
import { INJURIES, hasNcOrigin, needsCpam } from './shared';

/** Champs modifiables d'un événement (données simples transmises par la page serveur). */
export type EditableEvent = {
  id: string; siteId: string; type: string; title: string; occurredOn: string; location: string;
  equipment: string | null; keystoneProject: string | null; pilotId: string | null; severity: number;
  description: string; immediateMeasures: string; ncOrigin: string | null; injury: string | null; lostDays: number | null;
  cpamDeclaredOn: string | null; controlId: number | null; riskId: number | null; documentId: string | null;
  preventionPlanId: string | null; permitId: string | null;
};

/** Valeurs proposées à la création (site, lieu, plan ou permis d'origine, déclarant = utilisateur courant). */
export type EventDefaults = Partial<Omit<EditableEvent, 'id'>> & { declarantId?: string | null };

export type EventFieldOptions = {
  people: readonly Option[]; sites: readonly Option[]; projects: readonly Option[];
  controls: readonly Option[]; risks: readonly Option[]; documents: readonly Option[]; plans: readonly Option[]; permits: readonly Option[];
};

const TYPE_OPTIONS = EVENT_TYPE_KEYS.map((k) => [k, EVENT_TYPES[k].label] as const);
const SEVERITY_OPTIONS = [1, 2, 3, 4].map((g) => [String(g), SEVERITY[g]] as const);
const NC_OPTIONS = NC_ORIGINS.map((o) => [o, o] as const);

/** Bouton « Modifier » de la fiche événement. */
export function EventEditButton({ event, options }: { event: EditableEvent; options: EventFieldOptions }) {
  return (
    <DialogButton label="Modifier" title={`Modifier ${event.id}`} kicker="Signalements et événements" width={680}>
      {(close) => <EventFields mode="edit" event={event} options={options} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

type FieldsProps = {
  options: EventFieldOptions;
  onDone: (state: FormState) => void;
  onCancel: () => void;
} & ({ mode: 'edit'; event: EditableEvent } | { mode: 'create'; event?: undefined; defaults?: EventDefaults; today: string });

/** Formulaire complet d'un événement : création depuis le bureau (createEvent) ou modification de la fiche (saveEvent). */
export function EventFields(props: FieldsProps) {
  const { mode, options, onDone, onCancel } = props;
  const create = mode === 'create';
  const e: EventDefaults = props.mode === 'edit' ? props.event : { occurredOn: props.today, severity: 1, ...props.defaults };
  const [type, setType] = useState(e.type ?? '');
  const [injury, setInjury] = useState(e.injury ?? '');
  const [declarantId, setDeclarantId] = useState(create ? (props.defaults?.declarantId ?? '') : '');
  // Un projet saisi avant la synchronisation Keystone reste proposé tel quel.
  // Origine NC : celle de la fiche tant que le type n'a pas changé ; sinon repartir de la valeur par défaut du nouveau type.
  const ncDefault = type === e.type && e.ncOrigin ? e.ncOrigin : type === 'RC' ? 'Réclamation client' : '';
  const projects = e.keystoneProject && !options.projects.some(([v]) => v === e.keystoneProject)
    ? [[e.keystoneProject, e.keystoneProject] as const, ...options.projects]
    : options.projects;
  const str = (v: string | number | null | undefined) => (v == null ? '' : String(v));

  return (
    <ActionForm action={create ? createEvent : saveEvent} onDone={onDone} onCancel={onCancel} hidden={props.mode === 'edit' ? { id: props.event.id } : undefined}
      submitLabel={create ? 'Créer l’événement' : 'Enregistrer'} submitIcon={create ? 'ph-plus' : undefined}>
      <FormRow>
        <Field name="type" label="Type">
          <Select name="type" options={TYPE_OPTIONS} value={type} onChange={(ev) => setType(ev.target.value)} placeholder={create ? 'Choisir…' : undefined} />
        </Field>
        <Field name="occurredOn" label="Date">
          <Input name="occurredOn" type="date" defaultValue={e.occurredOn} max={create ? props.today : undefined} />
        </Field>
      </FormRow>
      <Field name="title" label="Intitulé">
        <Input name="title" defaultValue={e.title} maxLength={200} autoFocus />
      </Field>
      {create && (
        <FormRow>
          <Field name="declarantId" label="Déclarant">
            <Select name="declarantId" options={options.people} value={declarantId} onChange={(ev) => setDeclarantId(ev.target.value)} placeholder="Externe" />
          </Field>
          {!declarantId && (
            <Field name="declarant" label="Déclarant externe (client, fournisseur…)">
              <Input name="declarant" maxLength={120} placeholder="Nom, société" />
            </Field>
          )}
        </FormRow>
      )}
      <FormRow>
        <Field name="location" label="Lieu">
          <Input name="location" defaultValue={e.location} maxLength={120} placeholder="Atelier, poste, zone…" />
        </Field>
        <Field name="equipment" label="Équipement">
          <Input name="equipment" defaultValue={e.equipment ?? ''} maxLength={120} placeholder="Machine, outillage, lot…" />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="keystoneProject" label="Projet Keystone lié">
          <Select name="keystoneProject" options={projects} defaultValue={e.keystoneProject ?? ''} placeholder="Aucun projet" />
        </Field>
        <Field name="siteId" label="Site">
          <Select name="siteId" options={options.sites} defaultValue={e.siteId} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="pilotId" label="Pilote" hint="Obligatoire pour passer à l'étape « Qualifié ».">
          <Select name="pilotId" options={options.people} defaultValue={e.pilotId ?? ''} placeholder="À désigner" />
        </Field>
        <Field name="severity" label="Gravité potentielle">
          <Select name="severity" options={SEVERITY_OPTIONS} defaultValue={str(e.severity)} />
        </Field>
      </FormRow>
      {hasNcOrigin(type) && (
        // Clé sur le type : le champ est recréé (et sa valeur par défaut réappliquée) à chaque changement NC ↔ RC.
        <Field key={type} name="ncOrigin" label="Origine de la non-conformité">
          <Select name="ncOrigin" options={NC_OPTIONS} defaultValue={ncDefault} placeholder="Non précisée" />
        </Field>
      )}
      {type === 'AT' && (
        <FormRow>
          <Field name="injury" label="Blessure">
            <Select name="injury" options={INJURIES} value={injury} onChange={(ev) => setInjury(ev.target.value)} placeholder="Non précisée" />
          </Field>
          <Field name="lostDays" label="Jours perdus" hint={injury === 'arret' ? "Jours calendaires d'arrêt (taux de gravité)." : 'Uniquement pour un accident avec arrêt.'}>
            <Input name="lostDays" type="number" min={0} step={1} inputMode="numeric" defaultValue={e.lostDays ?? ''} disabled={injury !== 'arret'} />
          </Field>
        </FormRow>
      )}
      {needsCpam({ type, injury: injury || null }) && (
        <Field name="cpamDeclaredOn" label="Déclaration CPAM" hint="Date d'envoi de la déclaration d'accident du travail (sous 48 h). Vide : à déclarer.">
          <Input name="cpamDeclaredOn" type="date" defaultValue={e.cpamDeclaredOn ?? ''} />
        </Field>
      )}
      <Field name="description" label="Description">
        <TextArea name="description" defaultValue={e.description} rows={3} maxLength={4000} />
      </Field>
      <Field name="immediateMeasures" label="Mesures immédiates">
        <TextArea name="immediateMeasures" defaultValue={e.immediateMeasures} rows={2} maxLength={4000} />
      </Field>

      <h6 className="vg-h6" style={{ margin: '4px 0 -4px' }}>Rattachements</h6>
      <FormRow>
        <Field name="controlId" label="Équipement contrôlé (contrôle périodique)">
          <Select name="controlId" options={options.controls} defaultValue={str(e.controlId)} placeholder="Aucun" />
        </Field>
        <Field name="riskId" label="Risque du DUER">
          <Select name="riskId" options={options.risks} defaultValue={str(e.riskId)} placeholder="Aucun" />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="documentId" label="Document concerné">
          <Select name="documentId" options={options.documents} defaultValue={e.documentId ?? ''} placeholder="Aucun" />
        </Field>
        <Field name="preventionPlanId" label="Plan de prévention">
          <Select name="preventionPlanId" options={options.plans} defaultValue={e.preventionPlanId ?? ''} placeholder="Aucun" />
        </Field>
      </FormRow>
      <Field name="permitId" label="Permis" hint="Le plan de prévention du permis est repris s'il n'est pas renseigné.">
        <Select name="permitId" options={options.permits} defaultValue={e.permitId ?? ''} placeholder="Aucun" />
      </Field>
    </ActionForm>
  );
}
