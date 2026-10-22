import Link from 'next/link';
import { hrefWith } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { EVENT_STEPS, SEVERITY } from '@/lib/domain';
import { EVENT_AGE_DAYS, INJURY_FILTERS, NO_PILOT, eventFilterParams, hasEventFilters, type EventFilters as Filters } from '@/lib/event-filters';

type Option = readonly [string, string];

/**
 * Filtres de la liste des événements (EVT-13), portés par l'URL : formulaire GET (sans JavaScript), puis une puce par
 * filtre retenu pour le retirer. `health` : filtre « blessure » proposé aux seuls rôles habilités aux données de santé.
 * `base` : paramètres conservés (onglet, type, origine, recherche).
 */
export function EventFilterBar({ filters, base, people, health, pilots }: {
  filters: Filters;
  base: Record<string, string | undefined>;
  /** Personnes proposées comme pilote (annuaire), et libellés des pilotes retenus. */
  people: readonly Option[];
  health: boolean;
  /** Filtre « pilote » proposé (encadrement ; le Salarié ne voit que ses signalements). */
  pilots: boolean;
}) {
  const params = { ...base, ...eventFilterParams(filters) };
  const without = (patch: Record<string, string | undefined>) => hrefWith('/evenements', params, { ...patch, sel: undefined });
  const pilotLabel = (id: string) => (id === NO_PILOT ? 'sans pilote' : people.find(([v]) => v === id)?.[1].split(' — ')[0] ?? id);
  const chips: { key: string; label: string; href: string }[] = [
    filters.effectif ? { key: 'effectif', label: "AT de l'effectif, hors trajet", href: without({ effectif: undefined }) } : null,
    filters.blessure ? { key: 'blessure', label: `Blessure : ${INJURY_FILTERS.find(([k]) => k === filters.blessure)?.[1].toLowerCase()}`, href: without({ blessure: undefined }) } : null,
    filters.etape != null ? { key: 'etape', label: `Étape : ${EVENT_STEPS[filters.etape]}`, href: without({ etape: undefined }) } : null,
    filters.pilote ? { key: 'pilote', label: `Pilote : ${pilotLabel(filters.pilote)}`, href: without({ pilote: undefined }) } : null,
    filters.du || filters.au ? {
      key: 'periode', href: without({ du: undefined, au: undefined }),
      label: filters.du && filters.au ? `Du ${fmtDate(filters.du)} au ${fmtDate(filters.au)}` : filters.du ? `Depuis le ${fmtDate(filters.du)}` : `Jusqu'au ${fmtDate(filters.au!)}`,
    } : null,
    filters.gravite != null ? { key: 'gravite', label: `Gravité G${filters.gravite}`, href: without({ gravite: undefined }) } : null,
    filters.anciennete != null ? { key: 'anciennete', label: `Plus de ${filters.anciennete} jours`, href: without({ anciennete: undefined }) } : null,
  ].filter((c): c is { key: string; label: string; href: string } => !!c);
  const active = hasEventFilters(filters);

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <details className="vg-filters" open={active || undefined}>
        <summary className="vg-filters-summary">
          <i className="ph ph-funnel" aria-hidden />Filtres{active ? ` · ${chips.length}` : ''}
        </summary>
        <form action="/evenements" className="vg-filters-form">
          {Object.entries(base).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
          {filters.effectif && <input type="hidden" name="effectif" value="1" />}
          <label className="vg-filter-field">
            <span>Étape</span>
            <select name="etape" className="input" defaultValue={filters.etape != null ? String(filters.etape) : ''}>
              <option value="">Toutes</option>
              {EVENT_STEPS.map((s, i) => <option key={s} value={String(i)}>{s}</option>)}
            </select>
          </label>
          {pilots && (
            <label className="vg-filter-field">
              <span>Pilote</span>
              <select name="pilote" className="input" defaultValue={filters.pilote ?? ''}>
                <option value="">Tous</option>
                <option value={NO_PILOT}>Sans pilote</option>
                {people.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          )}
          <label className="vg-filter-field">
            <span>Gravité</span>
            <select name="gravite" className="input" defaultValue={filters.gravite != null ? String(filters.gravite) : ''}>
              <option value="">Toutes</option>
              {[1, 2, 3, 4].map((g) => <option key={g} value={String(g)}>{SEVERITY[g]}</option>)}
            </select>
          </label>
          <label className="vg-filter-field">
            <span>Ancienneté</span>
            <select name="anciennete" className="input" defaultValue={filters.anciennete != null ? String(filters.anciennete) : ''}>
              <option value="">Toutes</option>
              {EVENT_AGE_DAYS.map((d) => <option key={d} value={String(d)}>Plus de {d} jours</option>)}
            </select>
          </label>
          {health && (
            <label className="vg-filter-field">
              <span>Blessure (AT)</span>
              <select name="blessure" className="input" defaultValue={filters.blessure ?? ''}>
                <option value="">Toutes</option>
                {INJURY_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          )}
          <label className="vg-filter-field">
            <span>Du</span>
            <input type="date" name="du" className="input" defaultValue={filters.du ?? ''} />
          </label>
          <label className="vg-filter-field">
            <span>Au</span>
            <input type="date" name="au" className="input" defaultValue={filters.au ?? ''} />
          </label>
          <div className="vg-filters-actions">
            <button type="submit" className="btn btn-secondary vg-btn-sm"><i className="ph ph-check" style={{ fontSize: 13 }} />Filtrer</button>
            {active && <Link href={hrefWith('/evenements', base, { sel: undefined })} scroll={false} className="vg-link">Réinitialiser</Link>}
          </div>
        </form>
      </details>
      {chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {chips.map((c) => (
            <Link key={c.key} href={c.href} scroll={false} className="vg-chip is-on" title="Retirer ce filtre">
              {c.label}<i className="ph ph-x" style={{ fontSize: 11 }} aria-hidden />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
