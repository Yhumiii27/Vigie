import { getI18n, screenMetadata } from '@/i18n/server';
import { labelT } from '@/i18n/labels';
import { fill } from '@/i18n/translate';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { SCREENS } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadSearch } from '@/lib/data/search';
import { SEARCH_LIMIT, SEARCH_MIN, SEARCH_PATH, parseSearchQuery } from '@/lib/rules/search';

export const generateMetadata = () => screenMetadata('search');

// Recherche globale (TDB-18) : /recherche?q=, ouverte à tout rôle connecté ; résultats groupés par module, chaque module
// filtré comme son propre écran (site sélectionné, périmètre, droits ; src/lib/data/search.ts).
export default async function SearchPage({ searchParams }: PageProps<'/recherche'>) {
  const { site } = await guard('search');
  const [sp, { t }] = await Promise.all([searchParams, getI18n()]);
  const lt = labelT(t);
  const raw = typeof sp.q === 'string' ? sp.q : '';
  const q = parseSearchQuery(sp.q);
  const groups = q ? await loadSearch(q) : [];
  const total = groups.reduce((n, g) => n + g.total, 0);
  return (
    <>
      <PageHeader title={SCREENS.search.title} sub={`${site.label}${t(' · all the modules open to you')}`} />
      <div className="vg-page" style={{ gap: 14 }}>
        <form action={SEARCH_PATH} role="search" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxWidth: 640 }}>
          <label htmlFor="recherche-q" className="vg-sr-only">{t('Search#verb')}</label>
          <input id="recherche-q" name="q" type="search" className="input" defaultValue={raw} minLength={SEARCH_MIN} maxLength={100}
            placeholder={t('Reference (EV-…, AC-…, PP-…) or title')} style={{ flex: 1, minWidth: 200 }} autoFocus={!q} />
          <button type="submit" className="btn btn-primary"><i className="ph ph-magnifying-glass" aria-hidden />{t('Search#verb')}</button>
        </form>
        {!q ? (
          <p className="vg-muted" style={{ margin: 0, fontSize: 12.5 }}>{raw ? fill(t('At least {n} characters.'), { n: SEARCH_MIN }) : t('Type a reference or a few words of the title.')}</p>
        ) : (
          <p role="status" style={{ margin: 0, fontSize: 12.5 }}>
            {total ? fill(total > 1 ? t('{n} results for “{q}”') : t('{n} result for “{q}”'), { n: total, q }) : fill(t('No result for “{q}” on {site}.'), { q, site: site.label })}
          </p>
        )}
        {groups.map((g) => (
          <section key={g.key} className="card" style={{ gap: 8 }} aria-labelledby={`recherche-${g.key}`}>
            <h2 id={`recherche-${g.key}`} className="card-title" style={{ fontSize: 14, margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
              <i className={`ph ${g.icon}`} aria-hidden />{lt(g.label)}<span className="vg-muted" style={{ fontSize: 12, fontWeight: 400 }}>{g.total}</span>
            </h2>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
              {g.items.map((it) => (
                <li key={it.href + it.ref}>
                  <Link href={it.href} className="vg-row" style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '4px 6px', fontSize: 12.5, textDecoration: 'none', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap', minWidth: 110 }}>{it.ref}</span>
                    <span style={{ flex: 1, minWidth: 180 }}>{it.title}</span>
                    {it.sub && <span className="vg-muted" style={{ fontSize: 11.5 }}>{lt(it.sub)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
            {g.total > g.items.length && (
              <span style={{ fontSize: 12 }} className="vg-muted">
                {fill(t('{n} first results out of {total}'), { n: SEARCH_LIMIT, total: g.total })}{g.moreHref ? <> · <Link href={g.moreHref} className="vg-link">{t('See in the screen')}</Link></> : t(': refine the search.')}
              </span>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
