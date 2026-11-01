import { expect, test } from '@playwright/test';
import { asRole } from './helpers';

// UX-15 (QUA-08, téléphone) : le dossier de revue de direction se lit sur téléphone — pas de défilement horizontal de la
// page, les tableaux larges défilent dans leur conteneur (focalisable au clavier).

test('dossier de revue sur téléphone : tableaux défilants, page sans débordement', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'all');
  await page.goto('/revue-de-direction');
  await expect(page.locator('.rd-doc h1')).toBeVisible();
  const boxes = page.locator('.rd-scroll');
  expect(await boxes.count()).toBeGreaterThan(3);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // Au moins un tableau plus large que l'écran défile dans son conteneur.
  const scrollable = await boxes.evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  expect(scrollable).toBeGreaterThan(0);
  await expect(boxes.first()).toHaveAttribute('tabindex', '0');
});
