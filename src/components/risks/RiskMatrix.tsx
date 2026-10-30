import Link from 'next/link';
import { RISK_LEVELS, riskLevel } from '@/lib/domain';
import { cellLabel, type CellFilter, type MatrixCell } from './matrix';

/**
 * Matrice gravité × probabilité d'une unité (DUE-16) : vrai tableau (légende, en-têtes de ligne G4–G1 et de colonne
 * P1–P4), chaque case nommée (cotation, niveau, nombre de risques) ; une case non vide est un lien qui filtre le tableau
 * des risques sur cette cotation (un second clic retire le filtre), la case retenue est marquée `aria-current`.
 */
export function RiskMatrix({ rows, selected, residual, caption, hrefOf }: {
  rows: MatrixCell[][];
  selected: CellFilter;
  residual: boolean;
  caption: string;
  hrefOf: (c: MatrixCell) => string;
}) {
  const on = (c: MatrixCell) => !!selected && selected.g === c.g && selected.p === c.p;
  return (
    <table className="vg-risk-matrix">
      <caption className="vg-sr-only">{caption}. Choisir une case pour filtrer les risques {residual ? 'au résiduel' : 'bruts'} de cette cotation.</caption>
      <thead>
        <tr>
          <td />
          {rows[0].map((c) => <th key={c.p} scope="col">P{c.p}<span className="vg-sr-only"> (probabilité {c.p})</span></th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((line) => (
          <tr key={line[0].g}>
            <th scope="row">G{line[0].g}<span className="vg-sr-only"> (gravité {line[0].g})</span></th>
            {line.map((c) => (
              <td key={c.p} style={{ background: RISK_LEVELS[riskLevel(c.score)].bg }} data-on={on(c) || undefined}>
                {c.n > 0 ? (
                  <Link href={hrefOf(c)} scroll={false} className="vg-risk-cell" aria-current={on(c) ? 'true' : undefined}
                    aria-label={`${cellLabel(c)}${on(c) ? ' · filtre appliqué, retirer le filtre' : ' · filtrer le tableau'}`}>
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
