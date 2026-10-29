'use client';

import { useState } from 'react';
import { ReasonForm } from '@/components/ReasonDialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import type { PlanView } from '@/lib/data/prevention';
import { cancelPlanMeeting, recordPlanMeeting, setPlanMeetingPeriod } from '@/server/prevention';
import { MEETING_PERIOD_MAX_DAYS, MEETING_PERIOD_MIN_DAYS, PLAN_MEETING_KINDS, PLAN_MEETING_KIND_KEYS } from './model';
import { SectionTitle, muted } from './parts';

const KIND_OPTIONS = PLAN_MEETING_KIND_KEYS.map((k) => [k, PLAN_MEETING_KINDS[k]] as const);

/**
 * PRV-17 : inspections et réunions périodiques de coordination pendant l'intervention (R. 4513-2), utiles aux interventions
 * longues (contrat annuel) : périodicité fixée sur le plan, séances tenues (participants, constats), prochaine séance due
 * (échéance au responsable du plan) ; séance saisie par erreur annulée avec un motif, jamais supprimée.
 */
export function PlanMeetings({ plan, editable, today }: { plan: PlanView; editable: boolean; today: string }) {
  const [mode, setMode] = useState<'list' | 'record' | 'period'>('list');
  const [cancelling, setCancelling] = useState<number | null>(null);
  const live = plan.meetings.filter((m) => !m.cancelled);
  if (!editable && !plan.meetings.length && !plan.meetingPeriodDays) return null;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <SectionTitle aside={<span style={muted}>R. 4513-2</span>}>Inspections et réunions périodiques</SectionTitle>
      <span style={{ fontSize: 12.5, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        {plan.meetingPeriodDays ? `Tous les ${plan.meetingPeriodDays} jours pendant l'intervention` : 'Périodicité non fixée'}
        {plan.nextMeeting && (
          <ToneTag tone={plan.nextMeeting.late ? 'danger' : 'warn'}>
            {plan.nextMeeting.late ? `En retard depuis le ${fmtDate(plan.nextMeeting.dueOn)}` : `Prochaine avant le ${fmtDate(plan.nextMeeting.dueOn)}`}
          </ToneTag>
        )}
        <span style={muted}>{live.length} séance{live.length > 1 ? 's' : ''} tenue{live.length > 1 ? 's' : ''}</span>
      </span>
      {plan.meetings.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {plan.meetings.map((m) => (
            <li key={m.id} style={{ display: 'grid', gap: 3, fontSize: 12.5 }}>
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline', textDecoration: m.cancelled ? 'line-through' : undefined }}>
                <strong style={{ fontWeight: 500 }}>{fmtDate(m.heldOn)}</strong>{m.kindLabel}
                <span style={muted}>{m.participants}</span>
              </span>
              {m.notes && <span style={{ color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{m.notes}</span>}
              {m.cancelled && <span style={muted}>Annulée le {m.cancelled.on}{m.cancelled.by ? ` par ${m.cancelled.by}` : ''} — motif : {m.cancelled.reason}</span>}
              {editable && !m.cancelled && cancelling !== m.id && (
                <button type="button" className="vg-text-btn" style={{ justifySelf: 'start', fontSize: 11.5 }} onClick={() => setCancelling(m.id)}>Annuler la saisie</button>
              )}
              {editable && cancelling === m.id && (
                <div className="vg-inset" style={{ padding: '10px 12px' }}>
                  <ReasonForm action={cancelPlanMeeting} hidden={{ id: m.id }} submitLabel="Annuler la séance" submitIcon="ph-prohibit"
                    placeholder="Ex. séance saisie sur le mauvais plan" onDone={() => setCancelling(null)} onCancel={() => setCancelling(null)}
                    message="Saisie erronée : la séance reste visible, barrée, avec son motif ; la prochaine séance due est recalculée." />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && mode === 'list' && (
        <span style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <button type="button" className="vg-text-btn" onClick={() => setMode('record')}>Enregistrer une inspection ou une réunion</button>
          <button type="button" className="vg-text-btn" onClick={() => setMode('period')}>{plan.meetingPeriodDays ? 'Modifier la périodicité' : 'Fixer la périodicité'}</button>
        </span>
      )}
      {editable && mode === 'record' && (
        <div className="vg-inset" style={{ padding: '10px 12px' }}>
          <ActionForm action={recordPlanMeeting} hidden={{ planId: plan.id }} onDone={() => setMode('list')} onCancel={() => setMode('list')} submitLabel="Enregistrer la séance">
            <FormRow>
              <Field name="kind" label="Nature">
                <Select name="kind" options={KIND_OPTIONS} defaultValue="inspection" />
              </Field>
              <Field name="heldOn" label="Tenue le">
                <Input name="heldOn" type="date" defaultValue={today} min={plan.startOn} max={today} />
              </Field>
            </FormRow>
            <Field name="participants" label="Participants" hint="Représentants de l'entreprise utilisatrice et de l'entreprise extérieure.">
              <Input name="participants" maxLength={500} />
            </Field>
            <Field name="notes" label="Constats et mesures décidées">
              <TextArea name="notes" rows={3} maxLength={4000} />
            </Field>
          </ActionForm>
        </div>
      )}
      {editable && mode === 'period' && (
        <div className="vg-inset" style={{ padding: '10px 12px' }}>
          <ActionForm action={setPlanMeetingPeriod} hidden={{ id: plan.id }} onDone={() => setMode('list')} onCancel={() => setMode('list')} submitLabel="Enregistrer">
            <Field name="meetingPeriodDays" label="Périodicité (jours)" hint={`Vide = non fixée. Ex. 30 pour une réunion mensuelle (${MEETING_PERIOD_MIN_DAYS} à ${MEETING_PERIOD_MAX_DAYS} jours).`}>
              <Input name="meetingPeriodDays" type="number" min={MEETING_PERIOD_MIN_DAYS} max={MEETING_PERIOD_MAX_DAYS} step={1} inputMode="numeric" defaultValue={plan.meetingPeriodDays ?? ''} />
            </Field>
          </ActionForm>
        </div>
      )}
    </div>
  );
}
