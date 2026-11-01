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
  const siteOptions: Option[] = [['', 'Tous les sites'], ...sites];
  return (
    <ActionForm action={saveDuerpAccessRequest} hidden={request ? { id: request.id } : undefined} onDone={onDone} onCancel={onCancel}
      submitLabel={request ? 'Enregistrer' : 'Enregistrer la demande'}>
      <FormRow cols={3}>
        <Field name="requestedOn" label="Date de la demande">
          <Input name="requestedOn" type="date" defaultValue={request?.requestedOn ?? today} max={today} />
        </Field>
        <Field name="requesterKind" label="Demandeur">
          <Select name="requesterKind" options={KIND_OPTIONS} defaultValue={request?.requesterKind ?? ''} placeholder="Choisir…" />
        </Field>
        <Field name="requesterName" label="Nom ou organisme">
          <Input name="requesterName" defaultValue={request?.requesterName ?? ''} maxLength={120} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="siteId" label="Établissement">
          <Select name="siteId" options={siteOptions} defaultValue={request ? request.siteId ?? '' : defaultSiteId} />
        </Field>
        <Field name="version" label="Version communiquée"
          hint="Ancien salarié : une ligne par version en vigueur pendant son activité. Vigie ne connaît pas les dates d'embauche : vérifiez-les au dossier du personnel.">
          <Select name="version" options={versions} defaultValue={request?.version ?? currentVersion ?? ''} placeholder="Choisir…" />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="communicatedOn" label="Communiquée le" hint="Vide tant que la demande est en attente.">
          <Input name="communicatedOn" type="date" defaultValue={request?.communicatedOn ?? ''} max={today} />
        </Field>
        <Field name="channel" label="Modalité" hint="« Consultation dans Vigie » : mise à disposition formelle, notée ici.">
          <Select name="channel" options={CHANNEL_OPTIONS} defaultValue={request?.channel ?? ''} placeholder="—" />
        </Field>
      </FormRow>
      <Field name="note" label="Note">
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
          <div className="card-kicker">Registre · Code du travail, R. 4121-4</div>
          <div className="card-title" style={{ fontSize: 15 }}>Mises à disposition du DUERP</div>
          <span style={muted}>
            {requests.length - cancelledCount} demande{requests.length - cancelledCount > 1 ? 's' : ''}
            {pending > 0 && <span style={{ color: TONE.warn.fg }}> · {pending} en attente</span>}
          </span>
        </div>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {cancelledCount > 0 && (
            <label className="vg-check" style={{ fontSize: 12 }}>
              <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
              <span className="vg-check-box"><i className="ph ph-check" aria-hidden /></span>
              <span>Afficher les annulées ({cancelledCount})</span>
            </label>
          )}
          <DialogButton label="Nouvelle demande" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Nouvelle demande d'accès" kicker="DUERP · mise à disposition" width={680}>
            {(close) => <RequestFields {...fieldProps} onDone={close} onCancel={close} />}
          </DialogButton>
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
        Une ligne par version communiquée. Les consultations courantes dans Vigie ne sont pas enregistrées automatiquement :
        notez ici les mises à disposition formelles (ancien salarié, instances, organismes).
      </p>
      <ScrollX label="Registre des mises à disposition">
        <table className="table" style={{ fontSize: 12.5, minWidth: 760 }}>
          <thead>
            <tr><th>Demande le</th><th>Demandeur</th>{showSite && <th>Site</th>}<th>Version</th><th>Communiquée</th><th>Note</th><th /></tr>
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
                    <ToneTag tone="neutral">Annulée</ToneTag>
                  ) : r.communicatedOn ? (
                    <>
                      <div style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.communicatedOn)}</div>
                      {r.channelLabel && <div style={muted}>{r.channelLabel}</div>}
                    </>
                  ) : (
                    <ToneTag tone="warn">En attente</ToneTag>
                  )}
                </td>
                <td style={{ verticalAlign: 'top', color: 'var(--color-neutral-300)', maxWidth: 280, textWrap: 'pretty' }}>
                  {r.note || <span style={{ color: 'var(--vg-text-muted)' }}>—</span>}
                  {r.cancelled && <div style={muted}>{archivedLabel(r.cancelled, 'Annulée')}{r.cancelled.reason ? ` · ${r.cancelled.reason}` : ''}</div>}
                </td>
                <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-flex', gap: 10 }}>
                    {r.cancelled ? (
                      <DialogButton label="Historique" className="vg-text-btn" title={r.requesterName} kicker={`Demande annulée · ${r.requesterKindLabel}`} width={560}>
                        {() => <LazyChangeLog entity="duerp_access_request" id={r.id} />}
                      </DialogButton>
                    ) : (
                      <>
                        <DialogButton label="Modifier" className="vg-text-btn" title={r.requesterName} kicker={`Demande d'accès · ${r.requesterKindLabel}`} width={680}>
                          {(close) => (
                            <div style={{ display: 'grid', gap: 12 }}>
                              <RequestFields {...fieldProps} request={r} onDone={close} onCancel={close} />
                              <LazyChangeLog entity="duerp_access_request" id={r.id} />
                            </div>
                          )}
                        </DialogButton>
                        <ReasonButton label="Annuler" className="vg-text-btn" title="Annuler la demande" kicker={`${r.requesterKindLabel} · DUERP ${r.version}`}
                          action={cancelDuerpAccessRequest} hidden={{ id: r.id }} submitLabel="Annuler la demande"
                          placeholder="Ex. saisie en double, demande retirée…"
                          message="La demande reste au registre, grisée, avec son motif et son historique." />
                      </>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={cols} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>Aucune demande d&apos;accès enregistrée pour ce site.</td></tr>
            )}
          </tbody>
        </table>
      </ScrollX>
    </div>
  );
}
