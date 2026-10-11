import { Bootstrap } from '@/components/Bootstrap';
import { Sidebar, type NavSection } from '@/components/Sidebar';
import { NAV, ROLE_KEYS, SCREENS, canApprove, canSee, initials } from '@/lib/domain';
import { loadCounters } from '@/lib/data/counters';
import { loadQhseLeadOptions, loadSiteAdmin } from '@/lib/data/sites';
import { getSession } from '@/lib/session';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const session = await getSession();
  const { role, user, site, siteOptions, demo } = session;
  // Base sans site (première mise en service en production) : écran d'amorçage à la place de l'application.
  if (session.bootstrap) return <Bootstrap session={session} leadOptions={canApprove(role) ? await loadQhseLeadOptions() : []} />;
  // Gestion des sites (création, renommage, responsable QHSE, archivage) : animateur QHSE et direction.
  const [counters, siteAdmin] = await Promise.all([
    loadCounters(),
    canApprove(role) ? Promise.all([loadSiteAdmin(), loadQhseLeadOptions()]).then(([sites, leadOptions]) => ({ sites, leadOptions })) : null,
  ]);
  const nav: NavSection[] = NAV.map((sec) => ({
    label: sec.label,
    items: sec.items.filter((k) => canSee(role, k)).map((k) => ({ key: k, href: SCREENS[k].path, label: SCREENS[k].label, icon: SCREENS[k].icon, badge: counters.badges[k] })),
  })).filter((s) => s.items.length);

  return (
    <div className="vg-app">
      <Sidebar nav={nav} site={site} sites={siteOptions} user={{ name: user.name, initials: initials(user.name) }} role={role}
        demo={demo} roles={demo ? ROLE_KEYS : []} siteAdmin={siteAdmin} />
      <main className="vg-main">{children}</main>
    </div>
  );
}
