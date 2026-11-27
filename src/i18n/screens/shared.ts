// Composants communs à tous les écrans (cloche, filtres, pagination, aide, galerie, amorçage, « Gérer les sites » et
// connecteurs) et libellés composés de src/lib qui leur sont propres (VG-N01). Le français reprend mot pour mot le texte
// d'avant la traduction.

export const SHARED_FR: Record<string, string> = {
  // Cloche des notifications (NotificationBell)
  Notifications: 'Notifications',
  unread: 'non lue',
  'unread#plural': 'non lues',
  '{n} unread notification · deadlines within {days} days and information': '{n} non lue · échéances à {days} jours et informations',
  '{n} unread notifications · deadlines within {days} days and information': '{n} non lues · échéances à {days} jours et informations',
  'Nothing to report.': 'Rien à signaler.',
  'All deadlines →': 'Toutes les échéances →',

  // Rattacher une action existante (LinkActionButton)
  'Detach {ref}?': 'Détacher {ref} ?',
  'Detaching…': 'Détachement…',
  'Detach {ref} (the action stays in the plan)': "Détacher {ref} (l'action reste dans le plan)",
  Detach: 'Détacher',
  'No open action to link#plan': 'Aucune action en cours à rattacher',
  'Open actions of the action plan (neither verified nor abandoned).': "Actions en cours du plan d'actions (ni vérifiées, ni abandonnées).",
  'Link#verb': 'Rattacher',

  // Événements liés (LinkedEvents)
  'No linked event. Linking is done from the event sheet.': 'Aucun événement rattaché. Le rattachement se fait depuis la fiche de l’événement.',

  // Bandeau d'un lien profond (MissingNotice), liste puis fiche, galerie de photos
  'Element not found or outside the selected site.': 'Élément introuvable ou hors du site sélectionné.',
  'Back to the list': 'Retour à la liste',
  'Previous#f': 'Précédente',
  'Next#f': 'Suivante',
  'Open the original': "Ouvrir l'original",
  'Photo {n} of {total}': 'Photo {n} sur {total}',

  // Filtres et pagination (FilterBar, Pagination)
  '{label}: {value}': '{label} : {value}',
  'Filter#verb': 'Filtrer',
  ': remove this filter': ' : retirer ce filtre',
  '{from}–{to} of {total}': '{from}–{to} sur {total}',
  'Page {n} of {pages}': 'Page {n} sur {pages}',
  'Per page': 'Par page',

  // Aide en ligne (HelpDialog)
  'Help and glossary': 'Aide et glossaire',
  Help: 'Aide',
  'Online help': 'Aide en ligne',
  'This screen': 'Cet écran',
  'Choose a screen in the sidebar; this window then shows its help.': 'Choisissez un écran dans la barre latérale ; cette fenêtre présente alors son aide.',
  Glossary: 'Glossaire',
  'Search the glossary': 'Rechercher dans le glossaire',
  'No term matches.': 'Aucun terme ne correspond.',
  'A question about your rights or missing data: ask the QHSE coordinator of your site.': "Une question sur vos droits ou une donnée manquante : adressez-vous à l'animateur QHSE de votre site.",

  // Première mise en service (Bootstrap)
  'First commissioning': 'Première mise en service',
  'Follow the first site': 'Suivre le premier site',
  'Vigie is not configured yet': 'Vigie n’est pas encore configuré',
  'No site is followed yet. Every report, action, check or work unit belongs to a site: choose the first one in the site register of Matrix to begin. The next ones are added from “Manage sites…”, in the site selector.':
    'Aucun site n’est encore suivi. Chaque signalement, action, contrôle ou unité de travail est rattaché à un site : choisissez le premier dans le référentiel des sites de Matrix pour commencer. Les suivants s’ajoutent ensuite depuis « Gérer les sites… », dans le sélecteur de site.',
  'Signed in as {name} ({role}). No site is recorded yet: a QHSE coordinator or management must create the first site before Vigie can be used.':
    'Connecté en tant que {name} ({role}). Aucun site n’est encore enregistré : un animateur QHSE ou la direction doit créer le premier site avant que Vigie soit utilisable.',
  'Follow the site': 'Suivre le site',

  // Gérer les sites (SitesManager)
  Administration: 'Administration',
  'Matrix site': 'Site de Matrix',
  'Common site register (Matrix): label and order come from Matrix; the site identifier is its code.': 'Référentiel commun des sites (Matrix) : libellé et ordre viennent de Matrix ; l’identifiant du site est son code.',
  'Choose a site': 'Choisir un site',
  'All the sites of Matrix are already followed': 'Tous les sites de Matrix sont déjà suivis',
  'QHSE manager': 'Responsable QHSE',
  'Receives the alerts of the site; vacant: alerts to the QHSE coordinators.': 'Destinataire des alertes du site ; vacant : alertes aux animateurs QHSE.',
  'To be appointed': 'À désigner',
  Sites: 'Sites',
  Connectors: 'Connecteurs',
  'Edit “{label}”': 'Modifier « {label} »',
  'Follow a Matrix site': 'Suivre un site de Matrix',
  'Stop following “{label}”': 'Ne plus suivre « {label} »',
  'Seveso {level}': 'Seveso {level}',
  'Local law of Alsace-Moselle': "Droit local d'Alsace-Moselle",
  'QHSE manager to be appointed': 'Responsable QHSE à désigner',
  'At least one site must stay active.': 'Au moins un site doit rester actif.',
  'Stop following': 'Ne plus suivre',
  'Archived#mplural': 'Archivés',
  'archived on {date}#m': 'archivé le {date}',
  ' by {name}': ' par {name}',
  'Labels and order: site register of Matrix. The Seveso classification and the “prevention plan from the first minute” rule are set on the Prevention screen.':
    "Libellés et ordre : référentiel des sites de Matrix. Le classement Seveso et la règle « plan de prévention dès la première minute » se règlent sur l'écran Prévention.",
  'Follow a site': 'Suivre un site',
  'Label (Matrix)': 'Libellé (Matrix)',
  'Read in the site register of Matrix.': 'Lu dans le référentiel des sites de Matrix.',
  'Code (Matrix)': 'Code (Matrix)',
  Calendar: 'Calendrier',
  'Deadline to declare an occupational accident: Good Friday and 26 December are also public holidays there.':
    "Délai de déclaration d'un accident du travail : le Vendredi saint et le 26 décembre y sont aussi fériés.",
  'Local law of Alsace-Moselle (Bas-Rhin, Haut-Rhin, Moselle)': "Droit local d'Alsace-Moselle (Bas-Rhin, Haut-Rhin, Moselle)",
  'This site still holds {items}. Transfer them to another site, or archive without transfer (they stay attached to the archived site).':
    'Ce site porte encore {items}. Transférez-les vers un autre site, ou archivez sans transfert (ils restent rattachés au site archivé).',
  'Transfer the open items to': 'Transférer les éléments ouverts vers',
  'Optional · each transferred item is logged with the reason. Select “All sites” to transfer.':
    'Facultatif · chaque élément transféré est journalisé avec le motif. Sélectionnez « Tous les sites » pour transférer.',
  'Do not transfer': 'Ne pas transférer',
  'The site is archived in Vigie: it disappears from the selectors; its data can still be read under “All sites”. Nothing is changed in Matrix.':
    'Le site est archivé dans Vigie : il disparaît des sélecteurs ; ses données restent consultables sous « Tous les sites ». Rien n’est changé dans Matrix.',
  'Site closed, sold, outside the QHSE scope…': 'Site fermé, cédé, hors du périmètre QHSE…',
  Reactivate: 'Réactiver',
  'Reactivate the site': 'Réactiver le site',
  'Manage sites': 'Gérer les sites',
  'The site is back in the selectors and the forms.': 'Le site revient dans les sélecteurs et les formulaires.',
  'E.g. activity resumed on the site': "Ex. reprise d'activité sur le site",
  '{n} open event#site': '{n} événement non clôturé',
  '{n} open events#site': '{n} événements non clôturés',
  '{n} open QSE action': '{n} action QSE ouverte',
  '{n} open QSE actions': '{n} actions QSE ouvertes',
  '{n} periodic check in force': '{n} contrôle périodique en vigueur',
  '{n} periodic checks in force': '{n} contrôles périodiques en vigueur',
  '{n} prevention plan in progress': '{n} plan de prévention en cours',
  '{n} prevention plans in progress': '{n} plans de prévention en cours',
  '{n} permit requested or delivered': '{n} permis demandé ou délivré',
  '{n} permits requested or delivered': '{n} permis demandés ou délivrés',

  // Motifs du plan de prévention écrit (src/lib/rules/prevention.ts, src/lib/data/prevention.ts)
  '{basis}: written and signed plan from the first minute of the work': "{basis} : plan écrit et signé dès la première minute d'intervention",
  '{hours} h over 12 months': '{hours} h sur 12 mois',
  '{hours} and {dangerous}': '{hours} et {dangerous}',
  '{rule} · from the first minute': '{rule} · dès la première minute',
  'any work': 'toute intervention',

  // Coactivité (src/lib/rules/coactivity.ts : motifs et mesures composés, affichage seulement)
  'Same zone': 'Même zone',
  'Proximity ({m} m)': 'Proximité ({m} m)',
  'Proximity (adjacent zones)': 'Proximité (zones contiguës)',
  'Shared access route': "Voie d'accès commune",
  'Crossing of a work area': 'Traversée de zone de travail',
  'Update of the prevention plans concerned ({ids})': 'Mise à jour des plans de prévention concernés ({ids})',
  '{basis}: written and signed plan from the first minute': '{basis} : plan écrit et signé dès la première minute',
  'mandatory plan, R. 4512-7': 'plan obligatoire, R. 4512-7',
  'Plans {ids} to have signed by both companies before any work ({why})': 'Plans {ids} à faire signer par les deux entreprises avant toute intervention ({why})',
  'Plan {ids} to have signed by both companies before any work ({why})': 'Plan {ids} à faire signer par les deux entreprises avant toute intervention ({why})',
  'Written and signed prevention plan to draw up before any work ({teams}): {basis}, from the first minute': 'Plan de prévention écrit et signé à établir avant toute intervention ({teams}) : {basis}, dès la première minute',
  'Prevention plan to draw up with {teams}': 'Plan de prévention à établir avec {teams}',

  // Aperçu mobile de démonstration (/apercu-mobile)
  'Mobile preview · 390 × 844': 'Aperçu mobile · 390 × 844',
  'On a phone': 'Sur téléphone',
  'Open the field form': 'Ouvrir le formulaire terrain',
  'My reports →': 'Mes signalements →',
  'Report not found or not yours.': "Signalement introuvable ou qui n'est pas le vôtre.",
  'Field journey': 'Parcours terrain',
  'Report in less than a minute': "Signaler en moins d'une minute",
  'The QR code of the post opens this form with the location and the site filled in. The report creates the event at the stage “Reported” in Vigie, visible in the list of reports and on the dashboard; the QHSE coordinator qualifies it within 48 h.':
    "Le QR code du poste ouvre ce formulaire avec le lieu et le site pré-remplis. Le signalement crée l'événement à l'étape « Déclaré » dans Vigie, visible dans la liste des signalements et sur le tableau de bord ; l'animateur QHSE le qualifie sous 48 h.",
  'Up to {n} photos taken on the spot go with the report and appear on the event sheet. The phone reduces them before sending, which also removes their metadata (position, device) when it can convert them; a photo it cannot reduce is not attached to an anonymous report.':
    "Jusqu'à {n} photos prises sur le moment accompagnent le signalement et apparaissent sur la fiche de l'événement. Le téléphone les allège avant l'envoi, ce qui retire aussi leurs métadonnées (position, appareil) quand il sait les convertir ; une photo qu'il ne peut pas alléger n'est pas jointe à un signalement anonyme.",
  'The anonymous mode hides the reporter from every role, QHSE coordinator included; an anonymous report therefore does not appear in “My reports”. Named reports are followed there across all sites, with the follow-up given.':
    "Le mode anonyme masque le déclarant pour tous les rôles, animateur QHSE compris ; un signalement anonyme n'apparaît donc pas dans « Mes signalements ». Les signalements nominatifs y sont suivis tous sites confondus, avec la suite donnée.",
  'Open the field form (target of the QR code · {post}) →': 'Ouvrir le formulaire terrain (cible du QR code · {post}) →',
  'Open the field form (target of the QR code) →': 'Ouvrir le formulaire terrain (cible du QR code) →',
  'Open “My reports” on mobile →': 'Ouvrir « Mes signalements » sur mobile →',
  'Display at the post': 'Affichage au poste',
  'QR codes of the posts': 'QR codes des postes',
  'One QR code per zone of the site plan: scanned at the post, it opens the form with the location and the site of the post.':
    'Un QR code par zone du plan de site : scanné au poste, il ouvre le formulaire avec le lieu et le site du poste.',
  'One QR code per zone of the site plan ({site}): scanned at the post, it opens the form with the location and the site of the post.':
    'Un QR code par zone du plan de site ({site}) : scanné au poste, il ouvre le formulaire avec le lieu et le site du poste.',
  'No zone drawn on the site plan.': 'Aucune zone dessinée sur le plan de site.',
  'QR code of the post {post}': 'QR code du poste {post}',
  'Print the sheet →': 'Imprimer la planche →',

  // Connecteurs, boîte de réception, file d'envoi (SitesManager)
  'Vigie reads the common registers in the views published by the other tools (read only). Sites and assignments are cached and read again every night; projects and suppliers are read at each entry.':
    'Vigie lit les référentiels communs dans les vues publiées par les autres outils (lecture seule). Les sites et les affectations sont gardés en cache et relus chaque nuit ; les projets et les fournisseurs sont lus à chaque saisie.',
  cache: 'cache',
  'Never read': 'Jamais lu',
  'Last run on {at} · {n} row(s) read': 'Dernier passage le {at} · {n} ligne(s) lue(s)',
  ' · {added} added, {updated} updated, {removed} removed': ' · {added} ajoutée(s), {updated} mise(s) à jour, {removed} retirée(s)',
  ' · last successful read: {at}': ' · dernière lecture réussie : {at}',
  never: 'jamais',
  Refresh: 'Actualiser',
  'Inbox (Keystone, Codex)': 'Boîte de réception (Keystone, Codex)',
  'Keystone reports the progress of its project NCs and of its engineering change orders (vigie.pub_signaler_avancement_nc, vigie.pub_signaler_avancement_eco), Codex creates its change requests (vigie.pub_creer_demande_modification); Vigie processes each request with its own rules, every 10 minutes.':
    'Keystone signale l’avancement de ses NC de projet et de ses ordres de modification (vigie.pub_signaler_avancement_nc, vigie.pub_signaler_avancement_eco), Codex crée ses demandes de modification (vigie.pub_creer_demande_modification) ; Vigie traite chaque demande avec ses propres règles, toutes les 10 minutes.',
  ' Last request received on {at}.': ' Dernière demande reçue le {at}.',
  ' No request received.': ' Aucune demande reçue.',
  '{label}: {n}': '{label} : {n}',
  'Refusals to take into account': 'Refus à prendre en compte',
  'Process now': 'Traiter maintenant',
  'Message no. {id} · {n} attempt(s)': 'Message n° {id} · {n} tentative(s)',
  ' · next attempt {at}': ' · prochain essai {at}',
  'Outbox (Codex)': 'File d’envoi (Codex)',
  'The decisions on the change requests of Codex are sent to it by its webhook (POST /api/integrations/vigie), every 10 minutes, with spaced retries. Without VIGIE_CODEX_URL and the token or secret of the webhook, they stay to send.':
    'Les décisions sur les demandes de modification de Codex lui sont envoyées par son webhook (POST /api/integrations/vigie), toutes les 10 minutes, avec reprises espacées. Sans VIGIE_CODEX_URL et jeton ou secret du webhook, elles restent à envoyer.',
  ' Last sending on {at}.': ' Dernier envoi le {at}.',
  ' Nothing sent.': ' Aucun envoi.',
  'Messages to retry or refused': 'Messages à reprendre ou refusés',
  'Send now': 'Envoyer maintenant',
};

/** Entrées identiques en français, relues (SAME_IN_FRENCH). */
export const SHARED_SAME: string[] = ['Notifications', 'Sites', 'Seveso {level}', 'Code (Matrix)', 'cache', 'Administration'];
