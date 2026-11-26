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
import { fill, type T } from '@/i18n/translate';
import { useI18n } from '@/i18n/client';

// Fiches et formulaires des modifications techniques (D12, lot 5 de M-02) : ordre (ECO) avec approbations, effectivité,
// demandes et actions liées ; demande (ECR) avec décision. Saisie : service QHSE ; décision d'une clé : QHSE ou approbateur
// désigné (canDecide, calculé par le chargement). Historique chargé à l'ouverture (LazyChangeLog).

/** Listes des formulaires (QHSE) : personnes présentes, sites autorisés, projets de Keystone, ordres ouverts, documents de Codex. */
export type EngineeringOptions = {
  people: readonly Option[]; sites: readonly Option[]; allSites: boolean; projects: readonly Option[]; projectsMessage: string | null;
  ecos: readonly Option[]; documents: readonly Option[]; documentsMessage: string | null;
};

const ALL = 'all';
const siteOptions = (o: EngineeringOptions, t: T, current?: { id: string | null; label: string }) => {
  const base: Option[] = [...(o.allSites ? [[ALL, t('All sites')] as Option] : []), ...o.sites];
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
  const { t } = useI18n();
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Fenêtre de décision tenue ici (et non dans la ligne de la clé) : la ligne perd son bouton dès la décision enregistrée.
  const [deciding, setDeciding] = useState<EcoApprovalKey | null>(null);
  const manage = qhse && !e.cancelled;
  const next = ECO_NEXT_STEP[e.status];
  if (editing && options) {
    return <EcoForm e={e} options={options} defaultSite={e.siteId ?? ''} version={version} onDone={() => { setEditing(false); setNotice(t('Order saved.')); }} onCancel={() => setEditing(false)} />;
  }
  return (
    <>
      <Facts items={[
        [t('Stage'), <ToneTag key="s" tone={e.tone}>{e.statusLabel}</ToneTag>],
        [t('Type'), e.typeLabel],
        [t('Revisions#indices'), `${e.fromRevision || '—'} → ${e.toRevision || '—'}`],
        [t('Interchangeability'), e.interchangeabilityLabel],
        [t('Cost'), `${e.costEur.toLocaleString('fr-FR')} €`],
        [t('Lead time'), fill(t('{n} d'), { n: e.scheduleDays })],
        [t('Requester'), `${e.requestedBy} · ${fmtDate(e.raisedOn)}`],
        [t('Lead'), e.pilot ?? '—'],
        [t('Site'), e.siteLabel],
        [t('Origin'), e.sourceLabel],
        !!e.releasedOn && [t('Released on'), fmtDate(e.releasedOn)],
        !!e.rejectedOn && !e.cancelled && [t('Rejected on'), fmtDate(e.rejectedOn)],
      ]} />
      {e.cancelled && <Notice tone="warn" icon="ph-prohibit">{fill(t('Cancelled on {date}#m'), { date: fmtDate(e.cancelled.on) })}{e.cancelled.by && fill(t(' by {name}'), { name: e.cancelled.by })}{t(' — reason: ')}{e.cancelled.reason}</Notice>}
      {e.locked && <Notice tone="warn" icon="ph-lock">{fill(t('Approved: the release awaits {what}.'), { what: e.pendingDispositions ? fill(t('{n} effectivity disposition(s)'), { n: e.pendingDispositions }) : t('the assessment of the interchangeability') })}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {e.description && <Section title={t('Description')}><p style={block}>{e.description}</p></Section>}
      {e.stockImpact && <Section title={t('Impact on stock')}><p style={block}>{e.stockImpact}</p></Section>}
      <Section title={t('Parts, projects and documents')}>
        <div style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
          <span><span style={muted}>{t('Parts · ')}</span>{e.parts.length ? e.parts.map((p) => p.label).join(' ; ') : '—'}</span>
          <span><span style={muted}>{t('Projects · ')}</span>{e.projects.length ? e.projects.map((p) => p.label).join(' ; ') : '—'}</span>
          <span>
            <span style={muted}>{t('Documents · ')}</span>
            {e.documents.length ? e.documents.map((d, i) => (
              <span key={i}>{i > 0 && ' ; '}{d.href ? <Link href={d.href} className="vg-link">{d.label}</Link> : d.label}{d.ecrId && <span style={muted}>{fill(t(' (request {id})'), { id: d.ecrId })}</span>}</span>
            )) : '—'}
          </span>
        </div>
      </Section>

      <Section title={t('Approvals#eco')}>
        <div style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label={fill(t('Approvals of {id}'), { id: e.id })}>
          <table className="table" style={{ fontSize: 12.5, minWidth: 560 }}>
            <thead><tr><th>{t('Key#approval')}</th><th>{t('Approver')}</th><th>{t('Decision')}</th><th>{t('Detail#column')}</th></tr></thead>
            <tbody>
              {e.approvals.map((a) => (
                <tr key={a.key}>
                  <td>{a.label}</td>
                  <td>{a.approver}</td>
                  <td><ToneTag tone={a.tone}>{a.decisionLabel}</ToneTag></td>
                  <td>
                    {a.decidedBy && <span style={muted}>{a.decidedBy}{a.decidedAt ? ` · ${fmtDate(a.decidedAt.slice(0, 10))}` : ''}{a.via === 'keystone' ? t(' · from Keystone') : ''}</span>}
                    {a.comment && <div style={{ fontSize: 12, fontStyle: 'italic' }}>{a.comment}</div>}
                    {a.canDecide && (
                      <button type="button" className="vg-text-btn" onClick={() => setDeciding(a.key)}>
                        <i className="ph ph-seal-check" style={{ fontSize: 13 }} aria-hidden />{t('Decide')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={t('Effectivity')} aside={manage && ecoOpen(e.status) && (
        <ActionForm action={proposeEcoEffectivity} hidden={{ id: e.id, version }} submitLabel={t('Propose from Keystone')} submitIcon="ph-magic-wand"
          onDone={() => setNotice(t('Effectivity proposed from Keystone (missing targets added).'))}>{null}</ActionForm>
      )}>
        {e.targets.length === 0 && <span style={{ fontSize: 12, color: 'var(--vg-text-muted)' }}>{t('No target: “Propose from Keystone” takes the projects and machines that use the parts of the order.')}</span>}
        {e.targets.length > 0 && (
          <div style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label={fill(t('Effectivity of {id}'), { id: e.id })}>
            <table className="table" style={{ fontSize: 12.5, minWidth: 620 }}>
              <thead><tr><th>{t('Target#effectivity')}</th><th>{t('Disposition')}</th><th>{t('Revision fitted')}</th><th>{t('Deadline')}</th><th>{t('Done#f')}</th><th><span className="vg-sr-only">{t('Edit')}</span></th></tr></thead>
              <tbody>
                {e.targets.map((g) => (
                  <tr key={`${g.targetType}|${g.targetRef}`}>
                    <td>{g.typeLabel} {g.label}{g.isAutomatic && <div style={muted}>{t('Proposed from Keystone')}</div>}{g.note && <div style={{ fontSize: 12, fontStyle: 'italic' }}>{g.note}</div>}</td>
                    <td><ToneTag tone={g.disposition ? 'neutral' : 'warn'}>{g.dispositionLabel}</ToneTag></td>
                    <td>{g.fittedPartRef ? `${g.fittedPartRef} ${g.fittedRevision ?? ''}` : '—'}</td>
                    <td style={{ whiteSpace: 'nowrap', color: g.late ? 'var(--tone-danger-fg)' : undefined }}>{g.dueOn ? fmtDate(g.dueOn) : '—'}{g.late && t(' · late')}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{g.doneOn ? fmtDate(g.doneOn) : '—'}</td>
                    <td>{manage && e.status !== 'rejected' && <TargetButton e={e} g={g} version={version} today={today} onDone={setNotice} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={t('Change requests#engineering')}>
        {e.ecrs.length === 0 ? <span style={{ fontSize: 12, color: 'var(--vg-text-muted)' }}>{t('No linked request.')}</span> : (
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5 }}>
            {e.ecrs.map((r) => <li key={r.id}><Link href={engineeringHref(r.id)} className="vg-link">{r.id}</Link> · {r.title} <ToneTag tone={r.tone} style={{ fontSize: 11 }}>{r.statusLabel}</ToneTag></li>)}
          </ul>
        )}
      </Section>

      <Section title={t('Actions of the plan')} aside={manage && e.status !== 'rejected' && actionOptions.people.length > 0 && (
        <NewActionButton options={actionOptions} label={t('New action')} className="btn btn-secondary vg-btn-sm"
          defaults={{ link: `eco:${e.id}`, linkLabel: `${e.id} · ${e.title}`, source: 'modification_technique', lockSource: true, siteId: e.siteId, domain: 'qualite' }} />
      )}>
        {e.actions.length === 0 ? <span style={{ fontSize: 12, color: 'var(--vg-text-muted)' }}>{t('No linked action#f')}</span> : (
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
            <ActionForm action={advanceEco} hidden={{ id: e.id, to: next, version }} submitLabel={fill(t('Move to “{stage}”'), { stage: ECO_STATUSES[next].label })} submitIcon="ph-arrow-right"
              onDone={() => setNotice(fill(t('Order moved to the stage “{stage}”.'), { stage: ECO_STATUSES[next].label }))}>{null}</ActionForm>
          )}
          {ecoEditable(e.status) && options && (
            <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setEditing(true)}><i className="ph ph-pencil-simple" aria-hidden />{t('Edit')}</button>
          )}
          {ecoOpen(e.status) && (
            <ReasonButton label={t('Cancel the order')} icon="ph-prohibit" title={t('Cancel the change order')} kicker={e.id} action={cancelEco} hidden={{ id: e.id }}
              submitLabel={t('Cancel the order')} message={t('The order stays viewable with its history; it is published “rejected”. Its accepted requests become refused (Codex is informed).')}
              placeholder={t('E.g. change abandoned, entered twice')} onDone={onClose} />
          )}
        </div>
      )}
      <Dialog open={!!deciding} onClose={() => setDeciding(null)} width={520} kicker={t('Approval of an order')} title={deciding ? `${ECO_APPROVAL_KEYS[deciding].label} · ${e.id}` : ''}>
        {deciding && (
          <ActionForm action={decideEcoApproval} hidden={{ id: e.id, key: deciding, version }} submitLabel={t('Save the decision')}
            onDone={() => { setNotice(fill(t('Decision “{key}” recorded.'), { key: ECO_APPROVAL_KEYS[deciding].label })); setDeciding(null); }} onCancel={() => setDeciding(null)}>
            <Field name="decision" label={t('Decision')}>
              <Select name="decision" options={[['ok', t('Approved#m')], ['rejected', t('Refused (the order is rejected)')]]} defaultValue="ok" />
            </Field>
            <Field name="comment" label={t('Comment')} hint={t('Required for a refusal.')}>
              <TextArea name="comment" rows={3} maxLength={ECR_TEXT_MAX} />
            </Field>
          </ActionForm>
        )}
      </Dialog>
      <LazyChangeLog entity="eco" id={e.id} title={t('Change log')} />
    </>
  );
}

/** Disposition, note, échéance et réalisation d'une cible (QHSE). */
function TargetButton({ e, g, version, today, onDone }: { e: EcoView; g: TargetView; version?: string; today: string; onDone: (m: string) => void }) {
  const { t } = useI18n();
  const released = e.status === 'released';
  const choices = EFFECTIVITY_DISPOSITION_KEYS.filter((k) => !EFFECTIVITY_DISPOSITIONS[k].machineOnly || g.targetType === 'machine').map((k) => [k, EFFECTIVITY_DISPOSITIONS[k].label] as const);
  return (
    <DialogButton label="" ariaLabel={fill(t('Edit the target {label}'), { label: g.label })} tooltip={t('Edit the target')} icon="ph-pencil-simple" className="vg-text-btn" title={`${g.typeLabel} ${g.label}`} kicker={`${t('Effectivity')} · ${e.id}`} width={560}>
      {(done) => (
        <ActionForm action={saveEffectivityTarget} hidden={{ id: e.id, targetType: g.targetType, targetRef: g.targetRef, version, ...(released ? { disposition: g.disposition ?? '' } : {}) }}
          submitLabel={t('Save')} onDone={() => { done(); onDone(fill(t('Target {label} saved.'), { label: g.label })); }} onCancel={done}>
          {!released && (
            <Field name="disposition" label={t('Disposition')}>
              <Select name="disposition" options={choices} defaultValue={g.disposition ?? ''} placeholder={t('To decide')} />
            </Field>
          )}
          <Field name="note" label={t('Note')}>
            <TextArea name="note" rows={2} maxLength={ECR_TEXT_MAX} defaultValue={g.note ?? ''} />
          </Field>
          <FormRow>
            <Field name="dueOn" label={t('Deadline')} hint={t('Update or retrofit.')}>
              <Input name="dueOn" type="date" defaultValue={g.dueOn ?? ''} />
            </Field>
            {released && (
              <Field name="doneOn" label={t('Done on#f')}>
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
  const { t } = useI18n();
  const sites = siteOptions(options, t, e ? { id: e.siteId, label: e.siteLabel } : undefined);
  const people = e?.pilotId ? withCurrent(options.people, e.pilotId, `${e.pilot ?? e.pilotId}${t(' — left the workforce')}`) : options.people;
  const site = e ? e.siteId ?? ALL : sites.some(([v]) => v === defaultSite) ? defaultSite : sites[0]?.[0] ?? '';
  return (
    <ActionForm action={saveEco} hidden={{ id: e?.id, version: e ? version : undefined, source: prefill?.source ?? undefined }}
      onDone={onDone} onCancel={onCancel} submitLabel={e ? t('Save') : t('Create the order')}>
      <Field name="title" label={t('Title')}>
        <Input name="title" defaultValue={e?.title ?? prefill?.title ?? ''} maxLength={ECO_TITLE_MAX} autoFocus={!e} />
      </Field>
      <FormRow cols={3}>
        <Field name="ecoType" label={t('Type')}>
          <Select name="ecoType" options={TYPE_OPTIONS} defaultValue={e?.type ?? 'rev'} />
        </Field>
        <Field name="fromRevision" label={t('Starting revision')}>
          <Input name="fromRevision" defaultValue={e?.fromRevision ?? ''} maxLength={REVISION_MAX} />
        </Field>
        <Field name="toRevision" label={t('New revision')}>
          <Input name="toRevision" defaultValue={e?.toRevision ?? ''} maxLength={REVISION_MAX} />
        </Field>
      </FormRow>
      <FormRow cols={3}>
        <Field name="interchangeability" label={t('Interchangeability')} hint={t('To assess before the approval.')}>
          <Select name="interchangeability" options={INTERCHANGE_OPTIONS} defaultValue={e?.interchangeability ?? ''} placeholder={t('Not assessed')} />
        </Field>
        <Field name="costEur" label={t('Cost (€)')}>
          <Input name="costEur" inputMode="decimal" defaultValue={e ? String(e.costEur) : '0'} />
        </Field>
        <Field name="scheduleDays" label={t('Lead time (days)')}>
          <Input name="scheduleDays" type="number" min={0} max={3650} defaultValue={e ? e.scheduleDays : 0} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="pilotId" label={t('Lead')}>
          <Select name="pilotId" options={people} defaultValue={e?.pilotId ?? ''} placeholder={t('Not appointed')} />
        </Field>
        <Field name="siteId" label={t('Site')}>
          <Select name="siteId" options={sites} defaultValue={site} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="parts" label={t('Parts (Keystone)')} hint={t('One reference per line or separated by commas.')}>
          <TextArea name="parts" rows={2} defaultValue={e ? e.parts.map((p) => p.ref).join('\n') : prefill?.part ?? ''} />
        </Field>
        <Field name="projects" label={t('Projects (Keystone)')} hint={options.projectsMessage ?? t('Project codes, one per line.')}>
          <TextArea name="projects" rows={2} defaultValue={e ? e.projects.map((p) => p.code).join('\n') : prefill?.project ?? ''} />
        </Field>
      </FormRow>
      <Field name="documents" label={t('Documents cited')} hint={t('One line per document: “label” or “label | Codex identifier” (e.g. PRO-QUA-0006).')}>
        <TextArea name="documents" rows={2} defaultValue={e ? documentLinesText(e.documents) : ''} />
      </Field>
      <Field name="stockImpact" label={t('Impact on stock')}>
        <TextArea name="stockImpact" rows={2} maxLength={ECR_TEXT_MAX} defaultValue={e?.stockImpact ?? ''} />
      </Field>
      <Field name="description" label={t('Description')}>
        <TextArea name="description" rows={3} maxLength={ECR_TEXT_MAX * 2} defaultValue={e?.description ?? ''} />
      </Field>
      {ECO_APPROVAL_KEY_LIST.map((k) => {
        const a = e?.approvals.find((x) => x.key === k);
        return (
          <FormRow key={k}>
            <Field name={`approver_${k}`} label={`${t('Approver')} · ${ECO_APPROVAL_KEYS[k].short}`} hint={k === 'pm' ? t('Leaders of the projects concerned (text shown, published to Keystone).') : undefined}>
              <Input name={`approver_${k}`} defaultValue={a?.approver ?? ECO_APPROVAL_KEYS[k].fallback} maxLength={200} disabled={a?.decision !== undefined && a.decision !== 'pending'} />
            </Field>
            <Field name={`approverId_${k}`} label={t('Person appointed in Vigie')} hint={t('They decide their key in Vigie.')}>
              <Select name={`approverId_${k}`} options={a?.approverId ? withCurrent(options.people, a.approverId, a.approver) : options.people} defaultValue={a?.approverId ?? ''} placeholder={t('None#f')} />
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
  const { t } = useI18n();
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Fenêtres tenues ici : le bouton qui les ouvre disparaît dès la décision ou la mise en œuvre enregistrée.
  const [panel, setPanel] = useState<'decide' | 'implement' | null>(null);
  const manage = qhse && !r.cancelled && !!options;
  if (editing && options) {
    return <EcrForm r={r} options={options} defaultSite={r.siteId ?? ''} version={version} onDone={() => { setEditing(false); setNotice(t('Request saved.')); }} onCancel={() => setEditing(false)} />;
  }
  const ecoOptions: Option[] = [['new', t('Create a new order from the request')], ...(options?.ecos ?? [])];
  return (
    <>
      <Facts items={[
        [t('State'), <ToneTag key="s" tone={r.tone}>{r.statusLabel}</ToneTag>],
        [t('Nature'), r.kindLabel],
        [t('Subject'), r.subjectLabel],
        [t('Item'), r.refHref ? <Link key="h" href={r.refHref} className="vg-link">{r.refLabel}</Link> : r.refLabel],
        [t('Requester'), `${r.requester}${r.requesterRef ? ` (${r.requesterRef})` : ''} · ${fmtDate(r.createdOn)}`],
        [t('Origin'), r.sourceLabel],
        [t('Site'), r.siteLabel],
        !!r.ecoId && [t('Order'), <button key="o" type="button" className="vg-text-btn" onClick={() => onOpen(r.ecoId!)}>{r.ecoId}</button>],
        !!r.decidedOn && [t('Decided on#f'), `${fmtDate(r.decidedOn)}${r.decidedBy ? ` · ${r.decidedBy}` : ''}`],
        !!r.implementedOn && [t('Implemented on#f'), `${fmtDate(r.implementedOn)}${r.codexRevision ? fill(t(' · revision {rev} (Codex)'), { rev: r.codexRevision }) : ''}`],
        !!r.notify && [t('Sending to Codex'), <ToneTag key="n" tone={r.notify.tone}>{r.notify.label}{r.notify.error ? ` · ${r.notify.error}` : ''}</ToneTag>],
      ]} />
      {r.cancelled && <Notice tone="warn" icon="ph-prohibit">{fill(t('Cancelled on {date}'), { date: fmtDate(r.cancelled.on) })}{r.cancelled.by && fill(t(' by {name}'), { name: r.cancelled.by })}{t(' — reason: ')}{r.cancelled.reason}</Notice>}
      {r.overdue && <Notice tone="warn" icon="ph-clock">{fill(t('Decision expected since {date}'), { date: fmtDate(r.dueOn) })}.</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <Section title={t('Reason')}><p style={block}>{r.reason}</p></Section>
      {r.description && <Section title={t('Description')}><p style={block}>{r.description}</p></Section>}
      {r.decisionNote && <Section title={t('Decision')}><p style={block}>{r.decisionNote}</p></Section>}
      {manage && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {r.status === 'submitted' && (
            <button type="button" className="btn btn-primary vg-btn-sm" onClick={() => setPanel('decide')}><i className="ph ph-gavel" aria-hidden />{t('Decide')}</button>
          )}
          {r.status === 'submitted' && r.source === 'vigie' && (
            <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setEditing(true)}><i className="ph ph-pencil-simple" aria-hidden />{t('Edit')}</button>
          )}
          {r.status === 'accepted' && !(r.source === 'codex' && r.subject === 'document') && (
            <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setPanel('implement')}><i className="ph ph-check" aria-hidden />{t('Note the implementation')}</button>
          )}
          {r.status === 'submitted' && r.source === 'vigie' && (
            <ReasonButton label={t('Cancel the request')} icon="ph-prohibit" title={t('Cancel the request')} kicker={r.id} action={cancelEcr} hidden={{ id: r.id }}
              submitLabel={t('Cancel the request')} message={t('The request stays viewable with its history; it is published “refused”.')}
              placeholder={t('E.g. entered twice')} onDone={onClose} />
          )}
        </div>
      )}
      <Dialog open={panel === 'decide'} onClose={() => setPanel(null)} width={600} kicker={t('Change request#engineering')} title={fill(t('Decision on {id}'), { id: r.id })}>
        {panel === 'decide' && (
          <ActionForm action={decideEcr} hidden={{ id: r.id, version }} submitLabel={t('Save the decision')} onDone={() => { setNotice(t('Decision recorded.')); setPanel(null); }} onCancel={() => setPanel(null)}>
            <Field name="decision" label={t('Decision')}>
              <Select name="decision" options={[['accepted', t('Accepted#f')], ['rejected', t('Refused#f')]]} defaultValue="accepted" />
            </Field>
            <Field name="ecoId" label={t('Change order')} hint={t('Accepted: without an order, the decision is sent at once; with an order, at its release.')}>
              <Select name="ecoId" options={ecoOptions} defaultValue="" placeholder={t('Without an order')} />
            </Field>
            {r.subject === 'document' && r.source === 'codex' && (
              <Field name="modifierRef" label={t('Writer appointed in Codex')} hint={t('Codex identifier (e.g. jwagner); empty: the requester or the owner.')}>
                <Input name="modifierRef" maxLength={64} defaultValue={r.requesterRef ?? ''} />
              </Field>
            )}
            <Field name="note" label={t('Decision note')} hint={t('Required for a refusal; sent to Codex for a request from Codex.')}>
              <TextArea name="note" rows={3} maxLength={ECR_TEXT_MAX} />
            </Field>
          </ActionForm>
        )}
      </Dialog>
      <Dialog open={panel === 'implement'} onClose={() => setPanel(null)} width={520} kicker={t('Change request#engineering')} title={fill(t('Implementation of {id}'), { id: r.id })}>
        {panel === 'implement' && (
          <ActionForm action={implementEcr} hidden={{ id: r.id }} submitLabel={t('Note#verb')} onDone={() => { setNotice(t('Implementation noted.')); setPanel(null); }} onCancel={() => setPanel(null)}>
            <Field name="note" label={t('Finding')}><TextArea name="note" rows={3} maxLength={ECR_TEXT_MAX} /></Field>
          </ActionForm>
        )}
      </Dialog>
      <LazyChangeLog entity="ecr" id={r.id} title={t('Change log')} />
    </>
  );
}

const KIND_OPTIONS = ECR_KIND_KEYS.map((k) => [k, ECR_KINDS[k]] as const);
const SUBJECT_OPTIONS = ECR_SUBJECT_KEYS.map((k) => [k, ECR_SUBJECTS[k]] as const);

export function EcrForm({ r, options, defaultSite, version, onDone, onCancel }: {
  r?: EcrView; options: EngineeringOptions; defaultSite: string; version?: string; onDone: () => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const [subject, setSubject] = useState<EcrSubject>(r?.subject ?? 'part');
  const sites = siteOptions(options, t, r ? { id: r.siteId, label: r.siteLabel } : undefined);
  const site = r ? r.siteId ?? ALL : sites.some(([v]) => v === defaultSite) ? defaultSite : sites[0]?.[0] ?? '';
  return (
    <ActionForm action={saveEcr} hidden={{ id: r?.id, version: r ? version : undefined }} onDone={onDone} onCancel={onCancel} submitLabel={r ? t('Save') : t('Create the request')}>
      <FormRow>
        <Field name="kind" label={t('Nature')}>
          <Select name="kind" options={KIND_OPTIONS} defaultValue={r?.kind ?? 'modification'} />
        </Field>
        <Field name="subject" label={t('Subject')}>
          <Select name="subject" options={SUBJECT_OPTIONS} value={subject} onChange={(ev) => setSubject(ev.target.value as EcrSubject)} />
        </Field>
      </FormRow>
      {subject === 'document' && (
        <Field name="codexDocId" label={t('Document (Codex)')} hint={options.documentsMessage ?? undefined}>
          <Select name="codexDocId" options={r?.codexDocId ? withCurrent(options.documents, r.codexDocId, r.refLabel, 'start') : options.documents} defaultValue={r?.codexDocId ?? ''} placeholder={t('Choose…')} />
        </Field>
      )}
      {subject === 'part' && (
        <Field name="partRef" label={t('Part (Keystone)')} hint={t('Keystone catalogue reference (e.g. ARB-MAL-045).')}>
          <Input name="partRef" defaultValue={r?.partRef ?? ''} maxLength={64} />
        </Field>
      )}
      {subject === 'project' && (
        <Field name="keystoneProjectCode" label={t('Project (Keystone)')} hint={options.projectsMessage ?? undefined}>
          <Select name="keystoneProjectCode" options={withCurrent(options.projects, r?.projectCode, r?.projectCode, 'start')} defaultValue={r?.projectCode ?? ''} placeholder={t('Choose…')} />
        </Field>
      )}
      {subject === 'event' && (
        <Field name="eventId" label={t('Event (Vigie)')} hint={t('EV-… reference of an NC or a complaint of the site.')}>
          <Input name="eventId" defaultValue={r?.eventId ?? ''} maxLength={40} />
        </Field>
      )}
      <Field name="title" label={t('Title')}>
        <Input name="title" defaultValue={r?.title ?? ''} maxLength={ECO_TITLE_MAX} />
      </Field>
      <Field name="ecrReason" label={t('Reason for the request')}>
        <TextArea name="ecrReason" rows={3} maxLength={ECR_TEXT_MAX} defaultValue={r?.reason ?? ''} />
      </Field>
      <Field name="description" label={t('Description')}>
        <TextArea name="description" rows={3} maxLength={ECR_TEXT_MAX * 2} defaultValue={r?.description ?? ''} />
      </Field>
      <Field name="siteId" label={t('Site')}>
        <Select name="siteId" options={sites} defaultValue={site} />
      </Field>
    </ActionForm>
  );
}
