// Pièces jointes : constantes et formats partagés par le serveur et les composants client (sans dépendance serveur).
import { parisDay } from './dates';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Volume maximal d'un envoi (les server actions acceptent 11 Mo, marge multipart comprise). */
export const MAX_BATCH_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_BATCH = 10;
/** Limites d'un envoi (par défaut : MAX_FILES_PER_BATCH fichiers, MAX_BATCH_BYTES au total, MAX_FILE_BYTES par fichier). */
export type BatchLimits = { maxFiles?: number; maxBytes?: number; maxFileBytes?: number };

/**
 * Contrôle commun d'un envoi de fichiers, côté serveur (checkUploadBatch, src/lib/uploads.ts) et côté navigateur (QUA-19) :
 * nombre de fichiers, taille de chacun, volume total ; renvoie le premier message d'erreur, ou null.
 */
export function fileBatchError(files: readonly { name: string; size: number }[], limits: BatchLimits = {}): string | null {
  const maxFiles = limits.maxFiles ?? MAX_FILES_PER_BATCH;
  const maxBytes = limits.maxBytes ?? MAX_BATCH_BYTES;
  const maxFileBytes = limits.maxFileBytes ?? MAX_FILE_BYTES;
  const big = files.find((f) => f.size > maxFileBytes);
  if (big) return `« ${big.name} » dépasse ${maxFileBytes / 1024 / 1024} Mo.`;
  if (files.length > maxFiles) return `${maxFiles} fichiers au maximum par envoi.`;
  if (files.reduce((s, f) => s + f.size, 0) > maxBytes) return `Ces fichiers dépassent ${maxBytes / 1024 / 1024} Mo au total : envoyez-les en plusieurs fois.`;
  return null;
}

export const ATTACH_ACCEPT = 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.pptx,.txt,.csv';

export const fmtSize = (n: number) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;

export function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return 'ph-image';
  if (mime === 'application/pdf') return 'ph-file-pdf';
  if (/word/.test(mime)) return 'ph-file-doc';
  if (/sheet|excel/.test(mime)) return 'ph-file-xls';
  if (/presentation/.test(mime)) return 'ph-file-ppt';
  if (mime === 'text/csv') return 'ph-file-csv';
  if (mime.startsWith('text/')) return 'ph-file-text';
  return 'ph-file';
}

/**
 * Pièce jointe telle que la fiche l'affiche. Preuve d'une action (ACT-25) : `commentId` = commentaire avec lequel elle a été
 * déposée (null : déposée seule) ; `commentWithdrawn` : ce commentaire est retiré — preuve envoyée au QHSE seulement,
 * signalée « commentaire retiré » (D23).
 */
export type AttachmentItem = {
  id: string; name: string; mime: string; size: number; url: string; isImage: boolean;
  uploadedById?: string | null; uploadedBy?: string; addedOn?: string;
  commentId?: number | null; commentWithdrawn?: boolean;
};

/**
 * Ligne de la table attachments → élément affichable (`url` = attachmentUrl(id), voir src/lib/uploads.ts). Le chargement
 * passe `commentWithdrawn` pour une preuve dont le commentaire est retiré (D23).
 */
export const toAttachmentItem = (
  r: { id: string; fileName: string; mimeType: string; size: number; uploadedBy: string | null; createdAt: Date; commentId?: number | null },
  uploadedBy?: string,
  opts: { commentWithdrawn?: boolean } = {},
): AttachmentItem => ({
  id: r.id, name: r.fileName, mime: r.mimeType, size: r.size, url: `/fichiers/${r.id}`, isImage: r.mimeType.startsWith('image/'),
  uploadedById: r.uploadedBy, uploadedBy, addedOn: parisDay(r.createdAt),
  ...(r.commentId != null ? { commentId: r.commentId } : {}),
  ...(opts.commentWithdrawn ? { commentWithdrawn: true } : {}),
});
