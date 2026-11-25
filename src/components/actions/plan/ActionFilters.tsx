import Form from 'next/form';
import Link from 'next/link';
import { Icon, SegLinks, hrefWith } from '@/components/ui';
import { PLAN_SCOPES, PLAN_VIEWS, actionFiltersParams, type ActionFilters } from '@/lib/action-rules';
import { ACTION_AVANCEMENTS, ACTION_PRIORITIES, ACTION_SOURCES, AVANCEMENT, PRIORITY_KEYS, SOURCE_KEYS } from '@/lib/domain';
import type { Option } from '@/lib/form-options';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';

// Barre de filtres de la vue générale (spec § 16) : vue, affichage (?etat=), avancement, responsable (dont « Mes
// actions »), source, priorité, « À compléter », texte libre. Tout est porté par l'URL (actionFiltersParams + hrefWith),
// commun aux trois vues ; changer un filtre ferme la fiche ouverte (?action= retiré).

const PATH = '/actions';

/** Paramètres d'URL des filtres actifs, sans la fiche ouverte. */
export const planParams = (f: ActionFilters) => actionFiltersParams({ ...f, action: null });

/** Avancement affiché par le filtre : ?retard=1 vaut « En retard ». */
const shownAvancement = (f: ActionFilters) => f.avancement ?? (f.retard ? 'en_retard' : null);

/** Un filtre (hors vue et affichage) est-il actif ? */
export const hasFilters = (f: ActionFilters) =>
  !!(f.avancement || f.retard || f.responsable || f.mes || f.source || f.priorite || f.completer || f.q);

type Props = {
  filters: ActionFilters;
  /** Responsables des actions lisibles (loadActionPlan) ; vide pour le Salarié (filtre sans objet). */
  responsables: readonly Option[];
  counts: { abandoned: number; olderVerified: number; toComplete: number };
  /** Salarié : ses actions seulement, pas de filtre Responsable ni « Mes actions ». */
  employee: boolean;
  userName: string;
  /** Nombre d'actions de la personne dans l'affichage et les autres filtres (« Mes actions »). */
  mineCount: number;
};

export function ActionFiltersBar({ filters: f, responsables, counts, employee, userName, mineCount }: Props) {
  const params = planParams(f);
  const href = (patch: Record<string, string | undefined>) => hrefWith(PATH, params, patch);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <div className="vg-plan-views" style={{ maxWidth: '100%' }}>
        <SegLinks pad="5px 11px" options={PLAN_VIEWS.filter(([key]) => !employee || key !== 'statistiques')
          .map(([key, label, icon]) => ({ href: href({ vue: key === 'liste' ? undefined : key, mois: undefined }), label, icon, on: f.vue === key }))} />
      </div>
      {/* Statistiques (ACT-29) : tout le plan du site sélectionné, sans les filtres de la liste. */}
      {f.vue !== 'statistiques' && <ListFilters f={f} href={href} responsables={responsables} counts={counts} employee={employee} userName={userName} mineCount={mineCount} params={params} />}
    </div>
  );
}

async function ListFilters({ f, href, responsables, counts, employee, userName, mineCount, params }: Omit<Props, 'filters'> & {
  f: ActionFilters; href: (patch: Record<string, string | undefined>) => string; params: ReturnType<typeof planParams>;
}) {
  const { t } = await getI18n();
  const avancement = shownAvancement(f);
  const avancementLabel = avancement === 'ouvertes' ? t('open actions') : avancement === 'en_retard' ? t('overdue') : avancement ? AVANCEMENT[avancement].label : t('all');
  const responsable = f.mes ? userName : f.responsable ? responsables.find(([id]) => id === f.responsable)?.[1] ?? t('person who left') : null;
  const scope = PLAN_SCOPES.find(([k]) => k === f.etat) ?? PLAN_SCOPES[0];
  const filtered = hasFilters(f);
  return (
    <>
      <Filter label={fill(t('Display: {value}'), { value: scope[1].toLowerCase() })} icon={scope[2]}
        options={PLAN_SCOPES.map(([k, label]) => ({
          href: href({ etat: k || undefined }), on: f.etat === k,
          label: k === 'historique' ? fill(counts.olderVerified > 1 ? t('{label} ({n} verified actions over 30 days old)') : t('{label} ({n} verified action over 30 days old)'), { label, n: counts.olderVerified })
            : k === 'abandonnees' ? `${label} (${counts.abandoned})` : label,
        }))} />
      <Filter label={fill(t('Progress: {value}'), { value: avancementLabel })} icon="ph-chart-bar"
        options={[
          { href: href({ avancement: undefined, retard: undefined }), label: t('All progress states'), on: !avancement },
          { href: href({ avancement: 'ouvertes', retard: undefined }), label: t('Open (To do → 80 %)'), on: avancement === 'ouvertes' },
          { href: href({ avancement: 'en_retard', retard: undefined }), label: t('Overdue'), on: avancement === 'en_retard' },
          ...ACTION_AVANCEMENTS.filter((k) => k !== 'abandonnee').map((k) => ({ href: href({ avancement: k, retard: undefined }), label: AVANCEMENT[k].label, on: avancement === k })),
        ]} />
      {!employee && (
        <>
          <Filter label={fill(t('Owner: {value}'), { value: responsable ?? t('all') })} icon="ph-user"
            options={[
              { href: href({ responsable: undefined, mes: undefined }), label: t('All owners'), on: !responsable },
              ...responsables.map(([id, name]) => ({ href: href({ responsable: id, mes: undefined }), label: name, on: !f.mes && f.responsable === id })),
            ]} />
          <Link href={href({ mes: f.mes ? undefined : '1', responsable: undefined })} scroll={false}
            className={`vg-chip${f.mes ? ' is-on' : ''}`} style={{ padding: '5px 10px', fontSize: 12, lineHeight: 1.2 }}>
            <Icon name="ph-user-circle" size={13} />{t('My actions')}<span style={{ opacity: 0.6 }}>{mineCount}</span>
          </Link>
        </>
      )}
      <Filter label={fill(t('Source: {value}'), { value: f.source ? ACTION_SOURCES[f.source].label : t('any') })} icon="ph-funnel"
        options={[
          { href: href({ source: undefined }), label: t('All sources'), on: !f.source },
          ...SOURCE_KEYS.map((k) => ({ href: href({ source: k }), label: ACTION_SOURCES[k].label, on: f.source === k })),
        ]} />
      <Filter label={fill(t('Priority: {value}'), { value: f.priorite ? ACTION_PRIORITIES[f.priorite].label.toLowerCase() : t('any') })} icon="ph-flag"
        options={[
          { href: href({ priorite: undefined }), label: t('All priorities'), on: !f.priorite },
          ...PRIORITY_KEYS.map((k) => ({ href: href({ priorite: k }), label: ACTION_PRIORITIES[k].label, on: f.priorite === k })),
        ]} />
      {!employee && (f.completer || counts.toComplete > 0) && (
        <Link href={href({ completer: f.completer ? undefined : '1' })} scroll={false}
          className={`vg-chip${f.completer ? ' is-on' : ''}`} style={{ padding: '5px 10px', fontSize: 12, lineHeight: 1.2 }}
          title={t('Actions with a missing required field (migration, progress)')}>
          <Icon name="ph-question" size={13} />{t('To complete')}<span style={{ opacity: 0.6 }}>{counts.toComplete}</span>
        </Link>
      )}
      <Form action={PATH} scroll={false} role="search" style={{ position: 'relative', width: 230, maxWidth: '100%' }}>
        {Object.entries({ ...params, q: undefined }).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
        <Icon name="ph-magnifying-glass" size={13} style={{ position: 'absolute', left: 9, top: 7, color: 'var(--color-neutral-500)' }} />
        {/* Clé = recherche appliquée : la saisie se réaligne quand la recherche est effacée par un lien. */}
        <input key={f.q} className="input" name="q" defaultValue={f.q} maxLength={100} placeholder={t('No., problem, action, reference…')} aria-label={t('Search an action')}
          style={{ fontSize: 12, lineHeight: 1.2, minHeight: 0, padding: '5px 26px 5px 28px', width: '100%' }} />
        {f.q && (
          <Link href={href({ q: undefined })} scroll={false} aria-label={t('Clear the search')}
            style={{ position: 'absolute', right: 7, top: 6, color: 'var(--color-neutral-500)', display: 'grid' }}>
            <Icon name="ph-x" size={13} />
          </Link>
        )}
      </Form>
      {filtered && (
        <Link href={hrefWith(PATH, { vue: params.vue, etat: params.etat }, {})} scroll={false} className="vg-link" style={{ fontSize: 11.5 }}>
          {t('Clear the filters')}
        </Link>
      )}
    </>
  );
}

function Filter({ label, icon, options }: { label: string; icon?: string; options: { href: string; label: string; on: boolean }[] }) {
  return (
    // Clé = libellé : le menu se referme quand le choix change (navigation côté client).
    <details key={label} className="vg-dropdown">
      <summary className="btn btn-secondary vg-btn-sm">{icon && <Icon name={icon} size={13} />}{label}<Icon name="ph-caret-down" size={11} /></summary>
      <div className="vg-menu elev-md" style={{ maxHeight: 340, overflowY: 'auto', minWidth: 220 }}>
        {options.map((o) => <Link key={o.href} href={o.href} scroll={false} className={`vg-menu-item${o.on ? ' is-on' : ''}`}>{o.label}</Link>)}
      </div>
    </details>
  );
}
