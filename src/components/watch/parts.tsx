'use client';

import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { MAX_BATCH_BYTES, MAX_FILES_PER_BATCH, fileBatchError } from '@/lib/attachments';

const MB = 1024 * 1024;

/** Consigne d'un champ à plusieurs fichiers (preuves d'évaluation) : mêmes limites que checkPickedFiles et le serveur. */
export const FILES_HINT = `PDF, image ou document Office · ${MAX_FILES_PER_BATCH} fichiers et ${MAX_BATCH_BYTES / MB} Mo au maximum par envoi.`;

/**
 * Motif de refus d'un choix de fichiers (fichier trop lourd, trop de fichiers, volume total), ou null : mêmes limites
 * que le serveur (checkUpload, MAX_FILES_PER_BATCH, MAX_BATCH_BYTES). Règle pure, testée dans parts.test.ts.
 */
export function pickedFilesError(files: readonly { name: string; size: number }[]): string | null {
  return fileBatchError(files);
}

/**
 * Contrôle des fichiers choisis, avant l'envoi : au-delà de la limite des server actions (next.config), la requête
 * serait refusée avant l'action et la page basculerait sur l'écran d'erreur. Vide le champ et renvoie le motif, ou null.
 */
export function checkPickedFiles(input: HTMLInputElement): string | null {
  const issue = pickedFilesError(Array.from(input.files ?? []));
  if (issue) input.value = '';
  return issue;
}

/** Refus d'un choix de fichiers (checkPickedFiles), sous le champ. */
export function FileError({ error }: { error: string | null }) {
  return error ? <div role="alert" className="vg-form-error">{error}</div> : null;
}

/** Bascule entre les vues d'une fenêtre (fiche, évaluation, historique…). */
export function ViewSwitch<T extends string>({ name, value, options, onChange }: {
  name: string; value: T; options: readonly (readonly [T, ReactNode, string?])[]; onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="radiogroup" style={{ alignSelf: 'flex-start', maxWidth: '100%', overflowX: 'auto' }}>
      {options.map(([key, label, icon]) => (
        <label key={key} className="seg-opt" style={{ fontSize: 12, padding: '5px 11px', whiteSpace: 'nowrap' }}>
          <input type="radio" name={name} checked={value === key} onChange={() => onChange(key)} />
          {icon && <i className={`ph ${icon}`} style={{ fontSize: 13 }} aria-hidden />}{label}
        </label>
      ))}
    </div>
  );
}

/** Bandeau de faits clés en tête de fenêtre (libellé en petites capitales, valeur). */
export function Facts({ items }: { items: (readonly [string, ReactNode] | false | null | undefined)[] }) {
  return (
    <div className="vg-inset" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 22px', padding: '10px 12px' }}>
      {items.filter((i): i is readonly [string, ReactNode] => !!i).map(([k, v]) => (
        <div key={k} style={{ display: 'grid', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--vg-text-muted)' }}>{k}</span>
          <span style={{ fontSize: 12.5 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/** Ligne de tableau qui ouvre une fenêtre (clic ou Entrée), sauf clic sur un lien ou un bouton de la ligne. */
export function rowOpener(open: () => void) {
  return {
    className: 'is-clickable',
    tabIndex: 0,
    onClick: (e: MouseEvent<HTMLTableRowElement>) => { if (!(e.target as HTMLElement).closest('a, button')) open(); },
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); open(); } },
  };
}

export const muted = { fontSize: 11, color: 'var(--color-neutral-500)' } as const;

/** Bandeau d'une fiche archivée (texte abrogé, équipement réformé) : motif, et restauration pour l'animateur QHSE / la direction. */
export function ArchivedBanner({ title, label, children }: { title: string; label: string | null; children?: ReactNode }) {
  return (
    <div className="vg-inset" role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 12px', fontSize: 12.5 }}>
      <i className="ph ph-archive" style={{ fontSize: 15, color: 'var(--color-neutral-400)' }} aria-hidden />
      <span style={{ flex: 1, minWidth: 180, textWrap: 'pretty' }}>
        <strong style={{ fontWeight: 500 }}>{title}</strong>
        {label && <span style={{ ...muted, display: 'block', fontSize: 11.5 }}>{label}</span>}
      </span>
      {children}
    </div>
  );
}

/** Bandeau d'information (succès, suggestion) en tête de fiche. */
export function Notice({ tone = 'ok', icon = 'ph-check-circle', children }: { tone?: 'ok' | 'warn'; icon?: string; children: ReactNode }) {
  const color = tone === 'ok' ? 'var(--tone-ok-fg)' : 'var(--tone-warn-fg)';
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color }}>
      <i className={`ph ${icon}`} style={{ fontSize: 15 }} aria-hidden />{children}
    </div>
  );
}
