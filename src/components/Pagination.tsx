import Link from 'next/link';
import { PAGE_SIZES, pageParams, type Page } from '@/lib/pagination';
import { hrefWith } from '@/lib/url-state';

/**
 * Pagination d'une liste servie par le serveur (QUA-21) : liens « Précédent » / « Suivant » et taille de page, portés par
 * l'URL (`?page=`, `?taille=`, src/lib/pagination.ts) ; `params` : paramètres de l'écran à conserver (filtres, recherche),
 * la fiche ouverte (`clear`) est retirée au changement de page. Rien n'est rendu pour une liste courte.
 */
export function Pagination({ path, params, page, label, clear = [] }: {
  path: string;
  params: Record<string, string | undefined>;
  page: Pick<Page<unknown>, 'page' | 'pages' | 'total' | 'from' | 'to' | 'size'>;
  /** Nom accessible de la navigation, ex. « Pages des événements ». */
  label: string;
  clear?: string[];
}) {
  if (page.total <= PAGE_SIZES[0]) return null;
  const cleared = Object.fromEntries(clear.map((k) => [k, undefined]));
  const to = (n: number, size = page.size) => hrefWith(path, params, { ...cleared, ...pageParams(n, size) });
  const prev = page.page > 1 ? to(page.page - 1) : null;
  const next = page.page < page.pages ? to(page.page + 1) : null;
  return (
    <nav className="vg-pager" aria-label={label}>
      <span className="vg-pager-range">{page.from}–{page.to} sur {page.total}</span>
      {page.pages > 1 && (
        <span className="vg-pager-steps">
          {prev
            ? <Link href={prev} scroll={false} className="btn btn-ghost vg-btn-sm" rel="prev"><i className="ph ph-caret-left" aria-hidden />Précédent</Link>
            : <span className="btn btn-ghost vg-btn-sm" aria-disabled="true"><i className="ph ph-caret-left" aria-hidden />Précédent</span>}
          <span aria-current="page">Page {page.page} sur {page.pages}</span>
          {next
            ? <Link href={next} scroll={false} className="btn btn-ghost vg-btn-sm" rel="next">Suivant<i className="ph ph-caret-right" aria-hidden /></Link>
            : <span className="btn btn-ghost vg-btn-sm" aria-disabled="true">Suivant<i className="ph ph-caret-right" aria-hidden /></span>}
        </span>
      )}
      <span className="vg-pager-sizes">
        <span id={`${path.replace(/\W/g, '')}-taille`}>Par page</span>
        <span role="group" aria-labelledby={`${path.replace(/\W/g, '')}-taille`} style={{ display: 'inline-flex', gap: 2 }}>
          {PAGE_SIZES.map((n) => (
            <Link key={n} href={to(1, n)} scroll={false} className={`vg-chip${n === page.size ? ' is-on' : ''}`} aria-current={n === page.size ? 'true' : undefined}>{n}</Link>
          ))}
        </span>
      </span>
    </nav>
  );
}
