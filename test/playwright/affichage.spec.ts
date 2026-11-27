import { expect, test } from '@playwright/test';
import { asRole } from './helpers';

// Norma 2.1 (COQUE.md § 4) : FR / EN au-dessus de sombre / clair, empilés, de même taille, dernier élément de l'en-tête de
// page (barre supérieure ≤ 1024 px) ; cookie atrium-theme (Norma 3.0) relu par le serveur qui pose data-theme sur <html> au rendu (pas
// de flash), sombre par défaut ; cookie vigie-lang pour la langue (VG-N01).

test('affichage sombre par défaut, clair par le bouton, gardé au rechargement', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'site_a');
  await page.goto('/');
  await page.waitForLoadState('networkidle'); // bouton hydraté
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  const group = page.locator('.coque-header').getByRole('group', { name: 'Affichage' });
  await expect(group.getByRole('button', { name: 'Affichage sombre' })).toHaveAttribute('aria-pressed', 'true');

  await group.getByRole('button', { name: 'Affichage clair' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  const cookie = (await context.cookies()).find((c) => c.name === 'atrium-theme');
  expect(cookie?.value).toBe('light');
  expect(cookie?.path).toBe('/');

  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(group.getByRole('button', { name: 'Affichage clair' })).toHaveAttribute('aria-pressed', 'true');

  await group.getByRole('button', { name: 'Affichage sombre' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
});

test('langue au-dessus de l’affichage, même taille, dernier élément de l’en-tête', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'site_a');
  await page.goto('/');
  const pair = page.locator('.coque-header > .coque-prefs');
  await expect(pair).toBeVisible();
  expect(await pair.evaluate((el) => el.parentElement!.lastElementChild === el)).toBe(true);
  const [lang, theme] = await pair.locator('.coque-pref').evaluateAll((els) => els.map((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, label: e.getAttribute('aria-label') };
  }));
  expect(lang.label).toBe('Langue');
  expect(theme.label).toBe('Affichage');
  expect(lang.y).toBeLessThan(theme.y);
  expect([lang.x, lang.w, lang.h]).toEqual([theme.x, theme.w, theme.h]);
});

// VG-N01 : français par défaut ; EN rend la coque (barre latérale, navigation, en-tête) en anglais, cookie vigie-lang relu
// par le serveur ; FR ramène le français. Les identifiants de route restent en français.
test('français par défaut, anglais par le sélecteur FR / EN, gardé au rechargement', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'site_a');
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', 'fr');
  const header = page.locator('.coque-header');
  const langs = header.getByRole('group', { name: 'Langue' });
  await expect(langs.getByRole('button', { name: 'FR' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Tableau de bord' })).toBeVisible();

  await langs.getByRole('button', { name: 'EN' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await expect(html).toHaveAttribute('lang', 'en');
  expect((await context.cookies()).find((c) => c.name === 'vigie-lang')?.value).toBe('en');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Action plan' })).toHaveAttribute('href', '/actions');

  await page.locator('.coque-header').getByRole('group', { name: 'Language' }).getByRole('button', { name: 'FR' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
});

// VG-N07 : ⌘K / Ctrl+K place le curseur dans la recherche de pages, sous la marque ; Entrée ouvre la première page trouvée.
test('recherche de pages ⌘K', async ({ page, context, baseURL }) => {
  await asRole(context, baseURL!, 'Animateur QHSE', 'site_a');
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('textbox', { name: 'Aller à une page…' });
  await expect(input).toBeFocused();
  await input.fill('veille');
  await expect(page.locator('.coque-side').getByRole('link', { name: /Veille et contrôles/ })).toBeVisible();
  await input.press('Enter');
  await expect(page).toHaveURL(/\/veille$/);
});
