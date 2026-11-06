import '../next-mocks';
import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { NEW_ACTION, actionRow } from './actions-helpers';
import { getDb, schema as t } from '@/db';
import { loadActionSources } from '@/lib/action-links';
import { QHSE_ONLY_CREATE_MESSAGE } from '@/lib/action-rules';
import { loadEngineering, loadEngineeringSignals } from '@/lib/data/engineering';
import { APPROVER_ONLY } from '@/lib/edit-rights';
import { loadEntityHistory } from '@/server/history';
import {
  advanceEco, cancelEco, cancelEcr, decideEcoApproval, decideEcr, implementEcr, proposeEcoEffectivity, saveEco, saveEcr, saveEffectivityTarget,
} from '@/server/engineering';
import { entityVersion } from '@/server/versions';
import { saveAction } from '@/server/plan';
import { linkAction } from '@/server/links';

// D12 (lot 5 de la convergence M-02), décision CV-06 du 05/11/2026 : demandes (ECR) et ordres (ECO) de modification tenus
// par Vigie (docs/specs/modifications-techniques.md). Droits par rôle, site, motifs, journal, numérotation, circuit
// d'approbation, libération d'office, annulation, effectivité proposée d'après Keystone, actions du plan, échéances.

freshDemoDatabase();

const eco = async (id: string) => (await (await getDb()).select().from(t.ecos).where(eq(t.ecos.id, id)))[0];
const ecr = async (id: string) => (await (await getDb()).select().from(t.ecrs).where(eq(t.ecrs.id, id)))[0];
const approval = async (id: string, key: string) =>
  (await (await getDb()).select().from(t.ecoApprovals).where(and(eq(t.ecoApprovals.ecoId, id), eq(t.ecoApprovals.approvalKey, key))))[0];
const targets = async (id: string) => (await getDb()).select().from(t.ecoEffectivity).where(eq(t.ecoEffectivity.ecoId, id)).orderBy(t.ecoEffectivity.position);
const version = async (entity: 'eco' | 'ecr', id: string) => entityVersion(await getDb(), entity, id);
const messagesOf = async (id: string) => (await getDb()).select().from(t.outboundMessages).where(eq(t.outboundMessages.entityId, id)).orderBy(t.outboundMessages.id);

const NEW_ECO = {
  title: 'Joint de cuve : nouveau matériau', ecoType: 'rev', fromRevision: 'A', toRevision: 'B', costEur: '320,50', scheduleDays: '5',
  stockImpact: '', description: 'Tenue chimique insuffisante.', pilotId: 'clefevre', siteId: 'site_a', parts: 'JNT-MAL-012', projects: 'K-2025-042',
  documents: 'Plan JNT-MAL-012 B\nContrôle | PRO-QUA-0006', approver_englead: '[E. Dubois]', approverId_englead: 'edubois',
  approver_quality: '[C. Lefèvre]', approverId_quality: 'clefevre', approver_pm: '[E. Dubois]', approverId_pm: '',
};

describe('lecture : registre et droits par rôle', () => {
  it('QHSE : ordres et demandes du jeu, approbations, effectivité, documents de Codex résolus', async () => {
    actAs('Animateur QHSE', 'all');
    const { ecos, ecrs } = await loadEngineering();
    expect(ecos.map((e) => e.id)).toEqual(['ECO-2026-003', 'ECO-2026-001', 'ECO-2026-002']);
    expect(ecrs.map((r) => r.id).sort()).toEqual(['ECR-2026-001', 'ECR-2026-002', 'ECR-2026-003']);
    const e1 = ecos.find((e) => e.id === 'ECO-2026-001')!;
    expect(e1).toMatchObject({ status: 'in_approval', pendingDispositions: 1, locked: false, interchangeability: 'yes' });
    expect(e1.approvals.map((a) => [a.key, a.decision, a.canDecide])).toEqual([['englead', 'ok', false], ['quality', 'pending', true], ['pm', 'pending', true]]);
    expect(e1.documents[1]).toMatchObject({ codexDocId: 'PRO-QUA-0006', label: expect.stringContaining('PRO-QUA-0006 · ') });
    expect(e1.parts[0].label).toBe('ARB-MAL-045 · Arbre de malaxeur Ø45 h7');
    expect(e1.ecrs.map((r) => r.id)).toEqual(['ECR-2026-003']);
    // Filtres de Keystone (?part=, ?project=).
    expect((await loadEngineering({ part: 'VER-HYD-300' })).ecos.map((e) => e.id)).toEqual(['ECO-2026-002']);
    expect((await loadEngineering({ project: 'K-2025-077' })).ecos.map((e) => e.id)).toEqual(['ECO-2026-001']);
  });

  it('encadrement : consultation (son périmètre) ; l’approbateur désigné décide sa clé ; Salarié : rien', async () => {
    actAs('Chef de projet');
    const e1 = (await loadEngineering()).ecos.find((e) => e.id === 'ECO-2026-001')!;
    expect(e1.approvals.map((a) => a.canDecide)).toEqual([false, false, true]);
    expect(await saveEco({}, form(NEW_ECO))).toEqual({ error: APPROVER_ONLY });
    expect(await loadEntityHistory('eco', 'ECO-2026-001')).toMatchObject({ entries: expect.any(Array) });
    actAs('Chef de service');
    expect((await loadEngineering()).ecos.find((e) => e.id === 'ECO-2026-001')!.approvals.every((a) => !a.canDecide)).toBe(true);
    expect(await decideEcoApproval({}, form({ id: 'ECO-2026-001', key: 'pm', decision: 'ok', version: await version('eco', 'ECO-2026-001') })))
      .toEqual({ error: 'Seul l’approbateur désigné (ou le service QHSE) décide cette clé.' });
    actAs('Salarié', 'all');
    expect(await loadEngineering()).toMatchObject({ ecos: [], ecrs: [] });
    expect((await loadEngineeringSignals()).todo).toEqual([]);
    expect(await loadEntityHistory('eco', 'ECO-2026-001')).toEqual({ error: expect.any(String) });
    expect(await decideEcoApproval({}, form({ id: 'ECO-2026-001', key: 'pm', decision: 'ok' }))).toEqual({ error: 'Votre rôle ne permet pas cette modification.' });
  });
});

describe('ordre de modification : saisie, numérotation, parcours', () => {
  it('création : numéro ECO-2026-004, listes, approbateurs, journal ; références de Keystone contrôlées', async () => {
    actAs('Animateur QHSE');
    expect(await saveEco({}, form({ ...NEW_ECO, parts: 'INCONNU-1' }))).toMatchObject({ fieldErrors: { parts: 'Article Keystone inconnu : INCONNU-1.' } });
    expect(await saveEco({}, form({ ...NEW_ECO, projects: 'K-9999-999' }))).toMatchObject({ fieldErrors: { projects: expect.stringContaining('Projet Keystone inconnu') } });
    expect(await saveEco({}, form({ ...NEW_ECO, siteId: 'site_b' }))).toMatchObject({ fieldErrors: { siteId: expect.any(String) } });
    expect(await saveEco({}, form(NEW_ECO))).toEqual({ ok: true, id: 'ECO-2026-004' });
    expect(await eco('ECO-2026-004')).toMatchObject({ status: 'draft', costEur: 320.5, scheduleDays: 5, requestedByName: '[C. Lefèvre]', requestedByMatricule: 'EMP-9011', source: 'vigie', siteId: 'site_a' });
    const docs = await (await getDb()).select().from(t.ecoDocuments).where(eq(t.ecoDocuments.ecoId, 'ECO-2026-004')).orderBy(t.ecoDocuments.position);
    expect(docs.map((d) => [d.refLabel, d.codexDocId])).toEqual([['Plan JNT-MAL-012 B', null], ['Contrôle', 'PRO-QUA-0006']]);
    expect(await approval('ECO-2026-004', 'englead')).toMatchObject({ decision: 'pending', approverText: '[E. Dubois]', approverId: 'edubois' });
    expect(await approval('ECO-2026-004', 'pm')).toMatchObject({ approverId: null });
    expect(await lastLog('eco', 'ECO-2026-004')).toMatchObject({ action: 'create', byId: 'clefevre' });
  });

  it('modification (version QUA-12), étapes : interchangeabilité exigée avant l’approbation', async () => {
    actAs('Animateur QHSE');
    const v = await version('eco', 'ECO-2026-004');
    expect(await saveEco({}, form({ ...NEW_ECO, id: 'ECO-2026-004', version: '1', title: 'X' }))).toEqual({ error: expect.stringContaining('modifiée entre-temps') });
    expect(await advanceEco({}, form({ id: 'ECO-2026-004', to: 'in_approval', version: v }))).toEqual({ error: expect.stringContaining('Seule l’étape suivante') });
    expect(await advanceEco({}, form({ id: 'ECO-2026-004', to: 'impact_analysis', version: v }))).toEqual({ ok: true, id: 'ECO-2026-004' });
    expect(await advanceEco({}, form({ id: 'ECO-2026-004', to: 'in_approval', version: await version('eco', 'ECO-2026-004') })))
      .toEqual({ error: 'Interchangeabilité à évaluer avant la soumission à l’approbation.' });
    expect(await saveEco({}, form({ ...NEW_ECO, id: 'ECO-2026-004', interchangeability: 'no', version: await version('eco', 'ECO-2026-004') }))).toEqual({ ok: true, id: 'ECO-2026-004' });
    expect(await lastLog('eco', 'ECO-2026-004')).toMatchObject({ action: 'update', details: [{ field: 'Interchangeabilité', from: null, to: 'Non interchangeable' }] });
  });

  it('effectivité proposée d’après Keystone : projets de la nomenclature et machines du parc, sans doublon', async () => {
    actAs('Animateur QHSE');
    await saveEco({}, form({ ...NEW_ECO, id: 'ECO-2026-004', interchangeability: 'no', parts: 'ARB-MAL-045', version: await version('eco', 'ECO-2026-004') }));
    expect(await proposeEcoEffectivity({}, form({ id: 'ECO-2026-004', version: await version('eco', 'ECO-2026-004') }))).toMatchObject({ ok: true });
    expect((await targets('ECO-2026-004')).map((g) => [g.targetType, g.targetRef, g.isAutomatic, g.fittedRevision])).toEqual([
      ['project', 'K-2025-042', false, null], ['project', 'K-2025-077', true, null], ['machine', 'MCH-031', true, 'A'], ['machine', 'MCH-035', true, 'A'],
    ]);
    await proposeEcoEffectivity({}, form({ id: 'ECO-2026-004', version: await version('eco', 'ECO-2026-004') }));
    expect(await targets('ECO-2026-004')).toHaveLength(4);
    expect(await lastLog('eco', 'ECO-2026-004')).toMatchObject({ action: 'effectivity', summary: expect.stringContaining('aucune cible nouvelle') });
    // Le rétrofit ne vaut que pour une machine.
    expect(await saveEffectivityTarget({}, form({ id: 'ECO-2026-004', targetType: 'project', targetRef: 'K-2025-042', disposition: 'retrofit', version: await version('eco', 'ECO-2026-004') })))
      .toMatchObject({ fieldErrors: { disposition: expect.any(String) } });
  });

  it('approbation : clé décidée, refus motivé obligatoire ; trois clés approuvées et dispositions acquises : libéré d’office', async () => {
    actAs('Animateur QHSE');
    await advanceEco({}, form({ id: 'ECO-2026-004', to: 'in_approval', version: await version('eco', 'ECO-2026-004') }));
    expect((await eco('ECO-2026-004')).approvalRequestedOn).toBe('2026-10-09');
    expect(await decideEcoApproval({}, form({ id: 'ECO-2026-004', key: 'quality', decision: 'rejected', version: await version('eco', 'ECO-2026-004') })))
      .toMatchObject({ fieldErrors: { comment: 'Motif du refus obligatoire.' } });
    for (const key of ['englead', 'quality', 'pm']) {
      expect(await decideEcoApproval({}, form({ id: 'ECO-2026-004', key, decision: 'ok', version: await version('eco', 'ECO-2026-004') }))).toEqual({ ok: true, id: 'ECO-2026-004' });
    }
    // Trois clés approuvées, dispositions à décider : verrouillé, échéance « dispositions » au pilote.
    expect((await eco('ECO-2026-004')).status).toBe('in_approval');
    expect((await loadEngineering()).ecos.find((e) => e.id === 'ECO-2026-004')).toMatchObject({ locked: true, pendingDispositions: 4 });
    expect((await loadEngineeringSignals()).todo.find((x) => x.key === 'eco-dispositions|ECO-2026-004')).toMatchObject({ ownerIds: ['clefevre'] });
    const dispositions: [string, string, string][] = [['project', 'K-2025-042', 'update'], ['project', 'K-2025-077', 'na'], ['machine', 'MCH-031', 'retrofit'], ['machine', 'MCH-035', 'pinned']];
    for (const [targetType, targetRef, disposition] of dispositions) {
      expect(await saveEffectivityTarget({}, form({ id: 'ECO-2026-004', targetType, targetRef, disposition, version: await version('eco', 'ECO-2026-004') }))).toEqual({ ok: true, id: 'ECO-2026-004' });
    }
    const e = await eco('ECO-2026-004');
    expect(e.status).toBe('released');
    expect(e.releasedAt).not.toBeNull();
    // Échéance posée pour la mise à jour et le rétrofit (60 j), pas pour « sans objet » ni « conservé ».
    expect((await targets('ECO-2026-004')).map((g) => g.dueOn)).toEqual(['2026-12-08', null, '2026-12-08', null]);
    expect((await changeLog('eco', 'ECO-2026-004')).some((l) => l.action === 'release')).toBe(true);
    // Ordre libéré : la disposition ne change plus ; la réalisation se constate.
    expect(await saveEffectivityTarget({}, form({ id: 'ECO-2026-004', targetType: 'project', targetRef: 'K-2025-042', disposition: 'na', version: await version('eco', 'ECO-2026-004') })))
      .toEqual({ error: expect.stringContaining('Ordre libéré') });
    expect(await saveEffectivityTarget({}, form({ id: 'ECO-2026-004', targetType: 'project', targetRef: 'K-2025-042', disposition: 'update', dueOn: '2026-12-08', doneOn: '2026-10-09', version: await version('eco', 'ECO-2026-004') })))
      .toEqual({ ok: true, id: 'ECO-2026-004' });
  });

  it('une clé refusée rejette l’ordre ; ses demandes acceptées passent refusées', async () => {
    actAs('Animateur QHSE');
    await saveEco({}, form({ ...NEW_ECO, interchangeability: 'yes' }));
    const id = 'ECO-2026-005';
    await advanceEco({}, form({ id, to: 'impact_analysis', version: await version('eco', id) }));
    await advanceEco({}, form({ id, to: 'in_approval', version: await version('eco', id) }));
    expect(await decideEcoApproval({}, form({ id, key: 'englead', decision: 'rejected', comment: 'Matériau non qualifié', version: await version('eco', id) }))).toEqual({ ok: true, id });
    expect(await eco(id)).toMatchObject({ status: 'rejected', cancelledAt: null });
    expect(await approval(id, 'englead')).toMatchObject({ decision: 'rejected', comment: 'Matériau non qualifié', decidedById: 'clefevre', via: 'vigie' });
  });

  it('annulation : motif obligatoire, publiée « rejected », journal ; jamais d’un ordre libéré', async () => {
    actAs('Animateur QHSE');
    expect(await cancelEco({}, form({ id: 'ECO-2026-003', reason: '' }))).toMatchObject({ fieldErrors: { reason: expect.any(String) } });
    expect(await cancelEco({}, form({ id: 'ECO-2026-002', reason: 'Erreur' }))).toEqual({ error: expect.stringContaining('libéré ou rejeté') });
    expect(await cancelEco({}, form({ id: 'ECO-2026-003', reason: 'Capot finalement gardé' }))).toEqual({ ok: true, id: 'ECO-2026-003' });
    expect(await eco('ECO-2026-003')).toMatchObject({ status: 'rejected', cancelReason: 'Capot finalement gardé', cancelledById: 'clefevre' });
    expect(await lastLog('eco', 'ECO-2026-003')).toMatchObject({ action: 'cancel', reason: 'Capot finalement gardé' });
    expect(await saveEco({}, form({ ...NEW_ECO, id: 'ECO-2026-003' }))).toEqual({ error: expect.stringContaining('Ordre annulé') });
  });
});

describe('demandes de modification', () => {
  it('création dans Vigie : numéro ECR-2026-NNN, objet contrôlé, site ; Chef de service refusé', async () => {
    const base = { kind: 'modification', subject: 'part', partRef: 'RED-RD5-010', title: 'Réducteur : graissage à vie', ecrReason: 'Pannes de graissage', siteId: 'site_a' };
    actAs('Chef de service');
    expect(await saveEcr({}, form(base))).toEqual({ error: APPROVER_ONLY });
    actAs('Animateur QHSE');
    expect(await saveEcr({}, form({ ...base, partRef: '' }))).toMatchObject({ fieldErrors: { partRef: expect.any(String) } });
    expect(await saveEcr({}, form({ ...base, partRef: 'ZZZ-000' }))).toMatchObject({ fieldErrors: { partRef: expect.stringContaining('inconnu') } });
    expect(await saveEcr({}, form({ ...base, subject: 'document', codexDocId: 'PRO-QUA-0001' }))).toMatchObject({ fieldErrors: { codexDocId: expect.stringContaining('ECR-2026-001') } });
    const r = await saveEcr({}, form(base));
    expect(r).toMatchObject({ ok: true, id: expect.stringMatching(/^ECR-2026-\d{3}$/) });
    expect(await ecr(r.id!)).toMatchObject({ source: 'vigie', status: 'submitted', requesterName: '[C. Lefèvre]', requesterMatricule: 'EMP-9011', siteId: 'site_a' });
    // Annulation : motif obligatoire, publiée « refusée ».
    expect(await cancelEcr({}, form({ id: r.id!, reason: ' ' }))).toMatchObject({ fieldErrors: { reason: expect.any(String) } });
    expect(await cancelEcr({}, form({ id: r.id!, reason: 'Doublon' }))).toEqual({ ok: true, id: r.id });
    expect(await ecr(r.id!)).toMatchObject({ status: 'rejected', cancelReason: 'Doublon' });
    // Une demande de Codex ne s'annule pas (elle se refuse).
    expect(await cancelEcr({}, form({ id: 'ECR-2026-001', reason: 'Doublon' }))).toEqual({ error: expect.stringContaining('elle se refuse') });
  });

  it('décision d’une demande de Codex : refus motivé ; acceptation sans ordre : message à Codex dans la file d’envoi', async () => {
    actAs('Animateur QHSE', 'all');
    const v = await version('ecr', 'ECR-2026-001');
    expect(await decideEcr({}, form({ id: 'ECR-2026-001', decision: 'rejected', note: '', version: v }))).toMatchObject({ fieldErrors: { note: expect.any(String) } });
    expect(await decideEcr({}, form({ id: 'ECR-2026-001', decision: 'accepted', modifierRef: 'jwagner', note: 'Validé en revue', version: v }))).toEqual({ ok: true, id: 'ECR-2026-001' });
    expect(await ecr('ECR-2026-001')).toMatchObject({ status: 'accepted', decidedById: 'clefevre', modifierRef: 'jwagner', notifyStatus: 'pending', ecoId: null });
    const [m] = await messagesOf('ECR-2026-001');
    expect(m).toMatchObject({ target: 'codex', status: 'pending', attempts: 0, payload: { requestId: 'ECR-2026-001', accepted: true, ecoRef: null, modifierId: 'jwagner', note: 'Validé en revue' } });
    expect(await decideEcr({}, form({ id: 'ECR-2026-001', decision: 'rejected', note: 'x', version: await version('ecr', 'ECR-2026-001') }))).toEqual({ error: expect.stringContaining('déjà décidée') });
  });

  it('acceptée avec un nouvel ordre : ordre en brouillon créé d’après elle ; mise en œuvre constatée après la libération', async () => {
    actAs('Animateur QHSE');
    const created = await saveEcr({}, form({ kind: 'modification', subject: 'project', keystoneProjectCode: 'K-2025-061', title: 'Cellule : capteur redondant', ecrReason: 'Audit client', siteId: 'site_a' }));
    expect(await decideEcr({}, form({ id: created.id!, decision: 'accepted', ecoId: 'new', version: await version('ecr', created.id!) }))).toMatchObject({ ok: true });
    const r = await ecr(created.id!);
    expect(r).toMatchObject({ status: 'accepted', ecoId: 'ECO-2026-006', notifyStatus: null });
    expect(await eco('ECO-2026-006')).toMatchObject({ status: 'draft', title: 'Cellule : capteur redondant', source: 'vigie' });
    expect(await messagesOf(created.id!)).toEqual([]);
    expect(await implementEcr({}, form({ id: created.id! }))).toEqual({ error: 'L’ordre ECO-2026-006 n’est pas encore libéré.' });
    // ECR-2026-003 (article) : son ordre ECO-2026-001 n'est pas libéré non plus.
    expect(await implementEcr({}, form({ id: 'ECR-2026-003' }))).toEqual({ error: expect.stringContaining('pas encore libéré') });
  });
});

describe('actions du plan rattachées à un ordre', () => {
  it('création depuis l’ordre : QHSE, source « Modification technique » imposée, origine verrouillée, lien profond', async () => {
    const rec = { ...NEW_ACTION, source: 'modification_technique', originRef: '', link: 'eco:ECO-2026-001' };
    actAs('Chef de service');
    expect(await saveAction({}, form(rec))).toEqual({ error: QHSE_ONLY_CREATE_MESSAGE });
    actAs('Animateur QHSE');
    expect(await saveAction({}, form({ ...rec, source: 'comex' }))).toMatchObject({ fieldErrors: { source: expect.any(String) } });
    const res = await saveAction({}, form(rec));
    expect(res).toMatchObject({ ok: true });
    expect(await actionRow(res.id!)).toMatchObject({ source: 'modification_technique', originRef: expect.stringContaining('ECO-2026-001') });
    expect((await loadActionSources(res.id!)).find((s) => s.kind === 'eco')).toMatchObject({ link: 'eco:ECO-2026-001', href: '/modifications-techniques?sel=ECO-2026-001' });
    expect(await linkAction('eco:ECO-2026-002', res.id!)).toEqual({ error: expect.stringContaining('fixée à sa création') });
    expect((await loadEngineering()).ecos.find((e) => e.id === 'ECO-2026-001')!.actions.map((a) => a.id)).toEqual([res.id]);
  });
});

describe('échéances (loadEngineeringSignals)', () => {
  it('approbation attendue (dépassée), réalisation d’effectivité en retard ; clés stables', async () => {
    actAs('Animateur QHSE', 'all');
    const { todo } = await loadEngineeringSignals();
    const keys = todo.map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining([
      'eco-approbation|ECO-2026-001|quality', 'eco-approbation|ECO-2026-001|pm', 'eco-effectivite|ECO-2026-002|project|K-2024-097',
    ]));
    expect(todo.find((x) => x.key === 'eco-approbation|ECO-2026-001|pm')).toMatchObject({ ownerIds: ['edubois'], dueOn: '2026-10-07', overdue: true, siteId: 'site_a' });
    expect(todo.find((x) => x.key === 'eco-effectivite|ECO-2026-002|project|K-2024-097')).toMatchObject({ ownerIds: ['lmoreau'], dueOn: '2026-10-04', overdue: true });
    // Rétrofit à 25 jours : hors de l'horizon de 15 jours.
    expect(keys).not.toContain('eco-effectivite|ECO-2026-002|machine|MCH-022');
    // Le chef de projet ne reçoit que sa propre clé.
    actAs('Chef de projet', 'all');
    expect((await loadEngineeringSignals()).todo.map((x) => x.key)).toEqual(['eco-approbation|ECO-2026-001|pm']);
  });
});
