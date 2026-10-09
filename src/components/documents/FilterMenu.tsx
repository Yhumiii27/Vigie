import Link from 'next/link';
import { Icon } from '@/components/ui';

/** Menu déroulant de filtre dont chaque choix est un lien (état porté par l'URL). */
export function FilterMenu({ label, icon, options }: { label: string; icon?: string; options: { href: string; label: string; on: boolean; n?: number }[] }) {
  return (
    <details className="vg-dropdown">
      <summary className="btn btn-secondary vg-btn-sm">{icon && <Icon name={icon} size={13} />}{label}<Icon name="ph-caret-down" size={11} /></summary>
      <div className="vg-menu elev-md">
        {options.map((o) => (
          <Link key={o.href} href={o.href} scroll={false} className={`vg-menu-item${o.on ? ' is-on' : ''}`} style={{ display: 'flex', gap: 12, justifyContent: 'space-between' }}>
            <span>{o.label}</span>
            {o.n != null && <span style={{ color: 'var(--color-neutral-500)' }}>{o.n}</span>}
          </Link>
        ))}
      </div>
    </details>
  );
}
