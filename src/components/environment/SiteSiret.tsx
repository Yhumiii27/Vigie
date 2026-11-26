'use client';

import { useState } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, Select } from '@/components/form';
import { saveSiteSiret } from '@/server/environment';
import { fmtSiret } from '@/lib/siret';
import { CompanyIdField, Note } from './parts';
import { useI18n } from '@/i18n/client';

/** Établissement tel que le registre des déchets l'identifie (site actif, ou archivé dont le registre reste dû). */
export type RegistrySite = { id: string; label: string; siret: string | null; archived: boolean };

/**
 * « Renseigner le SIRET » / « Modifier » : SIRET de l'établissement, première mention du registre chronologique des déchets
 * (arrêté du 31 mai 2021). Animateur QHSE et direction (saveSiteSiret) ; le changement est journalisé sur le site.
 */
export function SiteSiretButton({ sites, defaultSiteId, label, className = 'btn btn-secondary vg-btn-sm' }: {
  sites: RegistrySite[]; defaultSiteId?: string; label?: string; className?: string;
}) {
  const { t } = useI18n();
  return (
    <DialogButton label={label ?? t('Enter the SIRET')} icon="ph-identification-card" className={className} title={t('SIRET of the establishment')} kicker={t('Waste register')} width={520}>
      {(close) => <SiteSiretForm sites={sites} defaultSiteId={defaultSiteId} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

function SiteSiretForm({ sites, defaultSiteId, onDone, onCancel }: { sites: RegistrySite[]; defaultSiteId?: string; onDone: () => void; onCancel: () => void }) {
  const first = sites.find((s) => s.id === defaultSiteId) ?? sites.find((s) => !s.siret) ?? sites[0];
  const [siteId, setSiteId] = useState(first?.id ?? '');
  const [siret, setSiret] = useState(first?.siret ? fmtSiret(first.siret) : '');
  const site = sites.find((s) => s.id === siteId);
  const { t } = useI18n();
  const options = sites.map((s) => [s.id, `${s.label}${s.archived ? t(' (archived)') : ''}${s.siret ? '' : t(' · SIRET to enter')}`] as const);
  return (
    <ActionForm action={saveSiteSiret} onDone={onDone} onCancel={onCancel} submitLabel={t('Save the SIRET')}>
      <Note icon="ph-info">
        {t('Identifies the establishment on each line of the chronological register and in its export. For an archived site, the register stays kept three years (Env. Code R. 541-43).')}
      </Note>
      <Field name="siteId" label={t('Site')}>
        <Select name="siteId" options={options} value={siteId}
          onChange={(e) => { setSiteId(e.target.value); const next = sites.find((s) => s.id === e.target.value); setSiret(next?.siret ? fmtSiret(next.siret) : ''); }} />
      </Field>
      <CompanyIdField name="siret" label={t('SIRET of the establishment')} value={siret} onChange={setSiret}
        hint={site?.siret ? t('Empty: SIRET removed (mention flagged as missing in the register).') : t('14 digits: SIREN of the company and NIC of the establishment.')} />
    </ActionForm>
  );
}
