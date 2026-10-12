'use client';

import { useState, type CSSProperties } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import type { FormOptions } from '@/lib/data/options';
import { ALL_SITES, EVENT_ORIGINS } from '@/lib/domain';
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
  /** Nom du pilote (modification) : conservé comme choix s'il a quitté l'effectif. */
  pilotName?: string;
  dueOn?: string;
  kind?: 'C' | 'P';
  verifyDueOn?: string | null;
  /**
   * Rattachement à créer (voir saveAction) : risk:12, finding:3, qualification:tnguyen:hauteur… ; source d'origine
   * preventionplan:PP-2026-012, permit:…, document:…, wastestream:…, wasteentry:<id> (à défaut, déduite de originRef).
   */
  link?: string;
  /** Origine imposée par l'écran appelant (masque le choix). */
  lockOrigin?: boolean;
};

type Opts = Pick<FormOptions, 'people' | 'origins' | 'sites'> & Partial<Pick<FormOptions, 'events' | 'allSites'>>;

/**
 * Formulaire de création / modification d'une action du plan d'actions unique.
 * Origine Événement ou Client (et liste `options.events` fournie) : sélecteur « Événement lié », qui rattache
 * réellement l'action à l'événement (fiche événement, blocage de l'étape Actions).
 * Modification : origine et référence affichées sans être modifiables (fixées à la création avec la source, ACT-01).
 */
export function ActionFields({ options, defaults = {}, onDone, onCancel }: { options: Opts; defaults?: ActionDefaults; onDone: () => void; onCancel?: () => void }) {
  const editing = !!defaults.id;
  const [origin, setOrigin] = useState(defaults.origin ?? 'ev');
  const [eventId, setEventId] = useState(defaults.eventId ?? '');
  const pickEvent = !defaults.lockOrigin && !!options.events && EVENT_ORIGINS.includes(origin);
  // Événement déjà lié mais absent de la liste (clôturé, classé sans suite) : conservé comme choix.
  const events = options.events && defaults.eventId && !options.events.some(([v]) => v === defaults.eventId)
    ? [[defaults.eventId, defaults.eventId] as const, ...options.events]
    : options.events ?? [];
  // Site archivé encore porté par l'action modifiée : conservé comme choix (la modification envoie toujours une valeur).
  const sites = defaults.siteId && !options.sites.some(([v]) => v === defaults.siteId)
    ? [...options.sites, [defaults.siteId, defaults.siteId] as const]
    : options.sites;
  // Pilote sorti de l'effectif encore porté par l'action modifiée : conservé comme choix, signalé pour être remplacé.
  const people = editing && defaults.pilotId && !options.people.some(([v]) => v === defaults.pilotId)
    ? [...options.people, [defaults.pilotId, `${defaults.pilotName ?? defaults.pilotId} — a quitté l'effectif`] as const]
    : options.people;
  const originLabel = options.origins.find(([k]) => k === defaults.origin)?.[1] ?? defaults.origin ?? '';
  return (
    <ActionForm action={saveAction} onDone={onDone} onCancel={onCancel} submitLabel={editing ? 'Enregistrer' : "Créer l'action"}
      hidden={{
        id: defaults.id, link: editing ? undefined : defaults.link,
        ...(defaults.lockOrigin ? { ...(editing ? {} : { origin: defaults.origin, originRef: defaults.originRef }), eventId: defaults.eventId } : {}),
      }}>
      <Field name="title" label="Action">
        <Input name="title" defaultValue={defaults.title} placeholder="Verbe d'action + objet (ex. Remplacer les élingues textiles…)" autoFocus />
      </Field>
      <Field name="description" label="Précisions" hint="Facultatif : périmètre, moyens, livrable attendu.">
        <TextArea name="description" defaultValue={defaults.description ?? ''} rows={2} />
      </Field>
      {editing && !defaults.lockOrigin && (
        <Field name="origin" label="Origine" hint="Fixée à la création de l'action, avec sa source : elle ne se modifie pas.">
          <input id="origin" className="input" readOnly tabIndex={-1} style={{ color: 'var(--color-neutral-400)', cursor: 'default' }}
            value={[originLabel, defaults.originRef].filter(Boolean).join(' · ')} />
        </Field>
      )}
      {!editing && !defaults.lockOrigin && (
        <FormRow>
          <Field name="origin" label="Origine">
            <Select name="origin" options={options.origins} defaultValue={defaults.origin ?? 'ev'} onChange={(e) => setOrigin(e.target.value)} />
          </Field>
          <Field name="originRef" label="Référence d'origine"
            hint={pickEvent && eventId ? "Par défaut : référence de l'événement" : 'Ex. EV-2026-131, Audit interne juin 2026'}>
            <Input name="originRef" defaultValue={defaults.originRef} />
          </Field>
        </FormRow>
      )}
      {pickEvent && (
        <Field name="eventId" label="Événement lié" hint="L'action apparaîtra dans la fiche de l'événement.">
          <Select name="eventId" options={events} defaultValue={defaults.eventId ?? ''} placeholder="Aucun" onChange={(e) => setEventId(e.target.value)} />
        </Field>
      )}
      <FormRow>
        <Field name="pilotId" label="Pilote">
          <Select name="pilotId" options={people} defaultValue={defaults.pilotId} placeholder="Choisir…" />
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
          {/* '' = site sélectionné ; ALL_SITES = action valable pour tous les sites. */}
          {/* « Tous les sites » : périmètre complet seulement (options.allSites), ou valeur actuelle de l'action modifiée. */}
          <Select name="siteId" options={[...(options.allSites !== false || (editing && defaults.siteId === null) ? [[ALL_SITES, 'Tous les sites'] as const] : []), ...sites]}
            placeholder="Site sélectionné" defaultValue={defaults.siteId === null ? ALL_SITES : defaults.siteId ?? ''} />
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
