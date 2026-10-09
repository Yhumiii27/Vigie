// Contrats partagés de l'import du formulaire de plan de prévention (serveur et client).

/** Réponses du formulaire importé, conservées sur le plan (prevention_plans.form_data). */
export type PpFormData = {
  source: { fileName: string; format: PpImportFormat; templateId: number | null; importedOn: string };
  sections: { title: string; items: { label: string; checked?: boolean; value?: string }[] }[];
};

export type PpImportFormat = 'pdf_form' | 'docx' | 'scan';

/** Champ détecté dans un fichier importé. `key` est stable pour un même modèle de formulaire. */
export type DetectedField = {
  key: string; // nom du champ PDF, tag/alias du contrôle Word, ou libellé normalisé
  label: string; // libellé lisible (texte voisin de la case, alias…)
  kind: 'checkbox' | 'text' | 'date' | 'choice';
  checked?: boolean;
  value?: string;
  page?: number;
};

/** Champs de Vigie qu'un champ du formulaire peut alimenter. */
export const PP_TARGETS = [
  ['contractorName', 'Entreprise extérieure — raison sociale'],
  ['contractorTrade', 'Entreprise extérieure — activité'],
  ['contactName', 'Entreprise extérieure — interlocuteur'],
  ['contactPhone', 'Entreprise extérieure — téléphone'],
  ['contactEmail', 'Entreprise extérieure — e-mail'],
  ['title', 'Nature des travaux'],
  ['location', 'Lieu d’intervention'],
  ['startOn', 'Date de début'],
  ['endOn', 'Date de fin'],
  ['estimatedHours', 'Heures estimées'],
  ['dangerousWork', 'Travaux dangereux (case)'],
  ['keystoneProject', 'Projet Keystone / affaire'],
  ['inspectionOn', 'Date de l’inspection commune'],
  ['interferenceRisks', 'Risques d’interférence (texte)'],
  ['measures', 'Mesures de prévention (texte)'],
  ['signedEuOn', 'Signature entreprise utilisatrice — date'],
  ['signedEeOn', 'Signature entreprise extérieure — date'],
] as const;
export type PpTarget = (typeof PP_TARGETS)[number][0];

/**
 * Correspondance d'un modèle : pour chaque `key` détectée, soit un champ de Vigie,
 * soit une ligne de la grille du formulaire (section + libellé), soit ignorée.
 */
export type PpImportMapping = Record<string, { target: PpTarget } | { section: string; label: string } | { ignore: true }>;
