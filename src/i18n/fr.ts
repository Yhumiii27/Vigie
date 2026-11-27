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
import { SKILLS_FR, SKILLS_SAME } from './screens/skills';
import { WATCH_FR, WATCH_SAME } from './screens/watch';
import { AUDITS_FR, AUDITS_SAME } from './screens/audits';
import { DOCUMENTS_FR, DOCUMENTS_SAME } from './screens/documents';
import { ENVIRONMENT_FR, ENVIRONMENT_SAME } from './screens/environment';
import { ENGINEERING_FR, ENGINEERING_SAME } from './screens/engineering';
import { PRINT_FR, PRINT_SAME } from './screens/print';
import { FIELD_FR, FIELD_SAME } from './screens/field';
import { SHARED_FR, SHARED_SAME } from './screens/shared';
import { DEADLINES_FR, DEADLINES_SAME } from './screens/deadlines';
import { COMPOSED_FR } from './screens/composed';
import { LABELS_FR, LABELS_SAME } from './labels';
// Français des composants communs « Mes tâches », « Mes approbations » et du tronc commun des menus (Norma 2.4, à reporter
// par chaque outil ; COQUE.md § 2 bis) : repris tel quel de la copie de Norma.
import { TACHES_FR } from '@norma/charte/ds/taches-fr';

/** Dictionnaires des écrans repris, dans l'ordre de la reprise (une chaîne commune à deux écrans va dans COMMON_FR). */
export const SCREEN_DICTIONARIES: Record<string, Record<string, string>> = {
  common: COMMON_FR,
  dashboard: DASHBOARD_FR,
  todo: TODO_FR,
  events: EVENTS_FR,
  actions: ACTIONS_FR,
  risks: RISKS_FR,
  prevention: PREVENTION_FR,
  skills: SKILLS_FR,
  watch: WATCH_FR,
  audits: AUDITS_FR,
  documents: DOCUMENTS_FR,
  environment: ENVIRONMENT_FR,
  engineering: ENGINEERING_FR,
  print: PRINT_FR,
  field: FIELD_FR,
  shared: SHARED_FR,
  deadlines: DEADLINES_FR,
  composed: COMPOSED_FR,
  labels: LABELS_FR,
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
  'Action plan#screen': "Plan d'actions",
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

const VIGIE_FR: Record<string, string> = Object.assign({}, SHELL_FR, ...Object.values(SCREEN_DICTIONARIES));

/**
 * Entrées de Norma (TACHES_FR) : leur traduction l'emporte, pour que le tronc commun des menus, « Mes tâches » et « Mes
 * approbations » se lisent comme dans les autres outils (COQUE.md § 2 bis). Un écran de Vigie qui garde son propre mot
 * pour une même chaîne anglaise passe par un contexte (`'Open#plural'` « Ouverts », `'All#mplural'` « Tous »,
 * `'Source#origin'`, `'Today#button'`, `'All types#filter'`, `'Action plan#screen'`) ; `normaOverrides` (test) refuse
 * une clé de Norma traduite autrement par un dictionnaire de Vigie.
 */
export const FR: Record<string, string> = { ...VIGIE_FR, ...TACHES_FR };

/** Clés de Norma traduites autrement par un dictionnaire de Vigie (completeness.test.ts exige une liste vide). */
export function normaOverrides(): string[] {
  return Object.entries(TACHES_FR).filter(([en, fr]) => en in VIGIE_FR && VIGIE_FR[en] !== fr).map(([en, fr]) => `${en} : ${VIGIE_FR[en]} ≠ ${fr}`);
}

/** Chaînes identiques en français et en anglais, relues (noms propres, sigles). */
export const SAME_IN_FRENCH: readonly string[] = ['Menu', 'Actions', ...Object.keys(TACHES_FR).filter((en) => TACHES_FR[en] === en), ...COMMON_SAME, ...EVENTS_SAME, ...ACTIONS_SAME, ...RISKS_SAME, ...PREVENTION_SAME, ...SKILLS_SAME, ...WATCH_SAME, ...AUDITS_SAME, ...DOCUMENTS_SAME, ...ENVIRONMENT_SAME, ...ENGINEERING_SAME, ...PRINT_SAME, ...FIELD_SAME, ...SHARED_SAME, ...DEADLINES_SAME, ...LABELS_SAME];

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
