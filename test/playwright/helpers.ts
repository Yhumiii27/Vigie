import type { BrowserContext, Page } from '@playwright/test';
import type { Role } from '@/lib/domain';

// Outils des parcours Playwright (QUA-08) : rôle et site de démonstration posés par les cookies du sélecteur de rôle
// (setRole, mode démonstration seulement), date du jeu figée au 09/10/2026 (VIGIE_TODAY).

/** Rôle de démonstration (personne associée : src/lib/demo.ts) et site sélectionné. */
export async function asRole(context: BrowserContext, baseURL: string, role: Role, site = 'all') {
  await context.clearCookies();
  await context.addCookies([
    { name: 'vigie_role', value: encodeURIComponent(role), url: baseURL },
    { name: 'vigie_site', value: site, url: baseURL },
  ]);
}

/** Erreurs de la console du navigateur pendant le parcours (hydratation, CSP, exceptions). */
export function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/**
 * Photo JPEG décodable par le navigateur (dessinée dans la page), avec un segment EXIF ajouté (position GPS fictive) :
 * photo d'un signalement.
 */
export async function jpegWithExif(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 48;
    const g = c.getContext('2d')!;
    g.fillStyle = '#c33';
    g.fillRect(0, 0, 64, 48);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return btoa(String.fromCharCode(...bytes));
  });
  const jpeg = Buffer.from(b64, 'base64');
  const exif = Buffer.from('Exif\0\0GPS 48.8566N 2.3522E', 'latin1');
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff]), exif, jpeg.subarray(2)]);
}
