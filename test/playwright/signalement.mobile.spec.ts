import { expect, test } from '@playwright/test';
import { asRole, consoleErrors, jpegWithExif } from './helpers';

// Signalement terrain sur téléphone (QUA-08) : en son nom puis suivi dans « Mes signalements » ; anonyme avec une photo
// (métadonnées retirées côté serveur, SEC-09 : vérifié par test/integration/ops-security-paquet8.test.ts).

test('Salarié : situation dangereuse signalée, suivie dans « Mes signalements »', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Salarié');
  const errors = consoleErrors(page);
  await page.goto('/signaler');
  await page.getByRole('radio', { name: 'Situation dangereuse' }).click();
  await page.getByRole('combobox', { name: 'Zone du site' }).selectOption({ label: 'Magasin' });
  await page.getByRole('textbox', { name: 'Description' }).fill('Palette en équilibre instable en haut du rack R4.');
  await page.getByRole('button', { name: /Envoyer le signalement/ }).click();
  const sent = page.getByText(/Signalement envoyé/);
  await expect(sent).toBeVisible();
  const ref = (await page.getByText(/Référence EV-\d{4}-\d+/).textContent())!.match(/EV-\d{4}-\d+/)![0];
  await page.getByRole('link', { name: /Mes signalements/ }).click();
  await expect(page.getByText(ref).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('signalement anonyme avec photo : envoyé, sans nom', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Chef de service', 'ville-a');
  await page.goto('/signaler');
  await page.getByRole('radio', { name: 'Presque-accident' }).click();
  await page.getByRole('textbox', { name: 'Description' }).fill('Chariot passé à grande vitesse devant la sortie du vestiaire.');
  await page.locator('input[type="file"]').setInputFiles({ name: 'IMG_0042.jpg', mimeType: 'image/jpeg', buffer: await jpegWithExif(page) });
  await page.getByRole('switch', { name: /Rester anonyme/ }).click();
  await page.getByRole('button', { name: /Envoyer le signalement/ }).click();
  await expect(page.getByText(/Signalement envoyé/)).toBeVisible();
});
