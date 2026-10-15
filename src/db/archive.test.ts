import { randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readTar, tarStream, type TarEntry } from './archive';

function sink(onDone: (b: Buffer) => void) {
  const parts: Buffer[] = [];
  return new Writable({
    write(c: Buffer, _e, done) {
      parts.push(c);
      done();
    },
    final(done) {
      onDone(Buffer.concat(parts));
      done();
    },
  });
}

/** Découpe un flux en morceaux de taille fixe (en-têtes et contenus à cheval sur plusieurs morceaux). */
async function* rechunk(src: AsyncIterable<Buffer>, size: number) {
  let buf = Buffer.alloc(0);
  for await (const c of src) {
    buf = Buffer.concat([buf, c]);
    while (buf.length >= size) {
      yield buf.subarray(0, size);
      buf = buf.subarray(size);
    }
  }
  if (buf.length) yield buf;
}

describe('archive tar des sauvegardes', () => {
  const files: Record<string, Buffer> = {
    'manifest.json': Buffer.from('{"format":"vigie-sauvegarde"}'),
    'base.pgdump': randomBytes(1300),
    'pieces-jointes/vide': Buffer.alloc(0),
    'pieces-jointes/3b0c6f0e-6a55-4c39-9a3e-2f3d1c1b9e10': randomBytes(512 * 3),
  };
  const entries = (): TarEntry[] => Object.entries(files).map(([name, data]) => ({ name, size: data.length, body: () => Readable.from([data]) }));

  it('écrit puis relit chaque entrée, quel que soit le découpage du flux', async () => {
    for (const size of [1, 100, 512, 65_536]) {
      const got: Record<string, Buffer> = {};
      await readTar(Readable.from(rechunk(tarStream(entries()), size)), (name) => sink((b) => {
        got[name] = b;
      }));
      expect(got).toEqual(files);
    }
  });
  it('archive tronquée ou taille annoncée fausse : erreur', async () => {
    const chunks: Buffer[] = [];
    for await (const c of tarStream(entries())) chunks.push(c);
    const all = Buffer.concat(chunks);
    await expect(readTar(Readable.from([all.subarray(0, 1500)]), () => null)).rejects.toThrow(/tronquée/);
    const lying = async () => {
      for await (const c of tarStream([{ name: 'x', size: 10, body: () => Buffer.alloc(5) }])) void c;
    };
    await expect(lying()).rejects.toThrow(/Taille modifiée/);
  });
});
