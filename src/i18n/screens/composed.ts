// Libellés composés par src/lib (src/i18n/msg.ts, VG-N01) : chaînes sources anglaises → français. Le français est aussi le
// libellé que gardent les règles et le serveur (`msgFr`) : il reprend mot pour mot le texte d'avant la traduction.
export const COMPOSED_FR: Record<string, string> = {
  // Échéance d'une déclaration (deadlineMsg, src/lib/rules/event-deadlines.ts)
  'before the end of {date}': 'avant la fin du {date}',
  'before {date} at {hh}:{mm}': 'avant le {date} à {hh} h {mm}',

  // Déclaration d'un accident du travail (cpamState, src/lib/data/events.ts)
  'Not declared by the company': "Non déclarée par l'entreprise",
  'Declaration by the temporary work agency': "Déclaration par l'entreprise de travail temporaire",
  "Declaration by the victim's employer": "Déclaration par l'employeur de la victime",
  'Not required · entered in the register of minor accidents (no. {n})': 'Non requise · inscrit au registre des accidents bénins (n° {n})',
  'Reasoned reservations sent on {date}': 'Réserves motivées adressées le {date}',
  'Reasoned reservations possible until {date} (10 clear days)': "Réserves motivées possibles jusqu'au {date} (10 jours francs)",
  'Reservation period passed on {date}': 'Délai de réserves dépassé le {date}',
  'Declared on {date}': 'Déclarée le {date}',
  "Declared by the victim's employer: to state (reason) before closure": "Déclarée par l'employeur de la victime : à indiquer (motif) avant la clôture",
  'Temporary work agency to inform {deadline} (copy to CARSAT and labour inspectorate): it declares the accident':
    "ETT à informer {deadline} (copie CARSAT et inspection du travail) : elle déclare l'accident",
  'Minor accident: to enter in the register or to declare {deadline}': 'Accident bénin : à inscrire au registre ou à déclarer {deadline}',
  'To declare {deadline}': 'À déclarer {deadline}',

  // Questionnaire employeur d'une maladie professionnelle (mpQuestionnaireState, src/lib/data/events.ts)
  'Returned on {date}': 'Retourné le {date}',
  'Not received': 'Non reçu',
  'Received on {date} · to return by {due} at the latest': 'Reçu le {date} · à retourner au plus tard le {due}',
};
