import { describe, expect, it } from 'vitest';
import '../next-mocks';
import { actAs, changeLog, freshDemoDatabase } from '../helpers';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { cancelQualification, cancelTrainingSession, saveTrainingSession } from '@/server/skills';
import { loadSkillMatrix } from '@/lib/data/skills';
import { groupRenewalCandidates, renewalForecast } from '@/lib/rules/skills';

// HAB-06 : session de formation collective et recyclage groupé — une formation par participant, en une transaction,
// journalisée (session, chaque formation, chaque exigence ajoutée) ; droits des éditeurs des habilitations, site
// sélectionné ; prérequis signalés (HAB-10) ; annulation motivée de la session (formations annulées, jamais supprimées).
// Jeu de démonstration au 09/10/2026 (tnguyen, mgirard, proux, kbernard : site [Ville A] ; amartin : [Ville B]).

freshDemoDatabase();

const db = () => getDb();
const DENIED = 'Votre rôle ne permet pas cette modification.';
const OTHER_SITE = 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.';

function sessionForm(fields: Record<string, string>, participants: string[]) {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  participants.forEach((p) => fd.append('participants', p));
  return fd;
}
const sessionQuals = async (sessionId: number) => (await db()).select().from(t.qualifications).where(eq(t.qualifications.sessionId, sessionId));

describe('saveTrainingSession : droits et contrôles', () => {
  it('Salarié et Chef de projet refusés ; rien n’est écrit', async () => {
    for (const role of ['Salarié', 'Chef de projet'] as const) {
      actAs(role);
      expect(await saveTrainingSession({}, sessionForm({ titleId: 'sst', heldOn: '2026-10-05' }, ['tnguyen']))).toEqual({ error: DENIED });
    }
    expect(await (await db()).select().from(t.trainingSessions)).toEqual([]);
  });

  it('participant d’un autre site que celui sélectionné : refusé, aucune formation créée (transaction)', async () => {
    actAs('Chef de service', 'ville-a');
    expect(await saveTrainingSession({}, sessionForm({ titleId: 'sst', heldOn: '2026-10-05' }, ['tnguyen', 'amartin']))).toEqual({ error: OTHER_SITE });
    expect(await (await db()).select().from(t.trainingSessions)).toEqual([]);
  });

  it('contrôles : participants, date future, échéance, titre archivé, salarié sorti', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const none = await saveTrainingSession({}, sessionForm({ titleId: 'sst', heldOn: '2026-10-05' }, []));
    expect(none.fieldErrors?.participants).toBe('Choisissez au moins un participant.');
    const twice = await saveTrainingSession({}, sessionForm({ titleId: 'sst', heldOn: '2026-10-05' }, ['tnguyen', 'tnguyen']));
    expect(twice.fieldErrors?.participants).toBe('Un participant est choisi deux fois.');
    const future = await saveTrainingSession({}, sessionForm({ titleId: 'sst', heldOn: '2026-10-20' }, ['tnguyen']));
    expect(future.fieldErrors?.heldOn).toMatch(/postérieure/);
    const expiry = await saveTrainingSession({}, sessionForm({ titleId: 'sst', heldOn: '2026-10-05', expiresOn: '2026-10-01' }, ['tnguyen']));
    expect(expiry.fieldErrors?.expiresOn).toMatch(/doit suivre/);
    expect((await saveTrainingSession({}, sessionForm({ titleId: 'pont-ancien', heldOn: '2026-10-05' }, ['tnguyen']))).error).toBe('Titre archivé.');
    await (await db()).update(t.people).set({ leftOn: '2026-10-01' }).where(eq(t.people.id, 'ylambert'));
    expect((await saveTrainingSession({}, sessionForm({ titleId: 'sst', heldOn: '2026-10-05' }, ['ylambert']))).error).toMatch(/sorti de l'effectif/);
    expect(await (await db()).select().from(t.trainingSessions)).toEqual([]);
  });
});

describe('saveTrainingSession : une formation par participant', () => {
  it('Chef de service : session, formations (échéance calculée), exigence ajoutée, journal de chaque élément', async () => {
    actAs('Chef de service', 'ville-a');
    const r = await saveTrainingSession({}, sessionForm({ titleId: 'sst', heldOn: '2026-10-05', provider: '[Croix-Rouge]' }, ['tnguyen', 'mgirard', 'kbernard']));
    expect(r).toMatchObject({ ok: true, message: 'Session enregistrée : 3 formations créées.' });
    const id = Number(r.id);
    const [session] = await (await db()).select().from(t.trainingSessions).where(eq(t.trainingSessions.id, id));
    expect(session).toMatchObject({ titleId: 'sst', heldOn: '2026-10-05', expiresOn: '2028-10-05', provider: '[Croix-Rouge]', recordedById: 'sbenali' });
    const quals = await sessionQuals(id);
    expect(quals.map((q) => q.personId).sort()).toEqual(['kbernard', 'mgirard', 'tnguyen']);
    expect(quals.every((q) => q.obtainedOn === '2026-10-05' && q.expiresOn === '2028-10-05' && q.provider === '[Croix-Rouge]')).toBe(true);
    // kbernard n'avait pas le SST requis : il le devient, journalisé.
    const [req] = await (await db()).select().from(t.qualificationRequirements)
      .where(and(eq(t.qualificationRequirements.personId, 'kbernard'), eq(t.qualificationRequirements.titleId, 'sst')));
    expect(req).toBeTruthy();
    expect((await changeLog('qualification_requirement', 'kbernard|sst')).at(-1)?.summary).toBe(`Titre « SST » requis (session collective n° ${id})`);
    const log = await changeLog('training_session', id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: 'create', byId: 'sbenali' });
    expect(log[0].summary).toBe('Session « SST » du 05/10/2026 enregistrée : 3 participants');
    for (const q of quals) expect((await changeLog('qualification', q.id)).map((e) => e.action)).toEqual(['create']);
    // La matrice reprend la formation de la session (case de tnguyen : SST valide jusqu'au 05/10/2028).
    const { rows } = await loadSkillMatrix();
    const cell = rows.find((x) => x.person.id === 'tnguyen')!.cells.find((c) => c.title.id === 'sst')!;
    expect(cell).toMatchObject({ state: 'v', expiresOn: '2028-10-05' });
    expect(cell.history[0].session).toEqual({ id, participants: 3, cancelled: false });
  });

  it('prérequis non valide (HAB-10) : enregistré, signalé dans la confirmation', async () => {
    actAs('Animateur QHSE', 'ville-a');
    // Autorisation de conduite : prérequis CACES R484 ou R489 ; kbernard n'en a aucun, tnguyen a le R484.
    const r = await saveTrainingSession({}, sessionForm({ titleId: 'conduite', heldOn: '2026-10-02' }, ['kbernard', 'tnguyen']));
    expect(r.ok).toBe(true);
    expect(r.message).toContain('Prérequis non valide (CACES R484 ou CACES R489) pour [K. Bernard]');
    expect(r.message).not.toContain('[T. Nguyen]');
    const { rows } = await loadSkillMatrix();
    expect(rows.find((x) => x.person.id === 'kbernard')!.cells.find((c) => c.title.id === 'conduite')!.state).toBe('p');
  });
});

describe('cancelTrainingSession : annulation motivée', () => {
  it('droits, motif obligatoire, formations annulées et journalisées, jamais supprimées', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const r = await saveTrainingSession({}, sessionForm({ titleId: 'hauteur', heldOn: '2026-10-06' }, ['tnguyen', 'proux']));
    const id = Number(r.id);
    const [first] = await sessionQuals(id);
    // Une formation de la session annulée seule (participant absent) : la session garde l'autre.
    expect(await cancelQualification({}, sessionForm({ id: String(first.id), reason: 'Absent le jour de la session' }, []))).toEqual({ ok: true });

    actAs('Salarié');
    expect(await cancelTrainingSession({}, sessionForm({ id: String(id), reason: 'Erreur' }, []))).toEqual({ error: DENIED });
    actAs('Animateur QHSE', 'ville-a');
    const noReason = await cancelTrainingSession({}, sessionForm({ id: String(id), reason: '' }, []));
    expect(noReason.fieldErrors?.reason).toBeTruthy();
    actAs('Animateur QHSE', 'ville-b');
    expect(await cancelTrainingSession({}, sessionForm({ id: String(id), reason: 'Mauvais titre' }, []))).toEqual({ error: OTHER_SITE });

    actAs('Animateur QHSE', 'ville-a');
    expect(await cancelTrainingSession({}, sessionForm({ id: String(id), reason: 'Mauvais titre' }, []))).toEqual({ ok: true });
    const [session] = await (await db()).select().from(t.trainingSessions).where(eq(t.trainingSessions.id, id));
    expect(session).toMatchObject({ cancelReason: 'Mauvais titre', cancelledById: 'clefevre' });
    const quals = await sessionQuals(id);
    expect(quals).toHaveLength(2);
    expect(quals.every((q) => q.cancelledAt)).toBe(true);
    // La formation déjà annulée garde son propre motif ; l'autre reçoit celui de la session.
    expect(quals.map((q) => q.cancelReason).sort()).toEqual(['Absent le jour de la session', 'Mauvais titre']);
    expect((await changeLog('training_session', id)).map((e) => [e.action, e.reason])).toEqual([['create', null], ['cancel', 'Mauvais titre']]);
    const other = quals.find((q) => q.id !== first.id)!;
    expect((await changeLog('qualification', other.id)).map((e) => e.action)).toEqual(['create', 'cancel']);
    expect(await cancelTrainingSession({}, sessionForm({ id: String(id), reason: 'Encore' }, []))).toEqual({ error: 'Cette session est déjà annulée.' });
  });
});

describe('recyclage groupé depuis la prévision (HAB-09)', () => {
  it('candidats d’un titre : à rattraper et proches cochés, plus lointains proposés', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const { rows } = await loadSkillMatrix();
    const forecast = renewalForecast(rows, '2026-10-09');
    const elec = groupRenewalCandidates(forecast, 'elec');
    expect(elec.find((c) => c.personId === 'mgirard')).toMatchObject({ preselected: true });
    expect(elec.every((c) => forecast.overdue.concat(forecast.months.flatMap((m) => m.items)).some((i) => i.personId === c.personId && i.titleId === 'elec'))).toBe(true);
  });
});
