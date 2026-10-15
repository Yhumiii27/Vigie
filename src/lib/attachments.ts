// Pièces jointes : constantes et formats partagés par le serveur et les composants client (sans dépendance serveur).

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Volume maximal d'un envoi (les server actions acceptent 11 Mo, marge multipart comprise). */
export const MAX_BATCH_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_BATCH = 10;
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

/** Pièce jointe telle que la fiche l'affiche. */
export type AttachmentItem = {
  id: string; name: string; mime: string; size: number; url: string; isImage: boolean;
  uploadedById?: string | null; uploadedBy?: string; addedOn?: string;
};

/** Ligne de la table attachments → élément affichable (`url` = attachmentUrl(id), voir src/lib/uploads.ts). */
export const toAttachmentItem = (r: { id: string; fileName: string; mimeType: string; size: number; uploadedBy: string | null; createdAt: Date }, uploadedBy?: string): AttachmentItem => ({
  id: r.id, name: r.fileName, mime: r.mimeType, size: r.size, url: `/fichiers/${r.id}`, isImage: r.mimeType.startsWith('image/'),
  uploadedById: r.uploadedBy, uploadedBy, addedOn: r.createdAt.toISOString().slice(0, 10),
});
