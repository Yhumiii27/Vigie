'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { ReasonButton } from '@/components/ReasonDialog';
import { Aside, CardHead, ToneTag } from '@/components/ui';
import { Facts, Notice, muted, rowOpener } from '@/components/watch/parts';
import { fmtDate } from '@/lib/dates';
import { CHANGE_KINDS, CHANGE_KIND_KEYS } from '@/lib/domain';
import { withCurrent, type Option } from '@/lib/form-options';
import type { ChangeView } from '@/lib/data/changes';
import { cancelChangeRequest, completeChangeRequest, decideChangeRequest, saveChangeRequest } from '@/server/changes';
import { RadioSeg } from './parts';

// Gestion des changements (CNF-11, ISO 9001 §6.3 et §8.5.6, ISO 45001 §8.1.3) : demandes de changement, effets évalués,
// décision du service QHSE, mise en œuvre constatée. Lecture : lecteurs de l'écran Audits ; saisie : animateur QHSE et
// direction (canEdit(role, 'audits')).

type Opts = { people: readonly Option[]; sites: readonly Option[] };
const KIND_OPTIONS = CHANGE_KIND_KEYS.map((k) => [k, CHANGE_KINDS[k].label] as const);

export function ChangesCard({ rows, canEdit, canApprove, options, versions, today, initialId, closeHref }: {
  rows: ChangeView[]; canEdit: boolean; canApprove: boolean; options: Opts; versions: Record<string, string>; today: string;
  initialId?: string; closeHref: string;
}) {
  const router = useRouter();
  const [selId, setSelId] = useState<string | null>(initialId ?? null);
  const [showClosed, setShowClosed] = useState(false);
  const sel = rows.find((r) => r.id === selId) ?? null;
  const close = () => {
    setSelId(null);
    if (initialId) router.replace(closeHref, { scroll: false });
  };
  const closed = (r: ChangeView) => !!r.cancelled || r.status === 'refusee' || r.status === 'realisee';
  const open = rows.filter((r) => !closed(r));
  const list = showClosed ? rows.filter(closed) : open;
  return (
    <div id="changements" className="card" style={{ gap: 10, scrollMarginTop: 16 }}>
      <CardHead title="Gestion des changements" aside={(
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Aside>ISO 9001 §6.3 · §8.5.6 · ISO 45001 §8.1.3</Aside>
          {rows.length > open.length && (
            <button type="button" className={`vg-chip${showClosed ? ' is-on' : ''}`} aria-pressed={showClosed} onClick={() => setShowClosed((v) => !v)}>
              Traitées<span style={{ color: 'var(--color-neutral-500)' }}>{rows.length - open.length}</span>
            </button>
          )}
          {canEdit && (
            <DialogButton label="Nouvelle demande" icon="ph-plus" title="Demande de changement" kicker="Gestion des changements" width={640}>
              {(done) => <ChangeForm options={options} onDone={done} onCancel={done} />}
            </DialogButton>
          )}
        </span>
      )} />
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 720 }}>
          <thead><tr><th>Réf.</th><th>Changement</th><th>Nature</th><th>Mise en œuvre</th><th>État</th></tr></thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={5} style={{ color: 'var(--color-neutral-500)', padding: '12px 8px' }}>{showClosed ? 'Aucune demande traitée.' : 'Aucune demande de changement en cours.'}</td></tr>
            )}
            {list.map((r) => (
              <tr key={r.id} {...rowOpener(() => setSelId(r.id))} data-obsolete={r.cancelled ? true : undefined}>
                <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{r.id}</td>
                <td>{r.title}<div style={{ ...muted, marginTop: 2 }}>{r.siteLabel}{r.pilot && ` · ${r.pilot}`}</div></td>
                <td>{r.kindLabel}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.done ? `le ${fmtDate(r.done.on)}` : r.plannedOn ? `prévue le ${fmtDate(r.plannedOn)}` : '—'}</td>
                <td><ToneTag tone={r.tone} style={{ whiteSpace: 'nowrap' }}>{r.statusLabel}</ToneTag></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={!!sel} onClose={close} width={680} kicker={sel ? `Gestion des changements · ${sel.id}` : undefined} title={sel?.title ?? ''}>
        {sel && <ChangeDetail key={sel.id} c={sel} canEdit={canEdit} canApprove={canApprove} options={options} version={versions[sel.id]} today={today} onClose={close} />}
      </Dialog>
    </div>
  );
}

function ChangeDetail({ c, canEdit, canApprove, options, version, today, onClose }: {
  c: ChangeView; canEdit: boolean; canApprove: boolean; options: Opts; version?: string; today: string; onClose: () => void;
}) {
  const [view, setView] = useState<'fiche' | 'modifier' | 'decision' | 'realisation'>('fiche');
  const [notice, setNotice] = useState<string | null>(null);
  const live = !c.cancelled;
  const editable = canEdit && live && (c.status === 'demandee' || c.status === 'acceptee');
  const text = (label: string, value: string) => value && (
    <div>
      <div className="vg-eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{value}</p>
    </div>
  );
  return (
    <>
      <Facts items={[
        ['État', <ToneTag key="s" tone={c.tone}>{c.statusLabel}</ToneTag>],
        ['Nature', c.kindLabel],
        ['Site', c.siteLabel],
        ['Pilote', c.pilot || '—'],
        ['Mise en œuvre prévue', c.plannedOn ? fmtDate(c.plannedOn) : '—'],
        ['Demandée le', `${fmtDate(c.createdOn)}${c.createdBy ? ` par ${c.createdBy}` : ''}`],
        !!c.decided && ['Décision', `${c.status === 'refusee' ? 'Refusée' : 'Acceptée'} le ${fmtDate(c.decided.on)}${c.decided.by ? ` par ${c.decided.by}` : ''}`],
        !!c.done && ['Mise en œuvre', `le ${fmtDate(c.done.on)}`],
      ]} />
      {c.cancelled && <Notice tone="warn" icon="ph-prohibit">Annulée le {fmtDate(c.cancelled.on)}{c.cancelled.by && ` par ${c.cancelled.by}`} — motif : {c.cancelled.reason}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {text('Description', c.description)}
      {text('Motif du changement', c.rationale)}
      {text('Effets évalués (risques, ressources, exigences, documents)', c.impacts)}
      {c.decided && text('Justification de la décision', c.decided.note)}
      {c.done && text('Mise en œuvre constatée', c.done.note)}
      {live && view === 'fiche' && (canEdit || canApprove) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {canApprove && c.status === 'demandee' && (
            <button type="button" className="btn btn-primary vg-btn-sm" onClick={() => setView('decision')}><i className="ph ph-gavel" aria-hidden />Décider</button>
          )}
          {canEdit && c.status === 'acceptee' && (
            <button type="button" className="btn btn-primary vg-btn-sm" onClick={() => setView('realisation')}><i className="ph ph-check-circle" aria-hidden />Mise en œuvre constatée</button>
          )}
          {editable && <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setView('modifier')}><i className="ph ph-pencil-simple" aria-hidden />Modifier</button>}
          {canApprove && c.status !== 'realisee' && (
            <ReasonButton label="Annuler la demande" icon="ph-prohibit" title="Annuler la demande de changement" kicker={c.id} action={cancelChangeRequest} hidden={{ id: c.id }}
              submitLabel="Annuler la demande" message="La demande n'est jamais supprimée : elle reste au registre, barrée, avec son motif, et sort des échéances."
              placeholder="Ex. doublon, changement abandonné" onDone={() => setNotice('Demande annulée.')} />
          )}
        </div>
      )}
      {view === 'decision' && (
        <DecisionForm c={c} today={today} onDone={() => { setView('fiche'); setNotice('Décision enregistrée.'); }} onCancel={() => setView('fiche')} />
      )}
      {view === 'realisation' && (
        <ActionForm action={completeChangeRequest} hidden={{ id: c.id }} submitLabel="Enregistrer la mise en œuvre" onDone={() => { setView('fiche'); setNotice('Mise en œuvre enregistrée.'); }} onCancel={() => setView('fiche')}>
          <Field name="doneOn" label="Mis en œuvre le"><Input name="doneOn" type="date" defaultValue={today} max={today} /></Field>
          <Field name="doneNote" label="Constat" hint="Ce qui a été fait, documents mis à jour, personnes informées ou formées.">
            <TextArea name="doneNote" rows={3} maxLength={2000} />
          </Field>
        </ActionForm>
      )}
      {view === 'modifier' && <ChangeForm c={c} options={options} version={version} onDone={onClose} onCancel={() => setView('fiche')} />}
      <LazyChangeLog entity="change_request" id={c.id} title="Journal des modifications" />
    </>
  );
}

function DecisionForm({ c, today, onDone, onCancel }: { c: ChangeView; today: string; onDone: () => void; onCancel: () => void }) {
  const [decision, setDecision] = useState('acceptee');
  return (
    <ActionForm action={decideChangeRequest} hidden={{ id: c.id }} submitLabel="Enregistrer la décision" onDone={onDone} onCancel={onCancel}>
      <Field name="decision" group label="Décision">
        <RadioSeg name="decision" defaultValue="acceptee" onChange={setDecision} options={[['acceptee', 'Accepter'], ['refusee', 'Refuser']]} />
      </Field>
      <FormRow>
        <Field name="decidedOn" label="Décidé le"><Input name="decidedOn" type="date" defaultValue={today} max={today} /></Field>
        {decision === 'acceptee' && (
          <Field name="plannedOn" label="Mise en œuvre prévue le" hint="Facultatif."><Input name="plannedOn" type="date" defaultValue={c.plannedOn ?? ''} /></Field>
        )}
      </FormRow>
      <Field name="decisionNote" label="Justification" hint="Effets évalués, conditions, ressources accordées ou raison du refus.">
        <TextArea name="decisionNote" rows={3} maxLength={2000} />
      </Field>
    </ActionForm>
  );
}

function ChangeForm({ c, options, version, onDone, onCancel }: { c?: ChangeView; options: Opts; version?: string; onDone: () => void; onCancel: () => void }) {
  const sites = c ? withCurrent(options.sites, c.siteId ?? 'all', c.siteLabel) : options.sites;
  const people = c ? withCurrent(options.people, c.pilotId, `${c.pilot || c.pilotId} — sorti de l'effectif`) : options.people;
  return (
    <ActionForm action={saveChangeRequest} hidden={{ id: c?.id, version: c ? version : undefined }} onDone={onDone} onCancel={onCancel} submitLabel={c ? 'Enregistrer' : 'Enregistrer la demande'}>
      <Field name="title" label="Changement" hint="Ex. Nouvelle cabine de peinture, réorganisation du magasin.">
        <Input name="title" defaultValue={c?.title ?? ''} maxLength={160} autoFocus={!c} />
      </Field>
      <FormRow>
        <Field name="kind" label="Nature"><Select name="kind" options={KIND_OPTIONS} defaultValue={c?.kind ?? 'procede'} /></Field>
        <Field name="siteId" label="Site"><Select name="siteId" options={sites} defaultValue={c ? c.siteId ?? 'all' : sites[0]?.[0] ?? ''} /></Field>
      </FormRow>
      <Field name="description" label="Description"><TextArea name="description" rows={3} maxLength={2000} defaultValue={c?.description ?? ''} /></Field>
      <Field name="rationale" label="Motif du changement" hint="Pourquoi changer : besoin, opportunité, exigence nouvelle.">
        <TextArea name="rationale" rows={2} maxLength={2000} defaultValue={c?.rationale ?? ''} />
      </Field>
      <Field name="impacts" label="Effets évalués" hint="Risques et opportunités, conséquences sur la sécurité, les ressources, les exigences et les documents.">
        <TextArea name="impacts" rows={3} maxLength={2000} defaultValue={c?.impacts ?? ''} />
      </Field>
      <FormRow>
        <Field name="pilotId" label="Pilote"><Select name="pilotId" options={people} defaultValue={c?.pilotId ?? ''} placeholder="Non désigné" /></Field>
        <Field name="plannedOn" label="Mise en œuvre prévue le" hint="Facultatif."><Input name="plannedOn" type="date" defaultValue={c?.plannedOn ?? ''} /></Field>
      </FormRow>
    </ActionForm>
  );
}
