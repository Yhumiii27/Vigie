'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ActionFields, type ActionDefaults } from '@/components/ActionFormDialog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Checkbox, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { Dot, Icon, ToneTag } from '@/components/ui';
import { addDays, fmtDate } from '@/lib/dates';
import { REQUIREMENT_EVAL, TONE } from '@/lib/domain';
import type { FormOptions } from '@/lib/data/options';
import type { RequirementView } from '@/lib/data/watch';
import { evaluateRequirement, saveRequirement } from '@/server/watch';
import { Facts, ViewSwitch, muted, rowOpener } from './parts';

type Opts = Pick<FormOptions, 'people' | 'origins' | 'sites'>;
type Featured = { id: number; text: string } | null;

const EVALS = Object.entries(REQUIREMENT_EVAL);
const EVAL_OPTIONS = EVALS.map(([k, v]) => [k, v.label] as const);
const NEEDS_ACTION = new Set(['ecart', 'analyse']);

// ─── Tableau des exigences ──────────────────────────────────────────────────

export function RequirementsPanel({ rows, canManage, options, today, initialId, closeHref }: {
  rows: RequirementView[];
  canManage: boolean;
  options: Opts;
  today: string;
  /** Exigence à ouvrir d'emblée (lien profond `?exigence=<id>`). */
  initialId?: number;
  /** URL sans le lien profond, rétablie à la fermeture. */
  closeHref?: string;
}) {
  const router = useRouter();
  const [selId, setSelId] = useState<number | null>(initialId ?? null);
  const sel = rows.find((r) => r.id === selId) ?? null;
  const featured = rows.find((r) => r.featured);
  const close = () => {
    setSelId(null);
    if (closeHref) router.replace(closeHref, { scroll: false });
  };

  return (
    <div className="card" style={{ padding: '6px 14px 10px' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 980 }}>
          <thead><tr><th>Texte</th><th>Domaine</th><th>Ce qu&apos;il exige</th><th>Échéance</th><th>Évaluation</th><th>Pilote</th><th>Action</th></tr></thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>Aucune exigence suivie pour l&apos;instant.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} {...rowOpener(() => setSelId(r.id))}>
                <td style={{ fontWeight: 500, minWidth: 160 }}>
                  {r.text}
                  {r.featured && (
                    <span title="Mise en avant sur le tableau de bord" style={{ marginLeft: 6, color: 'var(--color-accent)', verticalAlign: 'middle' }}>
                      <Icon name="ph-push-pin" size={12} />
                    </span>
                  )}
                </td>
                <td style={{ color: 'var(--color-neutral-400)', minWidth: 130 }}>{r.domain}</td>
                <td style={{ color: 'var(--color-neutral-300)', maxWidth: 340, textWrap: 'pretty' }}>{r.summary}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.due || '—'}</td>
                <td>
                  <ToneTag tone={r.tone} style={{ whiteSpace: 'nowrap' }}>{r.evalLabel}</ToneTag>
                  {r.lastEvaluated && (
                    <div style={{ ...muted, marginTop: 3, whiteSpace: 'nowrap' }}>
                      {r.evaluation === 'a_evaluer' ? 'Revue le' : 'Évaluée le'} {r.lastEvaluated}
                    </div>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.pilot || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {r.actionId ? (
                    <>
                      <Link href={`/actions?action=${r.actionId}`} className="vg-link">{r.actionId}</Link>
                      {r.action && <div style={{ ...muted, marginTop: 2, color: r.action.late ? TONE.danger.dot : muted.color }}>{r.action.statusLabel}</div>}
                    </>
                  ) : r.needsAction ? (
                    <span style={{ color: TONE.danger.dot }}>À définir</span>
                  ) : (
                    <span style={{ color: 'var(--color-neutral-600)' }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!sel} onClose={close} width={660}
        kicker={sel ? `Veille réglementaire · ${sel.domain}` : undefined} title={sel?.text ?? ''}>
        {sel && (
          <RequirementDetail key={sel.id} r={sel} canManage={canManage} options={options} today={today}
            featured={featured && featured.id !== sel.id ? { id: featured.id, text: featured.text } : null} onClose={close} />
        )}
      </Dialog>
    </div>
  );
}

/** Bouton « Ajouter une exigence ». */
export function AddRequirementButton({ options, featured }: { options: Opts; featured: Featured }) {
  return (
    <DialogButton label="Ajouter une exigence" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Nouvelle exigence" kicker="Veille réglementaire" width={660}>
      {(close) => <RequirementForm options={options} featured={featured} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

// ─── Fiche d'une exigence ───────────────────────────────────────────────────

function RequirementDetail({ r, canManage, options, today, featured, onClose }: {
  r: RequirementView; canManage: boolean; options: Opts; today: string; featured: Featured; onClose: () => void;
}) {
  const [view, setView] = useState<'fiche' | 'evaluer'>('fiche');
  // « Créer l'action » s'affiche dans cette fenêtre, à la place du formulaire de la fiche : une fenêtre
  // NewActionButton imbriquée dupliquerait les identifiants de champs de la fiche (pilotId, dueOn).
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<'evaluated' | 'action' | null>(null);
  const show = (v: 'fiche' | 'evaluer') => { setNotice(null); setView(v); };

  return (
    <>
      <Facts items={[
        ['Évaluation', <ToneTag key="e" tone={r.tone} style={{ marginTop: 1 }}>{r.evalLabel}</ToneTag>],
        ['Dernière évaluation', r.lastEvaluated ?? (r.evaluation === 'a_evaluer' ? 'Jamais évaluée' : 'Non datée')],
        ['Échéance', r.due || '—'],
        ['Pilote', r.pilot || '—'],
        r.keystoneProjects != null && ['Projets Keystone', `${r.keystoneProjects} concerné${r.keystoneProjects > 1 ? 's' : ''}`],
        r.featured && ['Tableau de bord', <span key="f" style={{ color: 'var(--color-accent)' }}><Icon name="ph-push-pin" size={12} /> À la une</span>],
      ]} />

      {notice && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: TONE.ok.fg }}>
          <Icon name="ph-check-circle" size={15} style={{ color: TONE.ok.dot }} />
          {notice === 'action' ? "Action créée et rattachée à l'exigence." : `Évaluation enregistrée le ${fmtDate(today)}.`}
        </div>
      )}

      <LinkedAction r={r} onCreate={canManage && !creating ? () => { setNotice(null); setCreating(true); } : undefined} />

      {canManage && creating ? (
        <>
          <div className="vg-eyebrow">Nouvelle action · plan d&apos;actions unique</div>
          {/* Rendu sur un état local seulement : l'action liée arrive avec le même rafraîchissement que le succès du formulaire. */}
          <ActionFields options={options} defaults={actionDefaults(r, today)}
            onCancel={() => setCreating(false)} onDone={() => { setCreating(false); setView('fiche'); setNotice('action'); }} />
        </>
      ) : canManage ? (
        <>
          <ViewSwitch name={`requirement-view-${r.id}`} value={view} onChange={show}
            options={[['fiche', 'Fiche', 'ph-pencil-simple'], ['evaluer', 'Évaluer', 'ph-seal-check']]} />
          {/* Pas de `key` dérivée des données : l'enregistrement les modifie et remonterait le formulaire avant son onDone. */}
          {view === 'fiche' ? (
            <RequirementForm r={r} options={options} featured={featured} onDone={onClose} onCancel={onClose} />
          ) : (
            <EvaluateForm r={r} today={today} onCancel={onClose}
              onDone={(evaluation) => { if (NEEDS_ACTION.has(evaluation) && !r.actionId) setNotice('evaluated'); else onClose(); }} />
          )}
        </>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <div className="vg-eyebrow" style={{ marginBottom: 4 }}>Ce qu&apos;il exige</div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>{r.summary}</p>
          </div>
          {r.impact && (
            <div>
              <div className="vg-eyebrow" style={{ marginBottom: 4 }}>Impact</div>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>{r.impact}</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Action liée (lecture seule) ou « Créer l'action » pour un écart ou une analyse d'écart. */
function LinkedAction({ r, onCreate }: { r: RequirementView; onCreate?: () => void }) {
  const box = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 12px', fontSize: 12.5 } as const;
  if (r.actionId) {
    return (
      <div className="vg-inset" style={box}>
        <Icon name="ph-list-checks" size={15} style={{ color: 'var(--color-accent)' }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ color: 'var(--color-neutral-500)' }}>Action liée </span>
          <Link href={`/actions?action=${r.actionId}`} className="vg-link" style={{ fontSize: 12.5 }}>{r.actionId}</Link>
          {r.action && <span> · {r.action.title}</span>}
          {r.action && <span style={{ ...muted, display: 'block', color: r.action.late ? TONE.danger.dot : muted.color }}>Échéance {r.action.due}</span>}
        </span>
        {r.action && <ToneTag tone={r.action.tone} style={{ whiteSpace: 'nowrap' }}>{r.action.statusLabel}</ToneTag>}
      </div>
    );
  }
  if (!NEEDS_ACTION.has(r.evaluation)) return null;
  return (
    <div className="vg-inset" style={{ ...box, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${TONE.danger.dot} 45%, transparent)` }}>
      <Icon name="ph-warning-circle" size={15} style={{ color: TONE.danger.dot }} />
      <span style={{ flex: 1, minWidth: 180, textWrap: 'pretty' }}>
        {r.evaluation === 'ecart'
          ? "Écart sans action de mise en conformité dans le plan d'actions."
          : "Analyse d'écart à suivre dans le plan d'actions."}
      </span>
      {onCreate && (
        <button type="button" className="btn btn-primary vg-btn-sm" onClick={onCreate}>
          <Icon name="ph-plus" size={13} />Créer l&apos;action
        </button>
      )}
    </div>
  );
}

/** Titre « verbe d'action + objet » : Analyser l'écart / Traiter l'écart « constat » / Mettre en conformité : texte. */
function actionDefaults(r: RequirementView, today: string): ActionDefaults {
  const note = r.evaluationNote ? ` « ${r.evaluationNote} »` : '';
  const verb = r.evaluation === 'analyse' ? "Analyser l'écart" : note ? "Traiter l'écart" : 'Mettre en conformité';
  return {
    title: `${verb}${note} : ${r.text}`.slice(0, 200),
    origin: 'watch',
    originRef: r.text.slice(0, 120),
    lockOrigin: true,
    link: `requirement:${r.id}`,
    pilotId: r.pilotId ?? undefined,
    dueOn: r.dueOn && r.dueOn > today ? r.dueOn : addDays(today, 30),
    kind: r.evaluation === 'ecart' ? 'C' : 'P',
    siteId: null,
  };
}

// ─── Formulaires ────────────────────────────────────────────────────────────

function RequirementForm({ r, options, featured, onDone, onCancel }: {
  r?: RequirementView; options: Opts; featured: Featured; onDone: () => void; onCancel: () => void;
}) {
  return (
    <ActionForm action={saveRequirement} hidden={{ id: r?.id }} onDone={onDone} onCancel={onCancel} submitLabel={r ? 'Enregistrer' : "Ajouter l'exigence"}>
      <FormRow>
        <Field name="text" label="Texte">
          <Input name="text" defaultValue={r?.text} placeholder="Ex. Code du travail — R. 4512-6" maxLength={120} autoFocus={!r} />
        </Field>
        <Field name="domain" label="Domaine">
          <Input name="domain" defaultValue={r?.domain} placeholder="Ex. Plans de prévention" maxLength={120} />
        </Field>
      </FormRow>
      <Field name="summary" label="Ce qu'il exige">
        <TextArea name="summary" defaultValue={r?.summary} rows={3} maxLength={1000} placeholder="Obligations concrètes pour l'entreprise." />
      </Field>
      <FormRow>
        <Field name="dueOn" label="Échéance" hint="Date d'application ou de mise en conformité.">
          <Input name="dueOn" type="date" defaultValue={r?.dueOn ?? ''} />
        </Field>
        <Field name="dueNote" label="Note d'échéance" hint="Ex. Permanent, audit de suivi.">
          <Input name="dueNote" defaultValue={r?.dueNote ?? ''} maxLength={60} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="evaluation" label="Évaluation">
          <Select name="evaluation" options={EVAL_OPTIONS} defaultValue={r?.evaluation ?? 'a_evaluer'} />
        </Field>
        <Field name="evaluationNote" label="Précision" hint="Affichée avec l'évaluation.">
          <Input name="evaluationNote" defaultValue={r?.evaluationNote ?? ''} placeholder="Ex. 2 interventions sans plan signé" maxLength={160} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="pilotId" label="Pilote">
          <Select name="pilotId" options={options.people} defaultValue={r?.pilotId ?? ''} placeholder="Non désigné" />
        </Field>
        <Field name="keystoneProjects" label="Projets Keystone concernés" hint="Nombre de projets en cours touchés.">
          <Input name="keystoneProjects" type="number" min={0} max={999} step={1} inputMode="numeric" defaultValue={r?.keystoneProjects ?? ''} />
        </Field>
      </FormRow>
      <Field name="impact" label="Impact" hint="Suite de la phrase du tableau de bord « Applicable au …, dans … jours : … ».">
        <TextArea name="impact" defaultValue={r?.impact ?? ''} rows={2} maxLength={300} placeholder="Ex. toute machine mise sur le marché après cette date doit y être conforme." style={{ minHeight: 56 }} />
      </Field>
      <div style={{ display: 'grid', gap: 4 }}>
        <Checkbox name="featured" label="Mettre en avant sur le tableau de bord" defaultChecked={r?.featured} />
        <span style={{ ...muted, paddingLeft: 24 }}>
          {r?.featured
            ? 'Exigence actuellement à la une.'
            : featured
              ? `Une seule exigence à la une : la cocher retire « ${featured.text} » du tableau de bord.`
              : 'Une seule exigence à la une ; une échéance datée est nécessaire.'}
        </span>
      </div>
    </ActionForm>
  );
}

function EvaluateForm({ r, today, onDone, onCancel }: { r: RequirementView; today: string; onDone: (evaluation: string) => void; onCancel: () => void }) {
  const [evaluation, setEvaluation] = useState(r.evaluation);
  return (
    <ActionForm action={evaluateRequirement} hidden={{ id: r.id }} onDone={() => onDone(evaluation)} onCancel={onCancel}
      submitLabel="Enregistrer l'évaluation" submitIcon="ph-seal-check">
      <div>
        <div className="vg-eyebrow" style={{ marginBottom: 4 }}>Ce qu&apos;il exige</div>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>{r.summary}</p>
      </div>
      {/* Pas de `name` : le libellé ne vise aucun champ unique, le groupe radio porte son propre aria-label. */}
      <Field label="Évaluation de conformité">
        <div role="radiogroup" aria-label="Évaluation de conformité" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {EVALS.map(([k, v]) => (
            <label key={k} className="seg-opt" style={{ fontSize: 12, padding: '5px 10px', border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)' }}>
              <input type="radio" name="evaluation" value={k} checked={evaluation === k} onChange={() => setEvaluation(k)} />
              <Dot color={TONE[v.tone].dot} />{v.label}
            </label>
          ))}
        </div>
      </Field>
      <Field name="evaluationNote" label="Précision" hint="Facultatif — constat, écart relevé, référence de la preuve.">
        <Input name="evaluationNote" defaultValue={r.evaluationNote ?? ''} maxLength={160} placeholder="Ex. VGP pont roulant dépassée" />
      </Field>
      <span style={muted}>
        {`Évaluation datée du ${fmtDate(today)}${r.lastEvaluated ? ` · précédente le ${r.lastEvaluated}` : ''}.`}
        {NEEDS_ACTION.has(evaluation) && !r.actionId ? " Un écart ou une analyse d'écart se suit par une action du plan d'actions unique." : ''}
      </span>
    </ActionForm>
  );
}
