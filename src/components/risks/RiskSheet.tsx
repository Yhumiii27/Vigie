'use client';

import { useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { ActionFields } from '@/components/ActionFormDialog';
import { ChangeLogList } from '@/components/ChangeLog';
import { LinkActionButton, LinkActionForm } from '@/components/LinkActionButton';
import { ReasonForm } from '@/components/ReasonDialog';
import { ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { EVENT_TYPES, RISK_FLAGS, TONE, type EventType } from '@/lib/domain';
import type { FormOptions } from '@/lib/data/options';
import type { ArchiveInfo, LinkedAction, RiskView, RisksData, WorkUnitView } from '@/lib/data/risks';
import { archiveRisk, confirmResidual, moveRisk, restoreRisk } from '@/server/risks';
import { Cotation, RiskFields } from './RiskForm';

export type RiskSheetView = 'sheet' | 'edit' | 'newAction' | 'link' | 'archive' | 'restore';
type Unit = Pick<WorkUnitView, 'id' | 'label' | 'site' | 'siteId' | 'originRef'>;
type Options = Pick<FormOptions, 'people' | 'origins' | 'sites'>;

/** Couleur du statut d'une action liée (tableau et fiche). */
export function actionColor(a: LinkedAction) {
  if (a.cancelled) return 'var(--color-neutral-500)';
  if (a.late) return TONE.danger.fg;
  if (a.done) return TONE.ok.fg;
  return 'var(--color-accent)';
}

/** « Archivé le 30/06/2026 par Claire Lefèvre » (unité ou risque archivé). */
export const archivedLabel = (a: ArchiveInfo, verb = 'Archivé') => `${verb} le ${fmtDate(a.on)}${a.by ? ` par ${a.by}` : ''}`;

/** Titre et sur-titre de la fenêtre selon la vue de la fiche. */
export function riskSheetHeading(risk: RiskView, unit: Unit, view: RiskSheetView) {
  if (view === 'newAction') return { title: 'Nouvelle action', kicker: `Plan d'actions unique · ${risk.hazard}` };
  if (view === 'link') return { title: 'Rattacher une action existante', kicker: `Plan d'actions unique · ${risk.hazard}` };
  if (view === 'edit') return { title: risk.hazard, kicker: `Modifier le risque · ${unit.label}` };
  if (view === 'archive') return { title: risk.hazard, kicker: `Archiver le risque · ${unit.label}` };
  if (view === 'restore') return { title: risk.hazard, kicker: `Restaurer le risque · ${unit.label}` };
  return { title: risk.hazard, kicker: `${risk.archived ? 'Risque archivé' : 'Risque'} · ${unit.label}` };
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
 * Fiche d'un risque, dans la fenêtre ouverte depuis le tableau : lecture pour tous les rôles (actions et événements liés,
 * historique) ; pour l'encadrement, modification, ordre, rattachement d'actions, nouvelle action et archivage (jamais de
 * suppression). Un risque archivé est en lecture seule ; l'animateur QHSE et la direction peuvent le restaurer.
 * Une seule fenêtre dont la vue change : pas de fenêtres imbriquées.
 */
export function RiskSheet({ risk, unit, unitArchived = false, units, canManage, canApprove = false, options, linkableActions, isFirst, isLast, view, onView, onClose }: {
  risk: RiskView;
  unit: Unit;
  /** Unité du risque archivée : restauration du risque impossible avant celle de l'unité. */
  unitArchived?: boolean;
  units: Pick<WorkUnitView, 'id' | 'label' | 'site'>[];
  canManage: boolean;
  /** Animateur QHSE, direction : restauration d'un risque archivé. */
  canApprove?: boolean;
  options: Options;
  linkableActions: RisksData['linkableActions'];
  isFirst: boolean;
  isLast: boolean;
  view: RiskSheetView;
  /** Changement de vue ; `null` = fermer la fenêtre. */
  onView: (view: RiskSheetView | null) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) => start(async () => {
    try {
      const r = await fn();
      setError(r.error ?? null);
      if (!r.error) after?.();
    } catch {
      setError("L'opération a échoué. Réessayez.");
    }
  });

  if (view === 'edit') {
    return <RiskFields units={units} defaults={risk} reviewPrompt={risk.flag === 'toReview'} onDone={onClose} onCancel={() => onView('sheet')} />;
  }

  if (view === 'newAction') {
    return (
      <ActionFields options={options} onDone={() => onView('sheet')} onCancel={() => onView('sheet')}
        defaults={{
          origin: 'risk', originRef: unit.originRef, lockOrigin: true, siteId: unit.siteId, kind: 'P', link: `risk:${risk.id}`,
          description: `Risque « ${risk.hazard} » : ${risk.situation} (cotation brute G${risk.gravity} × P${risk.probability} = ${risk.gravity * risk.probability}).`,
        }} />
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
      <ReasonForm action={archiveRisk} hidden={{ id: risk.id }} submitLabel="Archiver le risque" submitIcon="ph-archive"
        placeholder="Ex. poste supprimé, risque fusionné avec un autre, saisie en double…" onDone={onClose} onCancel={() => onView('sheet')}
        message={<>
          Le risque « {risk.hazard} » ({risk.situation}) sortira du document unique en vigueur : tableau, matrice, échéances, exports et prochain instantané.
          Il reste consultable avec son historique, ses actions et ses événements via le filtre « Archivés ».
          {open.length > 0 && <> {open.length > 1 ? 'Les actions' : "L'action"} {open.join(', ')} {open.length > 1 ? 'restent ouvertes' : 'reste ouverte'} dans le plan d&apos;actions.</>}
          {' '}Les versions archivées du DUERP ne sont pas modifiées.
        </>} />
    );
  }

  if (view === 'restore') {
    return (
      <ReasonForm action={restoreRisk} hidden={{ id: risk.id }} submitLabel="Restaurer le risque" submitIcon="ph-arrow-counter-clockwise"
        onDone={onClose} onCancel={() => onView('sheet')}
        message={<>Le risque « {risk.hazard} » reviendra dans l&apos;unité « {unit.label} » du document unique en vigueur, avec ses cotations et ses actions.</>} />
    );
  }

  const flag = risk.flag ? RISK_FLAGS[risk.flag] : null;
  const archived = risk.archived;
  const editable = canManage && !archived;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {archived && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)', background: TONE.neutral.bg }}>
          <ToneTag tone="neutral" style={{ flexShrink: 0 }}>Archivé</ToneTag>
          <span style={{ fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
            {archivedLabel(archived)} : hors du document unique en vigueur.{archived.reason && <> Motif : {archived.reason}</>}
          </span>
        </div>
      )}
      {flag && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)', background: TONE[flag.tone].bg }}>
          <ToneTag tone={flag.tone} style={{ flexShrink: 0 }}>{flag.label}</ToneTag>
          <span style={{ fontSize: 12.5, color: TONE[flag.tone].fg, textWrap: 'pretty' }}>
            {flag.hint}{risk.flag === 'toReview' && risk.lastClosedOn ? ` Dernière clôture le ${fmtDate(risk.lastClosedOn)}.` : ''}
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr)', gap: '8px 12px', alignItems: 'start' }}>
        <Row label="Danger">{risk.hazard}</Row>
        <Row label="Situation dangereuse"><span style={{ color: 'var(--color-neutral-300)' }}>{risk.situation}</span></Row>
        <Row label="Cotation brute"><Cotation g={risk.gravity} p={risk.probability} /></Row>
        <Row label="Mesures existantes"><span style={{ color: 'var(--color-neutral-300)' }}>{risk.existingMeasures || '—'}</span></Row>
        <Row label="Risque résiduel">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Cotation g={risk.residualGravity} p={risk.residualProbability} />
            {risk.residualReviewedOn && <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>recoté le {fmtDate(risk.residualReviewedOn)}</span>}
          </span>
        </Row>
      </div>

      <section style={{ display: 'grid', gap: 8 }}>
        <div className="vg-eyebrow">Actions de réduction{risk.actions.length ? ` · ${risk.actions.length}` : ''}</div>
        {risk.actions.length ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {risk.actions.map((a) => (
              <li key={a.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', fontSize: 12.5, opacity: a.cancelled ? 0.6 : 1 }}>
                <Link href={`/actions?action=${encodeURIComponent(a.id)}`} className="vg-link" style={{ fontSize: 12.5, color: actionColor(a), textDecoration: a.cancelled ? 'line-through' : undefined }}>{a.id}</Link>
                <span style={{ flex: 1, minWidth: 160 }}>{a.title}</span>
                {a.cancelled
                  ? <ToneTag tone="neutral">Annulée</ToneTag>
                  : <span style={{ color: actionColor(a), whiteSpace: 'nowrap' }}>{a.status}</span>}
                <span style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{a.pilot}</span>
                <span style={{ color: 'var(--color-neutral-500)', whiteSpace: 'nowrap' }}>{a.done && a.closedOn ? `clôturée le ${fmtDate(a.closedOn)}` : `échéance ${fmtDate(a.dueOn)}`}</span>
                {editable && <LinkActionButton link={`risk:${risk.id}`} current={a.id} />}
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>Aucune action rattachée.</div>
        )}
        {editable && (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <button type="button" className="vg-text-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} onClick={() => onView('newAction')}>
              <i className="ph ph-plus" style={{ fontSize: 13 }} />Nouvelle action
            </button>
            {/* Vue de la même fenêtre, pas une seconde fenêtre (Échap fermerait aussi la fiche). */}
            <button type="button" className="vg-text-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} disabled={!linkOptions.length}
              title={linkOptions.length ? undefined : 'Aucune action ouverte à rattacher'} onClick={() => onView('link')}>
              <i className="ph ph-link" style={{ fontSize: 13 }} />Rattacher une action existante
            </button>
          </div>
        )}
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <div className="vg-eyebrow">Événements liés{risk.events.length ? ` · ${risk.events.length}` : ''}</div>
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
          <div style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>Aucun événement rattaché. Le rattachement se fait depuis la fiche de l&apos;événement.</div>
        )}
      </section>

      <ChangeLogList entries={risk.history} />

      {error && <div role="alert" className="vg-form-error">{error}</div>}
      {archived && canApprove && (
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" disabled={unitArchived}
            title={unitArchived ? `L'unité « ${unit.label} » est archivée : restaurez-la d'abord.` : undefined} onClick={() => onView('restore')}>
            <i className="ph ph-arrow-counter-clockwise" style={{ fontSize: 14 }} />Restaurer le risque
          </button>
        </div>
      )}
      {editable && (
        <div className="dialog-actions" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button type="button" className="btn btn-ghost" style={{ color: 'var(--color-neutral-400)' }} disabled={pending}
              title="Retirer le risque du document unique en vigueur (motif obligatoire, historique conservé)"
              onClick={() => { setError(null); onView('archive'); }}>
              <i className="ph ph-archive" style={{ fontSize: 14 }} />Archiver
            </button>
            <button type="button" className="btn btn-ghost btn-icon" aria-label="Monter" title="Monter dans l'unité" disabled={isFirst || pending}
              onClick={() => run(() => moveRisk(risk.id, 'up'))}>
              <i className="ph ph-arrow-up" style={{ fontSize: 14 }} />
            </button>
            <button type="button" className="btn btn-ghost btn-icon" aria-label="Descendre" title="Descendre dans l'unité" disabled={isLast || pending}
              onClick={() => run(() => moveRisk(risk.id, 'down'))}>
              <i className="ph ph-arrow-down" style={{ fontSize: 14 }} />
            </button>
          </span>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {risk.flag === 'toReview' && (
              <>
                <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => run(() => confirmResidual(risk.id))}>
                  <i className="ph ph-check" style={{ fontSize: 14 }} />{pending ? 'Enregistrement…' : 'Confirmer le résiduel actuel'}
                </button>
                <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => onView('edit')}>Recoter le résiduel</button>
              </>
            )}
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => onView('edit')}>
              <i className="ph ph-pencil-simple" style={{ fontSize: 14 }} />Modifier
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
