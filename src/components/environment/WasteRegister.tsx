'use client';

import { useId, useState } from 'react';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { Icon, ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import type { EntryView, StreamView } from '@/lib/data/environment';
import { deleteWasteEntry, saveWasteEntry } from '@/server/environment';
import { BSD_PLACEHOLDER, BSD_STATUS, BSD_STATUS_KEYS, fmtQty, lcfirst, treatmentLabel } from './model';
import { DeleteZone, Note, Suggestions, muted, rowOpener, shortSite } from './parts';

export type StreamOption = Pick<StreamView, 'id' | 'label' | 'ewcCode' | 'hazardous' | 'unit' | 'collector' | 'destination' | 'treatmentCode' | 'channel' | 'site'>;

const BSD_OPTIONS = BSD_STATUS_KEYS.map((k) => [k, BSD_STATUS[k].label] as const);

// ─── Tableau du registre ────────────────────────────────────────────────────

export function WasteRegister({ entries, streams, canManage, showSite, today, emptyText, transporters }: {
  entries: EntryView[];
  streams: StreamOption[];
  canManage: boolean;
  /** « Tous les sites » : rappelle le site de chaque enlèvement. */
  showSite: boolean;
  today: string;
  emptyText: string;
  transporters: string[];
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
              <tr key={e.id} {...(canManage ? rowOpener(() => setSelId(e.id)) : {})}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {fmtDate(e.removedOn)}
                  {showSite && <div style={muted}>{shortSite(e.site)}</div>}
                </td>
                <td style={{ minWidth: 170 }}>
                  {e.stream}
                  {e.notes && <div style={{ ...muted, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.notes}>{e.notes}</div>}
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
                  {e.missingBsd ? (
                    <ToneTag tone="danger"><Icon name="ph-warning" size={11} style={{ marginRight: 4 }} />BSD manquant</ToneTag>
                  ) : e.bsdNumber ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-300)' }}>{e.bsdNumber}</span>
                      {e.bsdLabel && <ToneTag tone={e.bsdTone}>{e.bsdLabel}</ToneTag>}
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
        kicker={entry ? `Registre des déchets · ${shortSite(entry.site)}` : undefined}
        title={entry ? `${entry.stream} · ${fmtDate(entry.removedOn)}` : ''}>
        {entry && (
          <>
            <EntryForm key={entry.id} entry={entry} streams={streams} today={today} showSite={showSite} transporters={transporters} onDone={close} onCancel={close} />
            <DeleteZone label="Supprimer l'enlèvement" run={() => deleteWasteEntry(entry.id)} onDone={close}
              question={<>Retirer définitivement du registre l&apos;enlèvement du {fmtDate(entry.removedOn)} ({entry.stream}, {fmtQty(entry.quantity, entry.unit)}) ?</>} />
          </>
        )}
      </Dialog>
    </div>
  );
}

/** Bouton « Nouvel enlèvement ». */
export function NewEntryButton({ streams, today, showSite, transporters, defaultStreamId }: {
  streams: StreamOption[]; today: string; showSite: boolean; transporters: string[]; defaultStreamId?: string;
}) {
  const none = streams.length === 0;
  return (
    <DialogButton label="Nouvel enlèvement" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Nouvel enlèvement" kicker="Registre des déchets"
      width={620} disabled={none} tooltip={none ? "Créez d'abord une filière (onglet Filières)." : undefined}>
      {(close) => <EntryForm streams={streams} today={today} showSite={showSite} transporters={transporters} defaultStreamId={defaultStreamId} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

// ─── Formulaire d'enlèvement ────────────────────────────────────────────────

function EntryForm({ entry, streams, today, showSite, transporters, defaultStreamId, onDone, onCancel }: {
  entry?: EntryView; streams: StreamOption[]; today: string; showSite: boolean; transporters: string[]; defaultStreamId?: string;
  onDone: () => void; onCancel: () => void;
}) {
  const uid = useId();
  const initialStream = entry?.streamId ?? (defaultStreamId && streams.some((s) => s.id === defaultStreamId) ? defaultStreamId : streams.length === 1 ? streams[0].id : '');
  const [streamId, setStreamId] = useState(initialStream);
  const stream = streams.find((s) => s.id === streamId);
  const [transporter, setTransporter] = useState(entry?.transporter ?? stream?.collector ?? '');
  // Le transporteur suit le collecteur de la filière tant qu'il n'a pas été saisi à la main.
  const [manualTransporter, setManualTransporter] = useState(!!entry && entry.transporter !== stream?.collector);
  const [bsd, setBsd] = useState(entry?.bsdNumber ?? '');
  // Codes et exutoire enregistrés à l'inscription tant que la filière ne change pas ; sinon ceux de la filière choisie.
  const info = entry && streamId === entry.streamId ? entry : stream;

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
            if (!manualTransporter) setTransporter(next?.collector ?? '');
          }} />
      </Field>
      {info && (
        <Note icon={info.hazardous ? 'ph-warning' : 'ph-recycle'} tone={info.hazardous ? 'warn' : undefined}>
          {info.ewcCode} · {info.hazardous ? 'déchet dangereux, bordereau Trackdéchets obligatoire' : 'déchet non dangereux'} ·{' '}
          {info.treatmentCode} ({lcfirst(info.channel)}) vers {info.destination}.
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
      <Field name="transporter" label="Transporteur" hint={manualTransporter ? undefined : 'Par défaut, le collecteur de la filière.'}>
        <Input name="transporter" value={transporter} maxLength={160} list={`${uid}-transporters`}
          onChange={(e) => { setTransporter(e.target.value); setManualTransporter(true); }} />
      </Field>
      <FormRow>
        <Field name="bsdNumber" label="N° de bordereau (BSD)" hint={bsdHint}>
          <Input name="bsdNumber" value={bsd} onChange={(e) => setBsd(e.target.value)} placeholder={BSD_PLACEHOLDER} maxLength={40} autoComplete="off"
            style={{ textTransform: 'uppercase' }} />
        </Field>
        <Field name="bsdStatus" label="Statut du bordereau" hint={bsd.trim() ? 'Émis par défaut.' : undefined}>
          <Select name="bsdStatus" options={BSD_OPTIONS} placeholder="—" defaultValue={entry?.bsdStatus ?? ''} disabled={!bsd.trim()} />
        </Field>
      </FormRow>
      <Field name="notes" label="Observations">
        <TextArea name="notes" rows={2} maxLength={1000} defaultValue={entry?.notes ?? ''} placeholder="Contexte de l'enlèvement, écart, régularisation…" style={{ minHeight: 56 }} />
      </Field>
      <Suggestions id={`${uid}-transporters`} values={transporters} />
    </ActionForm>
  );
}
