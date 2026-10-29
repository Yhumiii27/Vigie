import Link from 'next/link';
import { SegLinks, ToneTag } from '@/components/ui';
import { RISK_ACTION_THRESHOLD, RISK_FLAGS, RISK_LEVELS, TONE, riskLevel } from '@/lib/domain';
import type { DuerpOverview } from './overview';

// Vue d'ensemble du DUERP toutes unités (DUE-17) : matrice globale des unités du site sélectionné, synthèse par unité et
// risques prioritaires (résiduel ≥ seuil ou alerte), consultation pour tous les rôles de l'écran (DUERP lisible par tous).

const muted = { fontSize: 11.5, color: 'var(--vg-text-muted)' } as const;

export function OverviewPanel({ data, residual, brutHref, residualHref, unitHref, scopeLabel }: {
  data: DuerpOverview;
  residual: boolean;
  brutHref: string;
  residualHref: string;
  unitHref: (unitId: string) => string;
  scopeLabel: string;
}) {
  const { matrix, totals, priority, byUnit } = data;
  const stats = [
    { v: totals.risks, k: `risques évalués · ${totals.units} unité${totals.units > 1 ? 's' : ''}`, color: 'var(--color-text)' },
    { v: totals.high, k: 'élevés ou critiques (brut)', color: totals.high ? RISK_LEVELS[2].dot : 'var(--color-text)' },
    { v: totals.residualHigh, k: `résiduels ≥ ${RISK_ACTION_THRESHOLD}`, color: totals.residualHigh ? TONE.danger.dot : TONE.ok.dot },
    { v: totals.toDefine, k: 'à définir (sans action)', color: totals.toDefine ? TONE.danger.dot : 'var(--color-text)' },
  ];
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <div className="card" style={{ gap: 10, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="card-title" style={{ fontSize: 14 }}>Matrice toutes unités</span>
            <SegLinks size={11.5} pad="3px 9px" options={[
              { href: brutHref, label: 'Brut', on: !residual },
              { href: residualHref, label: 'Résiduel', on: residual },
            ]} />
          </div>
          <table className="vg-risk-matrix" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 4, fontSize: 12 }}>
            <caption className="vg-sr-only">{`Nombre de risques par gravité et probabilité (${residual ? 'cotation résiduelle' : 'cotation brute'}), toutes unités`}</caption>
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
          <div className="card-kicker">Vue d&apos;ensemble · {scopeLabel}</div>
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
              {[totals.residualStillHigh && `${totals.residualStillHigh} au résiduel encore élevé`, totals.toReview && `${totals.toReview} résiduel${totals.toReview > 1 ? 's' : ''} à recoter`].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: '10px 14px', gap: 8 }}>
        <span className="card-title" style={{ fontSize: 14 }}>Synthèse par unité de travail</span>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 12.5, minWidth: 560 }}>
            <thead><tr><th>Unité</th><th>Risques</th><th>Élevés (brut)</th><th>Résiduels ≥ {RISK_ACTION_THRESHOLD}</th><th>Alertes</th><th>Niveau brut le plus élevé</th></tr></thead>
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
        <span className="card-title" style={{ fontSize: 14 }}>Risques prioritaires</span>
        <span style={muted}>{`Résiduel ≥ ${RISK_ACTION_THRESHOLD}, ou cotation brute ≥ ${RISK_ACTION_THRESHOLD} sans action de réduction ; du plus élevé au plus faible.`}</span>
        {priority.length === 0 ? (
          <span style={{ fontSize: 12.5, color: 'var(--color-neutral-400)' }}>Aucun risque prioritaire.</span>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: 12.5, minWidth: 620 }}>
              <thead><tr><th>Unité</th><th>Danger</th><th>Brut</th><th>Résiduel</th><th>Alerte</th></tr></thead>
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
