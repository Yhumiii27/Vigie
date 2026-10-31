import type { BrowserContext, Page } from '@playwright/test';
import type { Role } from '@/lib/domain';

// Outils des parcours Playwright (QUA-08) : rôle et site de démonstration posés par les cookies du sélecteur de rôle
// (setRole, mode démonstration seulement), date du jeu figée au 09/10/2026 (VIGIE_TODAY).

/** Rôle de démonstration (personne associée : src/lib/demo.ts) et site sélectionné. */
export async function asRole(context: BrowserContext, baseURL: string, role: Role, site = 'all') {
  await context.clearCookies();
  await context.addCookies([
    { name: 'vigie_role', value: encodeURIComponent(role), url: baseURL },
    { name: 'vigie_site', value: site, url: baseURL },
  ]);
}

/** Erreurs de la console du navigateur pendant le parcours (hydratation, CSP, exceptions). */
export function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/**
 * Photo JPEG décodable par le navigateur (dessinée dans la page), avec un segment EXIF ajouté (position GPS fictive) :
 * photo d'un signalement.
 */
export async function jpegWithExif(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 48;
    const g = c.getContext('2d')!;
    g.fillStyle = '#c33';
    g.fillRect(0, 0, 64, 48);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return btoa(String.fromCharCode(...bytes));
  });
  const jpeg = Buffer.from(b64, 'base64');
  const exif = Buffer.from('Exif\0\0GPS 48.8566N 2.3522E', 'latin1');
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff]), exif, jpeg.subarray(2)]);
}

/** Source d'axe-core (dépendance de développement), injectée dans la page par axeViolations. */
let axeSource: string | null = null;
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Contrôle axe-core (WCAG 2.0 / 2.1 / 2.2, niveaux A et AA) de la page affichée : violations « règle (impact) : cibles ».
 * La CSP à nonce bloque le script injecté : le parcours doit être lancé avec `test.use({ bypassCSP: true })`.
 */
export async function axeViolations(page: Page): Promise<string[]> {
  axeSource ??= (await import('node:fs')).readFileSync((await import('node:path')).join(process.cwd(), 'node_modules/axe-core/axe.min.js'), 'utf8');
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async (tags) => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const r = await axe.run(document, { runOnly: { type: 'tag', values: tags } });
    return r.violations.map((v) => `${v.id} (${v.impact}) : ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  }, AXE_TAGS);
}

/**
 * Écrans contrôlés par axe-core (QUA-16) : chaque écran de la navigation et ses vues principales, pour les rôles qui les
 * ouvrent (saisie, consultation seule, Salarié), plus les pages annexes (carte, import, registres, impressions).
 */
export const AXE_SCREENS: { role: Role; site: string; url: string }[] = [
  ...['/', '/a-faire', '/actions', '/actions?vue=kanban', '/actions?vue=statistiques', '/evenements', '/evenements?etat=tous', '/risques',
    '/risques?vue=ensemble', '/risques?vue=urgences', '/veille', '/veille?onglet=controles', '/veille?onglet=registre', '/documents',
    '/habilitations', '/habilitations?vue=a-prevoir', '/audits', '/environnement', '/environnement?onglet=filieres', '/prevention',
    '/prevention?onglet=permis', '/prevention?onglet=entreprises', '/prevention/carte', '/prevention/import', '/signaler/postes',
    '/evenements/registre-benin?site=ville-a', '/habilitations/donnees-personnelles?salarie=tnguyen', '/veille/registre-securite',
    // IMP-07 : fiches imprimables d'un événement (accident du travail) et d'une action.
    '/evenements/fiche/EV-2026-127', '/actions/fiche/A-214',
  ].map((url) => ({ role: 'Animateur QHSE' as Role, site: 'ville-a', url })),
  ...['/revue-de-direction', '/audits', '/risques/bilan-ssct'].map((url) => ({ role: 'Direction' as Role, site: 'all', url })),
  ...['/', '/evenements', '/actions', '/habilitations', '/veille', '/documents', '/audits', '/evenements/fiche/EV-2026-127'].map((url) => ({ role: 'Chef de service' as Role, site: 'ville-a', url })),
  ...['/', '/prevention', '/risques'].map((url) => ({ role: 'Chef de projet' as Role, site: 'ville-a', url })),
  ...['/evenements', '/actions', '/risques', '/habilitations', '/documents', '/signaler', '/signaler/mes-signalements', '/evenements/fiche/EV-2026-118', '/actions/fiche/A-215',
    // EVT-22 : espace salarié mobile.
    '/signaler/mon-espace']
    .map((url) => ({ role: 'Salarié' as Role, site: 'all', url })),
];
