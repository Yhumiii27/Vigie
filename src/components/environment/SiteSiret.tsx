'use client';

import { useState } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, Select } from '@/components/form';
import { saveSiteSiret } from '@/server/environment';
import { fmtSiret } from '@/lib/siret';
import { CompanyIdField, Note } from './parts';

/** Établissement tel que le registre des déchets l'identifie (site actif, ou archivé dont le registre reste dû). */
export type RegistrySite = { id: string; label: string; siret: string | null; archived: boolean };

/**
 * « Renseigner le SIRET » / « Modifier » : SIRET de l'établissement, première mention du registre chronologique des déchets
 * (arrêté du 31 mai 2021). Animateur QHSE et direction (saveSiteSiret) ; le changement est journalisé sur le site.
 */
export function SiteSiretButton({ sites, defaultSiteId, label = 'Renseigner le SIRET', className = 'btn btn-secondary vg-btn-sm' }: {
  sites: RegistrySite[]; defaultSiteId?: string; label?: string; className?: string;
}) {
  return (
    <DialogButton label={label} icon="ph-identification-card" className={className} title="SIRET de l'établissement" kicker="Registre des déchets" width={520}>
      {(close) => <SiteSiretForm sites={sites} defaultSiteId={defaultSiteId} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

function SiteSiretForm({ sites, defaultSiteId, onDone, onCancel }: { sites: RegistrySite[]; defaultSiteId?: string; onDone: () => void; onCancel: () => void }) {
  const first = sites.find((s) => s.id === defaultSiteId) ?? sites.find((s) => !s.siret) ?? sites[0];
  const [siteId, setSiteId] = useState(first?.id ?? '');
  const [siret, setSiret] = useState(first?.siret ? fmtSiret(first.siret) : '');
  const site = sites.find((s) => s.id === siteId);
  const options = sites.map((s) => [s.id, `${s.label}${s.archived ? ' (archivé)' : ''}${s.siret ? '' : ' · SIRET à renseigner'}`] as const);
  return (
    <ActionForm action={saveSiteSiret} onDone={onDone} onCancel={onCancel} submitLabel="Enregistrer le SIRET">
      <Note icon="ph-info">
        Identifie l&apos;établissement sur chaque ligne du registre chronologique et dans son export. Pour un site archivé, le registre reste
        conservé trois ans (C. env. R. 541-43).
      </Note>
      <Field name="siteId" label="Site">
        <Select name="siteId" options={options} value={siteId}
          onChange={(e) => { setSiteId(e.target.value); const next = sites.find((s) => s.id === e.target.value); setSiret(next?.siret ? fmtSiret(next.siret) : ''); }} />
      </Field>
      <CompanyIdField name="siret" label="SIRET de l'établissement" value={siret} onChange={setSiret}
        hint={site?.siret ? 'Vide : SIRET retiré (mention signalée manquante au registre).' : '14 chiffres : SIREN de l’entreprise et NIC de l’établissement.'} />
    </ActionForm>
  );
}
