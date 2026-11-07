import { expect, test } from '@playwright/test';
import { asRole } from './helpers';

// Habilitations et formations (QUA-08) : matrice de l'encadrement, « Mes habilitations » du Salarié (sa seule ligne).

test('Chef de service : matrice de tous les salariés, consultation (aucune saisie de formation)', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Chef de service', 'site_a');
  await page.goto('/habilitations');
  await expect(page.getByRole('heading', { name: 'Habilitations et formations', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer une formation' })).toHaveCount(0);
  // D01 (décision CV-10) : personnes lues dans Cursus, aucune création ni import dans Vigie ; rafraîchissement au QHSE.
  await expect(page.getByRole('button', { name: 'Ajouter un salarié' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Importer le personnel/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Actualiser depuis Cursus' })).toHaveCount(0);
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

// Décision CV-01 du 04/11/2026 (lot 2 de M-02) : consultation des titres tenus par Cursus ; le QHSE suit un titre du
// catalogue de Cursus, puis ne le suit plus (motif).
test('Animateur QHSE : consultation ; suivre un titre du catalogue de Cursus, puis ne plus le suivre', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'site_a');
  await page.goto('/habilitations');
  await expect(page.getByText(/Données tenues par Cursus \(RH\)/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Session collective' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Titres suivis' }).click();
  const dialog = page.getByRole('dialog', { name: 'Titres suivis' });
  await dialog.getByRole('button', { name: 'Suivre un titre de Cursus' }).click();
  const choice = dialog.getByRole('combobox', { name: 'Titre du catalogue de Cursus' });
  // Premier titre du catalogue que Vigie ne suit pas encore (la liste diminue d'un passage à l'autre sur le même serveur).
  const id = await choice.locator('option').nth(1).getAttribute('value');
  await choice.selectOption({ value: id! });
  await dialog.getByRole('button', { name: 'Suivre le titre' }).click();
  await expect(dialog.getByText(id!, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Ne plus suivre' }).last().click();
  const reason = dialog.locator('form', { has: page.getByRole('textbox', { name: /Motif/ }) });
  await reason.getByRole('textbox', { name: /Motif/ }).fill('Essai de parcours');
  await reason.getByRole('button', { name: 'Ne plus suivre' }).click();
  await expect(dialog.getByText(id!, { exact: true })).toHaveCount(0);
});

// D01 (décision CV-10) : vue « Personnel (Cursus) » du QHSE — fiche ancienne à rattacher, rafraîchissement.
test('Animateur QHSE : personnel lu dans Cursus, fiche à rattacher, actualisation', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'site_a');
  await page.goto('/habilitations?vue=personnel');
  await expect(page.getByRole('heading', { name: 'Personnes lues dans Cursus' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Fiches à rattacher/ })).toBeVisible();
  await page.getByRole('button', { name: 'Actualiser depuis Cursus' }).click();
  await expect(page.getByText(/Cursus actualisé/).first()).toBeVisible();
});
