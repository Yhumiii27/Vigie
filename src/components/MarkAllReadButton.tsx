'use client';

import { useTransition } from 'react';
import { markAllRead } from '@/server/notifications';
import { useI18n } from '@/i18n/client';

/** « Tout marquer comme lu » : clés recalculées côté serveur selon la portée (cloche, ou page À faire et ses filtres). */
export function MarkAllReadButton({ scope, filter, disabled }: { scope: 'notifications' | 'todo'; filter?: { domain?: string; mine?: boolean }; disabled?: boolean }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn btn-secondary vg-btn-sm" disabled={disabled || pending} onClick={() => start(() => markAllRead(scope, filter))}>
      <i className="ph ph-checks" style={{ fontSize: 14 }} aria-hidden />{pending ? t('Saving…') : t('Mark all as read')}
    </button>
  );
}
