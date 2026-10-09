'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { TONE, type Tone } from '@/lib/domain';

type Item = { date: string; kind: string; tone: Tone; title: string; who: string; href?: string; urgent: boolean };

const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Cloche de l'en-tête : liste des alertes et échéances proches. */
export function NotificationBell({ items }: { items: Item[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const urgent = items.filter((i) => i.urgent).length;

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
      <button type="button" className="btn btn-secondary btn-icon" aria-label={`Notifications${items.length ? ` (${items.length})` : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{ position: 'relative' }}>
        <i className="ph ph-bell" style={{ fontSize: 16 }} />
        {items.length > 0 && (
          <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, fontSize: 10, lineHeight: '16px', fontWeight: 500, background: urgent ? TONE.danger.bg : 'var(--color-accent-800)', color: urgent ? TONE.danger.fg : 'var(--color-accent-100)' }}>
            {items.length}
          </span>
        )}
      </button>
      {open && (
        <div className="vg-menu elev-md" role="dialog" aria-label="Notifications" style={{ right: 0, top: 'calc(100% + 6px)', width: 380, maxHeight: 460, overflow: 'auto', padding: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 8px 6px' }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Notifications</span>
            <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{urgent} urgente{urgent > 1 ? 's' : ''} · 7 prochains jours</span>
          </div>
          {items.length === 0 && <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--color-neutral-500)' }}>Rien à signaler.</div>}
          {items.map((n, i) => {
            const body = (
              <>
                <span className="vg-dot" style={{ width: 7, height: 7, marginTop: 5, background: TONE[n.tone].dot }} />
                <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 12.5, color: 'var(--color-text)' }}>{n.title}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{n.kind} · {fmt(n.date)}{n.who ? ` · ${n.who}` : ''}</span>
                </span>
              </>
            );
            const style = { display: 'grid', gridTemplateColumns: '7px 1fr', gap: 9, padding: '7px 8px', borderRadius: 'var(--radius-sm)', textDecoration: 'none' } as const;
            return n.href
              ? <Link key={i} href={n.href} className="vg-menu-item" style={style} onClick={() => setOpen(false)}>{body}</Link>
              : <div key={i} style={style}>{body}</div>;
          })}
        </div>
      )}
    </div>
  );
}
