import { expect, test } from '@playwright/test';
import { asRole, consoleErrors } from './helpers';

// IMP-07 (classe 1, lot A) : fiches imprimables d'un événement et d'une action, ouvertes depuis la fiche, avec les droits
// de la fiche ; données de santé d'un accident du travail pour l'animateur QHSE et la direction seulement.

test('Animateur QHSE : fiche d’un accident du travail imprimable depuis la fiche, données de santé comprises', async ({ page, context, baseURL }) => {
  const errors = consoleErrors(page);
  await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
  await page.goto('/evenements?sel=EV-2026-127');
  const link = page.getByRole('link', { name: 'Imprimer la fiche' });
  await expect(link).toHaveAttribute('href', '/evenements/fiche/EV-2026-127');
  await page.goto('/evenements/fiche/EV-2026-127');
  await expect(page.getByRole('heading', { level: 1, name: /^EV-2026-127 · / })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Imprimer / PDF' })).toBeVisible();
  await expect(page.getByText('Soins médicaux sans arrêt')).toBeVisible();
  await expect(page.getByText('Coupure superficielle · Index gauche')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /Analyse des causes/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /Historique/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Chef de service : même fiche, données de santé restreintes', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Chef de service', 'ville-a');
  await page.goto('/evenements/fiche/EV-2026-127');
  await expect(page.getByRole('heading', { level: 1, name: /EV-2026-127/ })).toBeVisible();
  await expect(page.getByText('Données restreintes')).toBeVisible();
  await expect(page.getByText('Coupure superficielle · Index gauche')).toHaveCount(0);
  await expect(page.getByText('Soins médicaux sans arrêt')).toHaveCount(0);
});

test('Salarié : fiche de son signalement (sans analyse ni pilote), rien d’un collègue', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Salarié', 'all');
  await page.goto('/evenements/fiche/EV-2026-118');
  await expect(page.getByRole('heading', { level: 1, name: /EV-2026-118/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /Suite donnée/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /Analyse des causes/ })).toHaveCount(0);
  await expect(page.getByText('Pilote', { exact: true })).toHaveCount(0);
  await page.goto('/evenements/fiche/EV-2026-127');
  await expect(page.getByText('Élément introuvable ou hors du site sélectionné.')).toBeVisible();
  await expect(page.getByText('Coupure à la main')).toHaveCount(0);
});

test('Plan d’actions : fiche imprimable d’une action, mêmes droits que la fiche', async ({ page, context, baseURL }) => {
  const errors = consoleErrors(page);
  await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
  await page.goto('/actions?action=A-214');
  await expect(page.getByRole('link', { name: 'Imprimer la fiche' })).toHaveAttribute('href', '/actions/fiche/A-214');
  await page.goto('/actions/fiche/A-214');
  await expect(page.getByRole('heading', { level: 1, name: /^A-214 · / })).toBeVisible();
  for (const title of ['Problème', 'Planification', 'Source', 'Fil de l’action', 'Preuves', 'Historique']) {
    await expect(page.getByRole('heading', { level: 2, name: new RegExp(title) })).toBeVisible();
  }
  expect(errors).toEqual([]);
  // Salarié : sa propre action seulement.
  await asRole(context, baseURL!, 'Salarié', 'all');
  await page.goto('/actions/fiche/A-215');
  await expect(page.getByRole('heading', { level: 1, name: /^A-215 · / })).toBeVisible();
  await page.goto('/actions/fiche/A-214');
  await expect(page.getByText('Élément introuvable ou hors du site sélectionné.')).toBeVisible();
});
