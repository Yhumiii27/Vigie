import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { actionCount, actionRow, insertAction, logCount, notificationsOf } from './actions-helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { moveAction, verifyAction } from '@/server/plan-ui';

// Vérification d'efficacité (ACT-23, § 7) et actions de suite dans la même transaction : non efficace, nouveau risque,
// les deux ; reprise des liens de l'action vérifiée (D21 : élément de la source, liens à plusieurs actions rattachés aussi,
// liens à action unique déplacés vers la première suite, journaux des deux actions et de la source) ; pointage (ACT-26).

freshDemoDatabase();

const APPROVERS_ONLY = "Réservé à l'animateur QHSE et à la direction.";
const OTHER_SITE = 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.';
const VERIFY = { from: 'terminee', verifyMethod: 'visuelle', efficacyNote: 'Constat sur place.', effective: 'efficace' };
const section = (p: 'ne_' | 'nr_', extra: Record<string, string> = {}) => Object.fromEntries(Object.entries({
  detail: 'Nouvelle mesure de suite', pilotId: 'rfontaine', priority: 'urgent', dueOn: '2026-11-20', verifyDueOn: '2026-12-10', domain: 'securite',
  riskLevel: '2', siteId: 'ville-a', ...extra,
}).map(([k, v]) => [`${p}${k}`, v]));
const verify = (id: string, extra: Record<string, string> = {}) => verifyAction({}, form({ id, ...VERIFY, ...extra }));

describe('droits, validation, site', () => {
  it('hors QHSE : refusé', async () => {
    for (const role of ['Chef de service', 'Chef de projet', 'Salarié'] as const) {
      actAs(role);
      expect(await verify('A-172')).toEqual({ error: APPROVERS_ONLY });
    }
  });

  it('champs obligatoires, dates de vérification, avancement autre que Terminée', async () => {
    actAs('Animateur QHSE');
    const r = await verifyAction({}, form({ id: 'A-172', from: 'terminee' }));
    expect(Object.keys(r.fieldErrors!)).toEqual(expect.arrayContaining(['verifyMethod', 'efficacyNote', 'effective']));
    expect(await verify('A-172', { closedOn: '2026-09-28' })).toMatchObject({ fieldErrors: { closedOn: expect.stringContaining('date effective') } });
    expect(await verify('A-172', { closedOn: '2026-10-10' })).toMatchObject({ fieldErrors: { closedOn: 'La date de vérification ne peut pas être dans le futur.' } });
    expect(await verify('A-172', { hours: '-1' })).toMatchObject({ fieldErrors: { hours: expect.any(String) } });
    expect(await verifyAction({}, form({ id: 'A-214', ...VERIFY, from: 'p40' }))).toEqual({ error: "Changement d'avancement non permis." });
    expect(await verify('A-214')).toEqual({ error: "L'action a changé entre-temps : la fiche est actualisée." });
    expect((await actionRow('A-172')).status).toBe('terminee');
  });

  it('action d’un autre site que le site sélectionné : refusée, rien écrit', async () => {
    actAs('Animateur QHSE', 'ville-b');
    const logs = await logCount();
    expect(await verify('A-172')).toEqual({ error: OTHER_SITE });
    expect(await logCount()).toBe(logs);
  });
});

describe('efficace', () => {
  it('Vérifiée : date (aujourd’hui par défaut), nature, constat, résultat, pointage, vérificateur ; journal structuré', async () => {
    actAs('Animateur QHSE');
    expect(await verify('A-172', { hours: '3,5' })).toEqual({ ok: true, id: 'A-172' });
    expect(await actionRow('A-172')).toMatchObject({
      status: 'verifiee', closedOn: '2026-10-09', verifyMethod: 'visuelle', efficacyNote: 'Constat sur place.', effective: true, newRisk: false,
      verifiedById: 'clefevre', hours: 3.5,
    });
    expect(await lastLog('action', 'A-172')).toMatchObject({
      action: 'status', summary: 'Vérifiée : efficace', byId: 'clefevre',
      details: [
        { field: 'Avancement', from: 'Terminée — à vérifier', to: 'Vérifiée', fromKey: 'terminee', toKey: 'verifiee' },
        { field: 'Date de vérification', from: null, to: '09/10/2026' }, { field: 'Nature de la vérification', from: null, to: 'Visuelle' },
        { field: 'Résultat', from: null, to: 'Efficace' }, { field: 'Pointage', from: null, to: '3,5 h' },
      ],
    });
  });

  it('pointage : champ absent de la demande → valeur actuelle gardée ; champ vide → effacé (journalisé)', async () => {
    actAs('Animateur QHSE');
    await insertAction('A-T21', { status: 'terminee', doneOn: '2026-10-05', hours: 2 });
    expect(await verify('A-T21')).toEqual({ ok: true, id: 'A-T21' });
    expect((await actionRow('A-T21')).hours).toBe(2);
    await insertAction('A-T22', { status: 'terminee', doneOn: '2026-10-05', hours: 2 });
    expect(await verify('A-T22', { hours: '' })).toEqual({ ok: true, id: 'A-T22' });
    expect((await actionRow('A-T22')).hours).toBeNull();
    expect((await lastLog('action', 'A-T22'))!.details).toEqual(expect.arrayContaining([{ field: 'Pointage', from: '2 h', to: null }]));
  });

  it('autovérification admise (ACT-13)', async () => {
    actAs('Animateur QHSE');
    await insertAction('A-T20', { pilotId: 'clefevre', status: 'terminee', doneOn: '2026-10-05' });
    expect(await verify('A-T20')).toEqual({ ok: true, id: 'A-T20' });
    expect(await actionRow('A-T20')).toMatchObject({ status: 'verifiee', verifiedById: 'clefevre', pilotId: 'clefevre' });
  });
});

describe('non efficace, nouveau risque : actions de suite (D21)', () => {
  it('section invalide ou site refusé : rien n’est écrit', async () => {
    actAs('Animateur QHSE', 'all');
    const before = await actionCount();
    const logs = await logCount();
    expect(await verify('A-186', { effective: 'non_efficace', ...section('ne_', { dueOn: '' }) })).toMatchObject({ fieldErrors: { ne_dueOn: 'Date obligatoire.' } });
    expect(await verify('A-186', { newRisk: 'on', ...section('nr_') })).toMatchObject({ fieldErrors: { nr_problem: 'Champ obligatoire.' } });
    expect(await verify('A-186', { effective: 'non_efficace', ...section('ne_', { siteId: 'ville-c' }) })).toMatchObject({ fieldErrors: { ne_siteId: 'Site archivé ou inconnu : choisissez un site actif.' } });
    expect(await verify('A-186', { effective: 'non_efficace', ...section('ne_', { siteId: 'ville-b' }) })).toMatchObject({ fieldErrors: { ne_siteId: expect.any(String) } });
    expect(await verify('A-186', { effective: 'non_efficace', ...section('ne_', { pilotId: 'ylambert' }) })).toMatchObject({ fieldErrors: { ne_pilotId: expect.any(String) } });
    expect(await verify('A-186', { effective: 'non_efficace', ...section('ne_', { dueOn: '2026-10-01' }) })).toMatchObject({ fieldErrors: { ne_dueOn: expect.any(String) } });
    expect(await actionCount()).toBe(before);
    expect(await logCount()).toBe(logs);
    expect((await actionRow('A-186')).status).toBe('terminee');
  });

  // AUD-28 (changement volontaire) : le constat, qui porte plusieurs actions, est rattaché aussi à la suite au lieu d'être déplacé.
  it('exigence, contrôle déplacés ; constat et risque sur les deux actions ; journaux de la vérifiée, de la suite et de la source', async () => {
    actAs('Animateur QHSE');
    const db = await getDb();
    await insertAction('A-T30', { status: 'terminee', doneOn: '2026-10-02', source: 'audit_interne', originRef: 'Audit interne · §7.2', pilotId: 'lmoreau' });
    await db.insert(t.findingActions).values({ findingId: 3, actionId: 'A-T30' });
    await db.update(t.requirements).set({ actionId: 'A-T30' }).where(eq(t.requirements.id, 4));
    await db.update(t.controls).set({ actionId: 'A-T30' }).where(eq(t.controls.id, 3));
    await db.insert(t.riskActions).values({ riskId: 2, actionId: 'A-T30' });
    const r = await verify('A-T30', { effective: 'non_efficace', efficacyNote: 'Écart encore constaté.', ...section('ne_') });
    expect(r).toMatchObject({ ok: true, id: 'A-T30', ids: [expect.stringMatching(/^A-\d+$/)] });
    const [next] = r.ids!;
    expect(await actionRow('A-T30')).toMatchObject({ status: 'verifiee', effective: false });
    expect(await actionRow(next)).toMatchObject({
      status: 'a_faire', source: 'audit_interne', originRef: 'Audit interne · §7.2', followsActionId: 'A-T30', followReason: 'non_efficace',
      problem: 'Action A-T30 jugée non efficace le 09/10/2026 : Écart encore constaté.', pilotId: 'rfontaine', siteId: 'ville-a', openedOn: '2026-10-09',
    });
    expect((await db.select().from(t.findingActions).where(eq(t.findingActions.findingId, 3))).map((x) => x.actionId).sort()).toEqual(['A-T30', next].sort());
    expect((await db.select().from(t.requirements).where(eq(t.requirements.id, 4)))[0].actionId).toBe(next);
    expect((await db.select().from(t.controls).where(eq(t.controls.id, 3)))[0].actionId).toBe(next);
    expect((await db.select().from(t.riskActions).where(eq(t.riskActions.riskId, 2))).map((x) => x.actionId).sort()).toEqual(['A-205', 'A-T30', next].sort());
    const verified = (await changeLog('action', 'A-T30')).map((e) => [e.action, e.summary]);
    expect(verified).toEqual(expect.arrayContaining([
      ['status', 'Vérifiée : non efficace'],
      ['unlink', expect.stringMatching(new RegExp(`^Exigence · .* repris par l'action de suite ${next}$`))],
      ['unlink', expect.stringMatching(new RegExp(` repris par l'action de suite ${next}$`))],
      ['follow_up', `Action de suite ${next} créée (non efficace)`],
    ]));
    expect(verified.filter(([a]) => a === 'unlink')).toHaveLength(2);
    expect(verified.some(([, summary]) => /^Constat · .* repris par/.test(summary ?? ''))).toBe(false);
    expect(await changeLog('action', next)).toMatchObject([{ action: 'create', summary: 'Action de suite de A-T30 créée (non efficace)', byId: 'clefevre' }]);
    expect(await lastLog('audit_finding', 3)).toMatchObject({ action: 'link', summary: `Action ${next} créée et rattachée` });
    expect(await lastLog('risk', 2)).toMatchObject({ action: 'link', summary: `Action ${next} créée et rattachée` });
    expect((await notificationsOf('rfontaine')).at(-1)).toMatchObject({ type: 'action_confiee', entityId: next });
  });

  it('ligne reprise à plusieurs éléments (A-212) : la suite reprend l’événement seulement, la version est déplacée', async () => {
    actAs('Animateur QHSE');
    const db = await getDb();
    expect(await moveAction({}, form({ id: 'A-212', from: 'p60', to: 'terminee', doneOn: '2026-10-08' }))).toMatchObject({ ok: true });
    const r = await verify('A-212', { effective: 'non_efficace', ...section('ne_') });
    const [next] = r.ids!;
    expect(await actionRow(next)).toMatchObject({ eventId: 'EV-2026-130', source: 'evenement' });
    expect((await db.select().from(t.findingActions).where(eq(t.findingActions.findingId, 2))).map((x) => x.actionId)).toEqual(['A-212']);
    expect((await db.select().from(t.documentVersions).where(eq(t.documentVersions.id, 25)))[0].actionId).toBe(next);
    expect((await actionRow('A-212')).eventId).toBe('EV-2026-130');
  });

  it('événement fermé aux actions (A-190, EV-2026-112 « Efficacité vérifiée ») : suite sans événement, référence d’origine gardée', async () => {
    actAs('Animateur QHSE');
    const r = await verify('A-190', { effective: 'non_efficace', ...section('ne_') });
    const [next] = r.ids!;
    expect(await actionRow(next)).toMatchObject({ eventId: null, originRef: 'EV-2026-112', followsActionId: 'A-190' });
    expect((await actionRow('A-190')).eventId).toBe('EV-2026-112');
  });

  it('nouveau risque seul (A-186, réclamation client) : suite rattachée à l’événement, description du risque', async () => {
    actAs('Animateur QHSE');
    const r = await verify('A-186', { newRisk: 'on', ...section('nr_', { problem: 'Joints de rechange non conformes au stock.' }) });
    expect(r).toMatchObject({ ok: true, ids: [expect.any(String)] });
    expect(await actionRow('A-186')).toMatchObject({ status: 'verifiee', effective: true, newRisk: true });
    expect(await actionRow(r.ids![0])).toMatchObject({ followReason: 'nouveau_risque', problem: 'Joints de rechange non conformes au stock.', eventId: 'EV-2026-128', source: 'reclamation_client' });
  });

  it('non efficace et nouveau risque : deux suites, liens à action unique sur la première seulement', async () => {
    actAs('Animateur QHSE');
    const db = await getDb();
    await insertAction('A-T31', { status: 'terminee', doneOn: '2026-10-02', source: 'veille' });
    await db.update(t.requirements).set({ actionId: 'A-T31' }).where(eq(t.requirements.id, 5));
    await db.insert(t.riskActions).values({ riskId: 4, actionId: 'A-T31' });
    const r = await verify('A-T31', { effective: 'non_efficace', newRisk: 'on', ...section('ne_'), ...section('nr_', { problem: 'Nouveau risque de chute.', pilotId: 'proux' }) });
    expect(r.ids).toHaveLength(2);
    const [ne, nr] = r.ids!;
    expect(await actionRow(ne)).toMatchObject({ followReason: 'non_efficace', followsActionId: 'A-T31' });
    expect(await actionRow(nr)).toMatchObject({ followReason: 'nouveau_risque', followsActionId: 'A-T31', pilotId: 'proux' });
    expect((await db.select().from(t.requirements).where(eq(t.requirements.id, 5)))[0].actionId).toBe(ne);
    expect((await db.select().from(t.riskActions).where(eq(t.riskActions.riskId, 4))).map((x) => x.actionId).sort()).toEqual(['A-T31', ne, nr].sort());
    expect((await changeLog('action', 'A-T31')).filter((e) => e.action === 'follow_up').map((e) => e.summary)).toEqual([
      `Action de suite ${ne} créée (non efficace)`, `Action de suite ${nr} créée (nouveau risque)`,
    ]);
  });
});
