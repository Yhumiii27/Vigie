// En-têtes de service d'une pièce jointe par /fichiers/[id] (SEC-08), règle pure testée dans file-serving.test.ts.
//
// - Content-Type : type enregistré (tiré du contenu depuis le paquet 8) s'il fait partie des formats admis, sinon
//   application/octet-stream ; texte servi en text/plain (jamais interprété comme HTML).
// - Content-Disposition : « inline » pour les images et les PDF (consultés dans le navigateur), « attachment » pour tout le
//   reste (documents Office, texte, CSV) ; nom nettoyé (safeFileName) avec repli ASCII.
// - X-Content-Type-Options: nosniff, Content-Security-Policy « sandbox » sans script (sauf PDF : visionneuse du
//   navigateur), Cross-Origin-Resource-Policy: same-origin ; pièce médicale jamais gardée en cache (SEC-06).

import { asciiFileName, isInlineType, safeFileName } from './file-type';

const SERVED = /^(image\/(jpeg|png|webp|heic|heif|gif)|application\/pdf|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|application\/msword|application\/vnd\.ms-excel)$/;

/** Politique de contenu d'une pièce servie : aucun script ni ressource externe ; bac à sable sauf pour un PDF. */
export const FILE_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";

export function attachmentHeaders(row: { mimeType: string; fileName: string; health: boolean }, length: number): Record<string, string> {
  const text = row.mimeType === 'text/plain' || row.mimeType === 'text/csv';
  const type = text ? `${row.mimeType}; charset=utf-8` : SERVED.test(row.mimeType) ? row.mimeType : 'application/octet-stream';
  const inline = isInlineType(row.mimeType);
  const name = safeFileName(row.fileName);
  return {
    'Content-Type': type,
    'Content-Length': String(length),
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${asciiFileName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': row.health ? 'private, no-store' : 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    // PDF : sans politique de contenu, que la visionneuse intégrée du navigateur refuserait (scripts d'un PDF : exécutés,
    // le cas échéant, dans le bac à sable de la visionneuse, jamais dans l'origine de Vigie).
    ...(row.mimeType === 'application/pdf' ? {} : { 'Content-Security-Policy': FILE_CSP }),
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}
