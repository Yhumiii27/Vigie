import { expect, test } from '@playwright/test';
import { asRole, consoleErrors } from './helpers';

// PRV-25 (D01, décision CV-10) : liste du poste de garde — arrivées et départs à venir d'après les présences prévues de
// Cursus, matricule de site, plan de prévention rapproché, horizon dans l'URL, impression ; fermée au Salarié.

test('Chef de service : arrivées et départs à venir, plan rapproché, horizon et impression', async ({ page, context, baseURL }) => {
  const errors = consoleErrors(page);
  await asRole(context, baseURL!, 'Chef de service', 'site_a');
  await page.goto('/prevention');
  await page.getByRole('link', { name: 'Poste de garde' }).click();
  await expect(page).toHaveURL(/vue=poste-de-garde/);
  await expect(page.getByRole('heading', { name: /^Arrivées · \d+/ })).toBeVisible();
  const departures = page.getByRole('table', { name: 'Départs à venir' });
  await expect(departures).toContainText('[B. Morel]');
  // Lot 14 de Cursus : matricule de site (badge) sous le nom, matricule Cursus à part.
  await expect(departures).toContainText('Matricule de site E00202');
  await expect(departures).toContainText('EMP-9202');
  await expect(departures.getByRole('link', { name: 'PP-2026-015' })).toBeVisible();
  await page.getByRole('radio', { name: '14 jours' }).click();
  await expect(page).toHaveURL(/horizon=14/);
  await expect(page.getByRole('table', { name: 'Arrivées à venir' })).toContainText('[L. Fabre]');
  await expect(page.getByRole('link', { name: 'Imprimer la liste' })).toHaveAttribute('href', '/prevention/poste-de-garde/imprimer?horizon=14');
  await page.goto('/prevention/poste-de-garde/imprimer?horizon=14');
  await expect(page.getByRole('heading', { level: 1, name: 'Liste du poste de garde' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Salarié : liste du poste de garde fermée', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Salarié');
  await page.goto('/prevention?vue=poste-de-garde');
  await expect(page).toHaveURL(/\/evenements/);
});
