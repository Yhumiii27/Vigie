'use client';

import { useState } from 'react';
import { Field, FormRow, Input, Select } from '@/components/form';
import type { Option } from '@/lib/form-options';
import { VICTIM_KINDS, VICTIM_KIND_KEYS } from '@/lib/domain';
import { requiredHint } from './AccidentFields';

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
  const [victimKind, setVictimKind] = useState(e.victimKind ?? 'salarie');
  const declared = victimKind && victimKind !== 'salarie';
  return (
    <>
      <h6 className="vg-h6" style={{ margin: '4px 0 -4px' }}>
        <i className="ph ph-lock-simple" style={{ fontSize: 12, marginRight: 4 }} aria-hidden />Maladie professionnelle · données de santé (animateur QHSE et direction)
      </h6>
      <FormRow>
        <Field name="victimKind" label="Salarié concerné" hint={!victimKind ? requiredHint() : undefined}>
          <Select name="victimKind" options={VICTIM_OPTIONS} value={victimKind} onChange={(ev) => setVictimKind(ev.target.value)} placeholder="À préciser" />
        </Field>
        {victimKind === 'salarie' && (
          <Field name="victimId" label="Personne de l'effectif" hint={requiredHint()}>
            <Select name="victimId" options={people} defaultValue={e.victimId ?? ''} placeholder="Choisir…" />
          </Field>
        )}
        {declared && (
          <Field name="victimName" label="Nom" hint={requiredHint()}>
            <Input name="victimName" defaultValue={e.victimName ?? ''} maxLength={120} autoComplete="off" />
          </Field>
        )}
      </FormRow>
      {declared && (
        <Field name="victimCompany" label={victimKind === 'interimaire' ? 'Entreprise de travail temporaire' : 'Employeur'}>
          <Input name="victimCompany" defaultValue={e.victimCompany ?? ''} maxLength={120} />
        </Field>
      )}
      <FormRow>
        <Field name="mpTable" label="Tableau de maladie professionnelle" hint="Numéro du tableau (ex. 57), ou « hors tableau ».">
          <Input name="mpTable" defaultValue={e.mpTable ?? ''} maxLength={40} />
        </Field>
        <Field name="mpDisease" label="Maladie déclarée">
          <Input name="mpDisease" defaultValue={e.mpDisease ?? ''} maxLength={200} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="mpCertificateOn" label="Certificat médical initial du">
          <Input name="mpCertificateOn" type="date" defaultValue={e.mpCertificateOn ?? ''} />
        </Field>
        <Field name="mpInformedOn" label="Déclaration reçue de la CPAM le" hint="Double de la déclaration et du certificat adressé à l'employeur.">
          <Input name="mpInformedOn" type="date" defaultValue={e.mpInformedOn ?? ''} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="mpQuestionnaireReceivedOn" label="Questionnaire employeur reçu le" hint="À retourner à la caisse sous 30 jours francs (R. 461-9).">
          <Input name="mpQuestionnaireReceivedOn" type="date" defaultValue={e.mpQuestionnaireReceivedOn ?? ''} />
        </Field>
        <Field name="mpQuestionnaireReturnedOn" label="Questionnaire retourné le">
          <Input name="mpQuestionnaireReturnedOn" type="date" defaultValue={e.mpQuestionnaireReturnedOn ?? ''} />
        </Field>
      </FormRow>
    </>
  );
}
