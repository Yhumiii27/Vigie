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
};

/** Chaînes identiques en français et en anglais, relues (noms propres, sigles). */
export const SAME_IN_FRENCH: readonly string[] = ['Menu', 'Actions'];
