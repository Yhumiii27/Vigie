import { expect, test } from '@playwright/test';
import { asRole } from './helpers';

// QUA-16 : recette visuelle — captures de référence des écrans principaux (bureau et téléphone), comparées à chaque
// passage. Stables par construction : date du jeu figée (VIGIE_TODAY=2026-10-09), polices locales (Inter par next/font,
// icônes Phosphor du paquet), animations et curseur désactivés (playwright.config.ts), jeu de démonstration intact (lancées
// avant les parcours qui écrivent). Le rendu dépend toutefois de la machine (Chromium, lissage des polices) : projet
// « recette » hors de `npm run test:pw`, lancé par `npm run test:visual` ; captures dans test/playwright/__captures__/,
// réécrites par `npm run test:visual -- --update-snapshots` après un changement voulu (relire chaque image). En CI : étape
// non bloquante.

const SCREENS = ['/', '/a-faire', '/evenements', '/actions', '/risques', '/veille', '/documents', '/habilitations', '/audits', '/environnement', '/prevention'];

for (const url of SCREENS) {
  test(`Animateur QHSE · ${url}`, async ({ page, context, baseURL }) => {
    await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`${url === '/' ? 'tableau-de-bord' : url.slice(1)}.png`);
  });
}

test('Salarié · signalement', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Salarié', 'all');
  await page.goto('/signaler');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot('signaler.png');
});
