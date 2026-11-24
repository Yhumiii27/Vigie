import { expect, test } from '@playwright/test';
import { asRole } from './helpers';

// Norma 1.0 : bascule sombre / clair dans l'en-tête de la barre latérale (Vigie n'a pas de sélecteur de langue), cookie
// epc2i-theme relu par le serveur qui pose data-theme sur <html> au rendu (pas de flash), sombre par défaut.

test('affichage sombre par défaut, clair par le bouton, gardé au rechargement', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'site_a');
  await page.goto('/');
  await page.waitForLoadState('networkidle'); // bouton hydraté
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  const group = page.locator('.vg-brand').getByRole('radiogroup', { name: 'Affichage' });
  await expect(group.getByRole('radio', { name: 'Affichage sombre' })).toBeChecked();

  await group.locator('label').filter({ hasText: 'Affichage clair' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  const cookie = (await context.cookies()).find((c) => c.name === 'epc2i-theme');
  expect(cookie?.value).toBe('light');
  expect(cookie?.path).toBe('/');

  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(group.getByRole('radio', { name: 'Affichage clair' })).toBeChecked();

  await group.locator('label').filter({ hasText: 'Affichage sombre' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
});
