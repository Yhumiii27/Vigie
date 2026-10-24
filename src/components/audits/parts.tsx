'use client';

import Link from 'next/link';
import { useState, useTransition, type ReactNode } from 'react';
import { Dot } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import type { ActionBrief, AttachmentBrief } from '@/lib/data/audits';
import styles from './audits.module.css';
import { Tip } from '@/components/Tip';

/** Choix exclusif en contrôle segmenté, utilisable dans un ActionForm (champ radio `name`). */
export function RadioSeg({ name, options, defaultValue, onChange }: {
  name: string; options: readonly (readonly [value: string, label: string, dot?: string])[]; defaultValue?: string; onChange?: (value: string) => void;
}) {
  return (
    <div className="seg" role="radiogroup" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
      {options.map(([value, label, dot]) => (
        <label key={value} className="seg-opt" style={{ fontSize: 12, padding: '5px 10px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="radio" name={name} value={value} defaultChecked={defaultValue === value} onChange={onChange && ((e) => { if (e.target.checked) onChange(value); })} />
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
  // Libellé court, avancement (« En retard » calculé), responsable, date cible.
  const tip = `${action.title} — ${action.status} · ${action.pilot} · date cible ${fmtDate(action.dueOn)}`;
  return (
    <Tip tip={tip}>
      {(described) => (
        <Link href={`/actions?action=${encodeURIComponent(action.id)}`} className="vg-link" {...described}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <Dot color={TONE[action.tone].dot} size={6} />
          {compact ? action.id : <span>{action.id} · <span style={{ color: 'var(--color-neutral-300)' }}>{action.status}</span></span>}
        </Link>
      )}
    </Tip>
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
        <i className="ph ph-trash" style={{ fontSize: 13 }} aria-hidden />{label}
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
        <i className="ph ph-trash" style={{ fontSize: 13 }} aria-hidden />{pending ? 'Suppression…' : 'Confirmer la suppression'}
      </button>
      {error && <span role="alert" style={{ flexBasis: '100%', textAlign: 'right', fontSize: 11.5, color: 'var(--tone-danger-fg)' }}>{error}</span>}
    </span>
  );
}

/** URL de consultation d'une pièce jointe (même route que attachmentUrl, côté client). */
export const fileUrl = (id: string) => `/fichiers/${id}`;

/** Liste de fichiers joints (rapport, certificat) avec retrait en deux temps d'un fichier ajouté par erreur. */
export function FileList({ files, onRemove, icon = 'ph-file-text' }: { files: AttachmentBrief[]; onRemove?: (id: string) => Promise<{ error?: string }>; icon?: string }) {
  const [asking, setAsking] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!files.length) return null;
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {files.map((f) => (
        <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, minWidth: 0 }}>
          <a href={fileUrl(f.id)} target="_blank" rel="noopener" className="vg-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <i className={`ph ${icon}`} style={{ fontSize: 13 }} aria-hidden />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.fileName}</span>
          </a>
          <span style={{ color: 'var(--color-neutral-500)', fontSize: 11 }}>{fmtDate(f.createdAt.slice(0, 10))}</span>
          {onRemove && (asking === f.id ? (
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
              <button type="button" className="vg-text-btn" disabled={pending} onClick={() => setAsking(null)}>Annuler</button>
              <button type="button" className="vg-text-btn" disabled={pending} style={{ color: 'var(--tone-danger-fg)' }}
                onClick={() => start(async () => {
                  const r = await onRemove(f.id);
                  setError(r.error ?? null);
                  if (!r.error) setAsking(null);
                })}>
                {pending ? 'Retrait…' : 'Confirmer le retrait'}
              </button>
            </span>
          ) : (
            <button type="button" className="vg-text-btn" style={{ marginLeft: 'auto', color: 'var(--color-neutral-400)' }} onClick={() => { setError(null); setAsking(f.id); }}>Retirer</button>
          ))}
        </div>
      ))}
      {error && <span role="alert" style={{ fontSize: 11.5, color: 'var(--tone-danger-fg)' }}>{error}</span>}
    </div>
  );
}
