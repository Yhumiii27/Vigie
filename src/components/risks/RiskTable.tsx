'use client';

import { useState, useTransition, type KeyboardEvent, type MouseEvent } from 'react';
import Link from 'next/link';
import { Dialog } from '@/components/Dialog';
import { ActionFields } from '@/components/ActionFormDialog';
import { RISK_ACTION_THRESHOLD, TONE } from '@/lib/domain';
import type { FormOptions } from '@/lib/data/options';
import type { LinkedAction, RiskView, WorkUnitView } from '@/lib/data/risks';
import { deleteRisk } from '@/server/risks';
import { Cotation, RiskFields } from './RiskForm';

type Unit = Pick<WorkUnitView, 'id' | 'label' | 'site' | 'siteId' | 'originRef'>;
type Options = Pick<FormOptions, 'people' | 'origins' | 'sites'>;

/** Les clics sur un lien, un bouton ou une fenêtre ouverte depuis la ligne n'ouvrent pas la fiche du risque. */
const fromControl = (e: MouseEvent | KeyboardEvent) => !!(e.target as HTMLElement).closest('a, button, dialog, input, select, textarea, label');
/** Une sélection de texte dans la ligne (copier une mesure, un danger) n'ouvre pas la fiche. */
const selectingText = () => !!window.getSelection()?.toString();

function actionColor(a: LinkedAction) {
  if (a.late) return TONE.danger.fg;
  if (a.done) return TONE.ok.fg;
  return 'var(--color-accent)';
}

/** Tableau des risques de l'unité ; un clic sur une ligne ouvre la fiche (modification, suppression). */
export function RiskTable({ rows, unit, units, canManage, options }: {
  rows: RiskView[];
  unit: Unit;
  units: Pick<WorkUnitView, 'id' | 'label' | 'site'>[];
  canManage: boolean;
  options: Options;
}) {
  const [editing, setEditing] = useState<RiskView | null>(null);
  // Fenêtre « Créer l'action » rendue hors du tableau : dans la ligne cliquable, elle hériterait de son curseur et de son survol.
  const [creating, setCreating] = useState<RiskView | null>(null);
  const close = () => setEditing(null);
  const closeCreate = () => setCreating(null);
  return (
    <>
      <table className="table" style={{ fontSize: 12.5, minWidth: 760 }}>
        <thead><tr><th>Danger</th><th>Situation dangereuse</th><th>Cotation brute</th><th>Mesures existantes</th><th>Risque résiduel</th><th>Actions</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const b = r.gravity * r.probability;
            const needs = b >= RISK_ACTION_THRESHOLD;
            return (
              <tr key={r.id} className={canManage ? 'is-clickable' : undefined} tabIndex={canManage ? 0 : undefined}
                onClick={canManage ? (e) => { if (!fromControl(e) && !selectingText()) setEditing(r); } : undefined}
                onKeyDown={canManage ? (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); setEditing(r); } } : undefined}>
                <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{r.hazard}</td>
                <td style={{ color: 'var(--color-neutral-300)' }}>{r.situation}</td>
                <td><Cotation g={r.gravity} p={r.probability} /></td>
                <td style={{ color: 'var(--color-neutral-300)' }}>{r.existingMeasures || '—'}</td>
                <td><Cotation g={r.residualGravity} p={r.residualProbability} /></td>
                <td>
                  {r.actions.length ? (
                    <span style={{ display: 'inline-flex', gap: 6, whiteSpace: 'nowrap' }}>
                      {r.actions.map((a) => (
                        <Link key={a.id} href={`/actions?action=${encodeURIComponent(a.id)}`} className="vg-link" title={`${a.title} · ${a.status}`} style={{ fontSize: 12.5, color: actionColor(a) }}>{a.id}</Link>
                      ))}
                    </span>
                  ) : needs ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: TONE.danger.dot, whiteSpace: 'nowrap' }}>À définir</span>
                      {canManage && (
                        <button type="button" className="vg-text-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }} onClick={() => setCreating(r)}>
                          <i className="ph ph-plus" style={{ fontSize: 13 }} />Créer l&apos;action
                        </button>
                      )}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--color-neutral-600)' }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr><td colSpan={6} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>
              Aucun risque évalué pour cette unité{canManage ? " : utilisez « Ajouter un risque » pour commencer l'évaluation." : '.'}
            </td></tr>
          )}
        </tbody>
      </table>
      <Dialog open={!!editing} onClose={close} title={editing?.hazard ?? ''} kicker={`Modifier le risque · ${unit.label}`} width={600}>
        {editing && <RiskEditor key={editing.id} risk={editing} units={units} onClose={close} />}
      </Dialog>
      {/* Même fenêtre que NewActionButton (titre, largeur, formulaire), rattachée au risque par link=risk:<id>. */}
      <Dialog open={!!creating} onClose={closeCreate} title="Nouvelle action" kicker="Plan d'actions unique" width={560}>
        {creating && (
          <ActionFields key={creating.id} options={options} onDone={closeCreate} onCancel={closeCreate}
            defaults={{
              origin: 'risk', originRef: unit.originRef, lockOrigin: true, siteId: unit.siteId, kind: 'P', link: `risk:${creating.id}`,
              description: `Risque « ${creating.hazard} » : ${creating.situation} (cotation brute G${creating.gravity} × P${creating.probability} = ${creating.gravity * creating.probability}).`,
            }} />
        )}
      </Dialog>
    </>
  );
}

/** Fiche d'un risque : formulaire de modification, puis confirmation de suppression. */
function RiskEditor({ risk, units, onClose }: { risk: RiskView; units: Pick<WorkUnitView, 'id' | 'label' | 'site'>[]; onClose: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (confirming) {
    const ids = risk.actions.map((a) => a.id).join(', ');
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <p className="dialog-body" style={{ margin: 0, fontSize: 13, textWrap: 'pretty' }}>
          Supprimer définitivement le risque « {risk.hazard} » ({risk.situation}) ?
          {ids && <> Le rattachement {risk.actions.length > 1 ? 'aux actions' : "à l'action"} {ids} sera retiré ; {risk.actions.length > 1 ? 'elles restent' : 'elle reste'} dans le plan d&apos;actions.</>}
          {' '}Les versions archivées du DUERP ne sont pas modifiées.
        </p>
        {error && <div role="alert" className="vg-form-error">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={() => { setConfirming(false); setError(null); }} disabled={pending}>Annuler</button>
          <button type="button" className="btn" style={{ color: TONE.danger.fg, borderColor: TONE.danger.dot }} disabled={pending}
            onClick={() => start(async () => { const r = await deleteRisk(risk.id); if (r.error) setError(r.error); else onClose(); })}>
            <i className="ph ph-trash" style={{ fontSize: 14 }} />{pending ? 'Suppression…' : 'Supprimer le risque'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <RiskFields units={units} defaults={risk} onDone={onClose} onCancel={onClose} />
      <button type="button" className="btn btn-ghost" style={{ position: 'absolute', left: 0, bottom: 0, color: TONE.danger.fg }} onClick={() => setConfirming(true)}>
        <i className="ph ph-trash" style={{ fontSize: 14 }} />Supprimer
      </button>
    </div>
  );
}
