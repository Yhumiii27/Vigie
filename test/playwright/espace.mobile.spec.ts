import { expect, test } from '@playwright/test';
import { asRole, consoleErrors } from './helpers';

// Espace salarié mobile (EVT-22) sur téléphone : depuis le signalement terrain, ses actions (fiche avec fil et preuves),
// sa ligne d'habilitations et ses recyclages à prévoir, ses signalements ; entrée « Mon espace » du tiroir de navigation.

test('Salarié : mon espace — actions, habilitations, signalements', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Salarié');
  const errors = consoleErrors(page);
  await page.goto('/signaler');
  await page.getByRole('link', { name: 'Mon espace' }).click();
  await expect(page).toHaveURL(/\/signaler\/mon-espace$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Mon espace' })).toBeVisible();
  const actions = page.getByRole('region', { name: /Mes actions/ });
  await expect(actions.getByRole('link', { name: /A-215/ })).toBeVisible();
  const skills = page.getByRole('region', { name: /Mes habilitations/ });
  await expect(skills.getByText('Travail en hauteur').first()).toBeVisible();
  // SST expirant le 20/11/2026 (le recyclage groupé du parcours des habilitations a pu renouveler son travail en hauteur).
  await expect(skills.getByRole('note', { name: 'Recyclages à prévoir' })).toContainText('SST : recyclage avant le 20/11/2026');
  await expect(page.getByRole('region', { name: /Mes signalements/ }).getByRole('link', { name: 'Suivre mes signalements' })).toBeVisible();
  // Fiche de son action : son fil (commentaire) et sa preuve.
  await actions.getByRole('link', { name: /A-215/ }).click();
  await expect(page).toHaveURL(/\/actions\?action=A-215/);
  await expect(page.getByText('Premier jet du mode opératoire').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('tiroir de navigation : entrée « Mon espace » sur téléphone', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Chef de service', 'ville-a');
  await page.goto('/evenements');
  await page.getByRole('button', { name: 'Ouvrir le menu de navigation' }).click();
  await page.getByRole('link', { name: /Mon espace/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mon espace' })).toBeVisible();
  await expect(page.getByText('[S. Benali]', { exact: false }).first()).toBeVisible();
});
