import { expect, test, type Page } from '@playwright/test';
import { asRole, consoleErrors, jpegWithExif } from './helpers';

/** Envoi par le bouton « Ajouter » des pièces jointes de la fiche (sélecteur de fichiers du navigateur). */
async function addFiles(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Ajouter', exact: true }).first().click()]);
  await chooser.setFiles(files);
}

// UX-05 : galerie des photos d'une fiche (agrandie, précédente / suivante, original servi par /fichiers) et allègement à
// l'envoi (photos réduites seulement quand l'envoi dépasserait les limites ; sinon les originaux sont envoyés).

/** JPEG lourd (bruit, `w` × `h` px, qualité 0,98) dessiné dans la page : photo d'appareil de plusieurs Mo. */
async function heavyJpeg(page: Page, w: number, h: number): Promise<Buffer> {
  const b64 = await page.evaluate(async ([w, h]) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    const img = g.createImageData(w, h);
    for (let i = 0; i < img.data.length; i++) img.data[i] = (i % 4 === 3) ? 255 : Math.floor(Math.random() * 256);
    g.putImageData(img, 0, 0);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.98));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, [w, h] as const);
  return Buffer.from(b64, 'base64');
}

test('galerie des photos d’une fiche événement : agrandie, suivante, original', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
  const errors = consoleErrors(page);
  await page.goto('/evenements?sel=EV-2026-130');
  const jpeg = await jpegWithExif(page);
  await addFiles(page, [
    { name: 'galerie-1.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    { name: 'galerie-2.jpg', mimeType: 'image/jpeg', buffer: jpeg },
  ]);
  const first = page.getByRole('button', { name: 'Voir la photo galerie-1.jpg' });
  await expect(first).toBeVisible();
  await first.click();
  const dialog = page.getByRole('dialog', { name: 'galerie-1.jpg' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'galerie-1.jpg' })).toBeVisible();
  const original = dialog.getByRole('link', { name: /Ouvrir l.original/ });
  await expect(original).toHaveAttribute('href', /^\/fichiers\//);
  await dialog.getByRole('button', { name: /Suivante/ }).click();
  await expect(page.getByRole('dialog', { name: 'galerie-2.jpg' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('dialog', { name: 'galerie-1.jpg' })).toBeVisible();
  // L'original est servi par /fichiers avec les droits de la fiche.
  const res = await page.request.get(new URL((await original.getAttribute('href'))!, baseURL).toString());
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/jpeg');
  expect(errors).toEqual([]);
});

test('allègement : photo au-delà de la limite par fichier réduite avant l’envoi, acceptée', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
  await page.goto('/evenements?sel=EV-2026-130');
  const big = await heavyJpeg(page, 3400, 2550);
  expect(big.length).toBeGreaterThan(10 * 1024 * 1024);
  await addFiles(page, [{ name: 'lourde.jpg', mimeType: 'image/jpeg', buffer: big }]);
  await expect(page.getByRole('status').filter({ hasText: /1 photo allégée avant l.envoi/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Voir la photo lourde.jpg' })).toBeVisible();
});
