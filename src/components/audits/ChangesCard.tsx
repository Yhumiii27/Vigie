'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { ReasonButton } from '@/components/ReasonDialog';
import { Aside, CardHead, ToneTag } from '@/components/ui';
import { Facts, Notice, muted, rowOpener } from '@/components/watch/parts';
import { fmtDate } from '@/lib/dates';
import { CHANGE_KINDS, CHANGE_KIND_KEYS } from '@/lib/domain';
import { withCurrent, type Option } from '@/lib/form-options';
import type { ChangeView } from '@/lib/data/changes';
import { cancelChangeRequest, completeChangeRequest, decideChangeRequest, saveChangeRequest } from '@/server/changes';
import { RadioSeg } from './parts';
import { useI18n } from '@/i18n/client';
import { labelT } from '@/i18n/labels';
import { fill, type T } from '@/i18n/translate';

// Gestion des changements (CNF-11, ISO 9001 §6.3 et §8.5.6, ISO 45001 §8.1.3) : demandes de changement, effets évalués,
// décision du service QHSE, mise en œuvre constatée. Lecture : lecteurs de l'écran Audits ; saisie : animateur QHSE et
// direction (canEdit(role, 'audits')).

type Opts = { people: readonly Option[]; sites: readonly Option[] };
const KIND_OPTIONS = (t: T) => CHANGE_KIND_KEYS.map((k) => [k, labelT(t)(CHANGE_KINDS[k].label)] as const);

export function ChangesCard({ rows, canEdit, canApprove, options, versions, today, initialId, closeHref }: {
  rows: ChangeView[]; canEdit: boolean; canApprove: boolean; options: Opts; versions: Record<string, string>; today: string;
  initialId?: string; closeHref: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [selId, setSelId] = useState<string | null>(initialId ?? null);
  const [showClosed, setShowClosed] = useState(false);
  const sel = rows.find((r) => r.id === selId) ?? null;
  const close = () => {
    setSelId(null);
    if (initialId) router.replace(closeHref, { scroll: false });
  };
  const closed = (r: ChangeView) => !!r.cancelled || r.status === 'refusee' || r.status === 'realisee';
  const open = rows.filter((r) => !closed(r));
  const list = showClosed ? rows.filter(closed) : open;
  return (
    <div id="changements" className="card" style={{ gap: 10, scrollMarginTop: 16 }}>
      <CardHead title={t('Change management')} aside={(
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Aside>ISO 9001 §6.3 · §8.5.6 · ISO 45001 §8.1.3</Aside>
          {rows.length > open.length && (
            <button type="button" className={`vg-chip${showClosed ? ' is-on' : ''}`} aria-pressed={showClosed} onClick={() => setShowClosed((v) => !v)}>
              {t('Handled#fplural')}<span style={{ color: 'var(--color-neutral-500)' }}>{rows.length - open.length}</span>
            </button>
          )}
          {canEdit && (
            <DialogButton label={t('New request')} icon="ph-plus" title={t('Change request')} kicker={t('Change management')} width={640}>
              {(done) => <ChangeForm options={options} onDone={done} onCancel={done} />}
            </DialogButton>
          )}
        </span>
      )} />
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 720 }}>
          <thead><tr><th>{t('Ref.')}</th><th>{t('Change#request')}</th><th>{t('Nature')}</th><th>{t('Implementation')}</th><th>{t('State')}</th></tr></thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={5} style={{ color: 'var(--color-neutral-500)', padding: '12px 8px' }}>{showClosed ? t('No request handled.') : t('No change request in progress.')}</td></tr>
            )}
            {list.map((r) => (
              <tr key={r.id} {...rowOpener(() => setSelId(r.id))} data-obsolete={r.cancelled ? true : undefined}>
                <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{r.id}</td>
                <td>{r.title}<div style={{ ...muted, marginTop: 2 }}>{r.siteLabel}{r.pilot && ` · ${r.pilot}`}</div></td>
                <td>{labelT(t)(r.kindLabel)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.done ? fill(t('on {date}'), { date: fmtDate(r.done.on) }) : r.plannedOn ? fill(t('planned on {date}#f'), { date: fmtDate(r.plannedOn) }) : '—'}</td>
                <td><ToneTag tone={r.tone} style={{ whiteSpace: 'nowrap' }}>{labelT(t)(r.statusLabel)}</ToneTag></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={!!sel} onClose={close} width={680} kicker={sel ? `${t('Change management')} · ${sel.id}` : undefined} title={sel?.title ?? ''}>
        {sel && <ChangeDetail key={sel.id} c={sel} canEdit={canEdit} canApprove={canApprove} options={options} version={versions[sel.id]} today={today} onClose={close} />}
      </Dialog>
    </div>
  );
}

function ChangeDetail({ c, canEdit, canApprove, options, version, today, onClose }: {
  c: ChangeView; canEdit: boolean; canApprove: boolean; options: Opts; version?: string; today: string; onClose: () => void;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<'fiche' | 'modifier' | 'decision' | 'realisation'>('fiche');
  const [notice, setNotice] = useState<string | null>(null);
  const live = !c.cancelled;
  const editable = canEdit && live && (c.status === 'demandee' || c.status === 'acceptee');
  const text = (label: string, value: string) => value && (
    <div>
      <div className="vg-eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{value}</p>
    </div>
  );
  return (
    <>
      <Facts items={[
        [t('State'), <ToneTag key="s" tone={c.tone}>{labelT(t)(c.statusLabel)}</ToneTag>],
        [t('Nature'), labelT(t)(c.kindLabel)],
        [t('Site'), c.siteLabel],
        [t('Lead'), c.pilot || '—'],
        [t('Implementation planned'), c.plannedOn ? fmtDate(c.plannedOn) : '—'],
        [t('Requested on#f'), `${fmtDate(c.createdOn)}${c.createdBy ? fill(t(' by {name}'), { name: c.createdBy }) : ''}`],
        !!c.decided && [t('Decision'), fill(c.status === 'refusee' ? t('Refused on {date}') : t('Accepted on {date}'), { date: fmtDate(c.decided.on) }) + (c.decided.by ? fill(t(' by {name}'), { name: c.decided.by }) : '')],
        !!c.done && [t('Implementation'), fill(t('on {date}'), { date: fmtDate(c.done.on) })],
      ]} />
      {c.cancelled && <Notice tone="warn" icon="ph-prohibit">{fill(t('Cancelled on {date}'), { date: fmtDate(c.cancelled.on) })}{c.cancelled.by && fill(t(' by {name}'), { name: c.cancelled.by })}{t(' — reason: ')}{c.cancelled.reason}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {text(t('Description'), c.description)}
      {text(t('Reason for the change'), c.rationale)}
      {text(t('Effects assessed (risks, resources, requirements, documents)'), c.impacts)}
      {c.decided && text(t('Justification of the decision'), c.decided.note)}
      {c.done && text(t('Implementation noted'), c.done.note)}
      {live && view === 'fiche' && (canEdit || canApprove) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {canApprove && c.status === 'demandee' && (
            <button type="button" className="btn btn-primary vg-btn-sm" onClick={() => setView('decision')}><i className="ph ph-gavel" aria-hidden />{t('Decide')}</button>
          )}
          {canEdit && c.status === 'acceptee' && (
            <button type="button" className="btn btn-primary vg-btn-sm" onClick={() => setView('realisation')}><i className="ph ph-check-circle" aria-hidden />{t('Implementation noted')}</button>
          )}
          {editable && <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setView('modifier')}><i className="ph ph-pencil-simple" aria-hidden />{t('Edit')}</button>}
          {canApprove && c.status !== 'realisee' && (
            <ReasonButton label={t('Cancel the request')} icon="ph-prohibit" title={t('Cancel the change request')} kicker={c.id} action={cancelChangeRequest} hidden={{ id: c.id }}
              submitLabel={t('Cancel the request')} message={t('The request is never deleted: it stays in the register, struck through, with its reason, and leaves the deadlines.')}
              placeholder={t('E.g. duplicate, change abandoned')} onDone={() => setNotice(t('Request cancelled.'))} />
          )}
        </div>
      )}
      {view === 'decision' && (
        <DecisionForm c={c} today={today} onDone={() => { setView('fiche'); setNotice(t('Decision recorded.')); }} onCancel={() => setView('fiche')} />
      )}
      {view === 'realisation' && (
        <ActionForm action={completeChangeRequest} hidden={{ id: c.id }} submitLabel={t('Save the implementation')} onDone={() => { setView('fiche'); setNotice(t('Implementation recorded.')); }} onCancel={() => setView('fiche')}>
          <Field name="doneOn" label={t('Implemented on')}><Input name="doneOn" type="date" defaultValue={today} max={today} /></Field>
          <Field name="doneNote" label={t('Finding')} hint={t('What was done, documents updated, people informed or trained.')}>
            <TextArea name="doneNote" rows={3} maxLength={2000} />
          </Field>
        </ActionForm>
      )}
      {view === 'modifier' && <ChangeForm c={c} options={options} version={version} onDone={onClose} onCancel={() => setView('fiche')} />}
      <LazyChangeLog entity="change_request" id={c.id} title={t('Change log')} />
    </>
  );
}

function DecisionForm({ c, today, onDone, onCancel }: { c: ChangeView; today: string; onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [decision, setDecision] = useState('acceptee');
  return (
    <ActionForm action={decideChangeRequest} hidden={{ id: c.id }} submitLabel={t('Save the decision')} onDone={onDone} onCancel={onCancel}>
      <Field name="decision" group label={t('Decision')}>
        <RadioSeg name="decision" defaultValue="acceptee" onChange={setDecision} options={[['acceptee', t('Accept')], ['refusee', t('Refuse')]]} />
      </Field>
      <FormRow>
        <Field name="decidedOn" label={t('Decided on')}><Input name="decidedOn" type="date" defaultValue={today} max={today} /></Field>
        {decision === 'acceptee' && (
          <Field name="plannedOn" label={t('Implementation planned on')} hint={t('Optional.')}><Input name="plannedOn" type="date" defaultValue={c.plannedOn ?? ''} /></Field>
        )}
      </FormRow>
      <Field name="decisionNote" label={t('Justification')} hint={t('Effects assessed, conditions, resources granted or reason for the refusal.')}>
        <TextArea name="decisionNote" rows={3} maxLength={2000} />
      </Field>
    </ActionForm>
  );
}

function ChangeForm({ c, options, version, onDone, onCancel }: { c?: ChangeView; options: Opts; version?: string; onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const sites = c ? withCurrent(options.sites, c.siteId ?? 'all', c.siteLabel) : options.sites;
  const people = c ? withCurrent(options.people, c.pilotId, `${c.pilot || c.pilotId}${t(' — left the workforce')}`) : options.people;
  return (
    <ActionForm action={saveChangeRequest} hidden={{ id: c?.id, version: c ? version : undefined }} onDone={onDone} onCancel={onCancel} submitLabel={c ? t('Save') : t('Save the request')}>
      <Field name="title" label={t('Change#request')} hint={t('E.g. New paint booth, reorganisation of the store.')}>
        <Input name="title" defaultValue={c?.title ?? ''} maxLength={160} autoFocus={!c} />
      </Field>
      <FormRow>
        <Field name="kind" label={t('Nature')}><Select name="kind" options={KIND_OPTIONS(t).map(([k, l]) => [k, labelT(t)(l)] as const)} defaultValue={c?.kind ?? 'procede'} /></Field>
        <Field name="siteId" label={t('Site')}><Select name="siteId" options={sites} defaultValue={c ? c.siteId ?? 'all' : sites[0]?.[0] ?? ''} /></Field>
      </FormRow>
      <Field name="description" label={t('Description')}><TextArea name="description" rows={3} maxLength={2000} defaultValue={c?.description ?? ''} /></Field>
      <Field name="rationale" label={t('Reason for the change')} hint={t('Why change: need, opportunity, new requirement.')}>
        <TextArea name="rationale" rows={2} maxLength={2000} defaultValue={c?.rationale ?? ''} />
      </Field>
      <Field name="impacts" label={t('Effects assessed')} hint={t('Risks and opportunities, consequences on safety, resources, requirements and documents.')}>
        <TextArea name="impacts" rows={3} maxLength={2000} defaultValue={c?.impacts ?? ''} />
      </Field>
      <FormRow>
        <Field name="pilotId" label={t('Lead')}><Select name="pilotId" options={people} defaultValue={c?.pilotId ?? ''} placeholder={t('Not appointed')} /></Field>
        <Field name="plannedOn" label={t('Implementation planned on')} hint={t('Optional.')}><Input name="plannedOn" type="date" defaultValue={c?.plannedOn ?? ''} /></Field>
      </FormRow>
    </ActionForm>
  );
}
