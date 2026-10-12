import { describe, expect, it } from 'vitest';

// Cloisonnement du rôle Salarié dans la charge envoyée au navigateur (QUA-06) : pages rendues par le serveur construit,
// en HTML (premier affichage, charge RSC incluse) et en RSC seul (navigation côté client). Les chargements sont
// testés à part (test/integration/employee-isolation.test.ts) ; ici, ce que les pages transmettent réellement,
// composants client compris (listes de choix, données de formulaires…).
//
// Serveur de démonstration construit, date figée :
//   VIGIE_DEMO=1 npm run build && VIGIE_TODAY=2026-10-09 npm run start:demo
//   VIGIE_E2E_URL=http://localhost:3200 npx vitest run test/e2e
// Sans VIGIE_E2E_URL, ce fichier est ignoré (npm test).

const base = process.env.VIGIE_E2E_URL;

// Salarié de démonstration : [T. Nguyen] (tnguyen), tous sites.
const COOKIE = `vigie_role=${encodeURIComponent('Salarié')}; vigie_site=all`;
/** Signalements nominatifs de [T. Nguyen] dans le jeu de démonstration. */
const OWN_EVENTS = ['EV-2026-112', 'EV-2026-118', 'EV-2026-123', 'EV-2026-124', 'EV-2026-131', 'EV-2026-133'];
/** Actions dont il est pilote. */
const OWN_ACTIONS = ['A-215'];
/** Salariés dont aucune donnée ne le concerne (ni pilote de ses signalements, ni responsable QHSE de son site). */
const OTHER_PEOPLE = ['[M. Girard]', '[P. Roux]', '[A. Martin]', '[J. Petit]', '[R. Fontaine]', '[K. Bernard]', '[Y. Lambert]'];

/**
 * Réponse d'une page pour le Salarié. Seule la redirection technique d'une requête RSC (paramètre `_rsc`, même page) est
 * suivie : une redirection vers un autre écran (écran fermé au rôle) est renvoyée telle quelle, avec son corps.
 */
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
    return { status: res.status, location, body: await res.text() };
  }
}
const found = (body: string, re: RegExp) => [...new Set(body.match(re) ?? [])].sort();
const EVENT_REF = /EV-\d{4}-\d{3}/g;
const ACTION_REF = /\bA-\d{3}\b/g;
const PREVENTION_REF = /\bP[PFE]-\d{4}-\d{3}\b/g;

describe.skipIf(!base)('Salarié : charge des pages (serveur construit)', () => {
  describe.each([['HTML', false], ['RSC', true]] as const)('%s', (_mode, rsc) => {
    it('signalements : les siens seulement, sur tous les onglets', async () => {
      for (const path of ['/evenements', '/evenements?etat=tous', '/evenements?etat=classes', '/signaler/mes-signalements']) {
        const { status, body } = await load(path, rsc);
        expect(status, path).toBe(200);
        expect(found(body, EVENT_REF).filter((id) => !OWN_EVENTS.includes(id)), path).toEqual([]);
        OTHER_PEOPLE.forEach((name) => expect(body, `${path} ${name}`).not.toContain(name));
      }
    });

    it('lien direct vers le signalement d’un autre : ni titre ni description', async () => {
      for (const path of ['/evenements?sel=EV-2026-130', '/signaler/mes-signalements/EV-2026-130', '/evenements?sel=EV-2026-119']) {
        const { body } = await load(path, rsc);
        expect(body, path).not.toContain('Cotes hors tolérance');
        expect(body, path).not.toContain('Ø45 h7 mesuré');
        expect(body, path).not.toContain('Entorse en descendant'); // accident d'un collègue, données de santé
      }
    });

    it('plan d’actions : les actions dont il est pilote', async () => {
      for (const path of ['/actions', '/actions?etat=historique', '/actions?etat=annulees', '/actions?action=A-214']) {
        const { status, body } = await load(path, rsc);
        expect(status, path).toBe(200);
        expect(found(body, ACTION_REF).filter((id) => !OWN_ACTIONS.includes(id) && !path.endsWith(id)), path).toEqual([]);
        expect(body, path).not.toContain('Remplacer les élingues textiles'); // A-214, même événement, autre pilote
        OTHER_PEOPLE.forEach((name) => expect(body, `${path} ${name}`).not.toContain(name));
      }
    });

    it('habilitations, À faire : sa ligne et ses échéances', async () => {
      for (const path of ['/habilitations', '/habilitations?salarie=mgirard&titre=elec', '/a-faire']) {
        const { status, body } = await load(path, rsc);
        expect(status, path).toBe(200);
        OTHER_PEOPLE.forEach((name) => expect(body, `${path} ${name}`).not.toContain(name));
        expect(body, path).not.toMatch(/\\?"(mgirard|proux|amartin|jpetit|rfontaine|kbernard|ylambert)\\?"/);
        expect(found(body, EVENT_REF).filter((id) => !OWN_EVENTS.includes(id)), path).toEqual([]);
      }
    });

    it('documents en consultation : ni liste du personnel ni données de formulaire', async () => {
      const { status, body } = await load('/documents', rsc);
      expect(status).toBe(200);
      // Guillemets échappés dans le HTML (charge RSC dans un script), bruts en RSC.
      expect(body).not.toMatch(/\[\\?"kbernard\\?",\\?"\[K\. Bernard\]/);
      expect(body).not.toMatch(/\\?"people\\?":\[\[/);
    });

    it('écrans fermés au Salarié : renvoi vers son écran, aucune donnée métier transmise', async () => {
      // /risques est ouvert à tous en consultation (DUE-01) : cas « DUERP en consultation » (domaine risques).
      for (const path of [
        '/', '/prevention', '/prevention/carte', '/veille', '/audits', '/environnement', '/revue-de-direction',
        '/prevention/imprimer/permis', '/prevention/imprimer/permis/PF-2026-031', '/prevention/imprimer/plan/PP-2026-013',
      ]) {
        const { status, location, body } = await load(path, rsc);
        // Renvoi par une redirection HTTP, ou dans la page déjà commencée (contrôle du rôle pendant le rendu, SEC-14).
        expect(status === 307 ? location : body, path).toContain('/evenements');
        expect(found(body, EVENT_REF), path).toEqual([]);
        expect(found(body, ACTION_REF), path).toEqual([]);
        expect(found(body, PREVENTION_REF), path).toEqual([]);
        OTHER_PEOPLE.forEach((name) => expect(body, `${path} ${name}`).not.toContain(name));
      }
    });

    it('registre des accidents bénins (données de santé, EVT-04) : renvoi vers les événements, aucune inscription transmise', async () => {
      const path = '/evenements/registre-benin?site=ville-a';
      const { status, location, body } = await load(path, rsc);
      expect(status === 307 ? location : body, path).toContain('/evenements');
      expect(body, path).not.toContain('Registre des accidents du travail bénins');
      expect(body, path).not.toMatch(/Pincement|Majeur droit|Rinçage oculaire|Secouristes du travail/);
      expect(found(body, EVENT_REF), path).toEqual([]);
    });
  });
});
