import { describe, expect, it } from 'vitest';
import '../next-mocks';
import { actAs, freshDemoDatabase } from '../helpers';
import { asc, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadAudits } from '@/lib/data/audits';
import { loadEnvironment } from '@/lib/data/environment';
import { loadDuerpAccessRegister, loadRisks } from '@/lib/data/risks';
import { loadEntityHistory, type HistoryEntity } from '@/server/history';

// QUA-11 (fin, classe 1 lot A) : historiques des risques, des demandes d'accès au DUERP, des audits (programme, constats,
// certifications) et de l'environnement (filières, enlèvements) chargés à l'ouverture de la fiche (LazyChangeLog), avec
// les droits de l'écran et le site sélectionné ; ils ne partent plus avec toute la liste.

freshDemoDatabase();

const NOT_FOUND = { error: 'Historique introuvable.' };
const opened = (entity: HistoryEntity, id: string | number) => loadEntityHistory(entity, String(id));

describe('QUA-11 : écrans sans journal dans leur charge', () => {
  it('risques, audits et environnement ne transportent plus d’historique', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const [risks, audits, env, register] = await Promise.all([loadRisks(), loadAudits({}), loadEnvironment(), loadDuerpAccessRegister()]);
    const json = JSON.stringify({ risks, audits, env, register });
    expect(json).not.toMatch(/"(history|log)":\[/);
  });
});

describe('QUA-11 : historique à l’ouverture de la fiche', () => {
  it('risque et unité archivée : rôles qui modifient le DUERP, site de l’unité', async () => {
    const db = await getDb();
    const [risk] = await db.select({ id: t.risks.id, siteId: t.workUnits.siteId }).from(t.risks)
      .innerJoin(t.workUnits, eq(t.workUnits.id, t.risks.unitId)).where(eq(t.workUnits.siteId, 'ville-a')).orderBy(asc(t.risks.id)).limit(1);
    actAs('Animateur QHSE', 'ville-a');
    expect(await opened('risk', risk.id)).toMatchObject({ entries: expect.any(Array) });
    actAs('Animateur QHSE', 'ville-b');
    expect(await opened('risk', risk.id)).toEqual(NOT_FOUND);
    actAs('Chef de projet', 'ville-a');
    expect(await opened('risk', risk.id)).toEqual(NOT_FOUND);
    actAs('Salarié', 'ville-a');
    expect(await opened('risk', risk.id)).toEqual(NOT_FOUND);
    expect(await opened('risk', 'x')).toEqual(NOT_FOUND);
  });

  it('programme d’audit, constat, certification : lecteurs de l’écran Audits, site de l’élément', async () => {
    const db = await getDb();
    const [item] = await db.select().from(t.auditPlanItems).orderBy(asc(t.auditPlanItems.id)).limit(1);
    const [finding] = await db.select().from(t.auditFindings).orderBy(asc(t.auditFindings.id)).limit(1);
    const [cert] = await db.select().from(t.certifications).orderBy(asc(t.certifications.sort)).limit(1);
    actAs('Animateur QHSE', 'all');
    for (const [entity, id] of [['audit_plan_item', item.id], ['audit_finding', finding.id], ['certification', cert.id]] as const) {
      expect(await opened(entity, id), entity).toMatchObject({ entries: expect.any(Array) });
    }
    // Encadrement en consultation : lit l'historique comme l'écran ; Salarié : écran fermé.
    actAs('Chef de service', item.siteId ?? 'ville-a');
    expect(await opened('audit_plan_item', item.id)).toMatchObject({ entries: expect.any(Array) });
    actAs('Salarié', 'ville-a');
    expect(await opened('audit_plan_item', item.id)).toEqual(NOT_FOUND);
    expect(await opened('certification', cert.id)).toEqual(NOT_FOUND);
    // Élément d'un site : refusé depuis un autre site.
    await db.update(t.auditFindings).set({ siteId: 'ville-b' }).where(eq(t.auditFindings.id, finding.id));
    actAs('Animateur QHSE', 'ville-a');
    expect(await opened('audit_finding', finding.id)).toEqual(NOT_FOUND);
    actAs('Animateur QHSE', 'ville-b');
    expect(await opened('audit_finding', finding.id)).toMatchObject({ entries: expect.any(Array) });
    await db.update(t.auditFindings).set({ siteId: finding.siteId }).where(eq(t.auditFindings.id, finding.id));
  });

  it('filière et enlèvement : écran Environnement, site de la fiche', async () => {
    const db = await getDb();
    const [stream] = await db.select().from(t.wasteStreams).where(eq(t.wasteStreams.siteId, 'ville-a')).limit(1);
    const [entry] = await db.select().from(t.wasteEntries).where(eq(t.wasteEntries.siteId, 'ville-a')).limit(1);
    actAs('Animateur QHSE', 'ville-a');
    expect(await opened('waste_stream', stream.id)).toMatchObject({ entries: expect.any(Array) });
    expect(await opened('waste_entry', entry.id)).toMatchObject({ entries: expect.any(Array) });
    actAs('Animateur QHSE', 'ville-b');
    expect(await opened('waste_stream', stream.id)).toEqual(NOT_FOUND);
    expect(await opened('waste_entry', entry.id)).toEqual(NOT_FOUND);
    actAs('Chef de service', 'ville-a');
    expect(await opened('waste_entry', entry.id)).toEqual(NOT_FOUND);
  });

  it('demande d’accès au DUERP : validateurs qui modifient le DUERP', async () => {
    const [req] = await (await getDb()).select().from(t.duerpAccessRequests).limit(1);
    actAs('Animateur QHSE', req.siteId ?? 'all');
    expect(await opened('duerp_access_request', req.id)).toMatchObject({ entries: expect.any(Array) });
    actAs('Chef de service', req.siteId ?? 'ville-a');
    expect(await opened('duerp_access_request', req.id)).toEqual(NOT_FOUND);
  });
});
