import type { ReactNode } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui';
import { monthLabel, monthShift, type ActionStats, type StatsRow } from '@/lib/action-stats';
import { fmtDate } from '@/lib/dates';
import { fmtDecimal } from '@/lib/forms';

// Onglet « Statistiques » de /actions (ACT-29, docs/specs/actions-qse.md § 17) : indicateurs du mois choisi et évolution
// sur 12 mois, calculés par computeActionStats (src/lib/action-stats.ts) sur le plan du site sélectionné ; composant
// serveur, sans état (mois porté par l'URL : ?vue=statistiques&mois=AAAA-MM). Barres d'une seule série : pas de légende,
// valeur écrite à côté de chaque barre ; tableaux pour la lecture exacte.

const pct = (r: number | null) => (r == null ? '—' : `${fmtDecimal(Math.round(r * 1000) / 10)} %`);
const MONTH_CHOICES = 24;

type Props = { stats: ActionStats; siteLabel: string; today: string; href: (mois: string | undefined) => string };

export function ActionStatsView({ stats: s, siteLabel, today, href }: Props) {
  const current = today.slice(0, 7);
  const months = Array.from({ length: MONTH_CHOICES }, (_, i) => monthShift(current, -i));
  const prev = monthShift(s.month, -1);
  const next = s.month < current ? monthShift(s.month, 1) : null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14, minWidth: 0 }} aria-label="Statistiques du plan d’actions">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Link href={href(prev)} scroll={false} className="btn btn-secondary vg-btn-sm" aria-label={`Mois précédent (${monthLabel(prev)})`}>
          <Icon name="ph-caret-left" size={12} />
        </Link>
        <details key={s.month} className="vg-dropdown">
          <summary className="btn btn-secondary vg-btn-sm"><Icon name="ph-calendar" size={13} />{s.label}<Icon name="ph-caret-down" size={11} /></summary>
          <div className="vg-menu elev-md" style={{ maxHeight: 340, overflowY: 'auto', minWidth: 160 }}>
            {months.map((m) => (
              <Link key={m} href={href(m === current ? undefined : m)} scroll={false} className={`vg-menu-item${m === s.month ? ' is-on' : ''}`}>{monthLabel(m)}</Link>
            ))}
          </div>
        </details>
        {next
          ? <Link href={href(next === current ? undefined : next)} scroll={false} className="btn btn-secondary vg-btn-sm" aria-label={`Mois suivant (${monthLabel(next)})`}><Icon name="ph-caret-right" size={12} /></Link>
          : <span className="btn btn-secondary vg-btn-sm" aria-disabled="true" style={{ opacity: 0.4 }}><Icon name="ph-caret-right" size={12} /></span>}
        <span className="vg-muted" style={{ fontSize: 12 }}>
          État du plan {s.current ? `au ${fmtDate(s.asOf)} (mois en cours)` : `à la fin du mois (${fmtDate(s.asOf)})`} · {siteLabel} · {s.total} action{s.total > 1 ? 's' : ''}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))', gap: 10 }}>
        <Tile label="Actions ouvertes" value={String(s.open)} sub="À faire → 80 %, fin de mois" />
        <Tile label="Taux de retard" value={pct(s.lateRate)} sub={`${s.late} en retard / ${s.open} ouvertes`} />
        <Tile label="Délai moyen de clôture" value={s.meanCloseDays == null ? '—' : `${fmtDecimal(s.meanCloseDays)} j`} sub={`${s.verified} vérifiée${s.verified > 1 ? 's' : ''} dans le mois (vérification − ouverture)`} />
        <Tile label="Taux d’efficacité" value={pct(s.efficacyRate)} sub={`${s.effective} efficace${s.effective > 1 ? 's' : ''} / ${s.verified} vérifiée${s.verified > 1 ? 's' : ''}`} />
        <Tile label="Respect des dates cibles" value={pct(s.onTimeRate)} sub={`${s.onTime} / ${s.finished} terminée${s.finished > 1 ? 's' : ''} dans le mois (dernière date cible)`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 10 }}>
        <Card title="Par avancement" note="Tout le plan, Abandonnées comprises">
          <Bars rows={s.byAvancement.filter((r) => r.count > 0).map((r) => ({ key: r.key, label: r.label, value: r.count }))} />
        </Card>
        <Distribution title="Par source" rows={s.bySource} />
        <Distribution title="Par domaine" rows={s.byDomain} />
        <Distribution title="Par responsable" rows={s.byPilot} />
        <Distribution title="Par niveau de risque" rows={s.byRiskLevel} />
      </div>

      <Card title="Évolution sur 12 mois" note="Ouvertes : date d’ouverture ; clôturées : date de vérification ; en fin de mois : état reconstitué par le journal">
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 12.5, minWidth: 620 }}>
            <thead>
              <tr><th>Mois</th><th style={{ textAlign: 'right' }}>Ouvertes</th><th style={{ textAlign: 'right' }}>Clôturées</th><th style={{ textAlign: 'right' }}>Abandonnées</th><th style={{ textAlign: 'right' }}>En cours en fin de mois</th><th style={{ textAlign: 'right' }}>Taux de retard</th></tr>
            </thead>
            <tbody>
              {s.evolution.map((m) => (
                <tr key={m.month} style={m.month === s.month ? { fontWeight: 500 } : undefined}>
                  <td style={{ whiteSpace: 'nowrap' }}><Link href={href(m.month === current ? undefined : m.month)} scroll={false} className="vg-link">{m.label}</Link></td>
                  <td style={{ textAlign: 'right' }}>{m.opened}</td>
                  <td style={{ textAlign: 'right' }}>{m.closed}</td>
                  <td style={{ textAlign: 'right' }}>{m.abandoned}</td>
                  <td style={{ textAlign: 'right' }}>{m.open}</td>
                  <td style={{ textAlign: 'right' }} title={`${m.late} en retard / ${m.open} ouvertes`}>{pct(m.lateRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="vg-muted" style={{ fontSize: 11.5, margin: 0, textWrap: 'pretty' }}>
        Calculé à la demande, jamais stocké. Abandonnées exclues des taux et des répartitions autres que l’avancement ; responsable,
        source, domaine, niveau de risque et date cible : valeurs actuelles ; action reprise sans historique : avancement réputé
        atteint à la date de reprise.
      </p>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card" style={{ padding: '12px 14px', gap: 4, minWidth: 0 }}>
      <div className="vg-muted" style={{ fontSize: 11.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-.01em' }}>{value}</div>
      <div className="vg-muted" style={{ fontSize: 11 }}>{sub}</div>
    </div>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="card" style={{ padding: '12px 14px', gap: 8, minWidth: 0 }} aria-label={title}>
      <div>
        <h6 className="vg-h6" style={{ margin: 0 }}>{title}</h6>
        {note && <div className="vg-muted" style={{ fontSize: 11 }}>{note}</div>}
      </div>
      {children}
    </section>
  );
}

function Distribution({ title, rows }: { title: string; rows: StatsRow[] }) {
  return (
    <Card title={title} note="Actions du plan hors Abandonnées (dont ouvertes)">
      <Bars rows={rows.map((r) => ({ key: r.key, label: r.label, value: r.total, extra: `${r.open} ouverte${r.open > 1 ? 's' : ''}` }))} />
    </Card>
  );
}

/** Barres horizontales d'une seule série (couleur d'accent), valeur et précision écrites à droite ; info-bulle native. */
function Bars({ rows }: { rows: { key: string; label: string; value: number; extra?: string }[] }) {
  if (!rows.length) return <div className="vg-muted" style={{ fontSize: 12 }}>Aucune action.</div>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 5 }}>
      {rows.map((r) => (
        <li key={r.key || 'vide'} title={`${r.label} : ${r.value}${r.extra ? ` (${r.extra})` : ''}`}
          style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 40%) 1fr auto', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
          <span style={{ height: 8, background: 'color-mix(in srgb, var(--color-text) 6%, transparent)', borderRadius: 4 }}>
            <span style={{ display: 'block', height: '100%', width: `${(r.value / max) * 100}%`, minWidth: r.value ? 4 : 0, background: 'var(--color-accent)', borderRadius: 4 }} />
          </span>
          <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            {r.value}{r.extra && <span className="vg-muted"> · {r.extra}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
