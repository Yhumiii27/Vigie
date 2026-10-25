import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { TONE, type Tone } from '@/lib/domain';

export function Icon({ name, size = 14, style }: { name: string; size?: number; style?: CSSProperties }) {
  return <i className={`ph ${name}`} style={{ fontSize: size, ...style }} aria-hidden />;
}

export function Dot({ color, size = 7 }: { color: string; size?: number }) {
  return <span className="vg-dot" style={{ width: size, height: size, background: color }} />;
}

export function ToneTag({ tone, children, style }: { tone: Tone; children: ReactNode; style?: CSSProperties }) {
  return <span className="tag" style={{ background: TONE[tone].bg, color: TONE[tone].fg, ...style }}>{children}</span>;
}

export function CardHead({ title, aside }: { title: ReactNode; aside?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <span className="card-title" style={{ fontSize: 14 }}>{title}</span>
      {aside}
    </div>
  );
}

export const Aside = ({ children }: { children: ReactNode }) => <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{children}</span>;

/** Contrôle segmenté dont chaque option est un lien (état porté par l'URL). */
export function SegLinks({ options, size = 12, pad = '5px 10px' }: { options: { href: string; label: ReactNode; on: boolean; icon?: string }[]; size?: number; pad?: string }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <Link key={o.href} href={o.href} scroll={false} role="radio" aria-checked={o.on} className={`seg-opt${o.on ? ' is-on' : ''}`} style={{ fontSize: size, padding: pad }}>
          {o.icon && <Icon name={o.icon} size={13} />}{o.label}
        </Link>
      ))}
    </div>
  );
}

/** Construit une URL en remplaçant certains paramètres de recherche (convention d'URL : src/lib/url-state.ts, UX-12). */
export { hrefWith } from '@/lib/url-state';

export function OutOfScope({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ padding: '0 28px 28px' }}>
      <div className="card" style={{ gap: 8, maxWidth: 560, border: '1px dashed var(--color-divider)', background: 'transparent' }}>
        <div className="card-kicker">Hors périmètre de cette itération</div>
        <div className="card-title" style={{ fontSize: 15 }}>{title}</div>
        <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>{text}</p>
      </div>
    </div>
  );
}

/**
 * Conteneur à défilement horizontal d'un tableau sans élément interactif : atteignable au clavier (flèches pour défiler) et
 * nommé (WCAG 2.1.1, règle axe scrollable-region-focusable).
 */
export function ScrollX({ label, children }: { label: string; children: ReactNode }) {
  return <div className="vg-scroll-x" role="region" aria-label={label} tabIndex={0} style={{ overflowX: 'auto' }}>{children}</div>;
}

/** Message commun d'un lien profond qui ne mène à aucun élément affichable (UX-13). */
export const MISSING_TEXT = 'Élément introuvable ou hors du site sélectionné.';

/**
 * Bandeau d'un lien profond (?sel=, ?action=, ?plan=…) qui ne correspond à rien d'affichable : élément supprimé, archivé,
 * hors du site sélectionné, hors du périmètre ou réservé à d'autres rôles (UX-13). Le même texte vaut pour « inexistant » et
 * « non autorisé » : il ne révèle jamais l'existence d'un élément hors périmètre ni d'une donnée de santé. Fermeture par un
 * lien (`closeHref`, page serveur) ou un bouton (`onClose`, fiche ouverte côté navigateur).
 */
export function MissingNotice({ text = MISSING_TEXT, closeHref, onClose }: { text?: string; closeHref?: string; onClose?: () => void }) {
  return (
    <div className="card vg-missing" role="status" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: '10px 14px', fontSize: 12.5 }}>
      <i className="ph ph-question" style={{ fontSize: 16, color: 'var(--color-neutral-500)' }} aria-hidden />
      <span style={{ flex: 1 }}>{text}</span>
      {onClose
        ? <button type="button" className="vg-text-btn" onClick={onClose}>Fermer</button>
        : closeHref && <Link href={closeHref} scroll={false} className="vg-link">Fermer</Link>}
    </div>
  );
}
