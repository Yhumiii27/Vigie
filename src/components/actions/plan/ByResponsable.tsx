import { ToneTag } from '@/components/ui';
import type { ActionListItem } from '@/lib/action-view';
import { TONE } from '@/lib/domain';
import { ActionLink } from '../ActionPlanProvider';

/** Vue « Par responsable » (spec § 16) : une carte par responsable, les plus chargés d'abord, ordre de la liste conservé. */
export function ByResponsable({ items }: { items: ActionListItem[] }) {
  const groups = [...items.reduce((m, a) => m.set(a.pilotId, [...(m.get(a.pilotId) ?? []), a]), new Map<string, ActionListItem[]>()).values()]
    .sort((a, b) => b.length - a.length || a[0].pilot.localeCompare(b[0].pilot, 'fr'));
  if (!groups.length) return <div className="vg-muted" style={{ fontSize: 12, padding: '8px 2px' }}>Aucune action à afficher.</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: 10, alignItems: 'start' }}>
      {groups.map((list) => {
        const late = list.filter((a) => a.late).length;
        return (
          <div key={list[0].pilotId} className="card" style={{ gap: 6, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingBottom: 4 }}>
              <span className="vg-avatar" style={{ width: 26, height: 26, fontSize: 10 }}>{list[0].pilotInitials}</span>
              <span style={{ fontWeight: 500 }}>{list[0].pilot}</span>
              <span style={{ fontSize: 11.5, color: late ? TONE.danger.dot : 'var(--color-neutral-500)' }}>
                {list.length} action{list.length > 1 ? 's' : ''}{late ? ` · ${late} en retard` : ''}
              </span>
            </div>
            {list.map((a) => (
              <ActionLink key={a.id} id={a.id} className="vg-row"
                style={{ gridTemplateColumns: '52px minmax(0, 1fr) auto auto', gap: 10, alignItems: 'center', fontSize: 12.5, padding: '3px 6px', margin: '0 -6px' }}>
                <span style={{ color: 'var(--color-neutral-500)', fontSize: 11.5 }}>{a.id}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.label}</span>
                <span style={{ fontSize: 12, textAlign: 'right', color: a.late ? TONE.danger.dot : 'var(--color-neutral-300)' }} title="Date cible">{a.due}</span>
                <ToneTag tone={a.tone} style={{ whiteSpace: 'nowrap' }}>{a.statusLabel}</ToneTag>
              </ActionLink>
            ))}
          </div>
        );
      })}
    </div>
  );
}
