import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { asRole, consoleErrors } from './helpers';

// Paquet 14 (QUA-08) — ergonomie des écrans : matrice G × P filtrante et familles de dangers (DUE-16, DUE-18),
// « Nouvel événement » prérempli depuis un contrôle (EVT-24), filtres et fiche entreprise de la prévention (PRV-14),
// filtres de la veille (VEI-13), référentiel ouvert par lien profond (AUD-19), filtre par titre et réordonnancement des
// titres (HAB-15, HAB-16), aide en ligne (UX-16) ; contrôle axe-core des vues nouvelles.

const axeSource = readFileSync(path.join(process.cwd(), 'node_modules/axe-core/axe.min.js'), 'utf8');
async function axeViolations(page: Page) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return r.violations.map((v) => `${v.id} (${v.impact}) : ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  });
}

test('DUERP : une case de la matrice filtre les risques ; familles de dangers proposées', async ({ page, context, baseURL }) => {
  const errors = consoleErrors(page);
  await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
  await page.goto('/risques');
  const matrix = page.getByRole('table', { name: /Matrice de la cotation brute/ });
  await expect(matrix.getByRole('rowheader', { name: /G4/ })).toBeVisible();
  const cell = matrix.getByRole('link').first();
  const n = Number((await cell.textContent())!.trim());
  await cell.click();
  await expect(page).toHaveURL(/gravite=\d&probabilite=\d/);
  await expect(page.getByRole('link', { name: /^Brut G\d × P\d/ })).toBeVisible();
  const risks = page.getByRole('table').filter({ hasText: 'Situation dangereuse' });
  await expect(risks.getByRole('button', { name: /ouvrir la fiche du risque/ })).toHaveCount(n);
  await page.getByRole('link', { name: /^Brut G\d × P\d/ }).click();
  await expect(page).not.toHaveURL(/gravite=/);
  // Le danger est un bouton nommé qui ouvre la fiche du risque.
  await risks.getByRole('button', { name: /ouvrir la fiche du risque/ }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Ajouter un risque' }).click();
  const dialog = page.getByRole('dialog');
  const list = await dialog.getByRole('combobox', { name: 'Danger' }).getAttribute('list');
  expect(await page.locator(`datalist[id="${list}"] option`).count()).toBeGreaterThan(15);
  await expect(page.locator(`datalist[id="${list}"] option[value="Chute de hauteur"]`)).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('Chef de service : « Signaler un événement » depuis un contrôle ouvre le formulaire prérempli', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Chef de service', 'ville-a');
  await page.goto('/veille?onglet=controles');
  await page.getByRole('table').first().getByRole('row').nth(1).click();
  const fiche = page.getByRole('dialog');
  await fiche.getByRole('link', { name: 'Signaler un événement' }).click();
  await expect(page).toHaveURL(/\/evenements\?nouveau=1&controle=\d+/);
  const dialog = page.getByRole('dialog', { name: 'Nouvel événement' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Équipement contrôlé (contrôle périodique)')).not.toHaveValue('');
  await expect(dialog.getByLabel('Équipement', { exact: true })).not.toHaveValue('');
});

test('Prévention : filtre par entreprise, fiche de l’entreprise ouverte depuis un plan', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Chef de service', 'ville-a');
  await page.goto('/prevention?plan=PP-2025-041');
  const dialog = page.getByRole('dialog');
  const company = dialog.getByRole('link').filter({ hasText: /\S/ }).and(dialog.locator('a[href*="onglet=entreprises"]'));
  const name = (await company.textContent())!.trim();
  await company.click();
  await expect(page).toHaveURL(/onglet=entreprises&entreprise=/);
  await expect(page.getByRole('dialog', { name })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/entreprise=/);
  await page.goto('/prevention?filtre=tous');
  await page.getByText('Filtres', { exact: true }).click();
  const select = page.getByRole('combobox', { name: 'Entreprise extérieure' });
  await select.selectOption({ label: name });
  await page.getByRole('button', { name: 'Filtrer' }).click();
  await expect(page).toHaveURL(/entreprise=/);
  await expect(page.getByRole('link', { name: `Entreprise extérieure : ${name} : retirer ce filtre` })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test('Veille : recherche et tri par échéance portés par l’URL', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
  await page.goto('/veille');
  await page.getByText('Filtres', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Tri' }).selectOption({ label: 'Échéance la plus proche' });
  await page.getByRole('button', { name: 'Filtrer' }).click();
  await expect(page).toHaveURL(/tri=echeance/);
  await page.goto('/veille?q=zzzz-introuvable');
  await expect(page.getByText('Aucune exigence ne correspond aux filtres.')).toBeVisible();
  await page.goto('/veille?onglet=controles&q=pont');
  await expect(page.getByRole('cell', { name: /Pont roulant/ }).first()).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test('Audits : un référentiel s’ouvre par lien profond ; inconnu, bandeau commun', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'all');
  await page.goto('/audits?referentiel=iso9001');
  await expect(page.getByRole('dialog', { name: /Modifier ISO 9001/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/referentiel=/);
  await page.goto('/audits?referentiel=inconnu');
  await expect(page.getByText('Référentiel introuvable ou hors du site sélectionné.')).toBeVisible();
});

test('Habilitations : filtre par titre suivi et réordonnancement des colonnes', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'all');
  await page.goto('/habilitations');
  const headers = page.locator('table.vg-sticky-table thead th');
  const before = await headers.allTextContents();
  await page.getByLabel('Titre suivi').selectOption({ index: 1 });
  await expect(page).toHaveURL(/habilitation=/);
  await expect(headers).toHaveCount(2);
  await page.reload();
  await expect(headers).toHaveCount(2);
  await page.getByLabel('Titre suivi').selectOption({ index: 0 });
  await expect(headers).toHaveCount(before.length);
  // Titres suivis : déplacer le premier titre d'un rang, puis le remettre.
  await page.getByRole('button', { name: 'Titres suivis' }).click();
  const dialog = page.getByRole('dialog');
  const first = before[1].split(' · ')[0];
  await dialog.getByRole('button', { name: `Descendre « ${first} »` }).click();
  await expect(dialog.getByRole('button', { name: `Monter « ${first} »` })).not.toHaveAttribute('aria-disabled', 'true');
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect.poll(async () => (await headers.allTextContents())[2]?.startsWith(first)).toBe(true);
  await page.getByRole('button', { name: 'Titres suivis' }).click();
  await page.getByRole('dialog').getByRole('button', { name: `Monter « ${first} »` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Fermer' }).click();
  await expect.poll(async () => (await headers.allTextContents())[1]?.startsWith(first)).toBe(true);
});

test('Aide en ligne : aide de l’écran et glossaire, au clavier', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Chef de service', 'ville-a');
  await page.goto('/risques');
  const open = page.getByRole('button', { name: 'Aide et glossaire' });
  await open.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Évaluation des risques' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Cet écran' })).toBeVisible();
  await expect(dialog.getByText('TF1', { exact: true })).toBeVisible();
  await dialog.getByRole('searchbox', { name: 'Rechercher dans le glossaire' }).fill('DUERP');
  await expect(dialog.getByText('TF1', { exact: true })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
  // Échap vide d'abord le champ de recherche (comportement natif), puis ferme la fenêtre ; le focus revient au bouton.
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('searchbox', { name: 'Rechercher dans le glossaire' })).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
});

test('Dossier de revue : axe-core vert avec les conteneurs de tableaux (UX-15)', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'all');
  await page.goto('/revue-de-direction');
  await expect(page.locator('.rd-doc h1')).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});
