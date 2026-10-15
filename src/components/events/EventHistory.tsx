import type { EventHistoryEntry } from '@/lib/data/events';

const fmtAt = (iso: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** Historique du workflow de la fiche événement : qui, quand, de → vers, motif (le plus récent d'abord). */
export function EventHistory({ entries }: { entries: EventHistoryEntry[] }) {
  const list = [...entries].reverse();
  return (
    <details className="vg-history">
      <summary className="vg-h6" style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
        <i className="ph ph-flow-arrow" style={{ fontSize: 13 }} aria-hidden />
        Historique des étapes<span style={{ color: 'var(--color-neutral-600)' }}> · {entries.length}</span>
      </summary>
      {list.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', paddingTop: 6 }}>Aucune transition enregistrée depuis la déclaration.</div>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: '6px 0 0', display: 'grid', gap: 8 }}>
          {list.map((h) => (
            <li key={h.id} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 8, fontSize: 12.5 }}>
              <i className={`ph ${h.icon}`} style={{ fontSize: 14, marginTop: 1, color: h.kind === 'advance' ? 'var(--color-accent)' : 'var(--color-neutral-400)' }} aria-hidden />
              <span style={{ display: 'grid', gap: 2 }}>
                <span>
                  {h.label}
                  <span style={{ color: 'var(--color-neutral-400)' }}> · {h.from === h.to ? `à l'étape « ${h.to} »` : `${h.from} → ${h.to}`}</span>
                </span>
                {h.reason && <span style={{ color: 'var(--color-neutral-300)', fontStyle: 'italic', textWrap: 'pretty' }}>{h.reason}</span>}
                <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{fmtAt(h.at)} · {h.by}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
