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

/** Construit une URL en remplaçant certains paramètres de recherche. */
export function hrefWith(path: string, current: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  Object.entries({ ...current, ...patch }).forEach(([k, v]) => { if (v) params.set(k, v); });
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

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

/** Paramètre de sélection (?sel=, ?action=, ?plan=…) qui ne correspond à rien : supprimé, archivé ou hors du site sélectionné. */
export function MissingNotice({ text = 'Élément introuvable ou hors du site sélectionné.', closeHref }: { text?: string; closeHref: string }) {
  return (
    <div className="card" role="status" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: '10px 14px', fontSize: 12.5 }}>
      <i className="ph ph-question" style={{ fontSize: 16, color: 'var(--color-neutral-500)' }} aria-hidden />
      <span style={{ flex: 1 }}>{text}</span>
      <Link href={closeHref} scroll={false} className="vg-link">Fermer</Link>
    </div>
  );
}
