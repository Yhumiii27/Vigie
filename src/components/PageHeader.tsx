import type { ReactNode } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { isDemo } from '@/lib/config';
import { loadNotifications } from '@/lib/data/notifications';
import { NAV, SCREENS, type ScreenKey } from '@/lib/domain';
import { SEARCH_MIN, SEARCH_PATH } from '@/lib/rules/search';
import { THEME_COOKIE, themeOf } from '@/lib/theme';
import { getI18n } from '@/i18n/server';
import { NAV_SECTION_EN } from '@/i18n/nav';
import { NotificationBell } from './NotificationBell';
import { HelpButton } from './HelpDialog';
import { CoquePageHeader } from './coque';
import { Prefs } from './Prefs';

/** Section de la barre latérale d'un écran de NAV, d'après son titre (fil d'Ariane par défaut). */
function sectionOf(title: string): string | undefined {
  const key = (Object.keys(SCREENS) as ScreenKey[]).find((k) => SCREENS[k].title === title);
  return key ? NAV.find((sec) => sec.items.includes(key))?.label : undefined;
}

/**
 * En-tête de page commun (Norma 2.1, COQUE.md § 3), ordre fixe : fil d'Ariane et titre h1 26 px (sous-titre) · recherche
 * globale de Vigie (TDB-18, `/recherche?q=`) · actions de l'écran puis « Nouveau signalement » (action principale, la plus
 * à droite ; au-delà de trois boutons, les autres vont dans le menu « Actions ») · aide · cloche · langue / affichage
 * empilés (dernier élément ; dans la barre supérieure jusqu'à 1024 px). `crumbs` : fil d'Ariane, par défaut la section de
 * la barre latérale de l'écran ; `toolbar` : onglets et filtres de la page, sous l'en-tête.
 */
export async function PageHeader({ title, sub, actions, crumbs, toolbar }: {
  title: string; sub: ReactNode; actions?: ReactNode; crumbs?: ReactNode[]; toolbar?: ReactNode;
}) {
  // Champs affichés seulement : ni responsables ni site dans la charge de la page.
  const notifications = (await loadNotifications()).map((n) => ({
    key: n.key, date: n.date, kind: n.kind, tone: n.tone, title: n.title, who: n.who, href: n.href, urgent: n.urgent, read: n.read,
    elsewhere: n.elsewhere, siteLabel: n.siteLabel, family: n.family,
  }));
  const [{ lang, t }, theme] = await Promise.all([getI18n(), cookies().then((c) => themeOf(c.get(THEME_COOKIE)?.value))]);
  const section = sectionOf(title);
  const trail = crumbs ?? (section ? [NAV_SECTION_EN[section] ? t(NAV_SECTION_EN[section]) : section] : undefined);
  const plus = <i className="ph ph-plus" style={{ fontSize: 14 }} aria-hidden />;
  return (
    <CoquePageHeader title={title} crumbs={trail} subtitle={sub}
      search={(
        <form action={SEARCH_PATH} role="search">
          <i className="ph ph-magnifying-glass coque-header-search-icon" style={{ fontSize: 14 }} aria-hidden />
          <input className="input" name="q" type="search" placeholder={t('Search…')} aria-label={t('Search Vigie')}
            minLength={SEARCH_MIN} maxLength={100} autoComplete="off" />
        </form>
      )}
      actions={actions}
      primary={(
        <>
          {/* Formulaire terrain réel (EVT-06) ; en démonstration, aperçu mobile sur grand écran et formulaire sur téléphone. */}
          {isDemo() && <Link href="/apercu-mobile" className="btn btn-primary vg-wide-only">{plus}{t('New report')}</Link>}
          <Link href="/signaler" className={`btn btn-primary${isDemo() ? ' vg-narrow-only' : ''}`}>{plus}{t('New report')}</Link>
        </>
      )}
      help={<HelpButton />}
      bell={<NotificationBell items={notifications} />}
      prefs={<Prefs lang={lang} theme={theme} />}
      toolbar={toolbar} />
  );
}
