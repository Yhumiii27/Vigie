import { expect, test } from '@playwright/test';
import { asRole, consoleErrors } from './helpers';

// Accès par rôle (QUA-08) : route de santé, tableau de bord de chaque rôle, écrans fermés et pages de santé redirigés
// avant le rendu (src/proxy.ts), aucune erreur dans la console du navigateur (CSP à nonce, hydratation).

test('route de santé : base ouverte, sans détail interne', async ({ request }) => {
  const res = await request.get('/api/sante');
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ statut: 'ok' });
});

for (const role of ['Direction', 'Animateur QHSE', 'Chef de service', 'Chef de projet', 'Salarié'] as const) {
  test(`tableau de bord : ${role}`, async ({ page, context, baseURL }) => {
    await asRole(context, baseURL!, role);
    const errors = consoleErrors(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation').first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('Salarié : registre des accidents bénins (données de santé) refusé, renvoi vers les événements', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Salarié');
  await page.goto('/evenements/registre-benin');
  await expect(page).toHaveURL(/\/evenements$/);
});

test('Salarié : audits fermés, renvoi vers son accueil', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Salarié');
  await page.goto('/audits');
  await expect(page).not.toHaveURL(/\/audits$/);
});

test('Animateur QHSE : registre des accidents bénins ouvert', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
  await page.goto('/evenements/registre-benin');
  await expect(page).toHaveURL(/registre-benin/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
