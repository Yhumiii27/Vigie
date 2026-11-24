'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { setRole, setSite } from '@/app/actions';
import { LOGOUT_PATH, MY_SPACE_PATH } from '@/lib/auth/paths';
import { SaveStatus, useActionRunner } from './feedback';
import { menuItemProps, useMenu } from './Menu';
import { SitesManager, type SiteAdmin } from './SitesManager';
import { HelpButton } from './HelpDialog';
import { SEARCH_MIN, SEARCH_PATH } from '@/lib/rules/search';
import { isPageSearchShortcut, matchPages } from '@/lib/rules/page-search';
import { Icon } from './ui';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

export type NavSection = { label: string; items: { key: string; href: string; label: string; icon: string; badge?: number }[] };

/** Contenu de la barre latérale (fourni par la mise en page) ; l'état du tiroir sur téléphone vient d'AppShell. */
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
};

type Props = SidebarProps & {
  /** Tiroir ouvert (téléphone, UX-01). */
  open?: boolean;
  /** Navigation (lien, choix du site ou du rôle) : ferme le tiroir. */
  onNavigate?: () => void;
  /** Bouton « Fermer le menu » du tiroir. */
  onClose?: () => void;
};

const isActive = (pathname: string, href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

export function Sidebar({ nav, site, sites, user, role, demo, roles, siteAdmin, open = false, onNavigate, onClose }: Props) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [manageSites, setManageSites] = useState(false);
  // VG-N07 : recherche de pages (⌘K / Ctrl+K), sur les entrées de navigation ouvertes au rôle.
  const [pageQuery, setPageQuery] = useState('');
  const pageSearchRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => matchPages(nav, pageQuery), [nav, pageQuery]);
  const searching = pageQuery.trim() !== '';
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!isPageSearchShortcut(e)) return;
      e.preventDefault();
      pageSearchRef.current?.focus();
      pageSearchRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const onPageSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && pageQuery) { e.preventDefault(); setPageQuery(''); }
    else if (e.key === 'Enter' && hits[0]) {
      e.preventDefault();
      setPageQuery('');
      onNavigate?.();
      router.push(hits[0].href);
    }
  };
  const siteMenu = useMenu();
  const roleMenu = useMenu();
  // Choix du site ou du rôle (UX-14) : attente affichée, refus ou échec annoncés, confirmation du site choisi.
  const { pending, error, run } = useActionRunner();
  const chooseSite = (s: { id: string; label: string }) => {
    siteMenu.close(true);
    if (s.id === site.id) return;
    onNavigate?.();
    run(() => setSite(s.id), { success: fill(t('Site selected: {site}.'), { site: s.label }) });
  };
  const chooseRole = (r: string) => {
    roleMenu.close(true);
    if (r === role) return;
    onNavigate?.();
    run(() => setRole(r));
  };

  return (
    <>
      <aside id="vg-side" aria-label={t('Sidebar')} className={`vg-side${open ? ' is-open' : ''}`} aria-busy={pending || undefined}>
        <div className="vg-brand">
          <span className="vg-brand-mark" aria-hidden>V</span>
          <span className="vg-brand-name">Vigie</span>
          <span className="tag tag-outline" style={{ fontSize: 11, padding: '1px 7px' }}>QHSE</span>
          {/* Tiroir de navigation (téléphone) : fermeture explicite, en plus d'Échap et du fond. */}
          <button type="button" className="btn btn-ghost btn-icon vg-narrow-only vg-side-close" aria-label={t('Close the menu')} onClick={onClose}>
            <Icon name="ph-x" size={16} />
          </button>
        </div>

        {/* VG-N07 (Norma § 7) : aller à une page par son nom ; ⌘K / Ctrl+K y place le curseur, Entrée ouvre la première. */}
        <div className="vg-side-search vg-page-search">
          <label htmlFor="vg-page-search" className="vg-sr-only">{t('Go to a page')}</label>
          <Icon name="ph-arrow-bend-down-right" size={14} style={{ color: 'var(--color-neutral-500)' }} />
          <input id="vg-page-search" ref={pageSearchRef} type="search" placeholder={t('Go to a page…')} autoComplete="off" maxLength={60}
            value={pageQuery} onChange={(e) => setPageQuery(e.target.value)} onKeyDown={onPageSearchKey}
            aria-describedby="vg-page-search-hint" aria-controls={searching ? 'vg-page-hits' : undefined} />
          <kbd className="vg-kbd" aria-hidden>⌘K</kbd>
          <span id="vg-page-search-hint" className="vg-sr-only">{t('Shortcut Command K or Control K; Enter opens the first page found.')}</span>
        </div>
        <p className="vg-sr-only" role="status" aria-live="polite">
          {searching ? (hits.length === 1 ? t('1 page found') : hits.length ? fill(t('{n} pages found'), { n: hits.length }) : t('No page found')) : ''}
        </p>

        <div {...siteMenu.rootProps} style={{ position: 'relative', padding: '0 2px' }}>
          <button type="button" className="vg-site-btn" aria-label={fill(t('Site: {site}'), { site: site.label })} disabled={pending} {...siteMenu.buttonProps}>
            <Icon name="ph-factory" size={15} style={{ color: 'var(--color-neutral-500)' }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site.label}</span>
            <Icon name="ph-caret-down" size={12} style={{ color: 'var(--color-neutral-500)' }} />
          </button>
          {siteMenu.open && (
            <div className="vg-menu elev-md" style={{ left: 2, right: 2, top: 'calc(100% + 4px)' }} {...siteMenu.menuProps}>
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
                    onClick={() => { siteMenu.close(false); onNavigate?.(); setManageSites(true); }}>
                    <Icon name="ph-gear-six" style={{ color: 'var(--color-neutral-500)' }} />{t('Manage sites…')}
                  </button>
                </>
              )}
            </div>
          )}
          <div style={{ padding: '4px 2px 0' }}><SaveStatus pending={pending} label={t('Changing…')} /></div>
          {error && !pending && <div role="alert" className="vg-form-error" style={{ marginTop: 6, fontSize: 12 }}>{error}</div>}
        </div>

        {/* TDB-18 : recherche globale (tous les modules ouverts au rôle, site sélectionné), bureau et tiroir du téléphone. */}
        <form action={SEARCH_PATH} role="search" className="vg-side-search" onSubmit={onNavigate}>
          <label htmlFor="vg-side-search" className="vg-sr-only">{t('Search Vigie')}</label>
          <Icon name="ph-magnifying-glass" size={14} style={{ color: 'var(--color-neutral-500)' }} />
          <input id="vg-side-search" name="q" type="search" placeholder={t('Search…')} minLength={SEARCH_MIN} maxLength={100} autoComplete="off" />
        </form>

        {searching ? (
          <nav id="vg-page-hits" className="vg-nav" aria-label={t('Pages found')}>
            {hits.map((it) => {
              const on = isActive(pathname, it.href);
              return (
                <Link key={it.key} href={it.href} className={`vg-item${on ? ' is-on' : ''}`} aria-current={on ? 'page' : undefined}
                  onClick={() => { setPageQuery(''); onNavigate?.(); }}>
                  <Icon name={it.icon} size={16} />
                  <span className="vg-item-label">{it.label}</span>
                  <span className="vg-page-hit-section">{it.section}</span>
                </Link>
              );
            })}
            {!hits.length && <p className="vg-page-hit-empty">{t('No page matches.')}</p>}
          </nav>
        ) : (
        <nav className="vg-nav" aria-label={t('Main navigation')}>
          {nav.map((sec) => (
            <div key={sec.label} className="vg-nav-sec" role="group" aria-labelledby={`vg-nav-${sec.label}`}>
              <div className="vg-eyebrow" id={`vg-nav-${sec.label}`}>{sec.label}</div>
              {sec.items.map((it) => {
                const on = isActive(pathname, it.href);
                return (
                  <Link key={it.key} href={it.href} className={`vg-item${on ? ' is-on' : ''}`} aria-current={on ? 'page' : undefined} onClick={onNavigate}>
                    <Icon name={it.icon} size={16} />
                    <span className="vg-item-label">{it.label}</span>
                    {!!it.badge && <span className="vg-badge"><span aria-hidden>{it.badge}</span><span className="vg-sr-only">{fill(t(' ({n} to handle)'), { n: it.badge })}</span></span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        )}

        {/* UX-16 : aide de l'écran affiché et glossaire des indicateurs. */}
        <HelpButton pathname={pathname} />

        {/* EVT-22 : espace salarié mobile, sur téléphone (tiroir de navigation) seulement. */}
        <Link href={MY_SPACE_PATH} className="vg-mobile-link vg-narrow-only" onClick={onNavigate}>
          <Icon name="ph-user-circle" size={15} />
          <span style={{ flex: 1 }}>{t('My space · actions, qualifications')}</span>
        </Link>

        {demo && (
          <Link href="/apercu-mobile" className={`vg-mobile-link${isActive(pathname, '/apercu-mobile') ? ' is-on' : ''}`}
            aria-current={isActive(pathname, '/apercu-mobile') ? 'page' : undefined} onClick={onNavigate}>
            <Icon name="ph-device-mobile" size={15} />
            <span style={{ flex: 1 }}>{t('Mobile preview · field report')}</span>
          </Link>
        )}

        {demo ? (
          <>
            <div {...roleMenu.rootProps} style={{ position: 'relative' }}>
              <button type="button" className="vg-user" disabled={pending} {...roleMenu.buttonProps}>
                <span className="vg-sr-only">{t('Change role (demonstration): ')}</span>
                <UserBadge user={user} role={role} />
              </button>
              {roleMenu.open && (
                <div className="vg-menu elev-md" style={{ left: 2, right: 2, bottom: 'calc(100% + 4px)' }} {...roleMenu.menuProps} aria-label={t('View as')} aria-labelledby={undefined}>
                  <div className="vg-eyebrow" aria-hidden style={{ padding: '4px 8px 2px' }}>{t('View as')}</div>
                  {roles.map((r) => (
                    <button key={r} type="button" className={`vg-menu-item${r === role ? ' is-on' : ''}`} {...menuItemProps(r === role)}
                      onClick={() => chooseRole(r)}>
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p style={{ display: 'flex', alignItems: 'flex-start', gap: 6, margin: 0, padding: '6px 10px 0', fontSize: 11, color: 'var(--vg-text-muted)' }}>
              <Icon name="ph-flask" size={12} style={{ marginTop: 2 }} />
              <span>{t('Demonstration mode · role selector')}<span className="vg-sr-only">{t(' (in production, the role comes from Microsoft Entra ID)')}</span></span>
            </p>
          </>
        ) : (
          <div {...roleMenu.rootProps} style={{ position: 'relative' }}>
            <button type="button" className="vg-user" {...roleMenu.buttonProps}>
              <span className="vg-sr-only">{t('Microsoft account: ')}</span>
              <UserBadge user={user} role={role} />
            </button>
            {roleMenu.open && (
              <div className="vg-menu elev-md" style={{ left: 2, right: 2, bottom: 'calc(100% + 4px)' }} {...roleMenu.menuProps}>
                {/* Lien simple (pas de préchargement) : la déconnexion termine aussi la session Microsoft. */}
                <a href={LOGOUT_PATH} className="vg-menu-item" style={{ display: 'flex', alignItems: 'center', gap: 7 }} {...menuItemProps()}>
                  <Icon name="ph-sign-out" style={{ color: 'var(--color-neutral-500)' }} />{t('Sign out')}
                </a>
              </div>
            )}
          </div>
        )}
      </aside>
      {/* Hors de <aside> : une fenêtre ouverte depuis le tiroir fermé hériterait de sa visibilité masquée (téléphone). */}
      {siteAdmin && manageSites && <SitesManager {...siteAdmin} onClose={() => setManageSites(false)} />}
    </>
  );
}

function UserBadge({ user, role }: { user: { name: string; initials: string }; role: string }) {
  return (
    <>
      <span className="vg-avatar" style={{ width: 30, height: 30, fontSize: 11 }} aria-hidden>{user.initials}</span>
      <span style={{ minWidth: 0, display: 'grid', gap: 1 }}>
        <span style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}<span className="vg-sr-only">, </span></span>
        <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{role}</span>
      </span>
    </>
  );
}
