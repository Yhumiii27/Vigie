import { expect, test } from '@playwright/test';
import { AXE_SCREENS, asRole, axeViolations } from './helpers';

// Paquet 9 (UX-11) sur téléphone : tiroir de navigation au clavier (ouverture, menu du site dans le tiroir, Échap, focus
// rendu au bouton) et lien d'évitement.

test('tiroir : Échap ferme d’abord le menu du site, puis le tiroir ; focus rendu au bouton', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Ouvrir le menu de navigation' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // Focus d'ouverture : premier élément du tiroir (« Fermer le menu »), puis le choix du site.
  await expect(page.getByRole('button', { name: 'Fermer le menu' })).toBeFocused();
  await page.keyboard.press('Tab');
  const site = page.getByRole('button', { name: /^Site :/ });
  await expect(site).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(site).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
});

test('lien d’évitement sur téléphone', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Salarié');
  await page.goto('/evenements');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Aller au contenu' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
});

// QUA-16 : contrôle axe-core (WCAG A et AA) des mêmes écrans sur téléphone (tiroir, liste puis fiche, cibles tactiles).
test.describe('axe-core (WCAG A et AA) · téléphone', () => {
  test.use({ bypassCSP: true });
  for (const { role, site, url } of AXE_SCREENS) {
    test(`${role} · ${url}`, async ({ page, context, baseURL }) => {
      await asRole(context, baseURL!, role, site);
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      expect(await axeViolations(page)).toEqual([]);
    });
  }
});
