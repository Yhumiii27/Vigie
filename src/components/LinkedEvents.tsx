import Link from 'next/link';
import { ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import type { LinkedEvent } from '@/lib/data/linked-events';

/**
 * Événements rattachés à la fiche (EVT-14 : contrôle périodique, document maîtrisé), le plus récent d'abord ; lien vers la
 * fiche de l'événement pour les rôles qui ouvrent l'écran Événements. Sans donnée de santé (chargement : loadLinkedEvents).
 */
export function LinkedEvents({ events, empty = 'Aucun événement rattaché. Le rattachement se fait depuis la fiche de l’événement.' }: { events: LinkedEvent[]; empty?: string }) {
  return (
    <section style={{ display: 'grid', gap: 6 }}>
      <h6 className="vg-h6">Événements liés{events.length ? <span style={{ color: 'var(--color-neutral-600)' }}> · {events.length}</span> : null}</h6>
      {events.length ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {events.map((e) => (
            <li key={e.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
              {e.href ? <Link href={e.href} className="vg-link" style={{ fontSize: 12.5 }}>{e.id}</Link> : <span>{e.id}</span>}
              <ToneTag tone={e.tone}>{e.typeLabel}</ToneTag>
              <span style={{ flex: 1, minWidth: 160 }}>{e.title}</span>
              <span style={{ color: 'var(--color-neutral-500)', whiteSpace: 'nowrap' }}>{fmtDate(e.occurredOn)}</span>
              <span style={{ color: e.closed ? 'var(--color-neutral-500)' : 'var(--color-neutral-300)', whiteSpace: 'nowrap' }}>{e.step}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{empty}</div>
      )}
    </section>
  );
}
