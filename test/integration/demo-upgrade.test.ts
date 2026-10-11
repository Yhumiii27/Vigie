import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieJar } from '../next-mocks';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, schema as t } from '@/db';
import { resetConfig } from '@/lib/env';

// Base de démonstration remplie avant la migration 0003 (`.data/vigie` de `npm run dev` et de l'application Mac) :
// responsable QHSE des sites, dernier rôle connu et e-mail vides. À la réouverture, seed() les complète une seule fois.
// Base PGlite sur disque (dossier temporaire) pour une vraie réouverture ; PostgreSQL avec TEST_DATABASE_URL.

const dir = mkdtempSync(path.join(tmpdir(), 'vigie-test-upgrade-'));

beforeAll(async () => {
  Object.assign(process.env, {
    VIGIE_DEMO: '1', VIGIE_TODAY: '2026-10-09', VIGIE_DATA_DIR: path.join(dir, 'vigie'),
    VIGIE_UPLOAD_DIR: path.join(dir, 'uploads'), VIGIE_BACKUP_DIR: path.join(dir, 'backups'),
  });
  resetConfig();
  cookieJar.clear();
  await closeDb();
  await getDb();
});
afterAll(async () => {
  cookieJar.clear();
  await closeDb();
  delete process.env.VIGIE_UPLOAD_DIR;
  delete process.env.VIGIE_BACKUP_DIR;
  process.env.VIGIE_DATA_DIR = 'memory://';
  resetConfig();
  rmSync(dir, { recursive: true, force: true });
});

async function reopen() {
  await closeDb();
  await getDb();
}

describe('mise à niveau d’une base de démonstration antérieure', () => {
  it('responsables QHSE, derniers rôles et e-mails complétés à la réouverture', async () => {
    const { loadQhseLeads } = await import('@/lib/data/leads');
    const db = await getDb();
    // État d'une base remplie par une version antérieure, après la migration 0003 : colonnes ajoutées vides.
    await db.update(t.sites).set({ qhseLeadId: null });
    await db.update(t.people).set({ lastRole: null, email: null });
    expect((await loadQhseLeads()).forSite('ville-a')).toMatchObject({ ownerIds: [], vacant: true });

    await reopen();
    const leads = await loadQhseLeads();
    expect(leads.forSite('ville-a')).toEqual({ ownerIds: ['clefevre'], who: '[C. Lefèvre]', vacant: false });
    expect(leads.forSite('ville-b')).toMatchObject({ ownerIds: ['clefevre'], vacant: false });
    expect(leads.directors.map((p) => p.id)).toEqual(['hmarchand']);
    expect(leads.approvers.map((p) => p.id)).toEqual(['clefevre', 'hmarchand']);
    const [lead] = await (await getDb()).select({ email: t.people.email }).from(t.people).where(eq(t.people.id, 'clefevre'));
    expect(lead.email).toBe('c.lefevre@epc2i.example');
  });

  it('choix ultérieur (« Gérer les sites ») conservé aux réouvertures suivantes', async () => {
    const { loadQhseLeads } = await import('@/lib/data/leads');
    await (await getDb()).update(t.sites).set({ qhseLeadId: null });
    await reopen();
    expect((await loadQhseLeads()).forSite('ville-a')).toMatchObject({ vacant: true });
  });
});
