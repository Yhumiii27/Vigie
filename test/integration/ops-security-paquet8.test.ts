import { cookieJar, form } from '../next-mocks';
import { describe, expect, it } from 'vitest';
import { readdir, utimes, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { actAs, file, formWith, freshDemoDatabase, lastLog } from '../helpers';
import { getDb, schema as t } from '@/db';
import { sweepOrphanUploads } from '@/db/maintenance';
import { loadEventDetail } from '@/lib/data/events';
import { USER_LIMITS, consumeUserLimit, userLimitHits } from '@/lib/rate-limit';
import { readAttachment, saveUpload } from '@/lib/uploads';
import { GET as getFile } from '@/app/fichiers/[id]/route';
import { addEventFiles, createReport, saveEvent } from '@/server/events';
import { STALE_EDIT, entityVersion } from '@/server/versions';

// Paquet 8 — exploitation et sécurité : pièces jointes (contenu réel, fichiers d'une transaction annulée, orphelins),
// limites par personne (signalements, fichiers), métadonnées des photos d'un signalement anonyme, modifications
// simultanées. Jeu de démonstration au 09/10/2026.

const uploads = freshDemoDatabase();

const GPS = 'GPS 48.8566N 2.3522E iPhone de Jean';
/** JPEG minimal avec un segment EXIF (position, appareil). */
const jpegWithExif = () => {
  const exif = Buffer.from(`Exif\0\0${GPS}`, 'latin1');
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff]), exif,
    Buffer.from([0xff, 0xdb, 0x00, 0x04, 1, 2, 0xff, 0xda, 0x00, 0x03, 0, 0x11, 0x22, 0xff, 0xd9])]);
};
const stored = async () => (await readdir(uploads)).filter((n) => /^[0-9a-f-]{36}$/.test(n));
const eventRow = async (id: string) => (await (await getDb()).select().from(t.events).where(eq(t.events.id, id)))[0];
const editForm = (e: Awaited<ReturnType<typeof eventRow>>, over: Record<string, string> = {}) => form({
  id: e.id, type: e.type, title: e.title, occurredOn: e.occurredOn, location: e.location, severity: String(e.severity), siteId: e.siteId,
  pilotId: e.pilotId ?? '', description: e.description, immediateMeasures: e.immediateMeasures, ...(e.ncOrigin ? { ncOrigin: e.ncOrigin } : {}),
  ...(e.envAspect ? { envAspect: e.envAspect } : {}), ...(e.envMedium ? { envMedium: e.envMedium } : {}),
  ...(e.customer ? { customer: e.customer } : {}), ...(e.customerRef ? { customerRef: e.customerRef } : {}),
  ...over,
});

describe('PRD-13 : fichiers des pièces jointes', () => {
  it('transaction annulée : le fichier écrit pendant celle-ci est effacé, aucune ligne', async () => {
    const db = await getDb();
    const before = await stored();
    await expect(db.transaction(async (tx) => {
      await saveUpload(file('preuve.pdf'), 'event', 'EV-2026-131', null, { db: tx });
      expect((await stored()).length).toBe(before.length + 1);
      throw new Error('échec après l’écriture');
    })).rejects.toThrow('échec après');
    expect(await stored()).toEqual(before);
    // Transaction validée : fichier et ligne gardés.
    const kept = await db.transaction((tx) => saveUpload(file('preuve.pdf'), 'event', 'EV-2026-131', null, { db: tx }));
    expect(await stored()).toContain(kept.storagePath);
  });

  it('maintenance : fichier sans ligne de plus de 24 h effacé ; récent, référencé ou étranger gardé', async () => {
    const db = await getDb();
    const old = randomUUID(), recent = randomUUID();
    await writeFile(path.join(uploads, old), 'orphelin');
    await writeFile(path.join(uploads, recent), 'en cours');
    await writeFile(path.join(uploads, 'LISEZMOI.txt'), 'autre');
    const past = new Date(Date.now() - 25 * 3600_000);
    await utimes(path.join(uploads, old), past, past);
    const referenced = (await stored()).find((n) => n !== old && n !== recent)!;
    await utimes(path.join(uploads, referenced), past, past);
    expect(await sweepOrphanUploads(db, uploads)).toBe(1);
    const left = await readdir(uploads);
    expect(left).not.toContain(old);
    expect(left).toEqual(expect.arrayContaining([recent, referenced, 'LISEZMOI.txt']));
  });
});

describe('SEC-08 : contenu réel des pièces jointes', () => {
  it('contenu contraire au type annoncé refusé ; type enregistré d’après le contenu', async () => {
    actAs('Animateur QHSE', 'all');
    const html = file('rapport.pdf', 'application/pdf', '<html><script>alert(1)</script></html>');
    expect(await addEventFiles(formWith({ eventId: 'EV-2026-131' }, { files: [html] }))).toEqual({ error: expect.stringMatching(/ne correspond pas à un format accepté/) });
    const png = new File([Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.alloc(30)])], 'schema.jpg', { type: 'image/jpeg' });
    expect(await addEventFiles(formWith({ eventId: 'EV-2026-131' }, { files: [png] }))).toEqual({ count: 1 });
    const db = await getDb();
    const [row] = await db.select().from(t.attachments).where(and(eq(t.attachments.entityId, 'EV-2026-131'), eq(t.attachments.fileName, 'schema.jpg')));
    expect(row.mimeType).toBe('image/png');
  });

  it('/fichiers : document Office téléchargé, image affichée, nosniff et bac à sable', async () => {
    actAs('Animateur QHSE', 'all');
    const { strToU8, zipSync } = await import('fflate');
    const docx = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8('<w:document/>') });
    const type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const row = await saveUpload(new File([docx], 'compte-rendu.docx', { type }), 'event', 'EV-2026-131', 'clefevre', { quota: false });
    const res = await getFile(new Request(`http://localhost:3200/fichiers/${row.id}`), { params: Promise.resolve({ id: row.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(type);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="compte-rendu.docx"/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toMatch(/sandbox/);
  });
});

describe('SEC-07 : limites par personne', () => {
  it('fichiers par heure : refus clair avant l’écriture, rien n’est consommé par un envoi refusé', async () => {
    actAs('Animateur QHSE', 'all');
    const db = await getDb();
    // [C. Lefèvre] (animatrice QHSE de démonstration) a déjà joint 99 fichiers dans l'heure.
    await consumeUserLimit('uploadFiles', 'clefevre', USER_LIMITS.uploadFiles.max - 1 - (await userLimitHits('uploadFiles', 'clefevre')), { db });
    expect(await addEventFiles(formWith({ eventId: 'EV-2026-131' }, { files: [file('a.pdf'), file('b.pdf')] }))).toEqual({ error: USER_LIMITS.uploadFiles.message });
    expect(await userLimitHits('uploadFiles', 'clefevre')).toBe(USER_LIMITS.uploadFiles.max - 1);
    expect(await addEventFiles(formWith({ eventId: 'EV-2026-131' }, { files: [file('a.pdf')] }))).toEqual({ count: 1 });
    expect(await userLimitHits('uploadFiles', 'clefevre')).toBe(USER_LIMITS.uploadFiles.max);
    expect(await addEventFiles(formWith({ eventId: 'EV-2026-131' }, { files: [file('c.pdf')] }))).toEqual({ error: USER_LIMITS.uploadFiles.message });
    // Clé hachée : aucun identifiant de personne en clair dans la table des compteurs.
    expect(JSON.stringify(await db.select().from(t.reportRateLimits))).not.toContain('clefevre');
  });

  it('signalements d’une personne connectée par heure', async () => {
    actAs('Salarié', 'all');
    const db = await getDb();
    await consumeUserLimit('report', 'tnguyen', USER_LIMITS.report.max - 1, { db });
    const r = await createReport(form({ type: 'SD', description: 'Extincteur masqué par une palette.' }));
    expect(r).toMatchObject({ id: expect.stringMatching(/^EV-2026-/) });
    expect(await createReport(form({ type: 'SD', description: 'Encore un.' }))).toEqual({ error: USER_LIMITS.report.message });
  });
});

describe('SEC-09 : signalement anonyme', () => {
  it('photo : métadonnées retirées côté serveur, nom remplacé, aucun auteur', async () => {
    actAs('Chef de service', 'ville-a');
    const fd = form({ type: 'SD', description: 'Câble au sol dans l’allée.', anonymous: '1' });
    fd.append('photos', new File([jpegWithExif()], 'IMG_2026-10-09_Jean.jpg', { type: 'image/jpeg' }));
    const counters = async () => (await (await getDb()).select().from(t.reportRateLimits)).map((c) => `${c.key}:${c.hits}`).sort();
    const before = await counters();
    const r = await createReport(fd);
    // Aucun compteur par personne pour un signalement anonyme (il le rattacherait à son auteur), ni par fichier.
    expect(await counters()).toEqual(before);
    expect(r).toMatchObject({ id: expect.any(String) });
    const db = await getDb();
    const [att] = await db.select().from(t.attachments).where(eq(t.attachments.entityId, r.id!));
    expect(att).toMatchObject({ fileName: 'photo-1.jpg', uploadedBy: null, mimeType: 'image/jpeg' });
    const content = (await readAttachment(att.id))!.data;
    expect(content.includes(Buffer.from(GPS, 'latin1'))).toBe(false);
    expect(content.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    const ev = await eventRow(r.id!);
    expect(ev).toMatchObject({ declarantId: null, declarant: null, anonymous: true, reportedVia: 'terrain' });
    expect((await lastLog('event', r.id!))?.byId).toBeNull();
  });
});

describe('QUA-12 : modifications simultanées', () => {
  it('fiche événement : version lue à l’ouverture, refus si la fiche a changé entre-temps', async () => {
    actAs('Animateur QHSE', 'all');
    const id = 'EV-2026-131';
    const opened = (await loadEventDetail(id))!.version;
    expect(opened).toBe(await entityVersion(await getDb(), 'event', id));
    const e = await eventRow(id);
    // Premier enregistrement : accepté, la version change.
    expect(await saveEvent({}, editForm(e, { title: 'Titre modifié par A', version: opened }))).toMatchObject({ ok: true });
    expect((await loadEventDetail(id))!.version).not.toBe(opened);
    // Second formulaire ouvert avant : refusé, rien n'est écrasé.
    expect(await saveEvent({}, editForm(e, { title: 'Titre modifié par B', version: opened }))).toEqual({ error: STALE_EDIT });
    expect((await eventRow(id)).title).toBe('Titre modifié par A');
    // Sans version (appel direct, page ouverte avant le déploiement) : pas de contrôle.
    expect(await saveEvent({}, editForm(e, { title: 'Titre modifié par C' }))).toMatchObject({ ok: true });
    void cookieJar;
  });
});

describe('QUA-12 : risques du DUERP', () => {
  it('risque modifié entre-temps : refusé ; version de la liste à jour après l’enregistrement', async () => {
    const { saveRisk } = await import('@/server/risks');
    const { loadRisks } = await import('@/lib/data/risks');
    actAs('Animateur QHSE', 'ville-a');
    const values = {
      unitId: 'usinage', hazard: 'Projection de copeaux', situation: 'Usinage sans carter', gravity: '3', probability: '3',
      existingMeasures: 'Lunettes', residualGravity: '3', residualProbability: '2',
    };
    const created = await saveRisk({}, form(values));
    expect(created).toMatchObject({ ok: true });
    const versionOf = async () => {
      const data = await loadRisks();
      const all = JSON.parse(JSON.stringify(data)) as unknown;
      const find = (x: unknown): { id: number; version?: string } | null => {
        if (Array.isArray(x)) { for (const y of x) { const r = find(y); if (r) return r; } return null; }
        if (x && typeof x === 'object') {
          const o = x as Record<string, unknown>;
          if (o.id === Number(created.id) && 'hazard' in o) return o as { id: number; version?: string };
          for (const v of Object.values(o)) { const r = find(v); if (r) return r; }
        }
        return null;
      };
      return find(all)?.version;
    };
    const opened = await versionOf();
    expect(opened).toMatch(/^\d+$/);
    expect(await saveRisk({}, form({ ...values, id: created.id!, existingMeasures: 'Lunettes et carter', version: opened! }))).toMatchObject({ ok: true });
    expect(await saveRisk({}, form({ ...values, id: created.id!, existingMeasures: 'Écran', version: opened! }))).toEqual({ error: STALE_EDIT });
    expect(await versionOf()).not.toBe(opened);
  });
});
