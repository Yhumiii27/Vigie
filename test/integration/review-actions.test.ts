import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { form } from '../next-mocks';
import { actAs, freshDemoDatabase, lastLog } from '../helpers';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { decisionActionDefaults, reviewActionDefaults } from '@/components/review/ReviewPanel';
import { QHSE_ONLY_CREATE_MESSAGE } from '@/lib/action-rules';
import { loadReviewCard, loadReviewDossierPage, type Review } from '@/lib/data/review';
import { saveAction } from '@/server/plan';

// Revue de direction et plan d'actions QSE (ACT-28) : actions des décisions lues sur tout le périmètre (une décision vaut
// pour l'entreprise, ses actions sont chacune sur un site), création réservée au service QHSE (ACT-22), section « Plan
// d'actions » du dossier par source (Reportée comptée avec les ouvertes, Terminées à vérifier, Vérifiées de la période),
// dossier figé avant la refonte (par origine) toujours lisible.

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement('a', { href, ...rest }, children as never) }));

freshDemoDatabase();

async function reviewOn(date: string): Promise<Review> {
  const db = await getDb();
  const [r] = await db.select().from(t.reviews).where(eq(t.reviews.reviewOn, date));
  if (!r) throw new Error(`revue du ${date} introuvable`);
  return r;
}

describe('décisions et actions de la revue (ACT-28)', () => {
  it('action d’une décision lue sur tout le périmètre, quel que soit le site sélectionné', async () => {
    const june = await reviewOn('2026-06-18');
    // A-174 (décision de la revue de juin) est sur le site A : visible avec le site B sélectionné.
    actAs('Animateur QHSE', 'ville-b');
    const card = await loadReviewCard({ revue: String(june.id) });
    const d = card.decisions.find((x) => x.actionId === 'A-174')!;
    expect(d.action).toMatchObject({ id: 'A-174', status: 'Reportée', title: expect.stringMatching(/^Former les chefs d'équipe/) });
  });

  it('création et rattachement : service QHSE seulement ; listes vides pour l’encadrement', async () => {
    const june = await reviewOn('2026-06-18');
    for (const role of ['Animateur QHSE', 'Direction'] as const) {
      actAs(role, 'all');
      const card = await loadReviewCard({ revue: String(june.id) });
      expect(card.flags.canCreateActions, role).toBe(true);
      expect(card.options.people.length, role).toBeGreaterThan(0);
      expect(card.options.today, role).toBe('2026-10-09');
      expect(card.linkable.length, role).toBeGreaterThan(0);
    }
    for (const role of ['Chef de service', 'Chef de projet'] as const) {
      actAs(role, 'all');
      const card = await loadReviewCard({ revue: String(june.id) });
      expect(card.flags, role).toMatchObject({ canEdit: false, canCreateActions: false });
      expect(card.options, role).toEqual({ people: [], sites: [], today: '2026-10-09' });
      expect(card.people, role).toEqual([]);
      expect(card.linkable, role).toEqual([]);
    }
  });

  it('valeurs proposées : Objectif QSE pour un objectif, sinon Revue de direction (imposée), jamais « Tous les sites »', () => {
    const ref = 'Revue de direction 18/06/2026';
    expect(decisionActionDefaults({ id: 7, kind: 'objectif', text: 'Réduire le TF1 sous 4', pilotId: 'clefevre', dueOn: '2026-12-31' }, ref)).toEqual({
      source: 'objectif', lockSource: true, link: 'reviewdecision:7', linkLabel: 'Réduire le TF1 sous 4', originRef: ref, problem: 'Réduire le TF1 sous 4',
      pilotId: 'clefevre', dueOn: '2026-12-31', verifyDueOn: '2027-01-30',
    });
    const decision = decisionActionDefaults({ id: 8, kind: 'decision', text: 'Former', pilotId: null, dueOn: null }, ref);
    expect(decision).toMatchObject({ source: 'revue_direction', lockSource: true, link: 'reviewdecision:8', pilotId: undefined, dueOn: undefined });
    expect(decision).not.toHaveProperty('siteId', null);
    expect(decisionActionDefaults({ id: 9, kind: 'ressource', text: 'Recruter', pilotId: null, dueOn: null }, ref).source).toBe('revue_direction');
    expect(reviewActionDefaults(3, ref)).toEqual({ source: 'revue_direction', lockSource: true, link: 'review:3', linkLabel: ref, originRef: ref });
  });
});

describe('création d’une action depuis une décision (saveAction, flux A)', () => {
  it('service QHSE seulement ; source imposée par la décision ; site obligatoire, actif ; décision liée et journal', async () => {
    const db = await getDb();
    // Objectif ajouté à une revue non clôturée (une revue clôturée refuse tout rattachement).
    const [open] = await db.select().from(t.reviews).where(and(inArray(t.reviews.status, ['planifiee', 'tenue']), isNull(t.reviews.cancelledAt))).limit(1);
    expect(open, 'revue non clôturée dans le jeu de démonstration').toBeDefined();
    const [d] = await db.insert(t.reviewDecisions).values({ reviewId: open.id, kind: 'objectif', text: 'Atteindre 100 % des chefs d’équipe formés', sort: 99 }).returning();
    await db.insert(t.sites).values({ id: 'ferme-e1', label: 'Site fermé', archivedAt: new Date('2026-01-01T00:00:00Z'), archiveReason: 'Site fermé' });
    const fields = (over: Record<string, string>) => form({
      source: 'objectif', link: `reviewdecision:${d.id}`, pilotId: 'clefevre', priority: 'moyen_terme', dueOn: '2026-12-15', verifyDueOn: '2027-01-15',
      domain: 'securite', problem: d.text, detail: 'Plan de formation des chefs d’équipe', siteId: 'ville-a', ...over,
    });
    const count = async () => (await db.select({ id: t.actions.id }).from(t.actions)).length;
    const before = await count();
    for (const role of ['Chef de service', 'Chef de projet', 'Salarié'] as const) {
      actAs(role, 'ville-a');
      expect(await saveAction({}, fields({})), role).toEqual({ error: QHSE_ONLY_CREATE_MESSAGE });
    }
    actAs('Animateur QHSE', 'all');
    // Objectif : « Revue de direction » refusée (source imposée, D20).
    expect(await saveAction({}, fields({ source: 'revue_direction' }))).toMatchObject({ fieldErrors: { source: expect.any(String) } });
    // Jamais « Tous les sites » ni un site archivé (D16).
    for (const siteId of ['all', 'ferme-e1', '']) {
      const refused = await saveAction({}, fields({ siteId }));
      expect(refused.ok, siteId).toBeFalsy();
      expect(JSON.stringify(refused), siteId).not.toContain('Revue');
    }
    expect(await count()).toBe(before);
    const r = await saveAction({}, fields({}));
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    const [row] = await db.select().from(t.actions).where(eq(t.actions.id, r.id!));
    expect(row).toMatchObject({ source: 'objectif', siteId: 'ville-a', status: 'a_faire' });
    const [linked] = await db.select({ actionId: t.reviewDecisions.actionId }).from(t.reviewDecisions).where(eq(t.reviewDecisions.id, d.id));
    expect(linked.actionId).toBe(r.id);
    expect(await lastLog('action', r.id!)).toMatchObject({ action: 'create', byId: 'clefevre' });
  });
});

describe('dossier : plan d’actions par source', () => {
  it('par source : Reportée avec les ouvertes, Terminées à vérifier, Vérifiées de la période, retards', async () => {
    actAs('Animateur QHSE', 'all');
    const annual = await reviewOn('2026-12-10');
    const page = await loadReviewDossierPage({ revue: String(annual.id) });
    if (page.mode !== 'live') throw new Error(page.mode);
    const { actions, header } = page.dossier;
    // Dossier préparatoire : 12 mois jusqu'à la date du jour (09/10/2026).
    expect(header).toMatchObject({ from: '2025-10-10', asOf: '2026-10-09' });
    expect(actions.byOrigin).toBeUndefined();
    const row = (key: string) => actions.bySource!.find((r) => r.key === key);
    // Revue de direction : A-184 (À faire) et A-174 (Reportée) ouvertes ; A-152 et A-158 Vérifiées dans la période.
    expect(row('revue_direction')).toEqual({ key: 'revue_direction', label: 'Revue de direction', open: 2, late: 0, verify: 0, closed: 2 });
    // Réclamation client : A-186 Terminée — à vérifier.
    expect(row('reclamation_client')).toMatchObject({ open: 0, verify: 1 });
    // Audit interne : A-188 (80 %) ouverte ; A-150 (site à compléter) Vérifiée le 21/08/2026, comptée sous « Tous les sites ».
    expect(row('audit_interne')).toEqual({ key: 'audit_interne', label: 'Audit interne ISO', open: 1, late: 0, verify: 0, closed: 1 });
    // Aucune action sans source dans le jeu neuf : pas de ligne « À compléter ».
    expect(row('a_completer')).toBeUndefined();
    // Abandonnée (A-180) : nulle part ; totaux = somme des lignes.
    const sum = (k: 'open' | 'late' | 'verify' | 'closed') => actions.bySource!.reduce((n, r) => n + r[k], 0);
    expect(actions.totals).toEqual({ open: sum('open'), late: sum('late'), verify: sum('verify'), closed: sum('closed') });
    expect(actions.lateActions!.map((a) => a.id)).toContain('A-203');
    expect(actions.lateActions!.find((a) => a.id === 'A-203')).toMatchObject({ origin: 'Évènement QSE', status: 'En retard' });
    expect(actions.lateActions!.every((a) => a.status === 'En retard')).toBe(true);

    const html = renderToStaticMarkup(createElement((await import('@/components/review/DossierView')).DossierView, { page, role: 'Animateur QHSE' }));
    expect(html).toContain('Terminées — à vérifier');
    expect(html).toContain('Vérifiées · période');
    expect(html).not.toContain('Clôturées · 12 mois');
  });

  it('dossier figé avant la refonte (par origine, intitulés) : lu et affiché tel quel', async () => {
    actAs('Animateur QHSE', 'all');
    const annual = await reviewOn('2026-12-10');
    const live = await loadReviewDossierPage({ revue: String(annual.id) });
    if (live.mode !== 'live') throw new Error(live.mode);
    const legacyActions = {
      byOrigin: [{ key: 'audit', label: 'Audit', open: 3, late: 1, verify: 2, closed: 4 }],
      totals: { open: 3, late: 1, verify: 2, closed: 4 },
      lateActions: [{
        id: 'A-099', title: 'Ancienne action en retard', status: 'En retard', tone: 'danger', pilot: '[C. Lefèvre]', dueOn: '2025-11-30',
        closedOn: null, efficacyNote: null, href: '/actions?action=A-099', origin: 'Audit', originRef: 'Audit interne 2025',
      }],
    };
    const db = await getDb();
    const [old] = await db.insert(t.reviews).values({
      reviewOn: '2025-12-12', kind: 'ordinaire', status: 'cloturee', minutes: 'Séance figée avant la refonte', closedOn: '2025-12-20',
      snapshot: { version: 1, takenOn: '2025-12-20', takenBy: '[H. Marchand]', dossier: { ...live.dossier, actions: legacyActions } },
    }).returning();
    const page = await loadReviewDossierPage({ revue: String(old.id) });
    expect(page.mode).toBe('snapshot');
    if (page.mode !== 'snapshot') return;
    expect(page.dossier.actions).toEqual(legacyActions);
    const html = renderToStaticMarkup(createElement((await import('@/components/review/DossierView')).DossierView, { page, role: 'Animateur QHSE' }));
    expect(html).toContain('Clôturées · 12 mois');
    expect(html).toContain('Ancienne action en retard');
    expect(html).toContain('Audit · Audit interne 2025');
    expect(html).not.toContain('Terminées — à vérifier');
  });
});
