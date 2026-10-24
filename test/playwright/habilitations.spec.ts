import { expect, test } from '@playwright/test';
import { asRole } from './helpers';

// Habilitations et formations (QUA-08) : matrice de l'encadrement, « Mes habilitations » du Salarié (sa seule ligne).

test('Chef de service : matrice de tous les salariés, saisie proposée', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Chef de service', 'ville-a');
  await page.goto('/habilitations');
  await expect(page.getByRole('heading', { name: 'Habilitations et formations', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer une formation' })).toBeVisible();
  const rows = page.getByRole('table').first().getByRole('row');
  expect(await rows.count()).toBeGreaterThan(3);
});

test('Salarié : ses seules habilitations, en consultation', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Salarié');
  await page.goto('/habilitations');
  await expect(page.getByText(/Mes habilitations/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer une formation' })).toHaveCount(0);
  const body = page.getByRole('table').first().getByRole('rowgroup').nth(1).getByRole('row');
  await expect(body).toHaveCount(1);
  await expect(body.first()).toContainText('[T. Nguyen]');
  await expect(page.getByRole('table').first()).not.toContainText('[M. Girard]');
});
