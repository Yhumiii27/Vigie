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
    '/risques?vue=ensemble', '/risques?vue=urgences', '/risques?vue=etudes', '/risques?vue=etudes&etude=ES-002', '/veille', '/veille?onglet=controles', '/veille?onglet=registre', '/documents',
    // Lot 4 de M-02 : fiche d'un document lu dans Codex (révisions, circuit en cours).
    '/documents?doc=PRO-HSE-0001',
    // Lot 5 de M-02 (D12) : modifications techniques, fiche d'un ordre et d'une demande.
    '/modifications-techniques', '/modifications-techniques?sel=ECO-2026-001', '/modifications-techniques?onglet=demandes&sel=ECR-2026-001',
    '/habilitations', '/habilitations?vue=a-prevoir', '/habilitations?vue=personnel', '/audits', '/environnement', '/environnement?onglet=filieres', '/prevention',
    '/prevention?onglet=permis', '/prevention?onglet=entreprises', '/prevention?vue=poste-de-garde', '/prevention/poste-de-garde/imprimer', '/prevention/carte', '/prevention/import', '/signaler/postes',
    '/evenements/registre-benin?site=site_a', '/habilitations/donnees-personnelles?salarie=tnguyen', '/veille/registre-securite',
    // IMP-07 : fiches imprimables d'un événement (accident du travail) et d'une action.
    '/evenements/fiche/EV-2026-127', '/actions/fiche/A-214',
    // Paquet R2 (réponses du 09/11/2026) : recherche globale, registre des DGI, causeries sécurité, intervenants d'un plan.
    '/recherche?q=mezzanine', '/evenements/registre-dgi?site=site_a', '/evenements/registre-dgi/imprimer?site=site_a',
    '/prevention?vue=causeries', '/prevention?vue=causeries&causerie=CS-002', '/prevention/imprimer/causerie/CS-002', '/prevention?plan=PP-2026-015',
    // Paquet R3 (réponses du 09/11/2026) : auto-évaluation ISO, consignations d'un permis, opérations simultanées.
    '/audits?vue=auto-evaluation', '/audits?vue=auto-evaluation&campagne=AE-002', '/audits/auto-evaluation/imprimer/AE-002',
    '/prevention?onglet=permis&permis=PF-2026-030', '/prevention?vue=simops', '/prevention/imprimer/permis/PF-2026-030',
  ].map((url) => ({ role: 'Animateur QHSE' as Role, site: 'site_a', url })),
  // PRV-24 : carte des sites du tableau de bord sous « Tous les sites ».
  ...['/', '/revue-de-direction', '/audits', '/risques/bilan-ssct', '/audits?vue=auto-evaluation&campagne=AE-001'].map((url) => ({ role: 'Direction' as Role, site: 'all', url })),
  ...['/', '/evenements', '/actions', '/habilitations', '/veille', '/documents', '/audits', '/evenements/fiche/EV-2026-127', '/audits?vue=auto-evaluation&campagne=AE-002', '/prevention?vue=simops'].map((url) => ({ role: 'Chef de service' as Role, site: 'site_a', url })),
  ...['/', '/prevention', '/prevention?vue=poste-de-garde', '/prevention?vue=causeries', '/risques', '/risques?vue=etudes', '/modifications-techniques?sel=ECO-2026-001', '/recherche?q=EV-2026'].map((url) => ({ role: 'Chef de projet' as Role, site: 'site_a', url })),
  ...['/evenements', '/actions', '/risques', '/habilitations', '/documents', '/signaler', '/signaler/mes-signalements', '/evenements/fiche/EV-2026-118', '/actions/fiche/A-215',
    // EVT-22 : espace salarié mobile.
    '/signaler/mon-espace',
    // Paquet R2 : recherche ; registre des DGI (membre du CSE de la démonstration).
    '/recherche?q=EV-2026', '/evenements/registre-dgi?site=site_a']
    .map((url) => ({ role: 'Salarié' as Role, site: 'all', url })),
];
