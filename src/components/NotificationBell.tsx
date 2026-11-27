'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { NOTIFY_HORIZON_DAYS, TONE, type Tone } from '@/lib/domain';
import type { NotificationFamily } from '@/lib/data/notifications';
import { markAllRead } from '@/server/notifications';
import { TodoLink } from './TodoLink';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';
import { msgT, type Msg } from '@/i18n/msg';

type Item = {
  key: string; date: string; kind: string; tone: Tone; title: string; who: string;
  /** Intitulé composé (src/i18n/msg.ts), rendu dans la langue de la personne ; sinon `title`. */
  titleText?: Msg; href?: string; urgent: boolean; read: boolean;
  /** Élément d'un autre site du périmètre (TDB-05) : son site est sélectionné à l'ouverture. */
  elsewhere: boolean; siteLabel?: string;
  /** Famille (src/lib/data/notifications.ts) : échéance (pastille de couleur) ou information (icône du type). */
  family: NotificationFamily;
};

const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Icône des informations : action confiée (ACT-30), commentaire ou preuve du responsable (ACT-31), suite d'un signalement
 * (TDB-06), rappel du mercredi (ACT-32).
 */
const FAMILY_ICON: Record<Exclude<NotificationFamily, 'todo'>, string> = {
  action_confiee: 'ph-user-plus', action_commentaire: 'ph-chat-circle-text', action_preuve: 'ph-paperclip', signalement_suite: 'ph-megaphone', causerie_emargement: 'ph-signature', rappel: 'ph-calendar-check',
  information: 'ph-info',
};

/**
 * Cloche de l'en-tête : échéances proches et informations (notifications, rappel du mercredi) ; la pastille compte les non
 * lues (état lu par personne, en base).
 */
export function NotificationBell({ items }: { items: Item[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { t } = useI18n();
  const label = labelT(t);
  const text = msgT(t);
  const unread = items.filter((i) => !i.read).length;
  const urgent = items.some((i) => !i.read && i.urgent);

  useEffect(() => {
    if (!open) return;
    // pointerdown : souris, stylet et toucher (un appui hors du panneau le ferme aussi sur téléphone).
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    // Échap : focus rendu à la cloche (UX-03, UX-11).
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Nom = texte visible (pastille) et texte masqué : « Notifications 3 non lues » (UX-10). */}
      <button ref={button} type="button" className="btn btn-secondary btn-icon"
        aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen((o) => !o)} style={{ position: 'relative' }}>
        <i className="ph ph-bell" style={{ fontSize: 16 }} aria-hidden />
        <span className="vg-sr-only">{t('Notifications')} </span>
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, fontSize: 11, lineHeight: '16px', fontWeight: 500, background: urgent ? TONE.danger.bg : 'var(--color-accent-800)', color: urgent ? TONE.danger.fg : 'var(--color-accent-100)' }}>
            {unread}
          </span>
        )}
        {unread > 0 && <span className="vg-sr-only">{` ${unread > 1 ? t('unread#plural') : t('unread')}`}</span>}
      </button>
      {open && (
        <div id={panelId} className="vg-menu vg-notif-panel elev-md" role="dialog" aria-label={t('Notifications')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', padding: '4px 8px 6px' }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{t('Notifications')}</span>
            <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{fill(unread > 1 ? t('{n} unread notifications · deadlines within {days} days and information') : t('{n} unread notification · deadlines within {days} days and information'), { n: unread, days: NOTIFY_HORIZON_DAYS })}</span>
          </div>
          {items.length === 0 && <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--color-neutral-500)' }}>{t('Nothing to report.')}</div>}
          {items.map((n) => (
            <TodoLink key={n.key} item={n} markRead onOpen={() => setOpen(false)} className={n.href ? 'vg-menu-item' : undefined}
              style={{ display: 'grid', gridTemplateColumns: '18px 1fr', gap: 9, padding: '7px 8px', borderRadius: 'var(--radius-sm)', textDecoration: 'none' }}>
              <span style={{ display: 'flex', gap: 4, marginTop: n.family === 'todo' ? 5 : 1 }}>
                {n.family === 'todo'
                  ? <span className="vg-dot" style={{ width: 7, height: 7, background: TONE[n.tone].dot }} />
                  : <i className={`ph ${FAMILY_ICON[n.family]}`} style={{ fontSize: 13, color: TONE[n.tone].dot }} aria-hidden />}
                {!n.read && <span className="vg-unread"><span className="vg-sr-only">{t('Unread')}</span></span>}
              </span>
              <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 12.5, color: n.read ? 'var(--color-neutral-400)' : 'var(--color-text)', fontWeight: n.read ? 400 : 500 }}>{n.titleText ? text(n.titleText) : n.title}</span>
                <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>
                  {label(n.kind)} · {fmt(n.date)}{n.who ? ` · ${n.who}` : ''}{n.siteLabel ? ` · ${n.siteLabel}` : ''}
                </span>
              </span>
            </TodoLink>
          ))}
          <div style={{ position: 'sticky', bottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, margin: '4px -6px 0', padding: '8px 14px', borderTop: '1px solid var(--color-divider)', background: 'var(--color-surface)' }}>
            <button type="button" className="vg-text-btn" disabled={!unread || pending} aria-busy={pending || undefined} onClick={() => start(() => markAllRead('notifications'))}>
              {pending ? t('Saving…') : t('Mark all as read')}
            </button>
            <Link href="/a-faire" className="vg-link" onClick={() => setOpen(false)}>{t('All deadlines →')}</Link>
          </div>
        </div>
      )}
    </div>
  );
}
