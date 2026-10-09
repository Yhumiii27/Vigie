'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { Icon, ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import type { FormOptions } from '@/lib/data/options';
import type { ControlFilter, ControlView } from '@/lib/data/watch';
import { recordControl, saveControl } from '@/server/watch';
import { Facts, ViewSwitch, muted, rowOpener } from './parts';
import { addMonthsClamped } from './period';

type Opts = Pick<FormOptions, 'people' | 'sites'>;
export type ControlSuggestions = { types: string[]; organizations: string[] };
type View = 'fiche' | 'historique' | 'realise';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Périodicité après « tous les » : « tous les mois » plutôt que « tous les 1 mois ». */
const months = (n: number) => (n === 1 ? 'mois' : `${n} mois`);

/** Prochain contrôle = dernier + périodicité (vide tant que la saisie est incomplète). */
function nextFrom(lastOn: string, period: string) {
  const n = Number(period);
  return ISO.test(lastOn) && Number.isInteger(n) && n >= 1 && n <= 120 ? addMonthsClamped(lastOn, n) : '';
}

// ─── Tableau des contrôles ──────────────────────────────────────────────────

export function ControlsPanel({ rows, filter, canManage, options, today, showSite, suggestions, initialId, closeHref }: {
  rows: ControlView[];
  filter?: ControlFilter;
  canManage: boolean;
  options: Opts;
  today: string;
  /** « Tous les sites » : rappelle le site de chaque équipement. */
  showSite: boolean;
  suggestions: ControlSuggestions;
  /** Contrôle à ouvrir d'emblée (lien profond `?controle=<id>`). */
  initialId?: number;
  /** URL sans le lien profond, rétablie à la fermeture. */
  closeHref?: string;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<{ id: number; view: View } | null>(initialId ? { id: initialId, view: canManage ? 'fiche' : 'historique' } : null);
  const control = sel ? rows.find((c) => c.id === sel.id) ?? null : null;
  const shown = filter ? rows.filter((c) => c.filter === filter) : rows;
  const open = (id: number, view: View) => setSel({ id, view });
  const close = () => {
    setSel(null);
    if (closeHref) router.replace(closeHref, { scroll: false });
  };

  return (
    <div className="card" style={{ padding: '6px 14px 10px' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 960 }}>
          <thead>
            <tr>
              <th>Équipement</th><th>Contrôle</th><th>Périodicité</th><th>Organisme</th><th>Dernier</th><th>Prochain</th><th>Statut</th><th>Réserves</th>
              {canManage && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={canManage ? 9 : 8} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>
                {rows.length ? 'Aucun contrôle dans cette catégorie.' : showSite ? 'Aucun contrôle périodique suivi.' : 'Aucun contrôle périodique suivi sur ce site.'}
              </td></tr>
            )}
            {shown.map((c) => (
              <tr key={c.id} {...rowOpener(() => open(c.id, canManage ? 'fiche' : 'historique'))}>
                <td style={{ fontWeight: 500, minWidth: 180 }}>
                  {c.equipment}
                  {(showSite || c.responsible) && (
                    <div style={{ ...muted, fontWeight: 400, marginTop: 2 }}>{[showSite && c.siteLabel, c.responsible].filter(Boolean).join(' · ')}</div>
                  )}
                </td>
                <td style={{ color: 'var(--color-neutral-300)' }}>{c.controlType}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{c.period}</td>
                <td style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{c.organization}</td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--color-neutral-400)' }}>{c.last}</td>
                <td style={{ whiteSpace: 'nowrap', color: c.tone === 'neutral' ? 'var(--color-neutral-300)' : TONE[c.tone].dot }}>{c.next}</td>
                <td><ToneTag tone={c.tone} style={{ whiteSpace: 'nowrap' }}>{c.status}</ToneTag></td>
                <td style={{ color: 'var(--color-neutral-300)', whiteSpace: 'nowrap' }}>{c.reserves ?? '—'}</td>
                {canManage && (
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button type="button" className="vg-text-btn" title="Enregistrer un contrôle réalisé" onClick={() => open(c.id, 'realise')}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Icon name="ph-check-square-offset" size={13} />Réalisé
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!control} onClose={close} width={660}
        kicker={control ? `Contrôle périodique · ${control.siteLabel}` : undefined} title={control?.equipment ?? ''}>
        {control && sel && (
          <ControlDetail key={control.id} c={control} initialView={sel.view} canManage={canManage} options={options}
            today={today} suggestions={suggestions} onClose={close} />
        )}
      </Dialog>
    </div>
  );
}

/** Bouton « Ajouter un contrôle ». */
export function AddControlButton({ options, defaultSite, suggestions, today }: { options: Opts; defaultSite: string; suggestions: ControlSuggestions; today: string }) {
  return (
    <DialogButton label="Ajouter un contrôle" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Nouveau contrôle périodique" kicker="Contrôles périodiques" width={660}>
      {(close) => <ControlForm options={options} defaultSite={defaultSite} suggestions={suggestions} today={today} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

// ─── Fiche d'un contrôle ────────────────────────────────────────────────────

function ControlDetail({ c, initialView, canManage, options, today, suggestions, onClose }: {
  c: ControlView; initialView: View; canManage: boolean; options: Opts; today: string; suggestions: ControlSuggestions; onClose: () => void;
}) {
  const [view, setView] = useState<View>(canManage ? initialView : 'historique');
  // Confirmation après « Enregistrer le contrôle » (la vue bascule sur l'historique).
  const [recorded, setRecorded] = useState(false);
  const show = (v: View) => { setRecorded(false); setView(v); };
  const views: (readonly [View, string, string])[] = canManage
    ? [['fiche', 'Fiche', 'ph-pencil-simple'], ['historique', `Historique · ${c.records.length}`, 'ph-clock-counter-clockwise'], ['realise', 'Contrôle réalisé', 'ph-check-square-offset']]
    : [];

  return (
    <>
      <Facts items={[
        ['Statut', <ToneTag key="s" tone={c.tone} style={{ marginTop: 1 }}>{c.status}</ToneTag>],
        ['Prochain', <span key="n" style={{ color: c.tone === 'neutral' ? undefined : TONE[c.tone].dot }}>{c.next}</span>],
        ['Dernier', c.last],
        ['Périodicité', `Tous les ${months(c.periodMonths)}`],
        ['Organisme', c.organization],
        ['Responsable', c.responsible || '—'],
        ['Réserves', c.reserves ?? 'Aucune'],
      ]} />

      {views.length > 0 && <ViewSwitch name={`control-view-${c.id}`} value={view} onChange={show} options={views} />}

      {/* Pas de `key` dérivée des données : l'enregistrement les modifie et remonterait le formulaire avant son onDone. */}
      {view === 'fiche' && canManage && (
        <ControlForm c={c} options={options} defaultSite={c.siteId ?? ''} suggestions={suggestions} today={today} onDone={onClose} onCancel={onClose} />
      )}
      {view === 'historique' && recorded && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: TONE.ok.fg }}>
          <Icon name="ph-check-circle" size={15} style={{ color: TONE.ok.dot }} />Contrôle réalisé enregistré dans l&apos;historique.
        </div>
      )}
      {view === 'historique' && <History c={c} />}
      {view === 'realise' && canManage && (
        <RecordForm c={c} today={today} suggestions={suggestions} onDone={() => { setView('historique'); setRecorded(true); }} onCancel={onClose} />
      )}
    </>
  );
}

function History({ c }: { c: ControlView }) {
  if (!c.records.length) {
    return (
      <div className="vg-inset" style={{ padding: '12px 14px', fontSize: 12.5, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
        Aucun contrôle enregistré dans Vigie pour cet équipement. Dernier contrôle connu : {c.last}{c.reserves ? ` (réserves : ${c.reserves})` : ''}.
      </div>
    );
  }
  return (
    <div style={{ display: 'grid' }}>
      {c.records.map((r, i) => (
        <div key={r.id} className={i < c.records.length - 1 ? 'vg-rule-bottom' : undefined}
          style={{ display: 'grid', gridTemplateColumns: '84px minmax(0, 1fr)', gap: 12, padding: '10px 0' }}>
          <div style={{ display: 'grid', gap: 2, alignContent: 'start' }}>
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>{r.date}</span>
            {r.performedOn === c.lastOn && i === 0 && <span style={muted}>Dernier</span>}
          </div>
          <div style={{ display: 'grid', gap: 5, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
              <span>{r.organization}</span>
              <ToneTag tone={r.reserves ? 'warn' : 'ok'}>{r.reserves ? `Réserves · ${r.reserves}` : 'Sans réserve'}</ToneTag>
            </div>
            {r.notes && <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{r.notes}</p>}
            {r.files.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {r.files.map((f) => (
                  <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" className="vg-chip" title={`Ouvrir ${f.name}`} style={{ maxWidth: '100%' }}>
                    <Icon name={f.icon} size={13} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>{f.name}</span>
                    <span style={{ opacity: 0.6, whiteSpace: 'nowrap' }}>{f.size}</span>
                  </a>
                ))}
              </div>
            )}
            {!r.files.length && <span style={muted}>Pas de rapport joint.</span>}
            {r.recordedBy && <span style={muted}>Saisi par {r.recordedBy}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Formulaires ────────────────────────────────────────────────────────────

function Suggestions({ id, values }: { id: string; values: string[] }) {
  return <datalist id={id}>{values.map((v) => <option key={v} value={v} />)}</datalist>;
}

function ControlForm({ c, options, defaultSite, suggestions, today, onDone, onCancel }: {
  c?: ControlView; options: Opts; defaultSite: string; suggestions: ControlSuggestions; today: string; onDone: () => void; onCancel: () => void;
}) {
  const uid = useId();
  const [lastOn, setLastOn] = useState(c?.lastOn ?? '');
  const [period, setPeriod] = useState(c ? String(c.periodMonths) : '12');
  // Échéance saisie à la main (null = calculée).
  const [manualNext, setManualNext] = useState<string | null>(c && c.nextOn !== nextFrom(c.lastOn, String(c.periodMonths)) ? c.nextOn : null);
  const computed = nextFrom(lastOn, period);
  const nextOn = manualNext ?? computed;

  return (
    <ActionForm action={saveControl} hidden={{ id: c?.id }} onDone={onDone} onCancel={onCancel} submitLabel={c ? 'Enregistrer' : 'Ajouter le contrôle'}>
      <Field name="equipment" label="Équipement">
        <Input name="equipment" defaultValue={c?.equipment} placeholder="Ex. Pont roulant 10 t — atelier montage" maxLength={160} autoFocus={!c} />
      </Field>
      <FormRow>
        <Field name="controlType" label="Type de contrôle">
          <Input name="controlType" defaultValue={c?.controlType} placeholder="Ex. VGP levage" list={`${uid}-types`} maxLength={120} />
        </Field>
        <Field name="periodMonths" label="Périodicité (mois)">
          <Input name="periodMonths" type="number" min={1} max={120} step={1} inputMode="numeric" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="organization" label="Organisme" hint="Organisme agréé ou « Interne — service ».">
          <Input name="organization" defaultValue={c?.organization} placeholder="Ex. [Apave]" list={`${uid}-orgs`} maxLength={120} />
        </Field>
        <Field name="responsibleId" label="Responsable">
          <Select name="responsibleId" options={options.people} defaultValue={c?.responsibleId ?? ''} placeholder="Non désigné" />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="siteId" label="Site">
          <Select name="siteId" options={options.sites} defaultValue={c ? c.siteId ?? '' : defaultSite} placeholder="Tous les sites" />
        </Field>
        <Field name="reserves" label="Réserves en cours" hint="Vide = aucune. Mises à jour à chaque contrôle enregistré.">
          <Input name="reserves" defaultValue={c?.reserves ?? ''} placeholder="Ex. 1 · fin de course à régler" maxLength={160} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="lastOn" label="Dernier contrôle">
          <Input name="lastOn" type="date" value={lastOn} max={today} onChange={(e) => setLastOn(e.target.value)} />
        </Field>
        <Field name="nextOn" label="Prochain contrôle"
          hint={manualNext !== null ? (
            <>Saisie manuelle · <button type="button" className="vg-text-btn" style={{ fontSize: 11 }} onClick={() => setManualNext(null)}>
              recalculer{computed ? ` (${fmtDate(computed)})` : ''}
            </button></>
          ) : 'Calculé : dernier contrôle + périodicité.'}>
          <Input name="nextOn" type="date" value={nextOn} min={lastOn || undefined} onChange={(e) => setManualNext(e.target.value)} />
        </Field>
      </FormRow>
      <Suggestions id={`${uid}-types`} values={suggestions.types} />
      <Suggestions id={`${uid}-orgs`} values={suggestions.organizations} />
    </ActionForm>
  );
}

function RecordForm({ c, today, suggestions, onDone, onCancel }: {
  c: ControlView; today: string; suggestions: ControlSuggestions; onDone: () => void; onCancel: () => void;
}) {
  const uid = useId();
  const [date, setDate] = useState(today);
  const valid = ISO.test(date);
  const older = valid && date < c.lastOn;

  return (
    <ActionForm action={recordControl} hidden={{ controlId: c.id }} encType="multipart/form-data" onDone={onDone} onCancel={onCancel}
      submitLabel="Enregistrer le contrôle" submitIcon="ph-check-square-offset">
      <FormRow>
        <Field name="performedOn" label="Date du contrôle">
          <Input name="performedOn" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field name="organization" label="Organisme">
          <Input name="organization" defaultValue={c.organization} list={`${uid}-orgs`} maxLength={120} />
        </Field>
      </FormRow>
      <Field name="reserves" label="Réserves" hint="Nombre et objet, ex. « 1 · fin de course à régler ». Vide = aucune réserve.">
        <Input name="reserves" placeholder="Aucune" maxLength={160} />
      </Field>
      <Field name="notes" label="Observations">
        <TextArea name="notes" rows={2} maxLength={2000} placeholder="Points relevés, levée de réserves, suites données…" style={{ minHeight: 56 }} />
      </Field>
      <Field name="report" label="Rapport" hint="PDF, image ou document Office · 10 Mo maximum.">
        <Input name="report" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif,.doc,.docx,.xls,.xlsx,.pptx,.txt,.csv" />
      </Field>
      <div className="vg-inset" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 12, color: 'var(--color-neutral-300)' }}>
        <Icon name="ph-calendar-check" size={15} style={{ color: older ? 'var(--color-neutral-500)' : 'var(--color-accent)', flex: 'none' }} />
        <span style={{ textWrap: 'pretty' }}>
          {!valid
            ? 'Saisissez la date du contrôle réalisé.'
            : older
              ? `Antérieur au dernier contrôle connu (${c.last}) : ajouté à l'historique sans modifier l'échéance.`
              : <>Prochain contrôle le <strong style={{ fontWeight: 500, color: 'var(--color-text)' }}>{fmtDate(addMonthsClamped(date, c.periodMonths))}</strong> (tous les {months(c.periodMonths)}).</>}
        </span>
      </div>
      <Suggestions id={`${uid}-orgs`} values={suggestions.organizations} />
    </ActionForm>
  );
}
