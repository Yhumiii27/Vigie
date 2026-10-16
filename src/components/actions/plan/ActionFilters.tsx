import Form from 'next/form';
import Link from 'next/link';
import { Icon, SegLinks, hrefWith } from '@/components/ui';
import { PLAN_SCOPES, PLAN_VIEWS, actionFiltersParams, type ActionFilters } from '@/lib/action-rules';
import { ACTION_AVANCEMENTS, ACTION_PRIORITIES, ACTION_SOURCES, AVANCEMENT, PRIORITY_KEYS, SOURCE_KEYS } from '@/lib/domain';
import type { Option } from '@/lib/form-options';

// Barre de filtres de la vue générale (spec § 16) : vue, affichage (?etat=), avancement, responsable (dont « Mes
// actions »), source, priorité, « À compléter », texte libre. Tout est porté par l'URL (actionFiltersParams + hrefWith),
// commun aux trois vues ; changer un filtre ferme la fiche ouverte (?action= retiré).

const PATH = '/actions';
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

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
  const avancement = shownAvancement(f);
  const avancementLabel = avancement === 'ouvertes' ? 'ouvertes' : avancement === 'en_retard' ? 'en retard' : avancement ? AVANCEMENT[avancement].label : 'tous';
  const responsable = f.mes ? userName : f.responsable ? responsables.find(([id]) => id === f.responsable)?.[1] ?? 'personne sortie' : null;
  const scope = PLAN_SCOPES.find(([k]) => k === f.etat) ?? PLAN_SCOPES[0];
  const filtered = hasFilters(f);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <SegLinks pad="5px 11px" options={PLAN_VIEWS.map(([key, label, icon]) => ({ href: href({ vue: key === 'liste' ? undefined : key }), label, icon, on: f.vue === key }))} />
      <Filter label={`Affichage : ${scope[1].toLowerCase()}`} icon={scope[2]}
        options={PLAN_SCOPES.map(([k, label]) => ({
          href: href({ etat: k || undefined }), on: f.etat === k,
          label: k === 'historique' ? `${label} (${plural(counts.olderVerified, 'vérifiée')} de plus de 30 jours)`
            : k === 'abandonnees' ? `${label} (${counts.abandoned})` : label,
        }))} />
      <Filter label={`Avancement : ${avancementLabel}`} icon="ph-chart-bar"
        options={[
          { href: href({ avancement: undefined, retard: undefined }), label: 'Tous les avancements', on: !avancement },
          { href: href({ avancement: 'ouvertes', retard: undefined }), label: 'Ouvertes (À faire → 80 %)', on: avancement === 'ouvertes' },
          { href: href({ avancement: 'en_retard', retard: undefined }), label: 'En retard', on: avancement === 'en_retard' },
          ...ACTION_AVANCEMENTS.filter((k) => k !== 'abandonnee').map((k) => ({ href: href({ avancement: k, retard: undefined }), label: AVANCEMENT[k].label, on: avancement === k })),
        ]} />
      {!employee && (
        <>
          <Filter label={`Responsable : ${responsable ?? 'tous'}`} icon="ph-user"
            options={[
              { href: href({ responsable: undefined, mes: undefined }), label: 'Tous les responsables', on: !responsable },
              ...responsables.map(([id, name]) => ({ href: href({ responsable: id, mes: undefined }), label: name, on: !f.mes && f.responsable === id })),
            ]} />
          <Link href={href({ mes: f.mes ? undefined : '1', responsable: undefined })} scroll={false}
            className={`vg-chip${f.mes ? ' is-on' : ''}`} style={{ padding: '5px 10px', fontSize: 12, lineHeight: 1.2 }}>
            <Icon name="ph-user-circle" size={13} />Mes actions<span style={{ opacity: 0.6 }}>{mineCount}</span>
          </Link>
        </>
      )}
      <Filter label={`Source : ${f.source ? ACTION_SOURCES[f.source].label : 'toutes'}`} icon="ph-funnel"
        options={[
          { href: href({ source: undefined }), label: 'Toutes les sources', on: !f.source },
          ...SOURCE_KEYS.map((k) => ({ href: href({ source: k }), label: ACTION_SOURCES[k].label, on: f.source === k })),
        ]} />
      <Filter label={`Priorité : ${f.priorite ? ACTION_PRIORITIES[f.priorite].label.toLowerCase() : 'toutes'}`} icon="ph-flag"
        options={[
          { href: href({ priorite: undefined }), label: 'Toutes les priorités', on: !f.priorite },
          ...PRIORITY_KEYS.map((k) => ({ href: href({ priorite: k }), label: ACTION_PRIORITIES[k].label, on: f.priorite === k })),
        ]} />
      {!employee && (f.completer || counts.toComplete > 0) && (
        <Link href={href({ completer: f.completer ? undefined : '1' })} scroll={false}
          className={`vg-chip${f.completer ? ' is-on' : ''}`} style={{ padding: '5px 10px', fontSize: 12, lineHeight: 1.2 }}
          title="Actions dont un champ obligatoire manque (reprise, avancement)">
          <Icon name="ph-question" size={13} />À compléter<span style={{ opacity: 0.6 }}>{counts.toComplete}</span>
        </Link>
      )}
      <Form action={PATH} scroll={false} role="search" style={{ position: 'relative', width: 230, maxWidth: '100%' }}>
        {Object.entries({ ...params, q: undefined }).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
        <Icon name="ph-magnifying-glass" size={13} style={{ position: 'absolute', left: 9, top: 7, color: 'var(--color-neutral-500)' }} />
        {/* Clé = recherche appliquée : la saisie se réaligne quand la recherche est effacée par un lien. */}
        <input key={f.q} className="input" name="q" defaultValue={f.q} maxLength={100} placeholder="N°, problème, action, référence…" aria-label="Rechercher une action"
          style={{ fontSize: 12, lineHeight: 1.2, minHeight: 0, padding: '5px 26px 5px 28px', width: '100%' }} />
        {f.q && (
          <Link href={href({ q: undefined })} scroll={false} aria-label="Effacer la recherche"
            style={{ position: 'absolute', right: 7, top: 6, color: 'var(--color-neutral-500)', display: 'grid' }}>
            <Icon name="ph-x" size={13} />
          </Link>
        )}
      </Form>
      {filtered && (
        <Link href={hrefWith(PATH, { vue: params.vue, etat: params.etat }, {})} scroll={false} className="vg-link" style={{ fontSize: 11.5 }}>
          Effacer les filtres
        </Link>
      )}
    </div>
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
