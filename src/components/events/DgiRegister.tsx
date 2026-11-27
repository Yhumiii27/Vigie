'use client';

import { useState } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { ReasonButton } from '@/components/ReasonDialog';
import { ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import type { DgiNoticeView } from '@/lib/data/dgi';
import { cancelDgiNotice, closeDgiNotice, recordDgiNotice, saveDgiMeasures, signDgiNotice } from '@/server/dgi';
import { useI18n } from '@/i18n/client';
import { fill, type T } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';

// Registre des dangers graves et imminents (CNF-01) : avis du site, du plus récent au plus ancien ; consignation et
// signature par les membres du CSE, mesures de l'employeur, clôture et annulation motivée par l'animateur QHSE.

type Rights = { record: boolean; sign: boolean; handle: boolean };

/** « AAAA-MM-JJTHH:mm » → « 07/09/2026 à 11:05 ». */
const fmtLocal = (local: string, t: T) => fill(t('{date} at {time}'), { date: fmtDate(local.slice(0, 10)), time: local.slice(11, 16) });
const muted = { fontSize: 11.5, color: 'var(--vg-text-muted)' } as const;

export function DgiNoticeList({ notices, rights, openId }: { notices: DgiNoticeView[]; rights: Rights; openId?: number }) {
  const { t } = useI18n();
  if (!notices.length) return <p style={{ margin: 0, fontSize: 12.5 }} className="vg-muted">{t('No notice recorded in this site’s register.')}</p>;
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
      {[...notices].reverse().map((n) => <DgiNoticeCard key={n.id} n={n} rights={rights} open={n.id === openId} />)}
    </ol>
  );
}

function DgiNoticeCard({ n, rights, open }: { n: DgiNoticeView; rights: Rights; open: boolean }) {
  const { t } = useI18n();
  const [measuring, setMeasuring] = useState(false);
  const live = !n.cancelled && !n.closed;
  return (
    <li id={`avis-${n.id}`} className="card" style={{ gap: 8, padding: '12px 14px', outline: open ? '2px solid var(--color-accent)' : undefined }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline', textDecoration: n.cancelled ? 'line-through' : undefined }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{fill(t('Notice no. {n}'), { n: n.number })}</h3>
        <span>{fmtLocal(n.reportedAt, t)}</span>
        <ToneTag tone={n.stateTone}>{labelT(t)(n.stateLabel)}</ToneTag>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 190px) 1fr', gap: '4px 12px', margin: 0, fontSize: 12.5 }}>
        <dt style={muted}>{t('Workstation(s)')}</dt><dd style={{ margin: 0, whiteSpace: 'pre-line' }}>{n.workstations}</dd>
        <dt style={muted}>{t('Nature and cause of the danger')}</dt><dd style={{ margin: 0, whiteSpace: 'pre-line' }}>{n.danger}</dd>
        <dt style={muted}>{t('Exposed workers')}</dt><dd style={{ margin: 0, whiteSpace: 'pre-line' }}>{n.exposedWorkers}</dd>
        <dt style={muted}>{t('CSE representative')}</dt><dd style={{ margin: 0 }}>{n.representativeName}</dd>
        <dt style={muted}>{t('Signature')}</dt><dd style={{ margin: 0 }}>{n.signed ? fill(t('Signed on {date} by {name}'), { date: fmtLocal(n.signed.at, t), name: n.signed.by }) : t('To sign by a CSE member')}</dd>
        {n.eventId && <><dt style={muted}>{t('Linked event')}</dt><dd style={{ margin: 0 }}><a href={`/evenements?etat=tous&sel=${encodeURIComponent(n.eventId)}`} className="vg-link">{n.eventId}</a></dd></>}
        <dt style={muted}>{t('Employer’s measures')}</dt>
        <dd style={{ margin: 0, whiteSpace: 'pre-line' }}>{n.measures ? <>{n.measures.text}<span style={{ ...muted, display: 'block' }}>{fill(t('Recorded on {date} by {name}#fplural'), { date: fmtLocal(n.measures.at, t), name: n.measures.by })}</span></> : '—'}</dd>
        {n.closed && <><dt style={muted}>{t('Closure')}</dt><dd style={{ margin: 0 }}>{fill(t('On {date} by {name}'), { date: fmtLocal(n.closed.at, t), name: n.closed.by })}</dd></>}
      </dl>
      {n.cancelled && <span style={muted}>{fill(t('Cancelled on {date} by {name} — reason: {reason}'), { date: fmtDate(n.cancelled.on), name: n.cancelled.by, reason: n.cancelled.reason })}</span>}
      {live && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {rights.sign && !n.signed && (
            <ActionFormButton label={t('Sign the notice')} action={signDgiNotice} id={n.id} />
          )}
          {rights.handle && !measuring && (
            <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setMeasuring(true)}>
              <i className="ph ph-shield-check" aria-hidden />{n.measures ? t('Edit the measures') : t('Record the measures taken')}
            </button>
          )}
          {rights.handle && n.measures && n.signed && <ActionFormButton label={t('Close the notice')} action={closeDgiNotice} id={n.id} />}
          {rights.handle && (
            <ReasonButton label={t('Cancel this entry')} icon="ph-prohibit" title={t('Cancel the notice')} kicker={fill(t('Notice no. {n}'), { n: n.number })}
              action={cancelDgiNotice} hidden={{ id: n.id }} submitLabel={t('Cancel the notice')} submitIcon="ph-prohibit"
              message={t('Wrong entry: the notice is never deleted; it stays in the register, struck through, with its reason, and its number is not reassigned.')}
              placeholder={t('E.g. duplicate of notice no. 3')} />
          )}
        </div>
      )}
      {live && rights.handle && measuring && (
        <div className="vg-inset" style={{ padding: '10px 12px' }}>
          <ActionForm action={saveDgiMeasures} hidden={{ id: n.id }} onDone={() => setMeasuring(false)} onCancel={() => setMeasuring(false)} submitLabel={t('Record the measures')}>
            <Field name="measures" label={t('Measures taken by the employer')} hint={t('Investigation, protective measures, stopping the installation, follow-up given (L. 4132-2).')}>
              <TextArea name="measures" rows={4} maxLength={4000} defaultValue={n.measures?.text ?? ''} autoFocus />
            </Field>
          </ActionForm>
        </div>
      )}
    </li>
  );
}

/** Bouton d'une action sans saisie (signature, clôture) : formulaire réduit à la confirmation. */
function ActionFormButton({ label, action, id }: { label: string; action: typeof signDgiNotice; id: number }) {
  const { t } = useI18n();
  return (
    <DialogButton label={label} title={label} className="btn btn-primary vg-btn-sm" width={420}>
      {(close) => (
        <ActionForm action={action} hidden={{ id }} onDone={close} onCancel={close} submitLabel={label}>
          <p style={{ margin: 0, fontSize: 13 }}>{t('Time-stamped in your name; written to the notice’s log.')}</p>
        </ActionForm>
      )}
    </DialogButton>
  );
}

/** « Consigner un avis » : membre du CSE (signé d'emblée) ou animateur QHSE (avis recopié, à signer). */
export function RecordDgiButton({ sites, siteId, nowLocal, defaultName, signs }: {
  sites: readonly (readonly [string, string])[]; siteId: string; nowLocal: string; defaultName: string; signs: boolean;
}) {
  const { t } = useI18n();
  return (
    <DialogButton label={t('Record a notice')} icon="ph-plus" className="btn btn-primary vg-btn-sm" title={t('Notice of serious and imminent danger')} kicker={t('Register of serious and imminent dangers')} width={640}>
      {(close) => (
        <ActionForm action={recordDgiNotice} onDone={close} onCancel={close} submitLabel={signs ? t('Record and sign') : t('Record the notice')}>
          <p style={{ margin: 0, fontSize: 12.5 }} className="vg-muted">
            {signs ? t('As a staff representative on the CSE, the notice is dated and signed in your name (D. 4132-1).') : t('Notice copied: it will remain to be signed by a CSE member.')}
          </p>
          <FormRow>
            <Field name="siteId" label={t('Site')}>
              <Select name="siteId" options={sites} defaultValue={siteId} />
            </Field>
            <Field name="reportedAt" label={t('Date and time of the alert')}>
              <Input name="reportedAt" type="datetime-local" defaultValue={nowLocal} max={nowLocal} />
            </Field>
          </FormRow>
          <Field name="workstations" label={t('Workstation(s) concerned')}>
            <Input name="workstations" maxLength={500} autoFocus />
          </Field>
          <Field name="danger" label={t('Nature and cause of the danger')}>
            <TextArea name="danger" rows={3} maxLength={4000} />
          </Field>
          <Field name="exposedWorkers" label={t('Name of the exposed workers')}>
            <TextArea name="exposedWorkers" rows={2} maxLength={2000} />
          </Field>
          <FormRow>
            <Field name="representativeName" label={t('Staff representative on the CSE')}>
              <Input name="representativeName" maxLength={120} defaultValue={defaultName} />
            </Field>
            <Field name="eventId" label={t('Linked event')} hint={t('EV-… reference of the same site (optional).')}>
              <Input name="eventId" maxLength={40} placeholder="EV-2026-…" />
            </Field>
          </FormRow>
        </ActionForm>
      )}
    </DialogButton>
  );
}
