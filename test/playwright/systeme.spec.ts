import { expect, test } from '@playwright/test';
import { asRole, consoleErrors } from './helpers';

// Paquet 13, seconde moitié (QUA-08) : audit hors programme (AUD-20) et impression du programme (AUD-26), carte de revue
// (AUD-35), gestion des changements (CNF-11), situations d'urgence (CNF-08), revue documentaire sans modification
// (DOC-15), données d'une personne (SEC-13).

test('Animateur QHSE : audit hors programme, programme imprimable, carte de revue avec perception client', async ({ page, context, baseURL }) => {
  const errors = consoleErrors(page);
  await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
  await page.goto('/audits?annee=2026');
  await page.getByRole('button', { name: 'Audit hors programme' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Libellé court').fill('Client C');
  await dialog.getByLabel('Réalisé le').fill('2026-09-30');
  await dialog.getByLabel('Intitulé détaillé').fill('Audit client [Client C]');
  await dialog.getByRole('button', { name: "Enregistrer l'audit" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: /Client C/ }).first()).toBeVisible();
  await page.goto('/audits/imprimer?annee=2026');
  await expect(page.getByRole('heading', { level: 1, name: "Programme annuel d'audit 2026" })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Audit client \[Client C\]/ })).toBeVisible();
  await page.goto('/audits?revue=1#revue');
  await expect(page.getByText(/Enquête annuelle : 8,1\/10/).first()).toBeVisible();
  await expect(page.getByText(/Recrutement d'un technicien méthodes/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('Direction : demande de changement à évaluer, décision motivée', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Direction', 'ville-a');
  await page.goto('/audits?changement=MC-002');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Réorganisation des allées du magasin').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Décider' }).click();
  await dialog.getByLabel('Justification').fill('Acceptée : travaux pendant l’inventaire.');
  await dialog.getByRole('button', { name: 'Enregistrer la décision' }).click();
  await expect(dialog.getByText('Décision enregistrée.')).toBeVisible();
  await expect(dialog.getByText('Acceptée · à mettre en œuvre').first()).toBeVisible();
});

test('Chef de service : situations d’urgence, exercice tenu ; Salarié : consignes en consultation', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Chef de service', 'ville-a');
  await page.goto('/risques?vue=urgences');
  await expect(page.getByText(/Exercice en retard depuis le/).first()).toBeVisible();
  await page.getByRole('cell', { name: /Déversement de produit chimique/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Enregistrer un exercice' }).click();
  await dialog.getByLabel('Participants').fill('Magasiniers (3)');
  await dialog.getByLabel('Déroulement et enseignements').fill('Kit antipollution en place en 4 min.');
  await dialog.getByRole('button', { name: "Enregistrer l'exercice" }).click();
  await expect(dialog.getByText('Exercice enregistré.')).toBeVisible();
  await asRole(context, baseURL!, 'Salarié', 'ville-a');
  await page.goto('/risques?vue=urgences');
  await expect(page.getByText("Incendie de l'atelier montage").first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Identifier une situation' })).toHaveCount(0);
});

test('Animateur QHSE : revue documentaire sans modification ; données d’une personne', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'all');
  await page.goto('/documents?doc=PR-QHSE-005');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Revue sans modification' }).first().click();
  await dialog.getByLabel('Revu le').fill('2026-10-02');
  await dialog.getByLabel('Conclusion de la revue').fill('Procédure toujours adaptée.');
  await dialog.getByRole('button', { name: 'Enregistrer la revue' }).click();
  await expect(dialog.getByText(/version B maintenue/)).toBeVisible();
  await page.goto('/habilitations/donnees-personnelles?salarie=sbenali');
  await expect(page.getByRole('heading', { level: 1, name: /Données personnelles · \[S\. Benali\]/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /Habilitations et formations/ })).toBeVisible();
  // Encadrement : page réservée (données de santé comprises), renvoi vers l'écran.
  await asRole(context, baseURL!, 'Chef de service', 'ville-a');
  await page.goto('/habilitations/donnees-personnelles?salarie=sbenali');
  await expect(page).not.toHaveURL(/donnees-personnelles/);
});
