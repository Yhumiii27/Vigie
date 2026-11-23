'use client';

import { useState } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { ReasonButton } from '@/components/ReasonDialog';
import { ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import type { DgiNoticeView } from '@/lib/data/dgi';
import { cancelDgiNotice, closeDgiNotice, recordDgiNotice, saveDgiMeasures, signDgiNotice } from '@/server/dgi';

// Registre des dangers graves et imminents (CNF-01) : avis du site, du plus récent au plus ancien ; consignation et
// signature par les membres du CSE, mesures de l'employeur, clôture et annulation motivée par l'animateur QHSE.

type Rights = { record: boolean; sign: boolean; handle: boolean };

/** « AAAA-MM-JJTHH:mm » → « 07/09/2026 à 11:05 ». */
const fmtLocal = (local: string) => `${fmtDate(local.slice(0, 10))} à ${local.slice(11, 16)}`;
const muted = { fontSize: 11.5, color: 'var(--vg-text-muted)' } as const;

export function DgiNoticeList({ notices, rights, openId }: { notices: DgiNoticeView[]; rights: Rights; openId?: number }) {
  if (!notices.length) return <p style={{ margin: 0, fontSize: 12.5 }} className="vg-muted">Aucun avis consigné au registre de ce site.</p>;
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
      {[...notices].reverse().map((n) => <DgiNoticeCard key={n.id} n={n} rights={rights} open={n.id === openId} />)}
    </ol>
  );
}

function DgiNoticeCard({ n, rights, open }: { n: DgiNoticeView; rights: Rights; open: boolean }) {
  const [measuring, setMeasuring] = useState(false);
  const live = !n.cancelled && !n.closed;
  return (
    <li id={`avis-${n.id}`} className="card" style={{ gap: 8, padding: '12px 14px', outline: open ? '2px solid var(--color-accent)' : undefined }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline', textDecoration: n.cancelled ? 'line-through' : undefined }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>Avis n° {n.number}</h3>
        <span>{fmtLocal(n.reportedAt)}</span>
        <ToneTag tone={n.stateTone}>{n.stateLabel}</ToneTag>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 190px) 1fr', gap: '4px 12px', margin: 0, fontSize: 12.5 }}>
        <dt style={muted}>Poste(s) de travail</dt><dd style={{ margin: 0, whiteSpace: 'pre-line' }}>{n.workstations}</dd>
        <dt style={muted}>Nature et cause du danger</dt><dd style={{ margin: 0, whiteSpace: 'pre-line' }}>{n.danger}</dd>
        <dt style={muted}>Travailleurs exposés</dt><dd style={{ margin: 0, whiteSpace: 'pre-line' }}>{n.exposedWorkers}</dd>
        <dt style={muted}>Représentant du CSE</dt><dd style={{ margin: 0 }}>{n.representativeName}</dd>
        <dt style={muted}>Signature</dt><dd style={{ margin: 0 }}>{n.signed ? `Signé le ${fmtLocal(n.signed.at)} par ${n.signed.by}` : 'À signer par un membre du CSE'}</dd>
        {n.eventId && <><dt style={muted}>Événement lié</dt><dd style={{ margin: 0 }}><a href={`/evenements?etat=tous&sel=${encodeURIComponent(n.eventId)}`} className="vg-link">{n.eventId}</a></dd></>}
        <dt style={muted}>Mesures de l&apos;employeur</dt>
        <dd style={{ margin: 0, whiteSpace: 'pre-line' }}>{n.measures ? <>{n.measures.text}<span style={{ ...muted, display: 'block' }}>Consignées le {fmtLocal(n.measures.at)} par {n.measures.by}</span></> : '—'}</dd>
        {n.closed && <><dt style={muted}>Clôture</dt><dd style={{ margin: 0 }}>Le {fmtLocal(n.closed.at)} par {n.closed.by}</dd></>}
      </dl>
      {n.cancelled && <span style={muted}>Annulé le {fmtDate(n.cancelled.on)} par {n.cancelled.by} — motif : {n.cancelled.reason}</span>}
      {live && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {rights.sign && !n.signed && (
            <ActionFormButton label="Signer l'avis" action={signDgiNotice} id={n.id} />
          )}
          {rights.handle && !measuring && (
            <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setMeasuring(true)}>
              <i className="ph ph-shield-check" aria-hidden />{n.measures ? 'Modifier les mesures' : 'Consigner les mesures prises'}
            </button>
          )}
          {rights.handle && n.measures && n.signed && <ActionFormButton label="Clore l'avis" action={closeDgiNotice} id={n.id} />}
          {rights.handle && (
            <ReasonButton label="Annuler la saisie" icon="ph-prohibit" title="Annuler l'avis" kicker={`Avis n° ${n.number}`}
              action={cancelDgiNotice} hidden={{ id: n.id }} submitLabel="Annuler l'avis" submitIcon="ph-prohibit"
              message="Saisie erronée : l'avis n'est jamais supprimé ; il reste au registre, barré, avec son motif, et son numéro n'est pas réattribué."
              placeholder="Ex. doublon de l'avis n° 3" />
          )}
        </div>
      )}
      {live && rights.handle && measuring && (
        <div className="vg-inset" style={{ padding: '10px 12px' }}>
          <ActionForm action={saveDgiMeasures} hidden={{ id: n.id }} onDone={() => setMeasuring(false)} onCancel={() => setMeasuring(false)} submitLabel="Consigner les mesures">
            <Field name="measures" label="Mesures prises par l'employeur" hint="Enquête, mesures conservatoires, arrêt de l'installation, suite donnée (L. 4132-2).">
              <TextArea name="measures" rows={4} maxLength={4000} defaultValue={n.measures?.text ?? ''} autoFocus />
            </Field>
          </ActionForm>
        </div>
      )}
    </li>
  );
}

/** Bouton d'une action sans saisie (signature, clôture) : formulaire réduit à la confirmation. */
function ActionFormButton({ label, action, id }: { label: string; action: typeof signDgiNotice; id: number }) {
  return (
    <DialogButton label={label} title={label} className="btn btn-primary vg-btn-sm" width={420}>
      {(close) => (
        <ActionForm action={action} hidden={{ id }} onDone={close} onCancel={close} submitLabel={label}>
          <p style={{ margin: 0, fontSize: 13 }}>Horodaté à votre nom ; inscrit au journal de l&apos;avis.</p>
        </ActionForm>
      )}
    </DialogButton>
  );
}

/** « Consigner un avis » : membre du CSE (signé d'emblée) ou animateur QHSE (avis recopié, à signer). */
export function RecordDgiButton({ sites, siteId, nowLocal, defaultName, signs }: {
  sites: readonly (readonly [string, string])[]; siteId: string; nowLocal: string; defaultName: string; signs: boolean;
}) {
  return (
    <DialogButton label="Consigner un avis" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Avis de danger grave et imminent" kicker="Registre des dangers graves et imminents" width={640}>
      {(close) => (
        <ActionForm action={recordDgiNotice} onDone={close} onCancel={close} submitLabel={signs ? 'Consigner et signer' : "Consigner l'avis"}>
          <p style={{ margin: 0, fontSize: 12.5 }} className="vg-muted">
            {signs ? "En tant que représentant du personnel au CSE, l'avis est daté et signé à votre nom (D. 4132-1)." : "Avis recopié : il restera à signer par un membre du CSE."}
          </p>
          <FormRow>
            <Field name="siteId" label="Site">
              <Select name="siteId" options={sites} defaultValue={siteId} />
            </Field>
            <Field name="reportedAt" label="Date et heure de l'alerte">
              <Input name="reportedAt" type="datetime-local" defaultValue={nowLocal} max={nowLocal} />
            </Field>
          </FormRow>
          <Field name="workstations" label="Poste(s) de travail concerné(s)">
            <Input name="workstations" maxLength={500} autoFocus />
          </Field>
          <Field name="danger" label="Nature et cause du danger">
            <TextArea name="danger" rows={3} maxLength={4000} />
          </Field>
          <Field name="exposedWorkers" label="Nom des travailleurs exposés">
            <TextArea name="exposedWorkers" rows={2} maxLength={2000} />
          </Field>
          <FormRow>
            <Field name="representativeName" label="Représentant du personnel au CSE">
              <Input name="representativeName" maxLength={120} defaultValue={defaultName} />
            </Field>
            <Field name="eventId" label="Événement lié" hint="Référence EV-… du même site (facultatif).">
              <Input name="eventId" maxLength={40} placeholder="EV-2026-…" />
            </Field>
          </FormRow>
        </ActionForm>
      )}
    </DialogButton>
  );
}
