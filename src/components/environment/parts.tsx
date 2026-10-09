'use client';

import { useState, useTransition, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { TONE } from '@/lib/domain';

/** Ligne de tableau qui ouvre une fenêtre (clic ou Entrée), sauf clic sur un lien ou un bouton de la ligne. */
export function rowOpener(open: () => void) {
  return {
    className: 'is-clickable',
    tabIndex: 0,
    onClick: (e: MouseEvent<HTMLTableRowElement>) => { if (!(e.target as HTMLElement).closest('a, button')) open(); },
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); open(); } },
  };
}

/** Encadré d'information sous un champ (icône + texte). */
export function Note({ icon, tone, children }: { icon: string; tone?: 'warn' | 'danger' | 'ok'; children: ReactNode }) {
  return (
    <div className="vg-inset" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', fontSize: 12, color: 'var(--color-neutral-300)' }}>
      <i className={`ph ${icon}`} aria-hidden style={{ fontSize: 15, flex: 'none', marginTop: 1, color: tone ? TONE[tone].dot : 'var(--color-accent)' }} />
      <span style={{ textWrap: 'pretty', minWidth: 0 }}>{children}</span>
    </div>
  );
}

/** Suppression en deux temps sous le formulaire d'une fenêtre ; appelle `onDone` une fois l'élément supprimé. */
export function DeleteZone({ run, onDone, label, question }: { run: () => Promise<{ error?: string }>; onDone: () => void; label: string; question: ReactNode }) {
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingTop: 10, marginTop: 2, background: 'var(--rule-soft) no-repeat top / 100% 1px' }}>
      {!asking ? (
        <button type="button" className="btn btn-ghost vg-btn-sm" style={{ color: 'var(--tone-danger-fg)' }} onClick={() => setAsking(true)}>
          <i className="ph ph-trash" style={{ fontSize: 13 }} />{label}
        </button>
      ) : (
        <>
          <span style={{ fontSize: 12, color: 'var(--color-neutral-300)', flex: '1 1 220px', textWrap: 'pretty' }}>{question}</span>
          <span style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button type="button" className="btn btn-secondary vg-btn-sm" disabled={pending} onClick={() => { setAsking(false); setError(null); }}>Annuler</button>
            <button type="button" className="btn btn-secondary vg-btn-sm" disabled={pending} style={{ color: 'var(--tone-danger-fg)', borderColor: TONE.danger.dot }}
              onClick={() => start(async () => {
                const r = await run();
                if (r.error) setError(r.error);
                else onDone();
              })}>
              <i className="ph ph-trash" style={{ fontSize: 13 }} />{pending ? 'Suppression…' : 'Confirmer la suppression'}
            </button>
          </span>
        </>
      )}
      {error && <span role="alert" style={{ flexBasis: '100%', fontSize: 11.5, color: 'var(--tone-danger-fg)' }}>{error}</span>}
    </div>
  );
}

/** Suggestions de saisie (collecteurs, exutoires…) pour un champ texte. */
export function Suggestions({ id, values }: { id: string; values: string[] }) {
  return <datalist id={id}>{values.map((v) => <option key={v} value={v} />)}</datalist>;
}

/** Libellé court d'un site : « Site de [Ville A] ». */
export const shortSite = (label: string) => label.split(' — ')[0];

export const muted = { fontSize: 11, color: 'var(--color-neutral-500)' } as const;
