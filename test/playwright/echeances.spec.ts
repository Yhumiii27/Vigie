import { expect, test } from '@playwright/test';
import { asRole, consoleErrors } from './helpers';

// Échéances et tableau de bord (paquet 11) : titres d'onglet (TDB-17), échéance ouverte depuis la page À faire marquée lue
// (TDB-11), site indiqué en vue « Tous les sites » (TDB-15).

test('titres d’onglet du tableau de bord et de la page À faire (TDB-17)', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
  await page.goto('/');
  await expect(page).toHaveTitle('Tableau de bord QHSE · Vigie');
  await page.goto('/a-faire');
  await expect(page).toHaveTitle('À faire · Vigie');
});

test('échéance ouverte depuis À faire : marquée lue (TDB-11)', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Direction', 'ville-a');
  const errors = consoleErrors(page);
  await page.goto('/a-faire');
  const unread = page.locator('a.vg-row', { has: page.locator('.vg-unread') }).first();
  await expect(unread).toBeVisible();
  const text = (await unread.innerText()).trim();
  const href = await unread.getAttribute('href');
  await unread.click();
  await expect(page).not.toHaveURL(/\/a-faire/);
  expect(href).toBeTruthy();
  await page.goto('/a-faire');
  const row = page.locator('a.vg-row').filter({ hasText: text.split('\n').find((l) => l.length > 20) ?? text }).first();
  await expect(row).toBeVisible();
  await expect(row.locator('.vg-unread')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('vue « Tous les sites » : site des échéances et des derniers signalements (TDB-15)', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'all');
  await page.goto('/a-faire');
  await expect(page.locator('a.vg-row, div.vg-row').filter({ hasText: 'Site de [Ville B]' }).first()).toBeVisible();
  await page.goto('/');
  const table = page.getByRole('table').filter({ has: page.getByRole('row', { name: /Intitulé Site Lieu/ }) });
  await expect(table).toBeVisible();
  await expect(table.getByRole('cell', { name: /^Site de \[Ville [AB]\]$/ }).first()).toBeVisible();
});
