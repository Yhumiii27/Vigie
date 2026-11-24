// Dictionnaire français de l'interface (VG-N01) : chaîne source anglaise → texte affiché en français. Une entrée par
// chaîne passée à t() ; completeness.test.ts refuse une chaîne sans entrée (ou dont l'entrée recopie l'anglais sans
// figurer dans SAME_IN_FRENCH). Ordre : coque (barre latérale, en-tête, navigation), puis par écran à mesure de la reprise.

export const FR: Record<string, string> = {
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
  'Skip to content': 'Aller au contenu',
  'Open the navigation menu': 'Ouvrir le menu de navigation',
  Sidebar: 'Barre latérale',
  'Close the menu': 'Fermer le menu',
  'Site: {site}': 'Site : {site}',
  'Manage sites…': 'Gérer les sites…',
  'Changing…': 'Changement en cours…',
  'Site selected: {site}.': 'Site sélectionné : {site}.',
  'Search Vigie': 'Rechercher dans Vigie',
  'Search…': 'Rechercher…',
  'Go to a page': 'Aller à une page',
  'Go to a page…': 'Aller à une page…',
  'Shortcut Command K or Control K; Enter opens the first page found.': 'Raccourci Commande K ou Contrôle K ; Entrée ouvre la première page trouvée.',
  '1 page found': '1 page trouvée',
  '{n} pages found': '{n} pages trouvées',
  'No page found': 'Aucune page trouvée',
  'Pages found': 'Pages trouvées',
  'No page matches.': 'Aucune page ne correspond.',
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

  // Affichage et langue (src/components/ThemeToggle.tsx, LangToggle.tsx)
  'Dark / light display': 'Affichage',
  'Dark display': 'Affichage sombre',
  'Light display': 'Affichage clair',
  Language: 'Langue',
};

/** Chaînes identiques en français et en anglais, relues (noms propres, sigles). */
export const SAME_IN_FRENCH: readonly string[] = [];
