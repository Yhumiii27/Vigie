import { expect, test } from '@playwright/test';
import { asRole, consoleErrors } from './helpers';

// D12 (lot 5 de M-02, décision CV-06) : modifications techniques — lien profond d'un autre outil, décision d'une demande de
// Codex, approbation par l'approbateur désigné (chef de projet), « Raise ECO » de Keystone.

test('Animateur QHSE : lien de Codex vers une demande, décision ; nouvel ordre depuis Keystone prérempli', async ({ page, context, baseURL }) => {
  const errors = consoleErrors(page);
  await asRole(context, baseURL!, 'Animateur QHSE', 'all');
  await page.goto('/modifications-techniques/ECR-2026-001');
  await expect(page).toHaveURL(/onglet=demandes&sel=ECR-2026-001/);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Intégrer le circuit de validation des ordres de modification')).toBeVisible();
  await dialog.getByRole('button', { name: 'Décider' }).click();
  const decision = page.getByRole('dialog', { name: /Décision sur ECR-2026-001/ });
  await decision.getByLabel('Note de décision').fill('Validé en revue documentaire.');
  await decision.getByRole('button', { name: 'Enregistrer la décision' }).click();
  await expect(dialog.getByText('Décision enregistrée.')).toBeVisible();
  await expect(dialog.getByText('Acceptée').first()).toBeVisible();
  await expect(dialog.getByText('À envoyer').first()).toBeVisible();
  await page.goto('/modifications-techniques/nouvelle?part=JNT-MAL-012&project=K-2025-042&title=Joint%20de%20cuve&source=keystone');
  const form = page.getByRole('dialog', { name: 'Nouvel ordre de modification' });
  await expect(form.getByLabel('Intitulé')).toHaveValue('Joint de cuve');
  await expect(form.getByLabel('Articles (Keystone)')).toHaveValue('JNT-MAL-012');
  await form.getByRole('button', { name: 'Créer l’ordre' }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole('button', { name: /ECO-2026-00\d/ }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('Chef de projet : consultation, décision de sa propre clé seulement', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Chef de projet', 'site_a');
  await page.goto('/modifications-techniques/ECO-2026-001');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Chefs des projets visés')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Modifier' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Décider' })).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Décider' }).click();
  const decide = page.getByRole('dialog', { name: /Chefs des projets visés/ });
  await decide.getByLabel('Commentaire').fill('OK pour K-2025-077.');
  await decide.getByRole('button', { name: 'Enregistrer la décision' }).click();
  await expect(dialog.getByText('Décision « Chefs des projets visés » enregistrée.')).toBeVisible();
  await asRole(context, baseURL!, 'Salarié', 'all');
  await page.goto('/modifications-techniques');
  await expect(page).toHaveURL(/\/evenements/);
});
