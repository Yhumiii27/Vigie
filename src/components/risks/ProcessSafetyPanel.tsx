'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { NewActionButton } from '@/components/ActionFormDialog';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { useActionRunner } from '@/components/feedback';
import { ReasonButton } from '@/components/ReasonDialog';
import { ToneTag } from '@/components/ui';
import { Facts, Notice, muted, rowOpener } from '@/components/watch/parts';
import { actionHref } from '@/lib/action-rules';
import type { ActionFormOptions } from '@/lib/action-view';
import { fmtDate } from '@/lib/dates';
import { withCurrent, type Option } from '@/lib/form-options';
import type { StudyView } from '@/lib/data/process-safety';
import {
  FACILITATOR_EXTERNAL_MAX, REPORT_REF_MAX, STUDY_CONCLUSIONS, STUDY_CONCLUSION_KEYS, STUDY_MILESTONES, STUDY_MILESTONE_KEYS, STUDY_TYPES,
  typesOfMilestone, type StudyMilestone,
} from '@/lib/rules/process-safety';
import {
  cancelProcessSafetyStudy, liftStudyReserve, markStudyReserve, reopenProcessSafetyStudy, saveProcessSafetyStudy, validateProcessSafetyStudy,
} from '@/server/process-safety';
import { useI18n } from '@/i18n/client';
import { fill, type T } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';

// Études de sécurité des procédés (VG-01 à VG-05, méthode DIG-PRODI) : vue ?vue=etudes de l'écran « Évaluation des risques »,
// fiche ?etude=<référence> (VG-04) avec ses recommandations (actions QSE). Lecture : rôles de l'écran sauf le Salarié ;
// saisie, validation, réouverture et annulation (motif), réserves bloquantes : animateur QHSE et direction.

/** Listes du formulaire ; projets : keystone.pub_projets (D02), `projectsMessage` si la source est indisponible. */
type Opts = { sites: readonly Option[]; people: readonly Option[]; projects: readonly Option[]; projectsMessage: string | null };

const MILESTONE_OPTIONS = (t: T) => STUDY_MILESTONE_KEYS.map((m) => [m, `${labelT(t)(STUDY_MILESTONES[m].label)} — ${labelT(t)(STUDY_MILESTONES[m].hint)}`] as const);
const CONCLUSION_OPTIONS = (t: T) => STUDY_CONCLUSION_KEYS.map((c) => [c, labelT(t)(STUDY_CONCLUSIONS[c].label)] as const);

export function ProcessSafetyPanel({ rows, cancelled, canManage, options, actionOptions, today, showSite, versions, defaultSite, initialId, closeHref }: {
  rows: StudyView[]; cancelled: StudyView[]; canManage: boolean; options: Opts; actionOptions: ActionFormOptions; today: string; showSite: boolean;
  versions: Record<string, string>; defaultSite: string; initialId?: string; closeHref: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [selId, setSelId] = useState<string | null>(initialId ?? null);
  const [showCancelled, setShowCancelled] = useState(initialId != null && cancelled.some((a) => a.id === initialId));
  const sel = [...rows, ...cancelled].find((r) => r.id === selId) ?? null;
  const close = () => {
    setSelId(null);
    if (initialId != null) router.replace(closeHref, { scroll: false });
  };
  const list = showCancelled ? cancelled : rows;
  return (
    <div className="card" style={{ gap: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="card-title" style={{ fontSize: 14 }}>{t('Process safety studies')}</span>
        <span style={{ ...muted, fontSize: 12 }}>{t('DIG-PRODI method — milestones HS 2, HS 3, HS 4, PSSR and HS 6 of CAPEX and projects')}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {cancelled.length > 0 && (
            <button type="button" className={`vg-chip${showCancelled ? ' is-on' : ''}`} aria-pressed={showCancelled} onClick={() => setShowCancelled((v) => !v)}>
              <i className="ph ph-prohibit" style={{ fontSize: 12 }} aria-hidden />{t('Cancelled studies')}<span style={{ color: 'var(--color-neutral-500)' }}>{cancelled.length}</span>
            </button>
          )}
          {canManage && (
            <DialogButton label={t('New study')} icon="ph-plus" className="btn btn-primary vg-btn-sm" title={t('New safety study')} kicker={t('Process safety studies')} width={680}>
              {(done) => <StudyForm options={options} defaultSite={defaultSite} today={today} onDone={done} onCancel={done} />}
            </DialogButton>
          )}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 760 }}>
          <thead><tr><th>{t('Study')}</th><th>{t('CAPEX / project')}</th><th>{t('Milestone')}</th><th>{t('Session')}</th><th>{t('Status')}</th><th>{t('Recommendations')}</th></tr></thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>
                {showCancelled ? t('No cancelled study.') : t('No process safety study on this site.')}
              </td></tr>
            )}
            {list.map((r) => (
              <tr key={r.id} {...rowOpener(() => setSelId(r.id))} data-obsolete={r.cancelled ? true : undefined}>
                <td>
                  <span style={{ fontWeight: 500 }}>{r.id}</span> · {labelT(t)(r.typeLabel)}
                  {showSite && <div style={{ ...muted, marginTop: 2 }}>{r.siteLabel}</div>}
                </td>
                <td>{r.capexCode ?? '—'}{r.projectCode && <div style={{ ...muted, marginTop: 2 }}>{fill(t('Project {code}'), { code: r.projectCode })}</div>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{labelT(t)(r.milestoneLabel)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {fmtDate(r.sessionOn)}
                  {r.sessionOverdue && <div style={{ fontSize: 11.5, color: 'var(--tone-danger-fg)' }}>{t('Session past')}</div>}
                </td>
                <td>
                  <ToneTag tone={r.statusTone}>{labelT(t)(r.statusLabel)}</ToneTag>
                  {r.conclusionLabel && <div style={{ ...muted, marginTop: 2 }}>{r.conclusionLabel}</div>}
                </td>
                <td><Counts r={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={!!sel} onClose={close} width={760} kicker={sel ? fill(t('Safety study · {site}'), { site: sel.siteLabel }) : undefined} title={sel ? `${sel.id} · ${labelT(t)(sel.typeLabel)} ${sel.capexCode ?? sel.projectCode ?? ''}` : ''}>
        {sel && <StudyDetail key={sel.id} s={sel} canManage={canManage} options={options} actionOptions={actionOptions} today={today} version={versions[sel.id]} onClose={close} />}
      </Dialog>
    </div>
  );
}

/** Décomptes d'une étude : ouvertes / total, retards, réserves bloquantes ouvertes. */
function Counts({ r }: { r: StudyView }) {
  const { t } = useI18n();
  const c = r.counts;
  if (!c.total) return <span style={muted}>{t('No recommendation')}</span>;
  return (
    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span>{fill(c.open > 1 ? t('{n} open items') : t('{n} open item'), { n: c.open })} / {c.total}</span>
      {c.late > 0 && <ToneTag tone="danger">{fill(t('{n} overdue'), { n: c.late })}</ToneTag>}
      {c.blocking > 0 && <ToneTag tone="warn">{fill(c.blocking > 1 ? t('{n} blocking reservations') : t('{n} blocking reservation'), { n: c.blocking })}</ToneTag>}
    </span>
  );
}

function StudyDetail({ s, canManage, options, actionOptions, today, version, onClose }: {
  s: StudyView; canManage: boolean; options: Opts; actionOptions: ActionFormOptions; today: string; version?: string; onClose: () => void;
}) {
  const { t } = useI18n();
  const editable = canManage && !s.cancelled;
  const [view, setView] = useState<'fiche' | 'valider' | 'modifier'>('fiche');
  const [notice, setNotice] = useState<string | null>(null);
  const { pending, run } = useActionRunner();
  const markBlocking = (actionId: string) => {
    const fd = new FormData();
    fd.set('actionId', actionId);
    run(() => markStudyReserve({}, fd), { success: fill(t('Recommendation {id} marked as a blocking reservation.'), { id: actionId }) });
  };
  return (
    <>
      <Facts items={[
        [t('Site'), s.siteLabel],
        [t('CAPEX'), s.capexCode ?? '—'],
        !!s.projectCode && [t('Keystone project'), s.projectCode],
        [t('Milestone'), `${labelT(t)(s.milestoneLabel)} — ${labelT(t)(STUDY_MILESTONES[s.milestone].hint)}`],
        [t('Status'), <ToneTag key="s" tone={s.statusTone}>{labelT(t)(s.statusLabel)}</ToneTag>],
        [t('Session'), `${fmtDate(s.sessionOn)}${s.sessionOverdue ? t(' — past, study still planned') : ''}`],
        !!s.validatedOn && [t('Validated on'), fmtDate(s.validatedOn)],
        !!s.conclusion && [t('Conclusion'), <ToneTag key="c" tone={STUDY_CONCLUSIONS[s.conclusion].tone}>{s.conclusionLabel}</ToneTag>],
        [t('Facilitator'), s.facilitator || '—'],
        [t('Report (Codex)'), s.reportRef ?? '—'],
        s.status !== 'annulee' && [t('Milestone passage'), s.clears ? t('Passed by this study') : t('Not passed by this study')],
      ]} />
      {s.cancelled && <Notice tone="warn" icon="ph-prohibit">{fill(t('Cancelled on {date}'), { date: fmtDate(s.cancelled.on) })}{s.cancelled.by && fill(t(' by {by}'), { by: s.cancelled.by })}{fill(t(' — reason: {reason}'), { reason: s.cancelled.reason })}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {s.scope && (
        <div>
          <div className="vg-eyebrow" style={{ marginBottom: 4 }}>{t('Scope and purpose')}</div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{s.scope}</p>
        </div>
      )}

      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="vg-eyebrow">{t('Recommendations')}</div>
          <Counts r={s} />
          {editable && (
            <span style={{ marginLeft: 'auto' }}>
              <NewActionButton options={actionOptions} label={t('New recommendation')} className="btn btn-secondary vg-btn-sm"
                defaults={{ link: `safetystudy:${s.id}`, linkLabel: `${s.id} · ${labelT(t)(s.typeLabel)} ${s.capexCode ?? s.projectCode ?? ''}`, source: 'hazop', lockSource: true, siteId: s.siteId, domain: 'securite' }} />
            </span>
          )}
        </div>
        {s.recommendations.length === 0 && <span style={{ fontSize: 12, color: 'var(--vg-text-muted)' }}>{t('No recommendation followed in the action plan.')}</span>}
        {s.recommendations.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: 12.5, minWidth: 560 }}>
              <thead><tr><th>{t('Action')}</th><th>{t('Recommendation')}</th><th>{t('Owner')}</th><th>{t('Deadline')}</th><th>{t('Progress')}</th><th>{t('Reservation')}</th></tr></thead>
              <tbody>
                {s.recommendations.map((a) => (
                  <tr key={a.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{a.readable ? <Link href={actionHref(a.id)} className="vg-link">{a.id}</Link> : a.id}</td>
                    <td>{a.readable ? a.label : <span style={muted}>{t('Action of another scope')}</span>}</td>
                    <td>{a.pilot || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{a.dueOn ? fmtDate(a.dueOn) : '—'}</td>
                    <td>{a.statusLabel ? <ToneTag tone={a.statusTone}>{labelT(t)(a.statusLabel)}</ToneTag> : '—'}</td>
                    <td>
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        {a.blocking ? <ToneTag tone={a.closed ? 'neutral' : 'warn'}>{a.closed ? t('Blocking (lifted)') : t('Blocking')}</ToneTag> : <span style={muted}>{t('Not blocking')}</span>}
                        {editable && !a.closed && (a.blocking ? (
                          <ReasonButton label={t('Lift')} className="vg-text-btn" title={t('Lift the blocking reservation')} kicker={`${s.id} · ${a.id}`}
                            action={liftStudyReserve} hidden={{ actionId: a.id }} submitLabel={t('Lift the reservation')}
                            message={t('The recommendation stays followed in the action plan; it no longer blocks the study’s milestone.')}
                            placeholder={t('E.g. compensating measure validated by group HSE')} onDone={() => setNotice(fill(t('Reservation {id} lifted.'), { id: a.id }))} />
                        ) : (
                          <button type="button" className="vg-text-btn" disabled={pending} onClick={() => markBlocking(a.id)}>{t('Make blocking')}</button>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editable && view === 'fiche' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {s.storedStatus !== 'validee' && (
            <button type="button" className="btn btn-primary vg-btn-sm" onClick={() => setView('valider')}><i className="ph ph-seal-check" aria-hidden />{t('Validate the study')}</button>
          )}
          <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setView('modifier')}><i className="ph ph-pencil-simple" aria-hidden />{t('Edit')}</button>
          {s.storedStatus === 'validee' && (
            <ReasonButton label={t('Reopen')} icon="ph-arrow-counter-clockwise" title={t('Reopen the study')} kicker={s.id} action={reopenProcessSafetyStudy} hidden={{ id: s.id }}
              submitLabel={t('Reopen')} message={t('The study goes back to “completed”; its conclusion and validation date are removed (kept in the history).')}
              placeholder={t('E.g. conclusion to review after the report review')} onDone={() => setNotice(t('Study reopened.'))} />
          )}
          <ReasonButton label={t('Cancel the study')} icon="ph-prohibit" title={t('Cancel the study')} kicker={s.id} action={cancelProcessSafetyStudy} hidden={{ id: s.id }}
            submitLabel={t('Cancel the study')} message={t('The study stays readable with its history; it no longer counts for the milestone. Its recommendations stay in the action plan.')}
            placeholder={t('E.g. duplicate entry, CAPEX abandoned')} onDone={onClose} />
        </div>
      )}
      {editable && view === 'valider' && (
        <ActionForm action={validateProcessSafetyStudy} hidden={{ id: s.id, version }} submitLabel={t('Validate study')}
          onDone={() => { setView('fiche'); setNotice(t('Study validated.')); }} onCancel={() => setView('fiche')}>
          <FormRow>
            <Field name="validatedOn" label={t('Validated on')}>
              <Input name="validatedOn" type="date" defaultValue={today} min={s.sessionOn} max={today} />
            </Field>
            <Field name="conclusion" label={t('Conclusion')}>
              <Select name="conclusion" options={CONCLUSION_OPTIONS(t)} defaultValue="" placeholder={t('Choose…')} />
            </Field>
          </FormRow>
          <Field name="reportRef" label={t('Report (Codex reference)')} hint={t('Optional. E.g. NOT-CPX-APM-2026-01-002.')}>
            <Input name="reportRef" defaultValue={s.reportRef ?? ''} maxLength={REPORT_REF_MAX} />
          </Field>
        </ActionForm>
      )}
      {editable && view === 'modifier' && (
        <StudyForm s={s} options={options} defaultSite={s.siteId} today={today} version={version} onDone={() => { setView('fiche'); setNotice(t('Study saved.')); }} onCancel={() => setView('fiche')} />
      )}
      <LazyChangeLog entity="process_safety_study" id={s.id} title={t('Change log')} />
    </>
  );
}

function StudyForm({ s, options, defaultSite, today, version, onDone, onCancel }: {
  s?: StudyView; options: Opts; defaultSite: string; today: string; version?: string; onDone: () => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const STATUS_OPTIONS = [['planifiee', t('Planned')], ['realisee', t('Completed (session held)')]] as const;
  const sites = s ? withCurrent(options.sites, s.siteId, s.siteLabel) : options.sites;
  const people = s ? withCurrent(options.people, s.facilitatorId, fill(t('{name} — left the workforce'), { name: s.facilitator || s.facilitatorId || '' })) : options.people;
  const [milestone, setMilestone] = useState<StudyMilestone>(s?.milestone ?? 'HS2');
  const types = typesOfMilestone(milestone).map((k) => [k, labelT(t)(STUDY_TYPES[k].label)] as const);
  const validated = s?.storedStatus === 'validee';
  return (
    <ActionForm action={saveProcessSafetyStudy} hidden={{ id: s?.id, version: s ? version : undefined }}
      onDone={onDone} onCancel={onCancel} submitLabel={s ? t('Save') : t('Create the study')}>
      <FormRow>
        <Field name="capexCode" label={t('CAPEX code')} hint={t('E.g. CPX-APM-2026-01 (Arche). At least the CAPEX or the project.')}>
          <Input name="capexCode" defaultValue={s?.capexCode ?? ''} maxLength={44} autoFocus={!s} />
        </Field>
        <Field name="keystoneProjectCode" label={t('Keystone project')} hint={options.projectsMessage ?? t('Keystone project, optional.')}>
          <Select name="keystoneProjectCode" options={withCurrent(options.projects, s?.projectCode, s?.projectCode, 'start')} defaultValue={s?.projectCode ?? ''} placeholder={t('No project')} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="milestone" label={t('Milestone')}>
          <Select name="milestone" options={MILESTONE_OPTIONS(t)} value={milestone} onChange={(e) => setMilestone(e.target.value as StudyMilestone)} />
        </Field>
        <Field name="type" label={t('Study type')}>
          <Select key={milestone} name="type" options={types} defaultValue={s && s.milestone === milestone ? s.type : types[0]?.[0]} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="siteId" label={t('Site (plant)')}>
          <Select name="siteId" options={sites} defaultValue={s?.siteId ?? (sites.some(([v]) => v === defaultSite) ? defaultSite : sites[0]?.[0] ?? '')} />
        </Field>
        {validated ? (
          <Field name="status" label={t('Status')} hint={t('Validated: “Reopen” (reason) to change it.')}>
            <output id="status" className="input vg-readonly" aria-live="off">{fill(t('Validated on {date}'), { date: fmtDate(s!.validatedOn!) })}</output>
          </Field>
        ) : (
          <Field name="status" label={t('Status')}>
            <Select name="status" options={STATUS_OPTIONS} defaultValue={s?.storedStatus ?? 'planifiee'} />
          </Field>
        )}
      </FormRow>
      <FormRow>
        <Field name="sessionOn" label={t('Session')} hint={t('Planned or held date.')}>
          <Input name="sessionOn" type="date" defaultValue={s?.sessionOn ?? today} />
        </Field>
        <Field name="reportRef" label={t('Report (Codex reference)')} hint={t('Optional.')}>
          <Input name="reportRef" defaultValue={s?.reportRef ?? ''} maxLength={REPORT_REF_MAX} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="facilitatorId" label={t('Facilitator (workforce)')} hint={t('Receives the deadline of a past session.')}>
          <Select name="facilitatorId" options={people} defaultValue={s?.facilitatorId ?? ''} placeholder={t('Not designated')} />
        </Field>
        <Field name="facilitatorExternal" label={t('or external facilitator')} hint={t('Engineering firm, contractor.')}>
          <Input name="facilitatorExternal" defaultValue={s?.facilitatorExternal ?? ''} maxLength={FACILITATOR_EXTERNAL_MAX} />
        </Field>
      </FormRow>
      <Field name="scope" label={t('Scope and purpose')} hint={t('Installations, nodes studied, input documents.')}>
        <TextArea name="scope" rows={3} maxLength={2000} defaultValue={s?.scope ?? ''} />
      </Field>
    </ActionForm>
  );
}
