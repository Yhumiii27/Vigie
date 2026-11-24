'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Binoculars } from '@phosphor-icons/react/dist/ssr';
import { useMemo, useState } from 'react';
import { setRole, setSite } from '@/app/actions';
import { LOGOUT_PATH, MY_SPACE_PATH } from '@/lib/auth/paths';
import { SaveStatus, useActionRunner } from './feedback';
import { menuItemProps, useMenu } from './Menu';
import { SitesManager, type SiteAdmin } from './SitesManager';
import { NavSection as CoqueNavSection, NavSections, PageSearch, Sidebar as CoqueSidebar, useCoque, type PageHit } from './coque';
import { Icon } from './ui';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';
import { navCookie } from '@/lib/nav-state';

export type NavSection = { key: string; label: string; items: { key: string; href: string; label: string; icon: string; badge?: number }[] };

/** Contenu de la barre latérale (fourni par la mise en page) ; l'état du tiroir (≤ 1024 px) vient de la coque commune. */
export type SidebarProps = {
  nav: NavSection[];
  site: { id: string; label: string };
  sites: { id: string; label: string }[];
  user: { name: string; initials: string };
  role: string;
  /** Mode démonstration : sélecteur de rôle et aperçu mobile ; sinon, le rôle vient d'Entra ID (déconnexion). */
  demo: boolean;
  /** Rôles du sélecteur de démonstration (vide hors démonstration). */
  roles: string[];
  /** Sites (archivés compris) et responsables proposés pour « Gérer les sites… » ; null si le rôle ne peut pas les administrer. */
  siteAdmin?: SiteAdmin | null;
  /** Sections repliées (cookie vigie-nav, relu par la mise en page : pas de saut au chargement). */
  closed?: string[];
};

const isActive = (pathname: string, href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

/** Barre latérale (Norma 2.1, COQUE.md § 2) : marque, recherche de pages ⌘K, site choisi, sections repliables, compte. */
export function Sidebar({ nav, site, sites, user, role, demo, roles, siteAdmin, closed = [] }: SidebarProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const { closeNav } = useCoque();
  const [manageSites, setManageSites] = useState(false);
  const [folded, setFolded] = useState<string[]>(closed);
  const toggle = (key: string) => setFolded((cur) => {
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    document.cookie = navCookie(next);
    return next;
  });
  const pages = useMemo<PageHit[]>(() => nav.flatMap((sec) => sec.items.map((it) => ({ href: it.href, label: it.label, section: sec.label, badge: it.badge || undefined }))), [nav]);
  const siteMenu = useMenu();
  const roleMenu = useMenu();
  // Choix du site ou du rôle (UX-14) : attente affichée, refus ou échec annoncés, confirmation du site choisi.
  const { pending, error, run } = useActionRunner();
  const chooseSite = (s: { id: string; label: string }) => {
    siteMenu.close(true);
    if (s.id === site.id) return;
    closeNav();
    run(() => setSite(s.id), { success: fill(t('Site selected: {site}.'), { site: s.label }) });
  };
  const chooseRole = (r: string) => {
    roleMenu.close(true);
    if (r === role) return;
    closeNav();
    run(() => setRole(r));
  };

  const footer = (
    <>
      {/* EVT-22 : espace salarié mobile, sur téléphone (tiroir de navigation) seulement. */}
      <Link href={MY_SPACE_PATH} className="coque-entry vg-narrow-only" onClick={() => closeNav()}>
        <Icon name="ph-user-circle" size={16} />
        <span className="coque-entry-label">{t('My space · actions, qualifications')}</span>
      </Link>
      {demo && (
        <Link href="/apercu-mobile" className="coque-entry" onClick={() => closeNav()} aria-current={isActive(pathname, '/apercu-mobile') ? 'page' : undefined}>
          <Icon name="ph-device-mobile" size={16} />
          <span className="coque-entry-label">{t('Mobile preview · field report')}</span>
        </Link>
      )}
      <div {...roleMenu.rootProps} style={{ position: 'relative' }}>
        <button type="button" className="coque-user" disabled={pending} {...roleMenu.buttonProps}>
          <span className="vg-sr-only">{demo ? t('Change role (demonstration): ') : t('Microsoft account: ')}</span>
          <span className="coque-avatar" aria-hidden>{user.initials}</span>
          <span className="coque-who">
            <span className="coque-who-name">{user.name}<span className="vg-sr-only">, </span></span>
            <span className="coque-who-role">{role}</span>
          </span>
          <Icon name="ph-caret-up-down" size={12} style={{ marginLeft: 'auto', color: 'var(--color-neutral-500)' }} />
        </button>
        {roleMenu.open && (demo ? (
          <div className="vg-menu elev-md" style={{ left: 0, right: 0, bottom: 'calc(100% + 4px)' }} {...roleMenu.menuProps} aria-label={t('View as')} aria-labelledby={undefined}>
            <div className="vg-eyebrow" aria-hidden style={{ padding: '4px 8px 2px' }}>{t('View as')}</div>
            {roles.map((r) => (
              <button key={r} type="button" className={`vg-menu-item${r === role ? ' is-on' : ''}`} {...menuItemProps(r === role)}
                onClick={() => chooseRole(r)}>
                {r}
              </button>
            ))}
          </div>
        ) : (
          <div className="vg-menu elev-md" style={{ left: 0, right: 0, bottom: 'calc(100% + 4px)' }} {...roleMenu.menuProps}>
            {/* Lien simple (pas de préchargement) : la déconnexion termine aussi la session Microsoft. */}
            <a href={LOGOUT_PATH} className="vg-menu-item" style={{ display: 'flex', alignItems: 'center', gap: 7 }} {...menuItemProps()}>
              <Icon name="ph-sign-out" style={{ color: 'var(--color-neutral-500)' }} />{t('Sign out')}
            </a>
          </div>
        ))}
      </div>
      {demo && (
        <p style={{ display: 'flex', alignItems: 'flex-start', gap: 6, margin: 0, padding: '0 8px', fontSize: 11, color: 'var(--vg-text-muted)' }}>
          <Icon name="ph-flask" size={12} style={{ marginTop: 2 }} />
          <span>{t('Demonstration mode · role selector')}<span className="vg-sr-only">{t(' (in production, the role comes from Microsoft Entra ID)')}</span></span>
        </p>
      )}
    </>
  );

  return (
    <>
      <CoqueSidebar name="Vigie" icon={Binoculars} footer={footer}>
        {/* VG-N07 (COQUE.md § 2) : aller à une page par son nom, juste sous la marque ; ⌘K / Ctrl+K, Entrée ouvre la première. */}
        <PageSearch pages={pages}>
          {/* Sélecteur propre à Vigie : le site choisi (COQUE.md § 2, « sélecteurs propres à un outil »). */}
          <div {...siteMenu.rootProps} aria-busy={pending || undefined} style={{ position: 'relative' }}>
            <button type="button" className="vg-site-btn" aria-label={fill(t('Site: {site}'), { site: site.label })} disabled={pending} {...siteMenu.buttonProps}>
              <Icon name="ph-factory" size={15} style={{ color: 'var(--color-neutral-500)' }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site.label}</span>
              <Icon name="ph-caret-down" size={12} style={{ color: 'var(--color-neutral-500)' }} />
            </button>
            {siteMenu.open && (
              <div className="vg-menu elev-md" style={{ left: 0, right: 0, top: 'calc(100% + 4px)' }} {...siteMenu.menuProps}>
                {sites.map((s) => (
                  <button key={s.id} type="button" className={`vg-menu-item${s.id === site.id ? ' is-on' : ''}`} {...menuItemProps(s.id === site.id)}
                    onClick={() => chooseSite(s)}>
                    {s.label}
                  </button>
                ))}
                {siteAdmin && (
                  <>
                    <div role="separator" style={{ height: 1, background: 'var(--color-divider)', margin: '4px 0' }} />
                    <button type="button" className="vg-menu-item" style={{ display: 'flex', alignItems: 'center', gap: 7 }} {...menuItemProps()}
                      onClick={() => { siteMenu.close(false); closeNav(); setManageSites(true); }}>
                      <Icon name="ph-gear-six" style={{ color: 'var(--color-neutral-500)' }} />{t('Manage sites…')}
                    </button>
                  </>
                )}
              </div>
            )}
            <div style={{ padding: '4px 2px 0' }}><SaveStatus pending={pending} label={t('Changing…')} /></div>
            {error && !pending && <div role="alert" className="vg-form-error" style={{ marginTop: 6, fontSize: 12 }}>{error}</div>}
          </div>

          <nav aria-label={t('Main navigation')}>
            <NavSections>
              {nav.map((sec) => {
                const open = !folded.includes(sec.key);
                const here = sec.items.some((it) => isActive(pathname, it.href));
                const badge = sec.items.reduce((n, it) => n + (it.badge ?? 0), 0);
                return (
                  <CoqueNavSection key={sec.key} label={sec.label} open={open} onToggle={() => toggle(sec.key)} bright={here}
                    badge={!open && badge ? badge : undefined}>
                    {open && sec.items.map((it) => {
                      const on = isActive(pathname, it.href);
                      return (
                        <Link key={it.key} href={it.href} className="coque-entry is-item" aria-current={on ? 'page' : undefined} onClick={() => closeNav()}>
                          <Icon name={it.icon} size={16} />
                          <span className="coque-entry-label">{it.label}</span>
                          {!!it.badge && <span className="coque-badge"><span aria-hidden>{it.badge}</span><span className="vg-sr-only">{fill(t(' ({n} to handle)'), { n: it.badge })}</span></span>}
                        </Link>
                      );
                    })}
                  </CoqueNavSection>
                );
              })}
            </NavSections>
          </nav>
        </PageSearch>
      </CoqueSidebar>
      {/* Hors de <aside> : une fenêtre ouverte depuis le tiroir fermé hériterait de sa visibilité masquée (téléphone). */}
      {siteAdmin && manageSites && <SitesManager {...siteAdmin} onClose={() => setManageSites(false)} />}
    </>
  );
}

