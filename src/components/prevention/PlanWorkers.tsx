'use client';

import { useState } from 'react';
import { ReasonButton } from '@/components/ReasonDialog';
import { ActionForm, Field, Select } from '@/components/form';
import { ToneTag } from '@/components/ui';
import type { PlanView } from '@/lib/data/prevention';
import { addPlanWorker, liftPlanWorkerVeto, removePlanWorker, vetoPlanWorker } from '@/server/prevention-workers';
import { SectionTitle, muted, type PreventionOptions } from './parts';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

/**
 * PRV-23 : intervenants du plan (personnes lues dans Cursus : salariés d'entreprise extérieure « E… », intérimaires « I… »,
 * salariés), avec leur accueil sécurité (titres marqués « accueil sécurité ») et leurs titres requis d'après Cursus.
 * Accueil sécurité non à jour : avertissement, jamais de refus. Veto motivé de l'animateur QHSE sur un intervenant dont les
 * habilitations ne sont pas à jour : signature du plan et délivrance de ses permis bloquées jusqu'à la levée (motif).
 */
export function PlanWorkers({ plan, editable, options }: { plan: PlanView; editable: boolean; options: PreventionOptions }) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const taken = new Set(plan.workers.map((w) => w.personId));
  const choices = (options.workers ?? []).filter(([id]) => !taken.has(id));
  if (!editable && !plan.workers.length) return null;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <SectionTitle aside={<span style={muted}>{t('Safety induction and qualifications (Cursus)')}</span>}>{t('Workers')}</SectionTitle>
      {plan.workerWarning && <p role="status" style={{ margin: 0, fontSize: 12.5, color: 'var(--tone-warn-fg)' }}>{plan.workerWarning}</p>}
      {plan.workers.length === 0 && <span style={muted}>{t('No worker registered.')}</span>}
      {plan.workers.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {plan.workers.map((w) => (
            <li key={w.id} style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <strong style={{ fontWeight: 500 }}>{w.name}</strong>
                {(w.company || w.siteMatricule) && <span style={muted}>{[w.company, w.siteMatricule].filter(Boolean).join(' · ')}</span>}
                <ToneTag tone={w.inductionTone}>{w.inductionLabel}</ToneTag>
                {w.titlesValid === false && <ToneTag tone="danger">{fill(t('Qualifications not up to date: {list}'), { list: w.lapsedTitles.join(', ') })}</ToneTag>}
                {w.veto && <ToneTag tone="danger">{t('Veto of the QHSE department')}</ToneTag>}
              </span>
              {w.veto && <span style={muted}>{fill(t('Veto set on {date}'), { date: w.veto.on })}{w.veto.by ? fill(t(' by {name}'), { name: w.veto.by }) : ''}{fill(t(' — reason: {reason}'), { reason: w.veto.reason })}</span>}
              {editable && (
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {options.canVeto && !w.veto && w.vetoable && (
                    <ReasonButton label={t('Set a veto')} icon="ph-hand-palm" title={t('Veto on the worker')} kicker={`${plan.id} · ${w.name}`}
                      action={vetoPlanWorker} hidden={{ id: w.id }} submitLabel={t('Set a veto')} submitIcon="ph-hand-palm"
                      message={t('Qualifications or safety induction not up to date: until the veto is lifted, the plan cannot be signed and its permits cannot be issued.')}
                      placeholder={t('E.g. electrical qualification expired, refresher not done')} />
                  )}
                  {options.canVeto && w.veto && (
                    <ReasonButton label={t('Lift the veto')} icon="ph-check" title={t('Lift the veto')} kicker={`${plan.id} · ${w.name}`}
                      action={liftPlanWorkerVeto} hidden={{ id: w.id }} submitLabel={t('Lift the veto')} submitIcon="ph-check"
                      placeholder={t('E.g. qualification renewed (certificate seen)')} />
                  )}
                  {!w.veto && (
                    <ReasonButton label={t('Remove')} icon="ph-user-minus" title={t('Remove the worker')} kicker={`${plan.id} · ${w.name}`}
                      action={removePlanWorker} hidden={{ id: w.id }} submitLabel={t('Remove the worker')} submitIcon="ph-user-minus"
                      message={t('The worker is never deleted: the removal stays in the plan’s log with its reason.')}
                      placeholder={t('E.g. worker replaced by the company')} />
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && !adding && (
        <button type="button" className="vg-text-btn" style={{ justifySelf: 'start' }} onClick={() => setAdding(true)}>{t('Add a worker')}</button>
      )}
      {editable && adding && (
        <div className="vg-inset" style={{ padding: '10px 12px' }}>
          <ActionForm action={addPlanWorker} hidden={{ planId: plan.id }} onDone={() => setAdding(false)} onCancel={() => setAdding(false)} submitLabel={t('Add')}>
            <Field name="personId" label={t('Worker')} hint={t('Person read in Cursus (external company employee, temporary worker, employee).')}>
              <Select name="personId" options={choices} placeholder={t('Choose…')} />
            </Field>
          </ActionForm>
        </div>
      )}
    </div>
  );
}
