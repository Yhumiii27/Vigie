import Link from 'next/link';
import { MarkAllReadButton } from '@/components/MarkAllReadButton';
import { PageHeader } from '@/components/PageHeader';
import { TodoLink } from '@/components/TodoLink';
import { Dot, Icon, SegLinks, hrefWith } from '@/components/ui';
import { fmtDay, fmtMonthAbbr } from '@/lib/dates';
import { ALL_SITES, CONTROL_HORIZON_DAYS, SCREENS, TODO_HORIZON_DAYS, TONE, isEmployee } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadTodoPage } from '@/lib/data/dashboard';
import { getI18n, screenMetadata } from '@/i18n/server';
import { SCREEN_LABEL_EN } from '@/i18n/nav';
import { fill } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';
import { msgT } from '@/i18n/msg';

// TDB-17 : titre d'onglet de la page.
export const generateMetadata = () => screenMetadata('todo');

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Liste complète des échéances visibles (dépassements, horizon 15 jours, contrôles et certificats à 30 jours), filtrable : site
 * sélectionné, plus les échéances de la personne sur les autres sites de son périmètre (TDB-05), qui ouvrent leur site.
 */
export default async function TodoPage({ searchParams }: PageProps<'/a-faire'>) {
  const { role, site } = await guard('todo');
  const { t } = await getI18n();
  const screenLabel = (k: keyof typeof SCREENS) => (SCREEN_LABEL_EN[k] ? t(SCREEN_LABEL_EN[k]) : SCREENS[k].label);
  const sp = await searchParams;
  // Un salarié ne voit que ses échéances : pas de bascule « Toutes / Mes échéances ».
  const employee = isEmployee(role);
  const mine = !employee && one(sp.mes) === '1';
  const d = await loadTodoPage({ domain: one(sp.domaine), mine });
  const domain = d.domain;
  const params = { domaine: domain, mes: mine ? '1' : undefined };
  const filtered = !!domain || mine;
  const n = d.items.length;

  return (
    <>
      <PageHeader title={SCREENS.todo.title}
        sub={[
          fill(n > 1 ? t('{n} deadlines') : t('{n} deadline'), { n }),
          fill(t('{n} overdue'), { n: d.counts.overdue }),
          d.counts.elsewhere ? fill(t('including {n} on other sites'), { n: d.counts.elsewhere }) : '',
          fill(t('horizon {n} days (inspections and certificates {m} days)'), { n: TODO_HORIZON_DAYS, m: CONTROL_HORIZON_DAYS }),
        ].filter(Boolean).join(' · ')} />
      <div className="vg-page" style={{ gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {!employee && (
            <SegLinks options={[
              { href: hrefWith('/a-faire', params, { mes: undefined }), label: fill(t('All {n}'), { n: d.counts.all }), on: !mine },
              { href: hrefWith('/a-faire', params, { mes: '1' }), label: fill(t('My deadlines {n}'), { n: d.counts.mine }), on: mine },
            ]} />
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
            {d.domains.map((x) => (
              <Link key={x.key} href={hrefWith('/a-faire', params, { domaine: x.key === domain ? undefined : x.key })} scroll={false}
                className={`vg-chip${x.key === domain ? ' is-on' : ''}`}>
                <Icon name={x.icon} size={13} />{x.label}<span style={{ color: 'var(--color-neutral-500)' }}>{x.n}</span>
              </Link>
            ))}
          </div>
          {/* Portée : la liste affichée (filtres domaine et « Mes échéances » compris). */}
          <MarkAllReadButton scope="todo" filter={{ domain, mine }} disabled={!d.counts.unread} />
        </div>
        {mine && site.id !== ALL_SITES && (
          <span className="vg-muted" style={{ fontSize: 12, marginTop: -6 }}>{t('Your deadlines from every site of your scope; those of another site open that site.')}</span>
        )}

        {n === 0 && (
          <div className="card" style={{ gap: 6 }}>
            <span className="vg-muted" style={{ fontSize: 12.5 }}>{filtered ? t('No deadline for this filter.') : t('No deadline.')}</span>
            {filtered && <Link href="/a-faire" className="vg-link">{t('Remove the filters')}</Link>}
          </div>
        )}

        {d.groups.map(([label, rows]) => (
          <section key={label} style={{ display: 'grid', gap: 6 }}>
            <div className="vg-eyebrow">{label} · {rows.length}</div>
            <div className="card" style={{ gap: 2, padding: 6 }}>
              {rows.map((item) => {
                const late = !!item.overdue;
                return (
                  <TodoLink key={item.key} item={{ key: item.key, href: item.href, elsewhere: item.elsewhere, read: item.read }} markRead className={`vg-row${item.href ? '' : ' vg-row-static'}`}
                    style={{ gridTemplateColumns: '36px 1fr', gap: 12, alignItems: 'center', padding: '7px 10px' }}>
                    <span style={{ textAlign: 'center', lineHeight: 1.1, color: late ? TONE.danger.dot : undefined }}>
                      <span style={{ display: 'block', fontSize: 15, fontWeight: 500 }}>{fmtDay(item.date)}</span>
                      <span style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: late ? TONE.danger.dot : 'var(--color-neutral-500)' }}>{fmtMonthAbbr(item.date)}</span>
                    </span>
                    <span style={{ display: 'grid', gap: 3, minWidth: 0 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--color-text)', fontWeight: item.read ? 400 : 500 }}>
                        {!item.read && <span className="vg-unread"><span className="vg-sr-only">{t('Unread')}</span></span>}{item.titleText ? msgT(t)(item.titleText) : item.title}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--color-neutral-500)', flexWrap: 'wrap' }}>
                        <Dot color={TONE[item.tone].dot} size={6} />{[labelT(t)(item.kind), item.who, screenLabel(item.screen), item.siteLabel].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </TodoLink>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
