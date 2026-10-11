// Chiffrement au repos (PRD-02) : pièces jointes et sauvegardes, AES-256-GCM avec VIGIE_UPLOAD_KEY.
// Module sans 'server-only' : utilisé par src/lib/uploads.ts, src/db/backup.ts et scripts/vigie-db.ts.
//
// Format d'un fichier chiffré : en-tête (MAGIC, version, empreinte de la clé, IV) | données chiffrées | étiquette GCM.
// L'en-tête est authentifié (données associées) ; l'étiquette en fin de fichier permet de chiffrer en flux (sauvegardes).
// Un fichier sans l'en-tête est lu tel quel : pièces jointes enregistrées avant l'activation du chiffrement.

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { open } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';

const MAGIC = Buffer.from('VIGIEENC', 'ascii');
const VERSION = 1;
const KEY_ID_BYTES = 8;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Taille de l'en-tête : MAGIC (8) + version (1) + empreinte de la clé (8) + IV (12). */
export const HEADER_BYTES = MAGIC.length + 1 + KEY_ID_BYTES + IV_BYTES;

/** Usage d'une clé dérivée : une clé différente par usage, toutes tirées de VIGIE_UPLOAD_KEY. */
export type KeyPurpose = 'pieces-jointes' | 'sauvegardes';

/** Clé de chiffrement dérivée (HKDF-SHA256) de la clé maîtresse, avec son empreinte (identifie la clé dans l'en-tête). */
export type FileKey = { key: Buffer; id: Buffer };

export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionError';
  }
}

export function deriveKey(master: Buffer, purpose: KeyPurpose): FileKey {
  const key = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), `vigie:${purpose}:v1`, 32));
  return { key, id: createHash('sha256').update(key).digest().subarray(0, KEY_ID_BYTES) };
}

/** Clés utilisables pour un usage : clé courante d'abord, puis la précédente (rotation en cours). */
export function fileKeys(masters: (Buffer | null)[], purpose: KeyPurpose): FileKey[] {
  return masters.filter((m): m is Buffer => !!m).map((m) => deriveKey(m, purpose));
}

/** Le contenu commence par l'en-tête de chiffrement de Vigie. */
export const isEncrypted = (head: Buffer) => head.length >= HEADER_BYTES && head.subarray(0, MAGIC.length).equals(MAGIC) && head[MAGIC.length] === VERSION;

function header(k: FileKey, iv: Buffer) {
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), k.id, iv]);
}

/** Clé correspondant à l'empreinte de l'en-tête ; erreur explicite si le fichier a été chiffré avec une autre clé. */
function keyFor(head: Buffer, keys: FileKey[]): FileKey {
  const id = head.subarray(MAGIC.length + 1, MAGIC.length + 1 + KEY_ID_BYTES);
  const k = keys.find((x) => x.id.equals(id));
  if (k) return k;
  throw new EncryptionError(keys.length
    ? `fichier chiffré avec une autre clé (empreinte ${id.toString('hex')}) : renseigner l'ancienne clé dans VIGIE_UPLOAD_KEY_PREVIOUS`
    : 'fichier chiffré, mais VIGIE_UPLOAD_KEY est absente');
}

function decipherFor(head: Buffer, keys: FileKey[]) {
  const k = keyFor(head, keys);
  const iv = head.subarray(HEADER_BYTES - IV_BYTES, HEADER_BYTES);
  const d = createDecipheriv('aes-256-gcm', k.key, iv);
  d.setAAD(head.subarray(0, HEADER_BYTES));
  return d;
}

/** Chiffre un contenu en mémoire (pièce jointe : 10 Mo au plus). */
export function encryptBuffer(data: Buffer, k: FileKey): Buffer {
  const iv = randomBytes(IV_BYTES);
  const head = header(k, iv);
  const c = createCipheriv('aes-256-gcm', k.key, iv);
  c.setAAD(head);
  return Buffer.concat([head, c.update(data), c.final(), c.getAuthTag()]);
}

/** Déchiffre un contenu chiffré par encryptBuffer ; un contenu en clair (fichier ancien) est renvoyé tel quel. */
export function decryptBuffer(data: Buffer, keys: FileKey[]): Buffer {
  if (!isEncrypted(data)) return data;
  if (data.length < HEADER_BYTES + TAG_BYTES) throw new EncryptionError('fichier chiffré tronqué');
  const d = decipherFor(data, keys);
  d.setAuthTag(data.subarray(data.length - TAG_BYTES));
  try {
    return Buffer.concat([d.update(data.subarray(HEADER_BYTES, data.length - TAG_BYTES)), d.final()]);
  } catch {
    throw new EncryptionError('fichier chiffré altéré ou clé incorrecte (contrôle d\'intégrité GCM en échec)');
  }
}

/** Le contenu est chiffré avec cette clé (sinon : en clair, ou avec une autre clé). */
export const encryptedWith = (head: Buffer, k: FileKey) => isEncrypted(head) && head.subarray(MAGIC.length + 1, MAGIC.length + 1 + KEY_ID_BYTES).equals(k.id);

/** Flux de chiffrement (sauvegardes) : en-tête, données chiffrées, puis étiquette GCM à la fin. */
export function encryptStream(k: FileKey): Transform {
  const iv = randomBytes(IV_BYTES);
  const head = header(k, iv);
  const c = createCipheriv('aes-256-gcm', k.key, iv);
  c.setAAD(head);
  let started = false;
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      if (!started) {
        started = true;
        this.push(head);
      }
      done(null, c.update(chunk));
    },
    flush(done) {
      if (!started) this.push(head);
      this.push(c.final());
      done(null, c.getAuthTag());
    },
  });
}

/**
 * Lit un fichier chiffré en flux (sauvegardes). L'intégrité n'est établie qu'à la fin du flux (erreur sinon) : le
 * lecteur ne doit rien appliquer avant la fin (src/db/backup.ts extrait d'abord dans un dossier temporaire).
 * Un fichier en clair est lu tel quel.
 */
export async function decryptFileStream(file: string, keys: FileKey[]): Promise<Readable> {
  const fh = await open(file, 'r');
  try {
    const { size } = await fh.stat();
    const head = Buffer.alloc(Math.min(HEADER_BYTES, size));
    await fh.read(head, 0, head.length, 0);
    if (!isEncrypted(head)) return fh.createReadStream({ start: 0, autoClose: true });
    if (size < HEADER_BYTES + TAG_BYTES) throw new EncryptionError('fichier chiffré tronqué');
    const tag = Buffer.alloc(TAG_BYTES);
    await fh.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
    const d = decipherFor(head, keys);
    d.setAuthTag(tag);
    const body = size - TAG_BYTES > HEADER_BYTES ? fh.createReadStream({ start: HEADER_BYTES, end: size - TAG_BYTES - 1, autoClose: true }) : Readable.from([]);
    if (size - TAG_BYTES <= HEADER_BYTES) await fh.close();
    const out = new Transform({
      transform(chunk: Buffer, _enc, done) {
        done(null, d.update(chunk));
      },
      flush(done) {
        try {
          done(null, d.final());
        } catch {
          done(new EncryptionError('sauvegarde chiffrée altérée ou clé incorrecte (contrôle d\'intégrité GCM en échec)'));
        }
      },
    });
    body.on('error', (err: Error) => out.destroy(err));
    return body.pipe(out);
  } catch (err) {
    await fh.close().catch(() => {});
    throw err;
  }
}

/** Le fichier commence par l'en-tête de chiffrement de Vigie (lecture des premiers octets seulement). */
export async function fileIsEncrypted(file: string): Promise<boolean> {
  const fh = await open(file, 'r');
  try {
    const head = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await fh.read(head, 0, HEADER_BYTES, 0);
    return isEncrypted(head.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
}
