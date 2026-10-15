import '../next-mocks';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { REMINDER_MAX_ATTEMPTS, runWeeklyReminder, type ReminderJobConfig, type ReminderLog } from '@/lib/action-reminder-job';
import { fromParisLocal } from '@/lib/dates';
import { fileTransport, type MailTransport } from '@/lib/mail/transport';
import { freshDemoDatabase } from '../helpers';

// Rappel du mercredi par e-mail (ACT-33, D13) : transport « fichier » dans un dossier temporaire, journal d'envoi
// (action_reminder_sends) : un envoi par personne et par semaine, nouvel essai après un échec, envoi interrompu repris.

freshDemoDatabase({ today: '2026-10-14' });

const mails = mkdtempSync(path.join(tmpdir(), 'vigie-test-mails-'));
afterAll(() => rmSync(mails, { recursive: true, force: true }));

const cfg: ReminderJobConfig = { reminderTime: { hour: 7, minute: 0 }, publicUrl: null, demo: true, mailFrom: 'Vigie <vigie@localhost>' };
const at = (day: string, time: string) => fromParisLocal(`${day}T${time}`)!;
const quiet: ReminderLog = { info: () => {}, error: () => {} };
const IN_REMINDER = ['a_faire', 'initiee', 'p20', 'p40', 'p60', 'p80', 'terminee'] as const;

async function recipients() {
  const db = await getDb();
  const rows = await db.selectDistinct({ id: t.actions.pilotId }).from(t.actions).where(inArray(t.actions.status, [...IN_REMINDER]));
  return rows.map((r) => r.id).sort();
}
async function sends(week: string) {
  const db = await getDb();
  return db.select().from(t.actionReminderSends).where(eq(t.actionReminderSends.week, week));
}
const filesIn = (dir: string) => { try { return readdirSync(dir).sort(); } catch { return []; } };

describe('rappel du mercredi par e-mail', () => {
  it('mercredi 07:30 : un fichier par destinataire avec adresse ; sans adresse → « sans_adresse » ; sortie de l’effectif exclue', async () => {
    const db = await getDb();
    const people = await recipients();
    expect(people.length).toBeGreaterThan(3);
    const [noAddress, gone] = people.filter((p) => !['clefevre', 'tnguyen'].includes(p));
    await db.update(t.people).set({ email: null }).where(eq(t.people.id, noAddress));
    await db.update(t.people).set({ leftOn: '2026-10-01', leftReason: 'Départ' }).where(eq(t.people.id, gone));

    const dir = path.join(mails, 'w42');
    const r = await runWeeklyReminder(db, { now: at('2026-10-14', '07:30'), todayIso: '2026-10-14', cfg, transport: fileTransport(dir), log: quiet });
    expect(r).toMatchObject({ due: true, week: '2026-W42', sent: people.length - 2, withoutAddress: 1, failed: 0 });
    expect(filesIn(dir)).toEqual(people.filter((p) => p !== noAddress && p !== gone).map((p) => `rappel-2026-W42-${p}.json`).sort());
    const rows = await sends('2026-W42');
    expect(rows.find((s) => s.personId === noAddress)).toMatchObject({ status: 'sans_adresse', email: null, attempts: 1 });
    expect(rows.find((s) => s.personId === gone)).toBeUndefined();
    expect(rows.filter((s) => s.status === 'envoye').every((s) => s.sentAt instanceof Date && s.email)).toBe(true);

    // Contenu : objet du § 15.2, destinataire, liens vers la fiche et la vue filtrée, HTML échappé.
    const mail = JSON.parse(readFileSync(path.join(dir, 'rappel-2026-W42-clefevre.json'), 'utf8'));
    const own = rows.find((s) => s.personId === 'clefevre')!;
    expect(mail).toMatchObject({
      to: 'c.lefevre@epc2i.example', from: 'Vigie <vigie@localhost>',
      subject: `Vigie · vos actions QSE en cours (${own.actionCount}, dont ${own.lateCount} en retard)`,
    });
    expect(own.lateCount).toBeGreaterThan(0);
    expect(mail.text).toContain('http://localhost:3200/actions?mes=1');
    expect(mail.text).toMatch(/http:\/\/localhost:3200\/actions\?action=A-\d+/);
    expect(mail.html).toContain('en retard de');
    expect(mail.html).not.toMatch(/<script/i);
    const tnguyen = JSON.parse(readFileSync(path.join(dir, 'rappel-2026-W42-tnguyen.json'), 'utf8'));
    expect(tnguyen.text).not.toContain('Terminées — en attente de vérification');
    const lmoreau = JSON.parse(readFileSync(path.join(dir, 'rappel-2026-W42-lmoreau.json'), 'utf8'));
    expect(lmoreau.text).toContain('Terminées — en attente de vérification');
  });

  it('nouveau passage le même mercredi : aucun nouvel envoi (idempotent)', async () => {
    const db = await getDb();
    const dir = path.join(mails, 'w42-bis');
    const r = await runWeeklyReminder(db, { now: at('2026-10-14', '18:00'), todayIso: '2026-10-14', cfg, transport: fileTransport(dir), log: quiet });
    expect(r).toMatchObject({ due: true, sent: 0, withoutAddress: 0, failed: 0 });
    expect(r.skipped).toBeGreaterThan(0);
    expect(filesIn(dir)).toEqual([]);
  });

  it('avant l’heure configurée et un autre jour que le mercredi : rien', async () => {
    const db = await getDb();
    const dir = path.join(mails, 'hors-creneau');
    const run = (day: string, time: string) => runWeeklyReminder(db, { now: at(day, time), todayIso: day, cfg, transport: fileTransport(dir), log: quiet });
    expect(await run('2026-10-21', '06:59')).toMatchObject({ due: false, sent: 0 });
    expect(await run('2026-10-22', '09:00')).toMatchObject({ due: false, sent: 0 }); // jeudi : pas de rattrapage
    expect(await run('2026-10-20', '09:00')).toMatchObject({ due: false, sent: 0 });
    expect(filesIn(dir)).toEqual([]);
    expect(await sends('2026-W43')).toEqual([]);
    // Heure configurée différente.
    expect(await runWeeklyReminder(db, { now: at('2026-10-21', '07:30'), todayIso: '2026-10-21', cfg: { ...cfg, reminderTime: { hour: 8, minute: 15 } }, transport: fileTransport(dir), log: quiet }))
      .toMatchObject({ due: false });
  });

  it('transport en échec → « echec » avec l’erreur ; passage suivant → nouvel essai (attempts 2) ; au plus 5 essais', async () => {
    const db = await getDb();
    const errors: string[] = [];
    const failing: MailTransport = { kind: 'fichier', send: async () => { throw new Error('relais injoignable'); } };
    const r1 = await runWeeklyReminder(db, { now: at('2026-10-21', '07:05'), todayIso: '2026-10-21', cfg, transport: failing, log: { info: () => {}, error: (m) => errors.push(m) } });
    expect(r1.failed).toBeGreaterThan(0);
    expect(r1.sent).toBe(0);
    expect(errors).toEqual([expect.stringMatching(/^\[vigie\] Rappel du mercredi : semaine 2026-W43, 0 e-mail\(s\) envoyé\(s\), 1 sans adresse, \d+ échec\(s\)\.$/)]);
    const failed = (await sends('2026-W43')).filter((s) => s.status === 'echec');
    expect(failed.length).toBe(r1.failed);
    expect(failed.every((s) => s.error === 'relais injoignable' && s.attempts === 1)).toBe(true);

    const dir = path.join(mails, 'w43');
    const r2 = await runWeeklyReminder(db, { now: at('2026-10-21', '07:15'), todayIso: '2026-10-21', cfg, transport: fileTransport(dir), log: quiet });
    expect(r2).toMatchObject({ sent: r1.failed, failed: 0 });
    expect(filesIn(dir)).toHaveLength(r1.failed);
    const after = await sends('2026-W43');
    expect(after.filter((s) => s.status === 'envoye').every((s) => s.attempts === 2)).toBe(true);
    // « sans_adresse » n'est pas retenté.
    expect(after.find((s) => s.status === 'sans_adresse')).toMatchObject({ attempts: 1 });

    // Cinq échecs : plus de nouvel essai.
    await db.update(t.actionReminderSends).set({ status: 'echec', attempts: REMINDER_MAX_ATTEMPTS, error: 'x' })
      .where(and(eq(t.actionReminderSends.week, '2026-W43'), eq(t.actionReminderSends.personId, 'clefevre')));
    const dir2 = path.join(mails, 'w43-ter');
    await runWeeklyReminder(db, { now: at('2026-10-21', '08:00'), todayIso: '2026-10-21', cfg, transport: fileTransport(dir2), log: quiet });
    expect(filesIn(dir2)).toEqual([]);
  });

  it('envoi resté « en_cours » plus de 30 min : repris ; récent : laissé à l’autre passage', async () => {
    const db = await getDb();
    const now = at('2026-10-28', '09:00');
    await db.insert(t.actionReminderSends).values([
      { personId: 'clefevre', week: '2026-W44', status: 'en_cours', attempts: 1, updatedAt: new Date(now.getTime() - 45 * 60_000) },
      { personId: 'tnguyen', week: '2026-W44', status: 'en_cours', attempts: 1, updatedAt: new Date(now.getTime() - 5 * 60_000) },
    ]);
    const dir = path.join(mails, 'w44');
    await runWeeklyReminder(db, { now, todayIso: '2026-10-28', cfg, transport: fileTransport(dir), log: quiet });
    const rows = await sends('2026-W44');
    expect(rows.find((s) => s.personId === 'clefevre')).toMatchObject({ status: 'envoye', attempts: 2 });
    expect(rows.find((s) => s.personId === 'tnguyen')).toMatchObject({ status: 'en_cours', attempts: 1 });
    expect(filesIn(dir)).toContain('rappel-2026-W44-clefevre.json');
    expect(filesIn(dir)).not.toContain('rappel-2026-W44-tnguyen.json');
  });

  it('adresse publique configurée : liens vers VIGIE_PUBLIC_URL (sans « / » final)', async () => {
    const db = await getDb();
    const dir = path.join(mails, 'w45');
    await runWeeklyReminder(db, { now: at('2026-11-04', '07:00'), todayIso: '2026-11-04', cfg: { ...cfg, demo: false, publicUrl: 'https://vigie.exemple.fr/' }, transport: fileTransport(dir), log: quiet });
    const mail = JSON.parse(readFileSync(path.join(dir, 'rappel-2026-W45-clefevre.json'), 'utf8'));
    expect(mail.text).toContain('https://vigie.exemple.fr/actions?mes=1');
    expect(mail.text).not.toContain('localhost');
  });

  it('adresse inutilisable (retour à la ligne, plusieurs adresses) : « sans_adresse », adresse lue conservée au journal', async () => {
    const db = await getDb();
    const [saved] = await db.select({ email: t.people.email }).from(t.people).where(eq(t.people.id, 'tnguyen'));
    await db.update(t.people).set({ email: 't.nguyen@epc2i.example\nBcc: x@y.fr' }).where(eq(t.people.id, 'tnguyen'));
    try {
      const dir = path.join(mails, 'w46');
      await runWeeklyReminder(db, { now: at('2026-11-11', '07:00'), todayIso: '2026-11-11', cfg, transport: fileTransport(dir), log: quiet });
      expect((await sends('2026-W46')).find((s) => s.personId === 'tnguyen')).toMatchObject({ status: 'sans_adresse', email: 't.nguyen@epc2i.example\nBcc: x@y.fr' });
      expect(filesIn(dir)).not.toContain('rappel-2026-W46-tnguyen.json');
      expect(filesIn(dir)).toContain('rappel-2026-W46-clefevre.json');
    } finally {
      await db.update(t.people).set({ email: saved.email }).where(eq(t.people.id, 'tnguyen'));
    }
  });
});
