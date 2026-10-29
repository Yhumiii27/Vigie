'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { ReasonButton } from '@/components/ReasonDialog';
import { ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { SAFETY_NOTICE_KINDS, SAFETY_NOTICE_KIND_KEYS } from '@/lib/domain';
import type { Option } from '@/lib/form-options';
import type { SafetyNoticeView } from '@/lib/data/watch';
import { answerSafetyNotice, cancelSafetyNotice, saveSafetyNotice } from '@/server/watch';
import { Facts, Notice, muted, rowOpener } from './parts';

// Registre de sécurité (VEI-15, L. 4711-1 et L. 4711-2) : observations et mises en demeure de l'inspection du travail, de
// la CARSAT ou d'un organisme, avec le délai de réponse et la réponse apportée ; imprimé avec les vérifications du site
// (/veille/registre-securite). Saisie par l'encadrement de la veille ; annulation motivée par le service QHSE.

/** Équipements proposés : [identifiant, libellé, site] (contrôles en service ; site null = commun à tous les sites). */
export type NoticeControlOption = readonly [string, string, string | null];
type Opts = { sites: readonly Option[]; controls: readonly NoticeControlOption[] };

const KIND_OPTIONS = SAFETY_NOTICE_KIND_KEYS.map((k) => [k, SAFETY_NOTICE_KINDS[k].label] as const);

export function SafetyRegisterPanel({ rows, canManage, canApprove, options, today, showSite, initialId, closeHref }: {
  rows: SafetyNoticeView[];
  canManage: boolean;
  /** Animateur QHSE, direction : annulation d'une saisie erronée. */
  canApprove: boolean;
  options: Opts;
  today: string;
  showSite: boolean;
  /** Observation à ouvrir d'emblée (lien profond `?observation=<id>`). */
  initialId?: number;
  closeHref?: string;
}) {
  const router = useRouter();
  const [selId, setSelId] = useState<number | null>(initialId ?? null);
  const sel = rows.find((r) => r.id === selId) ?? null;
  const close = () => {
    setSelId(null);
    if (closeHref) router.replace(closeHref, { scroll: false });
  };
  return (
    <div className="card" style={{ padding: '6px 14px 10px' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 860 }}>
          <thead><tr><th>Reçue le</th><th>Nature</th><th>Émetteur</th><th>Objet</th><th>Délai</th><th>État</th></tr></thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>Aucune observation ni mise en demeure inscrite.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} {...rowOpener(() => setSelId(r.id))} data-obsolete={r.cancelled ? true : undefined}>
                <td style={{ whiteSpace: 'nowrap', textDecoration: r.cancelled ? 'line-through' : undefined }}>
                  {fmtDate(r.receivedOn)}
                  {showSite && <div style={{ ...muted, marginTop: 2 }}>{r.siteLabel}</div>}
                </td>
                <td><ToneTag tone={r.cancelled ? 'neutral' : r.tone} style={{ whiteSpace: 'nowrap' }}>{r.kindLabel}</ToneTag></td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.authority}{r.reference && <div style={{ ...muted, marginTop: 2 }}>{r.reference}</div>}</td>
                <td style={{ color: 'var(--color-neutral-300)', maxWidth: 360, textWrap: 'pretty' }}>
                  {r.text}
                  {r.control && <div style={{ ...muted, marginTop: 2 }}>{r.control}</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.dueOn ? fmtDate(r.dueOn) : '—'}</td>
                <td><ToneTag tone={r.state.tone} style={{ whiteSpace: 'nowrap' }}>{r.state.label}</ToneTag></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={!!sel} onClose={close} width={640} kicker={sel ? `Registre de sécurité · ${sel.siteLabel}` : undefined}
        title={sel ? `${sel.kindLabel} · ${sel.authority}` : ''}>
        {sel && <NoticeDetail key={sel.id} n={sel} canManage={canManage} canApprove={canApprove} options={options} today={today} onClose={close} />}
      </Dialog>
    </div>
  );
}

/** Bouton « Inscrire une observation ». */
export function AddSafetyNoticeButton({ options, defaultSite, today }: { options: Opts; defaultSite: string; today: string }) {
  return (
    <DialogButton label="Inscrire une observation" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Observation ou mise en demeure" kicker="Registre de sécurité" width={640}>
      {(close) => <NoticeForm options={options} defaultSite={defaultSite} today={today} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

function NoticeDetail({ n, canManage, canApprove, options, today, onClose }: {
  n: SafetyNoticeView; canManage: boolean; canApprove: boolean; options: Opts; today: string; onClose: () => void;
}) {
  const editable = canManage && !n.cancelled;
  const [view, setView] = useState<'fiche' | 'reponse' | 'modifier'>('fiche');
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <Facts items={[
        ['Nature', <ToneTag key="k" tone={n.cancelled ? 'neutral' : n.tone}>{n.kindLabel}</ToneTag>],
        ['Reçue le', fmtDate(n.receivedOn)],
        ['Émetteur', n.authority],
        !!n.reference && ['Référence', n.reference],
        ['Délai de réponse', n.dueOn ? fmtDate(n.dueOn) : 'Non fixé'],
        ['État', <ToneTag key="s" tone={n.state.tone}>{n.state.label}</ToneTag>],
        !!n.control && ['Équipement', n.controlId ? <Link key="c" href={`/veille?onglet=controles&controle=${n.controlId}`} className="vg-link" style={{ fontSize: 12.5 }}>{n.control}</Link> : n.control],
      ]} />
      {n.cancelled && (
        <Notice>Annulée le {n.cancelled.on}{n.cancelled.by && ` par ${n.cancelled.by}`} — motif : {n.cancelled.reason}</Notice>
      )}
      {notice && <Notice>{notice}</Notice>}
      <div>
        <div className="vg-eyebrow" style={{ marginBottom: 4 }}>Observations ou prescriptions</div>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{n.text}</p>
      </div>
      {n.answeredOn && (
        <div>
          <div className="vg-eyebrow" style={{ marginBottom: 4 }}>Réponse du {fmtDate(n.answeredOn)}{n.answeredBy && ` · ${n.answeredBy}`}</div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{n.answer}</p>
        </div>
      )}
      {editable && view === 'fiche' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary vg-btn-sm" onClick={() => setView('reponse')}>
            <i className="ph ph-envelope-simple" aria-hidden />{n.answeredOn ? 'Corriger la réponse' : 'Enregistrer la réponse'}
          </button>
          <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setView('modifier')}><i className="ph ph-pencil-simple" aria-hidden />Modifier</button>
          {canApprove && (
            <ReasonButton label="Annuler la saisie" icon="ph-prohibit" title="Annuler l'observation" kicker={`${n.kindLabel} · ${n.authority}`}
              action={cancelSafetyNotice} hidden={{ id: n.id }} submitLabel="Annuler l'observation" submitIcon="ph-prohibit"
              message="Saisie erronée : l'observation n'est jamais supprimée ; elle reste au registre, barrée, avec son motif, et sort des échéances."
              placeholder="Ex. doublon, saisie sur le mauvais site" onDone={() => setNotice('Observation annulée.')} />
          )}
        </div>
      )}
      {editable && view === 'reponse' && (
        <ActionForm action={answerSafetyNotice} hidden={{ id: n.id }} onDone={() => { setView('fiche'); setNotice('Réponse enregistrée.'); }} onCancel={() => setView('fiche')}
          submitLabel="Enregistrer la réponse" submitIcon="ph-envelope-simple">
          <Field name="answeredOn" label="Réponse apportée le">
            <Input name="answeredOn" type="date" defaultValue={n.answeredOn ?? today} min={n.receivedOn} max={today} />
          </Field>
          <Field name="answer" label="Réponse" hint="Mise en conformité réalisée, courrier de réponse, référence du justificatif.">
            <TextArea name="answer" rows={3} maxLength={2000} defaultValue={n.answer ?? ''} />
          </Field>
        </ActionForm>
      )}
      {editable && view === 'modifier' && (
        <NoticeForm n={n} options={options} defaultSite={n.siteId} today={today} onDone={onClose} onCancel={() => setView('fiche')} />
      )}
      <LazyChangeLog entity="safety_notice" id={n.id} title="Journal des modifications" />
    </>
  );
}

function NoticeForm({ n, options, defaultSite, today, onDone, onCancel }: {
  n?: SafetyNoticeView; options: Opts; defaultSite: string; today: string; onDone: () => void; onCancel: () => void;
}) {
  const [siteId, setSiteId] = useState(n?.siteId ?? defaultSite);
  // Site archivé encore porté par l'observation : conservé comme choix.
  const sites = n && !options.sites.some(([v]) => v === n.siteId) ? [...options.sites, [n.siteId, n.siteLabel] as const] : options.sites;
  const controls = options.controls.filter(([, , s]) => !s || s === siteId).map(([v, l]) => [v, l] as const);
  return (
    <ActionForm action={saveSafetyNotice} hidden={{ id: n?.id }} onDone={onDone} onCancel={onCancel} submitLabel={n ? 'Enregistrer' : "Inscrire au registre"}>
      <FormRow>
        <Field name="kind" label="Nature">
          <Select name="kind" options={KIND_OPTIONS} defaultValue={n?.kind ?? 'observation'} />
        </Field>
        <Field name="siteId" label="Site">
          <Select name="siteId" options={sites} value={siteId} onChange={(e) => setSiteId(e.target.value)} placeholder="Choisir…" />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="authority" label="Émetteur" hint="Inspection du travail, CARSAT, organisme agréé…">
          <Input name="authority" defaultValue={n?.authority ?? ''} maxLength={120} placeholder="Ex. Inspection du travail" autoFocus={!n} />
        </Field>
        <Field name="reference" label="Référence" hint="Courrier, rapport (facultatif).">
          <Input name="reference" defaultValue={n?.reference ?? ''} maxLength={60} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="receivedOn" label="Reçue le">
          <Input name="receivedOn" type="date" defaultValue={n?.receivedOn ?? today} max={today} />
        </Field>
        <Field name="dueOn" label="Délai de réponse" hint="Mise en conformité ou réponse attendue (facultatif).">
          <Input name="dueOn" type="date" defaultValue={n?.dueOn ?? ''} />
        </Field>
      </FormRow>
      <Field name="text" label="Observations ou prescriptions">
        <TextArea name="text" rows={3} maxLength={2000} defaultValue={n?.text ?? ''} />
      </Field>
      <Field name="controlId" label="Équipement concerné" hint="Contrôle périodique du site (facultatif).">
        <Select name="controlId" options={controls} defaultValue={n?.controlId != null ? String(n.controlId) : ''} placeholder="Aucun" />
      </Field>
    </ActionForm>
  );
}
