import Link from 'next/link';
import type { ReactNode } from 'react';

/** Option d'onglet ou de vue : lien (état dans l'URL, `?onglet=` / `?vue=`) ou bouton (`onClick`, composant client). */
export type SegmentItem = {
  key: string;
  label: ReactNode;
  on: boolean;
  /** Compte après le libellé (11 px tabulaire). */
  count?: ReactNode;
  href?: string;
  onClick?: () => void;
  title?: string;
};

/**
 * Onglets et vues d'une page (Norma 2.1, COQUE.md § 5) : segments de la charte (classes `.coque-seg` de coque.css, même
 * rendu que `Segmented` de norma/charte/ds), à la place des onglets soulignés `vg-tabs`. Lien choisi : `aria-current`,
 * bouton choisi : `aria-pressed`. Composant sans état, utilisable côté serveur.
 */
export function Segments({ label, items }: { label: string; items: readonly SegmentItem[] }) {
  return (
    <div role="group" aria-label={label} className="coque-seg is-wrap">
      {items.map((it) => {
        const inner = <>{it.label}{it.count != null && <span className="coque-seg-count">{it.count}</span>}</>;
        return it.href ? (
          <Link key={it.key} href={it.href} scroll={false} className="coque-seg-opt" title={it.title} aria-current={it.on ? 'true' : undefined}>{inner}</Link>
        ) : (
          <button key={it.key} type="button" className="coque-seg-opt" title={it.title} aria-pressed={it.on} onClick={it.onClick}>{inner}</button>
        );
      })}
    </div>
  );
}

/** Barre d'outils de la page (COQUE.md § 5) : onglets à gauche, puis ce qui suit (actions de l'onglet, note) à droite. */
export function Toolbar({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <div className="coque-toolbar">
      {children}
      {end != null && <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{end}</div>}
    </div>
  );
}
