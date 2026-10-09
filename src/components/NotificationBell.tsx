'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { NOTIFY_HORIZON_DAYS, TONE, type Tone } from '@/lib/domain';
import { markAllRead, markNotificationsRead } from '@/server/notifications';

type Item = { key: string; date: string; kind: string; tone: Tone; title: string; who: string; href?: string; urgent: boolean; read: boolean };

const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Cloche de l'en-tête : alertes et échéances proches ; la pastille compte les non lues (état lu par personne, en base). */
export function NotificationBell({ items }: { items: Item[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const unread = items.filter((i) => !i.read).length;
  const urgent = items.some((i) => !i.read && i.urgent);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="btn btn-secondary btn-icon" aria-label={`Notifications${unread ? ` (${unread} non lue${unread > 1 ? 's' : ''})` : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{ position: 'relative' }}>
        <i className="ph ph-bell" style={{ fontSize: 16 }} />
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, fontSize: 10, lineHeight: '16px', fontWeight: 500, background: urgent ? TONE.danger.bg : 'var(--color-accent-800)', color: urgent ? TONE.danger.fg : 'var(--color-accent-100)' }}>
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="vg-menu elev-md" role="dialog" aria-label="Notifications" style={{ right: 0, top: 'calc(100% + 6px)', width: 380, maxHeight: 460, overflow: 'auto', padding: '6px 6px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 8px 6px' }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Notifications</span>
            <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{unread} non lue{unread > 1 ? 's' : ''} · {NOTIFY_HORIZON_DAYS} prochains jours</span>
          </div>
          {items.length === 0 && <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--color-neutral-500)' }}>Rien à signaler.</div>}
          {items.map((n) => {
            const body = (
              <>
                <span style={{ display: 'flex', gap: 4, marginTop: 5 }}>
                  <span className="vg-dot" style={{ width: 7, height: 7, background: TONE[n.tone].dot }} />
                  {!n.read && <span className="vg-unread" title="Non lue" />}
                </span>
                <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 12.5, color: 'var(--color-text)', fontWeight: n.read ? 400 : 500 }}>{n.title}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{n.kind} · {fmt(n.date)}{n.who ? ` · ${n.who}` : ''}</span>
                </span>
              </>
            );
            const style = { display: 'grid', gridTemplateColumns: '18px 1fr', gap: 9, padding: '7px 8px', borderRadius: 'var(--radius-sm)', textDecoration: 'none', opacity: n.read ? 0.6 : 1 } as const;
            return n.href
              ? <Link key={n.key} href={n.href} className="vg-menu-item" style={style}
                  onClick={() => { if (!n.read) start(() => markNotificationsRead([n.key])); setOpen(false); }}>{body}</Link>
              : <div key={n.key} style={style}>{body}</div>;
          })}
          <div style={{ position: 'sticky', bottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, margin: '4px -6px 0', padding: '8px 14px', borderTop: '1px solid var(--color-divider)', background: 'var(--color-surface)' }}>
            <button type="button" className="vg-text-btn" disabled={!unread || pending} onClick={() => start(() => markAllRead('notifications'))}>
              {pending ? 'Enregistrement…' : 'Tout marquer comme lu'}
            </button>
            <Link href="/a-faire" className="vg-link" onClick={() => setOpen(false)}>Toutes les échéances →</Link>
          </div>
        </div>
      )}
    </div>
  );
}
