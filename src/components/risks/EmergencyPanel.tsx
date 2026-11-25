'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { ReasonButton } from '@/components/ReasonDialog';
import { ToneTag } from '@/components/ui';
import { Facts, Notice, muted, rowOpener } from '@/components/watch/parts';
import { fmtDate } from '@/lib/dates';
import { DRILL_PERIODS } from '@/lib/emergency-rules';
import { withCurrent, type Option } from '@/lib/form-options';
import type { EmergencyView } from '@/lib/data/emergencies';
import { archiveEmergencySituation, cancelEmergencyDrill, recordEmergencyDrill, saveEmergencySituation } from '@/server/emergencies';
import { useI18n } from '@/i18n/client';
import { fill, type T } from '@/i18n/translate';

// Situations d'urgence (CNF-08, ISO 45001 §8.2, ISO 14001 §8.2) : situations identifiées par site, moyens et consignes,
// exercices planifiés et tenus. Vue ?vue=urgences de l'écran « Évaluation des risques » ; saisie : canEdit(role, 'risks') ;
// archivage et annulation d'un exercice : animateur QHSE et direction (motif).

type Opts = { sites: readonly Option[]; people: readonly Option[] };

const periodOptions = (t: T) => DRILL_PERIODS.map((m) => [String(m), m === 6 ? t('Every 6 months') : m === 12 ? t('Every year') : fill(t('Every {n} years'), { n: m / 12 })] as const);

export function EmergencyPanel({ rows, archived, canManage, canApprove, options, today, showSite, versions, defaultSite, initialId, closeHref }: {
  rows: EmergencyView[]; archived: EmergencyView[]; canManage: boolean; canApprove: boolean; options: Opts; today: string; showSite: boolean;
  versions: Record<string, string>; defaultSite: string; initialId?: number; closeHref: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [selId, setSelId] = useState<number | null>(initialId ?? null);
  const [showArchived, setShowArchived] = useState(initialId != null && archived.some((a) => a.id === initialId));
  const all = [...rows, ...archived];
  const sel = all.find((r) => r.id === selId) ?? null;
  const close = () => {
    setSelId(null);
    if (initialId != null) router.replace(closeHref, { scroll: false });
  };
  const list = showArchived ? archived : rows;
  return (
    <div className="card" style={{ gap: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="card-title" style={{ fontSize: 14 }}>{t('Emergency situations')}</span>
        <span style={{ ...muted, fontSize: 12 }}>{t('ISO 45001 §8.2 · ISO 14001 §8.2 — drills planned and traced')}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {archived.length > 0 && (
            <button type="button" className={`vg-chip${showArchived ? ' is-on' : ''}`} aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
              <i className="ph ph-archive" style={{ fontSize: 12 }} aria-hidden />{t('Archived situations')}<span style={{ color: 'var(--color-neutral-500)' }}>{archived.length}</span>
            </button>
          )}
          {canManage && (
            <DialogButton label={t('Identify a situation')} icon="ph-plus" className="btn btn-primary vg-btn-sm" title={t('New emergency situation')} kicker={t('Emergency situations')} width={640}>
              {(done) => <SituationForm options={options} defaultSite={defaultSite} onDone={done} onCancel={done} />}
            </DialogButton>
          )}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 720 }}>
          <thead><tr><th>{t('Situation')}</th><th>{t('Frequency')}</th><th>{t('Last drill')}</th><th>{t('Next drill')}</th><th>{t('Owner')}</th></tr></thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={5} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>
                {showArchived ? t('No archived situation.') : t('No emergency situation identified on this site.')}
              </td></tr>
            )}
            {list.map((r) => (
              <tr key={r.id} {...rowOpener(() => setSelId(r.id))} data-obsolete={r.archived ? true : undefined}>
                <td>{r.label}{showSite && <div style={{ ...muted, marginTop: 2 }}>{r.siteLabel}</div>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fill(t('{n} months'), { n: r.drillMonths })}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.lastHeldOn ? fmtDate(r.lastHeldOn) : t('None')}</td>
                <td>{r.due ? <ToneTag tone={r.due.tone} style={{ whiteSpace: 'nowrap' }}>{r.due.label}</ToneTag> : <span style={muted}>{t('Archived situation')}</span>}</td>
                <td>{r.owner || <span style={muted}>{canManage || canApprove ? t('Site QHSE manager') : '—'}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={!!sel} onClose={close} width={680} kicker={sel ? fill(t('Emergency situation · {site}'), { site: sel.siteLabel }) : undefined} title={sel?.label ?? ''}>
        {sel && <SituationDetail key={sel.id} s={sel} canManage={canManage} canApprove={canApprove} options={options} today={today} version={versions[String(sel.id)]} onClose={close} />}
      </Dialog>
    </div>
  );
}

function SituationDetail({ s, canManage, canApprove, options, today, version, onClose }: {
  s: EmergencyView; canManage: boolean; canApprove: boolean; options: Opts; today: string; version?: string; onClose: () => void;
}) {
  const { t } = useI18n();
  const editable = canManage && !s.archived;
  const [view, setView] = useState<'fiche' | 'exercice' | 'modifier'>('fiche');
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <Facts items={[
        [t('Site'), s.siteLabel],
        [t('Drill frequency'), fill(t('{n} months'), { n: s.drillMonths })],
        [t('Next drill'), s.due ? <ToneTag key="d" tone={s.due.tone}>{s.due.label}</ToneTag> : '—'],
        !!s.due?.plannedLate && [t('Planned drill'), fill(t('{date} — after the frequency deadline'), { date: fmtDate(s.nextDrillOn!) })],
        [t('Owner'), s.owner || t('Site QHSE manager')],
        [t('Identified on'), fmtDate(s.createdOn)],
      ]} />
      {s.archived && <Notice tone="warn" icon="ph-archive">{fill(t('Situation archived on {date}'), { date: fmtDate(s.archived.on) })}{s.archived.by && fill(t(' by {by}'), { by: s.archived.by })}{fill(t(' — reason: {reason}'), { reason: s.archived.reason })}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {s.scenario && (
        <div>
          <div className="vg-eyebrow" style={{ marginBottom: 4 }}>{t('Scenario')}</div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{s.scenario}</p>
        </div>
      )}
      {s.response && (
        <div>
          <div className="vg-eyebrow" style={{ marginBottom: 4 }}>{t('Response means and instructions')}</div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{s.response}</p>
        </div>
      )}
      <div style={{ display: 'grid', gap: 6 }}>
        <div className="vg-eyebrow">{t('Drills')}</div>
        {s.drills.length === 0 && <span style={{ fontSize: 12, color: 'var(--vg-text-muted)' }}>{t('No drill traced.')}</span>}
        {s.drills.map((d) => (
          <div key={d.id} style={{ display: 'grid', gap: 2, fontSize: 12.5 }}>
            <span style={d.cancelled ? { textDecoration: 'line-through', color: 'var(--color-neutral-400)' } : { fontWeight: 500 }}>{fill(t('Drill of {date}'), { date: fmtDate(d.heldOn) })}{d.by && fill(t(' · entered by {by}'), { by: d.by })}</span>
            {d.participants && <span style={{ color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>{fill(t('Participants: {list}'), { list: d.participants })}</span>}
            {d.findings && <span style={{ color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{d.findings}</span>}
            {d.cancelled ? (
              <span style={{ fontSize: 11.5, color: 'var(--vg-text-muted)' }}>{fill(t('Drill cancelled on {date}'), { date: fmtDate(d.cancelled.on) })}{d.cancelled.by && fill(t(' by {by}'), { by: d.cancelled.by })}{fill(t(' · Reason: {reason}'), { reason: d.cancelled.reason })}</span>
            ) : canApprove && !s.archived && (
              <ReasonButton label={t('Cancel the drill')} className="vg-text-btn" style={{ justifySelf: 'start' }} title={t('Cancel the drill')} kicker={s.label}
                action={cancelEmergencyDrill} hidden={{ id: d.id }} submitLabel={t('Cancel the drill')} placeholder={t('E.g. entered on the wrong situation')}
                message={t('The drill stays in the history, struck through; the next drill is recomputed.')} onDone={() => setNotice(t('Drill cancelled.'))} />
            )}
          </div>
        ))}
      </div>
      {editable && view === 'fiche' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary vg-btn-sm" onClick={() => setView('exercice')}><i className="ph ph-siren" aria-hidden />{t('Record a drill')}</button>
          <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setView('modifier')}><i className="ph ph-pencil-simple" aria-hidden />{t('Edit')}</button>
          {canApprove && (
            <ReasonButton label={t('Archive')} icon="ph-archive" title={t('Archive the emergency situation')} kicker={s.label} action={archiveEmergencySituation} hidden={{ id: s.id }}
              submitLabel={t('Archive')} message={t('The situation leaves the drill follow-up; it stays readable with its drills and history.')}
              placeholder={t('E.g. installation dismantled')} onDone={onClose} />
          )}
        </div>
      )}
      {editable && view === 'exercice' && (
        <ActionForm action={recordEmergencyDrill} hidden={{ situationId: s.id }} submitLabel={t('Save the drill')} onDone={() => { setView('fiche'); setNotice(t('Drill saved.')); }} onCancel={() => setView('fiche')}>
          <Field name="heldOn" label={t('Held on')}>
            <Input name="heldOn" type="date" defaultValue={today} max={today} />
          </Field>
          <Field name="participants" label={t('Participants')} hint={t('Departments, teams, number of people, external emergency services.')}>
            <TextArea name="participants" rows={2} maxLength={1000} />
          </Field>
          <Field name="findings" label={t('Course and lessons learned')} hint={t('Evacuation time, gaps found, improvements to plan.')}>
            <TextArea name="findings" rows={3} maxLength={2000} />
          </Field>
        </ActionForm>
      )}
      {editable && view === 'modifier' && (
        <SituationForm s={s} options={options} defaultSite={s.siteId} version={version} onDone={onClose} onCancel={() => setView('fiche')} />
      )}
      <LazyChangeLog entity="emergency_situation" id={s.id} title={t('Change log')} />
    </>
  );
}

function SituationForm({ s, options, defaultSite, version, onDone, onCancel }: {
  s?: EmergencyView; options: Opts; defaultSite: string; version?: string; onDone: () => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const PERIOD_OPTIONS = periodOptions(t);
  const sites = s ? withCurrent(options.sites, s.siteId, s.siteLabel) : options.sites;
  const people = s ? withCurrent(options.people, s.ownerId, fill(t('{name} — left the workforce'), { name: s.owner || s.ownerId || '' })) : options.people;
  const periods = s && !PERIOD_OPTIONS.some(([v]) => v === String(s.drillMonths)) ? [...PERIOD_OPTIONS, [String(s.drillMonths), fill(t('Every {n} months'), { n: s.drillMonths })] as const] : PERIOD_OPTIONS;
  return (
    <ActionForm action={saveEmergencySituation} hidden={{ id: s?.id, version: s ? version : undefined }} onDone={onDone} onCancel={onCancel} submitLabel={s ? t('Save') : t('Identify the situation')}>
      <FormRow>
        <Field name="label" label={t('Emergency situation')} hint={t('E.g. Workshop fire, chemical spill.')}>
          <Input name="label" defaultValue={s?.label ?? ''} maxLength={160} autoFocus={!s} />
        </Field>
        <Field name="siteId" label={t('Site')}>
          <Select name="siteId" options={sites} defaultValue={s?.siteId ?? (sites.some(([v]) => v === defaultSite) ? defaultSite : sites[0]?.[0] ?? '')} />
        </Field>
      </FormRow>
      <Field name="scenario" label={t('Scenario')} hint={t('What can happen, where, and its possible consequences.')}>
        <TextArea name="scenario" rows={2} maxLength={2000} defaultValue={s?.scenario ?? ''} />
      </Field>
      <Field name="response" label={t('Response means and instructions')} hint={t('Means, posted instructions, trained people, external emergency services.')}>
        <TextArea name="response" rows={2} maxLength={2000} defaultValue={s?.response ?? ''} />
      </Field>
      <FormRow>
        <Field name="drillMonths" label={t('Drill frequency')}>
          <Select name="drillMonths" options={periods} defaultValue={String(s?.drillMonths ?? 12)} />
        </Field>
        <Field name="nextDrillOn" label={t('Next drill planned on')} hint={t('Optional.')}>
          <Input name="nextDrillOn" type="date" defaultValue={s?.nextDrillOn ?? ''} />
        </Field>
      </FormRow>
      <Field name="ownerId" label={t('Owner')} hint={t('Without an owner: the site QHSE manager receives the deadline.')}>
        <Select name="ownerId" options={people} defaultValue={s?.ownerId ?? ''} placeholder={t('Not designated')} />
      </Field>
    </ActionForm>
  );
}
