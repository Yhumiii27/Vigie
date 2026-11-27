'use client';

import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import Link from 'next/link';
import { Dialog } from '@/components/Dialog';
import { ToneTag } from '@/components/ui';
import { RISK_ACTION_THRESHOLD, RISK_FLAGS, TONE } from '@/lib/domain';
import type { ActionFormOptions } from '@/lib/action-view';
import type { MeasureOptions, RiskView, RisksData, WorkUnitView } from '@/lib/data/risks';
import { Cotation } from './RiskForm';
import { RiskSheet, actionColor, riskSheetHeading, type RiskSheetView } from './RiskSheet';
import { Tip, TipText } from '@/components/Tip';
import { useI18n } from '@/i18n/client';
import { labelT } from '@/i18n/labels';
import { fill } from '@/i18n/translate';

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
export function RiskTable({ rows, unit, units, canManage, actionsQhse = false, showEvents = true, showHistory = true, options, linkableActions, measureOptions, initialRiskId }: {
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
  /** DUE-19 : éléments proposés comme mesure de maîtrise (rôles qui modifient le DUERP). */
  measureOptions?: MeasureOptions;
  /** Lien profond ?risque=<id> : fiche ouverte au chargement. */
  initialRiskId?: number;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<OpenState | null>(initialRiskId != null && rows.some((r) => r.id === initialRiskId) ? { id: initialRiskId, view: 'sheet' } : null);
  const index = open ? rows.findIndex((r) => r.id === open.id) : -1;
  const current = index >= 0 ? rows[index] : null;
  const close = () => setOpen(null);
  const onView = (view: RiskSheetView | null) => {
    if (!view || (open?.direct && open.view === 'newAction' && view === 'sheet')) close();
    else setOpen((o) => o && { id: o.id, view });
  };
  const show = (r: RiskView) => setOpen({ id: r.id, view: 'sheet' });
  const heading = current && open ? riskSheetHeading(t, current, unit, open.view) : null;
  return (
    <>
      <table className="table" style={{ fontSize: 12.5, minWidth: 760 }}>
        <thead><tr><th>{t('Hazard')}</th><th>{t('Hazardous situation')}</th><th>{t('Gross rating')}</th><th>{t('Existing measures')}</th><th>{t('Residual risk')}</th><th>{t('Actions')}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            // DUE-16 : la ligne reste cliquable à la souris ; au clavier et pour les lecteurs d'écran, le danger est un bouton
            // nommé qui ouvre la fiche (plus de ligne focalisable sans rôle).
            <tr key={r.id} className="is-clickable" onClick={(e) => { if (!fromControl(e) && !selectingText()) show(r); }}>
              <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>
                <button type="button" className="vg-text-btn" style={{ fontWeight: 500, fontSize: 12.5, color: 'inherit', textAlign: 'left' }} onClick={() => show(r)}>
                  {r.hazard}<span className="vg-sr-only">{t(': open the risk sheet')}</span>
                </button>
              </td>
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
                  {r.flag === 'toDefine' && <TipText tip={labelT(t)(RISK_FLAGS.toDefine.hint)}><span style={{ color: TONE.danger.dot }}>{t('To be defined')}</span></TipText>}
                  {r.flag === 'residualHigh' && <TipText tip={labelT(t)(RISK_FLAGS.residualHigh.hint)}><span style={{ color: TONE.danger.dot }}>{fill(t('Residual ≥ {n}'), { n: RISK_ACTION_THRESHOLD })}</span></TipText>}
                  {r.flag === 'toReview' && <TipText tip={labelT(t)(RISK_FLAGS.toReview.hint)}><ToneTag tone="warn" style={{ fontSize: 11 }}>{t('To re-rate')}</ToneTag></TipText>}
                  {!r.actions.length && !r.flag && <span style={{ color: 'var(--vg-text-muted)' }}>—</span>}
                  {canManage && actionsQhse && (
                    <button type="button" className="vg-text-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                      title={t('New reduction action linked to the risk')} onClick={() => setOpen({ id: r.id, view: 'newAction', direct: true })}>
                      <i className="ph ph-plus" style={{ fontSize: 13 }} aria-hidden />{t('Action')}
                    </button>
                  )}
                </span>
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={6} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>
              {canManage ? t('No risk assessed for this unit: use “Add a risk” to start the assessment.') : t('No risk assessed for this unit.')}
            </td></tr>
          )}
        </tbody>
      </table>
      {/* Fenêtre rendue hors du tableau : dans la ligne cliquable, elle hériterait de son curseur et de son survol. */}
      <Dialog open={!!current} onClose={close} title={heading?.title ?? ''} kicker={heading?.kicker} width={open?.view === 'newAction' ? 560 : 640}>
        {current && open && (
          <RiskSheet key={`${current.id}:${open.view}`} risk={current} unit={unit} units={units} canManage={canManage} showEvents={showEvents} showHistory={showHistory} options={options}
            actionsQhse={actionsQhse} linkableActions={linkableActions} measureOptions={measureOptions} isFirst={index === 0} isLast={index === rows.length - 1}
            view={canManage && (actionsQhse || (open.view !== 'newAction' && open.view !== 'link')) ? open.view : 'sheet'} onView={onView} onClose={close} />
        )}
      </Dialog>
    </>
  );
}
