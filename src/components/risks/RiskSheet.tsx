'use client';

import { useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { newEventHref } from '@/lib/event-prefill';
import { ActionFields } from '@/components/ActionFormDialog';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { EntityFiles } from '@/components/EntityFiles';
import { LinkActionButton, LinkActionForm } from '@/components/LinkActionButton';
import { ReasonForm } from '@/components/ReasonDialog';
import { ActionForm, Field, Select } from '@/components/form';
import { ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { admissibleSources } from '@/lib/action-rules';
import type { ActionDefaults, ActionFormOptions } from '@/lib/action-view';
import { EVENT_TYPES, MEASURE_LINK_KINDS, MEASURE_LINK_KIND_KEYS, RISK_FLAGS, TONE, proposedDomain, type EventType, type MeasureLinkKind } from '@/lib/domain';
import type { ArchiveInfo, LinkedAction, MeasureOptions, RiskView, RisksData, WorkUnitView } from '@/lib/data/risks';
import { archiveRisk, confirmResidual, linkRiskMeasure, moveRisk, removeRiskMeasure, restoreRisk } from '@/server/risks';
import { Cotation, RiskFields } from './RiskForm';
import { useI18n } from '@/i18n/client';
import { labelT } from '@/i18n/labels';
import { fill, type T } from '@/i18n/translate';

export type RiskSheetView = 'sheet' | 'edit' | 'newAction' | 'link' | 'archive' | 'restore';
type Unit = Pick<WorkUnitView, 'id' | 'label' | 'site' | 'siteId' | 'originRef'>;
/** Couleur de l'avancement d'une action liée (tableau et fiche) : Abandonnée grisée, sinon ton de l'avancement (« En retard » : danger). */
export function actionColor(a: LinkedAction) {
  if (a.cancelled) return 'var(--color-neutral-500)';
  if (a.late) return TONE.danger.fg;
  if (a.done) return TONE.ok.fg;
  return a.tone === 'neutral' || a.tone === 'accent' ? 'var(--color-accent)' : TONE[a.tone].fg;
}

/**
 * Valeurs proposées à la création d'une action depuis un risque (ACT-28) : source DUERP imposée (D20), risque lié, domaine
 * Sécurité (modifiable), problème = description du risque à la date du jour, site de l'unité (« Tous les sites » : le
 * service QHSE choisit). Le niveau de risque de l'action n'est pas déduit de la cotation (échelles distinctes, § 5.4).
 */
export function riskActionDefaults(risk: Pick<RiskView, 'id' | 'hazard' | 'situation' | 'gravity' | 'probability'>, unit: Pick<Unit, 'siteId' | 'originRef'>): ActionDefaults {
  const [source] = admissibleSources('risk');
  return {
    source, lockSource: true, link: `risk:${risk.id}`, linkLabel: risk.hazard, originRef: unit.originRef,
    domain: proposedDomain({ source }) ?? 'securite',
    problem: `Risque « ${risk.hazard} » : ${risk.situation} (cotation brute G${risk.gravity} × P${risk.probability} = ${risk.gravity * risk.probability}).`,
    siteId: unit.siteId ?? undefined,
  };
}

/** « Archivé le 30/06/2026 par Claire Lefèvre » (risque), « Archivée le … » (unité), « Annulée le … » (demande d'accès). */
export const archivedLabel = (t: T, a: ArchiveInfo, kind: 'risk' | 'unit' | 'cancelled' = 'risk') =>
  `${fill(kind === 'unit' ? t('Unit archived on {date}') : kind === 'cancelled' ? t('Cancelled on {date}') : t('Archived on {date}'), { date: fmtDate(a.on) })}${a.by ? fill(t(' by {by}'), { by: a.by }) : ''}`;

/** Titre et sur-titre de la fenêtre selon la vue de la fiche. */
export function riskSheetHeading(t: T, risk: RiskView, unit: Unit, view: RiskSheetView) {
  if (view === 'newAction') return { title: t('New action'), kicker: `${t('Single action plan')} · ${risk.hazard}` };
  if (view === 'link') return { title: t('Link an existing action'), kicker: `${t('Single action plan')} · ${risk.hazard}` };
  if (view === 'edit') return { title: risk.hazard, kicker: `${t('Edit the risk')} · ${unit.label}` };
  if (view === 'archive') return { title: risk.hazard, kicker: `${t('Archive the risk')} · ${unit.label}` };
  if (view === 'restore') return { title: risk.hazard, kicker: `${t('Restore the risk')} · ${unit.label}` };
  return { title: risk.hazard, kicker: `${risk.archived ? t('Archived risk') : t('Risk')} · ${unit.label}` };
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', paddingTop: 2 }}>{label}</span>
      <div style={{ fontSize: 13, minWidth: 0, textWrap: 'pretty' }}>{children}</div>
    </>
  );
}

/**
 * Fiche d'un risque, dans la fenêtre ouverte depuis le tableau : lecture pour tous les rôles (actions liées ; événements
 * liés sauf pour le Salarié ; historique pour les rôles qui modifient le DUERP) ; pour l'encadrement, modification, ordre,
 * rattachement d'actions, nouvelle action et archivage (jamais de suppression). Un risque archivé est en lecture seule ; l'animateur QHSE et la direction peuvent le restaurer.
 * Une seule fenêtre dont la vue change : pas de fenêtres imbriquées.
 */
export function RiskSheet({ risk, unit, unitArchived = false, units, canManage, canApprove = false, actionsQhse = false, showEvents = true, showHistory = true, options, linkableActions, measureOptions, isFirst, isLast, view, onView, onClose }: {
  risk: RiskView;
  unit: Unit;
  /** Unité du risque archivée : restauration du risque impossible avant celle de l'unité. */
  unitArchived?: boolean;
  units: Pick<WorkUnitView, 'id' | 'label' | 'site'>[];
  canManage: boolean;
  /** Animateur QHSE, direction : restauration d'un risque archivé. */
  canApprove?: boolean;
  /** Service QHSE (canCreateAction) : nouvelle action et rattachement d'une action existante (ACT-22). */
  actionsQhse?: boolean;
  /** Événements liés (masqués pour le Salarié : signalements nominatifs de collègues). */
  showEvents?: boolean;
  /** Historique de la fiche (rôles qui modifient le DUERP). */
  showHistory?: boolean;
  options: ActionFormOptions;
  linkableActions: RisksData['linkableActions'];
  /** DUE-19 : éléments proposés comme mesure de maîtrise (rôles qui modifient le DUERP). */
  measureOptions?: MeasureOptions;
  isFirst: boolean;
  isLast: boolean;
  view: RiskSheetView;
  /** Changement de vue ; `null` = fermer la fenêtre. */
  onView: (view: RiskSheetView | null) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) => start(async () => {
    try {
      const r = await fn();
      setError(r.error ?? null);
      if (!r.error) after?.();
    } catch {
      setError(t('The operation failed. Try again.'));
    }
  });

  if (view === 'edit') {
    return <RiskFields units={units} defaults={risk} reviewPrompt={risk.flag === 'toReview'} onDone={onClose} onCancel={() => onView('sheet')} />;
  }

  if (view === 'newAction') {
    return (
      <ActionFields options={options} onDone={() => onView('sheet')} onCancel={() => onView('sheet')} defaults={riskActionDefaults(risk, unit)} />
    );
  }

  const linkOptions = linkableActions
    .filter((a) => !risk.actions.some((l) => l.id === a.id) && (!unit.siteId || !a.siteId || a.siteId === unit.siteId))
    .map((a) => [a.id, a.label] as const);

  if (view === 'link') {
    return <LinkActionForm link={`risk:${risk.id}`} actions={linkOptions} onDone={() => onView('sheet')} onCancel={() => onView('sheet')} />;
  }

  if (view === 'archive') {
    const open = risk.actions.filter((a) => !a.done && !a.cancelled).map((a) => a.id);
    return (
      <ReasonForm action={archiveRisk} hidden={{ id: risk.id }} submitLabel={t('Archive the risk')} submitIcon="ph-archive"
        placeholder={t('E.g. station removed, risk merged with another, duplicate entry…')} onDone={onClose} onCancel={() => onView('sheet')}
        message={<>
          {fill(t('The risk “{hazard}” ({situation}) will leave the single document in force: table, matrix, deadlines, exports and next snapshot. It stays readable with its history, actions and events through the “Archived” filter.'), { hazard: risk.hazard, situation: risk.situation })}
          {open.length > 0 && <> {fill(open.length > 1 ? t('The actions {ids} stay open in the action plan.') : t('The action {ids} stays open in the action plan.'), { ids: open.join(', ') })}</>}
          {' '}{t('The archived versions of the DUERP are not changed.')}
        </>} />
    );
  }

  if (view === 'restore') {
    return (
      <ReasonForm action={restoreRisk} hidden={{ id: risk.id }} submitLabel={t('Restore the risk')} submitIcon="ph-arrow-counter-clockwise"
        onDone={onClose} onCancel={() => onView('sheet')}
        message={<>{fill(t('The risk “{hazard}” will return to the unit “{unit}” of the single document in force, with its ratings and actions.'), { hazard: risk.hazard, unit: unit.label })}</>} />
    );
  }

  const flag = risk.flag ? RISK_FLAGS[risk.flag] : null;
  const archived = risk.archived;
  const editable = canManage && !archived;
  // Actions QSE : créées et rattachées par le service QHSE seulement (ACT-22).
  const actionable = editable && actionsQhse;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {archived && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)', background: TONE.neutral.bg }}>
          <ToneTag tone="neutral" style={{ flexShrink: 0 }}>{t('Archived')}</ToneTag>
          <span style={{ fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
            {archivedLabel(t, archived)}{t(': outside the single document in force.')}{archived.reason && <> {fill(t('Reason: {reason}'), { reason: archived.reason })}</>}
          </span>
        </div>
      )}
      {flag && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)', background: TONE[flag.tone].bg }}>
          <ToneTag tone={flag.tone} style={{ flexShrink: 0 }}>{labelT(t)(flag.label)}</ToneTag>
          <span style={{ fontSize: 12.5, color: TONE[flag.tone].fg, textWrap: 'pretty' }}>
            {labelT(t)(flag.hint)}{risk.flag === 'toReview' && risk.lastClosedOn ? fill(t(' Last verification on {date}.'), { date: fmtDate(risk.lastClosedOn) }) : ''}
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr)', gap: '8px 12px', alignItems: 'start' }}>
        <Row label={t('Hazard')}>{risk.hazard}</Row>
        <Row label={t('Hazardous situation')}><span style={{ color: 'var(--color-neutral-300)' }}>{risk.situation}</span></Row>
        <Row label={t('Gross rating')}><Cotation g={risk.gravity} p={risk.probability} /></Row>
        <Row label={t('Existing measures')}><span style={{ color: 'var(--color-neutral-300)' }}>{risk.existingMeasures || '—'}</span></Row>
        <Row label={t('Residual risk')}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Cotation g={risk.residualGravity} p={risk.residualProbability} />
            {risk.residualReviewedOn && <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{fill(t('re-rated on {date}'), { date: fmtDate(risk.residualReviewedOn) })}</span>}
          </span>
        </Row>
      </div>

      <section style={{ display: 'grid', gap: 8 }}>
        <div className="vg-eyebrow">{t('Reduction actions')}{risk.actions.length ? ` · ${risk.actions.length}` : ''}</div>
        {risk.actions.length ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {risk.actions.map((a) => (
              <li key={a.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', fontSize: 12.5, opacity: a.cancelled ? 0.6 : 1 }}>
                <Link href={`/actions?action=${encodeURIComponent(a.id)}`} className="vg-link" style={{ fontSize: 12.5, color: actionColor(a), textDecoration: a.cancelled ? 'line-through' : undefined }}>{a.id}</Link>
                <span style={{ flex: 1, minWidth: 160 }}>{a.title}</span>
                {a.cancelled
                  ? <ToneTag tone="neutral">{t('Abandoned')}</ToneTag>
                  : <span style={{ color: actionColor(a), whiteSpace: 'nowrap' }}>{a.status}</span>}
                {a.pilot && <span style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{a.pilot}</span>}
                <span style={{ color: 'var(--color-neutral-500)', whiteSpace: 'nowrap' }}>{a.done && a.closedOn ? fill(t('verified on {date}'), { date: fmtDate(a.closedOn) }) : fill(t('target date {date}'), { date: fmtDate(a.dueOn) })}</span>
                {actionable && <LinkActionButton link={`risk:${risk.id}`} current={a.id} />}
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>{t('No action linked.')}</div>
        )}
        {actionable && (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <button type="button" className="vg-text-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} onClick={() => onView('newAction')}>
              <i className="ph ph-plus" style={{ fontSize: 13 }} aria-hidden />{t('New action')}
            </button>
            {/* Vue de la même fenêtre, pas une seconde fenêtre (Échap fermerait aussi la fiche). */}
            <button type="button" className="vg-text-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} disabled={!linkOptions.length}
              title={linkOptions.length ? undefined : t('No open action to link')} onClick={() => onView('link')}>
              <i className="ph ph-link" style={{ fontSize: 13 }} aria-hidden />{t('Link an existing action')}
            </button>
          </div>
        )}
      </section>

      <MeasuresSection risk={risk} unit={unit} editable={editable && !unitArchived} options={measureOptions} />

      {showEvents && <section style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div className="vg-eyebrow">{t('Linked events')}{risk.events.length ? ` · ${risk.events.length}` : ''}</div>
          {/* EVT-24 : « Nouvel événement » prérempli (site, unité, risque) ; risque en vigueur, rôles qui modifient le DUERP. */}
          {editable && !unitArchived && (
            <Link href={newEventHref('risque', risk.id)} className="vg-link" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <i className="ph ph-warning-diamond" style={{ fontSize: 13 }} aria-hidden />{t('Report an event')}
            </Link>
          )}
        </div>
        {risk.events.length ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {risk.events.map((e) => (
              <li key={e.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
                <Link href={`/evenements?sel=${encodeURIComponent(e.id)}`} className="vg-link" style={{ fontSize: 12.5 }}>{e.id}</Link>
                <ToneTag tone={EVENT_TYPES[e.type as EventType]?.tone ?? 'neutral'}>{e.typeLabel}</ToneTag>
                <span style={{ flex: 1, minWidth: 160 }}>{e.title}</span>
                <span style={{ color: 'var(--color-neutral-500)', whiteSpace: 'nowrap' }}>{fmtDate(e.occurredOn)}</span>
                <span style={{ color: e.closed ? 'var(--color-neutral-500)' : 'var(--color-neutral-300)', whiteSpace: 'nowrap' }}>{e.step}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>{t('No event linked. Linking is done from the event sheet.')}</div>
        )}
      </section>}

      {/* DUE-09 : justificatifs du risque (mesures, mesurages, rapports) ; figés une fois le risque archivé. */}
      <EntityFiles kind="risk" entityId={risk.id} title={t('Supporting documents')} kicker={`${unit.label} · ${risk.hazard}`} files={risk.files}
        canAdd={canManage && !risk.archived && !unitArchived} emptyText={t('No supporting document attached.')} />

      {showHistory && <LazyChangeLog entity="risk" id={risk.id} />}

      {error && <div role="alert" className="vg-form-error">{error}</div>}
      {archived && canApprove && (
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" disabled={unitArchived}
            title={unitArchived ? fill(t('The unit “{unit}” is archived: restore it first.'), { unit: unit.label }) : undefined} onClick={() => onView('restore')}>
            <i className="ph ph-arrow-counter-clockwise" style={{ fontSize: 14 }} aria-hidden />{t('Restore the risk')}
          </button>
        </div>
      )}
      {editable && (
        <div className="dialog-actions" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button type="button" className="btn btn-ghost" style={{ color: 'var(--color-neutral-400)' }} disabled={pending}
              title={t('Remove the risk from the single document in force (reason required, history kept)')}
              onClick={() => { setError(null); onView('archive'); }}>
              <i className="ph ph-archive" style={{ fontSize: 14 }} aria-hidden />{t('Archive')}
            </button>
            <button type="button" className="btn btn-ghost btn-icon" aria-label={t('Move up')} title={t('Move up in the unit')} disabled={isFirst || pending}
              onClick={() => run(() => moveRisk(risk.id, 'up'))}>
              <i className="ph ph-arrow-up" style={{ fontSize: 14 }} aria-hidden />
            </button>
            <button type="button" className="btn btn-ghost btn-icon" aria-label={t('Move down')} title={t('Move down in the unit')} disabled={isLast || pending}
              onClick={() => run(() => moveRisk(risk.id, 'down'))}>
              <i className="ph ph-arrow-down" style={{ fontSize: 14 }} aria-hidden />
            </button>
          </span>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {risk.flag === 'toReview' && (
              <>
                <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => run(() => confirmResidual(risk.id))}>
                  <i className="ph ph-check" style={{ fontSize: 14 }} aria-hidden />{pending ? t('Saving…') : t('Confirm the current residual')}
                </button>
                <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => onView('edit')}>{t('Re-rate the residual')}</button>
              </>
            )}
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => onView('edit')}>
              <i className="ph ph-pencil-simple" style={{ fontSize: 14 }} aria-hidden />{t('Edit')}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * DUE-19 : mesures de maîtrise liées à un contrôle, un document ou une habilitation, avec leur validité calculée ; liaison
 * et retrait (motif) dans la fiche même, sans seconde fenêtre (rôles qui modifient le DUERP, risque en vigueur).
 */
function MeasuresSection({ risk, unit, editable, options }: { risk: RiskView; unit: Unit; editable: boolean; options?: MeasureOptions }) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<MeasureLinkKind>('control');
  const [removing, setRemoving] = useState<number | null>(null);
  if (!risk.measures.length && !editable) return null;
  const linked = new Set(risk.measures.map((m) => `${m.kind}:${m.targetId}`));
  const choices = (options?.[kind] ?? [])
    .filter(([id, , siteId]) => !linked.has(`${kind}:${id}`) && (!siteId || !unit.siteId || siteId === unit.siteId))
    .map(([id, label]) => [id, label] as const);
  return (
    <section style={{ display: 'grid', gap: 8 }}>
      <div className="vg-eyebrow">{t('Linked control measures')}{risk.measures.length ? ` · ${risk.measures.length}` : ''}</div>
      {risk.measures.length ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {risk.measures.map((m) => (
            <li key={m.id} style={{ display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
                <i className={`ph ${MEASURE_LINK_KINDS[m.kind].icon}`} style={{ fontSize: 13, color: 'var(--color-neutral-400)' }} aria-hidden />
                <span className="vg-sr-only">{fill(t('{label}: '), { label: MEASURE_LINK_KINDS[m.kind].label })}</span>
                {m.href ? <Link href={m.href} className="vg-link" style={{ fontSize: 12.5, flex: 1, minWidth: 160 }}>{m.label}</Link> : <span style={{ flex: 1, minWidth: 160 }}>{m.label}</span>}
                <ToneTag tone={m.tone}>{m.valid ? m.state : fill(t('No longer valid · {state}'), { state: m.state })}</ToneTag>
                {editable && removing !== m.id && (
                  <button type="button" className="vg-text-btn" onClick={() => { setRemoving(m.id); setAdding(false); }}>{t('Withdraw')}</button>
                )}
              </div>
              {editable && removing === m.id && (
                <div className="vg-inset" style={{ padding: '10px 12px' }}>
                  <ReasonForm action={removeRiskMeasure} hidden={{ id: m.id }} submitLabel={t('Remove the measure')} submitIcon="ph-link-break"
                    placeholder={t('E.g. equipment replaced, instruction included in another procedure')} onDone={() => setRemoving(null)} onCancel={() => setRemoving(null)}
                    message={<>{fill(t('The measure “{label}” will no longer be followed for this risk; the link stays in the risk’s log with its reason.'), { label: m.label })}</>} />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>{t('No measure linked to an inspection, a document or a qualification.')}</div>
      )}
      {editable && !adding && (
        <button type="button" className="vg-text-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, justifySelf: 'start' }} onClick={() => { setAdding(true); setRemoving(null); }}>
          <i className="ph ph-link" style={{ fontSize: 13 }} aria-hidden />{t('Link a control measure')}
        </button>
      )}
      {editable && adding && (
        <div className="vg-inset" style={{ padding: '10px 12px' }}>
          <ActionForm action={linkRiskMeasure} hidden={{ riskId: risk.id }} onDone={() => setAdding(false)} onCancel={() => setAdding(false)} submitLabel={t('Link the measure')} submitIcon="ph-link">
            <Field name="kind" label={t('Item')}>
              <Select name="kind" options={MEASURE_LINK_KIND_KEYS.map((k) => [k, MEASURE_LINK_KINDS[k].label] as const)} value={kind} onChange={(e) => setKind(e.target.value as MeasureLinkKind)} />
            </Field>
            <Field name="targetId" label={MEASURE_LINK_KINDS[kind].label}
              hint={t('Flagged when it is no longer valid: inspection overdue or unfavourable, document without a version in force, qualification expired for an employee of the site.')}>
              <Select key={kind} name="targetId" options={choices} defaultValue="" placeholder={choices.length ? t('Choose…') : t('No item available')} />
            </Field>
          </ActionForm>
        </div>
      )}
    </section>
  );
}
