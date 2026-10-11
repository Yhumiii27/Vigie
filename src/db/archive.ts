// Archive tar (format ustar) des sauvegardes (PRD-02) : écriture et lecture en flux, sans dépendance.
// Une sauvegarde reste lisible avec les outils standard une fois déchiffrée (tar -tf vigie-….tar).

import type { Readable, Writable } from 'node:stream';

const BLOCK = 512;
const MAX_SIZE = 8 ** 11 - 1; // champ « size » : 11 chiffres octaux (8 Gio)

export type TarEntry = { name: string; size: number; mtime?: Date; body: () => Readable | Buffer };

function octal(n: number, width: number) {
  return `${n.toString(8).padStart(width - 1, '0')}\0`;
}

function header(name: string, size: number, mtime: Date): Buffer {
  const b = Buffer.alloc(BLOCK);
  if (Buffer.byteLength(name) > 100 || name.includes('\0')) throw new Error(`Nom d'entrée trop long pour l'archive : ${name}`);
  if (size > MAX_SIZE) throw new Error(`Entrée trop volumineuse pour l'archive : ${name}`);
  b.write(name, 0, 100, 'utf8');
  b.write(octal(0o600, 8), 100, 8, 'ascii');
  b.write(octal(0, 8), 108, 8, 'ascii');
  b.write(octal(0, 8), 116, 8, 'ascii');
  b.write(octal(size, 12), 124, 12, 'ascii');
  b.write(octal(Math.floor(mtime.getTime() / 1000), 12), 136, 12, 'ascii');
  b.write('        ', 148, 8, 'ascii');
  b.write('0', 156, 1, 'ascii');
  b.write('ustar\0', 257, 6, 'ascii');
  b.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const byte of b) sum += byte;
  b.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return b;
}

const padding = (size: number) => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);

/** Flux tar des entrées, dans l'ordre ; la taille annoncée de chaque entrée est contrôlée. */
export async function* tarStream(entries: AsyncIterable<TarEntry> | Iterable<TarEntry>): AsyncGenerator<Buffer> {
  for await (const e of entries) {
    yield header(e.name, e.size, e.mtime ?? new Date());
    const body = e.body();
    let written = 0;
    if (Buffer.isBuffer(body)) {
      written = body.length;
      yield body;
    } else {
      for await (const chunk of body) {
        written += (chunk as Buffer).length;
        yield chunk as Buffer;
      }
    }
    if (written !== e.size) throw new Error(`Taille modifiée pendant la sauvegarde : ${e.name} (${written} octets au lieu de ${e.size})`);
    yield padding(e.size);
  }
  yield Buffer.alloc(BLOCK * 2);
}

function parseHeader(b: Buffer): { name: string; size: number; type: string } | null {
  if (b.every((x) => x === 0)) return null;
  const str = (start: number, len: number) => b.subarray(start, start + len).toString('utf8').replace(/\0[\s\S]*$/, '');
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : b[i];
  if (sum !== parseInt(str(148, 8).trim(), 8)) throw new Error('Archive illisible (somme de contrôle d\'en-tête tar incorrecte).');
  const prefix = str(345, 155);
  const name = prefix ? `${prefix}/${str(0, 100)}` : str(0, 100);
  return { name, size: parseInt(str(124, 12).trim() || '0', 8), type: str(156, 1) || '0' };
}

/**
 * Lit une archive tar en flux : `onEntry(nom, taille)` renvoie la destination du contenu (Writable, refermé par
 * readTar) ou null pour l'ignorer. Seuls les fichiers ordinaires sont transmis.
 */
export async function readTar(input: Readable, onEntry: (name: string, size: number) => Promise<Writable | null> | Writable | null): Promise<void> {
  let buf: Buffer = Buffer.alloc(0);
  let remaining = 0; // octets de contenu restants de l'entrée courante
  let skip = 0; // remplissage à sauter après le contenu
  let target: Writable | null = null;
  let ended = false;

  const write = (w: Writable, chunk: Buffer) => new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    w.once('error', onError);
    const ok = w.write(chunk, (err) => {
      if (err) reject(err);
    });
    const done = () => {
      w.off('error', onError);
      resolve();
    };
    if (ok) done();
    else w.once('drain', done);
  });
  const close = (w: Writable) => new Promise<void>((resolve, reject) => {
    w.once('error', reject);
    w.end(() => resolve());
  });

  for await (const chunk of input) {
    buf = buf.length ? Buffer.concat([buf, chunk as Buffer]) : (chunk as Buffer);
    while (buf.length && !ended) {
      if (remaining > 0) {
        const part = buf.subarray(0, Math.min(remaining, buf.length));
        if (target) await write(target, part);
        remaining -= part.length;
        buf = buf.subarray(part.length);
        if (remaining === 0 && target) {
          await close(target);
          target = null;
        }
        continue;
      }
      if (skip > 0) {
        const n = Math.min(skip, buf.length);
        skip -= n;
        buf = buf.subarray(n);
        continue;
      }
      if (buf.length < BLOCK) break;
      const h = parseHeader(buf.subarray(0, BLOCK));
      buf = buf.subarray(BLOCK);
      if (!h) {
        ended = true;
        break;
      }
      remaining = h.size;
      skip = padding(h.size).length;
      target = h.type === '0' ? await onEntry(h.name, h.size) : null;
      if (h.size === 0 && target) {
        await close(target);
        target = null;
      }
    }
  }
  if (!ended || remaining > 0) {
    target?.destroy();
    throw new Error('Archive tronquée (fin de l\'archive tar absente).');
  }
}
