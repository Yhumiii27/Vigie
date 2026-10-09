import Link from 'next/link';
import { ClickRow } from '@/components/ClickRow';
import { PageHeader } from '@/components/PageHeader';
import { Aside, CardHead, Dot, ToneTag } from '@/components/ui';
import { fmtDate, fmtDay, fmtDayMonth, fmtLong, fmtMonthAbbr, isoWeek, today } from '@/lib/dates';
import { SEVERITY, SCREENS, TODO_HORIZON_DAYS, TONE, severityTone } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { MAX_TODO, loadDashboard } from '@/lib/data/dashboard';

export default async function DashboardPage() {
  await guard('dashboard');
  const now = today();
  const d = await loadDashboard();

  return (
    <>
      <PageHeader title={SCREENS.dashboard.title} sub={`Semaine ${isoWeek(now)} · données au ${fmtLong(now)}`} />
      <div className="vg-page" style={{ gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          {d.kpis.map((k) => {
            const body = (
              <>
                <div className="vg-eyebrow" style={{ color: 'var(--color-neutral-500)' }}>{k.label}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-.02em', lineHeight: 1.1 }}>{k.value}</span>
                  <span style={{ fontSize: 12, color: k.tone === 'neutral' ? 'var(--color-neutral-400)' : TONE[k.tone].dot }}>{k.sub}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{k.note}</div>
              </>
            );
            const style = { gap: 5, padding: '12px 14px' } as const;
            return k.href
              ? <Link key={k.label} href={k.href} className="card vg-kcard" style={style}>{body}</Link>
              : <div key={k.label} className="card" style={style}>{body}</div>;
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
          <div className="card" style={{ gap: 10 }}>
            <CardHead title="Pyramide des événements sécurité" aside={<Aside>12 mois glissants</Aside>} />
            {d.pyramidTotal === 0
              ? <span className="vg-muted" style={{ fontSize: 12 }}>Aucun événement sécurité sur 12 mois glissants.</span>
              : (
                <div style={{ display: 'grid', gap: 2 }}>
                  {d.pyramid.map((p) => {
                    const body = (
                      <>
                        <span style={{ color: 'var(--color-neutral-400)' }}>{p.label}</span>
                        <div style={{ display: 'flex', justifyContent: 'center' }}><div style={{ height: 16, borderRadius: 3, width: p.w, background: p.color }} /></div>
                        <span style={{ textAlign: 'right', fontWeight: 500 }}>{p.n}</span>
                      </>
                    );
                    const style = { display: 'grid', gridTemplateColumns: '150px 1fr 32px', alignItems: 'center', gap: 10, fontSize: 12, padding: '2px 4px', textDecoration: 'none' } as const;
                    return p.href
                      ? <Link key={p.label} href={p.href} className="vg-row" style={style}>{body}</Link>
                      : <div key={p.label} style={style}>{body}</div>;
                  })}
                </div>
              )}
          </div>

          <div className="card" style={{ gap: 10 }}>
            <CardHead title="Non-conformités par origine" aside={<Aside>{d.ncOpen} ouverte{d.ncOpen > 1 ? 's' : ''}</Aside>} />
            {d.ncOpen === 0
              ? <span className="vg-muted" style={{ fontSize: 12 }}>Aucune non-conformité ni réclamation ouverte.</span>
              : (
                <div style={{ display: 'grid', gap: 2 }}>
                  {d.ncOrigins.map((o) => {
                    const body = (
                      <>
                        <span style={{ color: 'var(--color-neutral-400)' }}>{o.label}</span>
                        <div style={{ height: 8, borderRadius: 2, background: 'var(--color-neutral-900)' }}><div style={{ height: '100%', borderRadius: 2, width: o.w, background: 'var(--color-accent-600)' }} /></div>
                        <span style={{ textAlign: 'right', fontWeight: 500 }}>{o.n}</span>
                      </>
                    );
                    const style = { display: 'grid', gridTemplateColumns: '140px 1fr 24px', alignItems: 'center', gap: 10, fontSize: 12, padding: '3px 4px', textDecoration: 'none' } as const;
                    return o.href
                      ? <Link key={o.label} href={o.href} className="vg-row" style={style}>{body}</Link>
                      : <div key={o.label} style={style}>{body}</div>;
                  })}
                </div>
              )}
            {d.ncHref && <Link href={d.ncHref} className="vg-link" style={{ marginTop: 'auto' }}>Voir les non-conformités et réclamations →</Link>}
          </div>

          <div className="card" style={{ gap: 8 }}>
            <CardHead title={`À traiter dans les ${TODO_HORIZON_DAYS} jours`} aside={
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
                <Link href="/a-faire" className="vg-link">Tout voir →</Link>
                <Aside>{d.todo.length} échéance{d.todo.length > 1 ? 's' : ''}</Aside>
              </span>
            } />
            <div style={{ display: 'grid', gap: 7 }}>
              {d.todo.length === 0 && <span className="vg-muted" style={{ fontSize: 12 }}>Aucune échéance dans les {TODO_HORIZON_DAYS} prochains jours.</span>}
              {d.todo.slice(0, MAX_TODO).map((t, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '36px 1fr', gap: 10, alignItems: 'start' }}>
                  <div style={{ textAlign: 'center', lineHeight: 1.1, color: t.overdue ? TONE.danger.dot : undefined }}>
                    <div style={{ fontSize: 15, fontWeight: 500 }}>{fmtDay(t.date)}</div>
                    <div style={{ fontSize: 10, color: t.overdue ? TONE.danger.dot : 'var(--color-neutral-500)', textTransform: 'uppercase' }}>{fmtMonthAbbr(t.date)}</div>
                  </div>
                  <div style={{ display: 'grid', gap: 3, minWidth: 0 }}>
                    {t.href
                      ? <Link href={t.href} style={{ fontSize: 12.5, color: 'var(--color-text)', textDecoration: 'none' }}>{t.title}</Link>
                      : <span style={{ fontSize: 12.5 }}>{t.title}</span>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--color-neutral-500)' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Dot color={TONE[t.tone].dot} size={6} />{t.kind}</span>
                      <span>{t.who}</span>
                    </div>
                  </div>
                </div>
              ))}
              {d.todoMore > 0 && <Link href="/a-faire" className="vg-link" style={{ paddingLeft: 46 }}>Voir {d.todoMore > 1 ? `les ${d.todoMore} autres échéances` : "l'autre échéance"} →</Link>}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, alignItems: 'start' }}>
          <div className="card" style={{ gap: 8, gridColumn: 'span 2' }}>
            <CardHead title="Derniers signalements" aside={<Link href="/evenements" className="vg-link">Tout voir →</Link>} />
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ fontSize: 12.5, minWidth: 640 }}>
                <thead><tr><th>Réf.</th><th>Date</th><th>Type</th><th>Intitulé</th><th>Lieu</th><th>Gravité</th><th>Étape</th><th>Pilote</th></tr></thead>
                <tbody>
                  {d.latest.length === 0 && (
                    <tr><td colSpan={8} className="vg-muted">Aucun signalement{d.scoped ? ' sur ce site' : ''}. <Link href="/apercu-mobile" className="vg-link">Nouveau signalement →</Link></td></tr>
                  )}
                  {d.latest.map((e) => {
                    const href = `/evenements?sel=${e.id}`;
                    return (
                      <ClickRow key={e.id} href={href}>
                        <td style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}><Link href={href}>{e.id}</Link></td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDayMonth(e.occurredOn)}</td>
                        <td><ToneTag tone={e.typeTone}>{e.typeLabel}</ToneTag></td>
                        <td>{e.title}</td>
                        <td style={{ color: 'var(--color-neutral-400)' }}>{e.location}</td>
                        <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Dot color={TONE[severityTone(e.severity)].dot} />{SEVERITY[e.severity]}</span></td>
                        <td><span className="tag tag-neutral">{e.status}</span></td>
                        <td>{e.pilot}</td>
                      </ClickRow>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {d.featured && (
            <div className="card" style={{ gap: 8, border: '1px solid var(--color-accent-700)' }}>
              <div className="card-kicker">Veille réglementaire</div>
              <div className="card-title" style={{ fontSize: 15 }}>{d.featured.title}</div>
              <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)' }}>
                {d.featured.lead} Applicable au <strong style={{ fontWeight: 500, color: 'var(--color-text)' }}>{fmtLong(d.featured.dueOn)}</strong>
                {d.featured.daysLeft >= 0 ? `, dans ${d.featured.daysLeft} jours` : ''}
                {d.featured.impact ? ` : ${d.featured.impact}` : '.'}
              </p>
              {d.featured.projects != null && (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-.02em', color: 'var(--color-accent-300)' }}>{d.featured.projects}</span>
                  <span style={{ fontSize: 12.5 }}>projets Keystone concernés<br /><span style={{ color: 'var(--color-neutral-500)', fontSize: 11.5 }}>livraison planifiée après le {fmtDate(d.featured.dueOn)}</span></span>
                </div>
              )}
              {d.featured.projectIds.length > 0 && (
                <div style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', fontVariantNumeric: 'tabular-nums', textWrap: 'pretty' }}>{d.featured.projectIds.join(' · ')}</div>
              )}
              {d.featured.href && <Link href={d.featured.href} className="vg-link">Voir l&apos;exigence{d.featured.actionId ? ` et l'analyse d'écart ${d.featured.actionId}` : ''} →</Link>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
