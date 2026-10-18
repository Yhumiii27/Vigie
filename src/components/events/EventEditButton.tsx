'use client';

import { useState, type ReactNode } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import type { Option } from '@/lib/data/options';
import {
  ENV_ASPECTS, ENV_MEDIA, EVENT_TYPES, EVENT_TYPE_KEYS, HEALTH_EVENT_TYPES, NC_DISPOSITIONS, NC_DISPOSITION_KEYS, NC_ORIGINS, QUALIFICATION_FIELDS, SEVERITY,
  type EventType, type QualificationField,
} from '@/lib/domain';
import type { FormState } from '@/lib/forms';
import { createEvent, saveEvent } from '@/server/events';
import { AccidentFields, requiredHint, type AccidentValues } from './AccidentFields';
import { MpFields, type MpValues } from './MpFields';
import { MP_TITLE, hasNcDisposition, hasNcOrigin, mentionsInjury } from './shared';

/** Champs modifiables d'un événement (données simples transmises par la page serveur ; `knownAt` à l'heure de Paris). */
export type EditableEvent = {
  id: string; siteId: string; type: string; title: string; occurredOn: string; occurredTime: string | null; location: string;
  equipment: string | null; keystoneProject: string | null; pilotId: string | null; severity: number;
  description: string; immediateMeasures: string; ncOrigin: string | null;
  customer: string | null; customerRef: string | null; envAspect: string | null; envMedium: string | null;
  controlId: number | null; riskId: number | null; documentId: string | null; preventionPlanId: string | null; permitId: string | null;
  ncDisposition?: string | null; ncQuantity?: number | null; ncCost?: number | null; ncDispositionNote?: string | null;
} & AccidentValues & MpValues;

/** Valeurs proposées à la création (site, lieu, plan ou permis d'origine, déclarant = utilisateur courant). */
export type EventDefaults = Partial<Omit<EditableEvent, 'id'>> & { declarantId?: string | null };

export type EventFieldOptions = {
  people: readonly Option[]; sites: readonly Option[]; projects: readonly Option[];
  controls: readonly Option[]; risks: readonly Option[]; documents: readonly Option[]; plans: readonly Option[]; permits: readonly Option[];
  /** Victime d'un AT (personnes de l'effectif, victime enregistrée comprise) ; par défaut `people`. */
  victims?: readonly Option[];
};

const TYPE_OPTIONS = EVENT_TYPE_KEYS.map((k) => [k, EVENT_TYPES[k].label] as const);
const SEVERITY_OPTIONS = [1, 2, 3, 4].map((g) => [String(g), SEVERITY[g]] as const);
const NC_OPTIONS = NC_ORIGINS.map((o) => [o, o] as const);
const ASPECT_OPTIONS = ENV_ASPECTS.map((o) => [o, o] as const);
const MEDIUM_OPTIONS = ENV_MEDIA.map((o) => [o, o] as const);
const DISPOSITION_OPTIONS = NC_DISPOSITION_KEYS.map((k) => [k, NC_DISPOSITIONS[k]] as const);

/** Traitement d'un produit non conforme (EVT-17, ISO 9001 §8.7) : décision, quantité, coût de non-qualité, dérogation. */
function NcDispositionFields({ e }: { e: EventDefaults }) {
  const [disposition, setDisposition] = useState(e.ncDisposition ?? '');
  const num = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));
  return (
    <>
      <h6 className="vg-h6" style={{ margin: '4px 0 -4px' }}>Traitement du produit non conforme</h6>
      <FormRow cols={3}>
        <Field name="ncDisposition" label="Décision">
          <Select name="ncDisposition" options={DISPOSITION_OPTIONS} value={disposition} onChange={(ev) => setDisposition(ev.target.value)} placeholder="À décider" />
        </Field>
        <Field name="ncQuantity" label="Quantité concernée" hint="Pièces, lots ou unités.">
          <Input name="ncQuantity" inputMode="decimal" defaultValue={num(e.ncQuantity)} />
        </Field>
        <Field name="ncCost" label="Coût de non-qualité (€ HT)" hint="Retouche, rebut, transport, temps passé.">
          <Input name="ncCost" inputMode="decimal" defaultValue={num(e.ncCost)} />
        </Field>
      </FormRow>
      <Field name="ncDispositionNote" label={disposition === 'derogation' ? 'Dérogation accordée par' : 'Précisions sur le traitement'}
        hint={disposition === 'derogation' ? 'Obligatoire : client ou donneur d’ordre, référence et conditions de la dérogation.' : undefined}>
        <Input name="ncDispositionNote" defaultValue={e.ncDispositionNote ?? ''} maxLength={500} />
      </Field>
    </>
  );
}

/**
 * Bouton « Modifier » de la fiche événement. `health` : rôle habilité aux données de santé d'un AT (SEC-06) ; sinon
 * la fiche n'en reçoit aucune et le formulaire ne les propose pas (les valeurs enregistrées sont conservées).
 * `benign` : AT inscrit au registre des accidents bénins (rôle habilité), basculé ou non en déclaration CPAM.
 */
export function EventEditButton({ event, options, health, benign }: { event: EditableEvent; options: EventFieldOptions; health: boolean; benign?: 'active' | 'escalated' | null }) {
  return (
    <DialogButton label="Modifier" title={`Modifier ${event.id}`} kicker="Signalements et événements" width={680}>
      {(close) => <EventFields mode="edit" event={event} options={options} health={health} benign={benign} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

type FieldsProps = {
  options: EventFieldOptions;
  /** Blessure, jours perdus, lésions, soins et déclaration CPAM saisissables (animateur QHSE, direction). */
  health: boolean;
  benign?: 'active' | 'escalated' | null;
  onDone: (state: FormState) => void;
  onCancel: () => void;
} & ({ mode: 'edit'; event: EditableEvent } | { mode: 'create'; event?: undefined; defaults?: EventDefaults; today: string });

/** Avertissement (non bloquant) : un intitulé ou une description d'AT qui semble décrire une lésion (SEC-06). */
function InjuryWarning({ text, health }: { text: string; health: boolean }) {
  if (!mentionsInjury(text)) return null;
  return (
    <span style={{ display: 'block', color: 'var(--tone-warn-fg)', textWrap: 'pretty' }}>
      <i className="ph ph-warning" style={{ fontSize: 12, marginRight: 4 }} aria-hidden />
      Ce texte semble décrire une lésion ou des soins : {health ? 'saisissez-les plutôt dans les champs réservés (nature et siège des lésions, soins).' : "l'animateur QHSE les saisit dans des champs réservés."}
    </span>
  );
}

/** Formulaire complet d'un événement : création depuis le bureau (createEvent) ou modification de la fiche (saveEvent). */
export function EventFields(props: FieldsProps) {
  const { mode, options, health, benign, onDone, onCancel } = props;
  const create = mode === 'create';
  const e: EventDefaults = props.mode === 'edit' ? props.event : { occurredOn: props.today, severity: 1, ...props.defaults };
  const [type, setType] = useState(e.type ?? '');
  const [title, setTitle] = useState(e.title ?? '');
  const [description, setDescription] = useState(e.description ?? '');
  const [declarantId, setDeclarantId] = useState(create ? (props.defaults?.declarantId ?? '') : '');
  const at = type === 'AT';
  const mp = type === 'MP';
  // Données exigées à la qualification pour le type choisi (EVT-05) : signalées dans l'aide du champ.
  const required = (k: QualificationField) => (QUALIFICATION_FIELDS[type as EventType] ?? []).includes(k);
  const hint = (k: QualificationField, base?: ReactNode) => (required(k) ? requiredHint(base) : base);
  const textHint = (text: string) => (at || mp ? <>Sans détail médical : visible de l&apos;encadrement et dans les échéances.<InjuryWarning text={text} health={health} /></> : undefined);
  // Un projet saisi avant la synchronisation Keystone reste proposé tel quel.
  // Origine NC : celle de la fiche tant que le type n'a pas changé ; sinon repartir de la valeur par défaut du nouveau type.
  const ncDefault = type === e.type && e.ncOrigin ? e.ncOrigin : type === 'RC' ? 'Réclamation client' : '';
  const projects = e.keystoneProject && !options.projects.some(([v]) => v === e.keystoneProject)
    ? [[e.keystoneProject, e.keystoneProject] as const, ...options.projects]
    : options.projects;
  const str = (v: string | number | null | undefined) => (v == null ? '' : String(v));
  // Rôle non habilité : un accident du travail enregistré garde son type (requalification par l'animateur QHSE ou la direction).
  // Maladie professionnelle (EVT-09) : proposée aux rôles habilités à la création seulement ; elle garde ensuite son type.
  const typeOptions = !health && !create && e.type === 'AT' ? TYPE_OPTIONS.filter(([k]) => k === 'AT')
    : !create && e.type === 'MP' ? TYPE_OPTIONS.filter(([k]) => k === 'MP')
      : TYPE_OPTIONS.filter(([k]) => (create && health) || !(HEALTH_EVENT_TYPES as readonly string[]).includes(k));

  return (
    <ActionForm action={create ? createEvent : saveEvent} onDone={onDone} onCancel={onCancel} hidden={props.mode === 'edit' ? { id: props.event.id } : undefined}
      submitLabel={create ? 'Créer l’événement' : 'Enregistrer'} submitIcon={create ? 'ph-plus' : undefined}>
      <FormRow cols={3}>
        <Field name="type" label="Type" hint={typeOptions.length === 1 ? "Requalification par l'animateur QHSE ou la direction." : undefined}>
          <Select name="type" options={typeOptions} value={type} onChange={(ev) => setType(ev.target.value)} placeholder={create ? 'Choisir…' : undefined} />
        </Field>
        <Field name="occurredOn" label="Date">
          <Input name="occurredOn" type="date" defaultValue={e.occurredOn} max={create ? props.today : undefined} />
        </Field>
        <Field name="occurredTime" label="Heure">
          <Input name="occurredTime" type="time" defaultValue={e.occurredTime ?? ''} />
        </Field>
      </FormRow>
      {mp ? (
        <Field name="title" label="Intitulé" hint="Imposé : ni la victime ni la maladie (l'intitulé paraît dans les actions liées).">
          <Input name="title" value={MP_TITLE} readOnly />
        </Field>
      ) : (
        <Field name="title" label="Intitulé" hint={textHint(title)}>
          <Input name="title" value={title} onChange={(ev) => setTitle(ev.target.value)} maxLength={200} autoFocus />
        </Field>
      )}
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
        <Field name="location" label="Lieu" hint={hint('location')}>
          <Input name="location" defaultValue={e.location} maxLength={120} placeholder="Atelier, poste, zone…" />
        </Field>
        <Field name="equipment" label={at ? 'Objet ou matériel en cause' : 'Équipement'}>
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
        <Field name="severity" label="Gravité potentielle" hint={hint('severity')}>
          <Select name="severity" options={SEVERITY_OPTIONS} defaultValue={str(e.severity)} />
        </Field>
      </FormRow>
      {hasNcOrigin(type) && (
        // Clé sur le type : le champ est recréé (et sa valeur par défaut réappliquée) à chaque changement NC ↔ RC.
        <Field key={type} name="ncOrigin" label="Origine de la non-conformité" hint={hint('ncOrigin')}>
          <Select name="ncOrigin" options={NC_OPTIONS} defaultValue={ncDefault} placeholder="Non précisée" />
        </Field>
      )}
      {type === 'RC' && (
        <FormRow>
          <Field name="customer" label="Client" hint={hint('customer')}>
            <Input name="customer" defaultValue={e.customer ?? ''} maxLength={120} />
          </Field>
          <Field name="customerRef" label="Référence client" hint={hint('customerRef', 'Commande, affaire ou livraison ; à défaut, le projet Keystone lié')}>
            <Input name="customerRef" defaultValue={e.customerRef ?? ''} maxLength={120} />
          </Field>
        </FormRow>
      )}
      {type === 'ENV' && (
        <FormRow>
          <Field name="envAspect" label="Aspect environnemental" hint={hint('envAspect')}>
            <Select name="envAspect" options={ASPECT_OPTIONS} defaultValue={e.envAspect ?? ''} placeholder="Choisir…" />
          </Field>
          <Field name="envMedium" label="Milieu concerné" hint={hint('envMedium')}>
            <Select name="envMedium" options={MEDIUM_OPTIONS} defaultValue={e.envMedium ?? ''} placeholder="Choisir…" />
          </Field>
        </FormRow>
      )}
      <Field name="description" label="Description" hint={textHint(description)}>
        <TextArea name="description" value={description} onChange={(ev) => setDescription(ev.target.value)} rows={3} maxLength={4000} />
      </Field>
      <Field name="immediateMeasures" label="Mesures immédiates">
        <TextArea name="immediateMeasures" defaultValue={e.immediateMeasures} rows={2} maxLength={4000} />
      </Field>
      {hasNcDisposition(type) && <NcDispositionFields key={type} e={e} />}
      {at && <AccidentFields event={e} people={options.victims ?? options.people} health={health} benign={benign} />}
      {mp && health && <MpFields event={e} people={options.victims ?? options.people} />}

      {!mp && <>
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
      </>}
    </ActionForm>
  );
}
