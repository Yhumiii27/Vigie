'use client';

import { useState } from 'react';
import { ReasonButton } from '@/components/ReasonDialog';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { ActionForm, Checkbox, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { addMonths, fmtDate } from '@/lib/dates';
import { REASON_MAX } from '@/lib/domain';
import type { Option } from '@/lib/data/options';
import type { Person } from '@/lib/queries';
import { reinstatePerson, savePerson, setPersonLeft } from '@/server/skills';

type Props = {
  person?: Person;
  /** QUA-12 : version de la fiche à son ouverture (modification). */
  version?: string;
  /** Sites actifs (seuls proposés pour un nouveau salarié ou un changement de site). */
  sites: readonly Option[];
  /** Sites archivés : le site actuel d'un salarié qui y est encore rattaché reste proposé (pas de changement implicite). */
  archivedSites: readonly Option[];
  /** Services déjà renseignés (suggestions). */
  services: readonly string[];
  /** Site proposé pour un nouveau salarié (site sélectionné, ou le premier site). */
  defaultSiteId: string;
  /** Date de référence (serveur). */
  today: string;
  onDone: () => void;
  onCancel?: () => void;
};

const note = (icon: string, text: string) => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--color-neutral-500)' }}>
    <i className={`ph ${icon}`} style={{ fontSize: 14, marginTop: 1 }} aria-hidden />
    <span style={{ textWrap: 'pretty' }}>{text}</span>
  </div>
);

/** « Sortie de l'effectif » : déclaration (date + motif) ou, pour une sortie à venir, annulation. */
function LeaveSection({ person, today, onDone }: { person: Person; today: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'grid', gap: 10, borderTop: '1px solid var(--color-divider)', paddingTop: 14 }}>
      <h6 className="vg-h6">Sortie de l&apos;effectif</h6>
      {person.leftOn ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
          <span>Sortie prévue le {fmtDate(person.leftOn)}{person.leftReason ? ` · ${person.leftReason}` : ''}</span>
          <ReasonButton action={reinstatePerson} hidden={{ id: person.id }} label="Annuler la sortie" className="vg-text-btn" title="Annuler la sortie"
            kicker={person.name} submitLabel="Annuler la sortie" message="Le salarié reste dans la matrice, les échéances et les listes ; l’annulation est inscrite à son historique."
            placeholder="Ex. contrat prolongé" onDone={onDone} />
        </div>
      ) : open ? (
        <ActionForm action={setPersonLeft} hidden={{ id: person.id }} onDone={onDone} onCancel={() => setOpen(false)} submitLabel="Déclarer la sortie" submitIcon="ph-sign-out">
          <FormRow>
            <Field name="leftOn" label="Date de sortie">
              <Input name="leftOn" type="date" min={addMonths(today, -12)} defaultValue={today} required />
            </Field>
            <Field name="leftReason" label="Motif" hint="Obligatoire · ex. fin de contrat, mutation.">
              <TextArea name="leftReason" rows={1} maxLength={REASON_MAX} required placeholder="Ex. fin de contrat" />
            </Field>
          </FormRow>
          {note('ph-info', "Le salarié quitte la matrice, les échéances et les listes à cette date ; ses formations restent consultables (filtre « Sortis »).")}
        </ActionForm>
      ) : (
        <button type="button" className="btn btn-secondary vg-btn-sm" style={{ justifySelf: 'start' }} onClick={() => setOpen(true)}>
          <i className="ph ph-sign-out" style={{ fontSize: 13 }} aria-hidden />Déclarer la sortie
        </button>
      )}
      {note('ph-plugs-connected', 'Saisie provisoire, le connecteur Cursus reprendra la date de sortie.')}
    </div>
  );
}

/** Fiche salarié (saisie provisoire : Cursus deviendra la source de vérité des données personnelles). */
export function PersonForm({ person, version, sites, archivedSites, services, defaultSiteId, today, onDone, onCancel }: Props) {
  const siteId = person ? person.siteId ?? '' : defaultSiteId;
  const current = siteId && !sites.some(([v]) => v === siteId) ? archivedSites.find(([v]) => v === siteId) ?? ([siteId, siteId] as const) : null;
  const siteOptions = current ? [...sites, current] : sites;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <ActionForm action={savePerson} onDone={onDone} onCancel={onCancel} submitLabel={person ? 'Enregistrer' : 'Ajouter le salarié'} hidden={{ id: person?.id, version: person ? version : undefined }}>
        <FormRow>
          <Field name="name" label="Nom">
            <Input name="name" defaultValue={person?.name} placeholder="Ex. [J. Dupont]" maxLength={80} autoFocus />
          </Field>
          <Field name="job" label="Poste">
            <Input name="job" defaultValue={person?.job} placeholder="Ex. Monteur · atelier montage" maxLength={80} />
          </Field>
        </FormRow>
        <FormRow>
          <Field name="service" label="Service">
            <Input name="service" list="vg-person-services" defaultValue={person?.service} placeholder="Ex. Atelier montage" maxLength={60} />
            <datalist id="vg-person-services">{services.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
          <Field name="siteId" label="Site de rattachement">
            <Select name="siteId" options={siteOptions} defaultValue={siteId} placeholder={siteId ? undefined : 'Choisir un site'} />
          </Field>
        </FormRow>
        <FormRow>
          <Field name="email" label="E-mail professionnel" hint="Rapproche la fiche du compte Microsoft à la première connexion.">
            <Input name="email" type="email" defaultValue={person?.email ?? ''} placeholder="Ex. j.dupont@epc2i.fr" maxLength={254} autoComplete="off" />
          </Field>
          <Field name="matricule" label="Matricule" hint="Identifiant RH (Cursus, paie).">
            <Input name="matricule" defaultValue={person?.matricule ?? ''} maxLength={40} autoComplete="off" />
          </Field>
        </FormRow>
        <Checkbox name="inSkillsMatrix" label="Suivi dans la matrice des habilitations" defaultChecked={person ? person.inSkillsMatrix : true} />
        {note('ph-plugs-connected', 'Saisie provisoire : le connecteur Cursus, propriétaire des données personnelles des salariés, alimentera cette fiche.')}
      </ActionForm>
      {person && <LeaveSection person={person} today={today} onDone={onDone} />}
      {/* Historique de la fiche (HAB-03), chargé à l'ouverture. */}
      {person && <LazyChangeLog entity="person" id={person.id} title="Historique de la fiche" />}
    </div>
  );
}
