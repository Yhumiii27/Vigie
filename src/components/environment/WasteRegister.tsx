'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { ChangeLogList } from '@/components/ChangeLog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ReasonButton } from '@/components/ReasonDialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { Icon, ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import type { EntryDetail, EntryView, EventOption, StreamView } from '@/lib/data/environment';
import { cancelWasteEntry, saveWasteEntry } from '@/server/environment';
import { fmtSiret } from '@/lib/siret';
import {
  BSD_PLACEHOLDER, BSD_STALE_DAYS, BSD_STATUS, BSD_STATUS_KEYS, QUALIFICATION_KEYS, REGISTER_MENTIONS, TREATMENT_QUALIFICATIONS, fmtQty, isTransitCode, lcfirst,
  qualificationError, qualificationLabel, treatmentLabel,
} from './model';
import { CompanyIdField, LinkedActions, Note, Suggestions, muted, rowOpener, shortSite, type ActionOptions, type Carrier } from './parts';
import { entryActionDefaults } from './action-defaults';

export type StreamOption = Pick<StreamView,
  | 'id' | 'label' | 'ewcCode' | 'hazardous' | 'unit' | 'collector' | 'destination' | 'treatmentCode' | 'channel' | 'site' | 'siteId'
  | 'pop' | 'qualification' | 'collectorSiret' | 'collectorAddress' | 'collectorReceipt' | 'destinationSiret' | 'destinationAddress'>;

const BSD_OPTIONS = BSD_STATUS_KEYS.map((k) => [k, BSD_STATUS[k].label] as const);
const QUALIFICATION_OPTIONS = QUALIFICATION_KEYS.map((k) => [k, TREATMENT_QUALIFICATIONS[k]] as const);
const RECEIPT_HINT = "Récépissé de déclaration de transport de déchets (R. 541-50) ; « Exempté » si non soumis.";
const NO_CARRIER: Carrier = { siret: null, address: null, receipt: null };
const collectorOf = (s: StreamOption | undefined): Carrier =>
  s ? { siret: s.collectorSiret, address: s.collectorAddress, receipt: s.collectorReceipt } : NO_CARRIER;

/** Où compléter chaque mention manquante d'un enlèvement. */
function gapHelp(e: EntryView): string[] {
  const has = (m: string) => e.gaps.includes(m);
  return [
    (has(REGISTER_MENTIONS.transporterSiret) || has(REGISTER_MENTIONS.transporterAddress) || has(REGISTER_MENTIONS.transporterReceipt))
      && 'transporteur : SIRET, adresse et récépissé dans le formulaire ci-dessous',
    has(REGISTER_MENTIONS.qualification) && 'qualification : dans le formulaire ci-dessous',
    (has(REGISTER_MENTIONS.destinationSiret) || has(REGISTER_MENTIONS.destinationAddress)) && `installation : sur la filière ${e.streamId} (onglet « Filières »)`,
    has(REGISTER_MENTIONS.siteSiret) && "SIRET de l'établissement : bouton « Renseigner le SIRET » au-dessus du registre",
  ].filter((x): x is string => !!x);
}

// ─── Tableau du registre ────────────────────────────────────────────────────

export function WasteRegister({ entries, streams, canManage, showSite, today, emptyText, transporters, carriers, events, actionOptions, canSeeEvents }: {
  entries: EntryDetail[];
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
  const [selId, setSelId] = useState<number | null>(null);
  const entry = selId != null ? entries.find((e) => e.id === selId) ?? null : null;
  const close = () => setSelId(null);
  const cols = 9;

  return (
    <div className="card" style={{ padding: '6px 14px 10px' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 1040 }}>
          <thead>
            <tr>
              <th style={{ whiteSpace: 'nowrap' }}>Date d&apos;enlèvement</th><th>Déchet</th><th>Code déchet</th><th>Dangereux</th><th style={{ textAlign: 'right' }}>Quantité</th>
              <th>Transporteur</th><th>Exutoire</th><th>Traitement</th><th>Bordereau (BSD)</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr><td colSpan={cols} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>{emptyText}</td></tr>
            )}
            {entries.map((e) => (
              <tr key={e.id} {...(canManage ? rowOpener(() => setSelId(e.id)) : {})} style={e.cancelled ? { opacity: 0.55 } : undefined}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {fmtDate(e.removedOn)}
                  {showSite && <div style={muted}>{shortSite(e.site)}</div>}
                </td>
                <td style={{ minWidth: 170 }}>
                  {e.stream}
                  {e.notes && <div style={{ ...muted, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.notes}>{e.notes}</div>}
                  {e.gaps.length > 0 && (
                    <div style={{ ...muted, color: TONE.warn.fg }} title={`Mentions manquantes : ${e.gaps.join(' · ')}`}>Mentions incomplètes · {e.gaps.length}</div>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-300)' }}>{e.ewcCode}</td>
                <td>{e.hazardous ? <ToneTag tone="warn">Dangereux</ToneTag> : <span style={{ color: 'var(--color-neutral-600)' }}>Non</span>}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtQty(e.quantity, e.unit)}</td>
                <td style={{ color: 'var(--color-neutral-300)' }}>{e.transporter}</td>
                <td style={{ color: 'var(--color-neutral-400)', minWidth: 160 }}>{e.destination}</td>
                <td style={{ whiteSpace: 'nowrap' }} title={treatmentLabel(e.treatmentCode)}>
                  <span style={{ fontWeight: 500 }}>{e.treatmentCode}</span>
                  <span style={{ ...muted, marginLeft: 6 }}>{e.recovery ? 'valorisation' : 'élimination'}</span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {e.cancelled ? (
                    <span title={`Annulé par ${e.cancelled.by} : ${e.cancelled.reason}`}><ToneTag tone="neutral">Annulé</ToneTag></span>
                  ) : e.missingBsd ? (
                    <ToneTag tone="danger"><Icon name="ph-warning" size={11} style={{ marginRight: 4 }} />BSD manquant</ToneTag>
                  ) : e.bsdNumber ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-300)' }}>{e.bsdNumber}</span>
                      {e.bsdLabel && <ToneTag tone={e.bsdTone}>{e.bsdLabel}</ToneTag>}
                      {e.staleBsd && (
                        <span title={`Bordereau non finalisé ${e.age} j après l'enlèvement : traitement final à vérifier.`} style={{ display: 'inline-flex', color: TONE.warn.dot }}>
                          <Icon name="ph-hourglass-medium" size={13} />
                        </span>
                      )}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--color-neutral-600)' }} title="Bordereau non requis pour un déchet non dangereux">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!entry} onClose={close} width={620}
        kicker={entry ? `Registre des déchets · n° ${entry.id} · ${shortSite(entry.site)}` : undefined}
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
  const event = entry.event && (canSeeEvents
    ? <Link href={`/evenements?sel=${encodeURIComponent(entry.event.id)}`} className="vg-link">{entry.event.id}</Link>
    : <span>{entry.event.id}</span>);
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {entry.cancelled && (
        <Note icon="ph-prohibit">
          Enlèvement annulé le {fmtDate(entry.cancelled.at.slice(0, 10))} par {entry.cancelled.by} : {entry.cancelled.reason}
          {' '}Il reste inscrit au registre pour traçabilité, hors indicateurs, échéances et export.
        </Note>
      )}
      {entry.event && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--color-neutral-300)' }}>
          <Icon name="ph-warning-diamond" size={14} style={{ color: TONE.warn.dot }} />
          <span>Enlèvement consécutif à l&apos;événement {event}{entry.event.title ? ` · ${entry.event.title}` : ''}</span>
        </div>
      )}
      {entry.gaps.length > 0 && (
        <Note icon="ph-warning" tone="warn">
          Mentions obligatoires manquantes (arrêté du 31 mai 2021) : {entry.gaps.join(' · ')}.
          <span style={{ display: 'block', marginTop: 2, color: 'var(--color-neutral-400)' }}>À compléter — {gapHelp(entry).join(' ; ')}.</span>
        </Note>
      )}
      {entry.staleBsd && (
        <Note icon="ph-hourglass-medium" tone="warn">
          Bordereau {entry.bsdNumber} encore « {entry.bsdLabel?.toLowerCase()} » {entry.age} jours après l&apos;enlèvement (seuil {BSD_STALE_DAYS} j) :
          relancez l&apos;installation de destination pour obtenir le certificat de traitement.
        </Note>
      )}
      <LinkedActions actions={entry.actions} options={entry.cancelled ? null : actionOptions} canAct={!entry.cancelled}
        defaults={entryActionDefaults(entry, today)} />
      {!entry.cancelled && (
        <section style={{ display: 'grid', gap: 8 }}>
          <h6 className="vg-h6">Enlèvement</h6>
          <EntryForm entry={entry} streams={streams} today={today} showSite={showSite} transporters={transporters} carriers={carriers} events={events} onDone={onClose} onCancel={onClose} />
        </section>
      )}
      <ChangeLogList entries={entry.history} />
      {!entry.cancelled && (
        <div style={{ display: 'flex', justifyContent: 'flex-start', paddingTop: 10, background: 'var(--rule-soft) no-repeat top / 100% 1px' }}>
          <ReasonButton label="Annuler l'enlèvement" icon="ph-prohibit" className="btn btn-ghost vg-btn-sm" style={{ color: 'var(--tone-danger-fg)' }}
            title="Annuler l'enlèvement" kicker={`${entry.stream} · ${fmtDate(entry.removedOn)}`} action={cancelWasteEntry} hidden={{ id: entry.id }}
            submitLabel="Annuler l'enlèvement" submitIcon="ph-prohibit" placeholder="Ex. doublon de l'enlèvement du 08/07, erreur de filière…"
            message={<>L&apos;enlèvement du {fmtDate(entry.removedOn)} ({entry.stream}, {fmtQty(entry.quantity, entry.unit)}) reste inscrit au registre, marqué annulé :
              il sort des indicateurs, des échéances et de l&apos;export. Cette opération ne peut pas être défaite.</>}
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
  const none = streams.length === 0;
  return (
    <DialogButton label="Nouvel enlèvement" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Nouvel enlèvement" kicker="Registre des déchets"
      width={620} disabled={none} tooltip={none ? "Créez d'abord une filière (onglet Filières)." : undefined}>
      {(close) => <EntryForm streams={streams} today={today} showSite={showSite} transporters={transporters} carriers={carriers} defaultStreamId={defaultStreamId} events={events} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

// ─── Formulaire d'enlèvement ────────────────────────────────────────────────

function EntryForm({ entry, streams, today, showSite, transporters, carriers, defaultStreamId, events, onDone, onCancel }: {
  entry?: EntryView; streams: StreamOption[]; today: string; showSite: boolean; transporters: string[]; carriers: Record<string, Carrier>; defaultStreamId?: string;
  events: readonly EventOption[]; onDone: () => void; onCancel: () => void;
}) {
  const uid = useId();
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
  // Codes, exutoire et mentions enregistrés à l'inscription tant que la filière ne change pas ; sinon ceux de la filière choisie.
  const info = entry && streamId === entry.streamId ? entry : stream;
  const [qualification, setQualification] = useState(entry?.qualification ?? stream?.qualification ?? '');
  const [manualQualification, setManualQualification] = useState(false);
  const transit = !!info && isTransitCode(info.treatmentCode);
  const qualificationIssue = info ? qualificationError(info.treatmentCode, qualification) : null;

  // Événements du site de la filière choisie ; un événement déjà lié mais clôturé depuis reste proposé.
  const siteEvents = events.filter((e) => !stream || e.siteId === stream.siteId).map((e) => [e.id, e.label] as const);
  const eventOptions = entry?.eventId && !siteEvents.some(([v]) => v === entry.eventId) ? [[entry.eventId, entry.eventId] as const, ...siteEvents] : siteEvents;
  const options = streams.map((s) => [s.id, `${s.label} · ${s.ewcCode}${showSite ? ` — ${shortSite(s.site)}` : ''}`] as const);
  const bsdHint = !info
    ? `Format Trackdéchets : ${BSD_PLACEHOLDER}.`
    : info.hazardous
      ? (bsd.trim() ? 'Bordereau Trackdéchets du déchet dangereux.' : <span style={{ color: TONE.danger.fg }}>Obligatoire pour un déchet dangereux (C. env. R. 541-45).</span>)
      : 'Facultatif pour un déchet non dangereux.';

  return (
    <ActionForm action={saveWasteEntry} hidden={{ id: entry?.id }} onDone={onDone} onCancel={onCancel} submitLabel={entry ? 'Enregistrer' : "Inscrire l'enlèvement"}>
      <Field name="streamId" label="Filière">
        <Select name="streamId" options={options} placeholder="Choisir la filière…" value={streamId} autoFocus={!entry}
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
          {info.ewcCode} · {info.hazardous ? 'déchet dangereux, bordereau Trackdéchets obligatoire' : 'déchet non dangereux'}
          {info.pop ? ' · contient des polluants organiques persistants (POP)' : ''} ·{' '}
          {info.treatmentCode} ({lcfirst(info.channel)}) vers {info.destination}
          {info.destinationSiret ? ` (SIRET ${fmtSiret(info.destinationSiret)})` : ' (SIRET de l’installation à renseigner sur la filière)'}
          {info.qualification ? ` · ${qualificationLabel(info.qualification)}` : ''}.
          {info === entry && stream && (entry.ewcCode !== stream.ewcCode || entry.treatmentCode !== stream.treatmentCode || entry.destination !== stream.destination)
            && " Codes et exutoire enregistrés à l'inscription : la filière a été modifiée depuis."}
        </Note>
      )}
      <FormRow>
        <Field name="removedOn" label="Date d'enlèvement">
          <Input name="removedOn" type="date" defaultValue={entry?.removedOn ?? today} max={today} />
        </Field>
        <Field name="quantity" label={`Quantité (${stream?.unit ?? 'kg'})`}>
          <Input name="quantity" type="number" min={0} step="any" inputMode="decimal" defaultValue={entry?.quantity ?? ''} placeholder="Ex. 420" />
        </Field>
      </FormRow>
      <Field name="transporter" label="Transporteur" hint={manualTransporter ? undefined : 'Par défaut, le collecteur de la filière et ses mentions.'}>
        <Input name="transporter" value={transporter} maxLength={160} list={`${uid}-transporters`}
          onChange={(e) => {
            const name = e.target.value;
            setTransporter(name);
            setManualTransporter(true);
            if (!manualCarrier) fillCarrier(stream && name.trim() === stream.collector ? collectorOf(stream) : carriers[name.trim()] ?? NO_CARRIER);
          }} />
      </Field>
      <FormRow>
        <CompanyIdField name="transporterSiret" label="SIRET du transporteur" value={carrier.siret} onChange={(v) => editCarrier('siret', v)} foreign />
        <Field name="transporterReceipt" label="N° de récépissé" hint={RECEIPT_HINT}>
          <Input name="transporterReceipt" value={carrier.receipt} onChange={(e) => editCarrier('receipt', e.target.value)} maxLength={60} autoComplete="off" />
        </Field>
      </FormRow>
      <Field name="transporterAddress" label="Adresse du transporteur">
        <Input name="transporterAddress" value={carrier.address} onChange={(e) => editCarrier('address', e.target.value)} maxLength={300} placeholder="N°, voie, code postal, commune" />
      </Field>
      <FormRow>
        <Field name="pickupAddress" label="Adresse de prise en charge" hint="Si différente de l'adresse du site : chantier, autre dépôt.">
          <Input name="pickupAddress" defaultValue={entry?.pickupAddress ?? ''} maxLength={300} />
        </Field>
        <Field name="qualification" label="Qualification du traitement final"
          hint={qualificationIssue ? <span style={{ color: TONE.warn.fg }}>{qualificationIssue}</span> : transit ? 'Opération de transit : précisez le traitement final.' : undefined}>
          <Select name="qualification" options={QUALIFICATION_OPTIONS} placeholder={transit ? 'À préciser' : 'Choisir…'} value={qualification}
            onChange={(e) => { setQualification(e.target.value); setManualQualification(true); }} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="bsdNumber" label="N° de bordereau (BSD)" hint={bsdHint}>
          <Input name="bsdNumber" value={bsd} onChange={(e) => setBsd(e.target.value)} placeholder={BSD_PLACEHOLDER} maxLength={40} autoComplete="off"
            style={{ textTransform: 'uppercase' }} />
        </Field>
        <Field name="bsdStatus" label="Statut du bordereau" hint={bsd.trim() ? 'Émis par défaut.' : undefined}>
          <Select name="bsdStatus" options={BSD_OPTIONS} placeholder="—" defaultValue={entry?.bsdStatus ?? ''} disabled={!bsd.trim()} />
        </Field>
      </FormRow>
      {eventOptions.length > 0 && (
        <Field name="eventId" label="Événement lié" hint="Facultatif : déversement ou fuite à l'origine de l'enlèvement.">
          <Select name="eventId" options={eventOptions} placeholder="Aucun" defaultValue={entry?.eventId ?? ''} />
        </Field>
      )}
      <Field name="notes" label="Observations">
        <TextArea name="notes" rows={2} maxLength={1000} defaultValue={entry?.notes ?? ''} placeholder="Contexte de l'enlèvement, écart, régularisation…" style={{ minHeight: 56 }} />
      </Field>
      <Suggestions id={`${uid}-transporters`} values={transporters} />
    </ActionForm>
  );
}
