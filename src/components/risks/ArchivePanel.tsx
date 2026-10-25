'use client';

import { useState } from 'react';
import { ChangeLogList } from '@/components/ChangeLog';
import { Dialog } from '@/components/Dialog';
import type { ActionFormOptions } from '@/lib/action-view';
import type { ArchivedUnitView, RiskView, RisksData, WorkUnitView } from '@/lib/data/risks';
import { Cotation } from './RiskForm';
import { RiskSheet, archivedLabel, riskSheetHeading, type RiskSheetView } from './RiskSheet';
import { rowOpener } from './RiskTable';
import { RestoreUnitButton } from './UnitDialogs';
import { ScrollX } from '@/components/ui';

type Unit = Pick<WorkUnitView, 'id' | 'label' | 'site' | 'siteId' | 'originRef'>;

const muted = { fontSize: 11.5, color: 'var(--color-neutral-500)' } as const;

/**
 * Filtre « Archivés » du DUERP : unités et risques retirés du document unique en vigueur (jamais supprimés),
 * consultables avec leur motif et leur historique ; restauration réservée à l'animateur QHSE et à la direction.
 */
export function ArchivePanel({ risks, units, archivedUnits, canApprove, options, linkableActions, showSite, residual, initialRiskId }: {
  /** Risques archivés du site sélectionné. */
  risks: RiskView[];
  /** Unités en vigueur (unité d'un risque archivé encore en service). */
  units: WorkUnitView[];
  archivedUnits: ArchivedUnitView[];
  canApprove: boolean;
  options: ActionFormOptions;
  linkableActions: RisksData['linkableActions'];
  /** « Tous les sites » : rappelle le site de chaque unité. */
  showSite: boolean;
  residual: boolean;
  /** Lien profond ?risque=<id> vers un risque archivé : fiche ouverte au chargement. */
  initialRiskId?: number;
}) {
  const [open, setOpen] = useState<{ id: number; view: RiskSheetView } | null>(
    initialRiskId != null && risks.some((r) => r.id === initialRiskId) ? { id: initialRiskId, view: 'sheet' } : null,
  );
  const unitOf = new Map<string, { unit: Unit; archived: boolean }>([
    ...units.map((u) => [u.id, { unit: u, archived: false }] as const),
    ...archivedUnits.map((u) => [u.id, { unit: u, archived: true }] as const),
  ]);
  const current = open ? risks.find((r) => r.id === open.id) ?? null : null;
  const currentUnit = current ? unitOf.get(current.unitId) : undefined;
  const close = () => setOpen(null);
  const heading = current && currentUnit && open ? riskSheetHeading(current, currentUnit.unit, open.view) : null;
  const unitName = (u: { label: string; site: string }) => (showSite ? `${u.label} · ${u.site.split(' — ')[0]}` : u.label);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
      <div className="card" style={{ gap: 10 }}>
        <div className="card-kicker">Unités de travail archivées{archivedUnits.length ? ` · ${archivedUnits.length}` : ''}</div>
        {archivedUnits.length ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
            {archivedUnits.map((u) => (
              <li key={u.id} style={{ display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
                  <span style={{ fontWeight: 500 }}>{unitName(u)}</span>
                  <span style={muted}>{u.count ? `${u.count} risque${u.count > 1 ? 's' : ''} archivé${u.count > 1 ? 's' : ''}` : 'aucun risque'}</span>
                  <span style={{ ...muted, flex: 1, minWidth: 200 }}>{archivedLabel(u.archived, 'Archivée')}{u.archived.reason ? ` · ${u.archived.reason}` : ''}</span>
                  {canApprove && <RestoreUnitButton unit={u} residual={residual} />}
                </div>
                <ChangeLogList entries={u.history} />
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>Aucune unité de travail archivée.</div>
        )}
      </div>

      <div className="card" style={{ padding: '6px 14px 10px' }}>
        <ScrollX label="Risques archivés">
          <table className="table" style={{ fontSize: 12.5, minWidth: 760 }}>
            <thead><tr><th>Unité</th><th>Danger</th><th>Situation dangereuse</th><th>Cotation brute</th><th>Risque résiduel</th><th>Archivage</th></tr></thead>
            <tbody>
              {risks.map((r) => {
                const u = unitOf.get(r.unitId);
                return (
                  <tr key={r.id} {...rowOpener(() => setOpen({ id: r.id, view: 'sheet' }))} style={{ opacity: 0.85 }}>
                    <td style={{ whiteSpace: 'nowrap' }}>{u ? unitName(u.unit) : r.unitId}{u?.archived && <div style={muted}>unité archivée</div>}</td>
                    <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{r.hazard}</td>
                    <td style={{ color: 'var(--color-neutral-300)' }}>{r.situation}</td>
                    <td><Cotation g={r.gravity} p={r.probability} /></td>
                    <td><Cotation g={r.residualGravity} p={r.residualProbability} /></td>
                    <td style={{ minWidth: 180 }}>
                      {r.archived && <span style={muted}>{archivedLabel(r.archived)}</span>}
                      {r.archived?.reason && <div style={{ fontSize: 12, color: 'var(--color-neutral-300)', marginTop: 2 }}>{r.archived.reason}</div>}
                    </td>
                  </tr>
                );
              })}
              {!risks.length && (
                <tr><td colSpan={6} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>Aucun risque archivé.</td></tr>
              )}
            </tbody>
          </table>
        </ScrollX>
      </div>

      <Dialog open={!!current && !!currentUnit} onClose={close} title={heading?.title ?? ''} kicker={heading?.kicker} width={open?.view === 'restore' ? 520 : 640}>
        {current && currentUnit && open && (
          <RiskSheet key={`${current.id}:${open.view}`} risk={current} unit={currentUnit.unit} unitArchived={currentUnit.archived} units={[]}
            canManage={false} canApprove={canApprove} options={options} linkableActions={linkableActions} isFirst isLast
            view={canApprove && open.view === 'restore' ? 'restore' : 'sheet'}
            onView={(view) => (view ? setOpen((o) => o && { id: o.id, view }) : close())} onClose={close} />
        )}
      </Dialog>
    </div>
  );
}
