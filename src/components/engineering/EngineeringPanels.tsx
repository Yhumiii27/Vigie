'use client';

import Link from 'next/link';
import { useState } from 'react';
import { NewActionButton } from '@/components/ActionFormDialog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { ReasonButton } from '@/components/ReasonDialog';
import { ToneTag } from '@/components/ui';
import { Facts, Notice, muted } from '@/components/watch/parts';
import { actionHref } from '@/lib/action-rules';
import type { ActionFormOptions } from '@/lib/action-view';
import { fmtDate } from '@/lib/dates';
import type { EcoView, EcrView, TargetView } from '@/lib/data/engineering';
import { withCurrent, type Option } from '@/lib/form-options';
import {
  ECO_APPROVAL_KEYS, ECO_APPROVAL_KEY_LIST, ECO_NEXT_STEP, ECO_STATUSES, ECO_TITLE_MAX, ECO_TYPE_KEYS, ECO_TYPES, ECR_KINDS, ECR_KIND_KEYS, ECR_SUBJECTS,
  ECR_SUBJECT_KEYS, ECR_TEXT_MAX, EFFECTIVITY_DISPOSITIONS, EFFECTIVITY_DISPOSITION_KEYS, INTERCHANGEABILITY, REVISION_MAX, documentLinesText,
  ecoEditable, ecoOpen, engineeringHref, type EcoApprovalKey, type EcrSubject,
} from '@/lib/rules/engineering';
import {
  advanceEco, cancelEco, cancelEcr, decideEcoApproval, decideEcr, implementEcr, proposeEcoEffectivity, saveEco, saveEcr, saveEffectivityTarget,
} from '@/server/engineering';

// Fiches et formulaires des modifications techniques (D12, lot 5 de M-02) : ordre (ECO) avec approbations, effectivité,
// demandes et actions liées ; demande (ECR) avec décision. Saisie : service QHSE ; décision d'une clé : QHSE ou approbateur
// désigné (canDecide, calculé par le chargement). Historique chargé à l'ouverture (LazyChangeLog).

/** Listes des formulaires (QHSE) : personnes présentes, sites autorisés, projets de Keystone, ordres ouverts, documents de Codex. */
export type EngineeringOptions = {
  people: readonly Option[]; sites: readonly Option[]; allSites: boolean; projects: readonly Option[]; projectsMessage: string | null;
  ecos: readonly Option[]; documents: readonly Option[]; documentsMessage: string | null;
};

const ALL = 'all';
const siteOptions = (o: EngineeringOptions, current?: { id: string | null; label: string }) => {
  const base: Option[] = [...(o.allSites ? [[ALL, 'Tous les sites'] as Option] : []), ...o.sites];
  return current ? withCurrent(base, current.id ?? ALL, current.label) : base;
};
const block = { margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' } as const;

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div className="vg-eyebrow">{title}</div>
        {aside && <span style={{ marginLeft: 'auto' }}>{aside}</span>}
      </div>
      {children}
    </div>
  );
}

// ─── Ordre de modification ───────────────────────────────────────────────────

export function EcoDetail({ e, qhse, options, actionOptions, today, version, onClose }: {
  e: EcoView; qhse: boolean; options: EngineeringOptions | null; actionOptions: ActionFormOptions; today: string; version?: string; onClose: () => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Fenêtre de décision tenue ici (et non dans la ligne de la clé) : la ligne perd son bouton dès la décision enregistrée.
  const [deciding, setDeciding] = useState<EcoApprovalKey | null>(null);
  const manage = qhse && !e.cancelled;
  const next = ECO_NEXT_STEP[e.status];
  if (editing && options) {
    return <EcoForm e={e} options={options} defaultSite={e.siteId ?? ''} version={version} onDone={() => { setEditing(false); setNotice('Ordre enregistré.'); }} onCancel={() => setEditing(false)} />;
  }
  return (
    <>
      <Facts items={[
        ['Étape', <ToneTag key="s" tone={e.tone}>{e.statusLabel}</ToneTag>],
        ['Type', e.typeLabel],
        ['Indices', `${e.fromRevision || '—'} → ${e.toRevision || '—'}`],
        ['Interchangeabilité', e.interchangeabilityLabel],
        ['Coût', `${e.costEur.toLocaleString('fr-FR')} €`],
        ['Délai', `${e.scheduleDays} j`],
        ['Demandeur', `${e.requestedBy} · ${fmtDate(e.raisedOn)}`],
        ['Pilote', e.pilot ?? '—'],
        ['Site', e.siteLabel],
        ['Origine', e.sourceLabel],
        !!e.releasedOn && ['Libéré le', fmtDate(e.releasedOn)],
        !!e.rejectedOn && !e.cancelled && ['Rejeté le', fmtDate(e.rejectedOn)],
      ]} />
      {e.cancelled && <Notice tone="warn" icon="ph-prohibit">Annulé le {fmtDate(e.cancelled.on)}{e.cancelled.by && ` par ${e.cancelled.by}`} — motif : {e.cancelled.reason}</Notice>}
      {e.locked && <Notice tone="warn" icon="ph-lock">Approuvé : la libération attend {e.pendingDispositions ? `${e.pendingDispositions} disposition(s) d’effectivité` : 'l’évaluation de l’interchangeabilité'}.</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {e.description && <Section title="Description"><p style={block}>{e.description}</p></Section>}
      {e.stockImpact && <Section title="Impact sur le stock"><p style={block}>{e.stockImpact}</p></Section>}
      <Section title="Articles, projets et documents">
        <div style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
          <span><span style={muted}>Articles · </span>{e.parts.length ? e.parts.map((p) => p.label).join(' ; ') : '—'}</span>
          <span><span style={muted}>Projets · </span>{e.projects.length ? e.projects.map((p) => p.label).join(' ; ') : '—'}</span>
          <span>
            <span style={muted}>Documents · </span>
            {e.documents.length ? e.documents.map((d, i) => (
              <span key={i}>{i > 0 && ' ; '}{d.href ? <Link href={d.href} className="vg-link">{d.label}</Link> : d.label}{d.ecrId && <span style={muted}> (demande {d.ecrId})</span>}</span>
            )) : '—'}
          </span>
        </div>
      </Section>

      <Section title="Approbations">
        <div style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label={`Approbations de ${e.id}`}>
          <table className="table" style={{ fontSize: 12.5, minWidth: 560 }}>
            <thead><tr><th>Clé</th><th>Approbateur</th><th>Décision</th><th>Détail</th></tr></thead>
            <tbody>
              {e.approvals.map((a) => (
                <tr key={a.key}>
                  <td>{a.label}</td>
                  <td>{a.approver}</td>
                  <td><ToneTag tone={a.tone}>{a.decisionLabel}</ToneTag></td>
                  <td>
                    {a.decidedBy && <span style={muted}>{a.decidedBy}{a.decidedAt ? ` · ${fmtDate(a.decidedAt.slice(0, 10))}` : ''}{a.via === 'keystone' ? ' · depuis Keystone' : ''}</span>}
                    {a.comment && <div style={{ fontSize: 12, fontStyle: 'italic' }}>{a.comment}</div>}
                    {a.canDecide && (
                      <button type="button" className="vg-text-btn" onClick={() => setDeciding(a.key)}>
                        <i className="ph ph-seal-check" style={{ fontSize: 13 }} aria-hidden />Décider
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Effectivité" aside={manage && ecoOpen(e.status) && (
        <ActionForm action={proposeEcoEffectivity} hidden={{ id: e.id, version }} submitLabel="Proposer d’après Keystone" submitIcon="ph-magic-wand"
          onDone={() => setNotice('Effectivité proposée d’après Keystone (cibles absentes ajoutées).')}>{null}</ActionForm>
      )}>
        {e.targets.length === 0 && <span style={{ fontSize: 12, color: 'var(--vg-text-muted)' }}>Aucune cible : « Proposer d’après Keystone » reprend les projets et machines qui emploient les articles de l’ordre.</span>}
        {e.targets.length > 0 && (
          <div style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label={`Effectivité de ${e.id}`}>
            <table className="table" style={{ fontSize: 12.5, minWidth: 620 }}>
              <thead><tr><th>Cible</th><th>Disposition</th><th>Révision montée</th><th>Échéance</th><th>Réalisée</th><th><span className="vg-sr-only">Modifier</span></th></tr></thead>
              <tbody>
                {e.targets.map((g) => (
                  <tr key={`${g.targetType}|${g.targetRef}`}>
                    <td>{g.typeLabel} {g.label}{g.isAutomatic && <div style={muted}>Proposée d’après Keystone</div>}{g.note && <div style={{ fontSize: 12, fontStyle: 'italic' }}>{g.note}</div>}</td>
                    <td><ToneTag tone={g.disposition ? 'neutral' : 'warn'}>{g.dispositionLabel}</ToneTag></td>
                    <td>{g.fittedPartRef ? `${g.fittedPartRef} ${g.fittedRevision ?? ''}` : '—'}</td>
                    <td style={{ whiteSpace: 'nowrap', color: g.late ? 'var(--tone-danger-fg)' : undefined }}>{g.dueOn ? fmtDate(g.dueOn) : '—'}{g.late && ' · en retard'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{g.doneOn ? fmtDate(g.doneOn) : '—'}</td>
                    <td>{manage && e.status !== 'rejected' && <TargetButton e={e} g={g} version={version} today={today} onDone={setNotice} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Demandes de modification">
        {e.ecrs.length === 0 ? <span style={{ fontSize: 12, color: 'var(--vg-text-muted)' }}>Aucune demande rattachée.</span> : (
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5 }}>
            {e.ecrs.map((r) => <li key={r.id}><Link href={engineeringHref(r.id)} className="vg-link">{r.id}</Link> · {r.title} <ToneTag tone={r.tone} style={{ fontSize: 11 }}>{r.statusLabel}</ToneTag></li>)}
          </ul>
        )}
      </Section>

      <Section title="Actions du plan" aside={manage && e.status !== 'rejected' && actionOptions.people.length > 0 && (
        <NewActionButton options={actionOptions} label="Nouvelle action" className="btn btn-secondary vg-btn-sm"
          defaults={{ link: `eco:${e.id}`, linkLabel: `${e.id} · ${e.title}`, source: 'modification_technique', lockSource: true, siteId: e.siteId, domain: 'qualite' }} />
      )}>
        {e.actions.length === 0 ? <span style={{ fontSize: 12, color: 'var(--vg-text-muted)' }}>Aucune action liée.</span> : (
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5 }}>
            {e.actions.map((a) => (
              <li key={a.id}>
                {a.readable ? <Link href={actionHref(a.id)} className="vg-link">{a.id}</Link> : a.id}
                {a.readable && <> · {a.label} · {fmtDate(a.dueOn)} <ToneTag tone={a.tone} style={{ fontSize: 11 }}>{a.statusLabel}</ToneTag></>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {manage && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {next && (
            <ActionForm action={advanceEco} hidden={{ id: e.id, to: next, version }} submitLabel={`Passer à « ${ECO_STATUSES[next].label} »`} submitIcon="ph-arrow-right"
              onDone={() => setNotice(`Ordre passé à l’étape « ${ECO_STATUSES[next].label} ».`)}>{null}</ActionForm>
          )}
          {ecoEditable(e.status) && options && (
            <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setEditing(true)}><i className="ph ph-pencil-simple" aria-hidden />Modifier</button>
          )}
          {ecoOpen(e.status) && (
            <ReasonButton label="Annuler l’ordre" icon="ph-prohibit" title="Annuler l’ordre de modification" kicker={e.id} action={cancelEco} hidden={{ id: e.id }}
              submitLabel="Annuler l’ordre" message="L’ordre reste consultable avec son historique ; il est publié « rejeté ». Ses demandes acceptées passent refusées (Codex en est prévenu)."
              placeholder="Ex. modification abandonnée, saisie en double" onDone={onClose} />
          )}
        </div>
      )}
      <Dialog open={!!deciding} onClose={() => setDeciding(null)} width={520} kicker="Approbation d’un ordre" title={deciding ? `${ECO_APPROVAL_KEYS[deciding].label} · ${e.id}` : ''}>
        {deciding && (
          <ActionForm action={decideEcoApproval} hidden={{ id: e.id, key: deciding, version }} submitLabel="Enregistrer la décision"
            onDone={() => { setNotice(`Décision « ${ECO_APPROVAL_KEYS[deciding].label} » enregistrée.`); setDeciding(null); }} onCancel={() => setDeciding(null)}>
            <Field name="decision" label="Décision">
              <Select name="decision" options={[['ok', 'Approuvé'], ['rejected', 'Refusé (l’ordre est rejeté)']]} defaultValue="ok" />
            </Field>
            <Field name="comment" label="Commentaire" hint="Obligatoire pour un refus.">
              <TextArea name="comment" rows={3} maxLength={ECR_TEXT_MAX} />
            </Field>
          </ActionForm>
        )}
      </Dialog>
      <LazyChangeLog entity="eco" id={e.id} title="Journal des modifications" />
    </>
  );
}

/** Disposition, note, échéance et réalisation d'une cible (QHSE). */
function TargetButton({ e, g, version, today, onDone }: { e: EcoView; g: TargetView; version?: string; today: string; onDone: (m: string) => void }) {
  const released = e.status === 'released';
  const choices = EFFECTIVITY_DISPOSITION_KEYS.filter((k) => !EFFECTIVITY_DISPOSITIONS[k].machineOnly || g.targetType === 'machine').map((k) => [k, EFFECTIVITY_DISPOSITIONS[k].label] as const);
  return (
    <DialogButton label="" ariaLabel={`Modifier la cible ${g.label}`} tooltip="Modifier la cible" icon="ph-pencil-simple" className="vg-text-btn" title={`${g.typeLabel} ${g.label}`} kicker={`Effectivité · ${e.id}`} width={560}>
      {(done) => (
        <ActionForm action={saveEffectivityTarget} hidden={{ id: e.id, targetType: g.targetType, targetRef: g.targetRef, version, ...(released ? { disposition: g.disposition ?? '' } : {}) }}
          submitLabel="Enregistrer" onDone={() => { done(); onDone(`Cible ${g.label} enregistrée.`); }} onCancel={done}>
          {!released && (
            <Field name="disposition" label="Disposition">
              <Select name="disposition" options={choices} defaultValue={g.disposition ?? ''} placeholder="À décider" />
            </Field>
          )}
          <Field name="note" label="Note">
            <TextArea name="note" rows={2} maxLength={ECR_TEXT_MAX} defaultValue={g.note ?? ''} />
          </Field>
          <FormRow>
            <Field name="dueOn" label="Échéance" hint="Mise à jour ou rétrofit.">
              <Input name="dueOn" type="date" defaultValue={g.dueOn ?? ''} />
            </Field>
            {released && (
              <Field name="doneOn" label="Réalisée le">
                <Input name="doneOn" type="date" defaultValue={g.doneOn ?? ''} max={today} />
              </Field>
            )}
          </FormRow>
        </ActionForm>
      )}
    </DialogButton>
  );
}

const TYPE_OPTIONS = ECO_TYPE_KEYS.map((k) => [k, ECO_TYPES[k]] as const);
const INTERCHANGE_OPTIONS = (Object.keys(INTERCHANGEABILITY) as ('yes' | 'no')[]).map((k) => [k, INTERCHANGEABILITY[k]] as const);

export function EcoForm({ e, options, defaultSite, prefill, version, onDone, onCancel }: {
  e?: EcoView; options: EngineeringOptions; defaultSite: string; prefill?: { part: string; project: string; title: string; source: 'vigie' | 'keystone' };
  version?: string; onDone: () => void; onCancel: () => void;
}) {
  const sites = siteOptions(options, e ? { id: e.siteId, label: e.siteLabel } : undefined);
  const people = e?.pilotId ? withCurrent(options.people, e.pilotId, `${e.pilot ?? e.pilotId} — sorti de l'effectif`) : options.people;
  const site = e ? e.siteId ?? ALL : sites.some(([v]) => v === defaultSite) ? defaultSite : sites[0]?.[0] ?? '';
  return (
    <ActionForm action={saveEco} hidden={{ id: e?.id, version: e ? version : undefined, source: prefill?.source ?? undefined }}
      onDone={onDone} onCancel={onCancel} submitLabel={e ? 'Enregistrer' : 'Créer l’ordre'}>
      <Field name="title" label="Intitulé">
        <Input name="title" defaultValue={e?.title ?? prefill?.title ?? ''} maxLength={ECO_TITLE_MAX} autoFocus={!e} />
      </Field>
      <FormRow cols={3}>
        <Field name="ecoType" label="Type">
          <Select name="ecoType" options={TYPE_OPTIONS} defaultValue={e?.type ?? 'rev'} />
        </Field>
        <Field name="fromRevision" label="Indice de départ">
          <Input name="fromRevision" defaultValue={e?.fromRevision ?? ''} maxLength={REVISION_MAX} />
        </Field>
        <Field name="toRevision" label="Nouvel indice">
          <Input name="toRevision" defaultValue={e?.toRevision ?? ''} maxLength={REVISION_MAX} />
        </Field>
      </FormRow>
      <FormRow cols={3}>
        <Field name="interchangeability" label="Interchangeabilité" hint="À évaluer avant l’approbation.">
          <Select name="interchangeability" options={INTERCHANGE_OPTIONS} defaultValue={e?.interchangeability ?? ''} placeholder="Non évaluée" />
        </Field>
        <Field name="costEur" label="Coût (€)">
          <Input name="costEur" inputMode="decimal" defaultValue={e ? String(e.costEur) : '0'} />
        </Field>
        <Field name="scheduleDays" label="Délai (jours)">
          <Input name="scheduleDays" type="number" min={0} max={3650} defaultValue={e ? e.scheduleDays : 0} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="pilotId" label="Pilote">
          <Select name="pilotId" options={people} defaultValue={e?.pilotId ?? ''} placeholder="Non désigné" />
        </Field>
        <Field name="siteId" label="Site">
          <Select name="siteId" options={sites} defaultValue={site} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="parts" label="Articles (Keystone)" hint="Une référence par ligne ou séparées par des virgules.">
          <TextArea name="parts" rows={2} defaultValue={e ? e.parts.map((p) => p.ref).join('\n') : prefill?.part ?? ''} />
        </Field>
        <Field name="projects" label="Projets (Keystone)" hint={options.projectsMessage ?? 'Codes projet, un par ligne.'}>
          <TextArea name="projects" rows={2} defaultValue={e ? e.projects.map((p) => p.code).join('\n') : prefill?.project ?? ''} />
        </Field>
      </FormRow>
      <Field name="documents" label="Documents cités" hint="Une ligne par document : « libellé » ou « libellé | identifiant Codex » (ex. PRO-QUA-0006).">
        <TextArea name="documents" rows={2} defaultValue={e ? documentLinesText(e.documents) : ''} />
      </Field>
      <Field name="stockImpact" label="Impact sur le stock">
        <TextArea name="stockImpact" rows={2} maxLength={ECR_TEXT_MAX} defaultValue={e?.stockImpact ?? ''} />
      </Field>
      <Field name="description" label="Description">
        <TextArea name="description" rows={3} maxLength={ECR_TEXT_MAX * 2} defaultValue={e?.description ?? ''} />
      </Field>
      {ECO_APPROVAL_KEY_LIST.map((k) => {
        const a = e?.approvals.find((x) => x.key === k);
        return (
          <FormRow key={k}>
            <Field name={`approver_${k}`} label={`Approbateur · ${ECO_APPROVAL_KEYS[k].short}`} hint={k === 'pm' ? 'Chefs des projets visés (texte affiché, publié à Keystone).' : undefined}>
              <Input name={`approver_${k}`} defaultValue={a?.approver ?? ECO_APPROVAL_KEYS[k].fallback} maxLength={200} disabled={a?.decision !== undefined && a.decision !== 'pending'} />
            </Field>
            <Field name={`approverId_${k}`} label="Personne désignée dans Vigie" hint="Elle décide sa clé dans Vigie.">
              <Select name={`approverId_${k}`} options={a?.approverId ? withCurrent(options.people, a.approverId, a.approver) : options.people} defaultValue={a?.approverId ?? ''} placeholder="Aucune" />
            </Field>
          </FormRow>
        );
      })}
    </ActionForm>
  );
}

// ─── Demande de modification ─────────────────────────────────────────────────

export function EcrDetail({ r, qhse, options, version, onOpen, onClose }: {
  r: EcrView; qhse: boolean; options: EngineeringOptions | null; version?: string; onOpen: (id: string) => void; onClose: () => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Fenêtres tenues ici : le bouton qui les ouvre disparaît dès la décision ou la mise en œuvre enregistrée.
  const [panel, setPanel] = useState<'decide' | 'implement' | null>(null);
  const manage = qhse && !r.cancelled && !!options;
  if (editing && options) {
    return <EcrForm r={r} options={options} defaultSite={r.siteId ?? ''} version={version} onDone={() => { setEditing(false); setNotice('Demande enregistrée.'); }} onCancel={() => setEditing(false)} />;
  }
  const ecoOptions: Option[] = [['new', 'Créer un nouvel ordre d’après la demande'], ...(options?.ecos ?? [])];
  return (
    <>
      <Facts items={[
        ['État', <ToneTag key="s" tone={r.tone}>{r.statusLabel}</ToneTag>],
        ['Nature', r.kindLabel],
        ['Objet', r.subjectLabel],
        ['Élément', r.refHref ? <Link key="h" href={r.refHref} className="vg-link">{r.refLabel}</Link> : r.refLabel],
        ['Demandeur', `${r.requester}${r.requesterRef ? ` (${r.requesterRef})` : ''} · ${fmtDate(r.createdOn)}`],
        ['Origine', r.sourceLabel],
        ['Site', r.siteLabel],
        !!r.ecoId && ['Ordre', <button key="o" type="button" className="vg-text-btn" onClick={() => onOpen(r.ecoId!)}>{r.ecoId}</button>],
        !!r.decidedOn && ['Décidée le', `${fmtDate(r.decidedOn)}${r.decidedBy ? ` · ${r.decidedBy}` : ''}`],
        !!r.implementedOn && ['Mise en œuvre le', `${fmtDate(r.implementedOn)}${r.codexRevision ? ` · révision ${r.codexRevision} (Codex)` : ''}`],
        !!r.notify && ['Envoi à Codex', <ToneTag key="n" tone={r.notify.tone}>{r.notify.label}{r.notify.error ? ` · ${r.notify.error}` : ''}</ToneTag>],
      ]} />
      {r.cancelled && <Notice tone="warn" icon="ph-prohibit">Annulée le {fmtDate(r.cancelled.on)}{r.cancelled.by && ` par ${r.cancelled.by}`} — motif : {r.cancelled.reason}</Notice>}
      {r.overdue && <Notice tone="warn" icon="ph-clock">Décision attendue depuis le {fmtDate(r.dueOn)}.</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <Section title="Motif"><p style={block}>{r.reason}</p></Section>
      {r.description && <Section title="Description"><p style={block}>{r.description}</p></Section>}
      {r.decisionNote && <Section title="Décision"><p style={block}>{r.decisionNote}</p></Section>}
      {manage && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {r.status === 'submitted' && (
            <button type="button" className="btn btn-primary vg-btn-sm" onClick={() => setPanel('decide')}><i className="ph ph-gavel" aria-hidden />Décider</button>
          )}
          {r.status === 'submitted' && r.source === 'vigie' && (
            <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setEditing(true)}><i className="ph ph-pencil-simple" aria-hidden />Modifier</button>
          )}
          {r.status === 'accepted' && !(r.source === 'codex' && r.subject === 'document') && (
            <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setPanel('implement')}><i className="ph ph-check" aria-hidden />Constater la mise en œuvre</button>
          )}
          {r.status === 'submitted' && r.source === 'vigie' && (
            <ReasonButton label="Annuler la demande" icon="ph-prohibit" title="Annuler la demande" kicker={r.id} action={cancelEcr} hidden={{ id: r.id }}
              submitLabel="Annuler la demande" message="La demande reste consultable avec son historique ; elle est publiée « refusée »."
              placeholder="Ex. saisie en double" onDone={onClose} />
          )}
        </div>
      )}
      <Dialog open={panel === 'decide'} onClose={() => setPanel(null)} width={600} kicker="Demande de modification" title={`Décision sur ${r.id}`}>
        {panel === 'decide' && (
          <ActionForm action={decideEcr} hidden={{ id: r.id, version }} submitLabel="Enregistrer la décision" onDone={() => { setNotice('Décision enregistrée.'); setPanel(null); }} onCancel={() => setPanel(null)}>
            <Field name="decision" label="Décision">
              <Select name="decision" options={[['accepted', 'Acceptée'], ['rejected', 'Refusée']]} defaultValue="accepted" />
            </Field>
            <Field name="ecoId" label="Ordre de modification" hint="Acceptée : sans ordre, la décision est transmise aussitôt ; avec un ordre, à sa libération.">
              <Select name="ecoId" options={ecoOptions} defaultValue="" placeholder="Sans ordre" />
            </Field>
            {r.subject === 'document' && r.source === 'codex' && (
              <Field name="modifierRef" label="Rédacteur désigné dans Codex" hint="Identifiant Codex (ex. jwagner) ; vide : le demandeur ou le propriétaire.">
                <Input name="modifierRef" maxLength={64} defaultValue={r.requesterRef ?? ''} />
              </Field>
            )}
            <Field name="note" label="Note de décision" hint="Obligatoire pour un refus ; transmise à Codex pour une demande de Codex.">
              <TextArea name="note" rows={3} maxLength={ECR_TEXT_MAX} />
            </Field>
          </ActionForm>
        )}
      </Dialog>
      <Dialog open={panel === 'implement'} onClose={() => setPanel(null)} width={520} kicker="Demande de modification" title={`Mise en œuvre de ${r.id}`}>
        {panel === 'implement' && (
          <ActionForm action={implementEcr} hidden={{ id: r.id }} submitLabel="Constater" onDone={() => { setNotice('Mise en œuvre constatée.'); setPanel(null); }} onCancel={() => setPanel(null)}>
            <Field name="note" label="Constat"><TextArea name="note" rows={3} maxLength={ECR_TEXT_MAX} /></Field>
          </ActionForm>
        )}
      </Dialog>
      <LazyChangeLog entity="ecr" id={r.id} title="Journal des modifications" />
    </>
  );
}

const KIND_OPTIONS = ECR_KIND_KEYS.map((k) => [k, ECR_KINDS[k]] as const);
const SUBJECT_OPTIONS = ECR_SUBJECT_KEYS.map((k) => [k, ECR_SUBJECTS[k]] as const);

export function EcrForm({ r, options, defaultSite, version, onDone, onCancel }: {
  r?: EcrView; options: EngineeringOptions; defaultSite: string; version?: string; onDone: () => void; onCancel: () => void;
}) {
  const [subject, setSubject] = useState<EcrSubject>(r?.subject ?? 'part');
  const sites = siteOptions(options, r ? { id: r.siteId, label: r.siteLabel } : undefined);
  const site = r ? r.siteId ?? ALL : sites.some(([v]) => v === defaultSite) ? defaultSite : sites[0]?.[0] ?? '';
  return (
    <ActionForm action={saveEcr} hidden={{ id: r?.id, version: r ? version : undefined }} onDone={onDone} onCancel={onCancel} submitLabel={r ? 'Enregistrer' : 'Créer la demande'}>
      <FormRow>
        <Field name="kind" label="Nature">
          <Select name="kind" options={KIND_OPTIONS} defaultValue={r?.kind ?? 'modification'} />
        </Field>
        <Field name="subject" label="Objet">
          <Select name="subject" options={SUBJECT_OPTIONS} value={subject} onChange={(ev) => setSubject(ev.target.value as EcrSubject)} />
        </Field>
      </FormRow>
      {subject === 'document' && (
        <Field name="codexDocId" label="Document (Codex)" hint={options.documentsMessage ?? undefined}>
          <Select name="codexDocId" options={r?.codexDocId ? withCurrent(options.documents, r.codexDocId, r.refLabel, 'start') : options.documents} defaultValue={r?.codexDocId ?? ''} placeholder="Choisir…" />
        </Field>
      )}
      {subject === 'part' && (
        <Field name="partRef" label="Article (Keystone)" hint="Référence du catalogue de Keystone (ex. ARB-MAL-045).">
          <Input name="partRef" defaultValue={r?.partRef ?? ''} maxLength={64} />
        </Field>
      )}
      {subject === 'project' && (
        <Field name="keystoneProjectCode" label="Projet (Keystone)" hint={options.projectsMessage ?? undefined}>
          <Select name="keystoneProjectCode" options={withCurrent(options.projects, r?.projectCode, r?.projectCode, 'start')} defaultValue={r?.projectCode ?? ''} placeholder="Choisir…" />
        </Field>
      )}
      {subject === 'event' && (
        <Field name="eventId" label="Événement (Vigie)" hint="Référence EV-… d’une NC ou d’une réclamation du site.">
          <Input name="eventId" defaultValue={r?.eventId ?? ''} maxLength={40} />
        </Field>
      )}
      <Field name="title" label="Intitulé">
        <Input name="title" defaultValue={r?.title ?? ''} maxLength={ECO_TITLE_MAX} />
      </Field>
      <Field name="ecrReason" label="Motif de la demande">
        <TextArea name="ecrReason" rows={3} maxLength={ECR_TEXT_MAX} defaultValue={r?.reason ?? ''} />
      </Field>
      <Field name="description" label="Description">
        <TextArea name="description" rows={3} maxLength={ECR_TEXT_MAX * 2} defaultValue={r?.description ?? ''} />
      </Field>
      <Field name="siteId" label="Site">
        <Select name="siteId" options={sites} defaultValue={site} />
      </Field>
    </ActionForm>
  );
}
