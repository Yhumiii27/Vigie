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

  it('lot 2 (migration 0004) : rubriques des AT, registre des accidents bénins, titre SST, mentions du registre des déchets', async () => {
    const db = await getDb();
    // État d'une base remplie avant la migration 0004 : colonnes ajoutées vides, registre vide, intitulés d'origine.
    await db.update(t.events).set({ victimKind: null, victimId: null, circumstances: null, lesionNature: null, title: 'Entorse en descendant de la plateforme PIRL' })
      .where(eq(t.events.id, 'EV-2026-119'));
    await db.update(t.events).set({ victimKind: null, victimId: null, circumstances: null, title: 'Intitulé modifié par un utilisateur' })
      .where(eq(t.events.id, 'EV-2026-127'));
    await db.update(t.events).set({ victimKind: null }).where(eq(t.events.type, 'AT'));
    await db.delete(t.benignAccidents);
    await db.update(t.trainingTitles).set({ firstAid: false });
    await db.update(t.sites).set({ siret: null });
    await db.update(t.wasteStreams).set({ qualification: null, collectorSiret: null, collectorAddress: null, collectorReceipt: null, destinationSiret: null, destinationAddress: null });
    await db.update(t.wasteEntries).set({ qualification: null, destinationSiret: null, destinationAddress: null, transporterSiret: null, transporterAddress: null, transporterReceipt: null });

    await reopen();
    const after = await getDb();
    const [e119] = await after.select().from(t.events).where(eq(t.events.id, 'EV-2026-119'));
    expect(e119).toMatchObject({ victimKind: 'salarie', victimId: 'amartin', lesionNature: 'Entorse', title: 'Chute en descendant de la plateforme PIRL' });
    const [e127] = await after.select().from(t.events).where(eq(t.events.id, 'EV-2026-127'));
    expect(e127).toMatchObject({ victimKind: 'salarie', title: 'Intitulé modifié par un utilisateur' }); // saisie conservée
    expect((await after.select().from(t.benignAccidents)).map((b) => b.eventId).sort()).toEqual(['EV-2026-118', 'EV-2026-120']);
    expect((await after.select().from(t.trainingTitles).where(eq(t.trainingTitles.firstAid, true))).map((ti) => ti.id)).toEqual(['sst']);
    const [siteA] = await after.select().from(t.sites).where(eq(t.sites.id, 'ville-a'));
    expect(siteA.siret).toBe('00000000000018');
    const [fd01] = await after.select().from(t.wasteStreams).where(eq(t.wasteStreams.id, 'FD-01'));
    expect(fd01).toMatchObject({ qualification: 'recyclage', collectorSiret: '00000000000034', destinationSiret: '00000000000075' });
    const entries = await after.select().from(t.wasteEntries).where(eq(t.wasteEntries.streamId, 'FD-09'));
    expect(entries.filter((e) => e.transporter === '[Transports Benne Express]').every((e) => e.transporterSiret === null && e.destinationSiret)).toBe(true);
    expect(entries.filter((e) => e.transporter !== '[Transports Benne Express]').every((e) => e.transporterSiret === '00000000000067')).toBe(true);

    // Une seule fois : une modification ultérieure n'est jamais écrasée.
    await after.update(t.events).set({ lesionNature: 'Saisie ultérieure' }).where(eq(t.events.id, 'EV-2026-119'));
    await reopen();
    const [again] = await (await getDb()).select({ lesionNature: t.events.lesionNature }).from(t.events).where(eq(t.events.id, 'EV-2026-119'));
    expect(again.lesionNature).toBe('Saisie ultérieure');
  });

  it('choix ultérieur (« Gérer les sites ») conservé aux réouvertures suivantes', async () => {
    const { loadQhseLeads } = await import('@/lib/data/leads');
    await (await getDb()).update(t.sites).set({ qhseLeadId: null });
    await reopen();
    expect((await loadQhseLeads()).forSite('ville-a')).toMatchObject({ vacant: true });
  });
});
