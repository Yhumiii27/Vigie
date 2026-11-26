'use client';

import { useState, useTransition } from 'react';
import { loadEntityHistory, type HistoryEntity } from '@/server/history';
import type { ChangeEntry } from '@/lib/change-entry';
import { ChangeLogEntries, ChangeLogSummary } from './ChangeLog';
import { useI18n } from '@/i18n/client';

/**
 * Historique chargé à l'ouverture du bloc (QUA-11) : le journal d'une fiche n'est plus envoyé avec toute la liste de
 * l'écran, il est lu par loadEntityHistory (src/server/history.ts, mêmes droits que l'écran) au premier dépliage.
 */
export function LazyChangeLog({ entity, id, title }: { entity: HistoryEntity; id: string | number; title?: string }) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<ChangeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const load = () => start(async () => {
    try {
      const r = await loadEntityHistory(entity, String(id));
      if ('error' in r) setError(r.error);
      else { setEntries(r.entries); setError(null); }
    } catch {
      setError(t('The history could not be loaded. Try again.'));
    }
  });
  return (
    <details className="vg-history" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open && entries === null && !pending) load(); }}>
      <ChangeLogSummary title={title ?? t('History')} count={entries?.length} />
      {entries ? <ChangeLogEntries entries={entries} />
        : error ? <div role="alert" style={{ fontSize: 12, color: 'var(--tone-danger-fg)', paddingTop: 6 }}>{error}</div>
          : <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', paddingTop: 6 }} aria-busy="true">{t('Loading the history…')}</div>}
    </details>
  );
}
