'use client';

import { ActionForm, Checkbox, Field, FormRow, Input, Select } from '@/components/form';
import type { Option } from '@/lib/data/options';
import type { Person } from '@/lib/queries';
import { savePerson } from '@/server/skills';

type Props = {
  person?: Person;
  sites: readonly Option[];
  /** Site proposé pour un nouveau salarié (site sélectionné, ou le premier site). */
  defaultSiteId: string;
  onDone: () => void;
  onCancel?: () => void;
};

/** Fiche salarié (saisie provisoire : Cursus deviendra la source de vérité des données personnelles). */
export function PersonForm({ person, sites, defaultSiteId, onDone, onCancel }: Props) {
  return (
    <ActionForm action={savePerson} onDone={onDone} onCancel={onCancel} submitLabel={person ? 'Enregistrer' : 'Ajouter le salarié'} hidden={{ id: person?.id }}>
      <FormRow>
        <Field name="name" label="Nom">
          <Input name="name" defaultValue={person?.name} placeholder="Ex. [J. Dupont]" maxLength={80} autoFocus />
        </Field>
        <Field name="job" label="Poste">
          <Input name="job" defaultValue={person?.job} placeholder="Ex. Monteur · atelier montage" maxLength={80} />
        </Field>
      </FormRow>
      <Field name="siteId" label="Site de rattachement">
        <Select name="siteId" options={sites} defaultValue={person?.siteId ?? defaultSiteId} />
      </Field>
      <Checkbox name="inSkillsMatrix" label="Suivi dans la matrice des habilitations" defaultChecked={person ? person.inSkillsMatrix : true} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--color-neutral-500)' }}>
        <i className="ph ph-plugs-connected" style={{ fontSize: 14, marginTop: 1 }} />
        <span style={{ textWrap: 'pretty' }}>Saisie provisoire : le connecteur Cursus, propriétaire des données personnelles des salariés, alimentera cette fiche.</span>
      </div>
    </ActionForm>
  );
}
