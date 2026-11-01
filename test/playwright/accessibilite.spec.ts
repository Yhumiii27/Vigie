import { expect, test, type Page } from '@playwright/test';
import { AXE_SCREENS, asRole, axeViolations } from './helpers';

// Paquet 9 — UX et accessibilité : clavier de la coque (lien d'évitement, menus du site et du rôle), erreurs de formulaire
// (focus sur le premier champ en erreur, message relié), bandeau des liens profonds inconnus, convention d'URL des filtres,
// et contrôle automatique axe-core (WCAG 2.x A et AA) des écrans principaux.

const focused = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null;
  return el ? { id: el.id, tag: el.tagName, text: el.textContent?.trim() ?? '', role: el.getAttribute('role'), invalid: el.getAttribute('aria-invalid'), describedBy: el.getAttribute('aria-describedby') } : null;
});

test.describe('coque au clavier (UX-11)', () => {
  test('lien d’évitement : premier arrêt du clavier, mène au contenu', async ({ page, context, baseURL }) => {
    await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Aller au contenu' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    expect((await focused(page))?.id).toBe('contenu');
    await expect(page.getByRole('main')).toHaveAttribute('id', 'contenu');
    await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: /Tableau de bord/ })).toHaveAttribute('aria-current', 'page');
  });

  test('menu du site : flèches, Échap rend le focus, choix annoncé', async ({ page, context, baseURL }) => {
    await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
    await page.goto('/actions');
    const button = page.getByRole('button', { name: /^Site :/ });
    await expect(button).toHaveAttribute('aria-haspopup', 'menu');
    await button.focus();
    await page.keyboard.press('ArrowDown');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    // Focus sur le site en cours (choix coché).
    const current = await focused(page);
    expect(current?.role).toBe('menuitemradio');
    await expect(menu.getByRole('menuitemradio', { checked: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    expect((await focused(page))?.text).not.toBe(current?.text);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    // Choix au clavier d'un autre site : confirmation annoncée (région status), site affiché dans le bouton.
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    const other = menu.getByRole('menuitemradio', { checked: false }).filter({ hasNotText: 'Tous les sites' }).first();
    const label = (await other.textContent())!.trim();
    await other.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: `Site sélectionné : ${label}.` })).toBeVisible();
    await expect(page.getByRole('button', { name: `Site : ${label}` })).toBeVisible();
  });

  test('menu du rôle (démonstration) : Fin puis Entrée change de rôle', async ({ page, context, baseURL }) => {
    await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
    await page.goto('/');
    const button = page.getByRole('button', { name: /^Changer de rôle/ });
    await button.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Voir en tant que' });
    await expect(menu.getByRole('menuitemradio', { name: 'Animateur QHSE' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitemradio', { name: 'Salarié' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: /^Changer de rôle \(démonstration\) : .*, Salarié$/ })).toBeVisible();
  });
});

test('formulaire : focus sur le premier champ en erreur, message relié (UX-04)', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'ville-a');
  await page.goto('/veille');
  await page.getByRole('button', { name: 'Ajouter une exigence' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle exigence' });
  await dialog.getByRole('button', { name: "Ajouter l'exigence" }).click();
  await expect(dialog.getByRole('alert')).toContainText('Certains champs sont à corriger.');
  const field = dialog.getByRole('textbox', { name: 'Texte', exact: true });
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  const describedBy = await field.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`[id="${describedBy}"]`)).toHaveText('Champ obligatoire.');
});

test.describe('élément introuvable (UX-13)', () => {
  const cases: [string, RegExp][] = [
    ['/veille?exigence=999999', /Exigence introuvable/],
    ['/veille?onglet=controles&controle=999999', /Contrôle introuvable/],
    ['/documents?doc=XX-INCONNU-9', /Document introuvable/],
    ['/audits?element=999999', /Élément du programme d'audit introuvable/],
    ['/audits?constat=999999', /Constat d'audit introuvable/],
    ['/audits?revue=999999', /Revue de direction introuvable/],
    ['/audits/contributions?revue=999999', /Revue introuvable ou sans contribution/],
    ['/revue-de-direction?revue=999999', /Revue introuvable/],
    ['/apercu-mobile?vue=mes-signalements&sel=EV-0000-000', /Signalement introuvable/],
    ['/evenements?sel=EV-0000-000', /Événement introuvable/],
  ];
  for (const [url, text] of cases) {
    test(url, async ({ page, context, baseURL }) => {
      await asRole(context, baseURL!, 'Animateur QHSE', 'all');
      await page.goto(url);
      await expect(page.getByRole('status').filter({ hasText: text })).toBeVisible();
    });
  }

  test('Salarié : document d’autrui ou inexistant, même bandeau', async ({ page, context, baseURL }) => {
    await asRole(context, baseURL!, 'Salarié', 'all');
    await page.goto('/documents?doc=XX-INCONNU-9');
    await expect(page.getByRole('status').filter({ hasText: /Document introuvable/ })).toBeVisible();
  });
});

test.describe('convention d’URL (UX-12)', () => {
  test('veille : ancien ?archives=1 réécrit en ?etat=archives', async ({ page, context, baseURL }) => {
    await asRole(context, baseURL!, 'Animateur QHSE', 'all');
    await page.goto('/veille?archives=1');
    await expect(page).toHaveURL(/\/veille\?etat=archives$/);
    await page.goto('/veille?onglet=controles&statut=archives');
    await expect(page).toHaveURL(/\/veille\?onglet=controles&etat=archives$/);
  });

  test('habilitations : filtres portés par l’URL, rétablis au rechargement', async ({ page, context, baseURL }) => {
    await asRole(context, baseURL!, 'Chef de service', 'ville-a');
    await page.goto('/habilitations');
    await page.getByRole('button', { name: /^À traiter/ }).click();
    await expect(page).toHaveURL(/etat=a-traiter/);
    await page.getByRole('searchbox', { name: 'Rechercher un salarié' }).fill('mont');
    await expect(page).toHaveURL(/q=mont/);
    await page.reload();
    await expect(page.getByRole('button', { name: /^À traiter/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('searchbox', { name: 'Rechercher un salarié' })).toHaveValue('mont');
  });

  test('documents : fiche ouverte dans l’URL, « Précédent » la ferme', async ({ page, context, baseURL }) => {
    await asRole(context, baseURL!, 'Animateur QHSE', 'all');
    await page.goto('/documents');
    const first = page.getByRole('table').first().getByRole('row').nth(1).getByRole('button').first();
    const ref = (await first.textContent())!.trim();
    await first.click();
    await expect(page).toHaveURL(new RegExp(`[?&]doc=${ref}`));
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goBack();
    await expect(page).not.toHaveURL(/doc=/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

// Contrôle automatique axe-core (dépendance de développement, injectée dans la page : la CSP à nonce est contournée pour
// ce seul parcours). Règles WCAG 2.0 / 2.1 / 2.2 niveaux A et AA. QUA-16 : tous les écrans et leurs vues principales, par
// rôle (AXE_SCREENS), sur bureau et sur tablette ; téléphone : accessibilite.mobile.spec.ts.
for (const [size, viewport] of [['bureau', null], ['tablette', { width: 820, height: 1180 }]] as const) {
  test.describe(`axe-core (WCAG A et AA) · ${size}`, () => {
    test.use({ bypassCSP: true, ...(viewport ? { viewport } : {}) });
    for (const { role, site, url } of AXE_SCREENS) {
      test(`${role} · ${url}`, async ({ page, context, baseURL }) => {
        await asRole(context, baseURL!, role, site);
        await page.goto(url);
        await expect(page.locator('main, body').first()).toBeVisible();
        await page.waitForLoadState('networkidle');
        expect(await axeViolations(page)).toEqual([]);
      });
    }
  });
}
