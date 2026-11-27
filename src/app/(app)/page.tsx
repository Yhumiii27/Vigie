import Link from 'next/link';
import { ClickRow } from '@/components/ClickRow';
import { PageHeader } from '@/components/PageHeader';
import { TodoLink } from '@/components/TodoLink';
import { Aside, CardHead, Dot, ToneTag } from '@/components/ui';
import { fmtDate, fmtDay, fmtDayMonth, fmtLong, fmtMonthAbbr, isoWeek } from '@/lib/dates';
import { isDemo } from '@/lib/config';
import { today } from '@/lib/today';
import { SEVERITY, SCREENS, TODO_HORIZON_DAYS, TONE, canSeeHealth, severityTone } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { MAX_TODO, loadDashboard } from '@/lib/data/dashboard';
import { loadSitesMap } from '@/lib/data/sites-map';
import { SitesMap } from '@/components/dashboard/SitesMap';
import { DashboardCustomizer } from '@/components/dashboard/DashboardCustomizer';
import { loadDashboardCards } from '@/lib/data/dashboard-cards';
import { CARD_IDS, cardAllowed } from '@/lib/dashboard-cards';
import { canReadDgi } from '@/lib/rules/dgi';
import { getI18n, screenMetadata } from '@/i18n/server';
import { fill } from '@/i18n/translate';

// TDB-17 : titre d'onglet de la page.
export const generateMetadata = () => screenMetadata('dashboard');

export default async function DashboardPage() {
  const session = await guard('dashboard');
  const { t } = await getI18n();
  const now = today();
  // TDB-19 : animateur QHSE et direction — cartes choisies dans le catalogue (disposition personnelle, du rôle ou de Vigie).
  const [d, sitesMap, custom] = await Promise.all([loadDashboard(), loadSitesMap(), loadDashboardCards()]);
  const kpis = custom ? custom.cards.map((c) => ({ ...c, subHref: null as string | null })) : d.kpis.map((k) => ({ ...k, options: null as string | null }));
  const viewer = { health: canSeeHealth(session.role), dgi: canReadDgi(session) };

  return (
    <>
      <PageHeader title={SCREENS.dashboard.title} sub={fill(t('Week {week} · data as of {date}'), { week: isoWeek(now), date: fmtLong(now) })}
        actions={custom ? <DashboardCustomizer layout={custom.layout} allowed={CARD_IDS.filter((id) => cardAllowed(id, viewer))} roleLayouts={custom.roleLayouts} /> : undefined} />
      <div className="vg-page" style={{ gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          {custom && kpis.length === 0 && <div className="card"><span className="vg-muted" style={{ fontSize: 12 }}>{t('No card chosen: “Customize” to add some.')}</span></div>}
          {kpis.map((k) => {
            const body = (
              <>
                <div className="vg-eyebrow" style={{ color: 'var(--color-neutral-500)' }}>{k.label}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-.02em', lineHeight: 1.1 }}>{k.value}</span>
                  {k.subHref ? (
                    // TDB-12 : « dont n > 30 j » ouvre la liste filtrée par ancienneté (lien distinct de la carte).
                    <Link href={k.subHref} className="vg-kcard-sub" style={{ fontSize: 12, color: k.tone === 'neutral' ? 'var(--color-neutral-400)' : TONE[k.tone].dot }}>{k.sub}</Link>
                  ) : (
                    <span style={{ fontSize: 12, color: k.tone === 'neutral' ? 'var(--color-neutral-400)' : TONE[k.tone].dot }}>{k.sub}</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{k.note}</div>
                {k.options && <div style={{ fontSize: 11, color: 'var(--vg-text-muted)' }}>{k.options}</div>}
              </>
            );
            const style = { gap: 5, padding: '12px 14px' } as const;
            // Carte cliquable avec un second lien (« > 30 j ») : lien principal étendu à la carte, sans liens imbriqués.
            if (k.href && k.subHref) {
              return (
                <div key={k.label} className="card vg-kcard vg-kcard-split" style={style}>
                  <Link href={k.href} className="vg-kcard-main" aria-label={fill(t('{label}: {value}'), { label: k.label, value: k.value })} />
                  {body}
                </div>
              );
            }
            return k.href
              ? <Link key={k.label} href={k.href} className="card vg-kcard" style={style}>{body}</Link>
              : <div key={k.label} className="card" style={style}>{body}</div>;
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 12 }}>
          <div className="card" style={{ gap: 10 }}>
            <CardHead title={t('Safety event pyramid')} aside={<Aside>{t('Rolling 12 months')}</Aside>} />
            {d.pyramidTotal === 0
              ? <span className="vg-muted" style={{ fontSize: 12 }}>{t('No safety event over the rolling 12 months.')}</span>
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
                    const style = { display: 'grid', gridTemplateColumns: '150px 1fr 32px', alignItems: 'center', gap: 10, fontSize: 12, padding: '2px 4px', minHeight: 24, textDecoration: 'none' } as const;
                    return p.href
                      ? <Link key={p.label} href={p.href} className="vg-row" style={style}>{body}</Link>
                      : <div key={p.label} style={style}>{body}</div>;
                  })}
                </div>
              )}
          </div>

          <div className="card" style={{ gap: 10 }}>
            <CardHead title={t('Nonconformities by origin')} aside={<Aside>{fill(d.ncOpen > 1 ? t('{n} open items') : t('{n} open item'), { n: d.ncOpen })}</Aside>} />
            {d.ncOpen === 0
              ? <span className="vg-muted" style={{ fontSize: 12 }}>{t('No open nonconformity or complaint.')}</span>
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
            {d.ncHref && <Link href={d.ncHref} className="vg-link" style={{ marginTop: 'auto' }}>{t('See nonconformities and complaints →')}</Link>}
          </div>

          <div className="card" style={{ gap: 8 }}>
            <CardHead title={fill(t('To handle within {n} days'), { n: TODO_HORIZON_DAYS })} aside={
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
                <Link href="/a-faire" className="vg-link">{t('See all →')}</Link>
                <Aside>{fill(d.todo.length > 1 ? t('{n} deadlines') : t('{n} deadline'), { n: d.todo.length })}</Aside>
              </span>
            } />
            <div style={{ display: 'grid', gap: 7 }}>
              {d.todo.length === 0 && <span className="vg-muted" style={{ fontSize: 12 }}>{fill(t('No deadline in the next {n} days.'), { n: TODO_HORIZON_DAYS })}</span>}
              {d.todo.slice(0, MAX_TODO).map((item) => (
                <div key={item.key} style={{ display: 'grid', gridTemplateColumns: '36px 1fr', gap: 10, alignItems: 'start' }}>
                  <div style={{ textAlign: 'center', lineHeight: 1.1, color: item.overdue ? TONE.danger.dot : undefined }}>
                    <div style={{ fontSize: 15, fontWeight: 500 }}>{fmtDay(item.date)}</div>
                    <div style={{ fontSize: 11, color: item.overdue ? TONE.danger.dot : 'var(--color-neutral-500)', textTransform: 'uppercase' }}>{fmtMonthAbbr(item.date)}</div>
                  </div>
                  <div style={{ display: 'grid', gap: 3, minWidth: 0 }}>
                    <TodoLink item={{ key: item.key, href: item.href, elsewhere: item.elsewhere, read: item.read }} markRead style={{ fontSize: 12.5, color: 'var(--color-text)', textDecoration: 'none' }}>{item.title}</TodoLink>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11, color: 'var(--color-neutral-500)' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Dot color={TONE[item.tone].dot} size={6} />{item.kind}</span>
                      <span>{[item.who, item.siteLabel].filter(Boolean).join(' · ')}</span>
                    </div>
                  </div>
                </div>
              ))}
              {d.todoMore > 0 && <Link href="/a-faire" className="vg-link" style={{ paddingLeft: 46 }}>{d.todoMore > 1 ? fill(t('See the {n} other deadlines →'), { n: d.todoMore }) : t('See the other deadline →')}</Link>}
            </div>
          </div>
        </div>

        {/* « Derniers signalements » sur deux colonnes quand la grille en a deux (requête de conteneur, vigie.css). */}
        <div className="vg-dash-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: 12, alignItems: 'start' }}>
          <div className="card vg-span-2" style={{ gap: 8 }}>
            <CardHead title={t('Latest reports')} aside={<Link href="/evenements" className="vg-link">{t('See all →')}</Link>} />
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ fontSize: 12.5, minWidth: 640 }}>
                <thead><tr><th>{t('Ref.')}</th><th>{t('Date')}</th><th>{t('Type')}</th><th>{t('Title')}</th>{!d.scoped && <th>{t('Site')}</th>}<th>{t('Location')}</th><th>{t('Severity')}</th><th>{t('Stage')}</th><th>{t('Lead')}</th></tr></thead>
                <tbody>
                  {d.latest.length === 0 && (
                    <tr><td colSpan={d.scoped ? 8 : 9} className="vg-muted">{d.scoped ? t('No report on this site.') : t('No report.')} <Link href={isDemo() ? '/apercu-mobile' : '/signaler'} className="vg-link">{t('New report →')}</Link></td></tr>
                  )}
                  {d.latest.map((e) => {
                    const href = `/evenements?sel=${e.id}`;
                    return (
                      <ClickRow key={e.id} href={href}>
                        <td style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}><Link href={href}>{e.id}</Link></td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDayMonth(e.occurredOn)}</td>
                        <td><ToneTag tone={e.typeTone}>{e.typeLabel}</ToneTag></td>
                        <td>{e.title}</td>
                        {/* TDB-15 : site du signalement en vue « Tous les sites ». */}
                        {!d.scoped && <td style={{ whiteSpace: 'nowrap' }}>{e.siteLabel}</td>}
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
              <div className="card-kicker">{t('Regulatory watch')}</div>
              <div className="card-title" style={{ fontSize: 15 }}>{d.featured.title}</div>
              <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)' }}>
                {d.featured.lead} {d.featured.prefix} <strong style={{ fontWeight: 500, color: 'var(--color-text)' }}>{fmtLong(d.featured.dueOn)}</strong>
                {d.featured.daysLeft > 0 ? fill(d.featured.daysLeft > 1 ? t(', in {n} days') : t(', in {n} day'), { n: d.featured.daysLeft }) : ''}
                {d.featured.impact ? fill(t(': {impact}'), { impact: d.featured.impact }) : '.'}
              </p>
              {/* TDB-14 : une fois applicable, l'état de conformité évalué par le pilote. */}
              {d.featured.state && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span className="vg-muted">{t('Compliance status:')}</span><ToneTag tone={d.featured.state.tone}>{d.featured.state.label}</ToneTag>
                </span>
              )}
              {d.featured.projects != null && (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-.02em', color: 'var(--color-accent-300)' }}>{d.featured.projects}</span>
                  <span style={{ fontSize: 12.5 }}>{t('Keystone projects concerned')}<br /><span style={{ color: 'var(--color-neutral-500)', fontSize: 11.5 }}>{fill(t('delivery planned after {date}'), { date: fmtDate(d.featured.dueOn) })}</span></span>
                </div>
              )}
              {d.featured.href && <Link href={d.featured.href} className="vg-link">{d.featured.actionId ? fill(t('See the requirement and gap analysis {id} →'), { id: d.featured.actionId }) : t('See the requirement →')}</Link>}
            </div>
          )}
        </div>
        {/* PRV-24 : carte des sites et de leurs indicateurs, sous « Tous les sites » seulement. */}
        {sitesMap && (!custom || custom.showSitesMap) && <SitesMap {...sitesMap} />}
      </div>
    </>
  );
}
