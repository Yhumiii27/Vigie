'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { NewActionButton } from '@/components/ActionFormDialog';
import { DialogButton } from '@/components/Dialog';
import { EntityFiles } from '@/components/EntityFiles';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { ReasonButton } from '@/components/ReasonDialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { Aside, CardHead, Icon, MissingNotice, ScrollX, ToneTag } from '@/components/ui';
import { actionHref } from '@/lib/action-rules';
import type { ActionDefaults, ActionFormOptions } from '@/lib/action-view';
import type { AssessmentDetail, AssessmentLineView, AssessmentSummary, CatalogueRow } from '@/lib/data/self-assessment';
import { fmtDate } from '@/lib/dates';
import type { Tone } from '@/lib/domain';
import {
  ASSESSMENT_STANDARDS, ASSESSMENT_STANDARD_KEYS, CONFORMITY_LEVELS, CONFORMITY_LEVEL_KEYS, HEADING_MAX, fmtDelta, rateDelta, rateTone,
  selfAssessmentHref, selfAssessmentPrintHref, type AssessmentStandard,
} from '@/lib/rules/self-assessment';
import {
  addSelfAssessmentComment, archiveAssessmentRequirement, cancelSelfAssessment, closeSelfAssessment, restoreAssessmentRequirement,
  saveAssessmentLine, saveAssessmentRequirement, saveSelfAssessment,
} from '@/server/self-assessment';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';

// Auto-évaluation par référentiel (AUD-40) : vue « Auto-évaluation » de l'écran Audits. Liste des campagnes du site
// sélectionné (et d'entreprise), fiche d'une campagne (synthèse par article, comparaison avec la précédente, évaluation de
// chaque exigence, preuves, actions QSE, commentaires) et catalogue des exigences. Droits contrôlés par le serveur ; les
// indicateurs `canEdit` / `canCreate` / `canCatalogue` ne règlent que l'affichage.

type Option = readonly [string, string];
const muted = { fontSize: 12, color: 'var(--vg-text-muted)' } as const;
const pct = (n: number | null) => (n == null ? '—' : `${n} %`);
const deltaTone = (d: number | null): Tone => (d == null || d === 0 ? 'neutral' : d > 0 ? 'ok' : 'danger');

function NewCampaignButton({ assessors, sites, today }: { assessors: readonly Option[]; sites: readonly Option[]; today: string }) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <DialogButton label={t('New campaign')} icon="ph-plus" className="btn btn-primary vg-btn-sm" title={t('New self-assessment')} kicker={t('Grid per standard')} width={560}>
      {(close) => (
        <ActionForm action={saveSelfAssessment} submitLabel={t('Open the campaign')} onCancel={close}
          onDone={(s) => { close(); if (s.id) router.push(selfAssessmentHref(s.id), { scroll: false }); }}>
          <FormRow>
            <Field name="standard" label={t('Standard')}><Select name="standard" options={ASSESSMENT_STANDARD_KEYS.map((k) => [k, labelT(t)(ASSESSMENT_STANDARDS[k].short)] as const)} defaultValue="iso45001" /></Field>
            <Field name="siteId" label={t('Site')} hint={t('“All sites”: campaign for the whole company.')}><Select name="siteId" options={sites} /></Field>
          </FormRow>
          <FormRow>
            <Field name="assessedOn" label={t('Evaluation date')}><Input name="assessedOn" type="date" defaultValue={today} max={today} /></Field>
            <Field name="assessorId" label={t('Assessor')}><Select name="assessorId" options={assessors} placeholder={t('Choose…')} /></Field>
          </FormRow>
          <Field name="scope" label={t('Scope assessed')} hint={t('Optional: activities, processes or departments covered.')}>
            <Input name="scope" maxLength={400} />
          </Field>
        </ActionForm>
      )}
    </DialogButton>
  );
}

/** Liste des campagnes (la plus récente d'abord). */
function CampaignList({ rows, openId }: { rows: AssessmentSummary[]; openId?: string }) {
  const { t } = useI18n();
  if (!rows.length) return <span style={muted}>{t('No self-assessment campaign on this site.')}</span>;
  return (
    <ScrollX label={t('Self-assessment campaigns')}>
      <table className="table" style={{ fontSize: 12.5, minWidth: 620 }}>
        <thead><tr><th>{t('Ref.')}</th><th>{t('Standard')}</th><th>{t('Site')}</th><th>{t('Date')}</th><th>{t('State')}</th><th>{t('Compliance')}</th><th>{t('Trend')}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} aria-current={r.id === openId ? 'true' : undefined}>
              <td style={r.id === openId ? { boxShadow: 'inset 3px 0 0 var(--color-accent)', fontWeight: 500 } : undefined}><Link href={selfAssessmentHref(r.id)} scroll={false} className="vg-link">{r.id}</Link></td>
              <td>{r.standardLabel}</td>
              <td>{r.site}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.assessedOn)}</td>
              <td><ToneTag tone={r.statusTone as Tone}>{r.statusLabel}</ToneTag></td>
              <td><ToneTag tone={rateTone(r.synthesis.overall.rate)}>{pct(r.synthesis.overall.rate)}</ToneTag></td>
              <td>{r.previous ? <span>{fmtDelta(r.delta)} <span style={muted}>{fill(t('vs {id}'), { id: r.previous.id })}</span></span> : <span style={muted}>{t('First campaign')}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollX>
  );
}

/** Synthèse par article principal, comparée à la campagne précédente. */
export function SynthesisTable({ detail }: { detail: Pick<AssessmentDetail, 'synthesis' | 'previous'> }) {
  const { t } = useI18n();
  const { synthesis, previous } = detail;
  const rows = [...synthesis.clauses, synthesis.overall];
  return (
    <ScrollX label={t('Summary by clause')}>
      <table className="table" style={{ fontSize: 12.5, minWidth: 600 }}>
        <thead>
          <tr><th>{t('Clause')}</th><th>{t('Compliant')}</th><th>{t('Partial')}</th><th>{t('Non-compliant')}</th><th>{t('N/A')}</th><th>{t('To evaluate')}</th><th>{t('Rate')}</th>{previous && <th>{t('Previous')}</th>}{previous && <th>{t('Difference')}</th>}</tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const prev = previous ? (c.clause ? previous.clauses[c.clause] ?? null : previous.rate) : null;
            const delta = rateDelta(c.rate, prev);
            return (
              <tr key={c.clause || 'total'} style={c.clause ? undefined : { fontWeight: 500 }}>
                <td>{c.clause ? `${c.clause} · ${c.heading}` : c.heading}</td>
                <td>{c.counts.conforme}</td><td>{c.counts.partiel}</td><td>{c.counts.non_conforme}</td><td>{c.counts.non_applicable}</td><td>{c.counts.pending}</td>
                <td><ToneTag tone={rateTone(c.rate)}>{pct(c.rate)}</ToneTag></td>
                {previous && <td>{pct(prev)}</td>}
                {previous && <td><ToneTag tone={deltaTone(delta)}>{fmtDelta(delta)}</ToneTag></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollX>
  );
}

function lineActionDefaults(d: AssessmentDetail, l: AssessmentLineView): ActionDefaults {
  return {
    source: 'audit_interne', lockSource: true, link: `selfassessment:${l.id}`,
    linkLabel: `${d.id} · ${d.standardLabel} ${l.clause} ${l.heading}`,
    originRef: `${d.id} · ${d.standardLabel} ${l.clause}`.slice(0, 120),
    problem: `Auto-évaluation ${d.standardLabel} (${d.id}) — exigence ${l.clause} « ${l.heading} » : ${l.levelLabel.toLowerCase()}${l.finding ? ` — ${l.finding}` : ''}`.slice(0, 2000),
    ...(d.siteId ? { siteId: d.siteId } : {}),
  };
}

function LineForm({ line, onDone }: { line: AssessmentLineView; onDone: () => void }) {
  const { t } = useI18n();
  return (
    <ActionForm action={saveAssessmentLine} hidden={{ lineId: line.id, version: line.version }} onDone={onDone} onCancel={onDone}>
      <Field name="level" label={t('Compliance level')}>
        <Select name="level" options={CONFORMITY_LEVEL_KEYS.map((k) => [k, labelT(t)(CONFORMITY_LEVELS[k].label)] as const)} placeholder={t('To evaluate')} defaultValue={line.level ?? ''} />
      </Field>
      <Field name="justification" label={t('Justification')} hint={t('Required for “Not applicable” and “Non-compliant”.')}>
        <TextArea name="justification" rows={2} maxLength={2000} defaultValue={line.justification} />
      </Field>
      <Field name="finding" label={t('Finding')} hint={t('What was observed: practices, documents consulted, gaps.')}>
        <TextArea name="finding" rows={4} maxLength={4000} defaultValue={line.finding} />
      </Field>
    </ActionForm>
  );
}

function LineRow({ detail, line, editable, canCreate, actionOptions }: { detail: AssessmentDetail; line: AssessmentLineView; editable: boolean; canCreate: boolean; actionOptions: ActionFormOptions }) {
  const { t } = useI18n();
  const cancelled = detail.status === 'annulee';
  return (
    <li id={`ligne-${line.id}`} style={{ display: 'grid', gap: 4, padding: '8px 0', borderTop: '1px solid var(--color-neutral-900)', paddingLeft: line.main ? 0 : 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span className="tag tag-outline" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{line.clause}</span>
        <span style={{ fontSize: 12.5, fontWeight: line.main ? 500 : 400, flex: 1, minWidth: 180 }}>{line.heading}</span>
        <ToneTag tone={line.levelTone as Tone}>{line.levelLabel}</ToneTag>
        {line.previousLevel && line.previousLevel !== line.level && <span style={muted}>{t('previous: ')}{labelT(t)(CONFORMITY_LEVELS[line.previousLevel].label).toLowerCase()}</span>}
      </div>
      {(line.justification || line.finding) && (
        <div style={{ fontSize: 12, color: 'var(--color-neutral-300)', display: 'grid', gap: 2, textWrap: 'pretty' }}>
          {line.justification && <span><span style={muted}>{t('Justification: ')}</span>{line.justification}</span>}
          {line.finding && <span><span style={muted}>{t('Finding: ')}</span>{line.finding}</span>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
        {line.actions.map((a) => (
          a.action
            ? <Link key={a.id} href={actionHref(a.id)} className="vg-link" style={{ fontSize: 12 }}>{a.id} · {a.action.status}</Link>
            : <span key={a.id} style={muted}>{a.id}</span>
        ))}
        {editable && (
          <DialogButton label={t('Evaluate')} icon="ph-pencil-simple" className="vg-text-btn" title={`${line.clause} · ${line.heading}`} kicker={`${detail.id} · ${detail.standardLabel}`} width={560}>
            {(close) => <LineForm line={line} onDone={close} />}
          </DialogButton>
        )}
        {(line.files.length > 0 || editable) && (
          <DialogButton label={fill(t('Evidence ({n})'), { n: line.files.length })} icon="ph-paperclip" className="vg-text-btn" title={`${t('Evidence')} · ${line.clause}`} kicker={`${detail.id} · ${detail.standardLabel}`} width={560}>
            {() => (
              <EntityFiles kind="self_assessment_line" entityId={line.id} files={line.files} canAdd={editable}
                emptyText={t('No evidence attached.')} hint={t('Documents, photos or records that support the evaluation.')} />
            )}
          </DialogButton>
        )}
        {canCreate && !cancelled && line.level && line.level !== 'non_applicable' && (
          <NewActionButton options={actionOptions} defaults={lineActionDefaults(detail, line)} label={line.actions.length ? t('Other action') : t('Create an action')}
            className="vg-text-btn" icon="ph-plus" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} />
        )}
      </div>
    </li>
  );
}

function CampaignSheet({ detail, canEdit, canCreate, assessors, actionOptions }: {
  detail: AssessmentDetail; canEdit: boolean; canCreate: boolean; assessors: readonly Option[]; actionOptions: ActionFormOptions;
}) {
  const { t } = useI18n();
  const draft = detail.status === 'brouillon';
  const editable = canEdit && draft;
  const pending = detail.synthesis.overall.counts.pending;
  return (
    <div className="card" style={{ gap: 12 }}>
      <CardHead title={`${detail.id} · ${labelT(t)(ASSESSMENT_STANDARDS[detail.standard].label)}`} aside={
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <ToneTag tone={detail.statusTone as Tone}>{detail.statusLabel}</ToneTag>
          <a href={selfAssessmentPrintHref(detail.id)} target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm"><Icon name="ph-printer" size={13} />{t('Print')}</a>
          <Link href={selfAssessmentHref()} scroll={false} className="btn btn-ghost vg-btn-sm">{t('Close')}</Link>
        </span>
      } />
      <dl className="vg-facts" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, margin: 0, fontSize: 12.5 }}>
        <div><dt style={muted}>{t('Site')}</dt><dd style={{ margin: 0 }}>{detail.site}</dd></div>
        <div><dt style={muted}>{t('Date')}</dt><dd style={{ margin: 0 }}>{fmtDate(detail.assessedOn)}</dd></div>
        <div><dt style={muted}>{t('Assessor')}</dt><dd style={{ margin: 0 }}>{detail.assessor}</dd></div>
        <div><dt style={muted}>{t('Compliance rate')}</dt><dd style={{ margin: 0 }}><ToneTag tone={rateTone(detail.synthesis.overall.rate)}>{pct(detail.synthesis.overall.rate)}</ToneTag>{detail.previous && <span style={muted}> · {fmtDelta(detail.delta)} {fill(t('vs {id}'), { id: detail.previous.id })} ({fmtDate(detail.previous.assessedOn)})</span>}</dd></div>
        {detail.scope && <div style={{ gridColumn: '1 / -1' }}><dt style={muted}>{t('Scope')}</dt><dd style={{ margin: 0 }}>{detail.scope}</dd></div>}
        {detail.conclusion && <div style={{ gridColumn: '1 / -1' }}><dt style={muted}>{t('Conclusion')}</dt><dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{detail.conclusion}</dd></div>}
        {detail.closedOn && <div><dt style={muted}>{t('Closed on#f')}</dt><dd style={{ margin: 0 }}>{fmtDate(detail.closedOn)}{detail.closedBy ? fill(t(' by {name}'), { name: detail.closedBy }) : ''}</dd></div>}
        {detail.cancelled && <div style={{ gridColumn: '1 / -1' }}><dt style={muted}>{t('Cancelled on#f')}</dt><dd style={{ margin: 0 }}>{fmtDate(detail.cancelled.on)}{detail.cancelled.by ? fill(t(' by {name}'), { name: detail.cancelled.by }) : ''} — {detail.cancelled.reason}</dd></div>}
      </dl>

      {editable && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <DialogButton label={t('Edit')} icon="ph-pencil-simple" title={fill(t('Edit {name}'), { name: detail.id })} kicker={detail.standardLabel} width={560}>
            {(close) => (
              <ActionForm action={saveSelfAssessment} hidden={{ id: detail.id, version: detail.version }} onDone={close} onCancel={close}>
                <FormRow>
                  <Field name="assessedOn" label={t('Evaluation date')}><Input name="assessedOn" type="date" defaultValue={detail.assessedOn} /></Field>
                  <Field name="assessorId" label={t('Assessor')}><Select name="assessorId" options={assessors.some(([id]) => id === detail.assessorId) ? assessors : [[detail.assessorId, detail.assessor], ...assessors]} defaultValue={detail.assessorId} /></Field>
                </FormRow>
                <Field name="scope" label={t('Scope assessed')}><Input name="scope" maxLength={400} defaultValue={detail.scope} /></Field>
                <Field name="conclusion" label={t('Conclusion')}><TextArea name="conclusion" rows={4} maxLength={4000} defaultValue={detail.conclusion} /></Field>
              </ActionForm>
            )}
          </DialogButton>
          <DialogButton label={t('Close#campaign')} icon="ph-lock" className="btn btn-primary vg-btn-sm" title={fill(t('Close {id}'), { id: detail.id })} kicker={detail.standardLabel}
            disabled={pending > 0} tooltip={pending > 0 ? fill(pending > 1 ? t('{n} requirements still to evaluate.') : t('{n} requirement still to evaluate.'), { n: pending }) : undefined}>
            {(close) => (
              <ActionForm action={closeSelfAssessment} hidden={{ id: detail.id }} submitLabel={t('Close the campaign')} submitIcon="ph-lock" onDone={close} onCancel={close}>
                <p style={{ margin: 0, fontSize: 13 }}>{t('Once closed, the campaign is frozen: its evaluations and its evidence no longer change; actions and comments can still be added.')}</p>
              </ActionForm>
            )}
          </DialogButton>
          <ReasonButton label={t('Cancel')} icon="ph-prohibit" title={fill(t('Cancel {id}'), { id: detail.id })} kicker={detail.standardLabel} action={cancelSelfAssessment} hidden={{ id: detail.id }}
            submitLabel={t('Cancel the campaign')} submitIcon="ph-prohibit" message={t('The campaign is never deleted: it stays viewable with the reason.')}
            placeholder={t('E.g. campaign opened by mistake on the wrong standard')} />
        </div>
      )}

      <SynthesisTable detail={detail} />

      <div>
        <div className="vg-eyebrow" style={{ color: 'var(--color-neutral-500)' }}>{t('Requirements')}</div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {detail.lines.map((l) => <LineRow key={l.id} detail={detail} line={l} editable={editable} canCreate={canCreate} actionOptions={actionOptions} />)}
        </ul>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div className="vg-eyebrow" style={{ color: 'var(--color-neutral-500)' }}>{t('Comments')}</div>
        {detail.comments.length === 0 && <span style={muted}>{t('No comment.')}</span>}
        {detail.comments.map((c) => (
          <div key={c.id} style={{ fontSize: 12.5, display: 'grid', gap: 2 }}>
            <span style={muted}>{c.by} · {fmtDate(c.at.slice(0, 10))} {c.at.slice(11, 16)}</span>
            <span style={{ whiteSpace: 'pre-wrap' }}>{c.body}</span>
          </div>
        ))}
        {canEdit && detail.status !== 'annulee' && (
          <ActionForm action={addSelfAssessmentComment} hidden={{ id: detail.id }} submitLabel={t('Add the comment')} resetOnDone>
            <Field name="body" label={t('New comment')}><TextArea name="body" rows={2} maxLength={2000} /></Field>
          </ActionForm>
        )}
      </div>

      <LazyChangeLog entity="self_assessment" id={detail.id} />
    </div>
  );
}

/** Catalogue des exigences d'un référentiel (intitulés courts propres à Vigie) : animateur QHSE seulement en saisie. */
function Catalogue({ rows, canCatalogue }: { rows: CatalogueRow[]; canCatalogue: boolean }) {
  const { t } = useI18n();
  return (
    <details className="card" style={{ gap: 8 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 500 }}>{t('Catalogue of the requirements per standard')}</summary>
      <p style={{ ...muted, margin: 0, textWrap: 'pretty' }}>
        {t('Clause numbers and short headings written for Vigie (never the text of the standards). A requirement added or archived only applies to new campaigns.')}
      </p>
      {ASSESSMENT_STANDARD_KEYS.map((std) => {
        const list = rows.filter((r) => r.standard === std);
        return (
          <section key={std} style={{ display: 'grid', gap: 4 }}>
            <h3 style={{ fontSize: 13, margin: '8px 0 0' }}>{labelT(t)(ASSESSMENT_STANDARDS[std].label)}</h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
              {list.map((r) => (
                <li key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5, opacity: r.archived ? 0.7 : 1 }}>
                  <span className="tag tag-outline" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{r.clause}</span>
                  <span style={{ flex: 1, minWidth: 160 }}>{r.heading}{r.archived && <span style={muted}>{fill(t(' · archived on {date}#f'), { date: fmtDate(r.archived.on) })}</span>}</span>
                  {canCatalogue && !r.archived && (
                    <DialogButton label={t('Edit')} className="vg-text-btn" title={fill(t('Requirement {clause}'), { clause: r.clause })} kicker={labelT(t)(ASSESSMENT_STANDARDS[std].short)}>
                      {(close) => (
                        <ActionForm action={saveAssessmentRequirement} hidden={{ id: r.id, version: r.version }} onDone={close} onCancel={close}>
                          <Field name="heading" label={t('Short heading')} hint={t('Written for Vigie: do not copy the text of the standard.')}><Input name="heading" maxLength={HEADING_MAX} defaultValue={r.heading} /></Field>
                        </ActionForm>
                      )}
                    </DialogButton>
                  )}
                  {canCatalogue && (r.archived ? (
                    <ReasonButton label={t('Restore')} className="vg-text-btn" title={fill(t('Restore the requirement {clause}'), { clause: r.clause })} action={restoreAssessmentRequirement} hidden={{ id: r.id }}
                      submitLabel={t('Restore')} placeholder={t('E.g. requirement evaluated again')} />
                  ) : (
                    <ReasonButton label={t('Archive')} className="vg-text-btn" title={fill(t('Archive the requirement {clause}'), { clause: r.clause })} action={archiveAssessmentRequirement} hidden={{ id: r.id }}
                      submitLabel={t('Archive')} message={t('Existing campaigns keep the requirement; new ones no longer take it.')}
                      placeholder={t('E.g. clause removed by the revision of the standard')} />
                  ))}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {canCatalogue && (
        <DialogButton label={t('Add a requirement')} icon="ph-plus" title={t('Add a requirement')} kicker={t('Catalogue of the requirements')}>
          {(close) => (
            <ActionForm action={saveAssessmentRequirement} onDone={close} onCancel={close}>
              <FormRow>
                <Field name="standard" label={t('Standard')}><Select name="standard" options={ASSESSMENT_STANDARD_KEYS.map((k) => [k, labelT(t)(ASSESSMENT_STANDARDS[k].short)] as const)} /></Field>
                <Field name="clause" label={t('Clause')} hint={t('E.g. 7.1.4')}><Input name="clause" maxLength={12} /></Field>
              </FormRow>
              <Field name="heading" label={t('Short heading')} hint={t('Written for Vigie: do not copy the text of the standard.')}><Input name="heading" maxLength={HEADING_MAX} /></Field>
            </ActionForm>
          )}
        </DialogButton>
      )}
    </details>
  );
}

export function SelfAssessmentView({ data, catalogue, canCatalogue, canCreate, actionOptions, sites, missing, standard }: {
  data: { summaries: AssessmentSummary[]; detail: AssessmentDetail | null; canEdit: boolean; assessors: readonly Option[]; now: string };
  catalogue: CatalogueRow[];
  canCatalogue: boolean;
  canCreate: boolean;
  actionOptions: ActionFormOptions;
  /** Sites des formulaires (« Tous les sites » en tête pour le périmètre complet). */
  sites: readonly Option[];
  missing: boolean;
  standard?: AssessmentStandard;
}) {
  const { t } = useI18n();
  const rows = standard ? data.summaries.filter((s) => s.standard === standard) : data.summaries;
  return (
    <>
      {missing && <MissingNotice text={t('Self-assessment campaign not found or outside the selected site.')} closeHref={selfAssessmentHref()} />}
      <div className="card" style={{ gap: 10 }}>
        <CardHead title={t('Self-assessment per standard')} aside={
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <Aside>{fill(rows.length > 1 ? t('{n} campaigns') : t('{n} campaign'), { n: rows.length })}</Aside>
            {data.canEdit && <NewCampaignButton assessors={data.assessors} sites={sites} today={data.now} />}
          </span>
        } />
        <p style={{ ...muted, margin: 0, textWrap: 'pretty' }}>
          {t('ISO 45001, ISO 14001 and ISO 9001 grid ahead of a certification: compliance level per requirement, findings, evidence and QSE actions (source “ISO internal audit”), summary by clause and comparison with the previous campaign of the same standard and the same site.')}
        </p>
        <CampaignList rows={rows} openId={data.detail?.id} />
      </div>
      {data.detail && <CampaignSheet key={data.detail.id} detail={data.detail} canEdit={data.canEdit} canCreate={canCreate} assessors={data.assessors} actionOptions={actionOptions} />}
      <Catalogue rows={catalogue} canCatalogue={canCatalogue} />
    </>
  );
}
