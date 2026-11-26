// Dictionnaire français de l'interface (VG-N01) : chaîne source anglaise → texte affiché en français. Une entrée par
// chaîne passée à t() ; les écrans repris ont leur dictionnaire dans ./screens/ ; completeness.test.ts refuse une chaîne sans entrée (ou dont l'entrée recopie l'anglais sans
// figurer dans SAME_IN_FRENCH). Ordre : coque (barre latérale, en-tête, navigation), puis par écran à mesure de la reprise.

import { COMMON_FR, COMMON_SAME } from './screens/common';
import { DASHBOARD_FR } from './screens/dashboard';
import { TODO_FR } from './screens/todo';
import { EVENTS_FR, EVENTS_SAME } from './screens/events';
import { ACTIONS_FR, ACTIONS_SAME } from './screens/actions';
import { RISKS_FR, RISKS_SAME } from './screens/risks';
import { PREVENTION_FR, PREVENTION_SAME } from './screens/prevention';

/** Dictionnaires des écrans repris, dans l'ordre de la reprise (une chaîne commune à deux écrans va dans COMMON_FR). */
export const SCREEN_DICTIONARIES: Record<string, Record<string, string>> = {
  common: COMMON_FR,
  dashboard: DASHBOARD_FR,
  todo: TODO_FR,
  events: EVENTS_FR,
  actions: ACTIONS_FR,
  risks: RISKS_FR,
  prevention: PREVENTION_FR,
};

const SHELL_FR: Record<string, string> = {
  // Navigation (src/i18n/nav.ts)
  Steering: 'Pilotage',
  Field: 'Terrain',
  Prevention: 'Prévention',
  System: 'Système',
  Dashboard: 'Tableau de bord',
  'To do': 'À faire',
  'Reports and events': 'Signalements et événements',
  'Action plan': "Plan d'actions",
  'Prevention plans and permits': 'Plans de prévention et permis',
  'Risk assessment': 'Évaluation des risques',
  'Qualifications and training': 'Habilitations et formations',
  'Watch and inspections': 'Veille et contrôles',
  'Audits and certifications': 'Audits et certifications',
  'Controlled documents': 'Documents maîtrisés',
  'Environment and waste': 'Environnement et déchets',
  'Engineering changes': 'Modifications techniques',

  // Coque (src/components/AppShell.tsx, Sidebar.tsx)
  'Site: {site}': 'Site : {site}',
  'Manage sites…': 'Gérer les sites…',
  'Changing…': 'Changement en cours…',
  'Site selected: {site}.': 'Site sélectionné : {site}.',
  'Search Vigie': 'Rechercher dans Vigie',
  'Search…': 'Rechercher…',
  'Go to a page…': 'Aller à une page…',
  '{n} pages found': '{n} pages trouvées',
  'Main navigation': 'Navigation principale',
  ' ({n} to handle)': ' ({n} à traiter)',
  'My space · actions, qualifications': 'Mon espace · actions, habilitations',
  'Mobile preview · field report': 'Aperçu mobile · signalement terrain',
  'Change role (demonstration): ': 'Changer de rôle (démonstration) : ',
  'View as': 'Voir en tant que',
  'Demonstration mode · role selector': 'Mode démonstration · sélecteur de rôle',
  ' (in production, the role comes from Microsoft Entra ID)': ' (en production, le rôle vient de Microsoft Entra ID)',
  'Microsoft account: ': 'Compte Microsoft : ',
  'Sign out': 'Se déconnecter',

  // Langue et affichage empilés (src/components/Prefs.tsx, PrefsStack de norma/charte/ds/HeaderTools.tsx)
  'Dark / light display': 'Affichage',
  'Dark display': 'Affichage sombre',
  'Light display': 'Affichage clair',
  Language: 'Langue',

  // Coque commune Norma 2.1 (norma/charte/ds : AppShell, Sidebar, HeaderActions ; COQUE.md, audit du 24/11/2026 § 2)
  'Skip to main content': 'Aller au contenu',
  Menu: 'Menu',
  'Close menu': 'Fermer le menu',
  'Main menu': 'Menu principal',
  'No page matches': 'Aucune page ne correspond',
  Actions: 'Actions',
  'New report': 'Nouveau signalement',
  Close: 'Fermer',

  // Titres de page des écrans (SCREEN_TITLE_EN de src/i18n/nav.ts, traduits par PageHeader)
  'QHSE dashboard': 'Tableau de bord QHSE',
  'Single action plan': "Plan d'actions unique",
  'Regulatory watch and inspections': 'Veille réglementaire et contrôles',
};

export const FR: Record<string, string> = Object.assign({}, SHELL_FR, ...Object.values(SCREEN_DICTIONARIES));

/** Chaînes identiques en français et en anglais, relues (noms propres, sigles). */
export const SAME_IN_FRENCH: readonly string[] = ['Menu', 'Actions', ...COMMON_SAME, ...EVENTS_SAME, ...ACTIONS_SAME, ...RISKS_SAME, ...PREVENTION_SAME];

/** Chaînes définies dans deux dictionnaires avec des traductions différentes (completeness.test.ts les refuse). */
export function conflictingEntries(): string[] {
  const seen = new Map<string, string>(Object.entries(SHELL_FR));
  const out: string[] = [];
  for (const [name, dict] of Object.entries(SCREEN_DICTIONARIES)) {
    for (const [en, fr] of Object.entries(dict)) {
      if (seen.has(en) && seen.get(en) !== fr) out.push(`${name} : ${en}`);
      seen.set(en, fr);
    }
  }
  return out;
}
