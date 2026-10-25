'use client';

import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import Link from 'next/link';
import { Dialog } from '@/components/Dialog';
import { ToneTag } from '@/components/ui';
import { RISK_ACTION_THRESHOLD, RISK_FLAGS, TONE } from '@/lib/domain';
import type { ActionFormOptions } from '@/lib/action-view';
import type { RiskView, RisksData, WorkUnitView } from '@/lib/data/risks';
import { Cotation } from './RiskForm';
import { RiskSheet, actionColor, riskSheetHeading, type RiskSheetView } from './RiskSheet';
import { Tip, TipText } from '@/components/Tip';

type Unit = Pick<WorkUnitView, 'id' | 'label' | 'site' | 'siteId' | 'originRef'>;

/** Les clics sur un lien, un bouton ou une fenêtre ouverte depuis la ligne n'ouvrent pas la fiche du risque. */
const fromControl = (e: MouseEvent | KeyboardEvent) => !!(e.target as HTMLElement).closest('a, button, dialog, input, select, textarea, label');
/** Une sélection de texte dans la ligne (copier une mesure, un danger) n'ouvre pas la fiche. */
const selectingText = () => !!window.getSelection()?.toString();

/** Ligne de tableau qui ouvre la fiche d'un risque (clic, Entrée ou Espace), sauf depuis un lien, un bouton ou une sélection de texte. */
export function rowOpener(open: () => void) {
  return {
    className: 'is-clickable',
    tabIndex: 0,
    onClick: (e: MouseEvent<HTMLTableRowElement>) => { if (!fromControl(e) && !selectingText()) open(); },
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); open(); } },
  };
}

/** Fiche ouverte : risque, vue, et `direct` quand « + Action » a ouvert directement la nouvelle action (fermeture au retour). */
type OpenState = { id: number; view: RiskSheetView; direct?: boolean };

/** Tableau des risques de l'unité ; un clic sur une ligne ouvre la fiche du risque (lecture pour tous, modification pour l'encadrement). */
export function RiskTable({ rows, unit, units, canManage, actionsQhse = false, showEvents = true, showHistory = true, options, linkableActions, initialRiskId }: {
  rows: RiskView[];
  unit: Unit;
  units: Pick<WorkUnitView, 'id' | 'label' | 'site'>[];
  canManage: boolean;
  /** Service QHSE : « + Action », nouvelle action et rattachement depuis la fiche (ACT-22). */
  actionsQhse?: boolean;
  /** Événements liés dans la fiche (masqués pour le Salarié). */
  showEvents?: boolean;
  /** Historique dans la fiche (rôles qui modifient le DUERP). */
  showHistory?: boolean;
  options: ActionFormOptions;
  linkableActions: RisksData['linkableActions'];
  /** Lien profond ?risque=<id> : fiche ouverte au chargement. */
  initialRiskId?: number;
}) {
  const [open, setOpen] = useState<OpenState | null>(initialRiskId != null && rows.some((r) => r.id === initialRiskId) ? { id: initialRiskId, view: 'sheet' } : null);
  const index = open ? rows.findIndex((r) => r.id === open.id) : -1;
  const current = index >= 0 ? rows[index] : null;
  const close = () => setOpen(null);
  const onView = (view: RiskSheetView | null) => {
    if (!view || (open?.direct && open.view === 'newAction' && view === 'sheet')) close();
    else setOpen((o) => o && { id: o.id, view });
  };
  const show = (r: RiskView) => setOpen({ id: r.id, view: 'sheet' });
  const heading = current && open ? riskSheetHeading(current, unit, open.view) : null;
  return (
    <>
      <table className="table" style={{ fontSize: 12.5, minWidth: 760 }}>
        <thead><tr><th>Danger</th><th>Situation dangereuse</th><th>Cotation brute</th><th>Mesures existantes</th><th>Risque résiduel</th><th>Actions</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} {...rowOpener(() => show(r))}>
              <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{r.hazard}</td>
              <td style={{ color: 'var(--color-neutral-300)' }}>{r.situation}</td>
              <td><Cotation g={r.gravity} p={r.probability} /></td>
              <td style={{ color: 'var(--color-neutral-300)' }}>{r.existingMeasures || '—'}</td>
              <td><Cotation g={r.residualGravity} p={r.residualProbability} /></td>
              <td>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                  {r.actions.map((a) => (
                    <Tip key={a.id} tip={`${a.title} · ${a.status}`}>
                      {(described) => (
                        <Link href={`/actions?action=${encodeURIComponent(a.id)}`} className="vg-link" {...described}
                          style={{ fontSize: 12.5, color: actionColor(a), textDecoration: a.cancelled ? 'line-through' : undefined }}>{a.id}</Link>
                      )}
                    </Tip>
                  ))}
                  {r.flag === 'toDefine' && <TipText tip={RISK_FLAGS.toDefine.hint}><span style={{ color: TONE.danger.dot }}>À définir</span></TipText>}
                  {r.flag === 'residualHigh' && <TipText tip={RISK_FLAGS.residualHigh.hint}><span style={{ color: TONE.danger.dot }}>Résiduel ≥ {RISK_ACTION_THRESHOLD}</span></TipText>}
                  {r.flag === 'toReview' && <TipText tip={RISK_FLAGS.toReview.hint}><ToneTag tone="warn" style={{ fontSize: 11 }}>À recoter</ToneTag></TipText>}
                  {!r.actions.length && !r.flag && <span style={{ color: 'var(--vg-text-muted)' }}>—</span>}
                  {canManage && actionsQhse && (
                    <button type="button" className="vg-text-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                      title="Nouvelle action de réduction rattachée au risque" onClick={() => setOpen({ id: r.id, view: 'newAction', direct: true })}>
                      <i className="ph ph-plus" style={{ fontSize: 13 }} aria-hidden />Action
                    </button>
                  )}
                </span>
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={6} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>
              Aucun risque évalué pour cette unité{canManage ? " : utilisez « Ajouter un risque » pour commencer l'évaluation." : '.'}
            </td></tr>
          )}
        </tbody>
      </table>
      {/* Fenêtre rendue hors du tableau : dans la ligne cliquable, elle hériterait de son curseur et de son survol. */}
      <Dialog open={!!current} onClose={close} title={heading?.title ?? ''} kicker={heading?.kicker} width={open?.view === 'newAction' ? 560 : 640}>
        {current && open && (
          <RiskSheet key={`${current.id}:${open.view}`} risk={current} unit={unit} units={units} canManage={canManage} showEvents={showEvents} showHistory={showHistory} options={options}
            actionsQhse={actionsQhse} linkableActions={linkableActions} isFirst={index === 0} isLast={index === rows.length - 1}
            view={canManage && (actionsQhse || (open.view !== 'newAction' && open.view !== 'link')) ? open.view : 'sheet'} onView={onView} onClose={close} />
        )}
      </Dialog>
    </>
  );
}
