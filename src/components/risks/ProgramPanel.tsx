'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChangeLogList } from '@/components/ChangeLog';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { ReasonButton } from '@/components/ReasonDialog';
import { SegLinks, ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { PROGRAM_SHORT, PROGRAM_STATES, RISK_LEVELS, TONE, riskLevel } from '@/lib/domain';
import type { PreventionProgramData, ProgramLineView } from '@/lib/data/risks';
import {
  addProgramAction, createPreventionProgram, freezePreventionProgram, removeProgramAction, reopenPreventionProgram,
  saveProgramAction, updatePreventionProgram,
} from '@/server/risks';
import { fmtEuro } from '@/lib/rules/risk-format';
import { useI18n } from '@/i18n/client';
import { labelT } from '@/i18n/labels';
import { fill } from '@/i18n/translate';

const muted = { fontSize: 11.5, color: 'var(--color-neutral-500)' } as const;
const lineTone = (l: ProgramLineView) => (l.cancelled ? 'var(--color-neutral-500)' : TONE[l.tone].fg);

const costText = (n: number | null | undefined) => (n != null ? String(n).replace('.', ',') : '');

/**
 * Champs d'une ligne du programme : coût estimé, ressources, indicateur (optionnels). `cost` / `onCost` : coût contrôlé
 * (ligne ajoutée : proposé depuis l'action choisie) ; `costHint` remplace l'aide du coût.
 */
function LineFields({ line, cost, onCost, costHint }: { line?: ProgramLineView; cost?: string; onCost?: (v: string) => void; costHint?: string }) {
  const { t } = useI18n();
  return (
    <>
      <FormRow>
        <Field name="estimatedCost" label={t('Estimated cost (€ excl. VAT)')} hint={costHint ?? t('Optional; cents allowed (1250.50).')}>
          {onCost
            ? <Input name="estimatedCost" inputMode="decimal" value={cost ?? ''} onChange={(e) => onCost(e.target.value)} />
            : <Input name="estimatedCost" inputMode="decimal" defaultValue={costText(line?.estimatedCost)} />}
        </Field>
        <Field name="indicator" label={t('Result indicator')}>
          <Input name="indicator" maxLength={300} defaultValue={line?.indicator ?? ''} placeholder={t('E.g. 100 % of fitters qualified')} />
        </Field>
      </FormRow>
      <Field name="resources" label={t('Resources')} hint={t('Human means, contractors, budget, timing.')}>
        <TextArea name="resources" rows={2} maxLength={500} defaultValue={line?.resources ?? ''} />
      </Field>
    </>
  );
}

/**
 * Ajout d'une ligne (DUE-02, spec § 11) : le choix de l'action propose son coût estimé (saisi dans le plan d'actions,
 * modifiable ici) ; le coût de la ligne reste ensuite figé avec le programme à l'arrêt.
 */
function AddLineFields({ candidates, costs }: { candidates: PreventionProgramData['candidates']; costs: PreventionProgramData['candidateCosts'] }) {
  const { t } = useI18n();
  const [picked, setPicked] = useState('');
  const [cost, setCost] = useState('');
  const proposed = picked && Object.hasOwn(costs, picked) ? costs[picked] : null;
  return (
    <>
      <Field name="actionId" label={t('Plan action')} hint={t('Actions linked to a risk of the DUERP in force, not closed or verified within the year.')}>
        <Select name="actionId" options={candidates} placeholder={t('Choose…')} value={picked}
          onChange={(e) => { const id = e.target.value; setPicked(id); setCost(costText(Object.hasOwn(costs, id) ? costs[id] : null)); }} />
      </Field>
      <LineFields cost={cost} onCost={setCost}
        costHint={proposed != null ? fill(t('Proposed: estimated cost of the action (incl. VAT), {cost}; can be changed.'), { cost: fmtEuro(proposed) }) : undefined} />
    </>
  );
}

/**
 * Programme annuel de prévention des risques professionnels et d'amélioration des conditions de travail (PAPRIPACT,
 * L. 4121-3-1, DUE-02) : actions du plan rattachées aux risques du DUERP, avec coût estimé, ressources et indicateur.
 * Consultable par tous les rôles ; préparation, arrêt après consultation du CSE et réouverture motivée réservés à
 * l'animateur QHSE et à la direction.
 */
export function ProgramPanel({ data, yearLinks, canApprove, showPilot, showHistory }: {
  data: PreventionProgramData;
  /** Années proposées (lien vers ?programme=<année>). */
  yearLinks: { year: number; href: string }[];
  canApprove: boolean;
  /** Pilotes des actions (masqués pour le Salarié). */
  showPilot: boolean;
  /** Historique du programme (rôles qui modifient le DUERP). */
  showHistory: boolean;
}) {
  const { t } = useI18n();
  const { year, program, lines, totals, hiddenCount, candidates, candidateCosts } = data;
  const draft = program?.state === 'draft';
  const frozen = program?.state === 'frozen';
  const editLines = canApprove && draft;
  const printHref = `/risques/imprimer/programme?annee=${year}`;
  const cols = 7 + (showPilot ? 1 : 0) + (editLines ? 1 : 0);
  const multiSite = new Set(lines.map((l) => l.siteId)).size > 1;
  const meta = program && [
    `DUERP ${program.duerpVersion}`,
    program.cseConsultedOn ? fill(t('CSE consulted on {date}'), { date: fmtDate(program.cseConsultedOn) }) : null,
    program.frozenOn ? `${fill(t('adopted on {date}'), { date: fmtDate(program.frozenOn) })}${program.frozenBy ? fill(t(' by {by}'), { by: program.frozenBy }) : ''}` : null,
    program.createdBy && !frozen ? fill(t('prepared by {by}'), { by: program.createdBy }) : null,
  ].filter(Boolean).join(' · ');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
      <div className="card" style={{ gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 2 }}>
            <div className="card-kicker">{t('Annual prevention programme · L. 4121-3-1')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="card-title" style={{ fontSize: 15 }}>{PROGRAM_SHORT} {year}</span>
              {program
                ? <ToneTag tone={PROGRAM_STATES[program.state].tone}>{labelT(t)(PROGRAM_STATES[program.state].label)}</ToneTag>
                : <ToneTag tone="neutral">{t('Not established')}</ToneTag>}
            </div>
          </div>
          {yearLinks.length > 1 && (
            <SegLinks size={11.5} pad="3px 9px" options={yearLinks.map((y) => ({ href: y.href, label: String(y.year), on: y.year === year }))} />
          )}
        </div>

        {program ? (
          <>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>
              {meta}
              {!program.cseConsultedOn && <span style={{ color: TONE.warn.fg }}> · {t('CSE consultation to be entered')}</span>}
            </div>
            {program.comment && <div style={{ fontSize: 12.5, textWrap: 'pretty' }}>{program.comment}</div>}
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              {[
                { v: String(totals.count), k: totals.count > 1 ? t('actions') : t('action') },
                { v: String(totals.done), k: totals.done > 1 ? t('verified actions') : t('verified action') },
                { v: fmtEuro(totals.cost), k: t('estimated cost (excl. VAT)') },
              ].map((k) => (
                <div key={k.k} style={{ display: 'grid', gap: 1 }}>
                  <span style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-.02em' }}>{k.v}</span>
                  <span style={muted}>{k.k}</span>
                </div>
              ))}
              {totals.count > totals.costed && (
                <div style={{ display: 'grid', gap: 1 }}>
                  <span style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-.02em', color: TONE.warn.fg }}>{totals.count - totals.costed}</span>
                  <span style={muted}>{t('without cost')}</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', fontSize: 12.5, textWrap: 'pretty', margin: 0 }}>
            {fill(t('No programme established for {year}. The programme takes over the action plan’s actions linked to the DUERP risks, with their estimated cost, resources and an indicator, then it is adopted after the CSE consultation.'), { year })}
          </p>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {editLines && (
            <>
              <DialogButton label={t('Add an action')} icon="ph-plus" className="btn btn-primary vg-btn-sm" title={t('Add an action')} kicker={`${PROGRAM_SHORT} ${year}`} width={600}
                disabled={!candidates.length} tooltip={candidates.length ? undefined : t('No other action linked to a risk of the DUERP in force.')}>
                {(close) => (
                  <ActionForm action={addProgramAction} hidden={{ year }} onDone={close} onCancel={close} submitLabel={t('Add to the programme')}>
                    <AddLineFields candidates={candidates} costs={candidateCosts} />
                  </ActionForm>
                )}
              </DialogButton>
              <DialogButton label={t('Adopt the programme')} icon="ph-seal-check" className="btn btn-secondary vg-btn-sm" title={fill(t('Adopt the programme {year}'), { year })} kicker={t('After CSE consultation')} width={520}
                disabled={!lines.length && !hiddenCount} tooltip={lines.length || hiddenCount ? undefined : t('Empty programme: add at least one action.')}>
                {(close) => (
                  <ActionForm action={freezePreventionProgram} hidden={{ year }} onDone={close} onCancel={close} submitLabel={t('Adopt the programme')} submitIcon="ph-seal-check">
                    <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
                      {t('The programme lines (all sites) will be frozen on the consultation date; it can no longer be changed, except by a reasoned reopening.')}
                    </p>
                    <Field name="cseConsultedOn" label={t('CSE consultation')} hint={t('Date of the meeting where the CSE was consulted.')}>
                      <Input name="cseConsultedOn" type="date" />
                    </Field>
                  </ActionForm>
                )}
              </DialogButton>
              <DialogButton label={t('Edit the purpose')} icon="ph-pencil-simple" className="btn btn-ghost vg-btn-sm" title={fill(t('Programme {year}'), { year })} kicker={t('Purpose of the programme')} width={520}>
                {(close) => (
                  <ActionForm action={updatePreventionProgram} hidden={{ year }} onDone={close} onCancel={close}>
                    <Field name="comment" label={t('Purpose')}>
                      <TextArea name="comment" rows={3} maxLength={1000} defaultValue={program?.comment ?? ''} />
                    </Field>
                  </ActionForm>
                )}
              </DialogButton>
            </>
          )}
          {canApprove && frozen && (
            <ReasonButton label={t('Reopen')} icon="ph-lock-open" title={fill(t('Reopen the programme {year}'), { year })} kicker={t('Adopted programme')}
              action={reopenPreventionProgram} hidden={{ year }} submitLabel={t('Reopen the programme')} submitIcon="ph-lock-open"
              placeholder={t('E.g. action added at the CSE’s request, costing error…')}
              message={t('The snapshot and the CSE consultation date are cleared: the programme goes back to preparation and must be adopted again after consultation.')} />
          )}
          {data.creatable && (
            <DialogButton label={fill(t('Create the programme {year}'), { year })} icon="ph-plus" className="btn btn-primary vg-btn-sm" title={fill(t('Programme {year}'), { year })} kicker={`${PROGRAM_SHORT} · DUERP ${data.currentVersion}`} width={560}>
              {(close) => (
                <ActionForm action={createPreventionProgram} hidden={{ year }} onDone={close} onCancel={close} submitLabel={t('Create the programme')}>
                  <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
                    {data.prefillCount
                      ? fill(data.prefillCount > 1 ? t('{n} plan actions linked to the risks of DUERP {version} (due in {year} or carried over from an earlier year) will be taken over, all sites.') : t('{n} plan action linked to the risks of DUERP {version} (due in {year} or carried over from an earlier year) will be taken over, all sites.'), { n: data.prefillCount, version: data.currentVersion ?? '', year })
                      : fill(t('No action linked to the risks of DUERP {version} needs to be taken over: the programme will be created empty.'), { version: data.currentVersion ?? '' })}
                  </p>
                  <Field name="comment" label={t('Purpose')} hint={t('Optional: priorities of the year, update of the original DUERP…')}>
                    <TextArea name="comment" rows={3} maxLength={1000} />
                  </Field>
                </ActionForm>
              )}
            </DialogButton>
          )}
          {canApprove && !program && !data.creatable && !data.currentVersion && (
            <span style={{ fontSize: 12, color: TONE.warn.fg }}>{t('No DUERP version in force: open a version first.')}</span>
          )}
          {program && (
            <a href={printHref} target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm" style={{ marginLeft: 'auto' }}>
              <i className="ph ph-printer" style={{ fontSize: 13 }} aria-hidden />{t('Print')}
            </a>
          )}
        </div>
      </div>

      {program && (
        <div className="card" style={{ padding: '6px 14px 10px', gap: 8 }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: 12.5, minWidth: 900 }}>
              <thead>
                <tr>
                  <th>{t('Action')}</th><th>{t('Risks')}</th><th>{t('Target date')}</th><th>{t('Progress')}</th>{showPilot && <th>{t('Owner')}</th>}
                  <th style={{ textAlign: 'right' }}>{t('Cost')}</th><th>{t('Resources')}</th><th>{t('Indicator')}</th>{editLines && <th />}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.actionId} data-obsolete={l.cancelled || undefined}>
                    <td style={{ verticalAlign: 'top', minWidth: 200 }}>
                      <Link href={`/actions?action=${encodeURIComponent(l.actionId)}`} className="vg-link"
                        style={{ fontSize: 12.5, color: lineTone(l), textDecoration: l.cancelled ? 'line-through' : undefined }}>{l.actionId}</Link>
                      <div style={{ textWrap: 'pretty' }}>{l.title}</div>
                      {multiSite && <div style={muted}>{l.site}</div>}
                    </td>
                    <td style={{ verticalAlign: 'top', minWidth: 160 }}>
                      {l.risks.length ? l.risks.map((r, i) => (
                        <div key={`${r.id ?? i}`} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                          <span className="vg-dot" style={{ width: 7, height: 7, flex: 'none', background: RISK_LEVELS[riskLevel(r.cotation)].dot }} />
                          {r.id != null
                            ? <Link href={`/risques?risque=${r.id}`} className="vg-link" style={{ fontSize: 12 }}>{r.label}</Link>
                            : <span style={{ fontSize: 12 }}>{r.label}</span>}
                          <span style={muted}>{r.cotation}</span>
                        </div>
                      )) : <span style={muted}>{t('No longer linked to a risk in force')}</span>}
                    </td>
                    <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>{l.dueOn ? fmtDate(l.dueOn) : '—'}</td>
                    <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      <span style={{ color: lineTone(l) }}>{l.status}</span>
                      {l.frozenStatus != null && l.frozenStatus !== l.status && <div style={muted}>{fill(t('at adoption: {status}'), { status: l.frozenStatus })}</div>}
                    </td>
                    {showPilot && <td style={{ verticalAlign: 'top', color: 'var(--color-neutral-300)' }}>{l.pilot || '—'}</td>}
                    <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap', textAlign: 'right' }}>{l.estimatedCost != null ? fmtEuro(l.estimatedCost) : <span style={{ color: 'var(--vg-text-muted)' }}>—</span>}</td>
                    <td style={{ verticalAlign: 'top', color: 'var(--color-neutral-300)', maxWidth: 220, textWrap: 'pretty' }}>{l.resources || '—'}</td>
                    <td style={{ verticalAlign: 'top', color: 'var(--color-neutral-300)', maxWidth: 220, textWrap: 'pretty' }}>{l.indicator || '—'}</td>
                    {editLines && (
                      <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', gap: 10 }}>
                          <DialogButton label={t('Edit')} className="vg-text-btn" title={`${l.actionId} · ${l.title}`} kicker={`${PROGRAM_SHORT} ${year}`} width={600}>
                            {(close) => (
                              <ActionForm action={saveProgramAction} hidden={{ year, actionId: l.actionId }} onDone={close} onCancel={close}>
                                <LineFields line={l} />
                              </ActionForm>
                            )}
                          </DialogButton>
                          <DialogButton label={t('Withdraw')} className="vg-text-btn" title={`${l.actionId} · ${l.title}`} kicker={fill(t('Remove from the {short} {year}'), { short: PROGRAM_SHORT, year })} width={480}>
                            {(close) => (
                              <ActionForm action={removeProgramAction} hidden={{ year, actionId: l.actionId }} onDone={close} onCancel={close} submitLabel={t('Remove from the programme')}>
                                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
                                  {t('The action stays in the action plan; its cost, resources and indicator are removed from the programme in preparation (removal noted in the history).')}
                                </p>
                              </ActionForm>
                            )}
                          </DialogButton>
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
                {!lines.length && (
                  <tr><td colSpan={cols} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>
                    {hiddenCount ? t('No programme action on this site.') : editLines ? t('No action in the programme: use “Add an action”.') : t('No action in the programme.')}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {hiddenCount > 0 && (
            <div style={muted}>
              {fill(hiddenCount > 1 ? t('{n} programme actions on other sites are not displayed (selected site); the programme is common to all sites.') : t('{n} programme action on other sites is not displayed (selected site); the programme is common to all sites.'), { n: hiddenCount })}
            </div>
          )}
        </div>
      )}

      {showHistory && program && <ChangeLogList entries={data.history} />}
    </div>
  );
}
