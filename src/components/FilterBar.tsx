import Link from 'next/link';
import { hrefWith } from '@/components/ui';

type Option = readonly [string, string];

/** Critère d'une liste : liste de choix (`options`), ou recherche libre (`search`). */
export type FilterField =
  | { name: string; label: string; options: readonly Option[]; all?: string; value: string | undefined }
  | { name: string; label: string; search: true; placeholder?: string; value: string | undefined };

/**
 * Filtres d'une liste portés par l'URL (convention UX-12 : un paramètre par critère, `?q=` pour la recherche, valeur par
 * défaut omise) : formulaire GET (sans JavaScript) replié sous « Filtres », puis une puce par filtre retenu pour le retirer.
 * `base` : paramètres conservés (onglet, portée…) ; la fiche ouverte (`detail`) est retirée à chaque changement de filtre.
 * Les choix proposés sont ceux de la liste déjà chargée pour la personne : un filtre ne révèle rien hors de son périmètre.
 */
export function FilterBar({ path, base, fields, detail = [] }: {
  path: string;
  base: Record<string, string | undefined>;
  fields: readonly FilterField[];
  /** Paramètres de fiche ouverte (DETAIL_PARAMS) retirés quand un filtre change. */
  detail?: readonly string[];
}) {
  const values = Object.fromEntries(fields.map((f) => [f.name, f.value || undefined]));
  const params = { ...base, ...values };
  const reset = Object.fromEntries(detail.map((d) => [d, undefined]));
  const labelOf = (f: FilterField) => ('search' in f ? `« ${f.value} »` : f.options.find(([v]) => v === f.value)?.[1] ?? f.value);
  const chips = fields.filter((f) => f.value).map((f) => ({
    key: f.name, label: `${f.label} : ${labelOf(f)}`, href: hrefWith(path, params, { ...reset, [f.name]: undefined }),
  }));
  const active = chips.length > 0;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <details className="vg-filters" open={active || undefined}>
        <summary className="vg-filters-summary">
          <i className="ph ph-funnel" aria-hidden />Filtres{active ? ` · ${chips.length}` : ''}
        </summary>
        <form action={path} className="vg-filters-form">
          {Object.entries(base).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
          {fields.map((f) => (
            <label key={f.name} className="vg-filter-field">
              <span>{f.label}</span>
              {'search' in f ? (
                <input type="search" name={f.name} className="input" defaultValue={f.value ?? ''} placeholder={f.placeholder} maxLength={100} />
              ) : (
                <select name={f.name} className="input" defaultValue={f.value ?? ''}>
                  <option value="">{f.all ?? 'Tous'}</option>
                  {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              )}
            </label>
          ))}
          <div className="vg-filters-actions">
            <button type="submit" className="btn btn-secondary vg-btn-sm"><i className="ph ph-check" style={{ fontSize: 13 }} aria-hidden />Filtrer</button>
            {active && <Link href={hrefWith(path, base, reset)} scroll={false} className="vg-link">Réinitialiser</Link>}
          </div>
        </form>
      </details>
      {chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {chips.map((c) => (
            <Link key={c.key} href={c.href} scroll={false} className="vg-chip is-on">
              {c.label}<i className="ph ph-x" style={{ fontSize: 11 }} aria-hidden /><span className="vg-sr-only"> : retirer ce filtre</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
