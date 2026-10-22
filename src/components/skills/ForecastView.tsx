import Link from 'next/link';
import { ToneTag } from '@/components/ui';
import { fmtDate, fmtMonthAbbr, monthName } from '@/lib/dates';
import type { ForecastItem, RenewalForecast } from './rules';

const STATE_LABEL: Record<string, { label: string; tone: 'danger' | 'warn' | 'neutral' }> = {
  r: { label: 'Jamais suivi', tone: 'danger' },
  x: { label: 'Expiré', tone: 'danger' },
  p: { label: 'Prérequis non valide', tone: 'danger' },
  s: { label: 'Expire sous 60 j', tone: 'warn' },
  v: { label: 'Valide', tone: 'neutral' },
};
const monthLabel = (ym: string) => `${monthName(+ym.slice(5, 7))} ${ym.slice(0, 4)}`;

/**
 * Vue « À prévoir » des habilitations (HAB-09) : recyclages et formations à planifier sur 12 mois, tableau par mois et par
 * titre, puis le détail (salarié, titre, échéance). Calculée (renewalForecast), jamais stockée ; plan de formation géré par
 * le service RH, sans action QSE. `links` : liens vers la case de la matrice (écran) ; absents à l'impression.
 */
export function ForecastView({ forecast, links = true, tableClass = 'table' }: { forecast: RenewalForecast; links?: boolean; tableClass?: string }) {
  const { overdue, months, titles } = forecast;
  const total = overdue.length + months.reduce((n, m) => n + m.items.length, 0);
  if (!total) return <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-500)' }}>Aucun recyclage ni formation à prévoir sur les 12 prochains mois.</p>;
  const count = (items: ForecastItem[], titleId: string) => items.filter((i) => i.titleId === titleId).length;
  const groups = [
    ...(overdue.length ? [{ key: 'retard', label: 'À rattraper (expiré, jamais suivi ou prérequis manquant)', items: overdue }] : []),
    ...months.filter((m) => m.items.length).map((m) => ({ key: m.month, label: monthLabel(m.month), items: m.items })),
  ];
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ overflowX: 'auto' }}>
        <table className={`${tableClass} vg-forecast`} style={{ fontSize: 12, minWidth: 720 }}>
          <thead>
            <tr>
              <th>Titre</th>
              <th style={{ textAlign: 'center' }} title="Expiré, jamais suivi ou prérequis manquant">À rattraper</th>
              {months.map((m) => <th key={m.month} style={{ textAlign: 'center' }} title={monthLabel(m.month)}>{fmtMonthAbbr(`${m.month}-01`)}{m.month.endsWith('-01') ? ` ${m.month.slice(2, 4)}` : ''}</th>)}
              <th style={{ textAlign: 'center' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {titles.map((ti) => {
              const late = count(overdue, ti.id);
              const sum = late + months.reduce((n, m) => n + count(m.items, ti.id), 0);
              return (
                <tr key={ti.id}>
                  <td style={{ minWidth: 160 }}>{ti.label}</td>
                  <td className={`vg-forecast-cell${late ? '' : ' is-empty'}`} style={late ? { color: 'var(--tone-danger-fg)', fontWeight: 500 } : undefined}>{late || '·'}</td>
                  {months.map((m) => {
                    const n = count(m.items, ti.id);
                    return <td key={m.month} className={`vg-forecast-cell${n ? '' : ' is-empty'}`}>{n || '·'}</td>;
                  })}
                  <td className="vg-forecast-cell" style={{ fontWeight: 500 }}>{sum}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {groups.map((g) => (
        <section key={g.key} style={{ display: 'grid', gap: 4 }}>
          <h6 className="vg-h6">{g.label} · {g.items.length}</h6>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 3 }}>
            {g.items.map((i) => {
              const st = STATE_LABEL[i.state] ?? STATE_LABEL.v;
              return (
                <li key={`${i.personId}:${i.titleId}`} style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
                  {links
                    ? <Link href={`/habilitations?salarie=${encodeURIComponent(i.personId)}&titre=${encodeURIComponent(i.titleId)}`} className="vg-link" style={{ fontSize: 12.5, minWidth: 150 }}>{i.person}</Link>
                    : <span style={{ minWidth: 150 }}>{i.person}</span>}
                  <span style={{ flex: 1, minWidth: 140 }}>{i.title}</span>
                  <span style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{i.expiresOn ? `échéance ${fmtDate(i.expiresOn)}` : 'aucune formation enregistrée'}</span>
                  {st.tone !== 'neutral' && <ToneTag tone={st.tone}>{st.label}</ToneTag>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
