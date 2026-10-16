// Bloc « Pointage et coûts » de la fiche (§ 11, ACT-26) : pointage saisi à la clôture, coûts à tout moment (€ TTC).

import type { ActionDetailView } from '@/lib/action-view';
import { fmtEuros, fmtHours } from './form-helpers';

export function CostsBlock({ detail }: { detail: Pick<ActionDetailView, 'hours' | 'estimatedCost' | 'actualCost'> }) {
  const rows: [string, string][] = [
    ['Pointage', fmtHours(detail.hours)],
    ['Coût estimé', fmtEuros(detail.estimatedCost)],
    ['Coût réel', fmtEuros(detail.actualCost)],
  ];
  return (
    <section className="vg-action-block" aria-label="Pointage et coûts">
      <h6 className="vg-h6">Pointage et coûts</h6>
      <dl className="vg-facts">
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
    </section>
  );
}
