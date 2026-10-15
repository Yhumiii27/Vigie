import { cookieJar } from '../next-mocks';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, schema as t } from '@/db';
import { resetConfig } from '@/lib/env';
import { isEncrypted } from '@/lib/encryption';

// Pièces jointes chiffrées au repos (PRD-02) : enregistrement chiffré avec VIGIE_UPLOAD_KEY, lecture transparente des
// fichiers en clair existants, fichier illisible sans la clé (indisponible, jamais servi chiffré) ; service par
// /fichiers/[id] déchiffré, selon le droit sur l'élément propriétaire (SEC-02).

let dir: string;
const env = (key?: string) => {
  process.env.VIGIE_UPLOAD_DIR = dir;
  if (key) process.env.VIGIE_UPLOAD_KEY = key;
  else delete process.env.VIGIE_UPLOAD_KEY;
  resetConfig();
};

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vigie-uploads-'));
  process.env.VIGIE_DEMO = '1';
  process.env.VIGIE_DATA_DIR = 'memory://';
  resetConfig();
  await closeDb();
});
afterAll(async () => {
  await closeDb();
  delete process.env.VIGIE_UPLOAD_KEY;
  delete process.env.VIGIE_UPLOAD_DIR;
  resetConfig();
  await rm(dir, { recursive: true, force: true });
});

describe('pièces jointes chiffrées au repos', () => {
  it('chiffre les nouveaux fichiers et relit les anciens fichiers en clair', async () => {
    const { saveUpload, readAttachment } = await import('@/lib/uploads');
    // Fichier enregistré avant l'activation du chiffrement.
    env();
    const before = await saveUpload(new File(['avant la clé'], 'avant.txt', { type: 'text/plain' }), 'event', 'EV-TEST', null);
    expect((await readFile(path.join(dir, before.storagePath))).toString()).toBe('avant la clé');

    const key = randomBytes(32).toString('base64');
    env(key);
    const content = randomBytes(5000);
    const row = await saveUpload(new File([content], 'photo.jpg', { type: 'image/jpeg' }), 'event', 'EV-TEST', null);
    const stored = await readFile(path.join(dir, row.storagePath));
    expect(isEncrypted(stored)).toBe(true);
    expect(stored.includes(content.subarray(0, 64))).toBe(false);
    expect((await readAttachment(row.id))?.data).toEqual(content);
    expect((await readAttachment(before.id))?.data.toString()).toBe('avant la clé');

    // Clé retirée (ou remplacée sans VIGIE_UPLOAD_KEY_PREVIOUS) : pièce indisponible, avertissement dans le journal.
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    env();
    expect(await readAttachment(row.id)).toBeNull();
    env(randomBytes(32).toString('hex'));
    expect(await readAttachment(row.id)).toBeNull();

    // Bonne clé, mais contenu altéré : jamais servi.
    env(key);
    await writeFile(path.join(dir, row.storagePath), Buffer.concat([stored.subarray(0, 40), Buffer.from([stored[40] ^ 1]), stored.subarray(41)]));
    expect(await readAttachment(row.id)).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/illisible : fichier chiffré altéré/));
    log.mockRestore();
    const db = await getDb();
    // Les deux pièces de ce test (le jeu de démonstration porte aussi des preuves d'action, paquet 1 Actions QSE).
    expect((await db.select().from(t.attachments).where(eq(t.attachments.entityId, 'EV-TEST'))).length).toBe(2);
  });

  it('refuse un contenu qui commence par l’en-tête de chiffrement de Vigie, avec ou sans clé', async () => {
    const { saveUpload } = await import('@/lib/uploads');
    // Fichier texte (type déclaré par le navigateur) qui imite l'en-tête : il serait pris pour un fichier chiffré.
    const imitation = Buffer.concat([Buffer.from('VIGIEENC', 'ascii'), Buffer.from([1]), Buffer.alloc(40, 0x41)]);
    expect(isEncrypted(imitation)).toBe(true);
    const db = await getDb();
    const count = async () => (await db.select().from(t.attachments)).length;
    const before = await count();
    for (const key of [undefined, randomBytes(32).toString('base64')]) {
      env(key);
      await expect(saveUpload(new File([imitation], 'note.txt', { type: 'text/plain' }), 'event', 'EV-TEST', null)).rejects.toThrow(/imite un fichier chiffré/);
    }
    expect(await count()).toBe(before);
  });

  it('/fichiers/[id] : contenu déchiffré pour un rôle autorisé ; 404 sinon, comme un fichier absent', async () => {
    const { saveUpload } = await import('@/lib/uploads');
    const { GET } = await import('@/app/fichiers/[id]/route');
    env(randomBytes(32).toString('base64'));
    const content = randomBytes(2000);
    // Photo du signalement EV-2026-131, déclaré par [T. Nguyen] (Salarié du jeu de démonstration).
    const own = await saveUpload(new File([content], 'photo.jpg', { type: 'image/jpeg' }), 'event', 'EV-2026-131', null);
    const other = await saveUpload(new File([content], 'autre.jpg', { type: 'image/jpeg' }), 'event', 'EV-2026-130', null);
    const get = (id: string) => GET(new Request(`http://localhost:3200/fichiers/${id}`), { params: Promise.resolve({ id }) });

    cookieJar.set('vigie_role', 'Animateur QHSE');
    const res = await get(own.id);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(content);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');

    cookieJar.set('vigie_role', 'Salarié');
    expect((await get(own.id)).status).toBe(200);
    const denied = await get(other.id);
    expect(denied.status).toBe(404);
    expect(await denied.text()).toBe(await (await get('00000000-0000-4000-8000-000000000000')).text());
    cookieJar.clear();
  });
});
