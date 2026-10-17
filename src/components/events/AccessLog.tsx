'use client';

import { useState, useTransition } from 'react';
import { ChangeLogSummary } from '@/components/ChangeLog';
import { loadEventAccesses, type AccessEntry } from '@/server/access-history';

const fmtAt = (iso: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/**
 * Bloc repliable « Consultations » d'un événement (SEC-11) : qui a ouvert la fiche avec ses données de santé ou une de ses
 * pièces jointes, et quand. Chargé à l'ouverture ; rôles habilités aux données de santé seulement (la page ne le rend qu'à eux).
 */
export function EventAccessLog({ eventId }: { eventId: string }) {
  const [entries, setEntries] = useState<AccessEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const load = () => start(async () => {
    try {
      const r = await loadEventAccesses(eventId);
      if ('error' in r) setError(r.error);
      else { setEntries(r.entries); setError(null); }
    } catch {
      setError("Le journal des consultations n'a pas pu être chargé. Réessayez.");
    }
  });
  return (
    <details className="vg-history" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open && entries === null && !pending) load(); }}>
      <ChangeLogSummary title="Consultations" count={entries?.length} />
      {entries ? (
        entries.length === 0
          ? <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', paddingTop: 6 }}>Aucune consultation enregistrée.</div>
          : (
            <ol style={{ listStyle: 'none', margin: 0, padding: '6px 0 0', display: 'grid', gap: 6 }}>
              {entries.map((e) => (
                <li key={e.id} style={{ display: 'grid', gap: 2, fontSize: 12.5 }}>
                  <span>{e.what}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{fmtAt(e.at)} · {e.who}</span>
                </li>
              ))}
            </ol>
          )
      ) : error ? <div role="alert" style={{ fontSize: 12, color: 'var(--tone-danger-fg)', paddingTop: 6 }}>{error}</div>
        : <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', paddingTop: 6 }} aria-busy="true">Chargement des consultations…</div>}
    </details>
  );
}
