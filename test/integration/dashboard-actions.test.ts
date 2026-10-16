import { describe, expect, it } from 'vitest';
import { actAs, freshDemoDatabase } from '../helpers';
import { getDb, schema as t } from '@/db';
import { isLate } from '@/lib/action-rules';
import { isOpenAvancement } from '@/lib/domain';
import { loadDashboard } from '@/lib/data/dashboard';

// KPI « Actions en retard » du tableau de bord (ACT-28) : actions ouvertes (À faire → 80 %) dont la date cible est passée,
// sur les ouvertes du site sélectionné ; ni Reportées, ni Terminées, ni closes ; lien vers le plan filtré (?retard=1).

freshDemoDatabase();

const kpi = async () => (await loadDashboard()).kpis.find((k) => k.label === 'Actions en retard')!;

async function expected(site: string | null) {
  const db = await getDb();
  const rows = (await db.select().from(t.actions)).filter((a) => a.status !== 'abandonnee' && (site === null || a.siteId === site));
  const late = rows.filter((a) => isLate(a, '2026-10-09'));
  return { late, open: rows.filter((a) => isOpenAvancement(a.status)).length };
}

describe('KPI « Actions en retard »', () => {
  it('site A : retards des ouvertes, dénominateur = ouvertes, actions liées à un événement, lien filtré', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const want = await expected('ville-a');
    expect(want.late.map((a) => a.id).sort()).toEqual(['A-198', 'A-201', 'A-205']);
    expect(await kpi()).toMatchObject({
      value: String(want.late.length), sub: `sur ${want.open} ouvertes`,
      note: `${want.late.filter((a) => a.eventId).length} liées à des événements`, tone: 'danger', href: '/actions?retard=1',
    });
  });

  it('Terminée, Reportée, Vérifiée : jamais en retard', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const db = await getDb();
    const before = await kpi();
    await db.insert(t.actions).values([
      { id: 'A-960', detail: 'Terminée', source: 'evenement', originRef: 'x', siteId: 'ville-a', pilotId: 'sbenali', openedOn: '2026-09-01', dueOn: '2026-09-10', initialDueOn: '2026-09-10', status: 'terminee', doneOn: '2026-09-09', verifyDueOn: '2026-10-10' },
      { id: 'A-961', detail: 'Reportée', source: 'evenement', originRef: 'x', siteId: 'ville-a', pilotId: 'sbenali', openedOn: '2026-09-01', dueOn: '2026-09-10', initialDueOn: '2026-09-10', status: 'reportee' },
      { id: 'A-962', detail: 'Ouverte', source: 'evenement', originRef: 'x', siteId: 'ville-a', pilotId: 'sbenali', openedOn: '2026-09-01', dueOn: '2026-09-10', initialDueOn: '2026-09-10', status: 'p20' },
    ]);
    const after = await kpi();
    expect(Number(after.value)).toBe(Number(before.value) + 1);
    expect(after.sub).toBe(`sur ${(await expected('ville-a')).open} ouvertes`);
  });

  it('« Tous les sites » : tout le périmètre', async () => {
    actAs('Animateur QHSE', 'all');
    const want = await expected(null);
    expect((await kpi()).value).toBe(String(want.late.length));
  });
});
