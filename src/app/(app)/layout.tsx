import { Sidebar, type NavSection } from '@/components/Sidebar';
import { NAV, ROLE_KEYS, SCREENS, canApprove, canSee, initials } from '@/lib/domain';
import { loadCounters } from '@/lib/data/counters';
import { loadSiteAdmin } from '@/lib/data/sites';
import { getSession } from '@/lib/session';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const [{ role, user, site, siteOptions }, counters] = await Promise.all([getSession(), loadCounters()]);
  // Gestion des sites (création, renommage, archivage) : animateur QHSE et direction.
  const siteAdmin = canApprove(role) ? await loadSiteAdmin() : null;
  const nav: NavSection[] = NAV.map((sec) => ({
    label: sec.label,
    items: sec.items.filter((k) => canSee(role, k)).map((k) => ({ key: k, href: SCREENS[k].path, label: SCREENS[k].label, icon: SCREENS[k].icon, badge: counters.badges[k] })),
  })).filter((s) => s.items.length);

  return (
    <div className="vg-app">
      <Sidebar nav={nav} site={site} sites={siteOptions} user={{ name: user.name, initials: initials(user.name) }} role={role} roles={ROLE_KEYS} siteAdmin={siteAdmin} />
      <main className="vg-main">{children}</main>
    </div>
  );
}
