import { describe, expect, it } from 'vitest';

// DUERP en consultation par le Salarié (DUE-01, QUA-06) : charge des pages /risques réellement transmise au navigateur
// par le serveur construit, en HTML (premier affichage) et en RSC seul (navigation côté client) — ni pilotes des actions,
// ni événements liés, ni historique, ni liste du personnel, ni registre des mises à disposition. Les chargements sont
// testés à part (test/integration/risks.test.ts).
//
// Serveur de démonstration construit, date figée :
//   VIGIE_DEMO=1 npm run build && VIGIE_TODAY=2026-10-09 npm run start:demo
//   VIGIE_E2E_URL=http://localhost:3200 npx vitest run test/e2e
// Sans VIGIE_E2E_URL, ce fichier est ignoré (npm test).

const base = process.env.VIGIE_E2E_URL;

// Salarié de démonstration : [T. Nguyen] (tnguyen), tous sites.
const COOKIE = `vigie_role=${encodeURIComponent('Salarié')}; vigie_site=all`;
/** Signalements nominatifs de [T. Nguyen] dans le jeu de démonstration (notifications de la page). */
const OWN_EVENTS = ['EV-2026-112', 'EV-2026-118', 'EV-2026-123', 'EV-2026-124', 'EV-2026-131', 'EV-2026-133'];
/** Salariés sans lien avec lui : pilotes d'actions du DUERP ([P. Roux], [R. Fontaine], [J. Petit]) compris. */
const OTHER_PEOPLE = ['[M. Girard]', '[P. Roux]', '[A. Martin]', '[J. Petit]', '[R. Fontaine]', '[K. Bernard]', '[Y. Lambert]'];
const EVENT_REF = /EV-\d{4}-\d{3}/g;

/** Réponse d'une page pour le Salarié ; seule la redirection technique d'une requête RSC (même page) est suivie. */
async function load(path: string, rsc: boolean) {
  let url = new URL(path, base);
  for (let hop = 0; ; hop++) {
    const res = await fetch(url, { headers: { cookie: COOKIE, ...(rsc ? { RSC: '1' } : {}) }, redirect: 'manual' });
    const location = res.headers.get('location');
    const next = location ? new URL(location, url) : null;
    if (next && next.pathname === url.pathname && next.searchParams.has('_rsc') && hop < 3) {
      url = next;
      continue;
    }
    return { status: res.status, body: await res.text() };
  }
}
const found = (body: string, re: RegExp) => [...new Set(body.match(re) ?? [])].sort();

describe.skipIf(!base)('Salarié : DUERP en consultation (serveur construit)', () => {
  describe.each([['HTML', false], ['RSC', true]] as const)('%s', (_mode, rsc) => {
    it('écran, programme annuel et impressions : ni pilotes, ni événements liés, ni liste du personnel', async () => {
      const paths = [
        '/risques', '/risques?unite=essais', '/risques?unite=magasin', '/risques?etat=archives', '/risques?registre=1', '/risques?programme=2026',
        '/risques/imprimer', '/risques/imprimer?version=2025.1', '/risques/imprimer/programme?annee=2026',
        // DUE-17 (paquet 13) : vue d'ensemble toutes unités ; CNF-08 : situations d'urgence (consignes, sans responsable
        // ni participants des exercices).
        '/risques?vue=ensemble', '/risques?vue=urgences',
      ];
      for (const path of paths) {
        const { status, body } = await load(path, rsc);
        expect(status, path).toBe(200);
        OTHER_PEOPLE.forEach((name) => expect(body, `${path} ${name}`).not.toContain(name));
        expect(found(body, EVENT_REF).filter((id) => !OWN_EVENTS.includes(id)), path).toEqual([]);
        // Guillemets échappés dans le HTML (charge RSC dans un script), bruts en RSC.
        expect(body, path).not.toMatch(/\\?"people\\?":\[\[/);
        expect(body, path).not.toMatch(/\\?"(mgirard|proux|amartin|jpetit|rfontaine|kbernard|ylambert)\\?"/);
        // Registre des mises à disposition : animateur QHSE et direction seulement (nom d'un ancien salarié).
        expect(body, path).not.toContain('Vasseur');
      }
    });

    it('consultation : actions de prévention du DUERP et mention de mise à disposition', async () => {
      const { body } = await load('/risques', rsc);
      expect(body).toContain('A-214');
      expect(body).toContain('R. 4121-4');
    });
  });

  it('ancien lien ?archives=1 réécrit en ?etat=archives avant le rendu (UX-12, page chargée par le navigateur)', async () => {
    const res = await fetch(new URL('/risques?archives=1', base), { headers: { cookie: COOKIE }, redirect: 'manual' });
    expect([303, 307, 308]).toContain(res.status);
    expect(new URL(res.headers.get('location')!, base).search).toBe('?etat=archives');
  });
});
