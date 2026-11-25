import type { ReactNode } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui';
import { monthLabel, monthShift, type ActionStats, type StatsRow } from '@/lib/action-stats';
import { fmtDate } from '@/lib/dates';
import { fmtDecimal } from '@/lib/forms';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';

// Onglet « Statistiques » de /actions (ACT-29, docs/specs/actions-qse.md § 17) : indicateurs du mois choisi et évolution
// sur 12 mois, calculés par computeActionStats (src/lib/action-stats.ts) sur le plan du site sélectionné ; composant
// serveur, sans état (mois porté par l'URL : ?vue=statistiques&mois=AAAA-MM). Barres d'une seule série : pas de légende,
// valeur écrite à côté de chaque barre ; tableaux pour la lecture exacte.

const pct = (r: number | null) => (r == null ? '—' : `${fmtDecimal(Math.round(r * 1000) / 10)} %`);
const MONTH_CHOICES = 24;

type Props = { stats: ActionStats; siteLabel: string; today: string; href: (mois: string | undefined) => string };

export async function ActionStatsView({ stats: s, siteLabel, today, href }: Props) {
  const { t } = await getI18n();
  const plural = (n: number, one: string, many: string) => fill(n > 1 ? many : one, { n });
  const current = today.slice(0, 7);
  const months = Array.from({ length: MONTH_CHOICES }, (_, i) => monthShift(current, -i));
  const prev = monthShift(s.month, -1);
  const next = s.month < current ? monthShift(s.month, 1) : null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14, minWidth: 0 }} aria-label={t('Action plan statistics')}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Link href={href(prev)} scroll={false} className="btn btn-secondary vg-btn-sm" aria-label={fill(t('Previous month ({month})'), { month: monthLabel(prev) })}>
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
          ? <Link href={href(next === current ? undefined : next)} scroll={false} className="btn btn-secondary vg-btn-sm" aria-label={fill(t('Next month ({month})'), { month: monthLabel(next) })}><Icon name="ph-caret-right" size={12} /></Link>
          : <span className="btn btn-secondary vg-btn-sm" aria-disabled="true" style={{ opacity: 0.4 }}><Icon name="ph-caret-right" size={12} /></span>}
        <span className="vg-muted" style={{ fontSize: 12 }}>
          {s.current ? fill(t('Plan status on {date} (current month)'), { date: fmtDate(s.asOf) }) : fill(t('Plan status at the end of the month ({date})'), { date: fmtDate(s.asOf) })} · {siteLabel} · {plural(s.total, t('{n} action'), t('{n} actions'))}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))', gap: 10 }}>
        <Tile label={t('Open actions')} value={String(s.open)} sub={t('To do → 80 %, end of month')} />
        <Tile label={t('Late rate')} value={pct(s.lateRate)} sub={fill(t('{late} overdue / {open} open'), { late: s.late, open: s.open })} />
        <Tile label={t('Mean closure time')} value={s.meanCloseDays == null ? '—' : fill(t('{n} d'), { n: fmtDecimal(s.meanCloseDays) })} sub={plural(s.verified, t('{n} action verified in the month (verification − opening)'), t('{n} actions verified in the month (verification − opening)'))} />
        <Tile label={t('Effectiveness rate')} value={pct(s.efficacyRate)} sub={`${plural(s.effective, t('{n} effective action'), t('{n} effective actions'))} / ${plural(s.verified, t('{n} verified action'), t('{n} verified actions'))}`} />
        <Tile label={t('Target dates met')} value={pct(s.onTimeRate)} sub={`${s.onTime} / ${plural(s.finished, t('{n} action completed in the month (last target date)'), t('{n} actions completed in the month (last target date)'))}`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 10 }}>
        <Card title={t('By progress')} note={t('The whole plan, Abandoned included')}>
          <Bars rows={s.byAvancement.filter((r) => r.count > 0).map((r) => ({ key: r.key, label: r.label, value: r.count }))} />
        </Card>
        <Distribution title={t('By source')} rows={s.bySource} />
        <Distribution title={t('By domain')} rows={s.byDomain} />
        <Distribution title={t('By owner')} rows={s.byPilot} />
        <Distribution title={t('By risk level')} rows={s.byRiskLevel} />
      </div>

      <Card title={t('Trend over 12 months')} note={t('Opened: opening date; closed: verification date; at month end: status rebuilt from the log')}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 12.5, minWidth: 620 }}>
            <thead>
              <tr><th>{t('Month')}</th><th style={{ textAlign: 'right' }}>{t('Opened')}</th><th style={{ textAlign: 'right' }}>{t('Closures')}</th><th style={{ textAlign: 'right' }}>{t('Abandonments')}</th><th style={{ textAlign: 'right' }}>{t('In progress at month end')}</th><th style={{ textAlign: 'right' }}>{t('Late rate')}</th></tr>
            </thead>
            <tbody>
              {s.evolution.map((m) => (
                <tr key={m.month} style={m.month === s.month ? { fontWeight: 500 } : undefined}>
                  <td style={{ whiteSpace: 'nowrap' }}><Link href={href(m.month === current ? undefined : m.month)} scroll={false} className="vg-link">{m.label}</Link></td>
                  <td style={{ textAlign: 'right' }}>{m.opened}</td>
                  <td style={{ textAlign: 'right' }}>{m.closed}</td>
                  <td style={{ textAlign: 'right' }}>{m.abandoned}</td>
                  <td style={{ textAlign: 'right' }}>{m.open}</td>
                  <td style={{ textAlign: 'right' }} title={fill(t('{late} overdue / {open} open'), { late: m.late, open: m.open })}>{pct(m.lateRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="vg-muted" style={{ fontSize: 11.5, margin: 0, textWrap: 'pretty' }}>
        {t('Computed on demand, never stored. Abandoned actions excluded from the rates and from the breakdowns other than progress; owner, source, domain, risk level and target date: current values; action migrated without history: progress deemed reached on the migration date.')}
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

async function Distribution({ title, rows }: { title: string; rows: StatsRow[] }) {
  const { t } = await getI18n();
  return (
    <Card title={title} note={t('Plan actions excluding Abandoned (of which open)')}>
      <Bars rows={rows.map((r) => ({ key: r.key, label: r.label, value: r.total, extra: fill(r.open > 1 ? t('{n} open items') : t('{n} open item'), { n: r.open }) }))} />
    </Card>
  );
}

/** Barres horizontales d'une seule série (couleur d'accent), valeur et précision écrites à droite ; info-bulle native. */
async function Bars({ rows }: { rows: { key: string; label: string; value: number; extra?: string }[] }) {
  const { t } = await getI18n();
  if (!rows.length) return <div className="vg-muted" style={{ fontSize: 12 }}>{t('No action.')}</div>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 5 }}>
      {rows.map((r) => (
        <li key={r.key || 'vide'} title={`${fill(t('{label}: {value}'), { label: r.label, value: r.value })}${r.extra ? ` (${r.extra})` : ''}`}
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
