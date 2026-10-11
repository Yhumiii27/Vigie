'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { setRole, setSite } from '@/app/actions';
import { LOGOUT_PATH } from '@/lib/auth/paths';
import { SitesManager, type SiteAdmin } from './SitesManager';

export type NavSection = { label: string; items: { key: string; href: string; label: string; icon: string; badge?: number }[] };

type Props = {
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

const isActive = (pathname: string, href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, close]);
  return ref;
}

export function Sidebar({ nav, site, sites, user, role, demo, roles, siteAdmin }: Props) {
  const pathname = usePathname();
  const [siteOpen, setSiteOpen] = useState(false);
  const [manageSites, setManageSites] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [, start] = useTransition();
  const siteRef = useDismiss(siteOpen, () => setSiteOpen(false));
  const roleRef = useDismiss(roleOpen, () => setRoleOpen(false));

  return (
    <aside className="vg-side">
      <div className="vg-brand">
        <span className="vg-brand-mark">V</span>
        <span className="vg-brand-name">Vigie</span>
        <span className="tag tag-outline" style={{ fontSize: 10, padding: '1px 7px' }}>QHSE</span>
      </div>

      <div ref={siteRef} style={{ position: 'relative', padding: '0 2px' }}>
        <button type="button" className="vg-site-btn" aria-expanded={siteOpen} onClick={() => setSiteOpen((o) => !o)}>
          <i className="ph ph-factory" style={{ fontSize: 15, color: 'var(--color-neutral-500)' }} />
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site.label}</span>
          <i className="ph ph-caret-down" style={{ fontSize: 12, color: 'var(--color-neutral-500)' }} />
        </button>
        {siteOpen && (
          <div className="vg-menu elev-md" style={{ left: 2, right: 2, top: 'calc(100% + 4px)' }}>
            {sites.map((s) => (
              <button key={s.id} type="button" className={`vg-menu-item${s.id === site.id ? ' is-on' : ''}`}
                onClick={() => { setSiteOpen(false); start(() => setSite(s.id)); }}>
                {s.label}
              </button>
            ))}
            {siteAdmin && (
              <>
                <div style={{ height: 1, background: 'var(--color-divider)', margin: '4px 0' }} />
                <button type="button" className="vg-menu-item" style={{ display: 'flex', alignItems: 'center', gap: 7 }}
                  onClick={() => { setSiteOpen(false); setManageSites(true); }}>
                  <i className="ph ph-gear-six" style={{ fontSize: 14, color: 'var(--color-neutral-500)' }} />Gérer les sites…
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {siteAdmin && manageSites && <SitesManager {...siteAdmin} onClose={() => setManageSites(false)} />}

      <nav className="vg-nav">
        {nav.map((sec) => (
          <div key={sec.label} className="vg-nav-sec">
            <div className="vg-eyebrow">{sec.label}</div>
            {sec.items.map((it) => (
              <Link key={it.key} href={it.href} className={`vg-item${isActive(pathname, it.href) ? ' is-on' : ''}`}>
                <i className={`ph ${it.icon}`} style={{ fontSize: 16 }} />
                <span className="vg-item-label">{it.label}</span>
                {!!it.badge && <span className="vg-badge">{it.badge}</span>}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      {demo && (
        <Link href="/apercu-mobile" className={`vg-mobile-link${isActive(pathname, '/apercu-mobile') ? ' is-on' : ''}`}>
          <i className="ph ph-device-mobile" style={{ fontSize: 15 }} />
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
                    onClick={() => { setRoleOpen(false); start(() => setRole(r)); }}>
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div title="Mode démonstration (VIGIE_DEMO=1) : le rôle se choisit ici ; en production, il vient de Microsoft Entra ID"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px 0', fontSize: 10.5, color: 'var(--color-neutral-600)' }}>
            <i className="ph ph-flask" style={{ fontSize: 12 }} />Mode démonstration · sélecteur de rôle
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
                <i className="ph ph-sign-out" style={{ fontSize: 14, color: 'var(--color-neutral-500)' }} />Se déconnecter
              </a>
            </div>
          )}
        </div>
      )}
    </aside>
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
