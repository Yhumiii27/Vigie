import '../next-mocks';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb, schema as t } from '@/db';
import { loadActionSignals } from '@/lib/data/actions';
import { loadAuditSignals } from '@/lib/data/audits';
import { loadDocumentSignals } from '@/lib/data/documents';
import { loadEnvironmentSignals } from '@/lib/data/environment';
import { loadCoactivitySignals } from '@/lib/data/sitemap';
import { loadVisibleTodo } from '@/lib/data/todo';
import { DEMO_ROLE_PEOPLE } from '@/lib/demo';
import { todoKey, type Role } from '@/lib/domain';
import { actAs, freezeClock, freshDemoDatabase } from '../helpers';

// Paquet 11 (échéances) : responsables des échéances de coactivité (PRV-19) et des relevés de consommation (DOC-19), sites
// sans relevé suivis (DOC-19), revue documentaire pendant une révision (DOC-14), programme d'audit (AUD-18), site indiqué en
// vue « Tous les sites » (TDB-15) ; visibilité par rôle et site, Salarié compris, sans donnée de santé.

freshDemoDatabase();
freezeClock('2026-10-09T08:30:00Z');

const LEAD = DEMO_ROLE_PEOPLE['Animateur QHSE'];
const ROLES: Role[] = ['Animateur QHSE', 'Direction', 'Chef de service', 'Chef de projet', 'Salarié'];

/** Échéances visibles de chaque rôle, sur chaque site sélectionné. */
async function visibleByRole(match: (x: { kind: string; title: string }) => boolean) {
  const out: Record<string, number> = {};
  for (const role of ROLES) {
    for (const site of ['ville-a', 'ville-b', 'all']) {
      actAs(role, site);
      out[`${role}|${site}`] = (await loadVisibleTodo()).filter(match).length;
    }
  }
  return out;
}

describe('coactivité : personnes concernées (PRV-19)', () => {
  it('responsables des activités en coactivité, sinon le responsable QHSE du site', async () => {
    actAs('Animateur QHSE', 'all');
    const { todo } = await loadCoactivitySignals();
    expect(todo.length).toBeGreaterThan(0);
    for (const x of todo) {
      expect(x.ownerIds?.length).toBeGreaterThan(0);
      expect(x.who).not.toBe('');
    }
    // Activités sans responsable interne : le responsable QHSE du site.
    const db = await getDb();
    await db.update(t.siteActivities).set({ ownerId: null });
    const orphan = (await loadCoactivitySignals()).todo;
    expect(orphan.length).toBe(todo.length);
    for (const x of orphan) expect(x.ownerIds).toEqual([LEAD]);
  });

  it('visibilité : jamais pour le Salarié qui n’en est pas responsable ; le responsable QHSE la voit sur tous les sites', async () => {
    const seen = await visibleByRole((x) => x.kind === 'Coactivité');
    expect(seen['Salarié|ville-a'] + seen['Salarié|ville-b'] + seen['Salarié|all']).toBe(0);
    // Échéances de coactivité du site A : visibles du responsable QHSE même sous le site B (ses échéances, TDB-05).
    expect(seen['Animateur QHSE|ville-b']).toBe(seen['Animateur QHSE|all']);
  });
});

describe('relevés de consommation (DOC-19)', () => {
  it('responsable QHSE du site ; site actif sans aucun relevé suivi pour le dernier mois échu', async () => {
    actAs('Animateur QHSE', 'all');
    const before = (await loadEnvironmentSignals()).todo.filter((x) => x.kind === 'Consommations');
    expect(before.map((x) => [x.siteId, x.title, x.ownerIds, x.who])).toEqual([
      ['ville-b', 'Relevés de septembre 2026 · Site de [Ville B]', [LEAD], expect.stringMatching(/\S/)],
    ]);
    const db = await getDb();
    await db.delete(t.consumptions).where(eq(t.consumptions.siteId, 'ville-b'));
    const after = (await loadEnvironmentSignals()).todo.filter((x) => x.kind === 'Consommations');
    expect(after).toEqual([expect.objectContaining({
      siteId: 'ville-b', title: 'Aucun relevé de consommation saisi · relevés de septembre 2026 · Site de [Ville B]',
      dueOn: '2026-10-15', date: '2026-10-15', overdue: false, count: 1, ownerIds: [LEAD],
    })]);
    // Site archivé (ville-c) : jamais suivi.
    expect(after.some((x) => x.siteId === 'ville-c')).toBe(false);
  });

  it('visibilité : Salarié jamais ; le responsable QHSE la voit sous l’autre site', async () => {
    const seen = await visibleByRole((x) => x.kind === 'Consommations');
    expect(seen['Salarié|ville-a'] + seen['Salarié|ville-b'] + seen['Salarié|all']).toBe(0);
    expect(seen['Animateur QHSE|ville-a']).toBe(1);
    expect(seen['Animateur QHSE|ville-b']).toBe(1);
    expect(seen['Chef de projet|ville-a']).toBe(0);
  });
});

describe('revue documentaire pendant une révision (DOC-14)', () => {
  it('échéance maintenue, révision indiquée, clé indépendante de l’avancement de la révision', async () => {
    actAs('Animateur QHSE', 'all');
    const doc = (await loadDocumentSignals()).todo.find((x) => x.kind === 'Revue documentaire' && x.href === '/documents?doc=PR-QHSE-004')!;
    expect(doc).toMatchObject({ kind: 'Revue documentaire', dueOn: '2026-10-14', title: 'PR-QHSE-004 · revue périodique « Signalement et analyse des événements » · révision C en revue' });
    const key = todoKey(doc);
    expect(key).toBe('Revue documentaire|/documents?doc=PR-QHSE-004|PR-QHSE-004 · revue périodique « Signalement et analyse des événements »|warn|2026-10-14');
    // Revue dépassée pendant la révision : toujours une échéance (danger).
    const db = await getDb();
    const [v] = await db.select().from(t.documentVersions).where(eq(t.documentVersions.documentId, 'PR-QHSE-004')).then((rows) => rows.filter((r) => r.status === 'approuve'));
    await db.update(t.documentVersions).set({ approvedOn: '2024-01-10' }).where(eq(t.documentVersions.id, v.id));
    const late = (await loadDocumentSignals()).todo.find((x) => x.kind === 'Revue documentaire' && x.href === '/documents?doc=PR-QHSE-004')!;
    expect(late).toMatchObject({ overdue: true, tone: 'danger' });
    expect(late.title).toMatch(/revue dépassée depuis le .* · révision C en revue$/);
  });
});

describe('programme d’audit (AUD-18)', () => {
  it('élément prévu au mois, sans date : « date à fixer » dès que le mois entre dans l’horizon', async () => {
    const db = await getDb();
    const [cur] = await db.insert(t.auditPlanItems).values({ year: 2026, month: 10, track: 'Audits internes', label: 'Oct.', detail: 'Audit interne magasin', ownerId: 'sbenali' }).returning();
    const [next] = await db.insert(t.auditPlanItems).values({ year: 2026, month: 11, track: 'Audits internes', label: 'Nov.', detail: 'Audit interne expédition', ownerId: 'sbenali' }).returning();
    const [far] = await db.insert(t.auditPlanItems).values({ year: 2026, month: 12, track: 'Audits internes', label: 'Déc.', detail: 'Audit interne quai', ownerId: 'sbenali' }).returning();
    actAs('Animateur QHSE', 'all');
    const todo = (await loadAuditSignals()).todo;
    const of = (id: number) => todo.filter((x) => x.href === `/audits?annee=2026&element=${id}`);
    expect(of(cur.id)).toEqual([expect.objectContaining({ date: '2026-10-09', dueOn: '2026-10-01', tone: 'warn', title: 'Audit interne magasin — prévu en octobre 2026, date à fixer', ownerIds: ['sbenali'], siteId: null })]);
    // Novembre : hors horizon au 09/10 (1er novembre > 24/10) ; décembre aussi.
    expect(of(next.id)).toEqual([]);
    expect(of(far.id)).toEqual([]);
    // Visible du responsable de l'élément, jamais du Salarié.
    actAs('Chef de service', 'ville-b');
    expect((await loadVisibleTodo()).some((x) => x.title.startsWith('Audit interne magasin'))).toBe(true);
    actAs('Salarié', 'all');
    expect((await loadVisibleTodo()).some((x) => x.title.startsWith('Audit interne magasin'))).toBe(false);
  });

  it('élément en retard porté par une action en retard : une seule échéance, responsable de l’action ajouté', async () => {
    const db = await getDb();
    await db.insert(t.actions).values({
      id: 'A-970', detail: 'Préparer l’audit fournisseur', source: 'audit_fournisseur', originRef: 'Programme 2026', siteId: 'ville-a', pilotId: 'rfontaine',
      openedOn: '2026-08-01', dueOn: '2026-09-15', initialDueOn: '2026-09-15', status: 'p20',
    });
    const [item] = await db.insert(t.auditPlanItems).values({
      year: 2026, month: 9, track: 'Audits fournisseurs', label: '15/09', plannedOn: '2026-09-15', detail: 'Audit fournisseur câblage', ownerId: 'sbenali', actionId: 'A-970',
    }).returning();
    actAs('Animateur QHSE', 'all');
    const actionTodo = (await loadActionSignals()).todo.filter((x) => x.title.startsWith('A-970'));
    expect(actionTodo).toEqual([]);
    const planTodo = (await loadAuditSignals()).todo.filter((x) => x.href === `/audits?annee=2026&element=${item.id}`);
    expect(planTodo).toEqual([expect.objectContaining({ overdue: true, dueOn: '2026-09-15', ownerIds: ['sbenali', 'rfontaine'], title: 'Audit fournisseur câblage — prévu le 15/09, à confirmer' })]);
    // Élément confirmé (réalisé) : le retard de l'action redevient sa propre échéance.
    await db.update(t.auditPlanItems).set({ done: true, doneOn: '2026-09-15' }).where(eq(t.auditPlanItems.id, item.id));
    expect((await loadActionSignals()).todo.filter((x) => x.title.startsWith('A-970')).map((x) => x.kind)).toEqual(['Action en retard']);
  });
});

describe('site indiqué en vue « Tous les sites » (TDB-15)', () => {
  it('chaque échéance d’un site porte son libellé sous « Tous les sites » ; sous un site, seulement celles d’un autre site', async () => {
    actAs('Animateur QHSE', 'all');
    const all = await loadVisibleTodo();
    expect(all.length).toBeGreaterThan(0);
    for (const x of all) {
      expect(x.elsewhere).toBe(false);
      expect(x.siteLabel).toBe(x.siteId ? x.siteId === 'ville-a' ? 'Site de [Ville A]' : 'Site de [Ville B]' : undefined);
    }
    actAs('Animateur QHSE', 'ville-a');
    for (const x of await loadVisibleTodo()) expect(!!x.siteLabel).toBe(x.elsewhere);
  });

  it('jamais une échéance qui révèle une donnée de santé pour un rôle non habilité', async () => {
    for (const role of ['Chef de service', 'Chef de projet', 'Salarié'] as Role[]) {
      for (const site of ['ville-a', 'all']) {
        actAs(role, site);
        expect((await loadVisibleTodo()).filter((x) => x.health)).toEqual([]);
      }
    }
  });
});
