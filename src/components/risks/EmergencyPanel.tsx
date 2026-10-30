'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { ReasonButton } from '@/components/ReasonDialog';
import { ToneTag } from '@/components/ui';
import { Facts, Notice, muted, rowOpener } from '@/components/watch/parts';
import { fmtDate } from '@/lib/dates';
import { DRILL_PERIODS } from '@/lib/emergency-rules';
import { withCurrent, type Option } from '@/lib/form-options';
import type { EmergencyView } from '@/lib/data/emergencies';
import { archiveEmergencySituation, cancelEmergencyDrill, recordEmergencyDrill, saveEmergencySituation } from '@/server/emergencies';

// Situations d'urgence (CNF-08, ISO 45001 §8.2, ISO 14001 §8.2) : situations identifiées par site, moyens et consignes,
// exercices planifiés et tenus. Vue ?vue=urgences de l'écran « Évaluation des risques » ; saisie : canEdit(role, 'risks') ;
// archivage et annulation d'un exercice : animateur QHSE et direction (motif).

type Opts = { sites: readonly Option[]; people: readonly Option[] };

const PERIOD_OPTIONS = DRILL_PERIODS.map((m) => [String(m), m === 6 ? 'Tous les 6 mois' : m === 12 ? 'Chaque année' : `Tous les ${m / 12} ans`] as const);

export function EmergencyPanel({ rows, archived, canManage, canApprove, options, today, showSite, versions, defaultSite, initialId, closeHref }: {
  rows: EmergencyView[]; archived: EmergencyView[]; canManage: boolean; canApprove: boolean; options: Opts; today: string; showSite: boolean;
  versions: Record<string, string>; defaultSite: string; initialId?: number; closeHref: string;
}) {
  const router = useRouter();
  const [selId, setSelId] = useState<number | null>(initialId ?? null);
  const [showArchived, setShowArchived] = useState(initialId != null && archived.some((a) => a.id === initialId));
  const all = [...rows, ...archived];
  const sel = all.find((r) => r.id === selId) ?? null;
  const close = () => {
    setSelId(null);
    if (initialId != null) router.replace(closeHref, { scroll: false });
  };
  const list = showArchived ? archived : rows;
  return (
    <div className="card" style={{ gap: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="card-title" style={{ fontSize: 14 }}>Situations d&apos;urgence</span>
        <span style={{ ...muted, fontSize: 12 }}>ISO 45001 §8.2 · ISO 14001 §8.2 — exercices planifiés et tracés</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {archived.length > 0 && (
            <button type="button" className={`vg-chip${showArchived ? ' is-on' : ''}`} aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
              <i className="ph ph-archive" style={{ fontSize: 12 }} aria-hidden />Archivées<span style={{ color: 'var(--color-neutral-500)' }}>{archived.length}</span>
            </button>
          )}
          {canManage && (
            <DialogButton label="Identifier une situation" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Nouvelle situation d'urgence" kicker="Situations d'urgence" width={640}>
              {(done) => <SituationForm options={options} defaultSite={defaultSite} onDone={done} onCancel={done} />}
            </DialogButton>
          )}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 720 }}>
          <thead><tr><th>Situation</th><th>Périodicité</th><th>Dernier exercice</th><th>Prochain exercice</th><th>Responsable</th></tr></thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={5} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>
                {showArchived ? 'Aucune situation archivée.' : "Aucune situation d'urgence identifiée sur ce site."}
              </td></tr>
            )}
            {list.map((r) => (
              <tr key={r.id} {...rowOpener(() => setSelId(r.id))} data-obsolete={r.archived ? true : undefined}>
                <td>{r.label}{showSite && <div style={{ ...muted, marginTop: 2 }}>{r.siteLabel}</div>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.drillMonths} mois</td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.lastHeldOn ? fmtDate(r.lastHeldOn) : 'Aucun'}</td>
                <td>{r.due ? <ToneTag tone={r.due.tone} style={{ whiteSpace: 'nowrap' }}>{r.due.label}</ToneTag> : <span style={muted}>Archivée</span>}</td>
                <td>{r.owner || <span style={muted}>{canManage || canApprove ? 'Responsable QHSE du site' : '—'}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={!!sel} onClose={close} width={680} kicker={sel ? `Situation d'urgence · ${sel.siteLabel}` : undefined} title={sel?.label ?? ''}>
        {sel && <SituationDetail key={sel.id} s={sel} canManage={canManage} canApprove={canApprove} options={options} today={today} version={versions[String(sel.id)]} onClose={close} />}
      </Dialog>
    </div>
  );
}

function SituationDetail({ s, canManage, canApprove, options, today, version, onClose }: {
  s: EmergencyView; canManage: boolean; canApprove: boolean; options: Opts; today: string; version?: string; onClose: () => void;
}) {
  const editable = canManage && !s.archived;
  const [view, setView] = useState<'fiche' | 'exercice' | 'modifier'>('fiche');
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <Facts items={[
        ['Site', s.siteLabel],
        ['Périodicité des exercices', `${s.drillMonths} mois`],
        ['Prochain exercice', s.due ? <ToneTag key="d" tone={s.due.tone}>{s.due.label}</ToneTag> : '—'],
        !!s.due?.plannedLate && ['Exercice planifié', `${fmtDate(s.nextDrillOn!)} — après l'échéance de la périodicité`],
        ['Responsable', s.owner || 'Responsable QHSE du site'],
        ['Identifiée le', fmtDate(s.createdOn)],
      ]} />
      {s.archived && <Notice tone="warn" icon="ph-archive">Archivée le {fmtDate(s.archived.on)}{s.archived.by && ` par ${s.archived.by}`} — motif : {s.archived.reason}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {s.scenario && (
        <div>
          <div className="vg-eyebrow" style={{ marginBottom: 4 }}>Scénario</div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{s.scenario}</p>
        </div>
      )}
      {s.response && (
        <div>
          <div className="vg-eyebrow" style={{ marginBottom: 4 }}>Moyens d&apos;intervention et consignes</div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{s.response}</p>
        </div>
      )}
      <div style={{ display: 'grid', gap: 6 }}>
        <div className="vg-eyebrow">Exercices</div>
        {s.drills.length === 0 && <span style={{ fontSize: 12, color: 'var(--vg-text-muted)' }}>Aucun exercice tracé.</span>}
        {s.drills.map((d) => (
          <div key={d.id} style={{ display: 'grid', gap: 2, fontSize: 12.5 }}>
            <span style={d.cancelled ? { textDecoration: 'line-through', color: 'var(--color-neutral-400)' } : { fontWeight: 500 }}>Exercice du {fmtDate(d.heldOn)}{d.by && ` · saisi par ${d.by}`}</span>
            {d.participants && <span style={{ color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>Participants : {d.participants}</span>}
            {d.findings && <span style={{ color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{d.findings}</span>}
            {d.cancelled ? (
              <span style={{ fontSize: 11.5, color: 'var(--vg-text-muted)' }}>Annulé le {fmtDate(d.cancelled.on)}{d.cancelled.by && ` par ${d.cancelled.by}`} · Motif : {d.cancelled.reason}</span>
            ) : canApprove && !s.archived && (
              <ReasonButton label="Annuler l'exercice" className="vg-text-btn" style={{ justifySelf: 'start' }} title="Annuler l'exercice" kicker={s.label}
                action={cancelEmergencyDrill} hidden={{ id: d.id }} submitLabel="Annuler l'exercice" placeholder="Ex. saisi sur la mauvaise situation"
                message="L'exercice reste à l'historique, barré ; le prochain exercice est recalculé." onDone={() => setNotice('Exercice annulé.')} />
            )}
          </div>
        ))}
      </div>
      {editable && view === 'fiche' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary vg-btn-sm" onClick={() => setView('exercice')}><i className="ph ph-siren" aria-hidden />Enregistrer un exercice</button>
          <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setView('modifier')}><i className="ph ph-pencil-simple" aria-hidden />Modifier</button>
          {canApprove && (
            <ReasonButton label="Archiver" icon="ph-archive" title="Archiver la situation d'urgence" kicker={s.label} action={archiveEmergencySituation} hidden={{ id: s.id }}
              submitLabel="Archiver" message="La situation sort du suivi des exercices ; elle reste consultable avec ses exercices et son historique."
              placeholder="Ex. installation démontée" onDone={onClose} />
          )}
        </div>
      )}
      {editable && view === 'exercice' && (
        <ActionForm action={recordEmergencyDrill} hidden={{ situationId: s.id }} submitLabel="Enregistrer l'exercice" onDone={() => { setView('fiche'); setNotice('Exercice enregistré.'); }} onCancel={() => setView('fiche')}>
          <Field name="heldOn" label="Tenu le">
            <Input name="heldOn" type="date" defaultValue={today} max={today} />
          </Field>
          <Field name="participants" label="Participants" hint="Services, équipes, nombre de personnes, secours extérieurs.">
            <TextArea name="participants" rows={2} maxLength={1000} />
          </Field>
          <Field name="findings" label="Déroulement et enseignements" hint="Durée d'évacuation, écarts constatés, améliorations à prévoir.">
            <TextArea name="findings" rows={3} maxLength={2000} />
          </Field>
        </ActionForm>
      )}
      {editable && view === 'modifier' && (
        <SituationForm s={s} options={options} defaultSite={s.siteId} version={version} onDone={onClose} onCancel={() => setView('fiche')} />
      )}
      <LazyChangeLog entity="emergency_situation" id={s.id} title="Journal des modifications" />
    </>
  );
}

function SituationForm({ s, options, defaultSite, version, onDone, onCancel }: {
  s?: EmergencyView; options: Opts; defaultSite: string; version?: string; onDone: () => void; onCancel: () => void;
}) {
  const sites = s ? withCurrent(options.sites, s.siteId, s.siteLabel) : options.sites;
  const people = s ? withCurrent(options.people, s.ownerId, `${s.owner || s.ownerId} — sorti de l'effectif`) : options.people;
  const periods = s && !PERIOD_OPTIONS.some(([v]) => v === String(s.drillMonths)) ? [...PERIOD_OPTIONS, [String(s.drillMonths), `Tous les ${s.drillMonths} mois`] as const] : PERIOD_OPTIONS;
  return (
    <ActionForm action={saveEmergencySituation} hidden={{ id: s?.id, version: s ? version : undefined }} onDone={onDone} onCancel={onCancel} submitLabel={s ? 'Enregistrer' : 'Identifier la situation'}>
      <FormRow>
        <Field name="label" label="Situation d'urgence" hint="Ex. Incendie de l'atelier, déversement de produit chimique.">
          <Input name="label" defaultValue={s?.label ?? ''} maxLength={160} autoFocus={!s} />
        </Field>
        <Field name="siteId" label="Site">
          <Select name="siteId" options={sites} defaultValue={s?.siteId ?? (sites.some(([v]) => v === defaultSite) ? defaultSite : sites[0]?.[0] ?? '')} />
        </Field>
      </FormRow>
      <Field name="scenario" label="Scénario" hint="Ce qui peut arriver, où, et ses conséquences possibles.">
        <TextArea name="scenario" rows={2} maxLength={2000} defaultValue={s?.scenario ?? ''} />
      </Field>
      <Field name="response" label="Moyens d'intervention et consignes" hint="Moyens, consignes affichées, personnes formées, secours extérieurs.">
        <TextArea name="response" rows={2} maxLength={2000} defaultValue={s?.response ?? ''} />
      </Field>
      <FormRow>
        <Field name="drillMonths" label="Périodicité des exercices">
          <Select name="drillMonths" options={periods} defaultValue={String(s?.drillMonths ?? 12)} />
        </Field>
        <Field name="nextDrillOn" label="Prochain exercice planifié le" hint="Facultatif.">
          <Input name="nextDrillOn" type="date" defaultValue={s?.nextDrillOn ?? ''} />
        </Field>
      </FormRow>
      <Field name="ownerId" label="Responsable" hint="Sans responsable : le responsable QHSE du site reçoit l'échéance.">
        <Select name="ownerId" options={people} defaultValue={s?.ownerId ?? ''} placeholder="Non désigné" />
      </Field>
    </ActionForm>
  );
}
