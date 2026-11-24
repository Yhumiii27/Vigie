import type { ReactNode } from 'react';
import Link from 'next/link';
import { isDemo } from '@/lib/config';
import { loadNotifications } from '@/lib/data/notifications';
import { NotificationBell } from './NotificationBell';
import { cookies } from 'next/headers';
import { THEME_COOKIE, themeOf } from '@/lib/theme';
import { getLang } from '@/i18n/server';
import { LangToggle } from './LangToggle';
import { ThemeToggle } from './ThemeToggle';

/**
 * En-tête d'écran ; `actions` : boutons propres à l'écran, placés avant la cloche (ex. « Nouvel événement »). À droite, comme
 * Keystone et Arche (Norma § 7) : cloche, sélecteur FR / EN (VG-N01) puis bascule sombre / clair, enfin « Nouveau signalement ».
 */
export async function PageHeader({ title, sub, actions }: { title: string; sub: string; actions?: ReactNode }) {
  // Champs affichés seulement : ni responsables ni site dans la charge de la page.
  const notifications = (await loadNotifications()).map((n) => ({
    key: n.key, date: n.date, kind: n.kind, tone: n.tone, title: n.title, who: n.who, href: n.href, urgent: n.urgent, read: n.read,
    elsewhere: n.elsewhere, siteLabel: n.siteLabel, family: n.family,
  }));
  const [lang, theme] = await Promise.all([getLang(), cookies().then((c) => themeOf(c.get(THEME_COOKIE)?.value))]);
  return (
    <header className="vg-header">
      <div style={{ display: 'grid', gap: 2 }}>
        <h1>{title}</h1>
        <span style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>{sub}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {actions}
        <NotificationBell items={notifications} />
        <LangToggle lang={lang} />
        <ThemeToggle theme={theme} />
        {/* Formulaire terrain réel (EVT-06) ; en démonstration, aperçu mobile sur grand écran et formulaire sur téléphone. */}
        {isDemo() && <Link href="/apercu-mobile" className="btn btn-primary vg-wide-only"><i className="ph ph-plus" style={{ fontSize: 14 }} aria-hidden />Nouveau signalement</Link>}
        <Link href="/signaler" className={`btn btn-primary${isDemo() ? ' vg-narrow-only' : ''}`}><i className="ph ph-plus" style={{ fontSize: 14 }} aria-hidden />Nouveau signalement</Link>
      </div>
    </header>
  );
}
