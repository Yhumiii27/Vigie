import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, freezeClock, freshDemoDatabase, lastLog } from '../helpers';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { fromParisLocal, toParisLocal } from '@/lib/dates';
import { loadAudits } from '@/lib/data/audits';
import { loadPeopleAdmin, loadPeopleSignals } from '@/lib/data/people';
import { loadRiskSignals, loadRisks } from '@/lib/data/risks';
import { siteOpenItems } from '@/lib/data/sites';
import { inferAuditKind } from '@/lib/rules/audits';
import { advanceEvent, createEvent, createReport, saveEvent } from '@/server/events';
import { reassignResponsibilities } from '@/server/people';
import { closePermit, savePermit } from '@/server/permits';
import { savePlan } from '@/server/prevention';
import { addDuerpVersionComment, updateCurrentDuerpVersion } from '@/server/risks';
import { archiveSite } from '@/server/sites';

// Réponses du service QHSE du 09/11/2026, paquet R1 : droits sur les événements (EVT-29), date des faits d'un signalement
// terrain (EVT-21), règles de prévention (PRV-04, PRV-06, PRV-16, PRV-21 : voir aussi prevention-*.test.ts), DUERP
// (DUE-07, DUE-10), transfert des éléments ouverts d'un site archivé (TDB-08), responsabilités d'une personne sortie
// (HAB-05) et type d'audit (D08-5). Numérotation AC-AANNNN : action-core.test.ts.

freshDemoDatabase();
// Midi à Paris le jour de démonstration : « maintenant » déterministe pour les dates et heures saisies.
freezeClock('2026-10-09T10:00:00Z');

const QHSE_ONLY = "Réservé à l'animateur QHSE.";
const db = () => getDb();
const event = async (id: string) => (await (await db()).select().from(t.events).where(eq(t.events.id, id)))[0];

describe('EVT-29 : suivi des événements par l’animateur QHSE seulement', () => {
  it('l’encadrement et la direction déclarent, sans modifier ni faire avancer', async () => {
    actAs('Chef de service', 'site_a');
    const r = await createEvent({}, form({
      type: 'PA', title: 'Charge mal arrimée', occurredOn: '2026-10-08', location: 'Atelier montage', severity: '2', siteId: 'site_a', declarantId: 'sbenali', pilotId: 'sbenali',
    }));
    expect(r).toMatchObject({ ok: true });
    for (const role of ['Chef de service', 'Chef de projet', 'Direction'] as const) {
      actAs(role, 'site_a');
      expect(await advanceEvent(r.id!), role).toEqual({ error: QHSE_ONLY });
      expect(await saveEvent({}, form({ id: r.id!, type: 'PA', title: 'Autre', occurredOn: '2026-10-08', location: 'Atelier', severity: '2', siteId: 'site_a' })), role)
        .toEqual({ error: QHSE_ONLY });
    }
    actAs('Animateur QHSE', 'site_a');
    expect(await advanceEvent(r.id!)).toEqual({});
    expect((await event(r.id!)).step).toBe(1);
  });
});

describe('EVT-21 : date et heure des faits d’un signalement terrain', () => {
  it('facultative : heure d’envoi par défaut, faits antérieurs admis sur 30 jours, jamais dans le futur', async () => {
    actAs('Salarié', 'site_a');
    const sent = await createReport(form({ type: 'SD', description: 'Câble au sol dans l’allée.', location: 'Magasin' }));
    expect(await event(sent.id!)).toMatchObject({ occurredOn: '2026-10-09', occurredTime: toParisLocal(new Date()).slice(11, 16) });
    const past = await createReport(form({ type: 'SD', description: 'Porte coupe-feu calée.', location: 'Magasin', occurredAt: '2026-10-07T14:30' }));
    expect(await event(past.id!)).toMatchObject({ occurredOn: '2026-10-07', occurredTime: '14:30' });
    expect(await createReport(form({ type: 'SD', description: 'x', location: 'Magasin', occurredAt: '2026-10-09T23:00' }))).toEqual({ error: 'La date des faits ne peut pas être postérieure à maintenant.' });
    expect((await createReport(form({ type: 'SD', description: 'x', location: 'Magasin', occurredAt: '2026-09-01T08:00' }))).error).toMatch(/30 jours/);
    expect(await createReport(form({ type: 'SD', description: 'x', location: 'Magasin', occurredAt: 'hier' }))).toEqual({ error: 'Date et heure des faits invalides.' });
  });
});

describe('prévention : permis et inspection commune (PRV-04, PRV-06, PRV-16)', () => {
  it('PRV-04 : permis de feu clos seulement après la surveillance', async () => {
    const d = await db();
    await d.update(t.permits).set({ watchUntil: fromParisLocal('2026-10-09T14:00')! }).where(eq(t.permits.id, 'PF-2026-031'));
    actAs('Animateur QHSE', 'site_a');
    expect((await closePermit('PF-2026-031')).error).toMatch(/^Surveillance après travaux par points chauds jusqu'au 09\/10\/2026 à 14:00/);
    await d.update(t.permits).set({ watchUntil: fromParisLocal('2026-10-08T20:00')! }).where(eq(t.permits.id, 'PF-2026-031'));
    expect(await closePermit('PF-2026-031')).toEqual({});
  });

  it('PRV-16 : validité de 7 jours au plus sur les dates modifiées', async () => {
    actAs('Animateur QHSE', 'site_b');
    const [p] = await (await db()).select().from(t.permits).where(eq(t.permits.id, 'PE-2026-009'));
    const permitForm = (over: Record<string, string>) => form({
      id: p.id, type: p.type, siteId: p.siteId, location: p.location, description: p.description, contractorId: p.contractorId ?? '', performer: p.performer,
      preventionPlanId: p.preventionPlanId ?? '', validFrom: toParisLocal(p.validFrom).slice(0, 16), validTo: toParisLocal(p.validTo).slice(0, 16),
      checklist: JSON.stringify(p.checklist), ...over,
    });
    const from = toParisLocal(p.validFrom).slice(0, 10);
    const r = await savePermit({}, permitForm({ validFrom: `${from}T08:00`, validTo: '2026-10-25T08:00' }));
    expect(r.fieldErrors?.validTo).toMatch(/7 jours au plus/);
  });

  it('PRV-06 : inspection commune préalable datée après le début des travaux refusée', async () => {
    actAs('Animateur QHSE', 'site_a');
    const r = await savePlan({}, form({
      contractorId: 'EE-002', siteId: 'site_a', title: 'Peinture du quai', location: 'Quai', startOn: '2026-10-20', endOn: '2026-10-23',
      estimatedHours: '24', inspectionOn: '2026-10-21', measures: 'Balisage.', interferenceRisks: '',
    }));
    expect(r.fieldErrors?.inspectionOn).toBe("L'inspection commune préalable doit avoir lieu au plus tard le premier jour de l'intervention.");
  });
});

describe('DUE-10 : version du DUERP figée à sa validation, commentaires ensuite', () => {
  it('version validée : contenu figé, transmissions et commentaires admis', async () => {
    actAs('Animateur QHSE', 'all');
    const version = (over: Record<string, string>) => form({ version: '2026.1', validatedById: 'hmarchand', cseConsultedOn: '', comment: '', ...over });
    // Version 2026.1 rendue « non validée » : la consultation du CSE la valide et prend l'instantané.
    await (await db()).update(t.duerpVersions).set({ cseConsultedOn: null, snapshot: null, comment: null, validatedById: 'hmarchand' }).where(eq(t.duerpVersions.version, '2026.1'));
    expect(await updateCurrentDuerpVersion({}, version({ cseConsultedOn: '2026-03-20' }))).toMatchObject({ ok: true });
    const [row] = await (await db()).select().from(t.duerpVersions).where(eq(t.duerpVersions.version, '2026.1'));
    expect(row.snapshot).toMatchObject({ takenOn: '2026-10-09', risks: expect.any(Array) });
    expect(await lastLog('duerp_version', '2026.1')).toMatchObject({ summary: 'Version 2026.1 validée (CSE consulté) : contenu figé' });
    expect(await updateCurrentDuerpVersion({}, version({ cseConsultedOn: '2026-03-20', comment: 'Autre objet' }))).toEqual({
      error: 'Version validée par le CSE : son contenu est figé. Ajoutez un commentaire à la version.',
    });
    expect(await updateCurrentDuerpVersion({}, version({ cseConsultedOn: '2026-03-20', spstSentOn: '2026-04-01' }))).toMatchObject({ ok: true });
    const [after] = await (await db()).select().from(t.duerpVersions).where(eq(t.duerpVersions.version, '2026.1'));
    expect(after).toMatchObject({ spstSentOn: '2026-04-01', snapshot: row.snapshot });
  });

  it('commentaire : animateur QHSE et direction, texte obligatoire, journal ; lu avec la version', async () => {
    actAs('Chef de projet', 'site_a');
    expect((await addDuerpVersionComment({}, form({ version: '2026.1', body: 'x' }))).error).toBeTruthy();
    actAs('Direction', 'all');
    expect(await addDuerpVersionComment({}, form({ version: '2026.1', body: '' }))).toMatchObject({ fieldErrors: { body: expect.any(String) } });
    expect(await addDuerpVersionComment({}, form({ version: 'inconnue', body: 'x' }))).toEqual({ error: 'Version introuvable.' });
    expect(await addDuerpVersionComment({}, form({ version: '2026.1', body: 'Signée par le directeur le 25/03.' }))).toMatchObject({ ok: true });
    expect(await lastLog('duerp_version', '2026.1')).toMatchObject({ action: 'comment', byId: 'hmarchand', details: [{ field: 'Commentaire', from: null, to: 'Signée par le directeur le 25/03.' }] });
    const v = (await loadRisks()).versions.find((x) => x.version === '2026.1');
    expect(v).toMatchObject({ frozen: true, comments: [{ body: 'Signée par le directeur le 25/03.', author: '[H. Marchand]', on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }] });
  });
});

describe('DUE-07 : réévaluer le DUERP après un AT avec arrêt ou une gravité potentielle élevée', () => {
  it('échéance au responsable QHSE du site jusqu’à une version validée après l’événement ; arrêt seul : réservé santé', async () => {
    actAs('Animateur QHSE', 'site_a');
    const base = { occurredOn: '2026-10-05', location: 'Atelier montage', siteId: 'site_a', declarantId: 'tnguyen', pilotId: 'clefevre' };
    const grave = await createEvent({}, form({ ...base, type: 'PA', title: 'Chute de charge', severity: '4' }));
    const stop = await createEvent({}, form({ ...base, type: 'AT', title: 'Accident · atelier', severity: '1', injury: 'arret', victimKind: 'salarie', victimId: 'tnguyen' }));
    const minor = await createEvent({}, form({ ...base, type: 'PA', title: 'Glissade', severity: '2' }));
    const todo = (await loadRiskSignals()).todo;
    const of = (id: string) => todo.find((x) => x.key === `duerp-reevaluation|${id}`);
    expect(of(grave.id!)).toMatchObject({ siteId: 'site_a', ownerIds: ['clefevre'], title: expect.stringContaining(grave.id!) });
    expect(of(grave.id!)?.health).toBeUndefined();
    expect(of(stop.id!)).toMatchObject({ health: true });
    expect(of(stop.id!)?.title).not.toMatch(/arrêt|blessure/i);
    expect(of(minor.id!)).toBeUndefined();
    await (await db()).update(t.duerpVersions).set({ cseConsultedOn: '2026-10-06' }).where(eq(t.duerpVersions.version, '2026.1'));
    const after = (await loadRiskSignals()).todo;
    expect(after.some((x) => x.key?.startsWith('duerp-reevaluation|'))).toBe(false);
    await (await db()).update(t.duerpVersions).set({ cseConsultedOn: '2026-03-20' }).where(eq(t.duerpVersions.version, '2026.1'));
  });
});

describe('TDB-08 : transfert en masse des éléments ouverts d’un site archivé', () => {
  it('décompte, refus hors « Tous les sites » ou vers le même site, transfert journalisé dans l’archivage', async () => {
    const d = await db();
    const open = await siteOpenItems(d, ['site_b']);
    const total = Object.values(open).reduce((n, rows) => n + rows.length, 0);
    expect(total).toBeGreaterThan(0);
    actAs('Chef de service', 'all');
    expect(await archiveSite({}, form({ siteId: 'site_b', transferTo: 'site_a', reason: 'Site fermé' }))).toEqual({ error: "Réservé à l'animateur QHSE et à la direction." });
    actAs('Animateur QHSE', 'site_b');
    expect((await archiveSite({}, form({ siteId: 'site_b', transferTo: 'site_a', reason: 'Site fermé' }))).error).toMatch(/autre site que celui sélectionné/);
    actAs('Animateur QHSE', 'all');
    expect(await archiveSite({}, form({ siteId: 'site_b', transferTo: 'site_b', reason: 'Site fermé' }))).toMatchObject({ fieldErrors: { transferTo: expect.stringMatching(/autre site/) } });
    expect(await archiveSite({}, form({ siteId: 'site_b', transferTo: 'site_a' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    const r = await archiveSite({}, form({ siteId: 'site_b', transferTo: 'site_a', reason: 'Activité regroupée sur le site A' }));
    expect(r).toMatchObject({ ok: true, id: 'site_b', message: expect.stringContaining(`${total} élément`) });
    const left = await siteOpenItems(d, ['site_b']);
    expect(Object.values(left).every((rows) => rows.length === 0)).toBe(true);
    const ev = open.events[0];
    expect((await event(ev.id)).siteId).toBe('site_a');
    expect(await lastLog('event', ev.id)).toMatchObject({ reason: 'Activité regroupée sur le site A', details: [{ field: 'Site', from: expect.stringContaining('[Ville B]'), to: expect.stringContaining('[Ville A]') }] });
    expect((await changeLog('site', 'site_b')).map((e) => e.action)).toEqual(expect.arrayContaining(['transfer', 'archive']));
    expect((await changeLog('site', 'site_a')).map((e) => e.action)).toContain('transfer');
    const [site] = await d.select().from(t.sites).where(eq(t.sites.id, 'site_b'));
    expect(site.archiveReason).toBe('Activité regroupée sur le site A');
  });
});

describe('HAB-05 : responsabilités ouvertes d’une personne sortie, réaffectées en masse', () => {
  it('échéance, vue Personnel, réaffectation : animateur QHSE, personne présente, motif, journal et « Action confiée »', async () => {
    const d = await db();
    await d.update(t.people).set({ leftOn: '2026-10-01', leftReason: 'Départ' }).where(eq(t.people.id, 'jpetit'));
    actAs('Animateur QHSE', 'all');
    const signal = (await loadPeopleSignals()).todo.find((x) => x.key === 'personne-sortie-responsabilites|jpetit');
    expect(signal).toMatchObject({ kind: 'Personnel', title: expect.stringContaining('responsabilités à réaffecter') });
    const departed = (await loadPeopleAdmin())!.departed.find((p) => p.id === 'jpetit');
    expect(departed?.summary).toBeTruthy();
    const actions = (await d.select({ id: t.actions.id, status: t.actions.status }).from(t.actions).where(eq(t.actions.pilotId, 'jpetit')))
      .filter((a) => a.status !== 'verifiee' && a.status !== 'abandonnee').map((a) => a.id);

    actAs('Direction', 'all');
    expect(await reassignResponsibilities({}, form({ id: 'jpetit', targetId: 'sbenali', reason: 'Successeur' }))).toEqual({ error: QHSE_ONLY });
    actAs('Animateur QHSE', 'all');
    expect(await reassignResponsibilities({}, form({ id: 'jpetit', targetId: 'sbenali' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await reassignResponsibilities({}, form({ id: 'jpetit', targetId: 'jpetit', reason: 'x' }))).toMatchObject({ fieldErrors: { targetId: expect.any(String) } });
    expect(await reassignResponsibilities({}, form({ id: 'sbenali', targetId: 'clefevre', reason: 'x' }))).toMatchObject({ error: expect.stringContaining("encore à l'effectif") });
    const r = await reassignResponsibilities({}, form({ id: 'jpetit', targetId: 'sbenali', reason: 'Reprise par le responsable du site B' }));
    expect(r).toMatchObject({ ok: true, id: 'jpetit' });
    expect((await loadPeopleSignals()).todo.some((x) => x.key === 'personne-sortie-responsabilites|jpetit')).toBe(false);
    if (actions.length) {
      const moved = await d.select({ id: t.actions.id, pilotId: t.actions.pilotId }).from(t.actions).where(inArray(t.actions.id, actions));
      expect(moved.every((a) => a.pilotId === 'sbenali')).toBe(true);
      expect(await lastLog('action', actions[0])).toMatchObject({ reason: 'Reprise par le responsable du site B', details: [{ field: 'Responsable', from: '[J. Petit]', to: '[S. Benali]' }] });
      const notes = await d.select().from(t.notifications).where(and(eq(t.notifications.personId, 'sbenali'), eq(t.notifications.entityId, actions[0])));
      expect(notes.some((n) => n.type === 'action_confiee')).toBe(true);
    }
    expect((await changeLog('person', 'jpetit')).at(-1)).toMatchObject({ action: 'reassign', reason: 'Reprise par le responsable du site B' });
    expect(await reassignResponsibilities({}, form({ id: 'jpetit', targetId: 'sbenali', reason: 'Encore' }))).toEqual({ error: 'Aucune responsabilité ouverte à réaffecter.' });
  });
});

describe('D08-5 : type d’audit du programme', () => {
  it('éléments du jeu typés d’après leur ligne ; revue de direction reconnue', async () => {
    actAs('Animateur QHSE', 'all');
    const { plan } = await loadAudits({});
    expect(plan.length).toBeGreaterThan(0);
    for (const p of plan) expect(p.auditKind, p.label).toBe(inferAuditKind(p));
    expect(plan.some((p) => p.isReview && p.auditKind === 'revue_direction')).toBe(true);
  });
});
