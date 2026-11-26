'use client';

// Historique des modifications d'une fiche (journal change_log). Sans état ; composant client (libellés par useI18n), rendu
// aussi depuis une page serveur (entrées sérialisables).

import type { ChangeEntry } from '@/lib/change-entry';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

const fmtAt = (iso: string, lang: string) => new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** Bloc repliable « Historique » : qui, quand, quoi, motif. */
export function ChangeLogList({ entries, title, open = false, empty }: { entries: ChangeEntry[]; title?: string; open?: boolean; empty?: string }) {
  const { t } = useI18n();
  return (
    <details open={open} className="vg-history">
      <ChangeLogSummary title={title ?? t('History')} count={entries.length} />
      <ChangeLogEntries entries={entries} empty={empty} />
    </details>
  );
}

/** Titre du bloc « Historique » (nombre d'entrées quand il est connu). */
export function ChangeLogSummary({ title, count }: { title: string; count?: number }) {
  return (
    <summary className="vg-h6" style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
      <i className="ph ph-clock-counter-clockwise" style={{ fontSize: 13 }} aria-hidden />
      {title}{!!count && <span style={{ color: 'var(--vg-text-muted)' }}> · {count}</span>}
    </summary>
  );
}

/** Entrées du journal (les plus récentes d'abord). */
export function ChangeLogEntries({ entries, empty }: { entries: ChangeEntry[]; empty?: string }) {
  const { t, lang } = useI18n();
  return entries.length === 0 ? (
    <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', paddingTop: 6 }}>{empty ?? t('No change recorded.')}</div>
  ) : (
    <ol style={{ listStyle: 'none', margin: 0, padding: '6px 0 0', display: 'grid', gap: 8 }}>
      {entries.map((e) => (
        <li key={e.id} style={{ display: 'grid', gap: 2, fontSize: 12.5 }}>
          <span style={{ color: 'var(--color-text)' }}>{e.summary}</span>
          {e.reason && <span style={{ color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>{fill(t('Reason: {reason}'), { reason: e.reason })}</span>}
          {e.details.map((d, i) => (
            <span key={i} style={{ fontSize: 11.5, color: 'var(--color-neutral-400)' }}>{d.field} : {d.from ?? '—'} → {d.to ?? '—'}</span>
          ))}
          <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{fmtAt(e.at, lang)} · {e.who}</span>
        </li>
      ))}
    </ol>
  );
}
