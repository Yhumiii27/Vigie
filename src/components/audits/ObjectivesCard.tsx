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

const INDICATOR_OPTIONS = OBJECTIVE_INDICATOR_KEYS.map((k) => [k, OBJECTIVE_INDICATORS[k].label] as const);

type Opts = { people: readonly Option[]; sites: readonly Option[]; allSites: boolean };

function ObjectiveForm({ o, year, options, decisions, onDone }: { o?: ObjectiveView; year: number; options: Opts; decisions: readonly Option[]; onDone: () => void }) {
  const sites: Option[] = [...(options.allSites ? [[ALL_SITES, 'Tous les sites'] as Option] : []), ...options.sites];
  const siteChoices = o ? withCurrent(sites, o.siteId ?? ALL_SITES, o.site) : sites;
  const people = o ? withCurrent(options.people, o.pilotId, o.pilot) : options.people;
  return (
    <ActionForm action={saveObjective} hidden={{ id: o?.id }} onDone={onDone} onCancel={onDone} submitLabel={o ? 'Enregistrer' : "Ajouter l'objectif"}>
      <Field name="label" label="Objectif" hint="Formulation retenue par la direction, ex. « Réduire les accidents avec arrêt ».">
        <Input name="label" defaultValue={o?.label ?? ''} maxLength={200} autoFocus />
      </Field>
      <Field name="indicator" label="Indicateur mesuré" hint="Valeur calculée par Vigie d'après les données, jamais saisie.">
        <Select name="indicator" options={INDICATOR_OPTIONS} defaultValue={o?.indicator ?? ''} placeholder="Choisir…" />
      </Field>
      <FormRow cols={3}>
        <Field name="target" label="Cible" hint="Plafond (TF1, retards…) ou seuil à atteindre (remontées, efficacité), selon l'indicateur.">
          <Input name="target" inputMode="decimal" defaultValue={o ? String(o.target).replace('.', ',') : ''} />
        </Field>
        <Field name="year" label="Année">
          <Input name="year" type="number" min={2000} max={2100} step={1} defaultValue={o?.year ?? year} />
        </Field>
        <Field name="siteId" label="Site">
          <Select name="siteId" options={siteChoices} defaultValue={o ? o.siteId ?? ALL_SITES : siteChoices[0]?.[0] ?? ''} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="pilotId" label="Pilote">
          <Select name="pilotId" options={people} defaultValue={o?.pilotId ?? ''} placeholder="Non désigné" />
        </Field>
        <Field name="reviewDecisionId" label="Décidé en revue de direction" hint="Facultatif : objectif d'une revue (§9.3.3).">
          <Select name="reviewDecisionId" options={decisions} defaultValue={o?.reviewDecisionId != null ? String(o.reviewDecisionId) : ''} placeholder="Aucune" />
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
  const { year, objectives, decisionOptions } = data;
  return (
    <div id="objectifs" className="card" style={{ gap: 8, scrollMarginTop: 16 }}>
      <CardHead title={`Objectifs QHSE ${year}`} aside={<Aside>ISO 9001 §6.2 · valeurs calculées</Aside>} />
      {objectives.length === 0 && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>Aucun objectif mesurable pour {year}.</div>}
      {objectives.length > 0 && (
        <div style={{ overflowX: 'auto' }} tabIndex={0} role="group" aria-label="Objectifs, défilement horizontal sur petit écran">
          <table className="table" style={{ fontSize: 12.5, minWidth: 560 }}>
            <thead><tr><th>Objectif</th><th>Indicateur</th><th style={{ textAlign: 'right' }}>Cible</th><th style={{ textAlign: 'right' }}>Atteint</th><th>État</th></tr></thead>
            <tbody>
              {objectives.map((o) => (
                <tr key={o.id}>
                  <td>
                    {canEdit ? (
                      <DialogButton label={o.label} className="vg-text-btn" style={{ textAlign: 'left' }} title="Modifier l'objectif" kicker={`Objectifs QHSE ${o.year}`} width={600}>
                        {(close) => (
                          <div style={{ display: 'grid', gap: 12 }}>
                            <ObjectiveForm o={o} year={year} options={options} decisions={decisionOptions} onDone={close} />
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <ReasonButton label="Archiver l'objectif" icon="ph-archive" title={`Archiver « ${o.label} »`} kicker="Objectifs QHSE"
                                action={archiveObjective} hidden={{ id: o.id }} submitLabel="Archiver" onDone={close}
                                placeholder="Ex. objectif remplacé par la revue du …, saisi par erreur" />
                            </div>
                            <LazyChangeLog entity="qhse_objective" id={o.id} />
                          </div>
                        )}
                      </DialogButton>
                    ) : o.label}
                    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
                      {[o.site, o.pilot !== '—' ? o.pilot : null, o.reviewDecision ? `revue : ${o.reviewDecision}` : null].filter(Boolean).join(' · ')}
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
        <DialogButton label="Ajouter un objectif" className="btn btn-secondary vg-btn-sm" style={{ justifySelf: 'start', alignSelf: 'flex-start' }} icon="ph-plus" title="Nouvel objectif QHSE" kicker={`Objectifs QHSE ${year}`} width={600}>
          {(close) => <ObjectiveForm year={year} options={options} decisions={decisionOptions} onDone={close} />}
        </DialogButton>
      )}
    </div>
  );
}
