import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, freshDemoDatabase, lastLog } from '../helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadActionStats } from '@/lib/data/action-stats';
import { loadAllActions } from '@/lib/queries';
import { createEvent } from '@/server/events';
import { loadEntityHistory } from '@/server/history';
import { saveContractor } from '@/server/contractors';
import { nextEntityReference, referenceScope } from '@/server/references';

// Paquet 2 : références sûres des autres fiches (PRD-08), statistiques du plan d'actions (ACT-29), historiques chargés à
// l'ouverture d'une fiche (QUA-11). Jeu de démonstration au 09/10/2026 : entreprises EE-001 à EE-007, événements
// EV-2026-… jusqu'à 133.

freshDemoDatabase();

describe('références sûres (PRD-08)', () => {
  it('compteur par préfixe, au-delà des références existantes et journalisées ; jamais la portée des actions', async () => {
    const db = await getDb();
    expect(await db.transaction((tx) => nextEntityReference(tx, 'contractor', 'EE-', 3))).toBe('EE-008');
    expect(await db.transaction((tx) => nextEntityReference(tx, 'contractor', 'EE-', 3))).toBe('EE-009');
    // Référence d'une fiche supprimée, encore au journal : jamais réattribuée (compteur avancé).
    await db.insert(t.changeLog).values({ entityType: 'contractor', entityId: 'EE-020', action: 'create', summary: 'test' });
    expect(await db.transaction((tx) => nextEntityReference(tx, 'contractor', 'EE-', 3))).toBe('EE-021');
    const [counter] = await db.select().from(t.actionCounters).where(eq(t.actionCounters.scope, referenceScope('EE-')));
    expect(counter.last).toBe(21);
    expect((await db.select().from(t.actionCounters).where(eq(t.actionCounters.scope, 'A')))[0].last).toBe(222);
  });

  it('transaction annulée : la référence revient au compteur ; créations simultanées : références distinctes', async () => {
    const db = await getDb();
    await expect(db.transaction(async (tx) => {
      await nextEntityReference(tx, 'contractor', 'EE-', 3);
      throw new Error('annulée');
    })).rejects.toThrow('annulée');
    const refs = await Promise.all([1, 2, 3].map(() => db.transaction((tx) => nextEntityReference(tx, 'contractor', 'EE-', 3))));
    expect(new Set(refs).size).toBe(3);
    expect([...refs].sort()).toEqual(['EE-022', 'EE-023', 'EE-024']);
  });

  it('server actions : entreprise extérieure et événement numérotés par le compteur, journal de création', async () => {
    actAs('Chef de service', 'ville-a');
    const r = await saveContractor({}, form({ name: 'Levage Service', trade: 'Levage' }));
    expect(r).toMatchObject({ ok: true, id: 'EE-025' });
    expect(await lastLog('contractor', 'EE-025')).toMatchObject({ action: 'create' });
    const e = await createEvent({}, form({ type: 'PA', title: 'Test', occurredOn: '2026-10-08', location: 'Atelier', severity: '1', siteId: 'ville-a', declarantId: 'tnguyen' }));
    expect(e).toMatchObject({ ok: true, id: 'EV-2026-136' });
  });
});

describe('statistiques du plan d’actions (ACT-29)', () => {
  it('Salarié : aucune statistique ; QHSE et encadrement : plan du site sélectionné', async () => {
    actAs('Salarié', 'ville-a');
    expect(await loadActionStats(null)).toBeNull();
    for (const role of ['Animateur QHSE', 'Chef de service'] as const) {
      actAs(role, 'ville-a');
      const s = (await loadActionStats(null))!;
      const rows = await loadAllActions('site');
      expect(s, role).toMatchObject({ month: '2026-10', asOf: '2026-10-09', current: true });
      expect(s.total).toBe(rows.filter((a) => a.openedOn <= '2026-10-09').length);
      expect(s.byAvancement.reduce((n, r) => n + r.count, 0)).toBe(s.total);
      expect(s.evolution).toHaveLength(12);
    }
  });

  it('mois en cours : ouvertes et en retard égales à celles du plan ; mois passé : fin du mois ; mois futur : mois en cours', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const s = (await loadActionStats(null))!;
    const rows = (await loadAllActions('site')).filter((a) => ['a_faire', 'initiee', 'p20', 'p40', 'p60', 'p80'].includes(a.status));
    expect(s.open).toBe(rows.length);
    expect(s.late).toBe(rows.filter((a) => a.dueOn < '2026-10-09').length);
    expect((await loadActionStats('2026-09'))).toMatchObject({ month: '2026-09', asOf: '2026-09-30', current: false });
    expect((await loadActionStats('2027-01'))!.month).toBe('2026-10');
  });

  it('« Tous les sites » : tout le périmètre (site B compris)', async () => {
    actAs('Animateur QHSE', 'all');
    const all = (await loadActionStats(null))!;
    actAs('Animateur QHSE', 'ville-a');
    const a = (await loadActionStats(null))!;
    expect(all.total).toBeGreaterThan(a.total);
  });
});

describe('historique à l’ouverture d’une fiche (QUA-11)', () => {
  it('exigence, contrôle, plan, entreprise : entrées de la fiche pour un lecteur de l’écran', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await loadEntityHistory('contractor', 'EE-025')).toMatchObject({ entries: [expect.objectContaining({ action: 'create' })] });
    expect(await loadEntityHistory('requirement', '1')).toMatchObject({ entries: expect.any(Array) });
    expect(await loadEntityHistory('control', '1')).toMatchObject({ entries: expect.any(Array) });
    const [plan] = await (await getDb()).select({ id: t.preventionPlans.id, siteId: t.preventionPlans.siteId }).from(t.preventionPlans).where(eq(t.preventionPlans.siteId, 'ville-a'));
    expect(await loadEntityHistory('prevention_plan', plan.id)).toMatchObject({ entries: expect.any(Array) });
  });

  it('fiche d’un autre site que le site sélectionné, type inconnu, fiche absente, écran fermé : refus sans détail', async () => {
    const NOT_FOUND = { error: 'Historique introuvable.' };
    actAs('Animateur QHSE', 'ville-a');
    expect(await loadEntityHistory('control', '6')).toEqual(NOT_FOUND); // contrôle du site B
    expect(await loadEntityHistory('action' as never, 'A-214')).toEqual(NOT_FOUND);
    expect(await loadEntityHistory('requirement', '99999')).toEqual(NOT_FOUND);
    expect(await loadEntityHistory('requirement', 'x')).toEqual(NOT_FOUND);
    actAs('Animateur QHSE', 'ville-b');
    expect(await loadEntityHistory('control', '6')).toMatchObject({ entries: expect.any(Array) });
    actAs('Salarié', 'ville-a');
    const salarie = await loadEntityHistory('requirement', '1');
    const prevention = await loadEntityHistory('contractor', 'EE-001');
    // Écrans fermés au Salarié (veille, prévention) : refus.
    expect([salarie, prevention].every((r) => 'error' in r)).toBe(true);
  });
});
