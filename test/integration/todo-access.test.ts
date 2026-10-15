import { beforeAll, describe, expect, it } from 'vitest';
import { cookieJar } from '../next-mocks';
import { actAs, freshDemoDatabase } from '../helpers';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { canOpen } from '@/lib/domain';
import { loadCounters } from '@/lib/data/counters';
import { loadTodoPage } from '@/lib/data/dashboard';
import { loadNotifications } from '@/lib/data/notifications';
import { loadVisibleTodo } from '@/lib/data/todo';
import { openTodo } from '@/server/notifications';

// TDB-02 : une échéance reste visible pour son responsable même quand l'écran source lui est fermé ou en consultation
// seule (lien ouvert si l'écran l'est, vue en lecture sinon, ou échéance sans lien) ; les non-responsables d'un écran en
// consultation seule ne la voient pas ; les échéances qui révèlent une donnée de santé restent réservées (SEC-06).

freshDemoDatabase();

const byTitle = async (start: string) => (await loadVisibleTodo()).find((x) => x.title.startsWith(start));
const AUDIT_BE = 'Processus Conception BE';
const VISIT = "Visite trimestrielle — zone d'essais";
const CONTRIBUTION = "Retour d'expérience des visites sécurité";
const isCpam = (x: { kind: string }) => x.kind === 'Déclaration AT à la CPAM';

describe('responsable d\'une échéance sur un écran en consultation seule', () => {
  it('Chef de projet : son audit interne est visible, lien selon l\'accès à l\'écran', async () => {
    actAs('Chef de projet', 'ville-a');
    const item = await byTitle(AUDIT_BE);
    expect(item).toMatchObject({ date: '2026-10-17', source: 'audits', ownerIds: ['edubois'] });
    const page = await loadTodoPage({ mine: false });
    expect(page.domains.map((d) => d.key)).toContain('audits');
    const { badges } = await loadCounters();
    if (canOpen('Chef de projet', '/audits')) {
      expect(item!.href).toMatch(/^\/audits\?annee=2026&element=\d+$/);
      expect(badges.audits).toBeGreaterThan(0);
    } else {
      expect(item!.href).toBeUndefined();
      expect(badges).not.toHaveProperty('audits');
    }
  });

  it('Chef de service : sa visite sécurité et sa contribution à la revue, pas l\'audit d\'un autre', async () => {
    actAs('Chef de service', 'ville-a');
    expect(await byTitle(VISIT)).toMatchObject({ date: '2026-10-12', ownerIds: ['sbenali'], source: 'audits' });
    expect(await byTitle(CONTRIBUTION)).toMatchObject({ overdue: true, ownerIds: ['sbenali'], source: 'audits' });
    expect(await byTitle(AUDIT_BE)).toBeUndefined();
    // « Mes échéances » et cloche : la contribution en retard y figure.
    expect((await loadTodoPage({ mine: true })).items.some((x) => x.title.startsWith(CONTRIBUTION))).toBe(true);
    expect((await loadNotifications()).some((n) => n.title.startsWith(CONTRIBUTION))).toBe(true);
  });

  it('écran modifiable : toutes les échéances (Animateur QHSE)', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await byTitle(AUDIT_BE)).toBeDefined();
    expect(await byTitle(VISIT)).toBeDefined();
  });
});

describe('responsable sans accès à l\'écran source', () => {
  beforeAll(async () => {
    // Le salarié de démonstration devient responsable d'un élément du programme d'audit (écran Audits fermé au Salarié).
    const db = await getDb();
    await db.update(t.auditPlanItems).set({ ownerId: 'tnguyen' })
      .where(and(eq(t.auditPlanItems.detail, AUDIT_BE), eq(t.auditPlanItems.plannedOn, '2026-10-17')));
  });

  it('Salarié : échéance visible sans lien, puce de domaine, pas de badge d\'écran, ouverture impossible', async () => {
    actAs('Salarié', 'all');
    const item = await byTitle(AUDIT_BE);
    expect(canOpen('Salarié', '/audits')).toBe(false);
    expect(item).toMatchObject({ source: 'audits', ownerIds: ['tnguyen'], elsewhere: false });
    expect(item!.href).toBeUndefined();
    const page = await loadTodoPage({ mine: false });
    expect(page.domains.find((d) => d.key === 'audits')).toMatchObject({ label: 'Audits et certifications', n: 1 });
    const { badges } = await loadCounters();
    expect(badges).not.toHaveProperty('audits');
    expect(badges.todo).toBe((await loadVisibleTodo()).length);
    await expect(openTodo(item!.key)).resolves.toBeUndefined();
    // Aucun lien vers l'écran fermé (la clé d'état lu garde le lien d'origine, sans effet sur l'accès).
    expect((await loadVisibleTodo()).some((x) => x.href?.startsWith('/audits'))).toBe(false);
  });

  it('les autres échéances de l\'écran restent fermées au Salarié', async () => {
    actAs('Salarié', 'all');
    expect((await loadVisibleTodo()).filter((x) => x.source === 'audits').map((x) => x.title)).toEqual([AUDIT_BE]);
  });
});

describe('données de santé (non-régression SEC-06)', () => {
  beforeAll(async () => {
    // Accident avec arrêt non déclaré, piloté par le chef de service : échéance CPAM adressée au responsable QHSE du site.
    const db = await getDb();
    await db.insert(t.events).values({
      id: 'EV-2026-T01', siteId: 'ville-a', type: 'AT', title: 'Chute de plain-pied', occurredOn: '2026-10-08', location: 'Atelier montage',
      severity: 2, step: 1, pilotId: 'sbenali', injury: 'arret', createdAt: new Date('2026-10-08T10:00:00+02:00'),
    });
  });

  it('échéances CPAM : réservées à l\'animateur QHSE et à la direction', async () => {
    for (const role of ['Chef de service', 'Chef de projet', 'Salarié'] as const) {
      actAs(role, 'all');
      expect((await loadVisibleTodo()).some(isCpam)).toBe(false);
      expect((await loadNotifications()).some(isCpam)).toBe(false);
    }
    actAs('Animateur QHSE', 'all');
    expect((await loadVisibleTodo()).find(isCpam)).toMatchObject({ health: true, title: 'EV-2026-T01 · Chute de plain-pied' });
    actAs('Direction', 'ville-a');
    expect((await loadVisibleTodo()).some(isCpam)).toBe(true);
    cookieJar.clear();
  });
});
