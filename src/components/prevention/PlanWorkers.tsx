'use client';

import { useState } from 'react';
import { ReasonButton } from '@/components/ReasonDialog';
import { ActionForm, Field, Select } from '@/components/form';
import { ToneTag } from '@/components/ui';
import type { PlanView } from '@/lib/data/prevention';
import { addPlanWorker, liftPlanWorkerVeto, removePlanWorker, vetoPlanWorker } from '@/server/prevention-workers';
import { SectionTitle, muted, type PreventionOptions } from './parts';

/**
 * PRV-23 : intervenants du plan (personnes lues dans Cursus : salariés d'entreprise extérieure « E… », intérimaires « I… »,
 * salariés), avec leur accueil sécurité (titres marqués « accueil sécurité ») et leurs titres requis d'après Cursus.
 * Accueil sécurité non à jour : avertissement, jamais de refus. Veto motivé de l'animateur QHSE sur un intervenant dont les
 * habilitations ne sont pas à jour : signature du plan et délivrance de ses permis bloquées jusqu'à la levée (motif).
 */
export function PlanWorkers({ plan, editable, options }: { plan: PlanView; editable: boolean; options: PreventionOptions }) {
  const [adding, setAdding] = useState(false);
  const taken = new Set(plan.workers.map((w) => w.personId));
  const choices = (options.workers ?? []).filter(([id]) => !taken.has(id));
  if (!editable && !plan.workers.length) return null;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <SectionTitle aside={<span style={muted}>Accueil sécurité et habilitations (Cursus)</span>}>Intervenants</SectionTitle>
      {plan.workerWarning && <p role="status" style={{ margin: 0, fontSize: 12.5, color: 'var(--tone-warn-fg)' }}>{plan.workerWarning}</p>}
      {plan.workers.length === 0 && <span style={muted}>Aucun intervenant inscrit.</span>}
      {plan.workers.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {plan.workers.map((w) => (
            <li key={w.id} style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <strong style={{ fontWeight: 500 }}>{w.name}</strong>
                {(w.company || w.siteMatricule) && <span style={muted}>{[w.company, w.siteMatricule].filter(Boolean).join(' · ')}</span>}
                <ToneTag tone={w.inductionTone}>{w.inductionLabel}</ToneTag>
                {w.titlesValid === false && <ToneTag tone="danger">Habilitations non à jour : {w.lapsedTitles.join(', ')}</ToneTag>}
                {w.veto && <ToneTag tone="danger">Veto du service QHSE</ToneTag>}
              </span>
              {w.veto && <span style={muted}>Veto posé le {w.veto.on}{w.veto.by ? ` par ${w.veto.by}` : ''} — motif : {w.veto.reason}</span>}
              {editable && (
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {options.canVeto && !w.veto && w.vetoable && (
                    <ReasonButton label="Mettre un veto" icon="ph-hand-palm" title="Veto sur l'intervenant" kicker={`${plan.id} · ${w.name}`}
                      action={vetoPlanWorker} hidden={{ id: w.id }} submitLabel="Mettre un veto" submitIcon="ph-hand-palm"
                      message="Habilitations ou accueil sécurité non à jour : tant que le veto n'est pas levé, le plan ne se signe pas et ses permis ne se délivrent pas."
                      placeholder="Ex. habilitation électrique expirée, recyclage non réalisé" />
                  )}
                  {options.canVeto && w.veto && (
                    <ReasonButton label="Lever le veto" icon="ph-check" title="Lever le veto" kicker={`${plan.id} · ${w.name}`}
                      action={liftPlanWorkerVeto} hidden={{ id: w.id }} submitLabel="Lever le veto" submitIcon="ph-check"
                      placeholder="Ex. habilitation renouvelée (attestation vue)" />
                  )}
                  {!w.veto && (
                    <ReasonButton label="Retirer" icon="ph-user-minus" title="Retirer l'intervenant" kicker={`${plan.id} · ${w.name}`}
                      action={removePlanWorker} hidden={{ id: w.id }} submitLabel="Retirer l'intervenant" submitIcon="ph-user-minus"
                      message="L'intervenant n'est jamais supprimé : son retrait reste au journal du plan avec son motif."
                      placeholder="Ex. intervenant remplacé par l'entreprise" />
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && !adding && (
        <button type="button" className="vg-text-btn" style={{ justifySelf: 'start' }} onClick={() => setAdding(true)}>Ajouter un intervenant</button>
      )}
      {editable && adding && (
        <div className="vg-inset" style={{ padding: '10px 12px' }}>
          <ActionForm action={addPlanWorker} hidden={{ planId: plan.id }} onDone={() => setAdding(false)} onCancel={() => setAdding(false)} submitLabel="Ajouter">
            <Field name="personId" label="Intervenant" hint="Personne lue dans Cursus (salarié d'entreprise extérieure, intérimaire, salarié).">
              <Select name="personId" options={choices} placeholder="Choisir…" />
            </Field>
          </ActionForm>
        </div>
      )}
    </div>
  );
}
