import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Parcours de bout en bout dans un navigateur (QUA-08, Playwright + Chromium), sur le serveur de démonstration construit
// (`VIGIE_DEMO=1 npm run build`) : test/playwright/*.spec.ts. Les parcours écrivent dans la base : jamais sur une base à
// garder. Serveur déjà lancé : VIGIE_E2E_URL (la CI le démarre pour test/e2e) ; sinon `npm run start:demo` est lancé ici,
// date figée et dossiers jetables. Navigateurs : `npx playwright install chromium` (en CI) ou PLAYWRIGHT_BROWSERS_PATH.
//   VIGIE_DEMO=1 npm run build && npm run test:pw

const url = process.env.VIGIE_E2E_URL ?? 'http://localhost:3200';
const scratch = () => mkdtempSync(path.join(tmpdir(), 'vigie-pw-'));

export default defineConfig({
  testDir: 'test/playwright',
  testMatch: '**/*.spec.ts',
  // Une base de démonstration partagée : parcours l'un après l'autre (références EV-, A- prévisibles, pas d'interférence).
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  outputDir: path.join(tmpdir(), 'vigie-pw-resultats'),
  use: { baseURL: url, locale: 'fr-FR', timezoneId: 'Europe/Paris', trace: 'retain-on-failure' },
  // Recette visuelle (QUA-16, *.visual.spec.ts) : captures comparées, sans animation ni curseur ; une capture de
  // référence par écran et par taille, sans suffixe de plateforme (relue à la main après --update-snapshots).
  snapshotPathTemplate: '{testDir}/__captures__/{projectName}/{arg}{ext}',
  expect: { timeout: 10_000, toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixelRatio: 0.002 } },
  projects: [
    { name: 'bureau', use: { ...devices['Desktop Chrome'] }, testIgnore: ['**/*.mobile.spec.ts', '**/*.visual.spec.ts'] },
    { name: 'téléphone', use: { ...devices['Pixel 7'] }, testMatch: '**/*.mobile.spec.ts' },
    // Projets de la recette visuelle : `npm run test:visual` seulement (VIGIE_VISUAL=1), jamais dans `npm run test:pw`.
    ...(process.env.VIGIE_VISUAL === '1' ? [
      { name: 'recette-bureau', use: { ...devices['Desktop Chrome'] }, testMatch: '**/*.visual.spec.ts' },
      { name: 'recette-telephone', use: { ...devices['Pixel 7'] }, testMatch: '**/*.visual.spec.ts' },
    ] : []),
  ],
  webServer: process.env.VIGIE_E2E_URL ? undefined : {
    command: 'npm run start:demo',
    url: `${url}/api/sante`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      VIGIE_TODAY: '2026-10-09', VIGIE_DATA_DIR: path.join(scratch(), 'db'), VIGIE_UPLOAD_DIR: scratch(), VIGIE_BACKUP_DIR: scratch(),
      VIGIE_MAIL_DIR: scratch(), VIGIE_SCHEDULER: '0',
    },
  },
});
