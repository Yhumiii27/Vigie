// Allègement des photos à l'envoi (UX-05), côté navigateur : module sans dépendance serveur. Règle pure `photosToShrink`
// (testée) et réduction `shrinkPhoto` (canvas du navigateur ; aucune dépendance native côté serveur).
//   - Signalement terrain (ReportForm) : chaque photo est réduite et réencodée (règle SEC-09 : métadonnées retirées ;
//     le serveur les retire encore par cleanReportPhoto pour un signalement sans compte ou anonyme).
//   - Pièces jointes d'une fiche (Attachments) : l'original est envoyé tel quel tant que l'envoi respecte les limites
//     (fileBatchError) ; seules les photos d'un envoi qui serait refusé (fichier ou volume trop lourd) sont réduites —
//     aucun original accepté n'est remplacé par une copie allégée.

import { fileBatchError, type BatchLimits } from './attachments';

/** Plus grand côté d'une photo réduite pour un signalement terrain. */
export const REPORT_PHOTO_EDGE = 1920;
/** Plus grand côté d'une photo réduite pour une pièce jointe (lisibilité d'une plaque, d'un PV photographié). */
export const ATTACHMENT_PHOTO_EDGE = 2560;
/** Photo trop légère pour gagner à être réduite. */
const MIN_SHRINK_BYTES = 512 * 1024;

/** Photo d'appareil (JPEG, WebP, HEIC/HEIF) : réencodée en JPEG sans perte notable ; PNG et GIF (schémas, captures) exclus. */
export const isCameraPhoto = (f: { type: string; name: string }) =>
  /^image\/(jpeg|webp|heic|heif)$/.test(f.type) || (!f.type && /\.(jpe?g|webp|heic|heif)$/i.test(f.name));

/**
 * Indices des photos à réduire avant l'envoi d'une pièce jointe : aucune si l'envoi respecte les limites (originaux
 * conservés) ; sinon les photos d'appareil de plus de 512 Ko, les plus lourdes d'abord.
 */
export function photosToShrink(files: readonly { name: string; size: number; type: string }[], limits: BatchLimits = {}): number[] {
  if (!fileBatchError(files, limits)) return [];
  return files.map((f, i) => ({ f, i }))
    .filter(({ f }) => isCameraPhoto(f) && f.size > MIN_SHRINK_BYTES)
    .sort((a, b) => b.f.size - a.f.size)
    .map(({ i }) => i);
}

export type ShrunkPhoto = { file: File; cleaned: boolean };

/**
 * Réduit la photo (`maxEdge` px au plus, JPEG) : l'envoi reste léger sur réseau mobile et le réencodage retire les
 * métadonnées (position GPS, appareil). Navigateur incapable de décoder la photo (HEIC hors Safari, mémoire
 * insuffisante…) ou copie pas plus légère : le fichier d'origine est rendu tel quel, avec `cleaned: false` dans le
 * premier cas.
 */
export async function shrinkPhoto(file: File, { maxEdge = REPORT_PHOTO_EDGE, quality = 0.82, keepIfLarger = false } = {}): Promise<ShrunkPhoto> {
  const raw = { file, cleaned: false };
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bmp.close(); return raw; }
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) return raw;
    if (keepIfLarger && blob.size >= file.size) return raw;
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return { file: new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified }), cleaned: true };
  } catch {
    return raw;
  }
}
