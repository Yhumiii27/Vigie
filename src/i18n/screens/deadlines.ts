// Intitulés des échéances (TodoItem.titleText, src/i18n/msg.ts `titled`) et indicateurs composés par src/lib (VG-N01). Le
// français est aussi `title` (clé d'état lu todoKey, règles, essais) : il reprend mot pour mot le texte d'avant la
// traduction (test/integration/todo-equivalence.test.ts le fige).

export const DEADLINES_FR: Record<string, string> = {
  // Plans de prévention et permis (src/lib/data/prevention-signals.ts)
  '{id} · work in progress without a signed plan — {title}': '{id} · intervention en cours sans plan signé — {title}',
  '{id} · period ended, plan to close — {title}': '{id} · période échue, plan à clore — {title}',
  '{id} · periodic coordination inspection or meeting overdue since {date} — {title}': '{id} · inspection ou réunion périodique de coordination en retard depuis le {date} — {title}',
  '{id} · periodic coordination inspection or meeting before {date} — {title}': '{id} · inspection ou réunion périodique de coordination avant le {date} — {title}',
  '{id} · plan to sign before the start — {title}': '{id} · plan à signer avant le démarrage — {title}',
  '{id} · joint inspection planned on {date} — {title}': '{id} · inspection commune prévue le {date} — {title}',
  '{id} · {n} workers without an up-to-date safety induction — {title}': '{id} · {n} intervenants sans accueil sécurité à jour — {title}',
  '{id} · {n} worker without an up-to-date safety induction — {title}': '{id} · {n} intervenant sans accueil sécurité à jour — {title}',
  'test permit#lower': "permis d'essai",
  'hot work permit#lower': 'permis de feu',
  'request for a {type}': 'demande de {type}',
  '{id} · {what} of an external company without a signed prevention plan — {location}': "{id} · {what} d'une entreprise extérieure sans plan de prévention signé — {location}",
  '{id} · request for a {type} ended, never delivered — {location}': '{id} · demande de {type} échue, jamais délivrée — {location}',
  '{id} · {type} expired not closed — {location}': '{id} · {type} expiré non clos — {location}',
  '{id} · {type} to deliver (validity {validity}) — {location}': '{id} · {type} à délivrer (validité {validity}) — {location}',
  '{id} · lockout not verified, permit {permit} within its validity — {equipment}': '{id} · consignation non vérifiée, permis {permit} en cours de validité — {equipment}',
  '{id} · lockout not lifted at the end of the permit {permit} — {equipment}': '{id} · consignation non levée à la fin du permis {permit} — {equipment}',
  // Indicateur R. 4512-6 de la veille (loadPreventionCompliance)
  '{n} past gaps over 12 months': '{n} écarts passés sur 12 mois',
  '{n} past gap over 12 months': '{n} écart passé sur 12 mois',
  '{n} works without a signed plan': '{n} interventions sans plan signé',
  '{n} work without a signed plan': '{n} intervention sans plan signé',
  '{current} · {past}': '{current} · {past}',
  '{current}': '{current}',
  'No work in progress without a signed plan · {past}': 'Aucune intervention en cours sans plan signé · {past}',
  'No R. 4512-6 gap over 12 months': 'Aucun écart R. 4512-6 sur 12 mois',

  // Registre des déchets (src/lib/data/environment.ts : échéances et indicateurs de la veille)
  'Waste register {year} · {n} missing tracking forms · {site}': 'Registre des déchets {year} · {n} BSD manquants · {site}',
  'Waste register {year} · {n} missing tracking form · {site}': 'Registre des déchets {year} · {n} BSD manquant · {site}',
  'Waste register {year} · {n} tracking forms not finalised more than {days} d after the removal · {site}':
    "Registre des déchets {year} · {n} BSD non finalisés plus de {days} j après l'enlèvement · {site}",
  'Waste register {year} · {n} tracking form not finalised more than {days} d after the removal · {site}':
    "Registre des déchets {year} · {n} BSD non finalisé plus de {days} j après l'enlèvement · {site}",
  'Waste register {year} · {n} removals with incomplete entries · {site}': 'Registre des déchets {year} · {n} enlèvements aux mentions incomplètes · {site}',
  'Waste register {year} · {n} removal with incomplete entries · {site}': 'Registre des déchets {year} · {n} enlèvement aux mentions incomplètes · {site}',
  '{n} hazardous waste removal without a tracking form': '{n} enlèvement de déchets dangereux sans BSD',
  '{n} hazardous waste removals without a tracking form': '{n} enlèvements de déchets dangereux sans BSD',
  'No missing tracking form · {n} form not finalised after {days} d': 'Aucun BSD manquant · {n} bordereau non finalisé après {days} j',
  'No missing tracking form · {n} forms not finalised after {days} d': 'Aucun BSD manquant · {n} bordereaux non finalisés après {days} j',
  'No missing tracking form · {n} hazardous waste removal in {year}': 'Aucun BSD manquant · {n} enlèvement de déchets dangereux en {year}',
  'No missing tracking form · {n} hazardous waste removals in {year}': 'Aucun BSD manquant · {n} enlèvements de déchets dangereux en {year}',
  '{n} removal with incomplete entries (order of 31 May 2021)': '{n} enlèvement aux mentions incomplètes (arrêté du 31 mai 2021)',
  '{n} removals with incomplete entries (order of 31 May 2021)': '{n} enlèvements aux mentions incomplètes (arrêté du 31 mai 2021)',
  'Register kept · {n} removal entered in {year}, complete entries': 'Registre tenu · {n} enlèvement inscrit en {year}, mentions complètes',
  'Register kept · {n} removals entered in {year}, complete entries': 'Registre tenu · {n} enlèvements inscrits en {year}, mentions complètes',

  // DUERP et programme annuel (src/lib/data/risks.ts)
  '{unit} · {n} risk ≥ {threshold} without a reduction action': '{unit} · {n} risque ≥ {threshold} sans action de réduction',
  '{unit} · {n} risks ≥ {threshold} without a reduction action': '{unit} · {n} risques ≥ {threshold} sans action de réduction',
  '{unit} · {n} risk with a residual still ≥ {threshold}': '{unit} · {n} risque au résiduel encore ≥ {threshold}',
  '{unit} · {n} risks with a residual still ≥ {threshold}': '{unit} · {n} risques au résiduel encore ≥ {threshold}',
  '{unit} · {hazard} — residual to re-rate (actions verified)': '{unit} · {hazard} — résiduel à recoter (actions vérifiées)',
  'Annual update of the DUERP overdue since {date}': 'Mise à jour annuelle du DUERP dépassée depuis le {date}',
  'Annual update of the DUERP (version {version})': 'Mise à jour annuelle du DUERP (version {version})',
  'Consultation of the CSE to fill in · DUERP {version}': 'Consultation du CSE à renseigner · DUERP {version}',
  'Sending to the occupational health service to fill in · DUERP {version}': 'Transmission au SPST à renseigner · DUERP {version}',
  '{programme} {year}: consultation of the CSE to fill in': '{programme} {year} : consultation du CSE à renseigner',
  '{programme} {year} to draw up': '{programme} {year} à établir',
  'Request for access to the DUERP to handle · {requester}': "Demande d'accès au DUERP à traiter · {requester}",
  'Reassess the DUERP after the event {id} of {date}': "Réévaluer le DUERP après l'événement {id} du {date}",

  // Plan d'actions (src/lib/data/actions.ts)
  '{id} · {label} — due date passed since {date}': '{id} · {label} — échéance dépassée depuis le {date}',
  '{id} · {label} — effectiveness check': "{id} · {label} — vérification d'efficacité",
  '{id} · {label} — effectiveness check overdue since {date}': "{id} · {label} — vérification d'efficacité dépassée depuis le {date}",
  'Action plan · {n} actions to complete (mandatory fields missing)': "Plan d'actions · {n} actions à compléter (champs obligatoires manquants)",
  'Action plan · {n} action to complete (mandatory fields missing)': "Plan d'actions · {n} action à compléter (champs obligatoires manquants)",
  '{event} · follow-up action {id} — decide on a reopening': "{event} · action de suite {id} — décider d'une réouverture",

  // Personnel lu dans Cursus (src/lib/data/people.ts)
  'People of Cursus unavailable: staff records not updated': 'Personnes de Cursus indisponibles : fiches du personnel non mises à jour',
  '{name} — record without a Cursus number: to link': '{name} — fiche sans matricule Cursus : à rattacher',
  '{name} — missing from Cursus: check with the HR department': '{name} — absent(e) de Cursus : vérifier auprès du service RH',

  // Habilitations (src/lib/data/skills.ts)
  'Titles held from Cursus unavailable: authorisation alerts and deadlines not computed': 'Titres détenus de Cursus indisponibles : alertes et échéances d’habilitation non calculées',
  ' · action {id} ({status})': ' · action {id} ({status})',
  ' · action {id}': ' · action {id}',
  '{assignment}{action}': '{assignment}{action}',
  ', assigned to {project} {period}': ', affecté à {project} {period}',
  '{name} expired since {date}{suffix}': '{name} expiré depuis le {date}{suffix}',
  '{name} never taken{suffix}': '{name} jamais suivi{suffix}',
  ' since {date}': ' depuis le {date}',
  'withdrawn{since}': 'retiré{since}',
  'suspended{since}': 'suspendu{since}',
  'suspended, prerequisite missing': 'suspendu, prérequis manquant',
  '{name} {why} (Cursus){suffix}': '{name} {why} (Cursus){suffix}',
  '{name} expires on {date}{suffix}': '{name} expire le {date}{suffix}',
  '{name} expires on {date}, before the end of the assignment {project}{action}': "{name} expire le {date}, avant la fin de l'affectation {project}{action}",

  // Revue de direction (src/lib/data/review.ts)
  '{label} — expected on {date} · review of {day}': '{label} — attendu le {date} · revue du {day}',
  '{label} · review of {day}': '{label} · revue du {day}',
  'Management review of {day} — minutes to enter': 'Revue de direction du {day} — compte rendu à saisir',
  'Management review of {day} — approval of management and file to close': 'Revue de direction du {day} — visa de la direction et dossier à clôturer',
  '{label} of the review of {day} without follow-up — {state} (due date {due}) · {text}': '{label} de la revue du {day} sans suite — {state} (échéance {due}) · {text}',
  'no action in the plan': 'aucune action au plan',
  'action {id} not closed': 'action {id} non close',
  'Next management review to plan (last review on {date})': 'Prochaine revue de direction à planifier (dernière revue le {date})',

  // Modifications techniques (src/lib/data/engineering.ts)
  '{id} · request from {source} to decide: {title}': '{id} · demande de {source} à décider : {title}',
  '{id} · approval “{key}” expected ({approver}): {title}': '{id} · approbation « {key} » attendue ({approver}) : {title}',
  '{id} · approved: {n} effectivity disposition(s) to decide before the release': '{id} · approuvé : {n} disposition(s) d’effectivité à décider avant la libération',
  '{id} · {disposition} to carry out: {target} {label}': '{id} · {disposition} à réaliser : {target} {label}',

  // Programme d'audit, constats et certifications (src/lib/data/audits.ts)
  'planned on {date}': 'prévu le {date}',
  'planned in {month} {year}': 'prévu en {month} {year}',
  '{label} — {when}, to confirm': '{label} — {when}, à confirmer',
  '{label} — planned in {month} {year}, date to set': '{label} — prévu en {month} {year}, date à fixer',
  '{kind} without action — {text}': '{kind} sans action — {text}',
  '{label} · answer expected on {date}': '{label} · réponse attendue le {date}',
  '{label} · answer expected since {date}': '{label} · réponse attendue depuis le {date}',
  '{label}': '{label}',
  'Certificate {standard} suspended since {date}': 'Certificat {standard} suspendu depuis le {date}',
  'Certificate {standard} expired': 'Certificat {standard} expiré',
  'Certificate {standard} · end of validity on {date}': 'Certificat {standard} · fin de validité le {date}',
  '{standard} · renewal audit to schedule before {date}': '{standard} · audit de renouvellement à programmer avant le {date}',
  '{standard} · surveillance audit to schedule': '{standard} · audit de suivi à programmer',

  // Demandes reçues de Keystone et de Codex (src/lib/data/inbound.ts)
  '{ref} · request no. {id} from {tool} refused: {result} — take note of it': '{ref} · demande n° {id} de {tool} refusée : {result} — prenez-en connaissance',
  '{ref} · request no. {id} from {tool} not processed for more than a day: check the task “Requests received” (Connectors)':
    "{ref} · demande n° {id} de {tool} non traitée depuis plus d'un jour : vérifiez la tâche « Demandes reçues » (Connecteurs)",
  '{id} · {tool} proposes to close the NC: decision of the QHSE (“{step}” or step back)': '{id} · {tool} propose la clôture de la NC : décision du QHSE (« {step} » ou retour arrière)',
  '{id} · {tool} proposes to return to the corrective actions: decision of the QHSE (“{step}” or step back)': '{id} · {tool} propose le retour aux actions correctives : décision du QHSE (« {step} » ou retour arrière)',

  // Documents de Codex (src/lib/data/documents.ts)
  'Documents of Codex unavailable: reviews and approval workflows not followed': 'Documents de Codex indisponibles : revues et circuits de validation non suivis',
  '{id} · {title} — review overdue since {date}': '{id} · {title} — revue dépassée depuis le {date}',
  '{id} · periodic review “{title}”': '{id} · revue périodique « {title} »',
  ' · revision {rev} in approval': ' · révision {rev} en validation',
  ' · revision {rev} being drafted': ' · révision {rev} en rédaction',
  ' · action {id} in progress': ' · action {id} en cours',
  '{head}{progress}': '{head}{progress}',
  '{id} · revision {rev} to approve in Codex{step}': '{id} · révision {rev} à valider dans Codex{step}',

  // Sites, changements, postes, études, urgences, dangers graves et imminents
  '{site} — QHSE manager to appoint (Manage sites…)': '{site} — responsable QHSE à désigner (Gérer les sites…)',
  '{site} — {state}: stop following? (Manage sites…)': '{site} — {state} : ne plus suivre ? (Gérer les sites…)',
  '{id} · {title} — change request to assess': '{id} · {title} — demande de changement à évaluer',
  '{id} · {title} — implementation planned on {date}, to record': '{id} · {title} — mise en œuvre prévue le {date}, à constater',
  '{id} · {title} — implementation planned on {date}': '{id} · {title} — mise en œuvre prévue le {date}',
  '{zone} ({site}) — ceiling of reports without an account reached: regenerate the QR code if it circulates outside the site':
    "{zone} ({site}) — plafond de signalements sans compte atteint : régénérer le QR code s'il circule hors du site",
  '{id} · {type} {code} — session of {date} passed: record the study held or reschedule it': "{id} · {type} {code} — séance du {date} passée : enregistrez l'étude tenue ou replanifiez-la",
  '{label} — drill overdue since {date}': '{label} — exercice en retard depuis le {date}',
  '{label} — drill planned on {date}': '{label} — exercice planifié le {date}',
  '{label} — drill to organise before {date}': '{label} — exercice à organiser avant le {date}',
  'Serious and imminent danger no. {n} of {date} — measures of the employer to record': "Danger grave et imminent n° {n} du {date} — mesures de l'employeur à consigner",

  // Veille et contrôles (src/lib/data/watch.ts)
  'action {id} abandoned': 'action {id} abandonnée',
  'action {id} verified': 'action {id} vérifiée',
  'unfavourable#lower': 'défavorable',
  'shutdown#lower': "mise à l'arrêt",
  'out of tolerance#lower': 'hors tolérance',
  'No version of the DUERP in force': 'Aucune version du DUERP en vigueur',
  'DUERP {version} · annual update overdue since {date}': 'DUERP {version} · mise à jour annuelle dépassée depuis le {date}',
  'DUERP {version} in force · update before {date}': 'DUERP {version} en vigueur · mise à jour avant le {date}',
  '{title} — overdue since {date}': '{title} — dépassé depuis le {date}',
  '{title} — {result} on {date}: new favourable check expected': '{title} — {result} le {date} : nouveau contrôle favorable attendu',
  '{title} — reservations “{reserves}” without a lifting action': '{title} — réserves « {reserves} » sans action de levée',
  '{title} — {loop}: reservations “{reserves}” to lift': '{title} — {loop} : réserves « {reserves} » à lever',
  '{text} — gap analysis without action': "{text} — analyse d'écart sans action",
  '{text} — gap without action': '{text} — écart sans action',
  '{text} — {loop}: gap analysis to reassess': "{text} — {loop} : analyse d'écart à réévaluer",
  '{text} — {loop}: gap to reassess': '{text} — {loop} : écart à réévaluer',
  '{text} — compliance to assess': '{text} — conformité à évaluer',
  '{text} — application date passed since {date}': "{text} — date d'application dépassée depuis le {date}",
  '{text} — applicable on {date}': '{text} — applicable le {date}',
  '{text} — {review}': '{text} — {review}',
  '{text} — {review} overdue since {date}': '{text} — {review} en retard depuis le {date}',
  'annual reassessment': 'réévaluation annuelle',
  'reassessment (every {months} months)': 'réévaluation (tous les {months} mois)',
  '{label} ({authority}) of {date}': '{label} ({authority}) du {date}',
  '{what} — answer overdue since {date}': '{what} — réponse en retard depuis le {date}',
  '{what} — answer expected before {date}': '{what} — réponse attendue avant le {date}',
  '{what} — answer to give': '{what} — réponse à apporter',
};

/** Entrées identiques en français, relues (SAME_IN_FRENCH). */
export const DEADLINES_SAME: string[] = ['{current} · {past}', '{current}', '{text} — {review}', ' · action {id} ({status})', ' · action {id}', '{assignment}{action}', '{name} {why} (Cursus){suffix}', '{label}', '{head}{progress}'];
