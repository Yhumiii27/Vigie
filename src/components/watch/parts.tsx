'use client';

import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

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
          <span style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>{k}</span>
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
