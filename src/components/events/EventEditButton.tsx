'use client';

import { useState } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import type { Option } from '@/lib/data/options';
import { EVENT_TYPES, EVENT_TYPE_KEYS, NC_ORIGINS, SEVERITY } from '@/lib/domain';
import { saveEvent } from '@/server/events';
import { INJURIES, hasNcOrigin } from './shared';

/** Champs modifiables d'un événement (données simples transmises par la page serveur). */
export type EditableEvent = {
  id: string; siteId: string; type: string; title: string; occurredOn: string; location: string;
  equipment: string | null; keystoneProject: string | null; pilotId: string | null; severity: number;
  description: string; immediateMeasures: string; ncOrigin: string | null; injury: string | null; lostDays: number | null;
};

type Opts = { people: readonly Option[]; sites: readonly Option[]; projects: readonly Option[] };

const TYPE_OPTIONS = EVENT_TYPE_KEYS.map((k) => [k, EVENT_TYPES[k].label] as const);
const SEVERITY_OPTIONS = [1, 2, 3, 4].map((g) => [String(g), SEVERITY[g]] as const);
const NC_OPTIONS = NC_ORIGINS.map((o) => [o, o] as const);

/** Bouton « Modifier » de la fiche événement. */
export function EventEditButton({ event, options }: { event: EditableEvent; options: Opts }) {
  return (
    <DialogButton label="Modifier" title={`Modifier ${event.id}`} kicker="Signalements et événements" width={640}>
      {(close) => <EventFields event={event} options={options} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

function EventFields({ event, options, onDone, onCancel }: { event: EditableEvent; options: Opts; onDone: () => void; onCancel: () => void }) {
  const [type, setType] = useState(event.type);
  const [injury, setInjury] = useState(event.injury ?? '');
  // Un projet saisi avant la synchronisation Keystone reste proposé tel quel.
  // Origine NC : celle de la fiche tant que le type n'a pas changé ; sinon repartir de la valeur par défaut du nouveau type.
  const ncDefault = type === event.type && event.ncOrigin ? event.ncOrigin : type === 'RC' ? 'Réclamation client' : '';
  const projects = event.keystoneProject && !options.projects.some(([v]) => v === event.keystoneProject)
    ? [[event.keystoneProject, event.keystoneProject] as const, ...options.projects]
    : options.projects;

  return (
    <ActionForm action={saveEvent} onDone={onDone} onCancel={onCancel} hidden={{ id: event.id }}>
      <FormRow>
        <Field name="type" label="Type">
          <Select name="type" options={TYPE_OPTIONS} value={type} onChange={(e) => setType(e.target.value)} />
        </Field>
        <Field name="occurredOn" label="Date">
          <Input name="occurredOn" type="date" defaultValue={event.occurredOn} />
        </Field>
      </FormRow>
      <Field name="title" label="Intitulé">
        <Input name="title" defaultValue={event.title} maxLength={200} autoFocus />
      </Field>
      <FormRow>
        <Field name="location" label="Lieu">
          <Input name="location" defaultValue={event.location} maxLength={120} placeholder="Atelier, poste, zone…" />
        </Field>
        <Field name="equipment" label="Équipement">
          <Input name="equipment" defaultValue={event.equipment ?? ''} maxLength={120} placeholder="Machine, outillage, lot…" />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="keystoneProject" label="Projet Keystone lié">
          <Select name="keystoneProject" options={projects} defaultValue={event.keystoneProject ?? ''} placeholder="Aucun projet" />
        </Field>
        <Field name="siteId" label="Site">
          <Select name="siteId" options={options.sites} defaultValue={event.siteId} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="pilotId" label="Pilote">
          <Select name="pilotId" options={options.people} defaultValue={event.pilotId ?? ''} placeholder="À désigner" />
        </Field>
        <Field name="severity" label="Gravité potentielle">
          <Select name="severity" options={SEVERITY_OPTIONS} defaultValue={String(event.severity)} />
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
            <Select name="injury" options={INJURIES} value={injury} onChange={(e) => setInjury(e.target.value)} placeholder="Non précisée" />
          </Field>
          <Field name="lostDays" label="Jours perdus" hint={injury === 'arret' ? "Jours calendaires d'arrêt (taux de gravité)." : 'Uniquement pour un accident avec arrêt.'}>
            <Input name="lostDays" type="number" min={0} step={1} inputMode="numeric" defaultValue={event.lostDays ?? ''} disabled={injury !== 'arret'} />
          </Field>
        </FormRow>
      )}
      <Field name="description" label="Description">
        <TextArea name="description" defaultValue={event.description} rows={3} maxLength={4000} />
      </Field>
      <Field name="immediateMeasures" label="Mesures immédiates">
        <TextArea name="immediateMeasures" defaultValue={event.immediateMeasures} rows={2} maxLength={4000} />
      </Field>
    </ActionForm>
  );
}
