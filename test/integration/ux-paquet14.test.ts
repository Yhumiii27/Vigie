import '../next-mocks';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { actAs, changeLog, freshDemoDatabase } from '../helpers';
import { getDb, schema as t } from '@/db';
import { loadAudits, loadAuditSignals } from '@/lib/data/audits';
import { loadMyReport, loadNewEventDefaults, loadVisibleEvents } from '@/lib/data/events';
import { loadSkillMatrix } from '@/lib/data/skills';
import { loadWatch } from '@/lib/data/watch';
import { todoKey } from '@/lib/domain';
import { prefillType } from '@/lib/event-prefill';
import { moveTitle } from '@/server/skills';

// Paquet 14 — ergonomie des écrans : « Nouvel événement » prérempli sans rien révéler hors du périmètre (EVT-24), vue
// déclarant (EVT-27), réordonnancement des titres suivis (HAB-15), lien profond vers un référentiel (AUD-19), audits sans
// constat (AUD-29), tri des exigences par échéance (VEI-13).

freshDemoDatabase();
const db = () => getDb();

describe('EVT-24 : « Nouvel événement » prérempli depuis une fiche', () => {
  it('contrôle, risque et document visibles : site, lieu ou équipement et rattachement repris', async () => {
    actAs('Chef de service', 'ville-a');
    const d = await db();
    const [control] = await d.select().from(t.controls).where(and(eq(t.controls.siteId, 'ville-a'), isNull(t.controls.archivedAt))).limit(1);
    expect(await loadNewEventDefaults({ controle: String(control.id) })).toMatchObject({ siteId: 'ville-a', equipment: control.equipment, controlId: control.id });
    const [risk] = await d.select({ id: t.risks.id, unit: t.workUnits.label }).from(t.risks).innerJoin(t.workUnits, eq(t.risks.unitId, t.workUnits.id))
      .where(and(eq(t.workUnits.siteId, 'ville-a'), isNull(t.risks.archivedAt), isNull(t.workUnits.archivedAt))).limit(1);
    expect(await loadNewEventDefaults({ risque: String(risk.id) })).toMatchObject({ siteId: 'ville-a', location: risk.unit, riskId: risk.id });
    const [doc] = await d.select().from(t.documents).limit(1);
    expect(await loadNewEventDefaults({ document: doc.id })).toMatchObject({ documentId: doc.id });
    // Type proposé par l'écran Environnement ; jamais une maladie professionnelle.
    expect(await loadNewEventDefaults({ type: prefillType('ENV') })).toMatchObject({ type: 'ENV', controlId: null, riskId: null });
    expect(prefillType('MP')).toBeUndefined();
  });

  it('élément d’un autre site, archivé ou inconnu : ignoré, rien n’est révélé', async () => {
    actAs('Chef de service', 'ville-b');
    const d = await db();
    const [control] = await d.select().from(t.controls).where(eq(t.controls.siteId, 'ville-a')).limit(1);
    const [risk] = await d.select({ id: t.risks.id }).from(t.risks).innerJoin(t.workUnits, eq(t.risks.unitId, t.workUnits.id)).where(eq(t.workUnits.siteId, 'ville-a')).limit(1);
    expect(await loadNewEventDefaults({ controle: String(control.id) })).toBeNull();
    expect(await loadNewEventDefaults({ risque: String(risk.id) })).toBeNull();
    expect(await loadNewEventDefaults({ controle: '999999', risque: 'abc', document: 'DOC-INCONNU' })).toBeNull();
    actAs('Chef de service', 'ville-a');
    await d.update(t.risks).set({ archivedAt: new Date(), archivedById: 'clefevre', archiveReason: 'Essai de préremplissage' }).where(eq(t.risks.id, risk.id));
    expect(await loadNewEventDefaults({ risque: String(risk.id) })).toBeNull();
    await d.update(t.risks).set({ archivedAt: null, archivedById: null, archiveReason: null }).where(eq(t.risks.id, risk.id));
  });
});

describe('EVT-27 : vue déclarant', () => {
  it('le Salarié lit ses signalements sur tout son périmètre, quel que soit le site sélectionné', async () => {
    const d = await db();
    const mine = await d.select({ id: t.events.id, siteId: t.events.siteId }).from(t.events)
      .where(and(eq(t.events.declarantId, 'tnguyen'), eq(t.events.anonymous, false)));
    expect(mine.length).toBeGreaterThan(0);
    const other = mine[0].siteId === 'ville-a' ? 'ville-b' : 'ville-a';
    actAs('Salarié', other);
    const visible = await loadVisibleEvents();
    expect(visible.map((e) => e.id).sort()).toEqual(mine.map((e) => e.id).sort());
    // Rien d'autre que ses propres signalements nominatifs.
    expect(visible.every((e) => e.declarantId === 'tnguyen' && !e.anonymous)).toBe(true);
  });

  it('photos du signalement montrées au déclarant, jamais une pièce médicale', async () => {
    const d = await db();
    const [ev] = await d.select({ id: t.events.id }).from(t.events).where(and(eq(t.events.declarantId, 'tnguyen'), eq(t.events.anonymous, false), ne(t.events.type, 'MP'))).limit(1);
    const photo = randomUUID();
    const medical = randomUUID();
    await d.insert(t.attachments).values([
      { id: photo, entityType: 'event', entityId: ev.id, fileName: 'fuite.jpg', mimeType: 'image/jpeg', size: 10, storagePath: 'essai/fuite.jpg', uploadedBy: 'tnguyen' },
      { id: medical, entityType: 'event', entityId: ev.id, fileName: 'certificat.jpg', mimeType: 'image/jpeg', size: 10, storagePath: 'essai/certificat.jpg', health: true },
    ]);
    actAs('Salarié', 'ville-a');
    const r = (await loadMyReport(ev.id))!;
    expect(r.photos.map((p) => p.id)).toContain(photo);
    expect(r.photos.map((p) => p.id)).not.toContain(medical);
    expect(r.photos.find((p) => p.id === photo)).toEqual({ id: photo, url: `/fichiers/${photo}`, name: 'fuite.jpg' });
    expect(r.photoCount).toBe(r.photos.length);
    // Un autre salarié ne lit pas ce signalement.
    actAs('Animateur QHSE', 'ville-a');
    expect(await loadMyReport(ev.id)).toBeNull();
  });
});

describe('HAB-15 : réordonnancement des titres suivis', () => {
  const order = async () => (await (await db()).select({ id: t.trainingTitles.id }).from(t.trainingTitles)
    .where(isNull(t.trainingTitles.archivedAt)).orderBy(asc(t.trainingTitles.sort), asc(t.trainingTitles.id))).map((x) => x.id);

  it('réservé au service QHSE et à la direction', async () => {
    const before = await order();
    actAs('Chef de service', 'ville-a');
    expect(await moveTitle(before[1], 'up')).toEqual({ error: expect.any(String) });
    actAs('Salarié', 'ville-a');
    expect(await moveTitle(before[1], 'up')).toEqual({ error: expect.any(String) });
    expect(await order()).toEqual(before);
  });

  it('déplacement d’un rang, journalisé ; bornes et titre inconnu sans effet', async () => {
    const before = await order();
    actAs('Animateur QHSE', 'ville-a');
    expect(await moveTitle(before[1], 'up')).toEqual({});
    const after = await order();
    expect(after.slice(0, 2)).toEqual([before[1], before[0]]);
    expect(after.slice(2)).toEqual(before.slice(2));
    const log = (await changeLog('training_title', before[1])).at(-1)!;
    expect(log).toMatchObject({ action: 'move', summary: expect.stringMatching(/placé avant/) });
    // Ordre repris par les colonnes de la matrice.
    expect((await loadSkillMatrix()).titles.map((x) => x.id)).toEqual(after);
    // Premier titre vers le haut : rien ne change, rien n'est journalisé.
    const entries = (await changeLog('training_title', after[0])).length;
    expect(await moveTitle(after[0], 'up')).toEqual({});
    expect(await order()).toEqual(after);
    expect((await changeLog('training_title', after[0])).length).toBe(entries);
    expect(await moveTitle('inconnu', 'down')).toEqual({ error: expect.stringMatching(/introuvable/) });
    actAs('Direction', 'all');
    expect(await moveTitle(after[0], 'down')).toEqual({});
    expect(await order()).toEqual(before);
  });
});

describe('AUD-19 : lien profond vers un référentiel', () => {
  it('les échéances de certification ouvrent le référentiel, clé d’état lu inchangée', async () => {
    actAs('Animateur QHSE', 'all');
    const d = await db();
    const [cert] = await d.select().from(t.certifications).where(eq(t.certifications.tone, 'ok')).limit(1);
    await d.update(t.certifications).set({ suspendedOn: '2026-10-01', suspendReason: 'Essai AUD-19' }).where(eq(t.certifications.id, cert.id));
    const item = (await loadAuditSignals()).todo.find((x) => x.kind === 'Certification' && x.title.includes('suspendu'))!;
    expect(item.href).toBe(`/audits?referentiel=${cert.id}`);
    expect(todoKey(item)).toBe(`Certification|/audits|${item.title}|danger|2026-10-01`);
    await d.update(t.certifications).set({ suspendedOn: null, suspendReason: null }).where(eq(t.certifications.id, cert.id));
    // Indicateur de la veille rattaché à la certification (VEI-12).
    const req = (await loadWatch()).requirements.find((r) => r.linkedTo === 'certification' && r.certificationId === cert.id);
    if (req) expect(req.indicator?.href).toBe(`/audits?referentiel=${cert.id}`);
  });
});

describe('AUD-29 : audits sans constat dans la liste des constats', () => {
  it('audit réalisé sans constat : groupe vide, sur son site seulement', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const d = await db();
    const [item] = await d.insert(t.auditPlanItems).values({
      year: 2026, month: 9, track: 'Production', label: '[AUD-29] Audit sans constat', done: true, doneOn: '2026-09-15', siteId: 'ville-a',
    }).returning();
    const onA = await loadAudits({ year: '2026' });
    const g = onA.auditGroups.find((x) => x.planItemId === item.id);
    expect(g).toMatchObject({ findings: [], date: '2026-09-15' });
    // Les groupes restent triés du plus récent au plus ancien.
    const dates = onA.auditGroups.map((x) => x.date ?? '');
    expect([...dates].sort().reverse()).toEqual(dates);
    actAs('Animateur QHSE', 'ville-b');
    expect((await loadAudits({ year: '2026' })).auditGroups.some((x) => x.planItemId === item.id)).toBe(false);
  });
});

describe('VEI-13 : échéance triable des exigences', () => {
  it('dueSort : date de l’échéance affichée (prochain contrôle, DUERP, date saisie)', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const { requirements } = await loadWatch();
    for (const r of requirements) {
      if (r.dueSort) expect(r.dueSort).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (r.dueFromControl) expect(r.dueSort).not.toBeNull();
      if (!r.dueFromControl && r.linkedTo !== 'duerp') expect(r.dueSort).toBe(r.dueOn ?? null);
    }
  });
});
