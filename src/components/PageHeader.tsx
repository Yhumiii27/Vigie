import Link from 'next/link';
import { loadNotifications } from '@/lib/data/notifications';
import { NotificationBell } from './NotificationBell';

export async function PageHeader({ title, sub }: { title: string; sub: string }) {
  const notifications = await loadNotifications();
  return (
    <header className="vg-header">
      <div style={{ display: 'grid', gap: 2 }}>
        <h1>{title}</h1>
        <span style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>{sub}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <NotificationBell items={notifications} />
        <Link href="/apercu-mobile" className="btn btn-primary"><i className="ph ph-plus" style={{ fontSize: 14 }} />Nouveau signalement</Link>
      </div>
    </header>
  );
}
