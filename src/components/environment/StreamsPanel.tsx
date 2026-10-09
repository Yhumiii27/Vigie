'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select } from '@/components/form';
import { Icon, ToneTag, hrefWith } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import type { StreamView } from '@/lib/data/environment';
import { deleteWasteStream, saveWasteStream } from '@/server/environment';
import { TREATMENT_CODES, WASTE_UNITS, fmtDelta, fmtQty, isHazardousCode, isRecovery, normalizeEwc, treatmentLabel } from './model';
import { DeleteZone, LinkedActions, Note, Suggestions, muted, rowOpener, shortSite, type ActionOptions } from './parts';

type Opt = readonly (readonly [string, string])[];
export type StreamSuggestions = { channels: string[]; collectors: string[]; destinations: string[] };

const TREATMENT_OPTIONS = TREATMENT_CODES.map(([c, l]) => [c, `${c} — ${l}`] as const);

// ─── Catalogue des filières ─────────────────────────────────────────────────

export function StreamsPanel({ streams, year, annee, isCurrent, canManage, showSite, sites, suggestions, actionOptions }: {
  streams: StreamView[];
  year: number;
  /** Paramètre `annee` de l'URL (absent pour l'année en cours) : liens vers le registre filtré. */
  annee?: string;
  /** Année en cours : la variation se compare à N-1 arrêtée à la même date. */
  isCurrent: boolean;
  canManage: boolean;
  showSite: boolean;
  sites: Opt;
  suggestions: StreamSuggestions;
  /** Listes de choix du formulaire d'action (null : création d'action non permise). */
  actionOptions: ActionOptions | null;
}) {
  const registerHref = (id: string) => hrefWith('/environnement', { annee }, { filiere: id });
  const [selId, setSelId] = useState<string | null>(null);
  const stream = selId ? streams.find((s) => s.id === selId) ?? null : null;
  const close = () => setSelId(null);

  return (
    <div className="card" style={{ padding: '6px 14px 10px' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 1040 }}>
          <thead>
            <tr>
              <th>Filière</th><th>Code déchet</th><th>Traitement</th><th>Collecteur</th><th>Installation de destination</th>
              <th style={{ textAlign: 'right' }}>{year}</th><th style={{ textAlign: 'right' }}>{year - 1}</th><th style={{ textAlign: 'right' }}>Enlèv. {year}</th>
            </tr>
          </thead>
          <tbody>
            {streams.length === 0 && (
              <tr><td colSpan={8} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>
                Aucune filière déchets pour ce site{canManage ? ' : créez la première avec « Nouvelle filière ».' : '.'}
              </td></tr>
            )}
            {streams.map((s) => {
              const delta = s.prevPeriodQty ? (s.yearQty - s.prevPeriodQty) / s.prevPeriodQty : null;
              return (
                <tr key={s.id} {...(canManage ? rowOpener(() => setSelId(s.id)) : {})}>
                  <td style={{ minWidth: 200 }}>
                    <span style={{ fontWeight: 500 }}>{s.label}</span>
                    <div style={muted}>{[s.id, showSite && shortSite(s.site), s.channel].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-300)', marginRight: 8 }}>{s.ewcCode}</span>
                    {s.hazardous && <ToneTag tone="warn">Dangereux</ToneTag>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }} title={s.treatmentLabel}>
                    <span style={{ fontWeight: 500 }}>{s.treatmentCode}</span>
                    <span style={{ ...muted, marginLeft: 6 }}>{s.recovery ? 'valorisation' : 'élimination'}</span>
                  </td>
                  <td style={{ color: 'var(--color-neutral-300)' }}>{s.collector}</td>
                  <td style={{ color: 'var(--color-neutral-400)', minWidth: 170 }}>{s.destination}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {s.yearQty ? fmtQty(s.yearQty, s.unit) : <span style={{ color: 'var(--color-neutral-600)' }}>—</span>}
                    {delta != null && s.yearQty > 0 && <div style={muted}>{fmtDelta(delta)} vs {year - 1}{isCurrent ? ' même période' : ''}</div>}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-400)' }}>
                    {s.prevQty ? fmtQty(s.prevQty, s.unit) : '—'}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {s.yearCount ? <Link href={registerHref(s.id)} scroll={false} className="vg-link" title={`Registre ${year} filtré sur cette filière`}>{s.yearCount}</Link> : 0}
                    {s.lastRemovedOn && <div style={muted}>dernier {fmtDate(s.lastRemovedOn)}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={!!stream} onClose={close} width={640} kicker={stream ? `Filière ${stream.id} · ${shortSite(stream.site)}` : undefined} title={stream?.label ?? ''}>
        {stream && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--color-neutral-300)', marginBottom: 12 }}>
              <Icon name="ph-list-numbers" size={14} />
              {stream.yearCount ? (
                <Link href={registerHref(stream.id)} scroll={false} className="vg-link" onClick={close}>
                  Voir {stream.yearCount > 1 ? `les ${stream.yearCount} enlèvements` : "l'enlèvement"} de {year} au registre
                </Link>
              ) : <span>Aucun enlèvement en {year}.</span>}
              {stream.entryCount > stream.yearCount && <span style={muted}>· {stream.entryCount} toutes années</span>}
              {stream.cancelledCount > 0 && <span style={muted}>· {stream.cancelledCount} annulé{stream.cancelledCount > 1 ? 's' : ''}</span>}
            </div>
            <div style={{ marginBottom: 14 }}>
              <LinkedActions actions={stream.actions} options={actionOptions} canAct={!!actionOptions}
                defaults={{ originRef: stream.id, siteId: stream.siteId, kind: 'P', description: `Filière ${stream.id} · ${stream.label} (${stream.ewcCode}) · exutoire ${stream.destination}.` }} />
            </div>
            <StreamForm key={stream.id} stream={stream} sites={sites} defaultSite={stream.siteId} suggestions={suggestions} onDone={close} onCancel={close} />
            {/* Les enlèvements annulés restent au registre et référencent la filière : elle n'est alors plus supprimable. */}
            {stream.entryCount + stream.cancelledCount === 0 && (
              <DeleteZone label="Supprimer la filière" run={() => deleteWasteStream(stream.id)} onDone={close}
                question={<>Supprimer la filière « {stream.label} » ? Aucun enlèvement n&apos;est inscrit au registre.</>} />
            )}
          </>
        )}
      </Dialog>
    </div>
  );
}

/** Bouton « Nouvelle filière ». */
export function NewStreamButton({ sites, defaultSite, suggestions }: { sites: Opt; defaultSite: string; suggestions: StreamSuggestions }) {
  return (
    <DialogButton label="Nouvelle filière" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Nouvelle filière déchets" kicker="Filières" width={640}>
      {(close) => <StreamForm sites={sites} defaultSite={defaultSite} suggestions={suggestions} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

// ─── Formulaire de filière ──────────────────────────────────────────────────

function StreamForm({ stream, sites, defaultSite, suggestions, onDone, onCancel }: {
  stream?: StreamView; sites: Opt; defaultSite: string; suggestions: StreamSuggestions; onDone: () => void; onCancel: () => void;
}) {
  const uid = useId();
  const [code, setCode] = useState(stream?.ewcCode ?? '');
  const [treatment, setTreatment] = useState(stream?.treatmentCode ?? '');
  const normalized = normalizeEwc(code);
  const hazardous = isHazardousCode(code);
  // Annulés compris : ils restent au registre chronologique (même règle que le serveur).
  const registered = stream ? stream.entryCount + stream.cancelledCount : 0;
  const locked = registered > 0;
  const lockHint = locked ? 'Verrouillé.' : undefined;

  return (
    <ActionForm action={saveWasteStream} hidden={{ id: stream?.id }} onDone={onDone} onCancel={onCancel} submitLabel={stream ? 'Enregistrer' : 'Créer la filière'}>
      <Field name="label" label="Libellé">
        <Input name="label" defaultValue={stream?.label} placeholder="Ex. Huiles hydrauliques usagées" maxLength={120} autoFocus={!stream} />
      </Field>
      {locked && (
        <Note icon="ph-lock-simple">
          {registered} enlèvement{registered > 1 ? 's' : ''} au registre{stream!.cancelledCount ? ` (dont ${stream!.cancelledCount} annulé${stream!.cancelledCount > 1 ? 's' : ''})` : ''} : site et unité sont verrouillés
          pour ne pas réécrire le registre chronologique. Les enlèvements déjà inscrits conservent les codes et l&apos;exutoire enregistrés.
        </Note>
      )}
      <FormRow>
        <Field name="ewcCode" label="Code déchet" hint="Liste européenne des déchets : 6 chiffres, « * » si dangereux.">
          <Input name="ewcCode" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ex. 13 01 10*" maxLength={20} autoComplete="off" />
        </Field>
        <Field name="unit" label="Unité" hint={lockHint}>
          <Select name="unit" options={WASTE_UNITS} defaultValue={stream?.unit ?? 'kg'} disabled={locked} />
        </Field>
      </FormRow>
      {normalized && (
        <Note icon={hazardous ? 'ph-warning' : 'ph-check-circle'} tone={hazardous ? 'warn' : 'ok'}>
          {hazardous
            ? <>{normalized} · <strong style={{ fontWeight: 500, color: 'var(--color-text)' }}>déchet dangereux</strong> : chaque enlèvement exige un bordereau Trackdéchets.</>
            : <>{normalized} · déchet non dangereux : inscription au registre, sans bordereau obligatoire.</>}
        </Note>
      )}
      <FormRow>
        <Field name="treatmentCode" label="Code de traitement" hint={treatment ? (isRecovery(treatment) ? 'Valorisation (R1–R13).' : 'Élimination (D1–D15).') : undefined}>
          <Select name="treatmentCode" options={TREATMENT_OPTIONS} placeholder="Choisir…" value={treatment} onChange={(e) => setTreatment(e.target.value)}
            title={treatment ? treatmentLabel(treatment) : undefined} />
        </Field>
        <Field name="channel" label="Filière de traitement">
          <Input name="channel" defaultValue={stream?.channel} placeholder="Ex. Régénération, recyclage matière…" list={`${uid}-channels`} maxLength={80} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="collector" label="Collecteur" hint="Transporteur proposé par défaut à chaque enlèvement.">
          <Input name="collector" defaultValue={stream?.collector} placeholder="Ex. [Collecteur Huiles Ouest]" list={`${uid}-collectors`} maxLength={160} />
        </Field>
        <Field name="siteId" label="Site" hint={lockHint}>
          <Select name="siteId" options={sites} defaultValue={stream?.siteId ?? defaultSite} disabled={locked} />
        </Field>
      </FormRow>
      <Field name="destination" label="Installation de destination (exutoire)">
        <Input name="destination" defaultValue={stream?.destination} placeholder="Raison sociale et commune de l'installation de traitement" list={`${uid}-destinations`} maxLength={200} />
      </Field>
      <Suggestions id={`${uid}-channels`} values={suggestions.channels} />
      <Suggestions id={`${uid}-collectors`} values={suggestions.collectors} />
      <Suggestions id={`${uid}-destinations`} values={suggestions.destinations} />
    </ActionForm>
  );
}
