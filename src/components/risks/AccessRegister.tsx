'use client';

import { useState } from 'react';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { ReasonButton } from '@/components/ReasonDialog';
import { ToneTag, ScrollX } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { DUERP_ACCESS_CHANNELS, DUERP_REQUESTERS, TONE } from '@/lib/domain';
import type { Option } from '@/lib/form-options';
import type { DuerpAccessRequestView } from '@/lib/data/risks';
import { cancelDuerpAccessRequest, saveDuerpAccessRequest } from '@/server/risks';
import { archivedLabel } from './RiskSheet';
import { useI18n } from '@/i18n/client';
import { labelT } from '@/i18n/labels';
import { fill } from '@/i18n/translate';

const KIND_OPTIONS = Object.entries(DUERP_REQUESTERS) as [string, string][];
const CHANNEL_OPTIONS = Object.entries(DUERP_ACCESS_CHANNELS) as [string, string][];
const muted = { fontSize: 11.5, color: 'var(--color-neutral-500)' } as const;

type FieldsProps = {
  request?: DuerpAccessRequestView;
  versions: readonly Option[];
  sites: readonly Option[];
  defaultSiteId: string;
  today: string;
  currentVersion: string | null;
  onDone: () => void;
  onCancel: () => void;
};

/** Champs d'une demande d'accès : demandeur, établissement, version, date et modalité de la mise à disposition. */
function RequestFields({ request, versions, sites, defaultSiteId, today, currentVersion, onDone, onCancel }: FieldsProps) {
  const { t } = useI18n();
  const siteOptions: Option[] = [['', t('All sites')], ...sites];
  return (
    <ActionForm action={saveDuerpAccessRequest} hidden={request ? { id: request.id } : undefined} onDone={onDone} onCancel={onCancel}
      submitLabel={request ? t('Save') : t('Save the request')}>
      <FormRow cols={3}>
        <Field name="requestedOn" label={t('Request date')}>
          <Input name="requestedOn" type="date" defaultValue={request?.requestedOn ?? today} max={today} />
        </Field>
        <Field name="requesterKind" label={t('Requester')}>
          <Select name="requesterKind" options={KIND_OPTIONS} defaultValue={request?.requesterKind ?? ''} placeholder={t('Choose…')} />
        </Field>
        <Field name="requesterName" label={t('Name or organisation')}>
          <Input name="requesterName" defaultValue={request?.requesterName ?? ''} maxLength={120} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="siteId" label={t('Establishment')}>
          <Select name="siteId" options={siteOptions} defaultValue={request ? request.siteId ?? '' : defaultSiteId} />
        </Field>
        <Field name="version" label={t('Version communicated')}
          hint={t('Former employee: one line per version in force during their activity. Vigie does not know hiring dates: check them in the personnel file.')}>
          <Select name="version" options={versions} defaultValue={request?.version ?? currentVersion ?? ''} placeholder={t('Choose…')} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="communicatedOn" label={t('Communicated on')} hint={t('Empty while the request is pending.')}>
          <Input name="communicatedOn" type="date" defaultValue={request?.communicatedOn ?? ''} max={today} />
        </Field>
        <Field name="channel" label={t('Method')} hint={t('“Consultation in Vigie”: formal provision, recorded here.')}>
          <Select name="channel" options={CHANNEL_OPTIONS.map(([k, l]) => [k, labelT(t)(l)] as [string, string])} defaultValue={request?.channel ?? ''} placeholder="—" />
        </Field>
      </FormRow>
      <Field name="note" label={t('Note')}>
        <TextArea name="note" rows={2} maxLength={1000} defaultValue={request?.note ?? ''} />
      </Field>
    </ActionForm>
  );
}

/**
 * Registre des mises à disposition du DUERP (R. 4121-4, DUE-01) : demandes des anciens salariés, du CSE, du médecin du
 * travail, de l'inspection, de la CARSAT ; animateur QHSE et direction seulement. Jamais de suppression : une demande
 * saisie par erreur est annulée avec un motif (affichée grisée avec « Afficher les annulées »).
 */
export function AccessRegister({ requests, versions, sites, showSite, defaultSiteId, today, currentVersion }: {
  requests: DuerpAccessRequestView[];
  versions: readonly Option[];
  sites: readonly Option[];
  /** « Tous les sites » : colonne Site. */
  showSite: boolean;
  /** Établissement proposé pour une nouvelle demande ('' = tous les sites). */
  defaultSiteId: string;
  today: string;
  currentVersion: string | null;
}) {
  const { t } = useI18n();
  const [showCancelled, setShowCancelled] = useState(false);
  const cancelledCount = requests.filter((r) => r.cancelled).length;
  const rows = showCancelled ? requests : requests.filter((r) => !r.cancelled);
  const pending = requests.filter((r) => r.pending).length;
  const fieldProps = { versions, sites, defaultSiteId, today, currentVersion };
  const cols = showSite ? 7 : 6;

  return (
    <div className="card" style={{ gap: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: 2 }}>
          <div className="card-kicker">{t('Register · Labour Code, R. 4121-4')}</div>
          <div className="card-title" style={{ fontSize: 15 }}>{t('DUERP access provisions')}</div>
          <span style={muted}>
            {fill(requests.length - cancelledCount > 1 ? t('{n} requests') : t('{n} request'), { n: requests.length - cancelledCount })}
            {pending > 0 && <span style={{ color: TONE.warn.fg }}> · {fill(t('{n} pending'), { n: pending })}</span>}
          </span>
        </div>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {cancelledCount > 0 && (
            <label className="vg-check" style={{ fontSize: 12 }}>
              <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
              <span className="vg-check-box"><i className="ph ph-check" aria-hidden /></span>
              <span>{fill(t('Show the cancelled ones ({n})'), { n: cancelledCount })}</span>
            </label>
          )}
          <DialogButton label={t('New request')} icon="ph-plus" className="btn btn-primary vg-btn-sm" title={t('New access request')} kicker={t('DUERP · provision')} width={680}>
            {(close) => <RequestFields {...fieldProps} onDone={close} onCancel={close} />}
          </DialogButton>
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
        {t('One line per version communicated. Routine consultations in Vigie are not recorded automatically: note here the formal provisions (former employee, bodies, organisations).')}
      </p>
      <ScrollX label={t('Register of provisions')}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 760 }}>
          <thead>
            <tr><th>{t('Requested on')}</th><th>{t('Requester')}</th>{showSite && <th>{t('Site')}</th>}<th>{t('Version')}</th><th>{t('Communicated')}</th><th>{t('Note')}</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-obsolete={r.cancelled || undefined}>
                <td style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>{fmtDate(r.requestedOn)}</td>
                <td style={{ verticalAlign: 'top' }}>
                  <div style={{ fontWeight: 500, textDecoration: r.cancelled ? 'line-through' : undefined }}>{r.requesterName}</div>
                  <div style={muted}>{r.requesterKindLabel}</div>
                </td>
                {showSite && <td style={{ verticalAlign: 'top', color: 'var(--color-neutral-300)' }}>{r.site}</td>}
                <td style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>{r.version}</td>
                <td style={{ verticalAlign: 'top' }}>
                  {r.cancelled ? (
                    <ToneTag tone="neutral">{t('Cancelled')}</ToneTag>
                  ) : r.communicatedOn ? (
                    <>
                      <div style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.communicatedOn)}</div>
                      {r.channelLabel && <div style={muted}>{labelT(t)(r.channelLabel)}</div>}
                    </>
                  ) : (
                    <ToneTag tone="warn">{t('Pending')}</ToneTag>
                  )}
                </td>
                <td style={{ verticalAlign: 'top', color: 'var(--color-neutral-300)', maxWidth: 280, textWrap: 'pretty' }}>
                  {r.note || <span style={{ color: 'var(--vg-text-muted)' }}>—</span>}
                  {r.cancelled && <div style={muted}>{archivedLabel(t, r.cancelled, 'cancelled')}{r.cancelled.reason ? ` · ${r.cancelled.reason}` : ''}</div>}
                </td>
                <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-flex', gap: 10 }}>
                    {r.cancelled ? (
                      <DialogButton label={t('History')} className="vg-text-btn" title={r.requesterName} kicker={fill(t('Cancelled request · {kind}'), { kind: r.requesterKindLabel })} width={560}>
                        {() => <LazyChangeLog entity="duerp_access_request" id={r.id} />}
                      </DialogButton>
                    ) : (
                      <>
                        <DialogButton label={t('Edit')} className="vg-text-btn" title={r.requesterName} kicker={fill(t('Access request · {kind}'), { kind: r.requesterKindLabel })} width={680}>
                          {(close) => (
                            <div style={{ display: 'grid', gap: 12 }}>
                              <RequestFields {...fieldProps} request={r} onDone={close} onCancel={close} />
                              <LazyChangeLog entity="duerp_access_request" id={r.id} />
                            </div>
                          )}
                        </DialogButton>
                        <ReasonButton label={t('Cancel')} className="vg-text-btn" title={t('Cancel the request')} kicker={`${r.requesterKindLabel} · DUERP ${r.version}`}
                          action={cancelDuerpAccessRequest} hidden={{ id: r.id }} submitLabel={t('Cancel the request')}
                          placeholder={t('E.g. duplicate entry, request withdrawn…')}
                          message={t('The request stays in the register, greyed out, with its reason and history.')} />
                      </>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={cols} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>{t('No access request recorded for this site.')}</td></tr>
            )}
          </tbody>
        </table>
      </ScrollX>
    </div>
  );
}
