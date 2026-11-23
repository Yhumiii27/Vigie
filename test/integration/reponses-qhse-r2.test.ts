import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, freezeClock, freshDemoDatabase, lastLog } from '../helpers';
import { and, eq, isNull } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { getDb, schema as t } from '@/db';
import { loadTodo, loadVisibleTodo } from '@/lib/data/todo';
import { loadSearch } from '@/lib/data/search';
import { loadDgiRegister } from '@/lib/data/dgi';
import { loadMyTalks, loadSafetyTalks } from '@/lib/data/safety-talks';
import { loadSitesMap } from '@/lib/data/sites-map';
import { loadPrevention } from '@/lib/data/prevention';
import { QHSE_ONLY } from '@/lib/edit-rights';
import { cancelDgiNotice, closeDgiNotice, recordDgiNotice, saveDgiMeasures, signDgiNotice } from '@/server/dgi';
import { addPlanWorker, liftPlanWorkerVeto, removePlanWorker, vetoPlanWorker } from '@/server/prevention-workers';
import { deliverPermit, setPermitCheck } from '@/server/permits';
import { signPlanEu } from '@/server/prevention';
import { cancelSafetyTalk, saveSafetyTalk, sendAttendanceSheet, signSafetyTalk } from '@/server/safety-talks';
import { GET as auditReport } from '@/app/(app)/audits/rapport/[id]/route';

// Réponses du service QHSE du 09/11/2026, paquet R2 : recherche globale (TDB-18), intervenants d'un plan de prévention
// (PRV-23), rapport d'audit en PDF (AUD-39), carte des sites (PRV-24), registre des dangers graves et imminents (CNF-01),
// causeries sécurité (CNF-09). Règles pures : src/lib/rules/{search,workers,dgi,safety-talks,sites-map}.test.ts.

const mails = mkdtempSync(path.join(tmpdir(), 'vigie-test-mails-'));
Object.assign(process.env, { VIGIE_MAIL_TRANSPORT: 'fichier', VIGIE_MAIL_DIR: mails });
afterAll(() => {
  delete process.env.VIGIE_MAIL_TRANSPORT;
  delete process.env.VIGIE_MAIL_DIR;
  rmSync(mails, { recursive: true, force: true });
});
freshDemoDatabase();
freezeClock('2026-10-09T10:00:00Z');

const db = () => getDb();
const workerOf = async (planId: string, personId: string) => (await (await db()).select().from(t.preventionPlanWorkers)
  .where(and(eq(t.preventionPlanWorkers.planId, planId), eq(t.preventionPlanWorkers.personId, personId), isNull(t.preventionPlanWorkers.cancelledAt))))[0];

describe('TDB-18 : recherche globale, même périmètre et mêmes droits que les écrans', () => {
  it('Salarié : ses signalements et ses actions, le DUERP ; ni prévention, ni audits, ni veille', async () => {
    actAs('Salarié', 'all');
    const groups = await loadSearch('EV-2026');
    const keys = groups.map((g) => g.key);
    expect(keys).not.toContain('prevention');
    expect(keys).not.toContain('audits');
    expect(keys).not.toContain('watch');
    const own = new Set((await (await db()).select({ id: t.events.id }).from(t.events)
      .where(and(eq(t.events.declarantId, 'tnguyen'), eq(t.events.anonymous, false)))).map((e) => e.id));
    const events = groups.find((g) => g.key === 'events')?.items ?? [];
    expect(events.every((e) => own.has(e.ref))).toBe(true);
    // Plans de prévention : écran fermé au Salarié, rien n'est cherché.
    expect((await loadSearch('PP-2026')).some((g) => g.key === 'prevention')).toBe(false);
  });

  it('maladies professionnelles : jamais pour l’encadrement, trouvées par l’animateur QHSE', async () => {
    const mp = await (await db()).select({ id: t.events.id, siteId: t.events.siteId }).from(t.events).where(eq(t.events.type, 'MP'));
    expect(mp.length).toBeGreaterThan(0);
    actAs('Chef de service', 'all');
    const chef = (await loadSearch(mp[0].id)).flatMap((g) => g.items.map((i) => i.ref));
    expect(chef).not.toContain(mp[0].id);
    actAs('Animateur QHSE', mp[0].siteId);
    expect((await loadSearch(mp[0].id)).find((g) => g.key === 'events')?.items[0]?.ref).toBe(mp[0].id);
  });

  it('chef de projet : ni veille ni registre des DGI ; animateur QHSE : référence exacte en tête, lien profond', async () => {
    actAs('Chef de projet', 'site_a');
    const keys = (await loadSearch('mezzanine')).map((g) => g.key);
    expect(keys).not.toContain('watch');
    expect(keys).not.toContain('dgi');
    actAs('Animateur QHSE', 'site_a');
    const groups = await loadSearch('PP-2026-015');
    expect(groups.find((g) => g.key === 'prevention')?.items[0]).toMatchObject({ ref: 'PP-2026-015', href: '/prevention?plan=PP-2026-015' });
    expect((await loadSearch('mezzanine')).map((g) => g.key)).toEqual(expect.arrayContaining(['prevention', 'dgi', 'talks']));
    // Site sélectionné : un plan du site B n'est pas trouvé depuis le site A.
    expect((await loadSearch('PP-2026-014')).some((g) => g.items.some((i) => i.ref === 'PP-2026-014'))).toBe(false);
  });
});

describe('AUD-39 : rapport d’audit en PDF', () => {
  const doneItem = async () => (await (await db()).select().from(t.auditPlanItems)
    .where(and(eq(t.auditPlanItems.done, true), isNull(t.auditPlanItems.cancelledAt), isNull(t.auditPlanItems.reviewId)))).find((p) => !p.siteId || p.siteId === 'site_a')!;
  const get = (id: string | number) => auditReport(new Request(`http://localhost:3200/audits/rapport/${id}`), { params: Promise.resolve({ id: String(id) }) });

  it('lecteurs de l’écran Audits : PDF en pièce jointe ; Salarié : 403 ; élément non réalisé ou inconnu : 404', async () => {
    const item = await doneItem();
    actAs('Chef de service', 'site_a');
    const res = await get(item.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(new RegExp(`^attachment; filename="rapport-audit-AUD-${item.year}-${item.id}`));
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
    actAs('Salarié', 'site_a');
    expect((await get(item.id)).status).toBe(403);
    actAs('Animateur QHSE', 'site_a');
    const [upcoming] = await (await db()).select({ id: t.auditPlanItems.id }).from(t.auditPlanItems).where(eq(t.auditPlanItems.done, false));
    expect((await get(upcoming.id)).status).toBe(404);
    expect((await get('999999')).status).toBe(404);
    expect((await get('abc')).status).toBe(404);
  });
});

describe('PRV-23 : intervenants, accueil sécurité et veto du service QHSE', () => {
  it('jeu : accueil non à jour signalé sur PP-2026-015 (fiche et échéance au responsable QHSE du site)', async () => {
    actAs('Animateur QHSE', 'site_a');
    const plan = (await loadPrevention()).plans.find((p) => p.id === 'PP-2026-015')!;
    expect(plan.workers.map((w) => [w.name, w.induction])).toEqual([['[K. Bernard]', 'missing'], ['[P. Roux]', 'ok']]);
    expect(plan.workerWarning).toBe('Accueil sécurité non à jour : [K. Bernard].');
    const todo = await loadTodo();
    expect(todo.find((x) => x.key === 'pp-accueil|PP-2026-015')).toMatchObject({ overdue: true, ownerIds: ['clefevre'], siteId: 'site_a' });
  });

  it('ajout par l’encadrement (avertissement), veto réservé à l’animateur QHSE, signature bloquée puis levée', async () => {
    actAs('Chef de service', 'site_a');
    const added = await addPlanWorker({}, form({ planId: 'PP-2026-016', personId: 'kbernard' }));
    expect(added).toMatchObject({ ok: true, message: 'Intervenant ajouté. Accueil sécurité non à jour : [K. Bernard].' });
    expect(await addPlanWorker({}, form({ planId: 'PP-2026-016', personId: 'kbernard' }))).toMatchObject({ fieldErrors: { personId: 'Intervenant déjà inscrit sur ce plan.' } });
    const w = await workerOf('PP-2026-016', 'kbernard');
    expect(await vetoPlanWorker({}, form({ id: String(w.id), reason: 'Accueil sécurité jamais suivi' }))).toEqual({ error: QHSE_ONLY });
    actAs('Direction', 'site_a');
    expect(await vetoPlanWorker({}, form({ id: String(w.id), reason: 'Accueil sécurité jamais suivi' }))).toEqual({ error: QHSE_ONLY });
    actAs('Animateur QHSE', 'site_a');
    expect(await vetoPlanWorker({}, form({ id: String(w.id), reason: ' ' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await vetoPlanWorker({}, form({ id: String(w.id), reason: 'Accueil sécurité jamais suivi' }))).toMatchObject({ ok: true });
    expect(await lastLog('prevention_plan', 'PP-2026-016')).toMatchObject({ action: 'veto', reason: 'Accueil sécurité jamais suivi', byId: 'clefevre' });
    const sign = () => signPlanEu({}, form({ id: 'PP-2026-016', signedEuOn: '2026-10-09', signedEuName: '[H. Marchand]', signedEuQuality: 'Directeur de site' }));
    expect((await sign()).error).toMatch(/Veto du service QHSE en cours sur l'intervenant \[K\. Bernard\]/);
    // Intervenant sous veto : pas de retrait (contournement), levée motivée par l'animateur QHSE.
    actAs('Chef de service', 'site_a');
    expect((await removePlanWorker({}, form({ id: String(w.id), reason: 'Remplacé' }))).error).toMatch(/levé avant de retirer/);
    expect((await liftPlanWorkerVeto({}, form({ id: String(w.id), reason: 'Accueil fait' }))).error).toBe(QHSE_ONLY);
    actAs('Animateur QHSE', 'site_a');
    expect(await liftPlanWorkerVeto({}, form({ id: String(w.id), reason: 'Accueil sécurité réalisé ce jour' }))).toMatchObject({ ok: true });
    expect(await sign()).toMatchObject({ ok: true });
    // Retrait motivé, jamais supprimé.
    expect(await removePlanWorker({}, form({ id: String(w.id), reason: 'Intervenant remplacé par l’entreprise' }))).toMatchObject({ ok: true });
    const [row] = await (await db()).select().from(t.preventionPlanWorkers).where(eq(t.preventionPlanWorkers.id, w.id));
    expect(row).toMatchObject({ cancelReason: 'Intervenant remplacé par l’entreprise', cancelledById: 'clefevre' });
  });

  it('veto refusé sur un intervenant à jour ; délivrance d’un permis du plan bloquée par un veto', async () => {
    actAs('Animateur QHSE', 'site_a');
    const ok = await workerOf('PP-2026-015', 'proux');
    expect((await vetoPlanWorker({}, form({ id: String(ok.id), reason: 'Essai' }))).error).toMatch(/aucun veto à poser/);
    actAs('Animateur QHSE', 'site_b');
    expect(await addPlanWorker({}, form({ planId: 'PP-2026-014', personId: 'kbernard' }))).toMatchObject({ ok: true });
    const w = await workerOf('PP-2026-014', 'kbernard');
    expect(await vetoPlanWorker({}, form({ id: String(w.id), reason: 'Habilitation électrique non à jour' }))).toMatchObject({ ok: true });
    expect(await setPermitCheck('PE-2026-009', 4, true)).toEqual({});
    expect(await setPermitCheck('PE-2026-009', 5, true)).toEqual({});
    expect((await deliverPermit('PE-2026-009')).error).toMatch(/impossible de délivrer le permis/);
    expect(await liftPlanWorkerVeto({}, form({ id: String(w.id), reason: 'Recyclage réalisé' }))).toMatchObject({ ok: true });
    expect(await deliverPermit('PE-2026-009')).toEqual({});
  });
});

describe('PRV-24 : carte des sites sous « Tous les sites »', () => {
  it('sites suivis du périmètre placés d’après Matrix, indicateurs calculés ; rien quand un site est sélectionné', async () => {
    actAs('Direction', 'all');
    const map = await loadSitesMap();
    expect(map?.message).toBeNull();
    expect(map?.placed.map((s) => s.id).sort()).toEqual(['site_a', 'site_b']);
    expect(map?.all.find((s) => s.id === 'site_a')?.indicators.openEvents).toBeGreaterThan(0);
    actAs('Direction', 'site_a');
    expect(await loadSitesMap()).toBeNull();
  });
});

describe('CNF-01 : registre des dangers graves et imminents', () => {
  it('lecture : animateur QHSE, direction, membres du CSE ; jamais l’encadrement ni un Salarié hors CSE', async () => {
    actAs('Chef de projet', 'site_a');
    expect(await loadDgiRegister('site_a')).toBeNull();
    expect((await recordDgiNotice({}, form({ siteId: 'site_a' }))).error).toMatch(/Registre réservé/);
    actAs('Direction', 'site_a');
    expect((await loadDgiRegister('site_a'))?.notices.map((n) => n.state)).toEqual(['clos', 'signale']);
    expect((await recordDgiNotice({}, form({ siteId: 'site_a' }))).error).toMatch(/membre du CSE/);
    // Salarié membre du CSE (démonstration : [T. Nguyen]).
    actAs('Salarié', 'site_a');
    const reg = await loadDgiRegister(null);
    expect(reg?.rights).toEqual({ record: true, sign: true, handle: false });
  });

  it('avis consigné et signé par un membre du CSE, mesures et clôture par l’animateur QHSE, journal', async () => {
    actAs('Salarié', 'site_a');
    const fields = {
      siteId: 'site_a', reportedAt: '2026-10-09T09:00', workstations: 'Atelier montage · poste M3', danger: 'Câble dénudé sous tension près du poste',
      exposedWorkers: '[T. Nguyen]', representativeName: '[T. Nguyen]',
    };
    expect(await recordDgiNotice({}, form({ ...fields, reportedAt: '2026-10-10T09:00' }))).toMatchObject({ fieldErrors: { reportedAt: 'Date et heure postérieures à maintenant.' } });
    expect(await recordDgiNotice({}, form({ ...fields, eventId: 'EV-INCONNU' }))).toMatchObject({ fieldErrors: { eventId: 'Événement introuvable sur ce site.' } });
    const r = await recordDgiNotice({}, form(fields));
    expect(r).toMatchObject({ ok: true, message: 'Avis consigné et signé.' });
    const [n] = await (await db()).select().from(t.dgiNotices).where(eq(t.dgiNotices.id, Number(r.id)));
    expect(n).toMatchObject({ number: 3, signedById: 'tnguyen', createdById: 'tnguyen', measures: null });
    expect(await saveDgiMeasures({}, form({ id: r.id!, measures: 'Consignation' }))).toEqual({ error: QHSE_ONLY });
    expect(await signDgiNotice({}, form({ id: r.id! }))).toEqual({ error: 'Avis déjà signé.' });
    // Échéance : mesures de l'employeur attendues, au responsable QHSE du site et à la direction.
    actAs('Direction', 'site_a');
    const due = (await loadVisibleTodo()).find((x) => x.key.startsWith(`dgi|${r.id}|`));
    expect(due).toMatchObject({ overdue: true, ownerIds: expect.arrayContaining(['clefevre', 'hmarchand']) });
    expect(due?.title).not.toContain('Câble');
    expect(await closeDgiNotice({}, form({ id: r.id! }))).toEqual({ error: QHSE_ONLY });
    actAs('Animateur QHSE', 'site_a');
    expect((await closeDgiNotice({}, form({ id: r.id! }))).error).toMatch(/mesures prises/);
    expect(await saveDgiMeasures({}, form({ id: r.id!, measures: 'Circuit consigné, câble remplacé par l’électricien de maintenance.' }))).toMatchObject({ ok: true });
    expect(await closeDgiNotice({}, form({ id: r.id! }))).toMatchObject({ ok: true });
    expect((await changeLog('dgi_notice', r.id!)).map((l) => l.action)).toEqual(['create', 'update', 'status']);
    expect((await loadTodo()).some((x) => x.key === `dgi|${r.id}`)).toBe(false);
  });

  it('avis recopié par l’animateur QHSE : à signer par un membre du CSE ; annulation motivée', async () => {
    actAs('Animateur QHSE', 'site_a');
    const r = await recordDgiNotice({}, form({
      siteId: 'site_a', reportedAt: '2026-10-08T16:00', workstations: 'Zone de chargement', danger: 'Quai niveleur bloqué en position haute',
      exposedWorkers: '[P. Roux]', representativeName: '[T. Nguyen]',
    }));
    expect(r).toMatchObject({ ok: true, message: 'Avis consigné : à signer par un membre du CSE.' });
    expect(await signDgiNotice({}, form({ id: r.id! }))).toEqual({ error: 'Avis signé par un représentant du personnel au CSE.' });
    actAs('Salarié', 'site_a');
    expect(await signDgiNotice({}, form({ id: r.id! }))).toMatchObject({ ok: true });
    actAs('Animateur QHSE', 'site_a');
    expect(await cancelDgiNotice({}, form({ id: r.id!, reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await cancelDgiNotice({}, form({ id: r.id!, reason: 'Doublon de l’avis n° 2' }))).toMatchObject({ ok: true });
    expect(await saveDgiMeasures({}, form({ id: r.id!, measures: 'x' }))).toEqual({ error: 'Avis annulé : il reste au registre en consultation seule.' });
  });
});

describe('CNF-09 : causeries sécurité et feuille d’émargement', () => {
  it('saisie par l’encadrement (journal), jamais par le Salarié ; participant signé jamais retiré', async () => {
    actAs('Salarié', 'site_a');
    expect((await saveSafetyTalk({}, form({ siteId: 'site_a' }))).error).toBe('Votre rôle ne permet pas cette modification.');
    actAs('Chef de projet', 'site_a');
    const fd = form({ siteId: 'site_a', heldOn: '2026-10-09', theme: 'Gestes et postures', animatorId: 'edubois', durationMinutes: '15', notes: '' });
    fd.append('participants', 'tnguyen');
    fd.append('participants', 'proux');
    const r = await saveSafetyTalk({}, fd);
    expect(r).toMatchObject({ ok: true, id: 'CS-003' });
    expect(await lastLog('safety_talk', 'CS-003')).toMatchObject({ action: 'create', byId: 'edubois' });
    const edit = form({ id: 'CS-001', siteId: 'site_a', heldOn: (await loadSafetyTalks())!.talks.find((x) => x.id === 'CS-001')!.heldOn, theme: 'Port des EPI', animatorId: 'sbenali', durationMinutes: '15' });
    edit.append('participants', 'tnguyen');
    expect((await saveSafetyTalk({}, edit)).fieldErrors?.participants).toMatch(/\[P\. Roux\] ne peut plus être retiré/);
  });

  it('feuille envoyée aux non-signataires (cloche et e-mail), signée par le participant lui-même ; indicateurs', async () => {
    actAs('Chef de projet', 'site_a');
    const sent = await sendAttendanceSheet({}, form({ id: 'CS-003' }));
    expect(sent).toMatchObject({ ok: true });
    expect(sent.message).toMatch(/Feuille d'émargement envoyée à 2 participants \(cloche ; 2 e-mails\)/);
    expect(readdirSync(mails).filter((f) => f.startsWith('causerie-CS-003'))).toHaveLength(2);
    const mail = JSON.parse(readFileSync(path.join(mails, readdirSync(mails).find((f) => f.startsWith('causerie-CS-003-tnguyen'))!), 'utf8'));
    expect(mail.text).toContain('/signaler/mon-espace#causeries');
    const notes = await (await db()).select().from(t.notifications).where(and(eq(t.notifications.entityType, 'safety_talk'), eq(t.notifications.entityId, 'CS-003')));
    expect(notes.map((n) => n.personId).sort()).toEqual(['proux', 'tnguyen']);
    // Signature : sa propre ligne seulement ; une causerie d'autrui est « introuvable ».
    actAs('Salarié', 'site_a');
    expect((await loadMyTalks()).find((x) => x.id === 'CS-003')).toMatchObject({ signedAt: null, requested: true });
    expect(await signSafetyTalk({}, form({ id: 'CS-001' }))).toEqual({ error: 'Feuille d’émargement déjà signée.' });
    expect(await signSafetyTalk({}, form({ id: 'CS-003' }))).toMatchObject({ ok: true });
    expect(await signSafetyTalk({}, form({ id: 'CS-003' }))).toEqual({ error: 'Feuille d’émargement déjà signée.' });
    actAs('Chef de service', 'site_a');
    expect(await signSafetyTalk({}, form({ id: 'CS-003' }))).toEqual({ error: 'Causerie introuvable.' });
    const data = (await loadSafetyTalks())!;
    expect(data.talks.find((x) => x.id === 'CS-003')?.rate).toBe(0.5);
    expect(data.stats.find((s) => s.siteId === 'site_a' && s.month === '2026-10')).toMatchObject({ talks: 2 });
    // Annulation motivée : hors indicateurs.
    actAs('Chef de projet', 'site_a');
    expect(await cancelSafetyTalk({}, form({ id: 'CS-003', reason: 'Saisie en double' }))).toMatchObject({ ok: true });
    expect((await loadSafetyTalks())!.stats.find((s) => s.siteId === 'site_a' && s.month === '2026-10')).toMatchObject({ talks: 1 });
  });
});
