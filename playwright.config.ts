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
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  outputDir: path.join(tmpdir(), 'vigie-pw-resultats'),
  use: { baseURL: url, locale: 'fr-FR', timezoneId: 'Europe/Paris', trace: 'retain-on-failure' },
  projects: [
    { name: 'bureau', use: { ...devices['Desktop Chrome'] }, testIgnore: '**/*.mobile.spec.ts' },
    { name: 'téléphone', use: { ...devices['Pixel 7'] }, testMatch: '**/*.mobile.spec.ts' },
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
