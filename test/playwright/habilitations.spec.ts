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

// HAB-06 : session de formation collective et recyclage groupé depuis la prévision (« À prévoir »).
test('Animateur QHSE : session collective puis recyclage groupé depuis « À prévoir »', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
  await page.goto('/habilitations');
  await page.getByRole('button', { name: 'Session collective' }).click();
  const dialog = page.getByRole('dialog', { name: 'Session de formation collective' });
  await dialog.getByRole('combobox', { name: 'Titre' }).selectOption({ label: 'Accueil sécurité' });
  // Case à cocher stylée (.vg-check) : clic sur son libellé.
  for (const name of ['[K. Bernard]', '[P. Roux]']) {
    await dialog.locator('label.vg-check', { hasText: name }).click();
    await expect(dialog.getByRole('checkbox', { name: new RegExp(name.replace(/[[\].]/g, '\\$&')) })).toBeChecked();
  }
  await dialog.getByRole('button', { name: 'Enregistrer 2 formations' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Session enregistrée : 2 formations créées.' })).toBeVisible();

  await page.goto('/habilitations?vue=a-prevoir');
  await page.getByRole('button', { name: 'Recyclage groupé' }).click();
  const renew = page.getByRole('dialog', { name: 'Recyclage groupé' });
  await renew.getByRole('combobox', { name: 'Titre' }).selectOption({ label: 'Travail en hauteur' });
  // [T. Nguyen] : Travail en hauteur expiré, coché d'office.
  await expect(renew.getByRole('checkbox', { name: /\[T\. Nguyen\]/ })).toBeChecked();
  const submit = renew.getByRole('button', { name: /^Enregistrer \d+ formations?$/ });
  await submit.click();
  await expect(renew).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: /Session enregistrée : \d+ formations? créées?\./ })).toBeVisible();
});
