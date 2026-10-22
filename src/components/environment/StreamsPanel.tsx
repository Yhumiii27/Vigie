'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChangeLogList } from '@/components/ChangeLog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ReasonForm } from '@/components/ReasonDialog';
import { ActionForm, Checkbox, Field, FormRow, Input, Select } from '@/components/form';
import { Icon, ToneTag, hrefWith } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import type { StreamView } from '@/lib/data/environment';
import { archiveWasteStream, restoreWasteStream, saveWasteStream } from '@/server/environment';
import {
  QUALIFICATION_KEYS, TREATMENT_CODES, TREATMENT_QUALIFICATIONS, WASTE_UNITS, defaultQualification, fmtDelta, fmtQty, isHazardousCode, isRecovery,
  isTransitCode, normalizeEwc, qualificationError, treatmentLabel,
} from './model';
import {
  CompanyIdField, LinkedActions, Note, SiretLine, Suggestions, muted, rowOpener, shortSite, type ActionOptions, type Carrier, type Installation,
} from './parts';
import { streamActionDefaults } from './action-defaults';

type Opt = readonly (readonly [string, string])[];
export type StreamSuggestions = {
  channels: string[]; collectors: string[]; destinations: string[];
  /** Identité connue des collecteurs et transporteurs, et des installations : préremplit les mentions vides à la saisie du nom. */
  carriers: Record<string, Carrier>;
  installations: Record<string, Installation>;
};

const QUALIFICATION_OPTIONS = QUALIFICATION_KEYS.map((k) => [k, TREATMENT_QUALIFICATIONS[k]] as const);
const RECEIPT_HINT = "Récépissé de déclaration de transport de déchets (R. 541-50) ; « Exempté » si le transport n'est pas soumis à déclaration.";

const TREATMENT_OPTIONS = TREATMENT_CODES.map(([c, l]) => [c, `${c} — ${l}`] as const);

// ─── Catalogue des filières ─────────────────────────────────────────────────

export function StreamsPanel({ streams, year, annee, isCurrent, canManage, showSite, sites, suggestions, actionOptions, initialId, closeHref }: {
  streams: StreamView[];
  /** Fiche ouverte d'emblée (lien profond `?onglet=filieres&filiere=<id>`, DOC-08). */
  initialId?: string;
  /** URL sans le lien profond, rétablie à la fermeture. */
  closeHref?: string;
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
  const router = useRouter();
  const [selId, setSelId] = useState<string | null>(initialId ?? null);
  const [archiving, setArchiving] = useState(false);
  const stream = selId ? streams.find((s) => s.id === selId) ?? null : null;
  const close = () => {
    setSelId(null);
    setArchiving(false);
    if (initialId && closeHref) router.replace(closeHref, { scroll: false });
  };

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
                    <span style={{ fontWeight: 500, color: s.archived ? 'var(--color-neutral-400)' : undefined }}>{s.label}</span>
                    {s.archived && <ToneTag tone="neutral" style={{ marginLeft: 8 }}>Archivée</ToneTag>}
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
                  <td style={{ color: 'var(--color-neutral-300)' }} title={s.gaps.length ? `À compléter : ${s.gaps.join(' · ')}` : undefined}>
                    {s.collector}
                    <SiretLine siret={s.collectorSiret} />
                  </td>
                  <td style={{ color: 'var(--color-neutral-400)', minWidth: 170 }}>
                    {s.destination}
                    <SiretLine siret={s.destinationSiret} />
                  </td>
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
                defaults={streamActionDefaults(stream, actionOptions?.today ?? '')} />
            </div>
            {stream.gaps.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Note icon="ph-warning" tone="warn">
                  Mentions du registre à compléter (arrêté du 31 mai 2021) : {stream.gaps.join(' · ')}. Elles sont copiées sur chaque nouvel enlèvement.
                </Note>
              </div>
            )}
            {stream.archived ? (
              // Filière archivée (DOC-09) : consultation seule, réactivation avec motif.
              <div style={{ display: 'grid', gap: 12 }}>
                <Note icon="ph-archive">
                  Filière archivée le {fmtDate(stream.archived.on)} par {stream.archived.by}{stream.archived.reason ? ` · ${stream.archived.reason}` : ''}. Elle n&apos;est plus proposée pour un nouvel enlèvement ; son registre et ses actions restent consultables.
                </Note>
                <ReasonForm action={restoreWasteStream} hidden={{ id: stream.id }} submitLabel="Réactiver la filière" submitIcon="ph-arrow-counter-clockwise"
                  placeholder="Ex. reprise de l'activité, archivage par erreur" onDone={close} onCancel={close} />
              </div>
            ) : archiving ? (
              <ReasonForm action={archiveWasteStream} hidden={{ id: stream.id }} submitLabel="Archiver la filière" submitIcon="ph-archive"
                message="La filière n'est plus proposée pour un nouvel enlèvement. Ses enlèvements (registre conservé 3 ans), ses actions et son historique restent consultables ; elle peut être réactivée."
                placeholder="Ex. déchet plus produit, changement de prestataire" onDone={close} onCancel={() => setArchiving(false)} />
            ) : (
              <>
                <StreamForm key={stream.id} stream={stream} sites={sites} defaultSite={stream.siteId} suggestions={suggestions} onDone={close} onCancel={close} />
                <div style={{ marginTop: 12 }}>
                  <button type="button" className="btn btn-ghost vg-btn-sm" onClick={() => setArchiving(true)}><Icon name="ph-archive" size={13} />Archiver la filière</button>
                </div>
              </>
            )}
            <div style={{ marginTop: 12 }}><ChangeLogList entries={stream.history} /></div>
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
  // Qualification : proposée d'après le code de traitement tant qu'elle n'a pas été choisie à la main.
  const proposed = (c: string) => defaultQualification(c) ?? '';
  const [qualification, setQualification] = useState(stream ? stream.qualification ?? proposed(stream.treatmentCode) : '');
  const [qualificationTyped, setQualificationTyped] = useState(!!stream?.qualification && stream.qualification !== proposed(stream.treatmentCode));
  const transit = !!treatment && isTransitCode(treatment);
  const qualificationIssue = treatment ? qualificationError(treatment, qualification) : null;
  // Mentions du collecteur et de l'installation : préremplies depuis un nom connu, sans écraser une saisie.
  const [collectorSiret, setCollectorSiret] = useState(stream?.collectorSiret ?? '');
  const [collectorAddress, setCollectorAddress] = useState(stream?.collectorAddress ?? '');
  const [collectorReceipt, setCollectorReceipt] = useState(stream?.collectorReceipt ?? '');
  const [destinationSiret, setDestinationSiret] = useState(stream?.destinationSiret ?? '');
  const [destinationAddress, setDestinationAddress] = useState(stream?.destinationAddress ?? '');
  const onCollector = (name: string) => {
    const known = suggestions.carriers[name.trim()];
    if (!known) return;
    setCollectorSiret((v) => v || known.siret || '');
    setCollectorAddress((v) => v || known.address || '');
    setCollectorReceipt((v) => v || known.receipt || '');
  };
  const onDestination = (name: string) => {
    const known = suggestions.installations[name.trim()];
    if (!known) return;
    setDestinationSiret((v) => v || known.siret || '');
    setDestinationAddress((v) => v || known.address || '');
  };
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
          pour ne pas réécrire le registre chronologique. Les enlèvements déjà inscrits conservent les codes, l&apos;exutoire et les mentions enregistrés.
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
          <Select name="treatmentCode" options={TREATMENT_OPTIONS} placeholder="Choisir…" value={treatment}
            onChange={(e) => { setTreatment(e.target.value); if (!qualificationTyped) setQualification(proposed(e.target.value)); }}
            title={treatment ? treatmentLabel(treatment) : undefined} />
        </Field>
        <Field name="channel" label="Filière de traitement">
          <Input name="channel" defaultValue={stream?.channel} placeholder="Ex. Régénération, recyclage matière…" list={`${uid}-channels`} maxLength={80} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="qualification" label="Qualification du traitement final"
          hint={qualificationIssue
            ? <span style={{ color: TONE.warn.fg }}>{qualificationIssue}</span>
            : transit ? 'Opération de transit : le traitement final se précise à chaque enlèvement.' : 'Hiérarchie des modes de traitement (C. env. L. 541-1).'}>
          <Select name="qualification" options={QUALIFICATION_OPTIONS} placeholder={transit ? 'À préciser à chaque enlèvement' : 'Choisir…'} value={qualification}
            onChange={(e) => { setQualification(e.target.value); setQualificationTyped(true); }} />
        </Field>
        <Field name="siteId" label="Site" hint={lockHint}>
          <Select name="siteId" options={sites} defaultValue={stream?.siteId ?? defaultSite} disabled={locked} />
        </Field>
      </FormRow>
      <Checkbox name="pop" label="Contient des polluants organiques persistants (POP)" defaultChecked={stream?.pop} />

      <h6 className="vg-h6" style={{ marginTop: 4 }}>Collecteur</h6>
      <Field name="collector" label="Raison sociale" hint="Transporteur proposé par défaut à chaque enlèvement, avec ses mentions.">
        <Input name="collector" defaultValue={stream?.collector} placeholder="Ex. [Collecteur Huiles Ouest]" list={`${uid}-collectors`} maxLength={160}
          onChange={(e) => onCollector(e.target.value)} />
      </Field>
      <FormRow>
        <CompanyIdField name="collectorSiret" label="SIRET" value={collectorSiret} onChange={setCollectorSiret} foreign />
        <Field name="collectorReceipt" label="N° de récépissé" hint={RECEIPT_HINT}>
          <Input name="collectorReceipt" value={collectorReceipt} onChange={(e) => setCollectorReceipt(e.target.value)} maxLength={60} autoComplete="off" />
        </Field>
      </FormRow>
      <Field name="collectorAddress" label="Adresse">
        <Input name="collectorAddress" value={collectorAddress} onChange={(e) => setCollectorAddress(e.target.value)} maxLength={300} placeholder="N°, voie, code postal, commune" />
      </Field>

      <h6 className="vg-h6" style={{ marginTop: 4 }}>Destination</h6>
      <Field name="destination" label="Installation de destination (exutoire)">
        <Input name="destination" defaultValue={stream?.destination} placeholder="Raison sociale et commune de l'installation de traitement" list={`${uid}-destinations`} maxLength={200}
          onChange={(e) => onDestination(e.target.value)} />
      </Field>
      <FormRow>
        <CompanyIdField name="destinationSiret" label="SIRET de l'installation" value={destinationSiret} onChange={setDestinationSiret} foreign />
        <Field name="destinationAddress" label="Adresse de l'installation">
          <Input name="destinationAddress" value={destinationAddress} onChange={(e) => setDestinationAddress(e.target.value)} maxLength={300} placeholder="N°, voie, code postal, commune" />
        </Field>
      </FormRow>
      <Suggestions id={`${uid}-channels`} values={suggestions.channels} />
      <Suggestions id={`${uid}-collectors`} values={suggestions.collectors} />
      <Suggestions id={`${uid}-destinations`} values={suggestions.destinations} />
    </ActionForm>
  );
}
