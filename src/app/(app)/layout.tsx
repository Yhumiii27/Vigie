import { Sidebar, type NavSection } from '@/components/Sidebar';
import { NAV, ROLE_KEYS, SCREENS, canSee, initials, type ScreenKey } from '@/lib/domain';
import { loadCounters } from '@/lib/data/counters';
import { getSession } from '@/lib/session';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const [{ role, user, site, siteOptions }, counters] = await Promise.all([getSession(), loadCounters()]);
  const badges: Partial<Record<ScreenKey, number>> = {
    events: counters.openEvents,
    actions: counters.lateActions,
    skills: counters.skillAlerts,
    watch: counters.controlsSoon,
    prevention: counters.prevention,
    docs: counters.documents,
    env: counters.environment,
  };
  const nav: NavSection[] = NAV.map((sec) => ({
    label: sec.label,
    items: sec.items.filter((k) => canSee(role, k)).map((k) => ({ key: k, href: SCREENS[k].path, label: SCREENS[k].label, icon: SCREENS[k].icon, badge: badges[k] })),
  })).filter((s) => s.items.length);

  return (
    <div className="vg-app">
      <Sidebar nav={nav} site={site} sites={siteOptions} user={{ name: user.name, initials: initials(user.name) }} role={role} roles={ROLE_KEYS} />
      <main className="vg-main">{children}</main>
    </div>
  );
}
