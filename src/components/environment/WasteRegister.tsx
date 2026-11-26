'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { EntityFiles } from '@/components/EntityFiles';
import { ReasonButton } from '@/components/ReasonDialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { Icon, ToneTag } from '@/components/ui';
import { fmtDate, parisDay } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import type { EntryDetail, EntryView, EventOption, StreamView } from '@/lib/data/environment';
import { cancelWasteEntry, saveWasteEntry } from '@/server/environment';
import { fmtSiret } from '@/lib/siret';
import {
  BSD_PLACEHOLDER, BSD_STALE_DAYS, BSD_STATUS, BSD_STATUS_KEYS, QUALIFICATION_KEYS, REGISTER_MENTIONS, TREATMENT_QUALIFICATIONS, fmtQty, isTransitCode, lcfirst,
  qualificationError, qualificationLabel, treatmentLabel,
} from '@/lib/rules/environment';
import { CompanyIdField, LinkedActions, Note, Suggestions, muted, rowOpener, shortSite, type ActionOptions, type Carrier } from './parts';
import { entryActionDefaults } from './action-defaults';
import { withCurrent } from '@/lib/form-options';
import { fill, type T } from '@/i18n/translate';
import { useI18n } from '@/i18n/client';

export type StreamOption = Pick<StreamView,
  | 'id' | 'label' | 'ewcCode' | 'hazardous' | 'unit' | 'collector' | 'destination' | 'treatmentCode' | 'channel' | 'site' | 'siteId'
  | 'pop' | 'qualification' | 'collectorSiret' | 'collectorAddress' | 'collectorReceipt' | 'destinationSiret' | 'destinationAddress' | 'archived' | 'siteArchived'>;

/** Filière proposée pour un nouvel enlèvement : en service (DOC-09) et sur un site en service (DOC-20). */
const offeredStream = (s: StreamOption) => !s.archived && !s.siteArchived;

const BSD_OPTIONS = BSD_STATUS_KEYS.map((k) => [k, BSD_STATUS[k].label] as const);
const QUALIFICATION_OPTIONS = QUALIFICATION_KEYS.map((k) => [k, TREATMENT_QUALIFICATIONS[k]] as const);
const RECEIPT_HINT = 'Receipt of the waste transport declaration (R. 541-50); “Exempted” if not subject.';
const NO_CARRIER: Carrier = { siret: null, address: null, receipt: null };
const collectorOf = (s: StreamOption | undefined): Carrier =>
  s ? { siret: s.collectorSiret, address: s.collectorAddress, receipt: s.collectorReceipt } : NO_CARRIER;

/** Où compléter chaque mention manquante d'un enlèvement. */
function gapHelp(e: EntryView, t: T): string[] {
  const has = (m: string) => e.gaps.includes(m);
  return [
    (has(REGISTER_MENTIONS.transporterSiret) || has(REGISTER_MENTIONS.transporterAddress) || has(REGISTER_MENTIONS.transporterReceipt))
      && t('carrier: SIRET, address and receipt in the form below'),
    has(REGISTER_MENTIONS.qualification) && t('qualification: in the form below'),
    (has(REGISTER_MENTIONS.destinationSiret) || has(REGISTER_MENTIONS.destinationAddress)) && fill(t('facility: on the waste stream {id} (“Waste streams” tab)'), { id: e.streamId }),
    has(REGISTER_MENTIONS.siteSiret) && t('SIRET of the establishment: “Enter the SIRET” button above the register'),
  ].filter((x): x is string => !!x);
}

// ─── Tableau du registre ────────────────────────────────────────────────────

export function WasteRegister({ entries, lookup = entries, streams, canManage, showSite, today, emptyText, transporters, carriers, events, actionOptions, canSeeEvents, initialId, closeHref }: {
  entries: EntryDetail[];
  /** Enlèvements où chercher la fiche ouverte (année entière, annulés compris) ; par défaut les lignes affichées. */
  lookup?: EntryDetail[];
  /** Fiche ouverte d'emblée (lien profond `?enlevement=<id>`, DOC-08). */
  initialId?: number;
  /** URL sans le lien profond, rétablie à la fermeture. */
  closeHref?: string;
  streams: StreamOption[];
  canManage: boolean;
  /** « Tous les sites » : rappelle le site de chaque enlèvement. */
  showSite: boolean;
  today: string;
  emptyText: string;
  transporters: string[];
  /** Identité connue des transporteurs (SIRET, adresse, récépissé), proposée à la saisie du nom. */
  carriers: Record<string, Carrier>;
  /** Événements environnementaux ouverts, pour le champ « Événement lié ». */
  events: readonly EventOption[];
  /** Listes de choix du formulaire d'action (null : création d'action non permise). */
  actionOptions: ActionOptions | null;
  canSeeEvents: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [selId, setSelId] = useState<number | null>(initialId ?? null);
  const entry = selId != null ? lookup.find((e) => e.id === selId) ?? null : null;
  const close = () => {
    setSelId(null);
    if (initialId != null && closeHref) router.replace(closeHref, { scroll: false });
  };
  const cols = 9;

  return (
    <div className="card" style={{ padding: '6px 14px 10px' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 1040 }}>
          <thead>
            <tr>
              <th style={{ whiteSpace: 'nowrap' }}>{t('Removal date')}</th><th>{t('Waste')}</th><th>{t('Waste code')}</th><th>{t('Hazardous')}</th><th style={{ textAlign: 'right' }}>{t('Quantity')}</th>
              <th>{t('Carrier')}</th><th>{t('Outlet')}</th><th>{t('Treatment')}</th><th>{t('Slip (BSD)')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr><td colSpan={cols} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>{emptyText}</td></tr>
            )}
            {entries.map((e) => (
              <tr key={e.id} {...(canManage ? rowOpener(() => setSelId(e.id)) : {})} data-obsolete={e.cancelled || undefined}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {fmtDate(e.removedOn)}
                  {showSite && <div style={muted}>{shortSite(e.site)}</div>}
                </td>
                <td style={{ minWidth: 170 }}>
                  {e.stream}
                  {e.notes && <div style={{ ...muted, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.notes}>{e.notes}</div>}
                  {e.gaps.length > 0 && (
                    <div style={{ ...muted, color: TONE.warn.fg }} title={fill(t('Missing mentions: {gaps}'), { gaps: e.gaps.join(' · ') })}>{t('Incomplete mentions')} · {e.gaps.length}</div>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-300)' }}>{e.ewcCode}</td>
                <td>{e.hazardous ? <ToneTag tone="warn">{t('Hazardous')}</ToneTag> : <span style={{ color: 'var(--vg-text-muted)' }}>{t('No')}</span>}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtQty(e.quantity, e.unit)}</td>
                <td style={{ color: 'var(--color-neutral-300)' }}>{e.transporter}</td>
                <td style={{ color: 'var(--color-neutral-400)', minWidth: 160 }}>{e.destination}</td>
                <td style={{ whiteSpace: 'nowrap' }} title={treatmentLabel(e.treatmentCode)}>
                  <span style={{ fontWeight: 500 }}>{e.treatmentCode}</span>
                  <span style={{ ...muted, marginLeft: 6 }}>{e.recovery ? t('recovery') : t('disposal')}</span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {e.cancelled ? (
                    <span title={fill(t('Cancelled by {name}: {reason}'), { name: e.cancelled.by, reason: e.cancelled.reason })}><ToneTag tone="neutral">{t('Cancelled#m')}</ToneTag></span>
                  ) : e.missingBsd ? (
                    <ToneTag tone="danger"><Icon name="ph-warning" size={11} style={{ marginRight: 4 }} />{t('Missing slip')}</ToneTag>
                  ) : e.bsdNumber ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-300)' }}>{e.bsdNumber}</span>
                      {e.bsdLabel && <ToneTag tone={e.bsdTone}>{e.bsdLabel}</ToneTag>}
                      {e.staleBsd && (
                        <span title={fill(t('Slip not finalised {n} d after the removal: final treatment to check.'), { n: e.age })} style={{ display: 'inline-flex', color: TONE.warn.dot }}>
                          <Icon name="ph-hourglass-medium" size={13} />
                        </span>
                      )}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--vg-text-muted)' }} title={t('Slip not required for a non-hazardous waste')}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!entry} onClose={close} width={620}
        kicker={entry ? `${t('Waste register')} · ${fill(t('no. {id}'), { id: entry.id })} · ${shortSite(entry.site)}` : undefined}
        title={entry ? `${entry.stream} · ${fmtDate(entry.removedOn)}` : ''}>
        {entry && <EntryPanel key={entry.id} entry={entry} streams={streams} today={today} showSite={showSite} transporters={transporters} carriers={carriers}
          events={events} actionOptions={actionOptions} canSeeEvents={canSeeEvents} onClose={close} />}
      </Dialog>
    </div>
  );
}

/** Fiche d'un enlèvement : événement d'origine, actions liées, formulaire, annulation tracée et historique. */
function EntryPanel({ entry, streams, today, showSite, transporters, carriers, events, actionOptions, canSeeEvents, onClose }: {
  entry: EntryDetail; streams: StreamOption[]; today: string; showSite: boolean; transporters: string[]; carriers: Record<string, Carrier>;
  events: readonly EventOption[]; actionOptions: ActionOptions | null; canSeeEvents: boolean; onClose: () => void;
}) {
  const { t } = useI18n();
  const event = entry.event && (canSeeEvents
    ? <Link href={`/evenements?sel=${encodeURIComponent(entry.event.id)}`} className="vg-link">{entry.event.id}</Link>
    : <span>{entry.event.id}</span>);
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {entry.cancelled && (
        <Note icon="ph-prohibit">
          {fill(t('Removal cancelled on {date} by {name}: {reason}'), { date: fmtDate(parisDay(new Date(entry.cancelled.at))), name: entry.cancelled.by, reason: entry.cancelled.reason })}
          {' '}{t('It stays recorded in the register for traceability, outside the indicators, deadlines and export.')}
        </Note>
      )}
      {entry.event && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--color-neutral-300)' }}>
          <Icon name="ph-warning-diamond" size={14} style={{ color: TONE.warn.dot }} />
          <span>{t('Removal following the event ')}{event}{entry.event.title ? ` · ${entry.event.title}` : ''}</span>
        </div>
      )}
      {entry.gaps.length > 0 && (
        <Note icon="ph-warning" tone="warn">
          {fill(t('Required mentions missing (order of 31 May 2021): {gaps}.'), { gaps: entry.gaps.join(' · ') })}
          <span style={{ display: 'block', marginTop: 2, color: 'var(--color-neutral-400)' }}>{t('To complete — ')}{gapHelp(entry, t).join(' ; ')}.</span>
        </Note>
      )}
      {entry.bsdRefusedQuantity != null && (
        <Note icon="ph-prohibit" tone="warn">
          {fill(t('Slip {number} “{status}”: quantity refused by the facility {qty}'), { number: entry.bsdNumber ?? '', status: entry.bsdLabel?.toLowerCase() ?? '', qty: fmtQty(entry.bsdRefusedQuantity, entry.unit) })}
          {entry.bsdRefusalReason ? ` — ${entry.bsdRefusalReason}` : ''}{t('. The refused waste comes back to the site: record its new waste stream.')}
        </Note>
      )}
      {entry.staleBsd && (
        <Note icon="ph-hourglass-medium" tone="warn">
          {fill(t('Slip {number} still “{status}” {n} days after the removal (threshold {days} d): chase the destination facility to obtain the treatment certificate.'), { number: entry.bsdNumber ?? '', status: entry.bsdLabel?.toLowerCase() ?? '', n: entry.age, days: BSD_STALE_DAYS })}
        </Note>
      )}
      <LinkedActions actions={entry.actions} options={entry.cancelled ? null : actionOptions} canAct={!entry.cancelled}
        defaults={entryActionDefaults(entry, today)} />
      {/* DOC-11 : bordereau, certificat d'acceptation ou de traitement ; figés sur un enlèvement annulé. */}
      <EntityFiles kind="waste_entry" entityId={entry.id} title={t('Slip and certificates')} kicker={`${entry.stream} · ${fmtDate(entry.removedOn)}`}
        files={entry.files} canAdd={!entry.cancelled} emptyText={t('No attachment.')}
        hint={t('Slip, prior acceptance certificate, treatment certificate · 10 MB per file.')} />
      {!entry.cancelled && (
        <section style={{ display: 'grid', gap: 8 }}>
          <h6 className="vg-h6">{t('Removal')}</h6>
          <EntryForm entry={entry} streams={streams} today={today} showSite={showSite} transporters={transporters} carriers={carriers} events={events} onDone={onClose} onCancel={onClose} />
        </section>
      )}
      <LazyChangeLog entity="waste_entry" id={entry.id} />
      {!entry.cancelled && (
        <div style={{ display: 'flex', justifyContent: 'flex-start', paddingTop: 10, background: 'var(--rule-soft) no-repeat top / 100% 1px' }}>
          <ReasonButton label={t('Cancel the removal')} icon="ph-prohibit" className="btn btn-ghost vg-btn-sm" style={{ color: 'var(--tone-danger-fg)' }}
            title={t('Cancel the removal')} kicker={`${entry.stream} · ${fmtDate(entry.removedOn)}`} action={cancelWasteEntry} hidden={{ id: entry.id }}
            submitLabel={t('Cancel the removal')} submitIcon="ph-prohibit" placeholder={t('E.g. duplicate of the removal of 08/07, wrong waste stream…')}
            message={fill(t('The removal of {date} ({stream}, {qty}) stays recorded in the register, marked cancelled: it leaves the indicators, the deadlines and the export. This operation cannot be undone.'), { date: fmtDate(entry.removedOn), stream: entry.stream, qty: fmtQty(entry.quantity, entry.unit) })}
            onDone={onClose} />
        </div>
      )}
    </div>
  );
}

/** Bouton « Nouvel enlèvement ». */
export function NewEntryButton({ streams, today, showSite, transporters, carriers, defaultStreamId, events }: {
  streams: StreamOption[]; today: string; showSite: boolean; transporters: string[]; carriers: Record<string, Carrier>; defaultStreamId?: string; events: readonly EventOption[];
}) {
  const { t } = useI18n();
  const none = !streams.some(offeredStream);
  return (
    <DialogButton label={t('New removal')} icon="ph-plus" className="btn btn-primary vg-btn-sm" title={t('New removal')} kicker={t('Waste register')}
      width={620} disabled={none} tooltip={none ? t('Create a waste stream first (Waste streams tab).') : undefined}>
      {(close) => <EntryForm streams={streams} today={today} showSite={showSite} transporters={transporters} carriers={carriers} defaultStreamId={defaultStreamId} events={events} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

// ─── Formulaire d'enlèvement ────────────────────────────────────────────────

function EntryForm({ entry, streams: allStreams, today, showSite, transporters, carriers, defaultStreamId, events, onDone, onCancel }: {
  entry?: EntryView & { version?: string }; streams: StreamOption[]; today: string; showSite: boolean; transporters: string[]; carriers: Record<string, Carrier>; defaultStreamId?: string;
  events: readonly EventOption[]; onDone: () => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const uid = useId();
  // Filières en service d'un site en service, plus la filière de l'enlèvement modifié même archivée ou d'un site archivé
  // (DOC-09, DOC-20 : jamais proposées pour un nouveau choix).
  const streams = allStreams.filter((s) => offeredStream(s) || s.id === entry?.streamId);
  const initialStream = entry?.streamId ?? (defaultStreamId && streams.some((s) => s.id === defaultStreamId) ? defaultStreamId : streams.length === 1 ? streams[0].id : '');
  const [streamId, setStreamId] = useState(initialStream);
  const stream = streams.find((s) => s.id === streamId);
  const [transporter, setTransporter] = useState(entry?.transporter ?? stream?.collector ?? '');
  // Le transporteur (nom, SIRET, adresse, récépissé) suit le collecteur de la filière tant qu'il n'a pas été saisi à la main ;
  // un transporteur connu reprend ses mentions, sauf mentions saisies à la main.
  const [manualTransporter, setManualTransporter] = useState(!!entry && entry.transporter !== stream?.collector);
  const initialCarrier = entry
    ? { siret: entry.transporterSiret, address: entry.transporterAddress, receipt: entry.transporterReceipt }
    : collectorOf(stream);
  const [carrier, setCarrier] = useState({ siret: initialCarrier.siret ?? '', address: initialCarrier.address ?? '', receipt: initialCarrier.receipt ?? '' });
  const [manualCarrier, setManualCarrier] = useState(false);
  const fillCarrier = (c: Carrier) => setCarrier({ siret: c.siret ?? '', address: c.address ?? '', receipt: c.receipt ?? '' });
  const editCarrier = (k: keyof Carrier, v: string) => { setCarrier((c) => ({ ...c, [k]: v })); setManualCarrier(true); };
  const [bsd, setBsd] = useState(entry?.bsdNumber ?? '');
  const [bsdStatus, setBsdStatus] = useState<string>(entry?.bsdStatus ?? '');
  // Codes, exutoire et mentions enregistrés à l'inscription tant que la filière ne change pas ; sinon ceux de la filière choisie.
  const info = entry && streamId === entry.streamId ? entry : stream;
  const [qualification, setQualification] = useState(entry?.qualification ?? stream?.qualification ?? '');
  const [manualQualification, setManualQualification] = useState(false);
  const transit = !!info && isTransitCode(info.treatmentCode);
  const qualificationIssue = info ? qualificationError(info.treatmentCode, qualification) : null;

  // Événements du site de la filière choisie ; un événement déjà lié mais clôturé depuis reste proposé.
  const siteEvents = events.filter((e) => !stream || e.siteId === stream.siteId).map((e) => [e.id, e.label] as const);
  const eventOptions = withCurrent(siteEvents, entry?.eventId, null, 'start');
  const options = streams.map((s) => [s.id, `${s.label} · ${s.ewcCode}${showSite ? ` — ${shortSite(s.site)}` : ''}`] as const);
  const bsdHint = !info
    ? fill(t('Trackdéchets format: {format}.'), { format: BSD_PLACEHOLDER })
    : info.hazardous
      ? (bsd.trim() ? t('Trackdéchets slip of the hazardous waste.') : <span style={{ color: TONE.danger.fg }}>{t('Required for a hazardous waste (Env. Code R. 541-45).')}</span>)
      : t('Optional for a non-hazardous waste.');

  return (
    <ActionForm action={saveWasteEntry} hidden={{ id: entry?.id, version: entry?.version }} onDone={onDone} onCancel={onCancel} submitLabel={entry ? t('Save') : t('Record the removal')}>
      <Field name="streamId" label={t('Waste stream')}>
        <Select name="streamId" options={options} placeholder={t('Choose the waste stream…')} value={streamId} autoFocus={!entry}
          onChange={(e) => {
            const next = streams.find((s) => s.id === e.target.value);
            setStreamId(e.target.value);
            if (!manualTransporter) {
              setTransporter(next?.collector ?? '');
              if (!manualCarrier) fillCarrier(collectorOf(next));
            }
            const back = entry && e.target.value === entry.streamId;
            if (!manualQualification) setQualification((back ? entry.qualification : next?.qualification) ?? '');
          }} />
      </Field>
      {info && (
        <Note icon={info.hazardous ? 'ph-warning' : 'ph-recycle'} tone={info.hazardous ? 'warn' : undefined}>
          {info.ewcCode} · {info.hazardous ? t('hazardous waste, Trackdéchets slip required') : t('non-hazardous waste')}
          {info.pop ? t(' · contains persistent organic pollutants (POP)') : ''} ·{' '}
          {fill(t('{code} ({route}) to {destination}'), { code: info.treatmentCode, route: lcfirst(info.channel), destination: info.destination })}
          {info.destinationSiret ? ` (SIRET ${fmtSiret(info.destinationSiret)})` : t(' (SIRET of the facility to enter on the waste stream)')}
          {info.qualification ? ` · ${qualificationLabel(info.qualification)}` : ''}.
          {info === entry && stream && (entry.ewcCode !== stream.ewcCode || entry.treatmentCode !== stream.treatmentCode || entry.destination !== stream.destination)
            && t(' Codes and outlet recorded at registration: the waste stream has been changed since.')}
        </Note>
      )}
      <FormRow>
        <Field name="removedOn" label={t('Removal date')}>
          <Input name="removedOn" type="date" defaultValue={entry?.removedOn ?? today} max={today} />
        </Field>
        <Field name="quantity" label={fill(t('Quantity ({unit})'), { unit: stream?.unit ?? 'kg' })}>
          <Input name="quantity" type="number" min={0} step="any" inputMode="decimal" defaultValue={entry?.quantity ?? ''} placeholder={t('E.g. 420')} />
        </Field>
      </FormRow>
      <Field name="transporter" label={t('Carrier')} hint={manualTransporter ? undefined : t('By default, the collector of the waste stream and its mentions.')}>
        <Input name="transporter" value={transporter} maxLength={160} list={`${uid}-transporters`}
          onChange={(e) => {
            const name = e.target.value;
            setTransporter(name);
            setManualTransporter(true);
            if (!manualCarrier) fillCarrier(stream && name.trim() === stream.collector ? collectorOf(stream) : carriers[name.trim()] ?? NO_CARRIER);
          }} />
      </Field>
      <FormRow>
        <CompanyIdField name="transporterSiret" label={t('SIRET of the carrier')} value={carrier.siret} onChange={(v) => editCarrier('siret', v)} foreign />
        <Field name="transporterReceipt" label={t('Receipt no.')} hint={t(RECEIPT_HINT)}>
          <Input name="transporterReceipt" value={carrier.receipt} onChange={(e) => editCarrier('receipt', e.target.value)} maxLength={60} autoComplete="off" />
        </Field>
      </FormRow>
      <Field name="transporterAddress" label={t('Address of the carrier')}>
        <Input name="transporterAddress" value={carrier.address} onChange={(e) => editCarrier('address', e.target.value)} maxLength={300} placeholder={t('No., street, postcode, town')} />
      </Field>
      <FormRow>
        <Field name="pickupAddress" label={t('Pick-up address')} hint={t('If different from the address of the site: worksite, other depot.')}>
          <Input name="pickupAddress" defaultValue={entry?.pickupAddress ?? ''} maxLength={300} />
        </Field>
        <Field name="qualification" label={t('Qualification of the final treatment')}
          hint={qualificationIssue ? <span style={{ color: TONE.warn.fg }}>{qualificationIssue}</span> : transit ? t('Transit operation: specify the final treatment.') : undefined}>
          <Select name="qualification" options={QUALIFICATION_OPTIONS} placeholder={transit ? t('To specify') : t('Choose…')} value={qualification}
            onChange={(e) => { setQualification(e.target.value); setManualQualification(true); }} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="bsdNumber" label={t('Slip no. (BSD)')} hint={bsdHint}>
          <Input name="bsdNumber" value={bsd} onChange={(e) => setBsd(e.target.value)} placeholder={BSD_PLACEHOLDER} maxLength={40} autoComplete="off"
            style={{ textTransform: 'uppercase' }} />
        </Field>
        <Field name="bsdStatus" label={t('Slip status')} hint={bsd.trim() ? t('Issued by default.') : undefined}>
          <Select name="bsdStatus" options={BSD_OPTIONS} placeholder="—" value={bsdStatus} onChange={(e) => setBsdStatus(e.target.value)} disabled={!bsd.trim()} />
        </Field>
      </FormRow>
      {/* DOC-12 : refus total ou partiel par l'installation de destination. */}
      {bsd.trim() && (bsdStatus === 'refuse' || bsdStatus === 'accepte_partiel') && (
        <FormRow>
          {bsdStatus === 'accepte_partiel' && (
            <Field name="bsdRefusedQuantity" label={t('Quantity refused')} hint={t('Share refused by the facility, in the unit of the waste stream.')}>
              <Input name="bsdRefusedQuantity" inputMode="decimal" defaultValue={entry?.bsdRefusedQuantity ?? ''} />
            </Field>
          )}
          <Field name="bsdRefusalReason" label={t('Reason for the refusal')} hint={t('As stated on the slip by the destination facility.')}>
            <Input name="bsdRefusalReason" defaultValue={entry?.bsdRefusalReason ?? ''} maxLength={300} />
          </Field>
        </FormRow>
      )}
      {eventOptions.length > 0 && (
        <Field name="eventId" label={t('Linked event')} hint={t('Optional: spill or leak at the origin of the removal.')}>
          <Select name="eventId" options={eventOptions} placeholder={t('None#m')} defaultValue={entry?.eventId ?? ''} />
        </Field>
      )}
      <Field name="notes" label={t('Observations')}>
        <TextArea name="notes" rows={2} maxLength={1000} defaultValue={entry?.notes ?? ''} placeholder={t('Context of the removal, gap, regularisation…')} style={{ minHeight: 56 }} />
      </Field>
      <Suggestions id={`${uid}-transporters`} values={transporters} />
    </ActionForm>
  );
}
