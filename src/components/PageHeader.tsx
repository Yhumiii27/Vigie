import type { ReactNode } from 'react';
import Link from 'next/link';
import { loadNotifications } from '@/lib/data/notifications';
import { NotificationBell } from './NotificationBell';

/** En-tête d'écran ; `actions` : boutons propres à l'écran, placés avant la cloche (ex. « Nouvel événement »). */
export async function PageHeader({ title, sub, actions }: { title: string; sub: string; actions?: ReactNode }) {
  const notifications = await loadNotifications();
  return (
    <header className="vg-header">
      <div style={{ display: 'grid', gap: 2 }}>
        <h1>{title}</h1>
        <span style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>{sub}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {actions}
        <NotificationBell items={notifications} />
        <Link href="/apercu-mobile" className="btn btn-primary"><i className="ph ph-plus" style={{ fontSize: 14 }} />Nouveau signalement</Link>
      </div>
    </header>
  );
}
