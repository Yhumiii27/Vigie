'use client';

import { useState, type ReactNode } from 'react';
import { Checkbox, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import type { Option } from '@/lib/form-options';
import { VICTIM_KINDS, VICTIM_KIND_KEYS } from '@/lib/domain';
import { RestrictedNote } from './FieldGrid';
import { INJURIES, declarationDuty } from '@/lib/rules/events';
import { useI18n } from '@/i18n/client';
import type { T } from '@/i18n/translate';

/** Rubriques de la déclaration d'un AT transmises au formulaire (données de santé à null pour un rôle non habilité). */
export type AccidentValues = {
  victimKind?: string | null; victimId?: string | null; victimName?: string | null; victimCompany?: string | null;
  workSchedule?: string | null; knownAt?: string | null; activity?: string | null; circumstances?: string | null;
  witnesses?: string | null; thirdParty?: string | null; commute?: boolean | null;
  injury?: string | null; lostDays?: number | null; cpamDeclaredOn?: string | null;
  lesionNature?: string | null; lesionSite?: string | null; careGiven?: string | null; reservesOn?: string | null;
};

const VICTIM_OPTIONS = VICTIM_KIND_KEYS.map((k) => [k, VICTIM_KINDS[k]] as const);
/** Aide d'un champ exigé à la qualification (EVT-05). */
export const requiredHint = (t: T, base?: ReactNode) => (base ? <>{base} · {t('required for qualification')}</> : t('Required for qualification.'));

/**
 * Rubriques de la déclaration d'accident du travail (EVT-01, Cerfa 14463) dans le formulaire de la fiche : victime,
 * horaire, connaissance par l'employeur (départ du délai de 48 h), activité, circonstances, témoins, tiers ; puis, pour
 * l'animateur QHSE et la direction (`health`), blessure, jours perdus, lésions, soins, déclaration CPAM et réserves.
 * `benign` : accident inscrit au registre des accidents bénins (blessure verrouillée côté serveur).
 * Déclaration CPAM : tout AT de l'effectif non inscrit au registre (premiers soins compris : le registre est une faculté) ;
 * intérimaire ou victime extérieure : déclaré par l'ETT ou par son employeur (declarationDuty), date conservée si déjà saisie.
 */
export function AccidentFields({ event: e, people, health, benign }: { event: AccidentValues; people: readonly Option[]; health: boolean; benign?: 'active' | 'escalated' | null }) {
  const { t } = useI18n();
  const [victimKind, setVictimKind] = useState(e.victimKind ?? '');
  const [injury, setInjury] = useState(e.injury ?? '');
  const [declaredOn, setDeclaredOn] = useState(e.cpamDeclaredOn ?? '');
  const declared = victimKind && victimKind !== 'salarie';
  const duty = declarationDuty({ victimKind: victimKind || null });
  const showDeclaration = benign !== 'active' && (duty === 'cpam' || !!e.cpamDeclaredOn);

  return (
    <>
      <h6 className="vg-h6" style={{ margin: '4px 0 -4px' }}>{t('Occupational accident · declaration')}</h6>
      <Field name="commute" label={t('Nature of the accident')}
        hint={t('Commuting accident (L. 411-2 CSS): declared as an occupational accident, but excluded from TF1, TG, days without accident and the pyramid.')}>
        <input type="hidden" name="commuteField" value="1" />
        <Checkbox name="commute" label={t('Commuting accident (home – work, or work – place of meal)')} defaultChecked={!!e.commute} />
      </Field>
      <FormRow>
        <Field name="victimKind" label={t('Victim')} hint={!victimKind ? requiredHint(t) : undefined}>
          <Select name="victimKind" options={VICTIM_OPTIONS} value={victimKind} onChange={(ev) => setVictimKind(ev.target.value)} placeholder={t('To be specified')} />
        </Field>
        {victimKind === 'salarie' && (
          <Field name="victimId" label={t('Workforce member')} hint={requiredHint(t)}>
            <Select name="victimId" options={people} defaultValue={e.victimId ?? ''} placeholder={t('Choose…')} />
          </Field>
        )}
        {declared && (
          <Field name="victimName" label={t('Victim’s name')} hint={requiredHint(t)}>
            <Input name="victimName" defaultValue={e.victimName ?? ''} maxLength={120} placeholder={t('First and last name')} autoComplete="off" />
          </Field>
        )}
      </FormRow>
      {declared && (
        <Field name="victimCompany" label={victimKind === 'interimaire' ? t('Temporary work agency') : t('Victim’s company or organisation')}>
          <Input name="victimCompany" defaultValue={e.victimCompany ?? ''} maxLength={120} />
        </Field>
      )}
      <FormRow>
        <Field name="workSchedule" label={t('Working hours that day')}>
          <Input name="workSchedule" defaultValue={e.workSchedule ?? ''} maxLength={80} placeholder={t('7:30 – 12:00 · 13:00 – 16:30')} />
        </Field>
        <Field name="knownAt" label={t('Known to the employer on')} hint={t('Start of the 48-hour deadline. Empty: date recorded in Vigie.')}>
          <Input name="knownAt" type="datetime-local" defaultValue={e.knownAt ?? ''} />
        </Field>
      </FormRow>
      <Field name="activity" label={t('Victim’s activity at the time of the accident')}>
        <Input name="activity" defaultValue={e.activity ?? ''} maxLength={300} placeholder={t('Task, station, operation in progress')} />
      </Field>
      <Field name="circumstances" label={t('Detailed circumstances')} hint={requiredHint(t, t('Facts only: the nature and site of lesions have their restricted fields.'))}>
        <TextArea name="circumstances" defaultValue={e.circumstances ?? ''} rows={3} maxLength={4000} />
      </Field>
      <FormRow>
        <Field name="witnesses" label={t('Witnesses')}>
          <TextArea name="witnesses" defaultValue={e.witnesses ?? ''} rows={2} maxLength={1000} placeholder={t('Name, company, contact details')} />
        </Field>
        <Field name="thirdParty" label={t('Third party involved')}>
          <Input name="thirdParty" defaultValue={e.thirdParty ?? ''} maxLength={500} placeholder={t('Name, address, insurer; empty: none')} />
        </Field>
      </FormRow>

      {!health ? <RestrictedNote /> : (
        <>
          <h6 className="vg-h6" style={{ margin: '4px 0 -4px' }}>
            <i className="ph ph-lock-simple" style={{ fontSize: 12, marginRight: 4 }} aria-hidden />{t('Health data · QHSE coordinator and senior management')}
          </h6>
          <FormRow>
            <Field name="injury" label={t('Injury')}
              hint={benign === 'active' ? t('Entered in the minor accident register: “Switch to CPAM declaration” from the sheet.') : benign === 'escalated' ? t('Switched to CPAM declaration from the register.') : undefined}>
              <Select name="injury" options={INJURIES} value={injury} onChange={(ev) => setInjury(ev.target.value)} placeholder={t('Not specified')} />
            </Field>
            <Field name="lostDays" label={t('Days lost')} hint={injury === 'arret' ? t('Calendar days of sick leave (severity rate).') : t('Only for a lost-time accident.')}>
              <Input name="lostDays" type="number" min={0} step={1} inputMode="numeric" defaultValue={e.lostDays ?? ''} disabled={injury !== 'arret'} />
            </Field>
          </FormRow>
          <FormRow>
            <Field name="lesionNature" label={t('Nature of lesions')}>
              <Input name="lesionNature" defaultValue={e.lesionNature ?? ''} maxLength={200} placeholder={t('Cut, sprain, burn…')} />
            </Field>
            <Field name="lesionSite" label={t('Site of lesions')}>
              <Input name="lesionSite" defaultValue={e.lesionSite ?? ''} maxLength={200} placeholder={t('Right hand, left ankle…')} />
            </Field>
          </FormRow>
          <Field name="careGiven" label={t('Care given')}>
            <TextArea name="careGiven" defaultValue={e.careGiven ?? ''} rows={2} maxLength={1000} placeholder={t('First-aid station, doctor, emergency department, transport…')} />
          </Field>
          {!showDeclaration && benign !== 'active' && duty !== 'cpam' && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
              {duty === 'ett'
                ? t('Temp worker: the temporary work agency declares the accident. Inform it within 24 hours (copy to the CARSAT and the labour inspectorate), then “Record that the agency was informed” on the sheet.')
                : t('External victim: their employer declares the accident. “Record the declaration by the employer” on the sheet before closure.')}
            </p>
          )}
          {showDeclaration && (
            <FormRow>
              <Field name="cpamDeclaredOn" label={t('CPAM declaration')}
                hint={injury === 'soins'
                  ? t('Minor accident: entry in the register or declaration, within 48 hours (Sundays and public holidays excluded). Empty: not declared.')
                  : t('Date the declaration was sent (48 hours, Sundays and public holidays excluded). Empty: to be declared.')}>
                <Input name="cpamDeclaredOn" type="date" value={declaredOn} onChange={(ev) => setDeclaredOn(ev.target.value)} />
              </Field>
              {declaredOn && (
                <Field name="reservesOn" label={t('Reasoned reservations sent on')} hint={t('Optional: 10 clear days after the declaration.')}>
                  <Input name="reservesOn" type="date" defaultValue={e.reservesOn ?? ''} />
                </Field>
              )}
            </FormRow>
          )}
        </>
      )}
    </>
  );
}
