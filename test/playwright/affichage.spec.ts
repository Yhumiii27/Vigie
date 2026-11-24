import { expect, test } from '@playwright/test';
import { asRole } from './helpers';

// Norma 1.0 et § 7 : sélecteur FR / EN puis bascule sombre / clair dans l'en-tête de page, à droite (VG-N01), cookie
// epc2i-theme relu par le serveur qui pose data-theme sur <html> au rendu (pas de flash), sombre par défaut.

test('affichage sombre par défaut, clair par le bouton, gardé au rechargement', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'site_a');
  await page.goto('/');
  await page.waitForLoadState('networkidle'); // bouton hydraté
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  const group = page.locator('.vg-header').getByRole('radiogroup', { name: 'Affichage' });
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

// VG-N01 : français par défaut ; EN rend la coque (barre latérale, navigation, en-tête) en anglais, cookie vigie-lang relu
// par le serveur ; FR ramène le français. Les identifiants de route restent en français.
test('français par défaut, anglais par le sélecteur FR / EN, gardé au rechargement', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'site_a');
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', 'fr');
  const header = page.locator('.vg-header');
  const langs = header.getByRole('radiogroup', { name: 'Langue' });
  await expect(langs.getByRole('radio', { name: 'Français' })).toBeChecked();
  // Ordre de l'en-tête : FR / EN avant la bascule sombre / clair.
  const groups = await header.getByRole('radiogroup').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(groups.indexOf('Langue')).toBeLessThan(groups.indexOf('Affichage'));
  await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Tableau de bord' })).toBeVisible();

  await langs.locator('label').filter({ hasText: 'EN' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await expect(html).toHaveAttribute('lang', 'en');
  expect((await context.cookies()).find((c) => c.name === 'vigie-lang')?.value).toBe('en');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Action plan' })).toHaveAttribute('href', '/actions');

  await page.locator('.vg-header').getByRole('radiogroup', { name: 'Language' }).locator('label').filter({ hasText: 'FR' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
});

// VG-N07 : ⌘K / Ctrl+K place le curseur dans la recherche de pages ; Entrée ouvre la première page trouvée.
test('recherche de pages ⌘K', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'site_a');
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('searchbox', { name: 'Aller à une page' });
  await expect(input).toBeFocused();
  await input.fill('veille');
  await expect(page.getByRole('navigation', { name: 'Pages trouvées' }).getByRole('link', { name: /Veille et contrôles/ })).toBeVisible();
  await input.press('Enter');
  await expect(page).toHaveURL(/\/veille$/);
});
