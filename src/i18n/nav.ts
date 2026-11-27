// Libellés de navigation en chaînes sources anglaises (VG-N01) : sections de NAV et entrées de la barre latérale. Les
// libellés français de src/lib/domain.ts (SCREENS, NAV) restent ceux des titres de page ; nav.test.ts vérifie que la
// traduction française de chaque chaîne source est exactement ce libellé.
import type { ScreenKey } from '@/lib/domain';

export const NAV_SECTION_EN: Record<string, string> = {
  Pilotage: 'Steering',
  Terrain: 'Field',
  Prévention: 'Prevention',
  Système: 'System',
};

export const SCREEN_LABEL_EN: Partial<Record<ScreenKey, string>> = {
  dashboard: 'Dashboard',
  todo: 'To do',
  events: 'Reports and events',
  actions: 'Action plan#screen',
  prevention: 'Prevention plans and permits',
  risks: 'Risk assessment',
  skills: 'Qualifications and training',
  watch: 'Watch and inspections',
  audits: 'Audits and certifications',
  docs: 'Controlled documents',
  env: 'Environment and waste',
  engineering: 'Engineering changes',
};

/** Titres de page des écrans (SCREENS.title) en chaînes sources anglaises : PageHeader les traduit. */
export const SCREEN_TITLE_EN: Partial<Record<ScreenKey, string>> = {
  dashboard: 'QHSE dashboard',
  todo: 'To do',
  events: 'Reports and events',
  actions: 'Single action plan',
  prevention: 'Prevention plans and permits',
  risks: 'Risk assessment',
  skills: 'Qualifications and training',
  watch: 'Regulatory watch and inspections',
  audits: 'Audits and certifications',
  docs: 'Controlled documents',
  env: 'Environment and waste',
  engineering: 'Engineering changes',
  contributions: 'My contributions to the management review',
  search: 'Search',
};
