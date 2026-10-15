import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { actionRow, insertAction } from './actions-helpers';
import { asc, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { abandonAction, moveAction, reopenAction } from '@/server/plan-ui';

// Cycle de vie (ACT-21, § 6.2) : transitions faites par le service QHSE seulement, avancement affiché contrôlé, journal
// « status » structuré (D11 : fromKey / toKey), réouverture et abandon motivés, site sélectionné.

freshDemoDatabase();

const APPROVERS_ONLY = "Réservé à l'animateur QHSE et à la direction.";
const STALE = "L'action a changé entre-temps : la fiche est actualisée.";
const OTHER_SITE = 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.';
const move = (id: string, from: string, to: string, extra: Record<string, string> = {}) => moveAction({}, form({ id, from, to, ...extra }));

describe('droits et avancement affiché', () => {
  it('hors QHSE : refusé, y compris le responsable salarié de A-215', async () => {
    for (const role of ['Chef de service', 'Chef de projet', 'Salarié'] as const) {
      actAs(role);
      expect(await move('A-215', 'a_faire', 'p20')).toEqual({ error: APPROVERS_ONLY });
      expect(await abandonAction({}, form({ id: 'A-215', from: 'a_faire', reason: 'Test' }))).toEqual({ error: APPROVERS_ONLY });
      expect(await reopenAction({}, form({ id: 'A-165', from: 'verifiee', reason: 'Test' }))).toEqual({ error: APPROVERS_ONLY });
    }
    expect((await actionRow('A-215')).status).toBe('a_faire');
  });

  it('avancement périmé, transition hors de moveAction : refusés sans écriture', async () => {
    actAs('Animateur QHSE');
    const logs = (await changeLog('action', 'A-215')).length;
    expect(await move('A-215', 'p20', 'p40')).toEqual({ error: STALE });
    expect(await move('A-215', 'a_faire', 'verifiee')).toMatchObject({ error: "Changement d'avancement non permis." });
    expect(await move('A-215', 'a_faire', 'abandonnee')).toMatchObject({ error: "Changement d'avancement non permis." });
    expect(await move('A-215', 'a_faire', 'a_faire')).toMatchObject({ error: "Changement d'avancement non permis." });
    expect((await changeLog('action', 'A-215')).length).toBe(logs);
  });
});

describe('transitions de moveAction (step, report, resume, finish, unfinish)', () => {
  it('paliers libres dans les deux sens, journal structuré', async () => {
    actAs('Animateur QHSE');
    await insertAction('A-T10');
    expect(await move('A-T10', 'a_faire', 'p60')).toEqual({ ok: true, id: 'A-T10' });
    expect(await lastLog('action', 'A-T10')).toMatchObject({
      action: 'status', summary: 'Avancement : À faire → 60 %', byId: 'clefevre',
      details: [{ field: 'Avancement', from: 'À faire', to: '60 %', fromKey: 'a_faire', toKey: 'p60' }],
    });
    expect(await move('A-T10', 'p60', 'initiee')).toEqual({ ok: true, id: 'A-T10' });
    expect((await actionRow('A-T10')).status).toBe('initiee');
  });

  it('Reportée avec commentaire (fil + motif), reprise avec nouvelle date cible contrôlée', async () => {
    actAs('Animateur QHSE');
    expect(await move('A-T10', 'initiee', 'reportee', { comment: 'Attente de la livraison du fournisseur.' })).toEqual({ ok: true, id: 'A-T10' });
    const entries = await changeLog('action', 'A-T10');
    expect(entries.at(-2)).toMatchObject({ action: 'status', summary: 'Reportée', reason: 'Attente de la livraison du fournisseur.' });
    expect(entries.at(-1)).toMatchObject({ action: 'comment', summary: 'Commentaire ajouté' });
    const comments = await (await getDb()).select().from(t.actionComments).where(eq(t.actionComments.actionId, 'A-T10'));
    expect(comments).toMatchObject([{ body: 'Attente de la livraison du fournisseur.', authorId: 'clefevre', authorRole: 'Animateur QHSE' }]);
    expect(await move('A-T10', 'reportee', 'p40', { dueOn: '2026-10-01' })).toMatchObject({ fieldErrors: { dueOn: expect.any(String) } });
    expect(await move('A-T10', 'reportee', 'p40', { dueOn: '2026-12-20' })).toMatchObject({ ok: true });
    expect(await actionRow('A-T10')).toMatchObject({ status: 'p40', dueOn: '2026-12-20', initialDueOn: '2026-11-30' });
    expect(await lastLog('action', 'A-T10')).toMatchObject({
      summary: 'Reprise : 40 %', details: [{ fromKey: 'reportee', toKey: 'p40' }, { field: 'Date cible', from: '30/11/2026', to: '20/12/2026' }],
    });
  });

  it('Terminée : date effective (aujourd’hui par défaut) contrôlée, vérification planifiée exigée quand absente', async () => {
    actAs('Animateur QHSE');
    expect(await move('A-T10', 'p40', 'terminee', { doneOn: '2026-10-10' })).toMatchObject({ fieldErrors: { doneOn: 'La date effective ne peut pas être dans le futur.' } });
    expect(await move('A-T10', 'p40', 'terminee', { doneOn: '2026-09-30' })).toMatchObject({ fieldErrors: { doneOn: expect.stringContaining("date d'ouverture") } });
    expect(await move('A-T10', 'p40', 'terminee')).toEqual({ ok: true, id: 'A-T10' });
    expect(await actionRow('A-T10')).toMatchObject({ status: 'terminee', doneOn: '2026-10-09' });
    expect(await lastLog('action', 'A-T10')).toMatchObject({ summary: 'Terminée le 09/10/2026', details: [{ toKey: 'terminee' }, { field: 'Date effective', from: null, to: '09/10/2026' }] });
    await insertAction('A-T11', { verifyDueOn: null });
    expect(await move('A-T11', 'a_faire', 'terminee')).toMatchObject({ fieldErrors: { verifyDueOn: expect.any(String) } });
    expect(await move('A-T11', 'a_faire', 'terminee', { doneOn: '2026-10-05', verifyDueOn: '2026-11-02' })).toMatchObject({ ok: true });
    expect(await actionRow('A-T11')).toMatchObject({ status: 'terminee', doneOn: '2026-10-05', verifyDueOn: '2026-11-02' });
  });

  it('retour depuis Terminée : date effective effacée, gardée au journal', async () => {
    actAs('Animateur QHSE');
    expect(await move('A-T10', 'terminee', 'p80')).toEqual({ ok: true, id: 'A-T10' });
    expect(await actionRow('A-T10')).toMatchObject({ status: 'p80', doneOn: null });
    expect(await lastLog('action', 'A-T10')).toMatchObject({ summary: 'Retour à 80 % : date effective effacée', details: [{ fromKey: 'terminee' }, { field: 'Date effective', from: '09/10/2026', to: null }] });
  });

  it('action d’un autre site que le site sélectionné : refusée, rien écrit', async () => {
    actAs('Animateur QHSE', 'ville-b');
    const logs = (await changeLog('action', 'A-T10')).length;
    expect(await move('A-T10', 'p80', 'p60')).toEqual({ error: OTHER_SITE });
    expect(await abandonAction({}, form({ id: 'A-T10', from: 'p80', reason: 'Test' }))).toEqual({ error: OTHER_SITE });
    expect(await reopenAction({}, form({ id: 'A-176', from: 'verifiee', reason: 'Test' }))).toEqual({ error: OTHER_SITE });
    expect((await changeLog('action', 'A-T10')).length).toBe(logs);
    expect((await actionRow('A-176')).status).toBe('verifiee');
  });
});

describe('réouverture (Vérifiée → Terminée, motif obligatoire)', () => {
  it('motif obligatoire ; champs de vérification effacés, anciennes valeurs au journal ; suites en place', async () => {
    actAs('Animateur QHSE');
    expect(await reopenAction({}, form({ id: 'A-170', from: 'verifiee', reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await reopenAction({}, form({ id: 'A-170', from: 'terminee', reason: 'Test' }))).toEqual({ error: "Changement d'avancement non permis." });
    expect(await reopenAction({}, form({ id: 'A-170', from: 'verifiee', reason: 'Constat à reprendre après la visite du 08/10.' }))).toEqual({ ok: true, id: 'A-170' });
    expect(await actionRow('A-170')).toMatchObject({ status: 'terminee', closedOn: null, verifyMethod: null, efficacyNote: null, effective: null, newRisk: false, verifiedById: null, doneOn: '2026-09-24' });
    expect(await lastLog('action', 'A-170')).toMatchObject({
      action: 'status', reason: 'Constat à reprendre après la visite du 08/10.', summary: 'Vérification rouverte : retour à Terminée — à vérifier',
      details: [
        { field: 'Avancement', fromKey: 'verifiee', toKey: 'terminee' }, { field: 'Date de vérification', from: '29/09/2026', to: null },
        { field: 'Nature de la vérification', from: 'Visuelle', to: null }, { field: 'Constat de vérification', from: '(texte précédent)', to: null },
        { field: 'Résultat', from: 'Non efficace', to: null }, { field: 'Vérifiée par', from: '[C. Lefèvre]', to: null },
      ],
    });
    expect((await actionRow('A-221')).followsActionId).toBe('A-170');
  });
});

describe('abandon (motif obligatoire, liens détachés, état définitif)', () => {
  it('motif, détachement des sources (journal des sources), événement conservé, puis consultation seule', async () => {
    actAs('Animateur QHSE');
    const db = await getDb();
    expect(await abandonAction({}, form({ id: 'A-214', from: 'p40', reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await abandonAction({}, form({ id: 'A-214', from: 'p40', reason: 'Remplacée par la refonte du poste M3.' }))).toEqual({ ok: true, id: 'A-214' });
    expect(await actionRow('A-214')).toMatchObject({ status: 'abandonnee', cancelledById: 'clefevre', cancelReason: 'Remplacée par la refonte du poste M3.', eventId: 'EV-2026-131' });
    expect(await db.select().from(t.riskActions).where(eq(t.riskActions.actionId, 'A-214'))).toEqual([]);
    const log = await lastLog('action', 'A-214');
    expect(log).toMatchObject({ action: 'status', summary: 'Abandonnée', reason: 'Remplacée par la refonte du poste M3.' });
    expect(log!.details).toEqual([
      { field: 'Avancement', from: '40 %', to: 'Abandonnée', fromKey: 'p40', toKey: 'abandonnee' },
      { field: 'Détachée de', from: 'Atelier montage · Manutention mécanique', to: null },
    ]);
    expect(await lastLog('risk', 1)).toMatchObject({ action: 'unlink', summary: 'Action A-214 abandonnée : détachée', reason: 'Remplacée par la refonte du poste M3.' });
    expect(await abandonAction({}, form({ id: 'A-214', from: 'abandonnee', reason: 'Encore' }))).toEqual({ error: 'Action déjà abandonnée.' });
    expect(await move('A-214', 'abandonnee', 'p40')).toMatchObject({ error: "Changement d'avancement non permis." });
    // Vérifiée : rouvrir d'abord.
    expect(await abandonAction({}, form({ id: 'A-165', from: 'verifiee', reason: 'Test' }))).toEqual({ error: "Action vérifiée : rouvrez-la avant de l'abandonner." });
    const rows = await db.select().from(t.changeLog).where(eq(t.changeLog.entityId, 'A-214')).orderBy(asc(t.changeLog.id));
    expect(rows.every((r) => r.action !== 'cancel')).toBe(true);
  });

  it('Terminée et Reportée abandonnables', async () => {
    actAs('Animateur QHSE');
    expect(await abandonAction({}, form({ id: 'A-190', from: 'terminee', reason: 'Doublon' }))).toEqual({ ok: true, id: 'A-190' });
    expect(await abandonAction({}, form({ id: 'A-174', from: 'reportee', reason: 'Formation reprise par les RH' }))).toEqual({ ok: true, id: 'A-174' });
  });
});
