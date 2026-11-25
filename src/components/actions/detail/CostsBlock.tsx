// Bloc « Pointage et coûts » de la fiche (§ 11, ACT-26) : pointage saisi à la clôture, coûts à tout moment (€ TTC).

import type { ActionDetailView } from '@/lib/action-view';
import { fmtEuros, fmtHours } from './form-helpers';
import { useI18n } from '@/i18n/client';

export function CostsBlock({ detail }: { detail: Pick<ActionDetailView, 'hours' | 'estimatedCost' | 'actualCost'> }) {
  const { t } = useI18n();
  const rows: [string, string][] = [
    [t('Time logged'), fmtHours(detail.hours)],
    [t('Estimated cost'), fmtEuros(detail.estimatedCost)],
    [t('Actual cost'), fmtEuros(detail.actualCost)],
  ];
  return (
    <section className="vg-action-block" aria-label={t('Time logged and costs')}>
      <h6 className="vg-h6">{t('Time logged and costs')}</h6>
      <dl className="vg-facts">
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
    </section>
  );
}
