import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cookieJar, form } from '../next-mocks';
import { actAs, freshDemoDatabase } from '../helpers';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { isSiret } from '@/lib/siret';

// Fondation du lot 2 : migration 0004 (reprise AUD-01), jeu de démonstration (DAT, registre des accidents bénins,
// PAPRIPACT, registre DUERP, liens réels des actions, mentions du registre des déchets), échéances calculées sur le
// périmètre (siteId) puis filtrées par site sélectionné, écrans en consultation seule, écritures réservées à canEdit.

freshDemoDatabase();

describe('jeu de démonstration du lot 2', () => {
  it('accidents du travail : rubriques de la déclaration, intitulés neutres, registre des accidents bénins', async () => {
    const db = await getDb();
    const ats = await db.select().from(t.events).where(eq(t.events.type, 'AT'));
    expect(ats.length).toBeGreaterThan(0);
    expect(ats.every((e) => e.victimKind === 'salarie' && !!e.victimId && !!e.circumstances)).toBe(true);
    const at119 = ats.find((e) => e.id === 'EV-2026-119')!;
    expect(at119).toMatchObject({ title: 'Chute en descendant de la plateforme PIRL', lesionNature: 'Entorse', lesionSite: 'Cheville droite', occurredTime: '15:45' });
    // La lésion n'est plus dans l'intitulé ni la description (SEC-06).
    expect(ats.some((e) => /entorse|coupure superficielle|pincement|œil|cheville|index gauche|majeur/i.test(`${e.title} ${e.description}`))).toBe(false);

    const register = await db.select().from(t.benignAccidents).orderBy(t.benignAccidents.number);
    expect(register.map((r) => [r.siteId, r.number, r.eventId, r.caregiverId])).toEqual([
      ['ville-a', 1, 'EV-2026-118', 'sbenali'],
      ['ville-a', 2, 'EV-2026-120', 'proux'],
    ]);
    expect(register[0].signedOn).toBeNull();
    const [sst] = await db.select().from(t.trainingTitles).where(eq(t.trainingTitles.firstAid, true));
    expect(sst.id).toBe('sst');
  });

  it('une seule inscription active par événement ; numéro unique par site', async () => {
    const db = await getDb();
    const base = { siteId: 'ville-a', eventId: 'EV-2026-118', careGivenAt: new Date(), caregiverQualification: 'sst', care: 'x' };
    await expect(db.insert(t.benignAccidents).values({ ...base, number: 99 })).rejects.toThrow();
    await expect(db.insert(t.benignAccidents).values({ ...base, eventId: 'EV-2026-127', number: 1 })).rejects.toThrow();
  });

  it('DUERP : registre des mises à disposition et PAPRIPACT 2026 en préparation', async () => {
    const db = await getDb();
    const requests = await db.select().from(t.duerpAccessRequests);
    expect(requests.map((r) => r.requesterKind)).toEqual(['cse', 'medecin', 'ancien_salarie']);
    expect(requests.filter((r) => !r.communicatedOn)).toHaveLength(1);
    const [program] = await db.select().from(t.preventionPrograms);
    expect(program).toMatchObject({ year: 2026, duerpVersion: '2026.1', frozenAt: null, cseConsultedOn: null, snapshot: null });
    const lines = await db.select().from(t.preventionProgramActions);
    expect(lines.map((l) => l.actionId).sort()).toEqual(['A-201', 'A-203', 'A-205', 'A-214']);
    expect(lines.find((l) => l.actionId === 'A-203')?.estimatedCost).toBe(12000);
  });

  it('audits : échéances des revues rattachées, élément reporté, élément annulé', async () => {
    const db = await getDb();
    const items = await db.select().from(t.auditPlanItems).orderBy(t.auditPlanItems.id);
    const reviews = await db.select().from(t.reviews);
    const linked = items.filter((p) => p.reviewId != null);
    expect(linked.map((p) => [p.plannedOn, reviews.find((r) => r.id === p.reviewId)?.reviewOn])).toEqual([
      ['2026-06-18', '2026-06-18'],
      ['2026-12-10', '2026-12-10'],
    ]);
    expect(items.find((p) => p.label === 'BE · 17/10')?.postponedFrom).toBe('2026-09-17');
    expect(items.filter((p) => p.cancelledAt).map((p) => p.label)).toEqual(['Logistique']);
  });

  it('migration 0004 : la reprise AUD-01 rattache les échéances de revue à leur revue (même date)', async () => {
    const db = await getDb();
    await db.update(t.auditPlanItems).set({ reviewId: null });
    const migration = readFileSync(path.join(process.cwd(), 'drizzle/0004_compliance.sql'), 'utf8');
    const backfill = migration.split('--> statement-breakpoint').map((s) => s.trim()).find((s) => s.includes('AUD-01'))!;
    await db.execute(sql.raw(backfill.split('\n').filter((l) => !l.startsWith('--')).join('\n')));
    const linked = await db.select({ plannedOn: t.auditPlanItems.plannedOn }).from(t.auditPlanItems).where(isNotNull(t.auditPlanItems.reviewId));
    expect(linked.map((p) => p.plannedOn).sort()).toEqual(['2026-06-18', '2026-12-10']);
  });

  it('actions : sources d’origine portées par des colonnes dédiées (ACT-01)', async () => {
    const db = await getDb();
    const rows = await db.select().from(t.actions).where(inArray(t.actions.id, ['A-206', 'A-216', 'A-208', 'A-219', 'A-218', 'A-220']));
    const by = new Map(rows.map((a) => [a.id, a]));
    expect(by.get('A-206')?.preventionPlanId).toBe('PP-2026-012');
    expect(by.get('A-220')?.preventionPlanId).toBe('PP-2026-008');
    expect(by.get('A-216')?.permitId).toBe('PF-2026-031');
    expect(by.get('A-208')?.documentId).toBe('PR-QHSE-002');
    expect(by.get('A-219')?.wasteStreamId).toBe('FD-04');
    expect(by.get('A-218')?.wasteEntryId).toEqual(expect.any(Number));
  });

  it('prévention : contenu réglementaire des plans signés, écart passé PP-2026-008', async () => {
    const db = await getDb();
    const plans = await db.select().from(t.preventionPlans);
    const signed = plans.filter((p) => p.status === 'signe' || p.status === 'clos');
    expect(signed.every((p) => p.dangerousPhases && p.equipment && p.workerInstructions && p.emergencyOrganisation && p.coordination && p.sirPosts)).toBe(true);
    expect(plans.find((p) => p.id === 'PP-2026-008')).toMatchObject({ startOn: '2026-04-13', firstSignedOn: '2026-04-14', status: 'clos' });
    expect(plans.find((p) => p.id === 'PP-2026-014')?.firstSignedOn).toBe('2026-01-09');
    expect(plans.find((p) => p.id === 'PP-2026-013')?.firstSignedOn).toBeNull();
  });

  it('déchets : SIRET des sites, mentions des filières, transporteur distinct sans mentions', async () => {
    const db = await getDb();
    const sites = await db.select().from(t.sites).where(inArray(t.sites.id, ['ville-a', 'ville-b']));
    expect(sites.every((s) => !!s.siret && isSiret(s.siret))).toBe(true);
    const streams = await db.select().from(t.wasteStreams);
    expect(streams.every((s) => isSiret(s.collectorSiret!) && isSiret(s.destinationSiret!) && !!s.qualification)).toBe(true);
    const entries = await db.select().from(t.wasteEntries);
    const benne = entries.filter((e) => e.transporter === '[Transports Benne Express]');
    expect(benne.length).toBe(5);
    expect(benne.every((e) => e.transporterSiret === null && e.destinationSiret !== null)).toBe(true);
    expect(entries.filter((e) => e.transporter !== '[Transports Benne Express]').every((e) => e.transporterSiret !== null)).toBe(true);
  });
});

describe('échéances : périmètre, site sélectionné, consultation seule (fondation TDB-02 / TDB-05)', () => {
  it('signaux calculés sur tout le périmètre (siteId), affichés pour le site sélectionné', async () => {
    const { loadTodo, loadVisibleTodo } = await import('@/lib/data/todo');
    actAs('Animateur QHSE', 'ville-a');
    const all = await loadTodo();
    expect(all.every((x) => x.siteId === null || ['ville-a', 'ville-b'].includes(x.siteId))).toBe(true);
    expect(all.some((x) => x.siteId === 'ville-b')).toBe(true);
    const onA = await loadVisibleTodo();
    // Autre site du périmètre : seulement les échéances de la personne, marquées « elsewhere » (TDB-05).
    expect(onA.filter((x) => x.siteId === 'ville-b').every((x) => x.elsewhere && x.ownerIds?.includes('clefevre'))).toBe(true);
    expect(onA.filter((x) => x.siteId === 'ville-b').length).toBeLessThan(all.filter((x) => x.siteId === 'ville-b').length);
    expect(onA.some((x) => x.siteId === null)).toBe(true);
  });

  it('écran en consultation seule : seules les échéances de la personne (contribution à la revue, visite sécurité)', async () => {
    const { loadVisibleTodo } = await import('@/lib/data/todo');
    actAs('Chef de service', 'ville-a');
    const todo = await loadVisibleTodo();
    const audits = todo.filter((x) => x.href?.startsWith('/audits'));
    expect(audits.length).toBeGreaterThan(0);
    expect(audits.every((x) => x.ownerIds?.includes('sbenali'))).toBe(true);
    expect(audits.some((x) => x.title.startsWith("Retour d'expérience des visites sécurité"))).toBe(true);
    cookieJar.clear();
  });
});

describe('écrans ouverts en consultation : écritures refusées', () => {
  const DENIED = 'Votre rôle ne permet pas cette modification.';
  it('audits (AUD-02) et DUERP (DUE-01) : consultation seule pour l’encadrement sans saisie', async () => {
    const { cancelFinding } = await import('@/server/audits');
    const { archiveRisk } = await import('@/server/risks');
    const db = await getDb();
    const [finding] = await db.select({ id: t.auditFindings.id }).from(t.auditFindings).limit(1);
    const [risk] = await db.select({ id: t.risks.id }).from(t.risks).innerJoin(t.workUnits, eq(t.risks.unitId, t.workUnits.id))
      .where(and(eq(t.workUnits.siteId, 'ville-a')));
    for (const role of ['Chef de service', 'Chef de projet'] as const) {
      actAs(role, 'ville-a');
      expect(await cancelFinding({}, form({ id: String(finding.id), reason: 'test' }))).toMatchObject({ error: DENIED });
    }
    for (const role of ['Chef de projet', 'Salarié'] as const) {
      actAs(role, 'ville-a');
      expect((await archiveRisk({}, form({ id: String(risk.id), reason: 'test' }))).error).toBeTruthy();
    }
    cookieJar.clear();
  });
});
