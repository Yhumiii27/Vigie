import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { HEADER_BYTES, decryptBuffer, decryptFileStream, deriveKey, encryptBuffer, encryptStream, encryptedWith, fileKeys, isEncrypted } from './encryption';

const master = randomBytes(32);
const other = randomBytes(32);
const key = deriveKey(master, 'pieces-jointes');

describe('chiffrement des pièces jointes (AES-256-GCM)', () => {
  it('chiffre et déchiffre ; un fichier en clair (ancien) est lu tel quel', () => {
    const data = Buffer.from('photo du signalement');
    const enc = encryptBuffer(data, key);
    expect(isEncrypted(enc)).toBe(true);
    expect(enc.includes(data)).toBe(false);
    expect(decryptBuffer(enc, [key])).toEqual(data);
    expect(decryptBuffer(data, [key])).toEqual(data);
    expect(decryptBuffer(data, [])).toEqual(data);
  });
  it('une clé par usage : les sauvegardes ne se lisent pas avec la clé des pièces jointes', () => {
    const enc = encryptBuffer(Buffer.from('x'), deriveKey(master, 'sauvegardes'));
    expect(() => decryptBuffer(enc, [key])).toThrow(/autre clé/);
  });
  it('rotation : la clé précédente reste lisible, une clé inconnue est signalée', () => {
    const old = encryptBuffer(Buffer.from('ancien'), deriveKey(other, 'pieces-jointes'));
    const keys = fileKeys([master, other], 'pieces-jointes');
    expect(decryptBuffer(old, keys).toString()).toBe('ancien');
    expect(encryptedWith(old, keys[0])).toBe(false);
    expect(encryptedWith(old, keys[1])).toBe(true);
    expect(() => decryptBuffer(old, [key])).toThrow(/VIGIE_UPLOAD_KEY_PREVIOUS/);
    expect(() => decryptBuffer(old, [])).toThrow(/VIGIE_UPLOAD_KEY est absente/);
  });
  it('contenu ou en-tête altéré : refus (contrôle d\'intégrité)', () => {
    const enc = encryptBuffer(Buffer.from('rapport de contrôle'), key);
    const body = Buffer.from(enc);
    body[body.length - 20] ^= 1;
    expect(() => decryptBuffer(body, [key])).toThrow(/altéré/);
    const head = Buffer.from(enc);
    head[HEADER_BYTES - 1] ^= 1; // IV, authentifié avec l'en-tête
    expect(() => decryptBuffer(head, [key])).toThrow(/altéré/);
  });
});

describe('chiffrement en flux (sauvegardes)', () => {
  let dir: string;
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  const roundTrip = async (data: Buffer, chunks: number) => {
    dir ??= await mkdtemp(path.join(tmpdir(), 'vigie-enc-'));
    const file = path.join(dir, `f-${data.length}-${chunks}`);
    const parts = Array.from({ length: chunks }, (_, i) => data.subarray(Math.floor((i * data.length) / chunks), Math.floor(((i + 1) * data.length) / chunks)));
    await pipeline(Readable.from(parts), encryptStream(key), createWriteStream(file));
    const out: Buffer[] = [];
    for await (const c of await decryptFileStream(file, [key])) out.push(c as Buffer);
    return { file, plain: Buffer.concat(out) };
  };
  it('relit exactement le contenu, vide ou en plusieurs morceaux', async () => {
    for (const [size, chunks] of [[0, 1], [1, 1], [70_000, 7]] as const) {
      const data = randomBytes(size);
      expect((await roundTrip(data, chunks)).plain).toEqual(data);
    }
  });
  it('fichier altéré : erreur en fin de lecture', async () => {
    const { file } = await roundTrip(randomBytes(10_000), 3);
    const buf = await readFile(file);
    buf[5000] ^= 1;
    await writeFile(file, buf);
    const read = async () => {
      for await (const chunk of await decryptFileStream(file, [key])) void chunk;
    };
    await expect(read()).rejects.toThrow(/altérée ou clé incorrecte/);
  });
});
