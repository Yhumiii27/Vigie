// Fichiers d'un import de plan de prévention (INT-14) — règles pures, communes au navigateur et à la server action.
//
// Un import porte un fichier (PDF remplissable, Word, scan PDF ou photo), ou les photos des pages d'un même formulaire
// papier (JPG, PNG, WEBP : MAX_SCAN_PAGES au plus), lues ensemble par l'API Claude et toutes jointes au plan. Photos
// HEIC/HEIF (iPhone) : converties en JPEG par le navigateur quand il sait les décoder (Safari), sinon refusées avec la
// marche à suivre ; le serveur les refuse d'après leur contenu (jamais envoyées à l'API, qui ne les lit pas).

import { MAX_BATCH_BYTES } from '../attachments';
import { ACCEPTED_TYPES, MAX_IMPORT_BYTES, importMimeOf } from './types';

/** Pages photographiées d'un même formulaire, au plus. */
export const MAX_SCAN_PAGES = 8;
/** Volume d'un import de plusieurs pages (limite d'un envoi de fichiers). */
export const MAX_PAGES_BYTES = MAX_BATCH_BYTES;

export const HEIC_MESSAGE = 'Photo HEIC (iPhone) non lue par ce navigateur : sur l’iPhone, choisissez Réglages > Appareil photo > Formats > « Le plus compatible », ou exportez la photo en JPEG, puis déposez-la de nouveau.';
export const UNKNOWN_FORMAT = (name: string) => `Format non accepté pour « ${name} » : PDF, Word (.docx), JPG, PNG ou WEBP.`;
export const PAGES_ONLY_IMAGES = 'Plusieurs fichiers : déposez les photos des pages d’un même formulaire (JPG, PNG, WEBP), ou un seul fichier PDF ou Word.';

type FileLike = { name: string; size: number; type: string };

/** Photo HEIC/HEIF d'après son type annoncé ou son extension. */
export const isHeic = (f: Pick<FileLike, 'name' | 'type'>) =>
  /^image\/hei[cf](-sequence)?$/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);

const isPageImage = (mime: string | null) => mime === ACCEPTED_TYPES.jpeg || mime === ACCEPTED_TYPES.png || mime === ACCEPTED_TYPES.webp;

/**
 * Contrôle d'un dépôt (navigateur, puis serveur sur les fichiers reçus) : nombre, formats, taille de chaque fichier et
 * volume de plusieurs pages ; premier message d'erreur, ou null. `files` : fichiers déjà convertis (HEIC → JPEG).
 */
export function importFilesError(files: readonly FileLike[]): string | null {
  if (!files.length) return 'Choisissez un fichier à importer.';
  if (files.length > MAX_SCAN_PAGES) return `${MAX_SCAN_PAGES} pages au plus par import : déposez les autres pages dans un second import, ou numérisez le formulaire en PDF.`;
  for (const f of files) {
    if (isHeic(f)) return HEIC_MESSAGE;
    const mime = importMimeOf(f.name, f.type);
    if (!mime) return UNKNOWN_FORMAT(f.name);
    if (!f.size) return `« ${f.name} » est vide.`;
    if (f.size > MAX_IMPORT_BYTES) return `« ${f.name} » dépasse ${MAX_IMPORT_BYTES / 1024 / 1024} Mo.`;
    if (files.length > 1 && !isPageImage(mime)) return PAGES_ONLY_IMAGES;
  }
  if (files.length > 1 && files.reduce((n, f) => n + f.size, 0) > MAX_PAGES_BYTES) {
    return `Pages trop lourdes ensemble (${MAX_PAGES_BYTES / 1024 / 1024} Mo au plus) : réduisez la résolution des photos ou numérisez le formulaire en PDF.`;
  }
  return null;
}

/** Taille visée pour chaque page d'un import de plusieurs pages (copie JPEG réduite par le navigateur). */
export const pageBudget = (pages: number) => Math.floor((MAX_PAGES_BYTES * 0.95) / Math.max(1, pages));

/** Nom affiché et conservé d'un import : le fichier, ou la première page et le nombre de pages. */
export function importName(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names[0]} (+ ${names.length - 1} page${names.length > 2 ? 's' : ''})`;
}
