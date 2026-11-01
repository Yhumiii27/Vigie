import { expect, test, type Page } from '@playwright/test';
import { asRole } from './helpers';

// QUA-21 : liste des événements paginée (?page=, ?taille=) sans casser les liens profonds (?sel=), les filtres (EVT-13) ni
// les onglets ; changement d'onglet ou de filtre : première page, taille gardée.

const rowIds = (page: Page) => page.locator('.vg-md-list a.vg-row > div:first-child > span:first-child').allTextContents();

test('pages de 10 : suivante, lien profond vers une fiche de la page 2, filtre et onglet', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'all');
  await page.goto('/evenements?etat=tous&taille=10');
  const nav = page.getByRole('navigation', { name: 'Pages des événements' });
  await expect(nav).toContainText(/1–10 sur \d+/);
  await expect(nav.getByText('Page 1 sur', { exact: false })).toBeVisible();
  const first = await rowIds(page);
  expect(first).toHaveLength(10);

  await nav.getByRole('link', { name: 'Suivant' }).click();
  await expect(page).toHaveURL(/[?&]page=2/);
  await expect(page).toHaveURL(/[?&]taille=10/);
  await expect(nav.getByText('Page 2 sur', { exact: false })).toBeVisible();
  const second = await rowIds(page);
  expect(second.length).toBeGreaterThan(0);
  expect(second.some((id) => first.includes(id))).toBe(false);

  // Lien profond sans ?page= (échéance, notification) : la page qui contient la fiche, fiche sélectionnée.
  const target = second[0];
  await page.goto(`/evenements?etat=tous&taille=10&sel=${target}`);
  await expect(nav.getByText('Page 2 sur', { exact: false })).toBeVisible();
  await expect(page.locator('.vg-md-list a.vg-row.is-on')).toContainText(target);
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();

  // Fiche choisie dans la page : page gardée dans l'URL.
  await page.locator('.vg-md-list a.vg-row').nth(1).click();
  await expect(page).toHaveURL(/[?&]page=2/);

  // Filtre de type : retour à la première page, taille gardée.
  await page.locator('.vg-md-list a.vg-chip').filter({ hasText: /^Tous/ }).first().click();
  await expect(page).not.toHaveURL(/[?&]page=/);
  await expect(page).toHaveURL(/[?&]taille=10/);
  // Onglet : idem.
  await page.getByRole('radio', { name: /^Ouverts/ }).click();
  await expect(page).not.toHaveURL(/[?&]page=/);
});

test('page au-delà de la dernière : la dernière ; taille inconnue : 25', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'all');
  await page.goto('/evenements?etat=tous&taille=10&page=99');
  const nav = page.getByRole('navigation', { name: 'Pages des événements' });
  const text = (await nav.textContent()) ?? '';
  const [, current, total] = /Page (\d+) sur (\d+)/.exec(text) ?? [];
  expect(current).toBe(total);
  await nav.getByRole('link', { name: '25' }).click();
  await expect(page).not.toHaveURL(/taille=/);
});
