import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, file, formWith, freshDemoDatabase } from '../helpers';
import { actionRow, NEW_ACTION } from './actions-helpers';
import { eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { MP_TITLE } from '@/lib/rules/events';
import { HEALTH_EVENT_TYPES } from '@/lib/domain';
import { addEventFiles } from '@/server/events';
import { saveAction } from '@/server/plan';
import { moveAction, verifyAction } from '@/server/plan-ui';

// Vues pub_ et données de santé (audit de cohérence Vigie / Matrix / Keystone du 22/10/2026), sur la base de
// démonstration (PGlite, ou PostgreSQL avec TEST_DATABASE_URL) :
//  - É13 : un accident du travail ou une maladie professionnelle ne fait pas apparaître un projet Keystone dans
//    pub_hse_projet (migration 0013) ;
//  - non-régression : le cycle complet d'une action née d'une maladie professionnelle (création depuis l'événement,
//    avancement, vérification « non efficace » avec action de suite) ne fait sortir dans pub_journal ni l'intitulé
//    imposé, ni le libellé du type, ni une entrée de l'événement.

freshDemoDatabase();

const MP = 'EV-2026-134';
const HEALTH_TYPES = ['AT', ...HEALTH_EVENT_TYPES];
type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => {
  const r = (await (await getDb()).execute(q)) as unknown as { rows: Row[] };
  return r.rows;
};

describe('pub_hse_projet : ni accident du travail ni maladie professionnelle (É13)', () => {
  it('projet porté seulement par un AT ou une MP : absent ; par un presqu’accident : présent', async () => {
    const db = await getDb();
    const [at] = await db.select({ id: t.events.id }).from(t.events).where(eq(t.events.type, 'AT')).limit(1);
    expect(at).toBeDefined();
    await db.update(t.events).set({ keystoneProjectCode: 'TST-AT1' }).where(eq(t.events.id, at.id));
    await db.update(t.events).set({ keystoneProjectCode: 'TST-MP1' }).where(eq(t.events.id, MP));
    const [pa] = await db.select({ id: t.events.id }).from(t.events).where(eq(t.events.type, 'PA')).limit(1);
    await db.update(t.events).set({ keystoneProjectCode: 'TST-PA1' }).where(eq(t.events.id, pa.id));

    const projects = (await rows(sql`select project_code, kind, status_text from pub_hse_projet where project_code like 'TST-%' order by 1`));
    expect(projects).toEqual([{ project_code: 'TST-PA1', kind: 'register', status_text: '1 déclaré' }]);
  });
});

describe('pub_journal : cycle d’une action née d’une maladie professionnelle', () => {
  it('ni intitulé, ni type, ni entrée de l’événement MP dans le journal publié', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const db = await getDb();
    const [mp] = await db.select().from(t.events).where(eq(t.events.id, MP));
    expect(mp).toMatchObject({ type: 'MP', title: MP_TITLE });

    const created = await saveAction({}, form({ ...NEW_ACTION, source: 'evenement', link: `event:${MP}`, originRef: '', pilotId: 'tnguyen', siteId: mp.siteId }));
    expect(created).toMatchObject({ ok: true });
    const id = created.id!;
    expect((await actionRow(id)).eventId).toBe(MP);
    for (const [from, to, extra] of [['a_faire', 'p20'], ['p20', 'p60'], ['p60', 'terminee', { doneOn: '2026-10-09' }]] as [string, string, Record<string, string>?][]) {
      expect(await moveAction({}, form({ id, from, to, ...extra })), `${from} → ${to}`).toMatchObject({ ok: true });
    }
    const r = await verifyAction({}, form({
      id, from: 'terminee', verifyMethod: 'visuelle', efficacyNote: 'Poste toujours non aménagé.', effective: 'non_efficace',
      ne_detail: 'Aménager le poste', ne_pilotId: 'sbenali', ne_priority: 'urgent', ne_dueOn: '2026-10-30', ne_verifyDueOn: '2026-11-20',
      ne_domain: 'securite', ne_siteId: mp.siteId,
    }));
    expect(r).toMatchObject({ ok: true, id, ids: [expect.stringMatching(/^A-\d+$/)] });
    const [next] = r.ids!;
    expect((await actionRow(next)).eventId).toBe(MP);
    // Une écriture sur la fiche de l'événement lui-même (pièce jointe ordinaire) : entrée au journal de l'événement.
    expect(await addEventFiles(formWith({ eventId: MP }, { files: [file('photo-poste.pdf')] }))).toEqual({ count: 1 });

    // Journal brut : le cycle a bien écrit sur les deux actions et sur l'événement.
    const raw = await db.select().from(t.changeLog).where(inArray(t.changeLog.entityId, [id, next, MP]));
    expect(raw.filter((l) => l.entityType === 'action').length).toBeGreaterThanOrEqual(6);
    expect(raw.some((l) => l.entityType === 'event' && l.entityId === MP)).toBe(true);

    // Journal publié : ni intitulé imposé ni libellé du type, nulle part ; aucune entrée de l'événement MP.
    const leaks = await rows(sql`select objet, detail from pub_journal
      where detail ilike ${'%' + MP_TITLE + '%'} or detail ilike '%maladie professionnelle%' or objet = ${'event:' + MP}`);
    expect(leaks).toEqual([]);
    const published = await rows(sql`select objet, detail from pub_journal where objet in (${'action:' + id}, ${'action:' + next})`);
    expect(published.length).toBeGreaterThanOrEqual(6);
  });

  it('aucune entrée du journal hors événement ne recopie l’intitulé d’un AT ou d’une MP', async () => {
    const db = await getDb();
    const health = await db.select({ id: t.events.id, title: t.events.title }).from(t.events).where(inArray(t.events.type, HEALTH_TYPES));
    expect(health.length).toBeGreaterThan(0);
    const published = await rows(sql`select objet, detail from pub_journal where detail is not null`);
    const found = published.filter((p) => health.some((e) => String(p.detail).includes(e.title)));
    expect(found).toEqual([]);
    // Ni entrée d'un de ces événements.
    const objets = new Set(health.map((e) => `event:${e.id}`));
    expect(published.filter((p) => objets.has(String(p.objet)))).toEqual([]);
  });
});
