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
import { INJURIES } from '@/lib/rules/events';
import { useI18n } from '@/i18n/client';
import { fill, type T } from '@/i18n/translate';

// Registre des accidents bénins (EVT-04) sur la fiche d'un AT : inscription, visas, bascule en déclaration CPAM, annulation.
// Animateur QHSE et direction seulement (données de santé).

const PRO_OPTIONS = BENIGN_CAREGIVER_KEYS.filter((k) => k !== 'sst').map((k) => [k, BENIGN_CAREGIVER_KINDS[k]] as const);
const ESCALATE_INJURIES = INJURIES.filter(([k]) => k !== 'soins');
/** « AAAA-MM-JJTHH:mm » → « 07/09/2026 à 11:05 ». */
const fmtLocal = (local: string, t: T) => fill(t('{date} at {time}'), { date: fmtDate(local.slice(0, 10)), time: local.slice(11, 16) });

function Radio({ name, value, checked, onChange, children }: { name: string; value: string; checked: boolean; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className="vg-check" style={{ minHeight: 32 }}>
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} />
      <span className="vg-check-box" style={{ borderRadius: '50%' }}><i className="ph ph-circle" style={{ fontSize: 8 }} aria-hidden /></span>
      <span>{children}</span>
    </label>
  );
}

/** « Inscrire au registre » : date et heure des soins, donneur de soins (secouriste de l'effectif ou professionnel de santé), soins. */
function RegisterButton({ eventId, defaultCareAt, firstAiders }: { eventId: string; defaultCareAt: string; firstAiders: readonly Option[] }) {
  const { t } = useI18n();
  const [kind, setKind] = useState(firstAiders.length ? 'staff' : 'pro');
  return (
    <DialogButton label={t('Enter in the register')} title={t('Entry in the minor accident register')} kicker={eventId} icon="ph-notebook" width={560}
      className="btn btn-secondary vg-btn-sm">
      {(close) => (
        <ActionForm action={registerBenignAccident} hidden={{ id: eventId }} onDone={close} onCancel={close} submitLabel={t('Enter')}>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
            {t('Accident without sick leave or medical care: it is entered in the site register (sequence number) instead of being declared to the CPAM. The victim and the caregiver then sign the printed register.')}
          </p>
          <Field name="careGivenAt" label={t('Care given on')}>
            <Input name="careGivenAt" type="datetime-local" defaultValue={defaultCareAt} />
          </Field>
          <Field name="caregiverKind" label={t('Caregiver')}>
            <span role="radiogroup" aria-label={t('Caregiver')} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px' }}>
              <Radio name="caregiverKind" value="staff" checked={kind === 'staff'} onChange={setKind}>{t('Workforce first-aider')}</Radio>
              <Radio name="caregiverKind" value="pro" checked={kind === 'pro'} onChange={setKind}>{t('Health professional')}</Radio>
            </span>
          </Field>
          {kind === 'staff' && (firstAiders.length ? (
            <Field name="caregiverId" label={t('Workplace first-aider')} hint={t('SST certificate valid on the date of care, on this site.')}>
              <Select name="caregiverId" options={firstAiders} placeholder={t('Choose…')} />
            </Field>
          ) : (
            <div className="vg-inset" role="note" style={{ padding: '8px 12px', fontSize: 12, color: 'var(--tone-warn-fg)', textWrap: 'pretty' }}>
              {t('No valid workplace first-aider (SST) on this site: choose “Health professional”, or record the SST training in the qualifications.')}
            </div>
          ))}
          {kind === 'pro' && (
            <FormRow>
              <Field name="caregiverName" label={t('Health professional’s name')}>
                <Input name="caregiverName" maxLength={120} placeholder={t('First and last name')} />
              </Field>
              <Field name="caregiverQualification" label={t('Capacity')}>
                <Select name="caregiverQualification" options={PRO_OPTIONS} placeholder={t('Choose…')} />
              </Field>
            </FormRow>
          )}
          <Field name="care" label={t('Care given')}>
            <TextArea name="care" rows={2} maxLength={1000} placeholder={t('Disinfection, dressing, eye rinse…')} />
          </Field>
        </ActionForm>
      )}
    </DialogButton>
  );
}

/** « Visas recueillis » : date à laquelle la victime et le donneur de soins ont visé le registre imprimé. */
function SignButton({ entryId, eventId, signedOn, today }: { entryId: number; eventId: string; signedOn: string | null; today: string }) {
  const { t } = useI18n();
  return (
    <DialogButton label={signedOn ? t('Change the date of the signatures') : t('Signatures collected')} title={t('Signatures of the minor accident register')} kicker={eventId} icon="ph-signature" width={440}
      className="btn btn-ghost vg-btn-sm">
      {(close) => (
        <ActionForm action={signBenignAccident} hidden={{ id: entryId }} onDone={close} onCancel={close}>
          <Field name="signedOn" label={t('Signed on')} hint={t('Signatures of the victim and the caregiver on the printed register.')}>
            <Input name="signedOn" type="date" defaultValue={signedOn ?? today} max={today} />
          </Field>
        </ActionForm>
      )}
    </DialogButton>
  );
}

/** « Basculer en déclaration CPAM » : arrêt de travail ou soins médicaux connus après l'inscription. */
function EscalateButton({ eventId }: { eventId: string }) {
  const { t } = useI18n();
  const [injury, setInjury] = useState('');
  return (
    <DialogButton label={t('Switch to CPAM declaration')} title={t('Sick leave or medical care after the entry')} kicker={eventId} icon="ph-arrow-square-out" width={520}
      className="btn btn-ghost vg-btn-sm">
      {(close) => (
        <ActionForm action={escalateBenignAccident} hidden={{ id: eventId }} onDone={close} onCancel={close} submitLabel={t('Switch')}>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
            {t('The accident must be declared to the CPAM within 48 hours (Sundays and public holidays excluded) of learning of the sick leave or medical care. The entry stays in the register, marked “switched to CPAM declaration”.')}
          </p>
          <FormRow>
            <Field name="injury" label={t('Injury')}>
              <Select name="injury" options={ESCALATE_INJURIES} value={injury} onChange={(e) => setInjury(e.target.value)} placeholder={t('Choose…')} />
            </Field>
            <Field name="lostDays" label={t('Days lost')} hint={injury === 'arret' ? t('Calendar days of sick leave, if known.') : t('Only for a lost-time accident.')}>
              <Input name="lostDays" type="number" min={0} step={1} inputMode="numeric" disabled={injury !== 'arret'} />
            </Field>
          </FormRow>
          <Field name="knownAt" label={t('Sick leave or medical care known on')} hint={t('Start of the 48-hour deadline.')}>
            <Input name="knownAt" type="datetime-local" />
          </Field>
        </ActionForm>
      )}
    </DialogButton>
  );
}

/** « Annuler l'inscription » : erreur d'inscription ; le numéro n'est jamais réattribué. */
function CancelButton({ entryId, eventId, number }: { entryId: number; eventId: string; number: number }) {
  const { t } = useI18n();
  return (
    <ReasonButton label={t('Cancel the entry')} title={fill(t('Cancel entry no. {n}'), { n: number })} kicker={eventId} icon="ph-prohibit"
      className="btn btn-ghost vg-btn-sm" action={cancelBenignAccident} hidden={{ id: entryId }} reasonLabel={t('Reason for cancellation')}
      message={t('The entry stays readable in the register, struck through with its reason; its number is not reassigned. The accident must again be entered or declared.')}
      submitLabel={t('Cancel the entry')} />
  );
}

export type BenignRegisterProps = {
  eventId: string;
  entry: BenignEntryView | null;
  canRegister: boolean;
  /** Visas, bascule et annulation (EVT-29 : animateur QHSE) ; la direction consulte. */
  canEdit?: boolean;
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
export function BenignRegisterBlock({ eventId, entry, canRegister, canEdit = true, firstAiders, href, locked, defaultCareAt, today, hint }: BenignRegisterProps) {
  const { t } = useI18n();
  const registerLink = <a href={href} target="_blank" rel="noreferrer" className="vg-link" style={{ fontSize: 12 }}>{t('Site register')}</a>;
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
        {fill(t('Entered as no. {n} on {date} · care on {care} by {by} ({capacity}):'), { n: entry.number, date: fmtDate(entry.createdOn), care: fmtLocal(entry.careGivenAt, t), by: entry.caregiver, capacity: entry.qualification })}{' '}
        {entry.care} · {entry.signedOn ? fill(t('signed on {date}'), { date: fmtDate(entry.signedOn) }) : t('signatures to collect on the printed register')}
        {entry.escalatedAt && <> · {fill(t('switched to CPAM declaration (sick leave or medical care known on {date})'), { date: fmtLocal(entry.escalatedAt, t) })}</>}
      </span>
      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        {registerLink}
        {canEdit && <SignButton entryId={entry.id} eventId={eventId} signedOn={entry.signedOn} today={today} />}
        {canEdit && !entry.escalatedAt && !locked && <EscalateButton eventId={eventId} />}
        {canEdit && <CancelButton entryId={entry.id} eventId={eventId} number={entry.number} />}
      </span>
    </span>
  );
}
