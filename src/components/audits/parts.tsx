'use client';

import Link from 'next/link';
import { useState, useTransition, type ReactNode } from 'react';
import { Dot } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import type { ActionBrief } from '@/lib/data/audits';
import styles from './audits.module.css';

/** Choix exclusif en contrôle segmenté, utilisable dans un ActionForm (champ radio `name`). */
export function RadioSeg({ name, options, defaultValue }: { name: string; options: readonly (readonly [value: string, label: string, dot?: string])[]; defaultValue?: string }) {
  return (
    <div className="seg" role="radiogroup" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
      {options.map(([value, label, dot]) => (
        <label key={value} className="seg-opt" style={{ fontSize: 12, padding: '5px 10px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="radio" name={name} value={value} defaultChecked={defaultValue === value} />
          {dot && <Dot color={dot} />}{label}
        </label>
      ))}
    </div>
  );
}

/** Zone d'opérations secondaires sous le formulaire d'une fenêtre (action liée, suppression). */
export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className={styles.footer}>{children}</div>;
}

/** Lien vers une action du plan d'actions unique, avec son statut calculé. */
export function ActionLink({ action, id, compact }: { action: ActionBrief | null; id: string; compact?: boolean }) {
  if (!action) return <span style={{ color: 'var(--color-neutral-500)' }}>{id}</span>;
  const tip = `${action.title} — ${action.status} · ${action.pilot} · échéance ${fmtDate(action.dueOn)}`;
  return (
    <Link href={`/actions?action=${encodeURIComponent(action.id)}`} className="vg-link" title={tip}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <Dot color={TONE[action.tone].dot} size={6} />
      {compact ? action.id : <span>{action.id} · <span style={{ color: 'var(--color-neutral-300)' }}>{action.status}</span></span>}
    </Link>
  );
}

/** Suppression en deux temps (confirmation en ligne), appelle `onDone` une fois l'élément supprimé. */
export function DeleteButton({ run, onDone, label = 'Supprimer', note }: { run: () => Promise<{ error?: string }>; onDone: () => void; label?: string; note?: string }) {
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!asking) {
    return (
      <button type="button" className="btn btn-ghost vg-btn-sm" style={{ color: 'var(--tone-danger-fg)', marginLeft: 'auto' }} onClick={() => setAsking(true)}>
        <i className="ph ph-trash" style={{ fontSize: 13 }} />{label}
      </button>
    );
  }
  return (
    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{note ?? 'Suppression définitive.'}</span>
      <button type="button" className="btn btn-secondary vg-btn-sm" disabled={pending} onClick={() => { setAsking(false); setError(null); }}>Annuler</button>
      <button type="button" className="btn btn-secondary vg-btn-sm" disabled={pending}
        style={{ color: 'var(--tone-danger-fg)', borderColor: TONE.danger.dot }}
        onClick={() => start(async () => {
          const r = await run();
          if (r.error) setError(r.error);
          else onDone();
        })}>
        <i className="ph ph-trash" style={{ fontSize: 13 }} />{pending ? 'Suppression…' : 'Confirmer la suppression'}
      </button>
      {error && <span role="alert" style={{ flexBasis: '100%', textAlign: 'right', fontSize: 11.5, color: 'var(--tone-danger-fg)' }}>{error}</span>}
    </span>
  );
}
