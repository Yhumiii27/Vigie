import { expect, test, type Page } from '@playwright/test';
import { asRole } from './helpers';

// UX-06 : mise en page tablette (761–1180 px) — Kanban des actions sur deux rangées de trois colonnes, liste puis fiche
// en portrait, deux colonnes en paysage, aucune barre de défilement horizontale ; bureau inchangé (six colonnes).
// Contrôle axe-core sur tablette : accessibilite.spec.ts (projet « tablette », 820 × 1180).

/** Colonnes du Kanban sur la première rangée (même ordonnée que la première colonne). */
const columns = (page: Page) => page.locator('.vg-kanban').evaluate((el) => {
  const kids = [...el.children].map((c) => Math.round(c.getBoundingClientRect().top));
  return kids.filter((top) => top === kids[0]).length;
});
const horizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('tablette portrait (820 × 1180)', () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test('Kanban : trois colonnes par rangée, pas de défilement horizontal', async ({ page, context, baseURL }) => {
    await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
    await page.goto('/actions?vue=kanban');
    await expect(page.locator('.vg-kanban')).toBeVisible();
    expect(await columns(page)).toBe(3);
    expect(await horizontalScroll(page)).toBeLessThanOrEqual(0);
    await expect(page.locator('.vg-side')).toBeVisible(); // barre latérale gardée (pas de tiroir)
  });

  test('événements : liste puis fiche, « Retour à la liste »', async ({ page, context, baseURL }) => {
    await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
    await page.goto('/evenements');
    await expect(page.locator('.vg-md-list')).toBeVisible();
    await expect(page.locator('.vg-md-detail')).toBeHidden();
    await page.goto('/evenements?sel=EV-2026-130');
    await expect(page.locator('.vg-md-list')).toBeHidden();
    await expect(page.locator('.vg-md-detail')).toContainText('Cotes hors tolérance');
    await expect(page.getByRole('link', { name: 'Retour à la liste' })).toBeVisible();
    expect(await horizontalScroll(page)).toBeLessThanOrEqual(0);
  });
});

test.describe('tablette paysage (1180 × 820)', () => {
  test.use({ viewport: { width: 1180, height: 820 } });

  test('événements : liste et fiche côte à côte ; Kanban sur trois colonnes', async ({ page, context, baseURL }) => {
    await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
    await page.goto('/evenements?sel=EV-2026-130');
    await expect(page.locator('.vg-md-list')).toBeVisible();
    await expect(page.locator('.vg-md-detail')).toContainText('Cotes hors tolérance');
    await expect(page.getByRole('link', { name: 'Retour à la liste' })).toBeHidden();
    await page.goto('/actions?vue=kanban');
    expect(await columns(page)).toBe(3);
    expect(await horizontalScroll(page)).toBeLessThanOrEqual(0);
  });
});

test.describe('bureau (1280 × 800) inchangé', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('Kanban : six colonnes sur une rangée', async ({ page, context, baseURL }) => {
    await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
    await page.goto('/actions?vue=kanban');
    expect(await columns(page)).toBe(6);
    expect(await page.locator('.vg-side').evaluate((el) => el.getBoundingClientRect().width)).toBe(236);
  });
});
