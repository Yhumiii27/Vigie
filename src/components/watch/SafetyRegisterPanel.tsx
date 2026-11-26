'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { ReasonButton } from '@/components/ReasonDialog';
import { ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { SAFETY_NOTICE_KINDS, SAFETY_NOTICE_KIND_KEYS } from '@/lib/domain';
import { type Option, withCurrent } from '@/lib/form-options';
import type { SafetyNoticeView } from '@/lib/data/watch';
import { answerSafetyNotice, cancelSafetyNotice, saveSafetyNotice } from '@/server/watch';
import { Facts, Notice, muted, rowOpener } from './parts';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

// Registre de sécurité (VEI-15, L. 4711-1 et L. 4711-2) : observations et mises en demeure de l'inspection du travail, de
// la CARSAT ou d'un organisme, avec le délai de réponse et la réponse apportée ; imprimé avec les vérifications du site
// (/veille/registre-securite). Saisie par l'encadrement de la veille ; annulation motivée par le service QHSE.

/** Équipements proposés : [identifiant, libellé, site] (contrôles en service ; site null = commun à tous les sites). */
export type NoticeControlOption = readonly [string, string, string | null];
type Opts = { sites: readonly Option[]; controls: readonly NoticeControlOption[] };

const KIND_OPTIONS = SAFETY_NOTICE_KIND_KEYS.map((k) => [k, SAFETY_NOTICE_KINDS[k].label] as const);

export function SafetyRegisterPanel({ rows, canManage, canApprove, options, today, showSite, initialId, closeHref }: {
  rows: SafetyNoticeView[];
  canManage: boolean;
  /** Animateur QHSE, direction : annulation d'une saisie erronée. */
  canApprove: boolean;
  options: Opts;
  today: string;
  showSite: boolean;
  /** Observation à ouvrir d'emblée (lien profond `?observation=<id>`). */
  initialId?: number;
  closeHref?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [selId, setSelId] = useState<number | null>(initialId ?? null);
  const sel = rows.find((r) => r.id === selId) ?? null;
  const close = () => {
    setSelId(null);
    if (closeHref) router.replace(closeHref, { scroll: false });
  };
  return (
    <div className="card" style={{ padding: '6px 14px 10px' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 860 }}>
          <thead><tr><th>{t('Received on')}</th><th>{t('Nature')}</th><th>{t('Issuer')}</th><th>{t('Subject')}</th><th>{t('Deadline#response')}</th><th>{t('State')}</th></tr></thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>{t('No observation or formal notice recorded.')}</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} {...rowOpener(() => setSelId(r.id))} data-obsolete={r.cancelled ? true : undefined}>
                <td style={{ whiteSpace: 'nowrap', textDecoration: r.cancelled ? 'line-through' : undefined }}>
                  {fmtDate(r.receivedOn)}
                  {showSite && <div style={{ ...muted, marginTop: 2 }}>{r.siteLabel}</div>}
                </td>
                <td><ToneTag tone={r.cancelled ? 'neutral' : r.tone} style={{ whiteSpace: 'nowrap' }}>{r.kindLabel}</ToneTag></td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.authority}{r.reference && <div style={{ ...muted, marginTop: 2 }}>{r.reference}</div>}</td>
                <td style={{ color: 'var(--color-neutral-300)', maxWidth: 360, textWrap: 'pretty' }}>
                  {r.text}
                  {r.control && <div style={{ ...muted, marginTop: 2 }}>{r.control}</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.dueOn ? fmtDate(r.dueOn) : '—'}</td>
                <td><ToneTag tone={r.state.tone} style={{ whiteSpace: 'nowrap' }}>{r.state.label}</ToneTag></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={!!sel} onClose={close} width={640} kicker={sel ? `${t('Safety register')} · ${sel.siteLabel}` : undefined}
        title={sel ? `${sel.kindLabel} · ${sel.authority}` : ''}>
        {sel && <NoticeDetail key={sel.id} n={sel} canManage={canManage} canApprove={canApprove} options={options} today={today} onClose={close} />}
      </Dialog>
    </div>
  );
}

/** Bouton « Inscrire une observation ». */
export function AddSafetyNoticeButton({ options, defaultSite, today }: { options: Opts; defaultSite: string; today: string }) {
  const { t } = useI18n();
  return (
    <DialogButton label={t('Record an observation')} icon="ph-plus" className="btn btn-primary vg-btn-sm" title={t('Observation or formal notice')} kicker={t('Safety register')} width={640}>
      {(close) => <NoticeForm options={options} defaultSite={defaultSite} today={today} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

function NoticeDetail({ n, canManage, canApprove, options, today, onClose }: {
  n: SafetyNoticeView; canManage: boolean; canApprove: boolean; options: Opts; today: string; onClose: () => void;
}) {
  const { t } = useI18n();
  const editable = canManage && !n.cancelled;
  const [view, setView] = useState<'fiche' | 'reponse' | 'modifier'>('fiche');
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <Facts items={[
        [t('Nature'), <ToneTag key="k" tone={n.cancelled ? 'neutral' : n.tone}>{n.kindLabel}</ToneTag>],
        [t('Received on'), fmtDate(n.receivedOn)],
        [t('Issuer'), n.authority],
        !!n.reference && [t('Reference'), n.reference],
        [t('Response deadline'), n.dueOn ? fmtDate(n.dueOn) : t('Not set')],
        [t('State'), <ToneTag key="s" tone={n.state.tone}>{n.state.label}</ToneTag>],
        !!n.control && [t('Equipment'), n.controlId ? <Link key="c" href={`/veille?onglet=controles&controle=${n.controlId}`} className="vg-link" style={{ fontSize: 12.5 }}>{n.control}</Link> : n.control],
      ]} />
      {n.cancelled && (
        <Notice>{fill(t('Cancelled on {date}'), { date: n.cancelled.on })}{n.cancelled.by && fill(t(' by {name}'), { name: n.cancelled.by })}{t(' — reason: ')}{n.cancelled.reason}</Notice>
      )}
      {notice && <Notice>{notice}</Notice>}
      <div>
        <div className="vg-eyebrow" style={{ marginBottom: 4 }}>{t('Observations or prescriptions')}</div>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{n.text}</p>
      </div>
      {n.answeredOn && (
        <div>
          <div className="vg-eyebrow" style={{ marginBottom: 4 }}>{fill(t('Answer of {date}'), { date: fmtDate(n.answeredOn) })}{n.answeredBy && ` · ${n.answeredBy}`}</div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{n.answer}</p>
        </div>
      )}
      {editable && view === 'fiche' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary vg-btn-sm" onClick={() => setView('reponse')}>
            <i className="ph ph-envelope-simple" aria-hidden />{n.answeredOn ? t('Correct the answer') : t('Save the answer')}
          </button>
          <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setView('modifier')}><i className="ph ph-pencil-simple" aria-hidden />{t('Edit')}</button>
          {canApprove && (
            <ReasonButton label={t('Cancel the entry#wrong')} icon="ph-prohibit" title={t('Cancel the observation')} kicker={`${n.kindLabel} · ${n.authority}`}
              action={cancelSafetyNotice} hidden={{ id: n.id }} submitLabel={t('Cancel the observation')} submitIcon="ph-prohibit"
              message={t('Wrong entry: the observation is never deleted; it stays in the register, struck through, with its reason, and leaves the deadlines.')}
              placeholder={t('E.g. duplicate, entered on the wrong site')} onDone={() => setNotice(t('Observation cancelled.'))} />
          )}
        </div>
      )}
      {editable && view === 'reponse' && (
        <ActionForm action={answerSafetyNotice} hidden={{ id: n.id }} onDone={() => { setView('fiche'); setNotice(t('Answer recorded.')); }} onCancel={() => setView('fiche')}
          submitLabel={t('Save the answer')} submitIcon="ph-envelope-simple">
          <Field name="answeredOn" label={t('Answer given on')}>
            <Input name="answeredOn" type="date" defaultValue={n.answeredOn ?? today} min={n.receivedOn} max={today} />
          </Field>
          <Field name="answer" label={t('Answer')} hint={t('Compliance work done, answer letter, reference of the supporting document.')}>
            <TextArea name="answer" rows={3} maxLength={2000} defaultValue={n.answer ?? ''} />
          </Field>
        </ActionForm>
      )}
      {editable && view === 'modifier' && (
        <NoticeForm n={n} options={options} defaultSite={n.siteId} today={today} onDone={onClose} onCancel={() => setView('fiche')} />
      )}
      <LazyChangeLog entity="safety_notice" id={n.id} title={t('Change log')} />
    </>
  );
}

function NoticeForm({ n, options, defaultSite, today, onDone, onCancel }: {
  n?: SafetyNoticeView; options: Opts; defaultSite: string; today: string; onDone: () => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const [siteId, setSiteId] = useState(n?.siteId ?? defaultSite);
  // Site archivé encore porté par l'observation : conservé comme choix.
  const sites = withCurrent(options.sites, n?.siteId, n?.siteLabel);
  const controls = options.controls.filter(([, , s]) => !s || s === siteId).map(([v, l]) => [v, l] as const);
  return (
    <ActionForm action={saveSafetyNotice} hidden={{ id: n?.id, version: n?.version }} onDone={onDone} onCancel={onCancel} submitLabel={n ? t('Save') : t('Record in the register')}>
      <FormRow>
        <Field name="kind" label={t('Nature')}>
          <Select name="kind" options={KIND_OPTIONS} defaultValue={n?.kind ?? 'observation'} />
        </Field>
        <Field name="siteId" label={t('Site')}>
          <Select name="siteId" options={sites} value={siteId} onChange={(e) => setSiteId(e.target.value)} placeholder={t('Choose…')} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="authority" label={t('Issuer')} hint={t('Labour inspectorate, CARSAT, approved body…')}>
          <Input name="authority" defaultValue={n?.authority ?? ''} maxLength={120} placeholder={t('E.g. Labour inspectorate')} autoFocus={!n} />
        </Field>
        <Field name="reference" label={t('Reference')} hint={t('Letter, report (optional).')}>
          <Input name="reference" defaultValue={n?.reference ?? ''} maxLength={60} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="receivedOn" label={t('Received on')}>
          <Input name="receivedOn" type="date" defaultValue={n?.receivedOn ?? today} max={today} />
        </Field>
        <Field name="dueOn" label={t('Response deadline')} hint={t('Compliance or answer expected (optional).')}>
          <Input name="dueOn" type="date" defaultValue={n?.dueOn ?? ''} />
        </Field>
      </FormRow>
      <Field name="text" label={t('Observations or prescriptions')}>
        <TextArea name="text" rows={3} maxLength={2000} defaultValue={n?.text ?? ''} />
      </Field>
      <Field name="controlId" label={t('Equipment concerned')} hint={t('Periodic inspection of the site (optional).')}>
        <Select name="controlId" options={controls} defaultValue={n?.controlId != null ? String(n.controlId) : ''} placeholder={t('None#m')} />
      </Field>
    </ActionForm>
  );
}
