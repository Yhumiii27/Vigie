// Types de l'import du formulaire de plan de prévention, partagés par les lecteurs, la server action et l'écran.

import type { DetectedField, PpImportFormat, PpImportMapping } from '../pp-form';

/** Champ détecté, avec le titre de la section du formulaire où il se trouve (« Risques d'interférence »). */
export type ImportField = DetectedField & { section?: string };

/** Résultat d'un lecteur de fichier (PDF remplissable, Word, scan). */
export type ParseResult = {
  format: PpImportFormat;
  fields: ImportField[];
  warnings: string[];
  pageCount?: number;
};

/** Erreur de lecture présentée telle quelle à l'utilisateur (message en français) ; `retryable` : une nouvelle tentative peut aboutir. */
export class ImportError extends Error {
  readonly retryable: boolean;
  constructor(message: string, opts: { retryable?: boolean } = {}) {
    super(message);
    this.name = 'ImportError';
    this.retryable = !!opts.retryable;
  }
}

export type MapEntry = PpImportMapping[string];

/** Modèle d'import tel que présenté à l'écran. */
export type TemplateView = {
  id: number;
  name: string;
  format: PpImportFormat;
  signature: string | null;
  mapping: PpImportMapping;
  updatedOn: string; // AAAA-MM-JJ
  updatedBy: string | null;
};

type Option = readonly [value: string, label: string];

/**
 * Lecture des scans par l'API Claude : « off » sans activation explicite (VIGIE_AI_IMPORT=1),
 * « no_credentials » si elle est activée sans identifiants d'API Anthropic sur le serveur, « ready » sinon.
 */
export type AiStatus = 'off' | 'ready' | 'no_credentials';

/** Données sérialisables de l'écran d'import (référentiels des formulaires, modèles enregistrés). */
export type ImportScreenData = {
  templates: TemplateView[];
  contractors: { id: string; name: string; trade: string }[];
  /** Sites proposés : le seul site sélectionné, ou tous les sites. */
  sites: { id: string; label: string; seveso: string | null; ppFromFirstMinute: boolean }[];
  defaultSiteId: string;
  siteLocked: boolean;
  people: Option[];
  projects: Option[];
  today: string;
  currentUserId: string;
  /** Lecture des scans par l'API Claude. */
  aiStatus: AiStatus;
};

/** Réponse de la détection (étape 2). */
export type DetectResponse =
  | { ok: false; error: string }
  | {
    ok: true;
    fileName: string;
    format: PpImportFormat;
    fields: ImportField[];
    /** Empreinte des clés détectées (PDF remplissable, Word) ; null pour un scan. */
    signature: string | null;
    /** Modèle reconnu (même format et même empreinte) ou choisi au dépôt. */
    matchedTemplateId: number | null;
    /** Modèle proche (au moins 80 % de champs communs) proposé à l'utilisateur. */
    proposedTemplate: { id: number; overlap: number } | null;
    warnings: string[];
    pageCount?: number;
    /**
     * Lecture par l'API Claude : utilisée pour ce fichier, disponible (activée, identifiants présents), message d'échec
     * de la lecture d'un scan (le plan se saisit alors à partir du fichier) et échec passager (la lecture peut être relancée).
     */
    ai: { used: boolean; available: boolean; error?: string; retryable?: boolean };
  };

export const FORMAT_LABELS: Record<PpImportFormat, string> = {
  pdf_form: 'PDF remplissable',
  docx: 'Word (.docx)',
  scan: 'Scan ou photo',
};

export const FORMAT_ICONS: Record<PpImportFormat, string> = {
  pdf_form: 'ph-file-pdf',
  docx: 'ph-file-doc',
  scan: 'ph-scan',
};

/** Types MIME acceptés à l'import. */
export const ACCEPTED_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const;
export const ACCEPT_ATTR = `${Object.values(ACCEPTED_TYPES).join(',')},.pdf,.docx,.jpg,.jpeg,.png,.webp`;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** Message affiché quand la lecture des scans par l'API Claude n'est pas activée. */
export const AI_DISABLED_MESSAGE = 'Lecture des scans désactivée : définir VIGIE_AI_IMPORT=1 et une clé ANTHROPIC_API_KEY';
/** Message affiché quand la lecture des scans est activée sans identifiants d'API Anthropic sur le serveur. */
export const AI_NO_CREDENTIALS_MESSAGE = "Lecture des scans activée (VIGIE_AI_IMPORT=1) mais aucune clé d'API Anthropic sur le serveur : définir ANTHROPIC_API_KEY";

/** Type MIME d'un fichier d'après son type déclaré ou son extension (certains navigateurs n'en donnent pas pour .docx). */
export function importMimeOf(name: string, declared: string): string | null {
  const known = Object.values(ACCEPTED_TYPES) as string[];
  if (known.includes(declared)) return declared;
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const byExt: Record<string, string> = {
    pdf: ACCEPTED_TYPES.pdf, docx: ACCEPTED_TYPES.docx, jpg: ACCEPTED_TYPES.jpeg, jpeg: ACCEPTED_TYPES.jpeg, png: ACCEPTED_TYPES.png, webp: ACCEPTED_TYPES.webp,
  };
  return byExt[ext] ?? null;
}
