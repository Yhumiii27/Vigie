import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieJar, form } from '../next-mocks';
import { closeDb, getDb, schema as t } from '@/db';
import { resetConfig } from '@/lib/env';

// Démonstration sur PGlite en mémoire : jeu de démonstration, responsables QHSE par site (TDB-01), fiches personne (SEC-03).

// Pièces jointes dans un dossier temporaire : le jeu de démonstration écrit les preuves des actions (src/db/seeds/actions.ts),
// jamais dans le .data/uploads du dépôt.
const uploads = mkdtempSync(path.join(tmpdir(), 'vigie-test-uploads-'));

beforeAll(async () => {
  process.env.VIGIE_DEMO = '1';
  process.env.VIGIE_DATA_DIR = 'memory://';
  process.env.VIGIE_TODAY = '2026-10-09';
  process.env.VIGIE_UPLOAD_DIR = uploads;
  resetConfig();
  await closeDb();
});
afterAll(async () => {
  await closeDb();
  delete process.env.VIGIE_UPLOAD_DIR;
  resetConfig();
  rmSync(uploads, { recursive: true, force: true });
});

describe('démonstration', () => {
  it('session du rôle choisi, responsables QHSE du jeu de démonstration', async () => {
    const { getSession } = await import('@/lib/session');
    const { loadQhseLeads } = await import('@/lib/data/leads');
    const s = await getSession();
    expect(s).toMatchObject({ role: 'Animateur QHSE', demo: true, bootstrap: false, site: { id: 'ville-a' } });
    expect(s.user.id).toBe('clefevre');
    expect(s.user).not.toHaveProperty('entraObjectId');
    const leads = await loadQhseLeads();
    expect(leads.forSite('ville-b')).toEqual({ ownerIds: ['clefevre'], who: '[C. Lefèvre]', vacant: false });
    expect(leads.directors.map((p) => p.id)).toEqual(['hmarchand']);
    cookieJar.set('vigie_role', 'Salarié');
    expect((await getSession()).user.id).toBe('tnguyen');
    cookieJar.delete('vigie_role');
  });

  it('poste vacant : alertes aux animateurs QHSE, « responsable à désigner »', async () => {
    const { saveSite } = await import('@/server/sites');
    const { loadQhseLeads } = await import('@/lib/data/leads');
    const r = await saveSite({}, form({ id: 'ville-b', label: "Site de [Ville B] — zone d'essais", qhseLeadId: '' }));
    expect(r).toMatchObject({ ok: true });
    expect((await loadQhseLeads()).forSite('ville-b')).toEqual({ ownerIds: ['clefevre'], who: 'Responsable QHSE à désigner', vacant: true });
    const db = await getDb();
    const [log] = await db.select().from(t.changeLog).where((await import('drizzle-orm')).eq(t.changeLog.entityId, 'ville-b'));
    expect(log.details).toEqual([{ field: 'Responsable QHSE', from: '[C. Lefèvre]', to: 'à désigner' }]);
    expect(await saveSite({}, form({ id: 'ville-b', label: "Site de [Ville B] — zone d'essais", qhseLeadId: 'inconnu' }))).toMatchObject({ fieldErrors: { qhseLeadId: expect.any(String) } });
    const { loadTodo } = await import('@/lib/data/todo');
    cookieJar.set('vigie_site', 'all');
    const todo = await loadTodo();
    expect(todo.find((x) => x.key === 'site-lead|ville-b')).toMatchObject({ ownerIds: ['clefevre', 'hmarchand'] });
    cookieJar.delete('vigie_site');
  });

  it('fiche personne : identifiant généré, homonyme admis, e-mail et matricule uniques', async () => {
    const { savePerson } = await import('@/server/skills');
    const base = { name: '[T. Nguyen]', job: 'Monteur', service: 'Atelier montage', siteId: 'ville-a' };
    const created = await savePerson({}, form({ ...base, email: 'Autre.Nguyen@epc2i.example', matricule: 'M-001' }));
    expect(created.ok).toBe(true);
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await savePerson({}, form({ ...base, email: 'autre.nguyen@EPC2I.example' }))).toMatchObject({ fieldErrors: { email: expect.any(String) } });
    expect(await savePerson({}, form({ ...base, matricule: 'M-001' }))).toMatchObject({ fieldErrors: { matricule: expect.any(String) } });
  });
});
