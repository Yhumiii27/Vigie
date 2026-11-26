'use client';

import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select } from '@/components/form';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { ReasonButton } from '@/components/ReasonDialog';
import { Aside, CardHead, ToneTag } from '@/components/ui';
import type { ObjectiveView, ObjectivesData } from '@/lib/data/objectives';
import { ALL_SITES } from '@/lib/domain';
import { withCurrent, type Option } from '@/lib/form-options';
import { OBJECTIVE_INDICATORS, OBJECTIVE_INDICATOR_KEYS, fmtObjectiveTarget, fmtObjectiveValue } from '@/lib/objectives';
import { archiveObjective, saveObjective } from '@/server/objectives';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

const INDICATOR_OPTIONS = OBJECTIVE_INDICATOR_KEYS.map((k) => [k, OBJECTIVE_INDICATORS[k].label] as const);

type Opts = { people: readonly Option[]; sites: readonly Option[]; allSites: boolean };

function ObjectiveForm({ o, year, options, decisions, onDone }: { o?: ObjectiveView; year: number; options: Opts; decisions: readonly Option[]; onDone: () => void }) {
  const { t } = useI18n();
  const sites: Option[] = [...(options.allSites ? [[ALL_SITES, t('All sites')] as Option] : []), ...options.sites];
  const siteChoices = o ? withCurrent(sites, o.siteId ?? ALL_SITES, o.site) : sites;
  const people = o ? withCurrent(options.people, o.pilotId, o.pilot) : options.people;
  return (
    <ActionForm action={saveObjective} hidden={{ id: o?.id, version: o?.version }} onDone={onDone} onCancel={onDone} submitLabel={o ? t('Save') : t('Add the objective')}>
      <Field name="label" label={t('Objective')} hint={t('Wording chosen by management, e.g. “Reduce lost-time accidents”.')}>
        <Input name="label" defaultValue={o?.label ?? ''} maxLength={200} autoFocus />
      </Field>
      <Field name="indicator" label={t('Measured indicator')} hint={t('Value computed by Vigie from the data, never entered.')}>
        <Select name="indicator" options={INDICATOR_OPTIONS} defaultValue={o?.indicator ?? ''} placeholder={t('Choose…')} />
      </Field>
      <FormRow cols={3}>
        <Field name="target" label={t('Target')} hint={t('Ceiling (LTIFR, delays…) or threshold to reach (reports, effectiveness), depending on the indicator.')}>
          <Input name="target" inputMode="decimal" defaultValue={o ? String(o.target).replace('.', ',') : ''} />
        </Field>
        <Field name="year" label={t('Year')}>
          <Input name="year" type="number" min={2000} max={2100} step={1} defaultValue={o?.year ?? year} />
        </Field>
        <Field name="siteId" label={t('Site')}>
          <Select name="siteId" options={siteChoices} defaultValue={o ? o.siteId ?? ALL_SITES : siteChoices[0]?.[0] ?? ''} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="pilotId" label={t('Lead')}>
          <Select name="pilotId" options={people} defaultValue={o?.pilotId ?? ''} placeholder={t('Not appointed')} />
        </Field>
        <Field name="reviewDecisionId" label={t('Decided in management review')} hint={t('Optional: objective of a review (§9.3.3).')}>
          <Select name="reviewDecisionId" options={decisions} defaultValue={o?.reviewDecisionId != null ? String(o.reviewDecisionId) : ''} placeholder={t('None#f')} />
        </Field>
      </FormRow>
    </ActionForm>
  );
}

/**
 * Objectifs QHSE mesurables de l'année (AUD-13, ISO 9001 §6.2 et §9.1) : indicateur calculé, cible, valeur atteinte et
 * état (jamais stockés) ; saisie par l'animateur QHSE et la direction, archivage motivé, historique de chaque objectif.
 */
export function ObjectivesCard({ data, canEdit, options }: { data: ObjectivesData; canEdit: boolean; options: Opts }) {
  const { t } = useI18n();
  const { year, objectives, decisionOptions } = data;
  return (
    <div id="objectifs" className="card" style={{ gap: 8, scrollMarginTop: 16 }}>
      <CardHead title={`${t('QHSE objectives')} ${year}`} aside={<Aside>{t('ISO 9001 §6.2 · computed values')}</Aside>} />
      {objectives.length === 0 && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{fill(t('No measurable objective for {year}.'), { year })}</div>}
      {objectives.length > 0 && (
        <div style={{ overflowX: 'auto' }} tabIndex={0} role="group" aria-label={t('Objectives, horizontal scrolling on a small screen')}>
          <table className="table" style={{ fontSize: 12.5, minWidth: 560 }}>
            <thead><tr><th>{t('Objective')}</th><th>{t('Indicator')}</th><th style={{ textAlign: 'right' }}>{t('Target')}</th><th style={{ textAlign: 'right' }}>{t('Achieved')}</th><th>{t('State')}</th></tr></thead>
            <tbody>
              {objectives.map((o) => (
                <tr key={o.id}>
                  <td>
                    {canEdit ? (
                      <DialogButton label={o.label} className="vg-text-btn" style={{ textAlign: 'left' }} title={t('Edit the objective')} kicker={`${t('QHSE objectives')} ${o.year}`} width={600}>
                        {(close) => (
                          <div style={{ display: 'grid', gap: 12 }}>
                            <ObjectiveForm o={o} year={year} options={options} decisions={decisionOptions} onDone={close} />
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <ReasonButton label={t('Archive the objective')} icon="ph-archive" title={fill(t('Archive “{text}”'), { text: o.label })} kicker={t('QHSE objectives')}
                                action={archiveObjective} hidden={{ id: o.id }} submitLabel={t('Archive')} onDone={close}
                                placeholder={t('E.g. objective replaced by the review of …, entered by mistake')} />
                            </div>
                            <LazyChangeLog entity="qhse_objective" id={o.id} />
                          </div>
                        )}
                      </DialogButton>
                    ) : o.label}
                    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
                      {[o.site, o.pilot !== '—' ? o.pilot : null, o.reviewDecision ? fill(t('review: {decision}'), { decision: o.reviewDecision }) : null].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td style={{ color: 'var(--color-neutral-300)' }}>{OBJECTIVE_INDICATORS[o.indicator].short}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtObjectiveTarget(o.indicator, o.target)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtObjectiveValue(o.indicator, o.value)}</td>
                  <td><ToneTag tone={o.status.tone}>{o.status.label}</ToneTag></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <DialogButton label={t('Add an objective')} className="btn btn-secondary vg-btn-sm" style={{ justifySelf: 'start', alignSelf: 'flex-start' }} icon="ph-plus" title={t('New QHSE objective')} kicker={`${t('QHSE objectives')} ${year}`} width={600}>
          {(close) => <ObjectiveForm year={year} options={options} decisions={decisionOptions} onDone={close} />}
        </DialogButton>
      )}
    </div>
  );
}
