import Link from 'next/link';
import { SegLinks, ToneTag } from '@/components/ui';
import { RISK_ACTION_THRESHOLD, RISK_FLAGS, RISK_LEVELS, TONE, riskLevel } from '@/lib/domain';
import type { DuerpOverview } from './overview';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';

// Vue d'ensemble du DUERP toutes unités (DUE-17) : matrice globale des unités du site sélectionné, synthèse par unité et
// risques prioritaires (résiduel ≥ seuil ou alerte), consultation pour tous les rôles de l'écran (DUERP lisible par tous).

const muted = { fontSize: 11.5, color: 'var(--vg-text-muted)' } as const;

export async function OverviewPanel({ data, residual, brutHref, residualHref, unitHref, scopeLabel }: {
  data: DuerpOverview;
  residual: boolean;
  brutHref: string;
  residualHref: string;
  unitHref: (unitId: string) => string;
  scopeLabel: string;
}) {
  const { t } = await getI18n();
  const { matrix, totals, priority, byUnit } = data;
  const stats = [
    { v: totals.risks, k: `${t('risks assessed')} · ${fill(totals.units > 1 ? t('{n} units') : t('{n} unit'), { n: totals.units })}`, color: 'var(--color-text)' },
    { v: totals.high, k: t('high or critical (gross)'), color: totals.high ? RISK_LEVELS[2].dot : 'var(--color-text)' },
    { v: totals.residualHigh, k: fill(t('residual ≥ {n}'), { n: RISK_ACTION_THRESHOLD }), color: totals.residualHigh ? TONE.danger.dot : TONE.ok.dot },
    { v: totals.toDefine, k: t('to be defined (no action)'), color: totals.toDefine ? TONE.danger.dot : 'var(--color-text)' },
  ];
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <div className="card" style={{ gap: 10, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="card-title" style={{ fontSize: 14 }}>{t('Matrix of all units')}</span>
            <SegLinks size={11.5} pad="3px 9px" options={[
              { href: brutHref, label: t('Gross'), on: !residual },
              { href: residualHref, label: t('Residual'), on: residual },
            ]} />
          </div>
          <table className="vg-risk-matrix" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 4, fontSize: 12 }}>
            <caption className="vg-sr-only">{residual ? t('Number of risks by severity and probability (residual rating), all units') : t('Number of risks by severity and probability (gross rating), all units')}</caption>
            <thead>
              <tr><td />{[1, 2, 3, 4].map((p) => <th key={p} scope="col" style={{ ...muted, fontWeight: 400 }}>P{p}</th>)}</tr>
            </thead>
            <tbody>
              {matrix.map((row, i) => {
                const g = 4 - i;
                return (
                  <tr key={g}>
                    <th scope="row" style={{ ...muted, fontWeight: 400, width: 28 }}>G{g}</th>
                    {row.map((n, j) => (
                      <td key={j} style={{ height: 40, textAlign: 'center', borderRadius: 4, background: RISK_LEVELS[riskLevel(g * (j + 1))].bg, fontSize: 13 }}>{n || ''}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: 'var(--color-neutral-400)' }}>
            {RISK_LEVELS.map((l) => (
              <span key={l.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: l.bg }} />{l.label}</span>
            ))}
          </div>
        </div>
        <div className="card" style={{ gap: 10 }}>
          <div className="card-kicker">{fill(t('Overview · {scope}'), { scope: scopeLabel })}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {stats.map((k) => (
              <div key={k.k} style={{ display: 'grid', gap: 2 }}>
                <span style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-.02em', color: k.color }}>{k.v}</span>
                <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{k.k}</span>
              </div>
            ))}
          </div>
          {(totals.residualStillHigh > 0 || totals.toReview > 0) && (
            <span style={{ fontSize: 12, color: TONE.warn.fg }}>
              {[totals.residualStillHigh && fill(t('{n} with a residual still high'), { n: totals.residualStillHigh }), totals.toReview && fill(totals.toReview > 1 ? t('{n} residuals to re-rate') : t('{n} residual to re-rate'), { n: totals.toReview })].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: '10px 14px', gap: 8 }}>
        <span className="card-title" style={{ fontSize: 14 }}>{t('Summary by work unit')}</span>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 12.5, minWidth: 560 }}>
            <thead><tr><th>{t('Unit')}</th><th>{t('Risks')}</th><th>{t('High (gross)')}</th><th>{fill(t('Residuals ≥ {n}'), { n: RISK_ACTION_THRESHOLD })}</th><th>{t('Alerts')}</th><th>{t('Highest gross level')}</th></tr></thead>
            <tbody>
              {byUnit.map((u) => (
                <tr key={u.id}>
                  <td><Link href={unitHref(u.id)} className="vg-link" style={{ fontSize: 12.5 }}>{u.label}</Link>{byUnit.some((x) => x.site !== u.site) && <div style={muted}>{u.site}</div>}</td>
                  <td>{u.count}</td>
                  <td>{u.high}</td>
                  <td style={{ color: u.residualHigh ? TONE.danger.fg : undefined }}>{u.residualHigh}</td>
                  <td style={{ color: u.alerts ? TONE.danger.fg : undefined }}>{u.alerts}</td>
                  <td>{u.count ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span aria-hidden className="vg-dot" style={{ width: 7, height: 7, background: RISK_LEVELS[u.top].dot }} />{RISK_LEVELS[u.top].label}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: '10px 14px', gap: 8 }}>
        <span className="card-title" style={{ fontSize: 14 }}>{t('Priority risks')}</span>
        <span style={muted}>{fill(t('Residual ≥ {n}, or gross rating ≥ {n} without a reduction action; from highest to lowest.'), { n: RISK_ACTION_THRESHOLD })}</span>
        {priority.length === 0 ? (
          <span style={{ fontSize: 12.5, color: 'var(--color-neutral-400)' }}>{t('No priority risk.')}</span>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: 12.5, minWidth: 620 }}>
              <thead><tr><th>{t('Unit')}</th><th>{t('Hazard')}</th><th>{t('Gross')}</th><th>{t('Residual')}</th><th>{t('Alert')}</th></tr></thead>
              <tbody>
                {priority.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.unit}</td>
                    <td><Link href={`/risques?risque=${r.id}`} className="vg-link" style={{ fontSize: 12.5 }}>{r.hazard}</Link>{r.situation && <div style={muted}>{r.situation}</div>}</td>
                    <td>{r.gross}</td>
                    <td style={{ color: r.residual >= RISK_ACTION_THRESHOLD ? TONE.danger.fg : undefined }}>{r.residual}</td>
                    <td>{r.flag && r.flag !== 'toReview' ? <ToneTag tone={RISK_FLAGS[r.flag].tone} style={{ whiteSpace: 'nowrap' }}>{RISK_FLAGS[r.flag].label}</ToneTag> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
