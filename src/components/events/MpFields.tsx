'use client';

import { useState } from 'react';
import { Field, FormRow, Input, Select } from '@/components/form';
import type { Option } from '@/lib/form-options';
import { VICTIM_KINDS, VICTIM_KIND_KEYS } from '@/lib/domain';
import { requiredHint } from './AccidentFields';
import { useI18n } from '@/i18n/client';

/** Rubriques d'une maladie professionnelle transmises au formulaire (rôles habilités seulement : type MP réservé). */
export type MpValues = {
  victimKind?: string | null; victimId?: string | null; victimName?: string | null; victimCompany?: string | null;
  mpTable?: string | null; mpDisease?: string | null; mpCertificateOn?: string | null; mpInformedOn?: string | null;
  mpQuestionnaireReceivedOn?: string | null; mpQuestionnaireReturnedOn?: string | null;
};

const VICTIM_OPTIONS = VICTIM_KIND_KEYS.map((k) => [k, VICTIM_KINDS[k]] as const);

/**
 * Maladie professionnelle (EVT-09) dans le formulaire de la fiche : la victime déclare la maladie à la CPAM (L. 461-5 CSS) ;
 * l'employeur en est informé par la caisse et lui retourne le questionnaire sous 30 jours francs (R. 461-9). Toutes ces
 * données sont des données de santé (type réservé à l'animateur QHSE et à la direction).
 */
export function MpFields({ event: e, people }: { event: MpValues; people: readonly Option[] }) {
  const { t } = useI18n();
  const [victimKind, setVictimKind] = useState(e.victimKind ?? 'salarie');
  const declared = victimKind && victimKind !== 'salarie';
  return (
    <>
      <h6 className="vg-h6" style={{ margin: '4px 0 -4px' }}>
        <i className="ph ph-lock-simple" style={{ fontSize: 12, marginRight: 4 }} aria-hidden />{t('Occupational disease · health data (QHSE coordinator and senior management)')}
      </h6>
      <FormRow>
        <Field name="victimKind" label={t('Employee concerned')} hint={!victimKind ? requiredHint(t) : undefined}>
          <Select name="victimKind" options={VICTIM_OPTIONS} value={victimKind} onChange={(ev) => setVictimKind(ev.target.value)} placeholder={t('To be specified')} />
        </Field>
        {victimKind === 'salarie' && (
          <Field name="victimId" label={t('Workforce member')} hint={requiredHint(t)}>
            <Select name="victimId" options={people} defaultValue={e.victimId ?? ''} placeholder={t('Choose…')} />
          </Field>
        )}
        {declared && (
          <Field name="victimName" label={t('Name')} hint={requiredHint(t)}>
            <Input name="victimName" defaultValue={e.victimName ?? ''} maxLength={120} autoComplete="off" />
          </Field>
        )}
      </FormRow>
      {declared && (
        <Field name="victimCompany" label={victimKind === 'interimaire' ? t('Temporary work agency') : t('Employer')}>
          <Input name="victimCompany" defaultValue={e.victimCompany ?? ''} maxLength={120} />
        </Field>
      )}
      <FormRow>
        <Field name="mpTable" label={t('Occupational disease table')} hint={t('Table number (e.g. 57), or “outside the tables”.')}>
          <Input name="mpTable" defaultValue={e.mpTable ?? ''} maxLength={40} />
        </Field>
        <Field name="mpDisease" label={t('Disease declared')}>
          <Input name="mpDisease" defaultValue={e.mpDisease ?? ''} maxLength={200} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="mpCertificateOn" label={t('Initial medical certificate dated')}>
          <Input name="mpCertificateOn" type="date" defaultValue={e.mpCertificateOn ?? ''} />
        </Field>
        <Field name="mpInformedOn" label={t('Declaration received from the CPAM on')} hint={t('Copy of the declaration and certificate sent to the employer.')}>
          <Input name="mpInformedOn" type="date" defaultValue={e.mpInformedOn ?? ''} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="mpQuestionnaireReceivedOn" label={t('Employer questionnaire received on')} hint={t('To be returned to the fund within 30 clear days (R. 461-9).')}>
          <Input name="mpQuestionnaireReceivedOn" type="date" defaultValue={e.mpQuestionnaireReceivedOn ?? ''} />
        </Field>
        <Field name="mpQuestionnaireReturnedOn" label={t('Questionnaire returned on')}>
          <Input name="mpQuestionnaireReturnedOn" type="date" defaultValue={e.mpQuestionnaireReturnedOn ?? ''} />
        </Field>
      </FormRow>
    </>
  );
}
