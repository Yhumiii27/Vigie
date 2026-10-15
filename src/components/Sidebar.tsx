'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { setRole, setSite } from '@/app/actions';
import { LOGOUT_PATH } from '@/lib/auth/paths';
import { SitesManager, type SiteAdmin } from './SitesManager';
import { Icon } from './ui';

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

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    // Phase de capture et preventDefault : Échap ferme le menu seulement, pas le tiroir de navigation (AppShell).
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open, close]);
  return ref;
}

export function Sidebar({ nav, site, sites, user, role, demo, roles, siteAdmin, open = false, onNavigate, onClose }: Props) {
  const pathname = usePathname();
  const [siteOpen, setSiteOpen] = useState(false);
  const [manageSites, setManageSites] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [, start] = useTransition();
  const siteRef = useDismiss(siteOpen, () => setSiteOpen(false));
  const roleRef = useDismiss(roleOpen, () => setRoleOpen(false));

  return (
    <>
      <aside id="vg-side" aria-label="Navigation" className={`vg-side${open ? ' is-open' : ''}`}>
        <div className="vg-brand">
          <span className="vg-brand-mark" aria-hidden>V</span>
          <span className="vg-brand-name">Vigie</span>
          <span className="tag tag-outline" style={{ fontSize: 10, padding: '1px 7px' }}>QHSE</span>
          {/* Tiroir de navigation (téléphone) : fermeture explicite, en plus d'Échap et du fond. */}
          <button type="button" className="btn btn-ghost btn-icon vg-narrow-only vg-side-close" aria-label="Fermer le menu" onClick={onClose}>
            <Icon name="ph-x" size={16} />
          </button>
        </div>

        <div ref={siteRef} style={{ position: 'relative', padding: '0 2px' }}>
          <button type="button" className="vg-site-btn" aria-expanded={siteOpen} aria-label={`Site : ${site.label}`} onClick={() => setSiteOpen((o) => !o)}>
            <Icon name="ph-factory" size={15} style={{ color: 'var(--color-neutral-500)' }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site.label}</span>
            <Icon name="ph-caret-down" size={12} style={{ color: 'var(--color-neutral-500)' }} />
          </button>
          {siteOpen && (
            <div className="vg-menu elev-md" style={{ left: 2, right: 2, top: 'calc(100% + 4px)' }}>
              {sites.map((s) => (
                <button key={s.id} type="button" className={`vg-menu-item${s.id === site.id ? ' is-on' : ''}`}
                  onClick={() => { setSiteOpen(false); onNavigate?.(); start(() => setSite(s.id)); }}>
                  {s.label}
                </button>
              ))}
              {siteAdmin && (
                <>
                  <div style={{ height: 1, background: 'var(--color-divider)', margin: '4px 0' }} />
                  <button type="button" className="vg-menu-item" style={{ display: 'flex', alignItems: 'center', gap: 7 }}
                    onClick={() => { setSiteOpen(false); onNavigate?.(); setManageSites(true); }}>
                    <Icon name="ph-gear-six" style={{ color: 'var(--color-neutral-500)' }} />Gérer les sites…
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <nav className="vg-nav">
          {nav.map((sec) => (
            <div key={sec.label} className="vg-nav-sec">
              <div className="vg-eyebrow">{sec.label}</div>
              {sec.items.map((it) => {
                const on = isActive(pathname, it.href);
                return (
                  <Link key={it.key} href={it.href} className={`vg-item${on ? ' is-on' : ''}`} aria-current={on ? 'page' : undefined} onClick={onNavigate}>
                    <Icon name={it.icon} size={16} />
                    <span className="vg-item-label">{it.label}</span>
                    {!!it.badge && <span className="vg-badge">{it.badge}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {demo && (
          <Link href="/apercu-mobile" className={`vg-mobile-link${isActive(pathname, '/apercu-mobile') ? ' is-on' : ''}`}
            aria-current={isActive(pathname, '/apercu-mobile') ? 'page' : undefined} onClick={onNavigate}>
            <Icon name="ph-device-mobile" size={15} />
            <span style={{ flex: 1 }}>Aperçu mobile · signalement terrain</span>
          </Link>
        )}

        {demo ? (
          <>
            <div ref={roleRef} style={{ position: 'relative' }}>
              <button type="button" className="vg-user" aria-expanded={roleOpen} onClick={() => setRoleOpen((o) => !o)} title="Changer de rôle (démonstration)">
                <UserBadge user={user} role={role} />
              </button>
              {roleOpen && (
                <div className="vg-menu elev-md" style={{ left: 2, right: 2, bottom: 'calc(100% + 4px)' }}>
                  <div className="vg-eyebrow" style={{ padding: '4px 8px 2px' }}>Voir en tant que</div>
                  {roles.map((r) => (
                    <button key={r} type="button" className={`vg-menu-item${r === role ? ' is-on' : ''}`}
                      onClick={() => { setRoleOpen(false); onNavigate?.(); start(() => setRole(r)); }}>
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div title="Mode démonstration (VIGIE_DEMO=1) : le rôle se choisit ici ; en production, il vient de Microsoft Entra ID"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px 0', fontSize: 10.5, color: 'var(--color-neutral-600)' }}>
              <Icon name="ph-flask" size={12} />Mode démonstration · sélecteur de rôle
            </div>
          </>
        ) : (
          <div ref={roleRef} style={{ position: 'relative' }}>
            <button type="button" className="vg-user" aria-expanded={roleOpen} onClick={() => setRoleOpen((o) => !o)} title="Compte Microsoft">
              <UserBadge user={user} role={role} />
            </button>
            {roleOpen && (
              <div className="vg-menu elev-md" style={{ left: 2, right: 2, bottom: 'calc(100% + 4px)' }}>
                {/* Lien simple (pas de préchargement) : la déconnexion termine aussi la session Microsoft. */}
                <a href={LOGOUT_PATH} className="vg-menu-item" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Icon name="ph-sign-out" style={{ color: 'var(--color-neutral-500)' }} />Se déconnecter
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
      <span className="vg-avatar" style={{ width: 30, height: 30, fontSize: 11 }}>{user.initials}</span>
      <span style={{ minWidth: 0, display: 'grid', gap: 1 }}>
        <span style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</span>
        <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{role}</span>
      </span>
    </>
  );
}
