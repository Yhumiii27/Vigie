import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, freshDemoDatabase, lastLog } from '../helpers';
import { and, eq, isNotNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadEventDetail, loadEventLinkOptions } from '@/lib/data/events';
import { loadReportPosts, loadSiteZones, resolveReportToken } from '@/lib/data/report-posts';
import { loadSitemap } from '@/lib/data/sitemap';
import { config } from '@/lib/config';
import { signReportToken } from '@/lib/report-token';
import { createEvent, createReport, regenerateReportPost, saveEvent } from '@/server/events';
import { archiveZone, saveActivity, saveShape, saveZone } from '@/server/sitemap';

// Paquet 7 — terrain et mobile (EVT-19) : zone de l'événement (QR code du poste ou formulaire), zones archivées au lieu
// d'être supprimées (droits, site, motif, journal, QR code imprimé), QR code d'une zone archivée (formulaire ouvert sur le
// site du poste, lieu à choisir). Jeu de démonstration au 09/10/2026 (src/db/seeds/field.ts). Signalement sans compte
// par le QR code d'une zone archivée : test/integration/field-report.test.ts.

freshDemoDatabase();

const DENIED = 'Votre rôle ne permet pas cette modification.';
const db = () => getDb();
const zoneNamed = async (siteId: string, name: string) => {
  const [z] = await (await db()).select().from(t.mapZones).where(and(eq(t.mapZones.siteId, siteId), eq(t.mapZones.name, name)));
  return z;
};
const eventRow = async (id: string) => (await (await db()).select().from(t.events).where(eq(t.events.id, id)))[0];
const tokenOf = (z: { id: number; siteId: string; qrVersion: number }) => signReportToken(config().reportSecret!, { siteId: z.siteId, zoneId: z.id, version: z.qrVersion });

/** Champs du formulaire d'un événement existant (modification), sans données de santé. */
const editForm = (e: Awaited<ReturnType<typeof eventRow>>, over: Record<string, string> = {}) => form({
  id: e.id, type: e.type, title: e.title, occurredOn: e.occurredOn, location: e.location, severity: String(e.severity), siteId: e.siteId,
  pilotId: e.pilotId ?? '', description: e.description, immediateMeasures: e.immediateMeasures, ...(e.ncOrigin ? { ncOrigin: e.ncOrigin } : {}),
  ...(e.envAspect ? { envAspect: e.envAspect } : {}), ...(e.envMedium ? { envMedium: e.envMedium } : {}),
  ...(e.customer ? { customer: e.customer } : {}), ...(e.customerRef ? { customerRef: e.customerRef } : {}),
  ...over,
});

describe('jeu de démonstration', () => {
  it('événements rattachés à leur zone ; une zone archivée avec son motif, hors de la carte et des postes', async () => {
    const montage = await zoneNamed('ville-a', 'Atelier montage');
    expect((await eventRow('EV-2026-131')).zoneId).toBe(montage.id);
    expect((await eventRow('EV-2026-129')).zoneId).toBe((await zoneNamed('ville-b', "Hall d'essais")).id);
    // Mise en service chez un client : aucune zone de la carte.
    expect((await eventRow('EV-2026-128')).zoneId).toBeNull();
    const archived = await zoneNamed('ville-a', 'Ancienne aire de charge des batteries');
    expect(archived).toMatchObject({ archivedById: 'clefevre', archiveReason: expect.stringContaining('aire démontée') });
    expect(await lastLog('site_map', 'ville-a')).toBeDefined();
    actAs('Animateur QHSE', 'ville-a');
    const map = await loadSitemap({});
    expect(map.zones.some((z) => z.id === archived.id)).toBe(false);
    expect(map.zones.find((z) => z.id === montage.id)).toMatchObject({ qrVersion: 1, eventCount: expect.any(Number) });
    expect((await loadReportPosts('ville-a')).some((p) => p.zoneId === archived.id)).toBe(false);
    expect((await loadSiteZones('ville-a')).some((z) => z.id === archived.id)).toBe(false);
    expect((await loadEventLinkOptions()).zones.some((z) => z.id === archived.id)).toBe(false);
  });
});

describe('archivage d’une zone (EVT-19)', () => {
  it('droits, site, motif, journal ; activités sans zone, événements gardent la zone ; QR code « poste disparu »', async () => {
    const quai = await zoneNamed('ville-a', 'Quai de chargement');
    const database = await db();
    const activities = await database.select({ id: t.siteActivities.id }).from(t.siteActivities).where(eq(t.siteActivities.zoneId, quai.id));
    expect(activities.length).toBeGreaterThan(0);
    // Un événement rattaché au quai (formulaire de l'écran Événements).
    actAs('Animateur QHSE', 'ville-a');
    const ev = await eventRow('EV-2026-115');
    expect(await saveEvent({}, editForm(ev, { zoneId: String(quai.id) }))).toEqual({ ok: true, id: ev.id });

    actAs('Salarié', 'ville-a');
    expect(await archiveZone({}, form({ id: String(quai.id), reason: 'Quai déplacé' }))).toEqual({ error: DENIED });
    actAs('Chef de service', 'ville-b');
    expect((await archiveZone({}, form({ id: String(quai.id), reason: 'Quai déplacé' }))).error).toMatch(/autre site/);
    actAs('Chef de service', 'ville-a');
    expect(await archiveZone({}, form({ id: String(quai.id) }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await archiveZone({}, form({ id: String(quai.id), reason: 'Quai déplacé côté est' }))).toEqual({ ok: true, id: String(quai.id) });

    const after = await zoneNamed('ville-a', 'Quai de chargement');
    expect(after).toMatchObject({ archivedById: 'sbenali', archiveReason: 'Quai déplacé côté est' });
    expect(after.archivedAt).toBeInstanceOf(Date);
    expect(await lastLog('site_map', 'ville-a')).toMatchObject({
      action: 'archive', reason: 'Quai déplacé côté est', byId: 'sbenali',
      summary: expect.stringContaining('« Quai de chargement » archivée'),
    });
    for (const a of activities) {
      expect((await database.select({ zoneId: t.siteActivities.zoneId }).from(t.siteActivities).where(eq(t.siteActivities.id, a.id)))[0].zoneId).toBeNull();
      expect(await lastLog('site_activity', a.id)).toMatchObject({ action: 'update', details: [{ field: 'Zone', from: 'Quai de chargement', to: null }] });
    }
    // L'événement garde sa zone, affichée « archivée » ; jamais de suppression.
    expect((await eventRow('EV-2026-115')).zoneId).toBe(quai.id);
    expect((await loadEventDetail('EV-2026-115'))?.zone).toEqual({ id: quai.id, name: 'Quai de chargement', siteId: 'ville-a', archived: true });

    // Zone archivée : ni modifiée, ni redessinée, ni archivée deux fois, ni QR code régénéré, ni choisie pour une activité.
    expect(await archiveZone({}, form({ id: String(quai.id), reason: 'Encore' }))).toEqual({ error: 'Cette zone est déjà archivée.' });
    expect(await saveZone({}, form({ id: String(quai.id), siteId: 'ville-a', name: 'Quai', kind: 'quai', notes: '' }))).toEqual({ error: 'Zone archivée : elle ne se modifie plus.' });
    expect(await saveShape('zone', quai.id, [[0, 0], [0.1, 0], [0.1, 0.1]])).toEqual({ error: 'Zone introuvable.' });
    expect(await regenerateReportPost({}, form({ id: String(quai.id), reason: 'Étiquette abîmée' }))).toEqual({ error: 'Zone archivée de la carte : son QR code ne se régénère plus.' });
    const activity = await saveActivity({}, form({
      siteId: 'ville-a', title: 'Contrôle des portes à quai', team: 'interne', ownerId: 'sbenali', startOn: '2026-10-12', endOn: '2026-10-12', zoneId: String(quai.id),
    }));
    expect(activity).toMatchObject({ fieldErrors: { zoneId: 'Zone archivée : choisissez une zone de la carte.' } });

    // QR code imprimé du quai : formulaire ouvert sur le site du poste, lieu à choisir.
    expect(await resolveReportToken(tokenOf(after))).toEqual({ status: 'archived', post: { zoneId: quai.id, name: 'Quai de chargement', siteId: 'ville-a', siteLabel: expect.any(String) } });
    actAs('Salarié', 'ville-b');
    const jeton = tokenOf(after);
    expect(await createReport(form({ type: 'SD', description: 'Porte à quai bloquée ouverte.', jeton }))).toEqual({ error: "Ce poste n'existe plus : choisissez le lieu." });
    const magasin = await zoneNamed('ville-a', 'Magasin');
    const r = await createReport(form({ type: 'SD', description: 'Porte à quai bloquée ouverte.', jeton, zoneId: String(magasin.id) }));
    expect(r.id).toBeTruthy();
    // Site du poste (même hors du site sélectionné), zone choisie, lieu = nom de la zone.
    expect(await eventRow(r.id!)).toMatchObject({ siteId: 'ville-a', zoneId: magasin.id, location: 'Magasin', reportedVia: 'session' });
    // Zone d'un autre site que celui du poste : refusée sans jeton valide… et ignorée avec une session (lieu en texte gardé).
    const hall = await zoneNamed('ville-b', "Hall d'essais");
    const other = await createReport(form({ type: 'SD', description: 'Test.', jeton, zoneId: String(hall.id), location: 'Quai est' }));
    expect(await eventRow(other.id!)).toMatchObject({ siteId: 'ville-a', zoneId: null, location: 'Quai est' });
  });
});

describe('zone de l’événement (EVT-19)', () => {
  it('formulaire de l’écran Événements : zone du site, lieu repris, journal ; zone d’un autre site ou archivée refusée', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const usinage = await zoneNamed('ville-a', 'Atelier usinage');
    const hall = await zoneNamed('ville-b', "Hall d'essais");
    const archived = await zoneNamed('ville-a', 'Ancienne aire de charge des batteries');
    const base = { type: 'SD', title: 'Allée encombrée', occurredOn: '2026-10-08', severity: '2', siteId: 'ville-a', description: 'Palettes dans l’allée.', immediateMeasures: '', declarantId: 'clefevre' };
    expect(await createEvent({}, form({ ...base, location: '', zoneId: String(hall.id) }))).toMatchObject({ fieldErrors: { zoneId: "Cette zone appartient à la carte d'un autre site." } });
    expect(await createEvent({}, form({ ...base, location: '', zoneId: String(archived.id) }))).toMatchObject({ fieldErrors: { zoneId: 'Zone archivée : choisissez une zone de la carte.' } });
    // Ni lieu ni zone : lieu obligatoire.
    expect(await createEvent({}, form({ ...base, location: '' }))).toMatchObject({ fieldErrors: { location: expect.any(String) } });
    const created = await createEvent({}, form({ ...base, location: '', zoneId: String(usinage.id) }));
    expect(created).toMatchObject({ ok: true });
    expect(await eventRow(created.id!)).toMatchObject({ zoneId: usinage.id, location: 'Atelier usinage' });

    // Modification : zone changée et journalisée ; champ absent (ancien formulaire) : zone gardée ; site changé : zone retirée.
    const e = await eventRow(created.id!);
    const montage = await zoneNamed('ville-a', 'Atelier montage');
    expect(await saveEvent({}, editForm(e, { zoneId: String(montage.id) }))).toEqual({ ok: true, id: e.id });
    expect(await lastLog('event', e.id)).toMatchObject({ action: 'update', details: expect.arrayContaining([{ field: 'Zone de la carte', from: 'Atelier usinage', to: 'Atelier montage' }]) });
    expect(await saveEvent({}, editForm(await eventRow(e.id), { location: 'Allée centrale' }))).toEqual({ ok: true, id: e.id });
    expect(await eventRow(e.id)).toMatchObject({ zoneId: montage.id, location: 'Allée centrale' });
    actAs('Animateur QHSE', 'all');
    expect(await saveEvent({}, editForm(await eventRow(e.id), { siteId: 'ville-b' }))).toEqual({ ok: true, id: e.id });
    expect(await eventRow(e.id)).toMatchObject({ siteId: 'ville-b', zoneId: null });
    expect(await lastLog('event', e.id)).toMatchObject({ details: expect.arrayContaining([{ field: 'Zone de la carte', from: 'Atelier montage', to: null }]) });

    // Zone archivée déjà portée par l'événement : conservée à la modification.
    actAs('Animateur QHSE', 'ville-a');
    const kept = await eventRow('EV-2026-117');
    await (await db()).update(t.events).set({ zoneId: archived.id }).where(eq(t.events.id, kept.id));
    expect(await saveEvent({}, editForm(await eventRow(kept.id), { zoneId: String(archived.id), title: 'Éclairage défaillant (allée)' }))).toEqual({ ok: true, id: kept.id });
    expect((await eventRow(kept.id)).zoneId).toBe(archived.id);
  });

  it('signalement d’une personne connectée : zone du QR code, ou choisie dans le formulaire ; zone inconnue ignorée', async () => {
    actAs('Salarié', 'ville-a');
    const montage = await zoneNamed('ville-a', 'Atelier montage');
    const fromQr = await createReport(form({ type: 'PA', description: 'Élingue usée.', jeton: tokenOf(montage), location: 'Poste M2' }));
    expect(await eventRow(fromQr.id!)).toMatchObject({ siteId: 'ville-a', zoneId: montage.id, location: 'Poste M2' });
    const magasin = await zoneNamed('ville-a', 'Magasin');
    const chosen = await createReport(form({ type: 'PA', description: 'Rack déformé.', zoneId: String(magasin.id) }));
    expect(await eventRow(chosen.id!)).toMatchObject({ siteId: 'ville-a', zoneId: magasin.id, location: 'Magasin' });
    const unknown = await createReport(form({ type: 'PA', description: 'Test.', zoneId: '999999', location: 'Parking' }));
    expect(await eventRow(unknown.id!)).toMatchObject({ zoneId: null, location: 'Parking' });
    // Aucun signalement ne rattache une zone archivée.
    const archived = await (await db()).select({ id: t.mapZones.id }).from(t.mapZones).where(isNotNull(t.mapZones.archivedAt));
    const viaArchived = await createReport(form({ type: 'PA', description: 'Test.', zoneId: String(archived[0].id), location: 'Ancienne aire' }));
    expect((await eventRow(viaArchived.id!)).zoneId).toBeNull();
  });
});
