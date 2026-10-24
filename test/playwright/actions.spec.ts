import { expect, test, type Page } from '@playwright/test';
import { asRole, consoleErrors } from './helpers';

// Plan d'actions QSE (QUA-08, après la refonte ACT-17 à ACT-40) : création par le service QHSE, fiche ouverte,
// modification ; deux fenêtres ouvertes sur la même fiche : la seconde ne peut pas écraser la première (QUA-12).

const DETAIL = 'Baliser l’allée du rack R4 et former les caristes au gerbage';

async function newAction(page: Page) {
  await page.goto('/actions');
  await page.getByRole('button', { name: 'Nouvelle action' }).click();
  const d = page.getByRole('dialog', { name: 'Nouvelle action QSE' });
  await d.getByRole('combobox', { name: 'Responsable' }).selectOption({ label: '[R. Fontaine] — Magasinier' });
  await d.getByRole('combobox', { name: 'Priorité' }).selectOption({ label: 'Moyen terme' });
  await d.getByRole('textbox', { name: 'Date cible' }).fill('2026-11-15');
  await d.getByRole('combobox', { name: 'Source' }).selectOption({ label: 'Audit terrain' });
  await d.getByRole('textbox', { name: 'Référence d’origine' }).fill('Visite terrain du 09/10/2026');
  await d.getByRole('combobox', { name: 'Domaine' }).selectOption({ label: 'Sécurité' });
  await d.getByRole('textbox', { name: 'Description du problème' }).fill('Palettes gerbées sur trois niveaux sans balisage dans l’allée du rack R4.');
  await d.getByRole('textbox', { name: 'Détail de l’action' }).fill(DETAIL);
  await d.getByRole('textbox', { name: 'Vérification planifiée' }).fill('2026-12-15');
  await d.getByRole('button', { name: /Créer l’action/ }).click();
  await expect(d).toBeHidden();
}

test('Animateur QHSE : crée une action, la retrouve dans le plan et ouvre sa fiche', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
  const errors = consoleErrors(page);
  await newAction(page);
  await page.goto('/actions');
  await page.getByRole('textbox', { name: 'Rechercher une action' }).fill('rack R4');
  const row = page.getByRole('row', { name: new RegExp(DETAIL.slice(0, 30)) }).first();
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: /^A-\d+$/ }).click();
  await expect(page).toHaveURL(/action=A-\d+/);
  await expect(page.getByText(DETAIL).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('modifications simultanées : la seconde fenêtre est avertie au lieu d’écraser (QUA-12)', async ({ browser, baseURL }) => {
  const open = async () => {
    const context = await browser.newContext();
    await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
    const page = await context.newPage();
    return { context, page };
  };
  const a = await open();
  const b = await open();
  await a.page.goto('/actions');
  await a.page.getByRole('textbox', { name: 'Rechercher une action' }).fill('rack R4');
  await a.page.getByRole('row', { name: new RegExp(DETAIL.slice(0, 30)) }).first().getByRole('link', { name: /^A-\d+$/ }).click();
  await expect(a.page).toHaveURL(/action=A-\d+/);
  await b.page.goto(a.page.url());
  for (const p of [a.page, b.page]) await p.getByRole('button', { name: 'Modifier' }).first().click();
  // Fenêtre de modification (la fiche de l'action est elle-même une fenêtre) : celle qui porte « Enregistrer ».
  const editor = (p: Page) => p.getByRole('dialog').filter({ has: p.getByRole('button', { name: 'Enregistrer' }) });
  const da = editor(a.page);
  await da.getByRole('textbox', { name: 'Détail de l’action' }).fill(`${DETAIL} (fenêtre A)`);
  await da.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(da).toHaveCount(0);
  await expect(a.page.getByRole('dialog', { name: /fenêtre A/ })).toBeVisible();
  const db = editor(b.page);
  await db.getByRole('textbox', { name: 'Détail de l’action' }).fill(`${DETAIL} (fenêtre B)`);
  await db.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(db.getByText(/modifiée entre-temps/)).toBeVisible();
  await b.page.reload();
  await expect(b.page.getByText(`${DETAIL} (fenêtre A)`).first()).toBeVisible();
  await a.context.close();
  await b.context.close();
});
