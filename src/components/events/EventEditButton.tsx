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
import { MP_TITLE, hasNcDisposition, hasNcOrigin, mentionsInjury } from '@/lib/rules/events';
import { withCurrent } from '@/lib/form-options';
import { useI18n } from '@/i18n/client';
import { fill, type T } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';

/** Champs modifiables d'un événement (données simples transmises par la page serveur ; `knownAt` à l'heure de Paris). */
export type EditableEvent = {
  id: string; siteId: string; type: string; title: string; occurredOn: string; occurredTime: string | null; location: string;
  equipment: string | null;
  /** Projet Keystone : code (keystone.pub_projets, D02) et libellé affiché (« code · client », ou ancien libellé saisi). */
  keystoneProjectCode: string | null; keystoneProject: string | null; pilotId: string | null; severity: number;
  description: string; immediateMeasures: string; ncOrigin: string | null;
  customer: string | null; customerRef: string | null; envAspect: string | null; envMedium: string | null;
  controlId: number | null; riskId: number | null; documentId: string | null; preventionPlanId: string | null; permitId: string | null;
  /** Zone de la carte du site (EVT-19). */
  zoneId?: number | null;
  /** Version de la fiche à son ouverture (QUA-12) : une fiche modifiée entre-temps n'est pas écrasée. */
  version?: string;
  ncDisposition?: string | null; ncQuantity?: number | null; ncCostKeur?: number | null; ncDispositionNote?: string | null;
} & AccidentValues & MpValues;

/** Valeurs proposées à la création (site, lieu, plan ou permis d'origine, déclarant = utilisateur courant). */
export type EventDefaults = Partial<Omit<EditableEvent, 'id'>> & { declarantId?: string | null };

export type EventFieldOptions = {
  people: readonly Option[]; sites: readonly Option[]; projects: readonly Option[];
  /** Projets de Keystone indisponibles (D02) : message sous le choix. */
  projectsMessage?: string | null;
  controls: readonly Option[]; risks: readonly Option[]; documents: readonly Option[]; plans: readonly Option[]; permits: readonly Option[];
  /** Victime d'un AT (personnes de l'effectif, victime enregistrée comprise) ; par défaut `people`. */
  victims?: readonly Option[];
  /** Zones de la carte des sites (EVT-19), filtrées sur le site choisi ; zone archivée de l'événement comprise à la modification. */
  zones?: readonly ZoneOption[];
};
export type ZoneOption = { id: number; name: string; siteId: string };

const TYPE_OPTIONS = (t: T) => EVENT_TYPE_KEYS.map((k) => [k, labelT(t)(EVENT_TYPES[k].label)] as const);
const SEVERITY_OPTIONS = [1, 2, 3, 4].map((g) => [String(g), SEVERITY[g]] as const);
const NC_OPTIONS = NC_ORIGINS.map((o) => [o, o] as const);
const ASPECT_OPTIONS = ENV_ASPECTS.map((o) => [o, o] as const);
const MEDIUM_OPTIONS = ENV_MEDIA.map((o) => [o, o] as const);
const DISPOSITION_OPTIONS = NC_DISPOSITION_KEYS.map((k) => [k, NC_DISPOSITIONS[k]] as const);

/** Traitement d'un produit non conforme (EVT-17, ISO 9001 §8.7) : décision, quantité, coût de non-qualité, dérogation. */
function NcDispositionFields({ e }: { e: EventDefaults }) {
  const { t } = useI18n();
  const [disposition, setDisposition] = useState(e.ncDisposition ?? '');
  const num = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));
  return (
    <>
      <h6 className="vg-h6" style={{ margin: '4px 0 -4px' }}>{t('Disposition of the nonconforming product')}</h6>
      <FormRow cols={3}>
        <Field name="ncDisposition" label={t('Decision')}>
          <Select name="ncDisposition" options={DISPOSITION_OPTIONS} value={disposition} onChange={(ev) => setDisposition(ev.target.value)} placeholder={t('To be decided')} />
        </Field>
        <Field name="ncQuantity" label={t('Quantity concerned')} hint={t('Parts, batches or units.')}>
          <Input name="ncQuantity" inputMode="decimal" defaultValue={num(e.ncQuantity)} />
        </Field>
        <Field name="ncCostKeur" label={t('Cost of non-quality (k€ excl. VAT)')} hint={t('Rework, scrap, transport, time spent; 1.45 for €1,450.')}>
          <Input name="ncCostKeur" inputMode="decimal" defaultValue={num(e.ncCostKeur)} />
        </Field>
      </FormRow>
      <Field name="ncDispositionNote" label={disposition === 'derogation' ? t('Concession granted by') : t('Disposition details')}
        hint={disposition === 'derogation' ? t('Required: customer or principal, reference and conditions of the concession.') : undefined}>
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
  const { t } = useI18n();
  return (
    <DialogButton label={t('Edit')} title={fill(t('Edit {id}'), { id: event.id })} kicker={t('Reports and events')} width={680}>
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
  const { t } = useI18n();
  if (!mentionsInjury(text)) return null;
  return (
    <span style={{ display: 'block', color: 'var(--tone-warn-fg)', textWrap: 'pretty' }}>
      <i className="ph ph-warning" style={{ fontSize: 12, marginRight: 4 }} aria-hidden />
      {t('This text seems to describe a lesion or care: ')}{health ? t('enter them instead in the restricted fields (nature and site of lesions, care).') : t('the QHSE coordinator enters them in restricted fields.')}
    </span>
  );
}

/** Formulaire complet d'un événement : création depuis le bureau (createEvent) ou modification de la fiche (saveEvent). */
export function EventFields(props: FieldsProps) {
  const { mode, options, health, benign, onDone, onCancel } = props;
  const { t } = useI18n();
  const create = mode === 'create';
  const e: EventDefaults = props.mode === 'edit' ? props.event : { occurredOn: props.today, severity: 1, ...props.defaults };
  const [type, setType] = useState(e.type ?? '');
  const [title, setTitle] = useState(e.title ?? '');
  const [description, setDescription] = useState(e.description ?? '');
  const [declarantId, setDeclarantId] = useState(create ? (props.defaults?.declarantId ?? '') : '');
  // EVT-19 : zone de la carte du site choisi ; le lieu en texte reprend son nom s'il est vide.
  const [siteId, setSiteId] = useState(e.siteId ?? '');
  const [zoneId, setZoneId] = useState(e.zoneId == null ? '' : String(e.zoneId));
  const [location, setLocation] = useState(e.location ?? '');
  const siteZones = (options.zones ?? []).filter((z) => z.siteId === siteId);
  const zoneChoices = siteZones.map((z) => [String(z.id), z.name] as const);
  const pickZone = (value: string) => {
    setZoneId(value);
    const z = siteZones.find((x) => String(x.id) === value);
    if (z && !location.trim()) setLocation(z.name.replace(/ \((archivée|archived)\)$/, ''));
  };
  const at = type === 'AT';
  const mp = type === 'MP';
  // Données exigées à la qualification pour le type choisi (EVT-05) : signalées dans l'aide du champ.
  const required = (k: QualificationField) => (QUALIFICATION_FIELDS[type as EventType] ?? []).includes(k);
  const hint = (k: QualificationField, base?: ReactNode) => (required(k) ? requiredHint(t, base) : base);
  const textHint = (text: string) => (at || mp ? <>{t('No medical detail: visible to management and in the deadlines.')}<InjuryWarning text={text} health={health} /></> : undefined);
  // Projet de la fiche absent de keystone.pub_projets (ou source indisponible) : reste proposé tel quel (code et libellé).
  // Origine NC : celle de la fiche tant que le type n'a pas changé ; sinon repartir de la valeur par défaut du nouveau type.
  const ncDefault = type === e.type && e.ncOrigin ? e.ncOrigin : type === 'RC' ? 'Réclamation client' : '';
  const projects = withCurrent(options.projects, e.keystoneProjectCode, e.keystoneProject, 'start');
  const str = (v: string | number | null | undefined) => (v == null ? '' : String(v));
  // Rôle non habilité : un accident du travail enregistré garde son type (requalification par l'animateur QHSE ou la direction).
  // Maladie professionnelle (EVT-09) : proposée aux rôles habilités à la création seulement ; elle garde ensuite son type.
  const typeOptions = !health && !create && e.type === 'AT' ? TYPE_OPTIONS(t).filter(([k]) => k === 'AT')
    : !create && e.type === 'MP' ? TYPE_OPTIONS(t).filter(([k]) => k === 'MP')
      : TYPE_OPTIONS(t).filter(([k]) => (create && health) || !(HEALTH_EVENT_TYPES as readonly string[]).includes(k));

  return (
    <ActionForm action={create ? createEvent : saveEvent} onDone={onDone} onCancel={onCancel} hidden={props.mode === 'edit' ? { id: props.event.id, version: props.event.version } : undefined}
      submitLabel={create ? t('Create the event') : t('Save')} submitIcon={create ? 'ph-plus' : undefined}>
      <FormRow cols={3}>
        <Field name="type" label={t('Type')} hint={typeOptions.length === 1 ? t('Requalification by the QHSE coordinator or senior management.') : undefined}>
          <Select name="type" options={typeOptions} value={type} onChange={(ev) => setType(ev.target.value)} placeholder={create ? t('Choose…') : undefined} />
        </Field>
        <Field name="occurredOn" label={t('Date')}>
          <Input name="occurredOn" type="date" defaultValue={e.occurredOn} max={create ? props.today : undefined} />
        </Field>
        <Field name="occurredTime" label={t('Time')}>
          <Input name="occurredTime" type="time" defaultValue={e.occurredTime ?? ''} />
        </Field>
      </FormRow>
      {mp ? (
        <Field name="title" label={t('Title')} hint={t('Imposed: neither the victim nor the disease (the title appears in the linked actions).')}>
          <Input name="title" value={MP_TITLE} readOnly />
        </Field>
      ) : (
        <Field name="title" label={t('Title')} hint={textHint(title)}>
          <Input name="title" value={title} onChange={(ev) => setTitle(ev.target.value)} maxLength={200} autoFocus />
        </Field>
      )}
      {create && (
        <FormRow>
          <Field name="declarantId" label={t('Reporter')}>
            <Select name="declarantId" options={options.people} value={declarantId} onChange={(ev) => setDeclarantId(ev.target.value)} placeholder={t('External')} />
          </Field>
          {!declarantId && (
            <Field name="declarant" label={t('External reporter (customer, supplier…)')}>
              <Input name="declarant" maxLength={120} placeholder={t('Name, company')} />
            </Field>
          )}
        </FormRow>
      )}
      <FormRow>
        <Field name="siteId" label={t('Site')}>
          <Select name="siteId" options={options.sites} value={siteId}
            onChange={(ev) => { setSiteId(ev.target.value); if (!(options.zones ?? []).some((z) => String(z.id) === zoneId && z.siteId === ev.target.value)) setZoneId(''); }} />
        </Field>
        {!mp && (
          <Field name="zoneId" label={t('Map zone')} hint={siteZones.length ? t('Zone of the site plan (station QR code); optional.') : t('No zone drawn on this site’s map.')}>
            <Select name="zoneId" options={zoneChoices} value={zoneId} onChange={(ev) => pickZone(ev.target.value)} placeholder={t('No zone')} />
          </Field>
        )}
      </FormRow>
      <FormRow>
        <Field name="location" label={t('Location')} hint={hint('location', zoneId ? t('Left empty: the zone’s name.') : undefined)}>
          <Input name="location" value={location} onChange={(ev) => setLocation(ev.target.value)} maxLength={120} placeholder={t('Workshop, station, zone…')} />
        </Field>
        <Field name="equipment" label={at ? t('Object or equipment involved') : t('Equipment')}>
          <Input name="equipment" defaultValue={e.equipment ?? ''} maxLength={120} placeholder={t('Machine, tooling, batch…')} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="keystoneProjectCode" label={t('Linked Keystone project')}
          hint={options.projectsMessage ?? (e.keystoneProject && !e.keystoneProjectCode ? fill(t('Former label: {label}'), { label: e.keystoneProject }) : undefined)}>
          <Select name="keystoneProjectCode" options={projects} defaultValue={e.keystoneProjectCode ?? ''} placeholder={t('No project')} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="pilotId" label={t('Lead')} hint={t('Required to move to the “Qualified” stage.')}>
          <Select name="pilotId" options={options.people} defaultValue={e.pilotId ?? ''} placeholder={t('To be designated')} />
        </Field>
        <Field name="severity" label={t('Potential severity')} hint={hint('severity')}>
          <Select name="severity" options={SEVERITY_OPTIONS} defaultValue={str(e.severity)} />
        </Field>
      </FormRow>
      {hasNcOrigin(type) && (
        // Clé sur le type : le champ est recréé (et sa valeur par défaut réappliquée) à chaque changement NC ↔ RC.
        <Field key={type} name="ncOrigin" label={t('Origin of the nonconformity')} hint={hint('ncOrigin')}>
          <Select name="ncOrigin" options={NC_OPTIONS} defaultValue={ncDefault} placeholder={t('Not specified')} />
        </Field>
      )}
      {type === 'RC' && (
        <FormRow>
          <Field name="customer" label={t('Customer')} hint={hint('customer')}>
            <Input name="customer" defaultValue={e.customer ?? ''} maxLength={120} />
          </Field>
          <Field name="customerRef" label={t('Customer reference')} hint={hint('customerRef', t('Order, deal or delivery; failing that, the linked Keystone project'))}>
            <Input name="customerRef" defaultValue={e.customerRef ?? ''} maxLength={120} />
          </Field>
        </FormRow>
      )}
      {type === 'ENV' && (
        <FormRow>
          <Field name="envAspect" label={t('Environmental aspect')} hint={hint('envAspect')}>
            <Select name="envAspect" options={ASPECT_OPTIONS} defaultValue={e.envAspect ?? ''} placeholder={t('Choose…')} />
          </Field>
          <Field name="envMedium" label={t('Medium concerned')} hint={hint('envMedium')}>
            <Select name="envMedium" options={MEDIUM_OPTIONS} defaultValue={e.envMedium ?? ''} placeholder={t('Choose…')} />
          </Field>
        </FormRow>
      )}
      <Field name="description" label={t('Description')} hint={textHint(description)}>
        <TextArea name="description" value={description} onChange={(ev) => setDescription(ev.target.value)} rows={3} maxLength={4000} />
      </Field>
      <Field name="immediateMeasures" label={t('Immediate measures')}>
        <TextArea name="immediateMeasures" defaultValue={e.immediateMeasures} rows={2} maxLength={4000} />
      </Field>
      {hasNcDisposition(type) && <NcDispositionFields key={type} e={e} />}
      {at && <AccidentFields event={e} people={options.victims ?? options.people} health={health} benign={benign} />}
      {mp && health && <MpFields event={e} people={options.victims ?? options.people} />}

      {!mp && <>
      <h6 className="vg-h6" style={{ margin: '4px 0 -4px' }}>{t('Links')}</h6>
      <FormRow>
        <Field name="controlId" label={t('Inspected equipment (periodic inspection)')}>
          <Select name="controlId" options={options.controls} defaultValue={str(e.controlId)} placeholder={t('None')} />
        </Field>
        <Field name="riskId" label={t('DUER risk')}>
          <Select name="riskId" options={options.risks} defaultValue={str(e.riskId)} placeholder={t('None')} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="documentId" label={t('Document concerned')}>
          <Select name="documentId" options={options.documents} defaultValue={e.documentId ?? ''} placeholder={t('None')} />
        </Field>
        <Field name="preventionPlanId" label={t('Prevention plan')}>
          <Select name="preventionPlanId" options={options.plans} defaultValue={e.preventionPlanId ?? ''} placeholder={t('None')} />
        </Field>
      </FormRow>
      <Field name="permitId" label={t('Permit')} hint={t('The permit’s prevention plan is used if it is not entered.')}>
        <Select name="permitId" options={options.permits} defaultValue={e.permitId ?? ''} placeholder={t('None')} />
      </Field>
      </>}
    </ActionForm>
  );
}
