import { describe, expect, it } from 'vitest';
import { cookieJar } from '../next-mocks';
import { actAs, freshDemoDatabase } from '../helpers';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadDashboard } from '@/lib/data/dashboard';

// TDB-04 : TF1 / TG du tableau de bord sur les 12 derniers mois complets (mois en cours exclu), mois sans heures signalés
// et écartés du taux, « — » sans heures (jamais 0,0). Le libellé du KPI reste le contrat repris par d'autres écrans.

freshDemoDatabase();

const MONTHS = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const fr = (n: number, digits: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const tf1Kpi = async () => (await loadDashboard()).kpis.find((k) => k.label.startsWith('TF1'))!;

/** Taux attendus calculés directement sur les données du site (accidents avec arrêt et heures des 12 mois). */
async function expected(siteId: string) {
  const db = await getDb();
  const hours = (await db.select().from(t.hoursWorked)).filter((h) => h.siteId === siteId && MONTHS.includes(h.month.slice(0, 7)));
  const at = (await db.select().from(t.events))
    .filter((e) => e.siteId === siteId && e.type === 'AT' && e.injury === 'arret' && !e.dismissedAt && MONTHS.includes(e.occurredOn.slice(0, 7)));
  const total = hours.reduce((n, h) => n + h.hours, 0);
  return { tf1: (at.length * 1e6) / total, tg: (at.reduce((n, e) => n + (e.lostDays ?? 0), 0) * 1e3) / total, months: hours.length };
}

describe('TF1 / TG du tableau de bord (TDB-04)', () => {
  it('site A : 12 mois complets (oct. 2025 – sept. 2026), objectif et période, sans avertissement', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const want = await expected('ville-a');
    expect(want.months).toBe(12);
    const kpi = await tf1Kpi();
    expect(kpi).toMatchObject({
      label: 'TF1 · 12 mois glissants', value: fr(want.tf1, 1), sub: `TG ${fr(want.tg, 2)}`,
      note: 'Objectif 2026 : TF1 ≤ 4,0 · oct. 2025 – sept. 2026', tone: 'neutral',
    });
    const { safety } = await loadDashboard();
    expect(safety).toMatchObject({ target: 4, period: 'oct. 2025 – sept. 2026', missing: null, complete: true });
    expect(safety.tf1).toBeCloseTo(want.tf1, 6);
  });

  it('le mois en cours (octobre 2026) n\'entre pas dans le taux', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const before = await tf1Kpi();
    const db = await getDb();
    await db.insert(t.hoursWorked).values({ month: '2026-10-01', siteId: 'ville-a', hours: 1_000 });
    await db.insert(t.events).values({
      id: 'EV-2026-T10', siteId: 'ville-a', type: 'AT', title: 'Chute de plain-pied', occurredOn: '2026-10-05', location: 'Atelier montage',
      severity: 2, step: 1, injury: 'arret', lostDays: 30,
    });
    const after = await tf1Kpi();
    expect(after).toMatchObject({ value: before.value, sub: before.sub, note: before.note });
  });

  it('mois sans heures (site B, sept. 2026) sous « Tous les sites » : signalé, taux sur les mois saisis', async () => {
    const db = await getDb();
    await db.delete(t.hoursWorked).where(and(eq(t.hoursWorked.siteId, 'ville-b'), eq(t.hoursWorked.month, '2026-09-01')));
    actAs('Animateur QHSE', 'all');
    const kpi = await tf1Kpi();
    expect(kpi.note).toMatch(/^Heures manquantes : sept\. 2026 \(Site de \[Ville B\]\) — taux sur les mois saisis$/);
    expect(kpi.tone).toBe('warn');
    expect(kpi.value).not.toBe('—');
    expect((await loadDashboard()).safety).toMatchObject({ complete: false, missing: 'sept. 2026 (Site de [Ville B])' });
    // Site A seul : rien ne manque.
    actAs('Animateur QHSE', 'ville-a');
    expect((await tf1Kpi()).note).not.toMatch(/manquantes/);
  });

  it('plus de deux mois manquants : les plus récents, puis « +n »', async () => {
    const db = await getDb();
    await db.delete(t.hoursWorked).where(and(eq(t.hoursWorked.siteId, 'ville-b'), eq(t.hoursWorked.month, '2026-08-01')));
    await db.delete(t.hoursWorked).where(and(eq(t.hoursWorked.siteId, 'ville-b'), eq(t.hoursWorked.month, '2026-07-01')));
    actAs('Animateur QHSE', 'ville-b');
    // Un seul site : sans libellé de site.
    expect((await tf1Kpi()).note).toBe('Heures manquantes : sept. 2026, août 2026 +1 — taux sur les mois saisis');
  });

  it('aucune heure saisie : « — », sans TG, avertissement', async () => {
    const db = await getDb();
    await db.delete(t.hoursWorked);
    actAs('Animateur QHSE', 'all');
    const kpi = await tf1Kpi();
    expect(kpi).toMatchObject({ value: '—', sub: '', note: 'Heures travaillées non saisies', tone: 'warn' });
    expect((await loadDashboard()).safety).toMatchObject({ tf1: null, tg: null, complete: false });
    cookieJar.clear();
  });

  it('AT avec arrêt avant le premier mois d\'heures saisi : mois signalé, jamais « Objectif » sur un taux amputé', async () => {
    const db = await getDb();
    await db.delete(t.hoursWorked);
    await db.insert(t.hoursWorked).values(MONTHS.filter((m) => m >= '2026-05').map((m) => ({ month: `${m}-01`, siteId: 'ville-b', hours: 10_000 })));
    await db.insert(t.events).values({
      id: 'EV-2026-T03', siteId: 'ville-b', type: 'AT', title: 'Chute de plain-pied', occurredOn: '2026-03-12', location: 'Atelier montage',
      severity: 2, step: 1, injury: 'arret', lostDays: 12,
    });
    actAs('Animateur QHSE', 'ville-b');
    const kpi = await tf1Kpi();
    expect(kpi.tone).toBe('warn');
    expect(kpi.note).toMatch(/^Heures manquantes : .*avr\. 2026.* — taux sur les mois saisis$/);
    expect((await loadDashboard()).safety.complete).toBe(false);
    cookieJar.clear();
  });
});
