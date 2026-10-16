// Clés stockées des listes du plan d'actions (docs/specs/actions-qse.md § 5 et § 12) : module pur, sans import.
// Importé par src/db/schema.ts (contraintes CHECK de la migration 0005) et réexporté par src/lib/domain.ts, qui y
// ajoute les libellés. Changer une liste demande une nouvelle migration (les CHECK de la base en dépendent).

export const ACTION_AVANCEMENTS = ['a_faire', 'initiee', 'p20', 'p40', 'p60', 'p80', 'reportee', 'terminee', 'verifiee', 'abandonnee'] as const;
export type Avancement = (typeof ACTION_AVANCEMENTS)[number];
/** Groupe « ouverte » (À faire → 80 %) : seules valeurs qui peuvent être en retard. */
export const OPEN_AVANCEMENTS = ['a_faire', 'initiee', 'p20', 'p40', 'p60', 'p80'] as const satisfies readonly Avancement[];
export const SOURCE_KEYS = [
  'analyse_risque', 'analyse_chimique', 'analyse_environnementale', 'audit_certification', 'audit_fournisseur', 'audit_interne',
  'audit_terrain', 'autorite_publique', 'causerie', 'comex', 'controle_reglementaire', 'dechets', 'duerp', 'evenement', 'objectif',
  'reclamation_client', 'reunion_operationnelle', 'revue_direction', 'revue_documentaire', 'revue_processus', 'veille', 'hazop',
  'reserves', 'rex',
] as const; // ordre du § 12 : les 22 sources du QHSE, plus « Audit fournisseur » et « Déchets » (réponses du 15/10/2026, ACT-37)
export type SourceKey = (typeof SOURCE_KEYS)[number];
export const DOMAIN_KEYS = ['qualite', 'securite', 'sante', 'environnement', 'surete'] as const;
export type ActionDomain = (typeof DOMAIN_KEYS)[number];
export const PRIORITY_KEYS = ['urgent', 'moyen_terme', 'long_terme'] as const;
export type ActionPriority = (typeof PRIORITY_KEYS)[number];
export const VERIFY_METHOD_KEYS = ['audit_visite', 'ecrit', 'reunion', 'visuelle', 'autre'] as const;
export type VerifyMethod = (typeof VERIFY_METHOD_KEYS)[number];
export const FOLLOW_REASON_KEYS = ['non_efficace', 'nouveau_risque'] as const;
export type FollowReason = (typeof FOLLOW_REASON_KEYS)[number];
export const RISK_LEVEL_MAX = 4; // niveaux 0 à 4 (§ 5.4)
export const REMINDER_SEND_STATUSES = ['en_cours', 'envoye', 'echec', 'sans_adresse'] as const;
export type ReminderSendStatus = (typeof REMINDER_SEND_STATUSES)[number];
export const ACTION_TEXT_MAX = 4000; // problème, détail, constat, commentaire
export const ORIGIN_REF_MAX = 120; // référence d'origine (saisie : plan du paquet 1 § 2.14)
export const ACTION_NUMBER_SCOPE = 'A'; // portée du compteur tant qu'ACT-36 n'est pas tranché
/** Liste SQL « 'a', 'b' » pour les contraintes CHECK (clés constantes, jamais de saisie). */
export const sqlList = (keys: readonly string[]) => keys.map((k) => `'${k}'`).join(', ');
