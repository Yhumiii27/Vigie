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
import { CURSUS_PEOPLE_NOTICE, PERSON_CATEGORIES, type PersonCategory } from '@/lib/integration-labels';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

type Props = {
  /** Fiche modifiée (D01, décision CV-10 : aucune création dans Vigie, les personnes viennent de Cursus). */
  person: Person;
  /** QUA-12 : version de la fiche à son ouverture. */
  version?: string;
  /** Sites actifs (seuls proposés pour un changement de site d'une fiche ancienne sans matricule). */
  sites: readonly Option[];
  /** Sites archivés : le site actuel d'un salarié qui y est encore rattaché reste proposé (pas de changement implicite). */
  archivedSites: readonly Option[];
  /** Services déjà renseignés (suggestions). */
  services: readonly string[];
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
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'grid', gap: 10, borderTop: '1px solid var(--color-divider)', paddingTop: 14 }}>
      <h6 className="vg-h6">{t('Departure from the workforce')}</h6>
      {person.leftOn ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
          <span>{fill(t('Departure planned on {date}'), { date: fmtDate(person.leftOn) })}{person.leftReason ? ` · ${person.leftReason}` : ''}</span>
          <ReasonButton action={reinstatePerson} hidden={{ id: person.id }} label={t('Cancel the departure')} className="vg-text-btn" title={t('Cancel the departure')}
            kicker={person.name} submitLabel={t('Cancel the departure')} message={t('The employee stays in the matrix, the deadlines and the lists; the cancellation is written to their history.')}
            placeholder={t('E.g. contract extended')} onDone={onDone} />
        </div>
      ) : open ? (
        <ActionForm action={setPersonLeft} hidden={{ id: person.id }} onDone={onDone} onCancel={() => setOpen(false)} submitLabel={t('Record the departure')} submitIcon="ph-sign-out">
          <FormRow>
            <Field name="leftOn" label={t('Departure date')}>
              <Input name="leftOn" type="date" min={addMonths(today, -12)} defaultValue={today} required />
            </Field>
            <Field name="leftReason" label={t('Reason')} hint={t('Required · e.g. end of contract, transfer.')}>
              <TextArea name="leftReason" rows={1} maxLength={REASON_MAX} required placeholder={t('E.g. end of contract')} />
            </Field>
          </FormRow>
          {note('ph-info', t('The employee leaves the matrix, the deadlines and the lists on this date; their titles stay viewable (“Left” filter).'))}
        </ActionForm>
      ) : (
        <button type="button" className="btn btn-secondary vg-btn-sm" style={{ justifySelf: 'start' }} onClick={() => setOpen(true)}>
          <i className="ph ph-sign-out" style={{ fontSize: 13 }} aria-hidden />{t('Record the departure')}
        </button>
      )}
      {note('ph-plugs-connected', t('Old record without an employee number: to link to a Cursus employee, who will then hold the departure.'))}
    </div>
  );
}

/** Données de la fiche reprises de Cursus (D01) : affichées, jamais modifiées dans Vigie. */
function CursusFacts({ person, siteLabel }: { person: Person; siteLabel: string }) {
  const { t } = useI18n();
  const fact = (label: string, value: string | null | undefined) => (
    <div style={{ display: 'grid', gap: 2 }}>
      <span style={{ fontSize: 11, color: 'var(--vg-text-muted)' }}>{label}</span>
      <span style={{ fontSize: 12.5 }}>{value || '—'}</span>
    </div>
  );
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        {fact(t('Name'), person.name)}
        {fact(t('Employee number'), person.matricule)}
        {person.siteMatricule && fact(t('Site employee number'), person.siteMatricule)}
        {fact(t('Job'), person.job)}
        {fact(t('Home site'), siteLabel)}
        {fact(t('Category'), person.category ? PERSON_CATEGORIES[person.category as PersonCategory]?.label ?? person.category : null)}
        {person.company && fact(t('Agency or company'), person.company)}
        {fact(t('E-mail published by Cursus'), person.cursusEmail)}
        {person.leftOn && fact(t('Departure from the workforce'), `${fmtDate(person.leftOn)}${person.leftReason ? ` · ${person.leftReason}` : ''}`)}
      </div>
      {person.cursusState === 'absent' && note('ph-warning', t('Person absent from the last read of Cursus: record kept, to check with the HR department.'))}
      {note('ph-plugs-connected', CURSUS_PEOPLE_NOTICE)}
    </div>
  );
}

/**
 * Fiche salarié. Tenue par Cursus (matricule) : données de Cursus en lecture, attributs propres à Vigie modifiables (suivi
 * dans la matrice, service). Fiche ancienne sans matricule : saisie gardée jusqu'au rattachement (vue « Personnel »).
 */
export function PersonForm({ person, version, sites, archivedSites, services, today, onDone, onCancel }: Props) {
  const { t } = useI18n();
  const cursus = !!person.matricule;
  const siteId = person.siteId ?? '';
  const current = siteId && !sites.some(([v]) => v === siteId) ? archivedSites.find(([v]) => v === siteId) ?? ([siteId, siteId] as const) : null;
  const siteOptions = current ? [...sites, current] : sites;
  const siteLabel = siteOptions.find(([v]) => v === siteId)?.[1] ?? (siteId || t('No site followed'));
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {cursus && <CursusFacts person={person} siteLabel={String(siteLabel)} />}
      <ActionForm action={savePerson} onDone={onDone} onCancel={onCancel} submitLabel={t('Save')} hidden={{ id: person.id, version }}>
        {!cursus && (
          <>
            <FormRow>
              <Field name="name" label={t('Name')}>
                <Input name="name" defaultValue={person.name} placeholder={t('E.g. [J. Dupont]')} maxLength={80} autoFocus />
              </Field>
              <Field name="job" label={t('Job')}>
                <Input name="job" defaultValue={person.job} placeholder={t('E.g. Fitter · assembly workshop')} maxLength={80} />
              </Field>
            </FormRow>
            <FormRow>
              <Field name="siteId" label={t('Home site')}>
                <Select name="siteId" options={siteOptions} defaultValue={siteId} placeholder={siteId ? undefined : t('Choose a site')} />
              </Field>
              <Field name="email" label={t('Work e-mail')} hint={t('Matches the record with the Microsoft account at the first sign-in.')}>
                <Input name="email" type="email" defaultValue={person.email ?? ''} placeholder={t('E.g. j.dupont@epc2i.fr')} maxLength={254} autoComplete="off" />
              </Field>
            </FormRow>
          </>
        )}
        <Field name="service" label={t('Department#service')} hint={t('Attribute specific to Vigie (matrix filter).')}>
          <Input name="service" list="vg-person-services" defaultValue={person.service} placeholder={t('E.g. Assembly workshop')} maxLength={60} />
          <datalist id="vg-person-services">{services.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <Checkbox name="inSkillsMatrix" label={t('Followed in the qualifications matrix')} defaultChecked={person.inSkillsMatrix} />
        {!cursus && note('ph-link-break', t('Record without a Cursus employee number: the QHSE department links it to a Cursus employee (“Staff” view), who will then hold name, job, site and departure.'))}
      </ActionForm>
      {!cursus && <LeaveSection person={person} today={today} onDone={onDone} />}
      {/* Historique de la fiche (HAB-03), chargé à l'ouverture. */}
      <LazyChangeLog entity="person" id={person.id} title={t('Record history')} />
    </div>
  );
}
