'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LazyChangeLog } from '@/components/LazyChangeLog';
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
} from '@/lib/rules/environment';
import {
  CompanyIdField, LinkedActions, Note, SiretLine, Suggestions, muted, rowOpener, shortSite, type ActionOptions, type Carrier, type Installation,
} from './parts';
import { streamActionDefaults } from './action-defaults';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

type Opt = readonly (readonly [string, string])[];
export type StreamSuggestions = {
  channels: string[]; collectors: string[]; destinations: string[];
  /** Identité connue des collecteurs et transporteurs, et des installations : préremplit les mentions vides à la saisie du nom. */
  carriers: Record<string, Carrier>;
  installations: Record<string, Installation>;
};

const QUALIFICATION_OPTIONS = QUALIFICATION_KEYS.map((k) => [k, TREATMENT_QUALIFICATIONS[k]] as const);
const RECEIPT_HINT = 'Receipt of the waste transport declaration (R. 541-50); “Exempted” if the transport is not subject to declaration.';

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
  const { t } = useI18n();
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
              <th>{t('Waste stream')}</th><th>{t('Waste code')}</th><th>{t('Treatment')}</th><th>{t('Collector')}</th><th>{t('Destination facility')}</th>
              <th style={{ textAlign: 'right' }}>{year}</th><th style={{ textAlign: 'right' }}>{year - 1}</th><th style={{ textAlign: 'right' }}>{fill(t('Rem. {year}'), { year })}</th>
            </tr>
          </thead>
          <tbody>
            {streams.length === 0 && (
              <tr><td colSpan={8} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>
                {t('No waste stream for this site')}{canManage ? t(': create the first one with “New waste stream”.') : '.'}
              </td></tr>
            )}
            {streams.map((s) => {
              const delta = s.prevPeriodQty ? (s.yearQty - s.prevPeriodQty) / s.prevPeriodQty : null;
              return (
                <tr key={s.id} {...(canManage ? rowOpener(() => setSelId(s.id)) : {})}>
                  <td style={{ minWidth: 200 }}>
                    <span style={{ fontWeight: 500, color: s.archived ? 'var(--color-neutral-400)' : undefined }}>{s.label}</span>
                    {s.archived && <ToneTag tone="neutral" style={{ marginLeft: 8 }}>{t('Archived#f')}</ToneTag>}
                    <div style={muted}>{[s.id, showSite && shortSite(s.site), s.channel].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-300)', marginRight: 8 }}>{s.ewcCode}</span>
                    {s.hazardous && <ToneTag tone="warn">{t('Hazardous')}</ToneTag>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }} title={s.treatmentLabel}>
                    <span style={{ fontWeight: 500 }}>{s.treatmentCode}</span>
                    <span style={{ ...muted, marginLeft: 6 }}>{s.recovery ? t('recovery') : t('disposal')}</span>
                  </td>
                  <td style={{ color: 'var(--color-neutral-300)' }} title={s.gaps.length ? fill(t('To complete: {gaps}'), { gaps: s.gaps.join(' · ') }) : undefined}>
                    {s.collector}
                    <SiretLine siret={s.collectorSiret} />
                  </td>
                  <td style={{ color: 'var(--color-neutral-400)', minWidth: 170 }}>
                    {s.destination}
                    <SiretLine siret={s.destinationSiret} />
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {s.yearQty ? fmtQty(s.yearQty, s.unit) : <span style={{ color: 'var(--vg-text-muted)' }}>—</span>}
                    {delta != null && s.yearQty > 0 && <div style={muted}>{fmtDelta(delta)} {fill(t('vs {id}'), { id: year - 1 })}{isCurrent ? t(' same period') : ''}</div>}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-400)' }}>
                    {s.prevQty ? fmtQty(s.prevQty, s.unit) : '—'}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {s.yearCount ? <Link href={registerHref(s.id)} scroll={false} className="vg-link" title={fill(t('Register {year} filtered on this waste stream'), { year })}>{s.yearCount}<span className="vg-sr-only">{fill(s.yearCount > 1 ? t(' removals: register {year} filtered on this waste stream') : t(' removal: register {year} filtered on this waste stream'), { year })}</span></Link> : 0}
                    {s.lastRemovedOn && <div style={muted}>{fill(t('last {date}'), { date: fmtDate(s.lastRemovedOn) })}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={!!stream} onClose={close} width={640} kicker={stream ? `${t('Waste stream')} ${stream.id} · ${shortSite(stream.site)}` : undefined} title={stream?.label ?? ''}>
        {stream && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--color-neutral-300)', marginBottom: 12 }}>
              <Icon name="ph-list-numbers" size={14} />
              {stream.yearCount ? (
                <Link href={registerHref(stream.id)} scroll={false} className="vg-link" onClick={close}>
                  {fill(stream.yearCount > 1 ? t('See the {n} removals of {year} in the register') : t('See the removal of {year} in the register'), { n: stream.yearCount, year })}
                </Link>
              ) : <span>{fill(t('No removal in {year}.'), { year })}</span>}
              {stream.entryCount > stream.yearCount && <span style={muted}>· {fill(t('{n} all years'), { n: stream.entryCount })}</span>}
              {stream.cancelledCount > 0 && <span style={muted}>· {fill(stream.cancelledCount > 1 ? t('{n} cancelled#mplural') : t('{n} cancelled#m'), { n: stream.cancelledCount })}</span>}
            </div>
            <div style={{ marginBottom: 14 }}>
              <LinkedActions actions={stream.actions} options={actionOptions} canAct={!!actionOptions}
                defaults={streamActionDefaults(stream, actionOptions?.today ?? '')} />
            </div>
            {stream.gaps.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Note icon="ph-warning" tone="warn">
                  {fill(t('Register mentions to complete (order of 31 May 2021): {gaps}. They are copied onto each new removal.'), { gaps: stream.gaps.join(' · ') })}
                </Note>
              </div>
            )}
            {stream.archived ? (
              // Filière archivée (DOC-09) : consultation seule, réactivation avec motif.
              <div style={{ display: 'grid', gap: 12 }}>
                <Note icon="ph-archive">
                  {fill(t('Waste stream archived on {date} by {name}'), { date: fmtDate(stream.archived.on), name: stream.archived.by })}{stream.archived.reason ? ` · ${stream.archived.reason}` : ''}{t('. It is no longer offered for a new removal; its register and its actions stay viewable.')}
                </Note>
                <ReasonForm action={restoreWasteStream} hidden={{ id: stream.id }} submitLabel={t('Reactivate the waste stream')} submitIcon="ph-arrow-counter-clockwise"
                  placeholder={t('E.g. activity resumed, archived by mistake')} onDone={close} onCancel={close} />
              </div>
            ) : archiving ? (
              <ReasonForm action={archiveWasteStream} hidden={{ id: stream.id }} submitLabel={t('Archive the waste stream')} submitIcon="ph-archive"
                message={t('The waste stream is no longer offered for a new removal. Its removals (register kept 3 years), its actions and its history stay viewable; it can be reactivated.')}
                placeholder={t('E.g. waste no longer produced, change of provider')} onDone={close} onCancel={() => setArchiving(false)} />
            ) : (
              <>
                <StreamForm key={stream.id} stream={stream} sites={sites} defaultSite={stream.siteId} suggestions={suggestions} onDone={close} onCancel={close} />
                <div style={{ marginTop: 12 }}>
                  <button type="button" className="btn btn-ghost vg-btn-sm" onClick={() => setArchiving(true)}><Icon name="ph-archive" size={13} />{t('Archive the waste stream')}</button>
                </div>
              </>
            )}
            <div style={{ marginTop: 12 }}><LazyChangeLog entity="waste_stream" id={stream.id} /></div>
          </>
        )}
      </Dialog>
    </div>
  );
}

/** Bouton « Nouvelle filière ». */
export function NewStreamButton({ sites, defaultSite, suggestions }: { sites: Opt; defaultSite: string; suggestions: StreamSuggestions }) {
  const { t } = useI18n();
  return (
    <DialogButton label={t('New waste stream')} icon="ph-plus" className="btn btn-primary vg-btn-sm" title={t('New waste stream#title')} kicker={t('Waste streams')} width={640}>
      {(close) => <StreamForm sites={sites} defaultSite={defaultSite} suggestions={suggestions} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

// ─── Formulaire de filière ──────────────────────────────────────────────────

function StreamForm({ stream, sites, defaultSite, suggestions, onDone, onCancel }: {
  stream?: StreamView; sites: Opt; defaultSite: string; suggestions: StreamSuggestions; onDone: () => void; onCancel: () => void;
}) {
  const { t } = useI18n();
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
  const lockHint = locked ? t('Locked.') : undefined;

  return (
    <ActionForm action={saveWasteStream} hidden={{ id: stream?.id, version: stream?.version }} onDone={onDone} onCancel={onCancel} submitLabel={stream ? t('Save') : t('Create the waste stream')}>
      <Field name="label" label={t('Label')}>
        <Input name="label" defaultValue={stream?.label} placeholder={t('E.g. Used hydraulic oils')} maxLength={120} autoFocus={!stream} />
      </Field>
      {locked && (
        <Note icon="ph-lock-simple">
          {fill(registered > 1 ? t('{n} removals in the register') : t('{n} removal in the register'), { n: registered })}{stream!.cancelledCount ? fill(stream!.cancelledCount > 1 ? t(' (of which {n} cancelled#plural)') : t(' (of which {n} cancelled)'), { n: stream!.cancelledCount }) : ''}{t(': site and unit are locked so as not to rewrite the chronological register. The removals already recorded keep the codes, the outlet and the mentions recorded.')}
        </Note>
      )}
      <FormRow>
        <Field name="ewcCode" label={t('Waste code')} hint={t('European list of waste: 6 digits, “*” if hazardous.')}>
          <Input name="ewcCode" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('E.g. 13 01 10*')} maxLength={20} autoComplete="off" />
        </Field>
        <Field name="unit" label={t('Unit')} hint={lockHint}>
          <Select name="unit" options={WASTE_UNITS} defaultValue={stream?.unit ?? 'kg'} disabled={locked} />
        </Field>
      </FormRow>
      {normalized && (
        <Note icon={hazardous ? 'ph-warning' : 'ph-check-circle'} tone={hazardous ? 'warn' : 'ok'}>
          {hazardous
            ? <>{normalized} · <strong style={{ fontWeight: 500, color: 'var(--color-text)' }}>{t('hazardous waste#one')}</strong>{t(': each removal requires a Trackdéchets slip.')}</>
            : <>{normalized} · {t('non-hazardous waste: recorded in the register, no slip required.')}</>}
        </Note>
      )}
      <FormRow>
        <Field name="treatmentCode" label={t('Treatment code')} hint={treatment ? (isRecovery(treatment) ? t('Recovery (R1–R13).') : t('Disposal (D1–D15).')) : undefined}>
          <Select name="treatmentCode" options={TREATMENT_OPTIONS} placeholder={t('Choose…')} value={treatment}
            onChange={(e) => { setTreatment(e.target.value); if (!qualificationTyped) setQualification(proposed(e.target.value)); }}
            title={treatment ? treatmentLabel(treatment) : undefined} />
        </Field>
        <Field name="channel" label={t('Treatment route')}>
          <Input name="channel" defaultValue={stream?.channel} placeholder={t('E.g. Regeneration, material recycling…')} list={`${uid}-channels`} maxLength={80} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="qualification" label={t('Qualification of the final treatment')}
          hint={qualificationIssue
            ? <span style={{ color: TONE.warn.fg }}>{qualificationIssue}</span>
            : transit ? t('Transit operation: the final treatment is specified at each removal.') : t('Hierarchy of the treatment methods (Env. Code L. 541-1).')}>
          <Select name="qualification" options={QUALIFICATION_OPTIONS} placeholder={transit ? t('To specify at each removal') : t('Choose…')} value={qualification}
            onChange={(e) => { setQualification(e.target.value); setQualificationTyped(true); }} />
        </Field>
        <Field name="siteId" label={t('Site')} hint={lockHint}>
          <Select name="siteId" options={sites} defaultValue={stream?.siteId ?? defaultSite} disabled={locked} />
        </Field>
      </FormRow>
      <Checkbox name="pop" label={t('Contains persistent organic pollutants (POP)')} defaultChecked={stream?.pop} />

      <h6 className="vg-h6" style={{ marginTop: 4 }}>{t('Collector')}</h6>
      <Field name="collector" label={t('Company name')} hint={t('Carrier offered by default at each removal, with its mentions.')}>
        <Input name="collector" defaultValue={stream?.collector} placeholder={t('E.g. [West Oil Collector]')} list={`${uid}-collectors`} maxLength={160}
          onChange={(e) => onCollector(e.target.value)} />
      </Field>
      <FormRow>
        <CompanyIdField name="collectorSiret" label={t('SIRET')} value={collectorSiret} onChange={setCollectorSiret} foreign />
        <Field name="collectorReceipt" label={t('Receipt no.')} hint={t(RECEIPT_HINT)}>
          <Input name="collectorReceipt" value={collectorReceipt} onChange={(e) => setCollectorReceipt(e.target.value)} maxLength={60} autoComplete="off" />
        </Field>
      </FormRow>
      <Field name="collectorAddress" label={t('Address')}>
        <Input name="collectorAddress" value={collectorAddress} onChange={(e) => setCollectorAddress(e.target.value)} maxLength={300} placeholder={t('No., street, postcode, town')} />
      </Field>

      <h6 className="vg-h6" style={{ marginTop: 4 }}>{t('Destination')}</h6>
      <Field name="destination" label={t('Destination facility (outlet)')}>
        <Input name="destination" defaultValue={stream?.destination} placeholder={t('Company name and town of the treatment facility')} list={`${uid}-destinations`} maxLength={200}
          onChange={(e) => onDestination(e.target.value)} />
      </Field>
      <FormRow>
        <CompanyIdField name="destinationSiret" label={t('SIRET of the facility')} value={destinationSiret} onChange={setDestinationSiret} foreign />
        <Field name="destinationAddress" label={t('Address of the facility')}>
          <Input name="destinationAddress" value={destinationAddress} onChange={(e) => setDestinationAddress(e.target.value)} maxLength={300} placeholder={t('No., street, postcode, town')} />
        </Field>
      </FormRow>
      <Suggestions id={`${uid}-channels`} values={suggestions.channels} />
      <Suggestions id={`${uid}-collectors`} values={suggestions.collectors} />
      <Suggestions id={`${uid}-destinations`} values={suggestions.destinations} />
    </ActionForm>
  );
}
