import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { SCREENS } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadSearch } from '@/lib/data/search';
import { SEARCH_LIMIT, SEARCH_MIN, SEARCH_PATH, parseSearchQuery } from '@/lib/rules/search';

export const metadata: Metadata = { title: SCREENS.search.title };

// Recherche globale (TDB-18) : /recherche?q=, ouverte à tout rôle connecté ; résultats groupés par module, chaque module
// filtré comme son propre écran (site sélectionné, périmètre, droits ; src/lib/data/search.ts).
export default async function SearchPage({ searchParams }: PageProps<'/recherche'>) {
  const { site } = await guard('search');
  const sp = await searchParams;
  const raw = typeof sp.q === 'string' ? sp.q : '';
  const q = parseSearchQuery(sp.q);
  const groups = q ? await loadSearch(q) : [];
  const total = groups.reduce((n, g) => n + g.total, 0);
  return (
    <>
      <PageHeader title={SCREENS.search.title} sub={`${site.label} · tous les modules qui vous sont ouverts`} />
      <div className="vg-page" style={{ gap: 14 }}>
        <form action={SEARCH_PATH} role="search" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxWidth: 640 }}>
          <label htmlFor="recherche-q" className="vg-sr-only">Rechercher</label>
          <input id="recherche-q" name="q" type="search" className="input" defaultValue={raw} minLength={SEARCH_MIN} maxLength={100}
            placeholder="Référence (EV-…, AC-…, PP-…) ou intitulé" style={{ flex: 1, minWidth: 200 }} autoFocus={!q} />
          <button type="submit" className="btn btn-primary"><i className="ph ph-magnifying-glass" aria-hidden />Rechercher</button>
        </form>
        {!q ? (
          <p className="vg-muted" style={{ margin: 0, fontSize: 12.5 }}>{raw ? `Au moins ${SEARCH_MIN} caractères.` : 'Saisissez une référence ou quelques mots de l’intitulé.'}</p>
        ) : (
          <p role="status" style={{ margin: 0, fontSize: 12.5 }}>
            {total ? `${total} résultat${total > 1 ? 's' : ''} pour « ${q} »` : `Aucun résultat pour « ${q} » sur ${site.label}.`}
          </p>
        )}
        {groups.map((g) => (
          <section key={g.key} className="card" style={{ gap: 8 }} aria-labelledby={`recherche-${g.key}`}>
            <h2 id={`recherche-${g.key}`} className="card-title" style={{ fontSize: 14, margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
              <i className={`ph ${g.icon}`} aria-hidden />{g.label}<span className="vg-muted" style={{ fontSize: 12, fontWeight: 400 }}>{g.total}</span>
            </h2>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
              {g.items.map((it) => (
                <li key={it.href + it.ref}>
                  <Link href={it.href} className="vg-row" style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '4px 6px', fontSize: 12.5, textDecoration: 'none', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap', minWidth: 110 }}>{it.ref}</span>
                    <span style={{ flex: 1, minWidth: 180 }}>{it.title}</span>
                    {it.sub && <span className="vg-muted" style={{ fontSize: 11.5 }}>{it.sub}</span>}
                  </Link>
                </li>
              ))}
            </ul>
            {g.total > g.items.length && (
              <span style={{ fontSize: 12 }} className="vg-muted">
                {SEARCH_LIMIT} premiers résultats sur {g.total}{g.moreHref ? <> · <Link href={g.moreHref} className="vg-link">Voir dans l&apos;écran</Link></> : ' : précisez la recherche.'}
              </span>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
