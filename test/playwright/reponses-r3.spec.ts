import { expect, test } from '@playwright/test';
import { asRole, consoleErrors } from './helpers';

// Paquet R3 des réponses du service QHSE du 09/11/2026 : auto-évaluation par référentiel (AUD-40), consignations d'un permis
// et opérations simultanées (PRV-22), tableau de bord configurable (TDB-19). Le parcours modifie la base de démonstration.

test('Animateur QHSE : campagne d’auto-évaluation en cours, synthèse comparée, évaluation d’une exigence', async ({ page, context, baseURL }) => {
  const errors = consoleErrors(page);
  await asRole(context, baseURL!, 'Animateur QHSE', 'site_a');
  await page.goto('/audits');
  await page.getByRole('radio', { name: 'Auto-évaluation ISO' }).click();
  await expect(page).toHaveURL(/vue=auto-evaluation/);
  await page.getByRole('link', { name: 'AE-002' }).click();
  await expect(page.getByRole('region', { name: 'Synthèse par article' })).toContainText('Ensemble du référentiel');
  await expect(page.getByRole('region', { name: 'Synthèse par article' })).toContainText('Précédente');
  const line = page.locator('li', { hasText: 'Identification des dangers et évaluation des risques' }).first();
  await line.getByRole('button', { name: 'Évaluer' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Niveau de conformité').selectOption('non_conforme');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Certains champs');
  await dialog.getByLabel('Justification').fill('Unité du magasin non réévaluée');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(line).toContainText('Non conforme');
  expect(errors).toEqual([]);
});

test('Chef de projet : opérations simultanées par zone, en lecture', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Chef de projet', 'site_a');
  await page.goto('/prevention');
  await page.getByRole('link', { name: 'Opérations simultanées' }).click();
  await expect(page).toHaveURL(/vue=simops/);
  await expect(page.getByRole('heading', { level: 2, name: /^Opérations simultanées du/ })).toBeVisible();
  await page.getByRole('link', { name: /Veille/ }).click();
  await expect(page).toHaveURL(/jour=\d{4}-\d{2}-\d{2}/);
});

test('Direction : tableau de bord personnalisé (ajout, ordre, retour à la disposition par défaut)', async ({ page, context, baseURL }) => {
  const errors = consoleErrors(page);
  await asRole(context, baseURL!, 'Direction', 'site_a');
  await page.goto('/');
  await page.getByRole('button', { name: 'Personnaliser' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Ajouter une carte').selectOption({ label: 'Conformité de la veille' });
  await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await dialog.getByRole('button', { name: 'Monter « Conformité de la veille »' }).click();
  await dialog.getByRole('button', { name: 'Enregistrer la disposition' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Conformité de la veille', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Personnaliser' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revenir à la disposition par défaut' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Conformité de la veille', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
