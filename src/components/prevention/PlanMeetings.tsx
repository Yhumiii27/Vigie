'use client';

import { useState } from 'react';
import { ReasonForm } from '@/components/ReasonDialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import type { PlanView } from '@/lib/data/prevention';
import { cancelPlanMeeting, recordPlanMeeting, setPlanMeetingPeriod } from '@/server/prevention';
import { MEETING_PERIOD_MAX_DAYS, MEETING_PERIOD_MIN_DAYS, PLAN_MEETING_KINDS, PLAN_MEETING_KIND_KEYS } from '@/lib/rules/prevention';
import { SectionTitle, muted } from './parts';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';

const KIND_OPTIONS = PLAN_MEETING_KIND_KEYS.map((k) => [k, PLAN_MEETING_KINDS[k]] as const);

/**
 * PRV-17 : inspections et réunions périodiques de coordination pendant l'intervention (R. 4513-2), utiles aux interventions
 * longues (contrat annuel) : périodicité fixée sur le plan, séances tenues (participants, constats), prochaine séance due
 * (échéance au responsable du plan) ; séance saisie par erreur annulée avec un motif, jamais supprimée.
 */
export function PlanMeetings({ plan, editable, today }: { plan: PlanView; editable: boolean; today: string }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'list' | 'record' | 'period'>('list');
  const [cancelling, setCancelling] = useState<number | null>(null);
  const live = plan.meetings.filter((m) => !m.cancelled);
  if (!editable && !plan.meetings.length && !plan.meetingPeriodDays) return null;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <SectionTitle aside={<span style={muted}>R. 4513-2</span>}>{t('Periodic inspections and meetings')}</SectionTitle>
      <span style={{ fontSize: 12.5, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        {plan.meetingPeriodDays ? fill(t('Every {n} days during the intervention'), { n: plan.meetingPeriodDays }) : t('Frequency not set')}
        {plan.nextMeeting && (
          <ToneTag tone={plan.nextMeeting.late ? 'danger' : 'warn'}>
            {fill(plan.nextMeeting.late ? t('Late since {date}') : t('Next before {date}'), { date: fmtDate(plan.nextMeeting.dueOn) })}
          </ToneTag>
        )}
        <span style={muted}>{fill(live.length > 1 ? t('{n} sessions held') : t('{n} session held'), { n: live.length })}</span>
      </span>
      {plan.meetings.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {plan.meetings.map((m) => (
            <li key={m.id} style={{ display: 'grid', gap: 3, fontSize: 12.5 }}>
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline', textDecoration: m.cancelled ? 'line-through' : undefined }}>
                <strong style={{ fontWeight: 500 }}>{fmtDate(m.heldOn)}</strong>{labelT(t)(m.kindLabel)}
                <span style={muted}>{m.participants}</span>
              </span>
              {m.notes && <span style={{ color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{m.notes}</span>}
              {m.cancelled && <span style={muted}>{fill(t('Cancelled on {date}#f'), { date: m.cancelled.on })}{m.cancelled.by ? fill(t(' by {name}'), { name: m.cancelled.by }) : ''}{fill(t(' — reason: {reason}'), { reason: m.cancelled.reason })}</span>}
              {editable && !m.cancelled && cancelling !== m.id && (
                <button type="button" className="vg-text-btn" style={{ justifySelf: 'start', fontSize: 11.5 }} onClick={() => setCancelling(m.id)}>{t('Cancel this entry')}</button>
              )}
              {editable && cancelling === m.id && (
                <div className="vg-inset" style={{ padding: '10px 12px' }}>
                  <ReasonForm action={cancelPlanMeeting} hidden={{ id: m.id }} submitLabel={t('Cancel the session')} submitIcon="ph-prohibit"
                    placeholder={t('E.g. session entered on the wrong plan')} onDone={() => setCancelling(null)} onCancel={() => setCancelling(null)}
                    message={t('Wrong entry: the session stays visible, struck through, with its reason; the next session due is recalculated.')} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && mode === 'list' && (
        <span style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <button type="button" className="vg-text-btn" onClick={() => setMode('record')}>{t('Record an inspection or a meeting')}</button>
          <button type="button" className="vg-text-btn" onClick={() => setMode('period')}>{plan.meetingPeriodDays ? t('Change the frequency') : t('Set the frequency')}</button>
        </span>
      )}
      {editable && mode === 'record' && (
        <div className="vg-inset" style={{ padding: '10px 12px' }}>
          <ActionForm action={recordPlanMeeting} hidden={{ planId: plan.id }} onDone={() => setMode('list')} onCancel={() => setMode('list')} submitLabel={t('Save the session')}>
            <FormRow>
              <Field name="kind" label={t('Nature')}>
                <Select name="kind" options={KIND_OPTIONS} defaultValue="inspection" />
              </Field>
              <Field name="heldOn" label={t('Held on#f')}>
                <Input name="heldOn" type="date" defaultValue={today} min={plan.startOn} max={today} />
              </Field>
            </FormRow>
            <Field name="participants" label={t('Participants')} hint={t('Representatives of the host company and of the external company.')}>
              <Input name="participants" maxLength={500} />
            </Field>
            <Field name="notes" label={t('Findings and measures decided')}>
              <TextArea name="notes" rows={3} maxLength={4000} />
            </Field>
          </ActionForm>
        </div>
      )}
      {editable && mode === 'period' && (
        <div className="vg-inset" style={{ padding: '10px 12px' }}>
          <ActionForm action={setPlanMeetingPeriod} hidden={{ id: plan.id }} onDone={() => setMode('list')} onCancel={() => setMode('list')} submitLabel={t('Save')}>
            <Field name="meetingPeriodDays" label={t('Frequency (days)')} hint={fill(t('Empty = not set. E.g. 30 for a monthly meeting ({min} to {max} days).'), { min: MEETING_PERIOD_MIN_DAYS, max: MEETING_PERIOD_MAX_DAYS })}>
              <Input name="meetingPeriodDays" type="number" min={MEETING_PERIOD_MIN_DAYS} max={MEETING_PERIOD_MAX_DAYS} step={1} inputMode="numeric" defaultValue={plan.meetingPeriodDays ?? ''} />
            </Field>
          </ActionForm>
        </div>
      )}
    </div>
  );
}
