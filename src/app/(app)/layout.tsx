import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { Bootstrap } from '@/components/Bootstrap';
import type { NavSection } from '@/components/Sidebar';
import { NAV, ROLE_KEYS, SCREENS, canApprove, canSee, initials } from '@/lib/domain';
import { loadCounters } from '@/lib/data/counters';
import { loadConnectors } from '@/lib/data/connectors';
import { loadInboundOverview } from '@/lib/data/inbound';
import { loadMatrixSiteChoices, loadQhseLeadOptions, loadSiteAdmin } from '@/lib/data/sites';
import { getSession } from '@/lib/session';

// Manifeste du signalement installable (EVT-20) lié aux seules pages /signaler : l'application ne s'installe pas d'ici.
export const metadata: Metadata = { manifest: null };

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const session = await getSession();
  const { role, user, site, siteOptions, demo } = session;
  // Base sans site (première mise en service en production) : écran d'amorçage à la place de l'application.
  if (session.bootstrap) {
    const [leadOptions, matrix] = canApprove(role) ? await Promise.all([loadQhseLeadOptions(), loadMatrixSiteChoices()]) : [[], { choices: [], message: null }];
    return <Bootstrap session={session} leadOptions={leadOptions} matrix={matrix} />;
  }
  // Gestion des sites (suivi d'un site de Matrix, responsable QHSE, « ne plus suivre », connecteurs) : animateur QHSE et direction.
  const [counters, siteAdmin] = await Promise.all([
    loadCounters(),
    canApprove(role)
      ? Promise.all([loadSiteAdmin(), loadQhseLeadOptions(), loadMatrixSiteChoices(), loadConnectors(), loadInboundOverview()])
        .then(([sites, leadOptions, matrix, connectors, inbound]) => ({ sites, leadOptions, matrix, connectors, inbound }))
      : null,
  ]);
  const nav: NavSection[] = NAV.map((sec) => ({
    label: sec.label,
    items: sec.items.filter((k) => canSee(role, k)).map((k) => ({ key: k, href: SCREENS[k].path, label: SCREENS[k].label, icon: SCREENS[k].icon, badge: counters.badges[k] })),
  })).filter((s) => s.items.length);

  // Coque : barre latérale, et sur téléphone barre supérieure et tiroir de navigation (UX-01).
  return (
    <AppShell sidebar={{ nav, site, sites: siteOptions, user: { name: user.name, initials: initials(user.name) }, role, demo, roles: demo ? ROLE_KEYS : [], siteAdmin }}>
      {children}
    </AppShell>
  );
}
