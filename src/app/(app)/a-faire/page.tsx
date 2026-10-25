import type { Metadata } from 'next';
import Link from 'next/link';
import { MarkAllReadButton } from '@/components/MarkAllReadButton';
import { PageHeader } from '@/components/PageHeader';
import { TodoLink } from '@/components/TodoLink';
import { Dot, Icon, SegLinks, hrefWith } from '@/components/ui';
import { fmtDay, fmtMonthAbbr } from '@/lib/dates';
import { ALL_SITES, CONTROL_HORIZON_DAYS, SCREENS, TODO_HORIZON_DAYS, TONE, isEmployee } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadTodoPage } from '@/lib/data/dashboard';

// TDB-17 : titre d'onglet de la page.
export const metadata: Metadata = { title: SCREENS.todo.title };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/**
 * Liste complète des échéances visibles (dépassements, horizon 15 jours, contrôles et certificats à 30 jours), filtrable : site
 * sélectionné, plus les échéances de la personne sur les autres sites de son périmètre (TDB-05), qui ouvrent leur site.
 */
export default async function TodoPage({ searchParams }: PageProps<'/a-faire'>) {
  const { role, site } = await guard('todo');
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
        sub={`${plural(n, 'échéance')} · ${d.counts.overdue} en retard${d.counts.elsewhere ? ` · dont ${d.counts.elsewhere} sur d'autres sites` : ''} · horizon ${TODO_HORIZON_DAYS} jours (contrôles et certificats ${CONTROL_HORIZON_DAYS} jours)`} />
      <div className="vg-page" style={{ gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {!employee && (
            <SegLinks options={[
              { href: hrefWith('/a-faire', params, { mes: undefined }), label: `Toutes ${d.counts.all}`, on: !mine },
              { href: hrefWith('/a-faire', params, { mes: '1' }), label: `Mes échéances ${d.counts.mine}`, on: mine },
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
          <span className="vg-muted" style={{ fontSize: 12, marginTop: -6 }}>Vos échéances de tous les sites de votre périmètre ; celles d&apos;un autre site ouvrent ce site.</span>
        )}

        {n === 0 && (
          <div className="card" style={{ gap: 6 }}>
            <span className="vg-muted" style={{ fontSize: 12.5 }}>{filtered ? 'Aucune échéance pour ce filtre.' : 'Aucune échéance.'}</span>
            {filtered && <Link href="/a-faire" className="vg-link">Retirer les filtres</Link>}
          </div>
        )}

        {d.groups.map(([label, rows]) => (
          <section key={label} style={{ display: 'grid', gap: 6 }}>
            <div className="vg-eyebrow">{label} · {rows.length}</div>
            <div className="card" style={{ gap: 2, padding: 6 }}>
              {rows.map((t) => {
                const late = !!t.overdue;
                return (
                  <TodoLink key={t.key} item={{ key: t.key, href: t.href, elsewhere: t.elsewhere, read: t.read }} markRead className={`vg-row${t.href ? '' : ' vg-row-static'}`}
                    style={{ gridTemplateColumns: '36px 1fr', gap: 12, alignItems: 'center', padding: '7px 10px' }}>
                    <span style={{ textAlign: 'center', lineHeight: 1.1, color: late ? TONE.danger.dot : undefined }}>
                      <span style={{ display: 'block', fontSize: 15, fontWeight: 500 }}>{fmtDay(t.date)}</span>
                      <span style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: late ? TONE.danger.dot : 'var(--color-neutral-500)' }}>{fmtMonthAbbr(t.date)}</span>
                    </span>
                    <span style={{ display: 'grid', gap: 3, minWidth: 0 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--color-text)', fontWeight: t.read ? 400 : 500 }}>
                        {!t.read && <span className="vg-unread"><span className="vg-sr-only">Non lue</span></span>}{t.title}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--color-neutral-500)', flexWrap: 'wrap' }}>
                        <Dot color={TONE[t.tone].dot} size={6} />{[t.kind, t.who, SCREENS[t.screen].label, t.siteLabel].filter(Boolean).join(' · ')}
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
