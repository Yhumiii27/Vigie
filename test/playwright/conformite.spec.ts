import { expect, test } from '@playwright/test';
import { asRole, consoleErrors } from './helpers';

// Paquet 13, première moitié (QUA-08) : registre de sécurité de la veille (VEI-15) et son impression, vue d'ensemble du
// DUERP (DUE-17), inspections et réunions périodiques d'un plan de prévention (PRV-17).

test('Animateur QHSE : registre de sécurité, inscription d’une observation, impression par site', async ({ page, context, baseURL }) => {
  const errors = consoleErrors(page);
  await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
  await page.goto('/veille?onglet=registre');
  await expect(page.getByRole('link', { name: /Registre de sécurité/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Inspection du travail' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Inscrire une observation' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Émetteur').fill('Organisme agréé [Apave]');
  await dialog.getByLabel('Observations ou prescriptions').fill('Éclairage de sécurité du magasin à vérifier.');
  await dialog.getByRole('button', { name: 'Inscrire au registre' }).click();
  await expect(page.getByRole('cell', { name: 'Éclairage de sécurité du magasin à vérifier.' })).toBeVisible();
  await page.goto('/veille/registre-securite');
  await expect(page.getByRole('heading', { level: 2, name: 'Observations et mises en demeure' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Vérifications et contrôles périodiques' })).toBeVisible();
  await expect(page.getByText('Pont roulant 10 t — atelier montage').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('Salarié : vue d’ensemble du DUERP en consultation, sans registre de sécurité', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Salarié', 'ville-a');
  await page.goto('/risques?vue=ensemble');
  await expect(page.getByText('Matrice toutes unités')).toBeVisible();
  await expect(page.getByText('Risques prioritaires')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Atelier montage' }).first()).toBeVisible();
  // Écran de la veille fermé au Salarié : redirection vers son écran d'accueil.
  await page.goto('/veille/registre-securite');
  await expect(page).not.toHaveURL(/registre-securite/);
});

test('Chef de service : réunions périodiques du contrat annuel de nettoyage', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Chef de service', 'ville-a');
  await page.goto('/prevention?plan=PP-2025-041');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Inspections et réunions périodiques')).toBeVisible();
  await expect(dialog.getByText(/Tous les 30 jours pendant l.intervention/)).toBeVisible();
  await expect(dialog.getByText(/Prochaine avant le 19\/10\/2026/)).toBeVisible();
});
