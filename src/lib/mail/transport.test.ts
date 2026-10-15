import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTransport, fileTransport, mailFileName, type MailMessage } from './transport';

// Transport « fichier » des e-mails (ACT-33) : un JSON par message, dans un dossier temporaire.

let dir: string;
beforeAll(async () => { dir = await mkdtemp(path.join(tmpdir(), 'vigie-mails-')); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

const message = (id: string): MailMessage => ({ id, to: 'c.lefevre@epc2i.fr', from: 'Vigie <vigie@localhost>', subject: 'Objet', text: 'Texte', html: '<p>Texte</p>' });

describe('fileTransport', () => {
  it('écrit <dossier>/<id>.json (dossier créé au besoin) : le message et sa date d’écriture, lisible du seul propriétaire', async () => {
    const target = path.join(dir, 'sous', 'dossier');
    await fileTransport(target).send(message('rappel-2026-W42-clefevre'));
    const file = path.join(target, 'rappel-2026-W42-clefevre.json');
    const written = JSON.parse(await readFile(file, 'utf8'));
    expect(written).toMatchObject(message('rappel-2026-W42-clefevre'));
    expect(Number.isNaN(Date.parse(written.writtenAt))).toBe(false);
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readdir(target)).toEqual(['rappel-2026-W42-clefevre.json']); // aucun fichier temporaire laissé
  });

  it('identifiant réécrit en nom de fichier sûr : jamais hors du dossier', async () => {
    expect(mailFileName('../../etc/passwd')).toBe('_._.._etc_passwd.json');
    expect(mailFileName('.cache')).toBe('_cache.json');
    expect(mailFileName('')).toBe('message.json');
    expect(mailFileName('rappel-2026-W42-0b6f…é')).toBe('rappel-2026-W42-0b6f__.json');
    const target = path.join(dir, 'sur');
    await fileTransport(target).send(message('../evasion'));
    expect(await readdir(target)).toEqual(['_._evasion.json']);
    expect(await readdir(dir)).not.toContain('evasion.json');
  });

  it('même identifiant : le fichier est remplacé', async () => {
    const target = path.join(dir, 'remplace');
    const t = fileTransport(target);
    await t.send(message('m1'));
    await t.send({ ...message('m1'), subject: 'Second objet' });
    expect(JSON.parse(await readFile(path.join(target, 'm1.json'), 'utf8')).subject).toBe('Second objet');
  });

  it('échec d’écriture : erreur levée (journal d’envoi « echec »)', async () => {
    const t = fileTransport(path.join(dir, 'remplace', 'm1.json', 'impossible'));
    await expect(t.send(message('x'))).rejects.toThrow();
  });
});

describe('createTransport', () => {
  it('« fichier » : transport fichier dans VIGIE_MAIL_DIR ; « aucun » : null', () => {
    expect(createTransport({ mailTransport: 'fichier', mailDir: dir })?.kind).toBe('fichier');
    expect(createTransport({ mailTransport: 'aucun', mailDir: dir })).toBeNull();
  });
});
