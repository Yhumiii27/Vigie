import Link from 'next/link';
import { RISK_LEVELS, riskLevel } from '@/lib/domain';
import { cellLabel, type CellFilter, type MatrixCell } from './matrix';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';

/**
 * Matrice gravité × probabilité d'une unité (DUE-16) : vrai tableau (légende, en-têtes de ligne G4–G1 et de colonne
 * P1–P4), chaque case nommée (cotation, niveau, nombre de risques) ; une case non vide est un lien qui filtre le tableau
 * des risques sur cette cotation (un second clic retire le filtre), la case retenue est marquée `aria-current`.
 */
export async function RiskMatrix({ rows, selected, residual, caption, hrefOf }: {
  rows: MatrixCell[][];
  selected: CellFilter;
  residual: boolean;
  caption: string;
  hrefOf: (c: MatrixCell) => string;
}) {
  const { t } = await getI18n();
  const on = (c: MatrixCell) => !!selected && selected.g === c.g && selected.p === c.p;
  return (
    <table className="vg-risk-matrix">
      <caption className="vg-sr-only">{caption}. {residual ? t('Choose a cell to filter the residual risks of this rating.') : t('Choose a cell to filter the gross risks of this rating.')}</caption>
      <thead>
        <tr>
          <td />
          {rows[0].map((c) => <th key={c.p} scope="col">P{c.p}<span className="vg-sr-only">{fill(t(' (probability {n})'), { n: c.p })}</span></th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((line) => (
          <tr key={line[0].g}>
            <th scope="row">G{line[0].g}<span className="vg-sr-only">{fill(t(' (severity {n})'), { n: line[0].g })}</span></th>
            {line.map((c) => (
              <td key={c.p} style={{ background: RISK_LEVELS[riskLevel(c.score)].bg }} data-on={on(c) || undefined}>
                {c.n > 0 ? (
                  <Link href={hrefOf(c)} scroll={false} className="vg-risk-cell" aria-current={on(c) ? 'true' : undefined}
                    aria-label={`${cellLabel(c)}${on(c) ? t(' · filter applied, remove the filter') : t(' · filter the table')}`}>
                    {c.n}
                  </Link>
                ) : (
                  <span className="vg-risk-cell"><span className="vg-sr-only">{cellLabel(c)}</span></span>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
