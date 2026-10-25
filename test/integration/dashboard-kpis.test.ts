import '../next-mocks';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb, schema as t } from '@/db';
import { loadDashboard, loadTodoPage } from '@/lib/data/dashboard';
import { controlStatus, loadControls } from '@/lib/queries';
import { markNotificationsRead } from '@/server/notifications';
import { actAs, freezeClock, freshDemoDatabase } from '../helpers';

// Tableau de bord (paquet 11) : exactitude des KPI (TDB-13), carte « Veille réglementaire » après la date d'application
// (TDB-14), site en vue « Tous les sites » (TDB-15), état lu des échéances ouvertes depuis la carte (TDB-11).

freshDemoDatabase();
freezeClock('2026-10-09T08:30:00Z');

const kpi = async (label: string) => (await loadDashboard()).kpis.find((k) => k.label.startsWith(label))!;
const recentCount = (note: string) => Number(/^(\d+) déclaré/.exec(note)?.[1]);

describe('KPI (TDB-13)', () => {
  it('« déclarés sur les 7 derniers jours » : date de déclaration, et non date des faits', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const before = recentCount((await kpi('Événements ouverts')).note);
    const db = await getDb();
    const base = { siteId: 'ville-a', type: 'SD', location: 'Atelier', severity: 2, description: 'x' };
    // Faits anciens, déclarés aujourd'hui : compté ; faits d'hier, saisis il y a un mois : non compté.
    await db.insert(t.events).values([
      { ...base, id: 'EV-T1', title: 'Déclaré aujourd’hui', occurredOn: '2026-08-01', createdAt: new Date('2026-10-09T07:00:00Z') },
      { ...base, id: 'EV-T2', title: 'Saisi il y a un mois', occurredOn: '2026-10-08', createdAt: new Date('2026-09-08T07:00:00Z') },
    ]);
    expect(recentCount((await kpi('Événements ouverts')).note)).toBe(before + 1);
  });

  it('note des contrôles : le contrôle le plus en retard', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const ctrl = (await loadControls()).map((c) => ({ c, s: controlStatus(c, '2026-10-09') })).filter((x) => x.s.days < 0);
    expect(ctrl.length).toBeGreaterThan(0);
    const worst = Math.min(...ctrl.map((x) => x.s.days));
    expect((await kpi('Contrôles réglementaires')).note).toMatch(new RegExp(`· \\+${-worst} j$`));
  });

  it('NC sans origine : barre « Origine non renseignée » ; NC d’origine client distincte des réclamations client', async () => {
    actAs('Animateur QHSE', 'all');
    const db = await getDb();
    const base = { siteId: 'ville-a', location: 'Atelier', severity: 2, description: 'x', occurredOn: '2026-10-01' };
    await db.insert(t.events).values([
      { ...base, id: 'EV-T3', type: 'NC', title: 'NC sans origine', ncOrigin: null },
      { ...base, id: 'EV-T4', type: 'NC', title: 'NC origine client', ncOrigin: 'Réclamation client' },
    ]);
    const d = await loadDashboard();
    const bar = (label: string) => d.ncOrigins.find((o) => o.label === label);
    expect(bar('Origine non renseignée')).toMatchObject({ href: '/evenements?type=NC&origine=aucune' });
    expect(bar('Origine non renseignée')!.n).toBeGreaterThanOrEqual(1);
    expect(bar('NC · origine client')).toMatchObject({ n: 1, href: '/evenements?type=NC&origine=R%C3%A9clamation%20client' });
    expect(bar('Réclamations client')).toMatchObject({ href: '/evenements?type=RC' });
    // Total des barres = NC et réclamations ouvertes (aucune n'est perdue).
    expect(d.ncOrigins.reduce((s, o) => s + o.n, 0)).toBe(d.ncOpen);
  });
});

describe('carte « Veille réglementaire » (TDB-14)', () => {
  it('avant la date : « Applicable au », sans état ; après : « Applicable depuis le » et état de conformité', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const before = (await loadDashboard()).featured!;
    expect(before.daysLeft).toBeGreaterThan(0);
    expect(before).toMatchObject({ prefix: 'Applicable au', state: null });
    const db = await getDb();
    await db.update(t.requirements).set({ dueOn: '2026-09-01', evaluation: 'ecart' }).where(eq(t.requirements.id, before.id));
    expect((await loadDashboard()).featured).toMatchObject({ prefix: 'Applicable depuis le', dueOn: '2026-09-01', state: { label: 'Écart', tone: 'danger' } });
  });
});

describe('site en vue « Tous les sites » (TDB-15)', () => {
  it('derniers signalements et échéances : site indiqué sous « Tous les sites », pas sous un site', async () => {
    actAs('Animateur QHSE', 'all');
    const all = await loadDashboard();
    expect(all.latest.length).toBeGreaterThan(0);
    for (const e of all.latest) expect(e.siteLabel).toBe(e.siteId === 'ville-a' ? 'Site de [Ville A]' : 'Site de [Ville B]');
    for (const x of all.todo) if (x.siteId) expect(x.siteLabel).toMatch(/^Site de/);
    actAs('Animateur QHSE', 'ville-a');
    for (const e of (await loadDashboard()).latest) expect(e.siteLabel).toBeNull();
  });
});

describe('état lu depuis le tableau de bord et la page À faire (TDB-11)', () => {
  it('échéance ouverte marquée lue (même action que la cloche), état repris par la carte et la page', async () => {
    actAs('Direction', 'ville-a');
    const item = (await loadDashboard()).todo.find((x) => !x.read)!;
    expect(item).toBeDefined();
    await markNotificationsRead([item.key]);
    expect((await loadDashboard()).todo.find((x) => x.key === item.key)?.read).toBe(true);
    expect((await loadTodoPage({ mine: false })).items.find((x) => x.key === item.key)?.read).toBe(true);
    // État personnel : pas lu pour une autre personne.
    actAs('Animateur QHSE', 'ville-a');
    expect((await loadTodoPage({ mine: false })).items.find((x) => x.key === item.key)?.read ?? false).toBe(false);
  });
});
