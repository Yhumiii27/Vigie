'use client';

import { useState } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { ReasonButton } from '@/components/ReasonDialog';
import type { BenignEntryView } from '@/lib/data/events';
import { fmtDate } from '@/lib/dates';
import type { Option } from '@/lib/form-options';
import { BENIGN_CAREGIVER_KEYS, BENIGN_CAREGIVER_KINDS } from '@/lib/domain';
import { cancelBenignAccident, escalateBenignAccident, registerBenignAccident, signBenignAccident } from '@/server/events';
import { INJURIES } from './shared';

// Registre des accidents bénins (EVT-04) sur la fiche d'un AT : inscription, visas, bascule en déclaration CPAM, annulation.
// Animateur QHSE et direction seulement (données de santé).

const PRO_OPTIONS = BENIGN_CAREGIVER_KEYS.filter((k) => k !== 'sst').map((k) => [k, BENIGN_CAREGIVER_KINDS[k]] as const);
const ESCALATE_INJURIES = INJURIES.filter(([k]) => k !== 'soins');
/** « AAAA-MM-JJTHH:mm » → « 07/09/2026 à 11:05 ». */
const fmtLocal = (local: string) => `${fmtDate(local.slice(0, 10))} à ${local.slice(11, 16)}`;

function Radio({ name, value, checked, onChange, children }: { name: string; value: string; checked: boolean; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className="vg-check" style={{ minHeight: 32 }}>
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} />
      <span className="vg-check-box" style={{ borderRadius: '50%' }}><i className="ph ph-circle" style={{ fontSize: 8 }} /></span>
      <span>{children}</span>
    </label>
  );
}

/** « Inscrire au registre » : date et heure des soins, donneur de soins (secouriste de l'effectif ou professionnel de santé), soins. */
function RegisterButton({ eventId, defaultCareAt, firstAiders }: { eventId: string; defaultCareAt: string; firstAiders: readonly Option[] }) {
  const [kind, setKind] = useState(firstAiders.length ? 'staff' : 'pro');
  return (
    <DialogButton label="Inscrire au registre" title="Inscription au registre des accidents bénins" kicker={eventId} icon="ph-notebook" width={560}
      className="btn btn-secondary vg-btn-sm">
      {(close) => (
        <ActionForm action={registerBenignAccident} hidden={{ id: eventId }} onDone={close} onCancel={close} submitLabel="Inscrire">
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
            Accident sans arrêt de travail ni soins médicaux : il est inscrit au registre du site (numéro d&apos;ordre) au lieu d&apos;être
            déclaré à la CPAM. La victime et le donneur de soins visent ensuite le registre imprimé.
          </p>
          <Field name="careGivenAt" label="Soins donnés le">
            <Input name="careGivenAt" type="datetime-local" defaultValue={defaultCareAt} />
          </Field>
          <Field name="caregiverKind" label="Donneur de soins">
            <span role="radiogroup" aria-label="Donneur de soins" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px' }}>
              <Radio name="caregiverKind" value="staff" checked={kind === 'staff'} onChange={setKind}>Secouriste de l&apos;effectif</Radio>
              <Radio name="caregiverKind" value="pro" checked={kind === 'pro'} onChange={setKind}>Professionnel de santé</Radio>
            </span>
          </Field>
          {kind === 'staff' && (firstAiders.length ? (
            <Field name="caregiverId" label="Secouriste du travail" hint="Titre SST valide à la date des soins, sur ce site.">
              <Select name="caregiverId" options={firstAiders} placeholder="Choisir…" />
            </Field>
          ) : (
            <div className="vg-inset" role="note" style={{ padding: '8px 12px', fontSize: 12, color: 'var(--tone-warn-fg)', textWrap: 'pretty' }}>
              Aucun secouriste du travail (SST) valide sur ce site : choisissez « Professionnel de santé », ou enregistrez la formation
              SST dans les habilitations.
            </div>
          ))}
          {kind === 'pro' && (
            <FormRow>
              <Field name="caregiverName" label="Nom du professionnel de santé">
                <Input name="caregiverName" maxLength={120} placeholder="Prénom et nom" />
              </Field>
              <Field name="caregiverQualification" label="Qualité">
                <Select name="caregiverQualification" options={PRO_OPTIONS} placeholder="Choisir…" />
              </Field>
            </FormRow>
          )}
          <Field name="care" label="Soins dispensés">
            <TextArea name="care" rows={2} maxLength={1000} placeholder="Désinfection, pansement, rinçage oculaire…" />
          </Field>
        </ActionForm>
      )}
    </DialogButton>
  );
}

/** « Visas recueillis » : date à laquelle la victime et le donneur de soins ont visé le registre imprimé. */
function SignButton({ entryId, eventId, signedOn, today }: { entryId: number; eventId: string; signedOn: string | null; today: string }) {
  return (
    <DialogButton label={signedOn ? 'Modifier la date des visas' : 'Visas recueillis'} title="Visas du registre des accidents bénins" kicker={eventId} icon="ph-signature" width={440}
      className="btn btn-ghost vg-btn-sm">
      {(close) => (
        <ActionForm action={signBenignAccident} hidden={{ id: entryId }} onDone={close} onCancel={close}>
          <Field name="signedOn" label="Visés le" hint="Visas de la victime et du donneur de soins sur le registre imprimé.">
            <Input name="signedOn" type="date" defaultValue={signedOn ?? today} max={today} />
          </Field>
        </ActionForm>
      )}
    </DialogButton>
  );
}

/** « Basculer en déclaration CPAM » : arrêt de travail ou soins médicaux connus après l'inscription. */
function EscalateButton({ eventId }: { eventId: string }) {
  const [injury, setInjury] = useState('');
  return (
    <DialogButton label="Basculer en déclaration CPAM" title="Arrêt ou soins médicaux après l'inscription" kicker={eventId} icon="ph-arrow-square-out" width={520}
      className="btn btn-ghost vg-btn-sm">
      {(close) => (
        <ActionForm action={escalateBenignAccident} hidden={{ id: eventId }} onDone={close} onCancel={close} submitLabel="Basculer">
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
            L&apos;accident est à déclarer à la CPAM dans les 48 h (dimanches et jours fériés non compris) qui suivent la connaissance
            de l&apos;arrêt ou des soins médicaux. L&apos;inscription reste au registre, avec la mention « basculé en déclaration CPAM ».
          </p>
          <FormRow>
            <Field name="injury" label="Blessure">
              <Select name="injury" options={ESCALATE_INJURIES} value={injury} onChange={(e) => setInjury(e.target.value)} placeholder="Choisir…" />
            </Field>
            <Field name="lostDays" label="Jours perdus" hint={injury === 'arret' ? "Jours calendaires d'arrêt, s'ils sont connus." : 'Uniquement pour un accident avec arrêt.'}>
              <Input name="lostDays" type="number" min={0} step={1} inputMode="numeric" disabled={injury !== 'arret'} />
            </Field>
          </FormRow>
          <Field name="knownAt" label="Arrêt ou soins médicaux connus le" hint="Point de départ du délai de 48 h.">
            <Input name="knownAt" type="datetime-local" />
          </Field>
        </ActionForm>
      )}
    </DialogButton>
  );
}

/** « Annuler l'inscription » : erreur d'inscription ; le numéro n'est jamais réattribué. */
function CancelButton({ entryId, eventId, number }: { entryId: number; eventId: string; number: number }) {
  return (
    <ReasonButton label="Annuler l'inscription" title={`Annuler l'inscription n° ${number}`} kicker={eventId} icon="ph-prohibit"
      className="btn btn-ghost vg-btn-sm" action={cancelBenignAccident} hidden={{ id: entryId }} reasonLabel="Motif de l'annulation"
      message="L'inscription reste lisible au registre, barrée avec son motif ; son numéro n'est pas réattribué. L'accident redevient à inscrire ou à déclarer."
      submitLabel="Annuler l'inscription" />
  );
}

export type BenignRegisterProps = {
  eventId: string;
  entry: BenignEntryView | null;
  canRegister: boolean;
  firstAiders: readonly Option[];
  /** Registre imprimable du site. */
  href: string;
  /** Fiche verrouillée (clôturée, classée) : ni inscription ni bascule ; visas et annulation restent possibles. */
  locked: boolean;
  /** Date et heure des faits (valeur par défaut des soins), « AAAA-MM-JJTHH:mm ». */
  defaultCareAt: string;
  today: string;
  /** Pourquoi l'accident bénin ne peut pas encore être inscrit (mentions manquantes, intérimaire, victime extérieure). */
  hint?: string | null;
};

/** Inscription au registre des accidents bénins d'un AT (fiche, rôles habilités). */
export function BenignRegisterBlock({ eventId, entry, canRegister, firstAiders, href, locked, defaultCareAt, today, hint }: BenignRegisterProps) {
  const registerLink = <a href={href} target="_blank" rel="noreferrer" className="vg-link" style={{ fontSize: 12 }}>Registre du site</a>;
  if (!entry) {
    if (!canRegister) {
      if (!hint) return null;
      return (
        <span role="note" style={{ fontSize: 12, color: 'var(--tone-warn-fg)', textWrap: 'pretty' }}>
          <i className="ph ph-info" style={{ fontSize: 12, marginRight: 4 }} aria-hidden />{hint}
        </span>
      );
    }
    return (
      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <RegisterButton eventId={eventId} defaultCareAt={defaultCareAt} firstAiders={firstAiders} />
        {registerLink}
      </span>
    );
  }
  return (
    <span style={{ display: 'grid', gap: 6 }}>
      <span style={{ textWrap: 'pretty' }}>
        Inscrit sous le n° {entry.number} le {fmtDate(entry.createdOn)} · soins le {fmtLocal(entry.careGivenAt)} par {entry.caregiver} ({entry.qualification}) :{' '}
        {entry.care} · {entry.signedOn ? `visé le ${fmtDate(entry.signedOn)}` : 'visas à recueillir sur le registre imprimé'}
        {entry.escalatedAt && <> · basculé en déclaration CPAM (arrêt ou soins médicaux connus le {fmtLocal(entry.escalatedAt)})</>}
      </span>
      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        {registerLink}
        <SignButton entryId={entry.id} eventId={eventId} signedOn={entry.signedOn} today={today} />
        {!entry.escalatedAt && !locked && <EscalateButton eventId={eventId} />}
        <CancelButton entryId={entry.id} eventId={eventId} number={entry.number} />
      </span>
    </span>
  );
}
