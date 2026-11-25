import Link from 'next/link';
import { hrefWith } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { EVENT_STEPS, SEVERITY } from '@/lib/domain';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';
import { EVENT_AGE_DAYS, INJURY_FILTERS, NO_PILOT, eventFilterParams, hasEventFilters, type EventFilters as Filters } from '@/lib/event-filters';

type Option = readonly [string, string];

/**
 * Filtres de la liste des événements (EVT-13), portés par l'URL : formulaire GET (sans JavaScript), puis une puce par
 * filtre retenu pour le retirer. `health` : filtre « blessure » proposé aux seuls rôles habilités aux données de santé.
 * `base` : paramètres conservés (onglet, type, origine, recherche).
 */
export async function EventFilterBar({ filters, base, people, health, pilots }: {
  filters: Filters;
  base: Record<string, string | undefined>;
  /** Personnes proposées comme pilote (annuaire), et libellés des pilotes retenus. */
  people: readonly Option[];
  health: boolean;
  /** Filtre « pilote » proposé (encadrement ; le Salarié ne voit que ses signalements). */
  pilots: boolean;
}) {
  const { t } = await getI18n();
  const params = { ...base, ...eventFilterParams(filters) };
  const without = (patch: Record<string, string | undefined>) => hrefWith('/evenements', params, { ...patch, sel: undefined });
  const pilotLabel = (id: string) => (id === NO_PILOT ? t('no lead') : people.find(([v]) => v === id)?.[1].split(' — ')[0] ?? id);
  const chips: { key: string; label: string; href: string }[] = [
    filters.effectif ? { key: 'effectif', label: t('Workforce occupational accidents, excluding commuting'), href: without({ effectif: undefined }) } : null,
    filters.blessure ? { key: 'blessure', label: fill(t('Injury: {value}'), { value: INJURY_FILTERS.find(([k]) => k === filters.blessure)?.[1].toLowerCase() ?? '' }), href: without({ blessure: undefined }) } : null,
    filters.etape != null ? { key: 'etape', label: fill(t('Stage: {value}'), { value: EVENT_STEPS[filters.etape] }), href: without({ etape: undefined }) } : null,
    filters.pilote ? { key: 'pilote', label: fill(t('Lead: {value}'), { value: pilotLabel(filters.pilote) }), href: without({ pilote: undefined }) } : null,
    filters.du || filters.au ? {
      key: 'periode', href: without({ du: undefined, au: undefined }),
      label: filters.du && filters.au ? fill(t('From {from} to {to}'), { from: fmtDate(filters.du), to: fmtDate(filters.au) }) : filters.du ? fill(t('Since {date}'), { date: fmtDate(filters.du) }) : fill(t('Until {date}'), { date: fmtDate(filters.au!) }),
    } : null,
    filters.gravite != null ? { key: 'gravite', label: fill(t('Severity G{n}'), { n: filters.gravite }), href: without({ gravite: undefined }) } : null,
    filters.anciennete != null ? { key: 'anciennete', label: fill(t('More than {n} days'), { n: filters.anciennete }), href: without({ anciennete: undefined }) } : null,
  ].filter((c): c is { key: string; label: string; href: string } => !!c);
  const active = hasEventFilters(filters);

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <details className="vg-filters" open={active || undefined}>
        <summary className="vg-filters-summary">
          <i className="ph ph-funnel" aria-hidden />{t('Filters')}{active ? ` · ${chips.length}` : ''}
        </summary>
        <form action="/evenements" className="vg-filters-form">
          {Object.entries(base).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
          {filters.effectif && <input type="hidden" name="effectif" value="1" />}
          <label className="vg-filter-field">
            <span>{t('Stage')}</span>
            <select name="etape" className="input" defaultValue={filters.etape != null ? String(filters.etape) : ''}>
              <option value="">{t('Any')}</option>
              {EVENT_STEPS.map((s, i) => <option key={s} value={String(i)}>{s}</option>)}
            </select>
          </label>
          {pilots && (
            <label className="vg-filter-field">
              <span>{t('Lead')}</span>
              <select name="pilote" className="input" defaultValue={filters.pilote ?? ''}>
                <option value="">{t('All')}</option>
                <option value={NO_PILOT}>{t('No lead')}</option>
                {people.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          )}
          <label className="vg-filter-field">
            <span>{t('Severity')}</span>
            <select name="gravite" className="input" defaultValue={filters.gravite != null ? String(filters.gravite) : ''}>
              <option value="">{t('Any')}</option>
              {[1, 2, 3, 4].map((g) => <option key={g} value={String(g)}>{SEVERITY[g]}</option>)}
            </select>
          </label>
          <label className="vg-filter-field">
            <span>{t('Age')}</span>
            <select name="anciennete" className="input" defaultValue={filters.anciennete != null ? String(filters.anciennete) : ''}>
              <option value="">{t('Any')}</option>
              {EVENT_AGE_DAYS.map((d) => <option key={d} value={String(d)}>{fill(t('More than {n} days'), { n: d })}</option>)}
            </select>
          </label>
          {health && (
            <label className="vg-filter-field">
              <span>{t('Injury (OA)')}</span>
              <select name="blessure" className="input" defaultValue={filters.blessure ?? ''}>
                <option value="">{t('Any')}</option>
                {INJURY_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          )}
          <label className="vg-filter-field">
            <span>{t('From')}</span>
            <input type="date" name="du" className="input" defaultValue={filters.du ?? ''} />
          </label>
          <label className="vg-filter-field">
            <span>{t('To')}</span>
            <input type="date" name="au" className="input" defaultValue={filters.au ?? ''} />
          </label>
          <div className="vg-filters-actions">
            <button type="submit" className="btn btn-secondary vg-btn-sm"><i className="ph ph-check" style={{ fontSize: 13 }} aria-hidden />{t('Filter')}</button>
            {active && <Link href={hrefWith('/evenements', base, { sel: undefined })} scroll={false} className="vg-link">{t('Reset')}</Link>}
          </div>
        </form>
      </details>
      {chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {chips.map((c) => (
            <Link key={c.key} href={c.href} scroll={false} className="vg-chip is-on" title={t('Remove this filter')}>
              {c.label}<i className="ph ph-x" style={{ fontSize: 11 }} aria-hidden /><span className="vg-sr-only">{t(': remove this filter')}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
