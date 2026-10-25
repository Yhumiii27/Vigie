import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, freshDemoDatabase, lastLog } from '../helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { REASON_MAX } from '@/lib/domain';
import { reasonError } from '@/lib/forms';
import { restoreContractor } from '@/server/contractors';
import { cancelReview, rescheduleReview } from '@/server/review';
import { archiveSite, restoreSite } from '@/server/sites';
import { reinstatePerson, setPersonLeft } from '@/server/skills';
import { archiveRequirement } from '@/server/watch';

// QUA-22 : motif unifié (formReader(fd).reason() / reasonError : obligatoire, REASON_MAX caractères, même message).
// Changements volontaires : restaurations et réintégration avec motif (site, entreprise extérieure, titre, salarié),
// report d'une revue avec motif ; plus de règle locale (3 caractères au moins pour la veille, 300 au plus pour l'annulation
// d'une revue, 500 au plus pour l'archivage d'un site, 200 au plus pour une sortie de l'effectif). Jeu de démonstration au
// 09/10/2026 : EE-007 archivée ; site ville-c archivé ; revue annuelle planifiée le 10/12/2026.

freshDemoDatabase();

const LONG = 'x'.repeat(REASON_MAX + 1);
const OK_LONG = 'y'.repeat(REASON_MAX);

describe('règle commune du motif', () => {
  it('reasonError : obligatoire (espaces seuls refusés), REASON_MAX caractères au plus', () => {
    expect(reasonError('')).toBe('Motif obligatoire.');
    expect(reasonError('   ')).toBe('Motif obligatoire.');
    expect(reasonError(undefined)).toBe('Motif obligatoire.');
    expect(reasonError(OK_LONG)).toBeNull();
    expect(reasonError(LONG)).toBe(`${REASON_MAX} caractères au maximum.`);
    expect(reasonError('ok')).toBeNull();
  });

  it('plus de règle locale : motif court admis (veille), motif long admis jusqu’à REASON_MAX (revue, site)', async () => {
    actAs('Animateur QHSE', 'all');
    expect(await archiveRequirement({}, form({ id: '8', reason: 'Ab' }))).toMatchObject({ ok: true });
    expect(await lastLog('requirement', 8)).toMatchObject({ action: 'archive', reason: 'Ab' });
    const db = await getDb();
    const [planned] = await db.select().from(t.reviews).where(eq(t.reviews.status, 'planifiee'));
    expect(await cancelReview({}, form({ id: String(planned.id), reason: LONG }))).toMatchObject({ fieldErrors: { reason: `${REASON_MAX} caractères au maximum.` } });
    expect(await archiveSite({}, form({ siteId: 'ville-b', reason: 'z'.repeat(800) }))).toMatchObject({ ok: true });
    expect((await db.select().from(t.sites).where(eq(t.sites.id, 'ville-b')))[0].archiveReason).toHaveLength(800);
  });
});

describe('restaurations et réintégration avec motif', () => {
  it('site : droits, motif obligatoire, journal avec motif', async () => {
    actAs('Chef de service', 'all');
    expect(await restoreSite({}, form({ siteId: 'ville-b', reason: 'Reprise' }))).toEqual({ error: "Réservé à l'animateur QHSE et à la direction." });
    actAs('Animateur QHSE', 'all');
    expect(await restoreSite({}, form({ siteId: 'ville-b', reason: ' ' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await restoreSite({}, form({ siteId: 'ville-b', reason: 'Archivé par erreur' }))).toEqual({ ok: true, id: 'ville-b' });
    expect(await lastLog('site', 'ville-b')).toMatchObject({ action: 'restore', reason: 'Archivé par erreur' });
  });

  it('entreprise extérieure : droits, motif obligatoire, journal avec motif', async () => {
    actAs('Salarié', 'ville-a');
    expect((await restoreContractor({}, form({ id: 'EE-007', reason: 'Retour' }))).error).toBeDefined();
    actAs('Chef de service', 'ville-a');
    expect(await restoreContractor({}, form({ id: 'EE-007', reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await restoreContractor({}, form({ id: 'EE-007', reason: 'Nouveau contrat d’entretien' }))).toEqual({ ok: true, id: 'EE-007' });
    expect(await lastLog('contractor', 'EE-007')).toMatchObject({ action: 'restore', reason: 'Nouveau contrat d’entretien', byId: 'sbenali' });
    expect(await restoreContractor({}, form({ id: 'EE-007', reason: 'Encore' }))).toEqual({ error: "Cette entreprise n'est pas archivée." });
  });

  it('salarié : sortie (motif commun) puis réintégration avec motif, site contrôlé', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await setPersonLeft({}, form({ id: 'mgirard', leftOn: '2026-10-09', leftReason: '' }))).toMatchObject({ fieldErrors: { leftReason: 'Motif obligatoire.' } });
    expect(await setPersonLeft({}, form({ id: 'mgirard', leftOn: '2026-10-09', leftReason: 'w'.repeat(300) }))).toEqual({ ok: true, id: 'mgirard' });
    expect(await reinstatePerson({}, form({ id: 'mgirard', reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    actAs('Animateur QHSE', 'ville-b');
    expect((await reinstatePerson({}, form({ id: 'mgirard', reason: 'Retour' }))).error).toMatch(/autre site/);
    actAs('Animateur QHSE', 'ville-a');
    expect(await reinstatePerson({}, form({ id: 'mgirard', reason: 'Sortie saisie par erreur' }))).toEqual({ ok: true, id: 'mgirard' });
    expect(await lastLog('person', 'mgirard')).toMatchObject({ action: 'restore', reason: 'Sortie saisie par erreur' });
  });

  it('report d’une revue : motif obligatoire, inscrit au journal de la revue', async () => {
    actAs('Animateur QHSE', 'all');
    const db = await getDb();
    const [planned] = await db.select().from(t.reviews).where(eq(t.reviews.status, 'planifiee'));
    expect(await rescheduleReview({}, form({ id: String(planned.id), to: '2026-12-17' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await rescheduleReview({}, form({ id: String(planned.id), to: '2026-12-17', reason: 'Direction indisponible le 10/12' }))).toEqual({ ok: true });
    expect(await lastLog('review', planned.id)).toMatchObject({ summary: 'Revue reportée au 17/12/2026', reason: 'Direction indisponible le 10/12' });
  });
});
