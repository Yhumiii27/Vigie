import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, freshDemoDatabase, lastLog } from '../helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadReviewDossierPage, parseReviewSnapshot, type Review } from '@/lib/data/review';
import { resetConfig } from '@/lib/env';
import { closeReview, holdReview } from '@/server/review';

// Dossier de revue arrêté à la date de la séance (AUD-06) : dossier préparatoire arrêté à la séance passée, dossier de
// séance figé à la première saisie du compte rendu (« Tous les sites »), compte rendu modifiable jusqu'au visa, dossier du
// visa repris du dossier de séance ; revue tenue avant le lot 2 : dossier calculé au visa, arrêté à la séance.

freshDemoDatabase({ today: '2026-12-15' });

const DENIED = 'Votre rôle ne permet pas cette modification.';
const APPROVERS_ONLY = "Réservé à l'animateur QHSE et à la direction.";
const ALL_SITES_SEANCE = 'Sélectionnez « Tous les sites » : le dossier de séance, figé à la saisie du compte rendu, couvre tout le périmètre.';

/** Change la date du jour de la démonstration (VIGIE_TODAY) en cours de fichier. */
function setToday(on: string) {
  process.env.VIGIE_TODAY = on;
  resetConfig();
}
async function reviewOn(date: string): Promise<Review> {
  const db = await getDb();
  const [r] = await db.select().from(t.reviews).where(eq(t.reviews.reviewOn, date));
  if (!r) throw new Error(`revue du ${date} introuvable`);
  return r;
}
async function newNc(id: string, occurredOn: string) {
  const db = await getDb();
  await db.insert(t.events).values({ id, siteId: 'ville-a', type: 'NC', title: `NC ${occurredOn}`, occurredOn, location: 'Atelier', severity: 2, ncOrigin: 'Fabrication' });
}
const holdForm = (id: number, minutes: string) => form({
  id: String(id), reviewOn: '2026-12-10', participantIds: 'hmarchand', minutes, nextReviewOn: '2027-06-17', nextKind: 'intermediaire',
});

describe('AUD-06 : dossier arrêté à la séance', () => {
  it('dossier préparatoire d’une revue dont la date est passée : période arrêtée à la séance', async () => {
    actAs('Animateur QHSE', 'all');
    const annual = await reviewOn('2026-12-10');
    const page = await loadReviewDossierPage({ revue: String(annual.id) });
    expect(page.mode).toBe('live');
    if (page.mode !== 'live') return;
    expect(page.dossier.header).toMatchObject({ from: '2025-12-11', to: '2026-12-10', asOf: '2026-12-10' });
    expect(page.asOf).toBe('2026-12-10');
  });

  it('compte rendu : « Tous les sites » exigé ; dossier de séance figé, échéance réalisée, prochaine revue créée et inscrite', async () => {
    const annual = await reviewOn('2026-12-10');
    actAs('Chef de service', 'all');
    expect(await holdReview({}, holdForm(annual.id, 'Compte rendu'))).toEqual({ error: DENIED });
    expect(await closeReview(annual.id)).toEqual({ error: APPROVERS_ONLY });
    actAs('Animateur QHSE', 'ville-a');
    expect(await holdReview({}, holdForm(annual.id, 'Compte rendu'))).toEqual({ error: ALL_SITES_SEANCE });
    expect((await reviewOn('2026-12-10')).status).toBe('planifiee');

    actAs('Animateur QHSE', 'all');
    expect(await holdReview({}, holdForm(annual.id, 'Compte rendu de la séance'))).toEqual({ ok: true });
    const held = await reviewOn('2026-12-10');
    expect(held.status).toBe('tenue');
    const snap = parseReviewSnapshot(held.snapshot);
    expect(snap).toMatchObject({ phase: 'seance', asOf: '2026-12-10', takenOn: '2026-12-15', takenBy: '[C. Lefèvre]' });
    expect(snap!.dossier.header).toMatchObject({ from: '2025-12-11', to: '2026-12-10' });
    expect(await lastLog('review', annual.id)).toMatchObject({ summary: 'Revue tenue le 10/12/2026 · compte rendu saisi · dossier de séance figé (indicateurs arrêtés au 10/12/2026)' });

    const db = await getDb();
    const [item] = await db.select().from(t.auditPlanItems).where(eq(t.auditPlanItems.reviewId, annual.id));
    expect(item).toMatchObject({ done: true, doneOn: '2026-12-10' });
    expect(await lastLog('audit_plan_item', item.id)).toMatchObject({ action: 'status', summary: 'Réalisé (revue tenue le 10/12/2026)' });
    const next = await reviewOn('2027-06-17');
    expect(next).toMatchObject({ status: 'planifiee', kind: 'intermediaire' });
    const [nextItem] = await db.select().from(t.auditPlanItems).where(eq(t.auditPlanItems.reviewId, next.id));
    expect(nextItem).toMatchObject({ year: 2027, month: 6, label: 'Interm. 17/06' });
  });

  it('compte rendu corrigé après la séance : dossier de séance conservé, compte rendu courant', async () => {
    actAs('Animateur QHSE', 'all');
    const annual = await reviewOn('2026-12-10');
    const frozenOpenNc = parseReviewSnapshot(annual.snapshot)!.dossier.events.openNc.map((e) => e.id);
    // NC saisies après le figeage : l'une datée après la séance, l'autre antidatée (saisie tardive) : hors dossier de séance.
    await newNc('EV-2026-901', '2026-12-12');
    await newNc('EV-2026-902', '2026-12-05');
    // Correction sans changement de date : pas de nouveau figeage (un site précis suffit).
    actAs('Animateur QHSE', 'ville-a');
    expect(await holdReview({}, holdForm(annual.id, 'Compte rendu corrigé'))).toEqual({ ok: true });
    actAs('Animateur QHSE', 'all');
    const page = await loadReviewDossierPage({ revue: String(annual.id) });
    expect(page.mode).toBe('seance');
    if (page.mode !== 'seance') return;
    expect(page.dossier.record.minutes).toBe('Compte rendu corrigé');
    expect(page.dossier.events.openNc.map((e) => e.id)).toEqual(frozenOpenNc);
    expect(page.asOf).toBe('2026-12-10');
  });

  it('visa le 20/12 : dossier de séance et compte rendu courant figés, sans les NC saisies depuis', async () => {
    setToday('2026-12-20');
    actAs('Animateur QHSE', 'ville-a');
    const annual = await reviewOn('2026-12-10');
    expect(await closeReview(annual.id)).toEqual({ error: 'Sélectionnez « Tous les sites » : le dossier archivé couvre tout le périmètre.' });
    actAs('Animateur QHSE', 'all');
    expect(await closeReview(annual.id)).toEqual({});
    const closed = await reviewOn('2026-12-10');
    expect(closed).toMatchObject({ status: 'cloturee', closedOn: '2026-12-20', closedById: 'clefevre' });
    const snap = parseReviewSnapshot(closed.snapshot)!;
    expect(snap).toMatchObject({ phase: 'cloture', asOf: '2026-12-10', takenOn: '2026-12-20', seance: { takenOn: '2026-12-15', takenBy: '[C. Lefèvre]' } });
    expect(snap.dossier.header).toMatchObject({ status: 'cloturee', to: '2026-12-10' });
    expect(snap.dossier.record).toMatchObject({ minutes: 'Compte rendu corrigé', closedOn: '2026-12-20', closedBy: '[C. Lefèvre]' });
    expect(snap.dossier.events.openNc.some((e) => e.id === 'EV-2026-901' || e.id === 'EV-2026-902')).toBe(false);
    expect(await lastLog('review', annual.id)).toMatchObject({ summary: 'Revue clôturée · visa de la direction, dossier figé (indicateurs arrêtés au 10/12/2026)' });
    const page = await loadReviewDossierPage({ revue: String(annual.id) });
    expect(page).toMatchObject({ mode: 'snapshot', asOf: '2026-12-10', takenOn: '2026-12-20', seance: { takenOn: '2026-12-15' } });
  });

  it('revue tenue avant le lot 2 (sans dossier de séance) : dossier calculé au visa, arrêté à la séance', async () => {
    actAs('Animateur QHSE', 'all');
    const db = await getDb();
    const [old] = await db.insert(t.reviews).values({ reviewOn: '2026-11-05', kind: 'intermediaire', status: 'tenue', minutes: 'Séance de novembre', snapshot: null }).returning();
    expect(await closeReview(old.id)).toEqual({});
    const snap = parseReviewSnapshot((await reviewOn('2026-11-05')).snapshot)!;
    expect(snap).toMatchObject({ phase: 'cloture', asOf: '2026-11-05' });
    expect(snap.seance).toBeUndefined();
    expect(snap.dossier.header).toMatchObject({ from: '2025-11-06', to: '2026-11-05', status: 'cloturee' });
    expect(snap.dossier.record.minutes).toBe('Séance de novembre');
  });
});
