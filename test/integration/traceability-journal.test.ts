import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, file, formWith, freshDemoDatabase, lastLog } from '../helpers';
import { and, eq, isNull, lt, ne } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { STEP_CLOSED } from '@/lib/domain';
import { loadDocumentSignals } from '@/lib/data/documents';
import { loadEventDetail } from '@/lib/data/events';
import { loadSitemap } from '@/lib/data/sitemap';
import { loadEventAccesses } from '@/server/access-history';
import { approveVersion, returnToDraft, submitVersion, updateDraft, abandonDraft } from '@/server/documents';
import { createReport, saveAnalysis, setAnalysisMethod } from '@/server/events';
import { loadEntityHistory } from '@/server/history';
import { linkAction, unlinkAction } from '@/server/links';
import { saveSiteRule } from '@/server/sites';
import { cancelActivity, saveActivity, saveZone } from '@/server/sitemap';
import { addQualificationFiles, removeQualificationFile, savePerson, setRequirement } from '@/server/skills';
import { recordControl, saveControl } from '@/server/watch';

// Paquet 3 — traçabilité et journal : chaque écriture journalisée dans sa transaction (TDB-09, EVT-12, PRV-12, HAB-03,
// VEI-04, VEI-09, DOC-04 à DOC-06), historiques chargés à l'ouverture d'une fiche aux droits de l'écran (DUE-06, HAB-03,
// DOC-04…), activités de la carte annulées plutôt que supprimées (PRV-12) et consultations tracées (SEC-11).
// Jeu de démonstration au 09/10/2026 : sites ville-a, ville-b (actifs), ville-c (archivé).

freshDemoDatabase();

const NOT_FOUND = { error: 'Historique introuvable.' };
const db = () => getDb();

describe('sites : règle Seveso / plan de prévention journalisée et historique (TDB-09)', () => {
  it('validateurs seulement ; changement journalisé avec le détail ; inchangé : aucune entrée', async () => {
    actAs('Chef de service', 'ville-a');
    expect(await saveSiteRule({}, form({ siteId: 'ville-a', seveso: 'seuil_bas', ppFromFirstMinute: 'on' }))).toEqual({ error: "Réservé à l'animateur QHSE et à la direction." });
    actAs('Animateur QHSE', 'ville-a');
    const [before] = await (await db()).select().from(t.sites).where(eq(t.sites.id, 'ville-a'));
    const r = await saveSiteRule({}, form({ siteId: 'ville-a', seveso: 'seuil_haut', ...(before.ppFromFirstMinute ? {} : { ppFromFirstMinute: 'on' }) }));
    expect(r).toMatchObject({ ok: true });
    const log = await lastLog('site', 'ville-a');
    expect(log).toMatchObject({ action: 'update', byId: 'clefevre', summary: expect.stringContaining('écarts des interventions recalculés') });
    expect(log?.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'Plan de prévention dès la première minute' })]));
    const n = (await changeLog('site', 'ville-a')).length;
    expect(await saveSiteRule({}, form({ siteId: 'ville-a', seveso: 'seuil_haut', ...(before.ppFromFirstMinute ? {} : { ppFromFirstMinute: 'on' }) }))).toMatchObject({ ok: true });
    expect((await changeLog('site', 'ville-a')).length).toBe(n);
  });

  it('historique du site : validateurs, quel que soit le site sélectionné ; refusé aux autres rôles', async () => {
    actAs('Animateur QHSE', 'ville-b');
    expect(await loadEntityHistory('site', 'ville-a')).toMatchObject({ entries: expect.arrayContaining([expect.objectContaining({ action: 'update' })]) });
    actAs('Chef de service', 'ville-a');
    expect(await loadEntityHistory('site', 'ville-a')).toEqual(NOT_FOUND);
  });
});

describe('événements : analyse, méthode et réception des signalements journalisées (EVT-12)', () => {
  const openEvent = async () => {
    const [ev] = await (await db()).select().from(t.events)
      .where(and(eq(t.events.siteId, 'ville-a'), isNull(t.events.dismissedAt), lt(t.events.step, STEP_CLOSED), ne(t.events.type, 'AT')));
    return ev;
  };

  it('méthode d’analyse changée : journal avec ancienne et nouvelle méthode ; inchangée : rien', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const ev = await openEvent();
    const method = ev.analysisMethod === 'why' ? '5m' : 'why';
    expect(await setAnalysisMethod(ev.id, method)).toEqual({});
    expect(await lastLog('event', ev.id)).toMatchObject({ action: 'update', byId: 'clefevre', details: [expect.objectContaining({ field: "Méthode d'analyse" })] });
    const n = (await changeLog('event', ev.id)).length;
    expect(await setAnalysisMethod(ev.id, method)).toEqual({});
    expect((await changeLog('event', ev.id)).length).toBe(n);
    actAs('Animateur QHSE', 'ville-b');
    expect(await setAnalysisMethod(ev.id, '8d')).toEqual({ error: expect.stringContaining('autre site') });
  });

  it('analyse saisie puis vidée : journal sans le contenu ; même contenu : rien', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const ev = await openEvent();
    const fd = () => { const f = form({ eventId: ev.id, method: 'why' }); f.append('why', 'Élingue non adaptée au bâti'); return f; };
    expect(await saveAnalysis({}, fd())).toMatchObject({ ok: true });
    const log = await lastLog('event', ev.id);
    expect(log?.summary).toMatch(/^Analyse des causes \(5 pourquoi\) (saisie|modifiée)$/);
    expect(JSON.stringify(log)).not.toContain('Élingue');
    const n = (await changeLog('event', ev.id)).length;
    expect(await saveAnalysis({}, fd())).toMatchObject({ ok: true });
    expect((await changeLog('event', ev.id)).length).toBe(n);
    expect(await saveAnalysis({}, form({ eventId: ev.id, method: 'why' }))).toMatchObject({ ok: true });
    expect(await lastLog('event', ev.id)).toMatchObject({ summary: 'Analyse des causes (5 pourquoi) vidée' });
  });

  it('signalement reçu : journal de création, auteur = déclarant connecté, jamais pour un signalement anonyme', async () => {
    actAs('Salarié', 'ville-a');
    const named = await createReport(form({ type: 'PA', description: 'Câble au sol dans l’allée.', gravity: 'Non' }));
    expect(named.id).toBeDefined();
    expect(await changeLog('event', named.id!)).toEqual([expect.objectContaining({ action: 'create', byId: 'tnguyen', summary: 'Signalement reçu depuis Vigie' })]);
    const anonymous = await createReport(form({ type: 'PA', description: 'Garde-corps descellé.', gravity: 'Non', anonymous: 'on' }));
    expect(await changeLog('event', anonymous.id!)).toEqual([expect.objectContaining({ action: 'create', byId: null, summary: 'Signalement anonyme reçu' })]);
  });
});

describe('carte du site : journal, annulation d’une activité, site actif (PRV-12)', () => {
  const activityOf = async (siteId: string) => (await (await db()).select().from(t.siteActivities).where(and(eq(t.siteActivities.siteId, siteId), isNull(t.siteActivities.cancelledAt))))[0];

  it('zone créée : journal de la carte ; création sur un site archivé refusée', async () => {
    actAs('Chef de service', 'ville-a');
    const polygon = JSON.stringify([[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]]);
    const r = await saveZone({}, form({ siteId: 'ville-a', name: 'Zone de test', kind: 'atelier', notes: '', polygon }));
    expect(r).toMatchObject({ ok: true });
    expect(await lastLog('site_map', 'ville-a')).toMatchObject({ action: 'create', summary: 'Zone « Zone de test » ajoutée à la carte', byId: 'sbenali' });
    expect(await loadEntityHistory('site_map', 'ville-a')).toMatchObject({ entries: expect.arrayContaining([expect.objectContaining({ action: 'create' })]) });
    actAs('Animateur QHSE', 'all');
    expect(await saveZone({}, form({ siteId: 'ville-c', name: 'Zone archivée', kind: 'atelier', notes: '', polygon }))).toEqual({ error: 'Site archivé ou inconnu : choisissez un site actif.' });
  });

  it('activité modifiée : journal avec le détail ; annulation : droits, site, motif, journal, retirée de la carte', async () => {
    actAs('Chef de service', 'ville-a');
    const a = await activityOf('ville-a');
    const fields = {
      id: String(a.id), siteId: a.siteId, title: `${a.title} (modifiée)`, team: a.team, contractorId: a.contractorId ?? '', ownerId: a.ownerId ?? '',
      keystoneProject: a.keystoneProject ?? '', zoneId: a.zoneId ? String(a.zoneId) : '', startOn: a.startOn, endOn: a.endOn, hours: a.hours ?? '',
      vehicles: a.vehicles ? 'on' : '', notes: a.notes ?? '', preventionPlanId: a.preventionPlanId ?? '', permitId: a.permitId ?? '',
    };
    const fd = form(fields);
    (a.routeIds as number[]).forEach((rid) => fd.append('routeIds', String(rid)));
    expect(await saveActivity({}, fd)).toMatchObject({ ok: true });
    expect(await lastLog('site_activity', a.id)).toMatchObject({ action: 'update', details: [{ field: 'Intitulé', from: a.title, to: `${a.title} (modifiée)` }] });

    actAs('Salarié', 'ville-a');
    expect(await cancelActivity({}, form({ id: String(a.id), reason: 'Test' }))).toEqual({ error: 'Votre rôle ne permet pas cette modification.' });
    actAs('Chef de service', 'ville-a');
    expect(await cancelActivity({}, form({ id: String(a.id), reason: '' }))).toMatchObject({ fieldErrors: { reason: expect.any(String) } });
    actAs('Animateur QHSE', 'ville-b');
    expect(await cancelActivity({}, form({ id: String(a.id), reason: 'Test' }))).toEqual({ error: expect.stringContaining('autre site') });
    actAs('Chef de service', 'ville-a');
    expect(await cancelActivity({}, form({ id: String(a.id), reason: 'Intervention annulée' }))).toMatchObject({ ok: true });
    const [row] = await (await db()).select().from(t.siteActivities).where(eq(t.siteActivities.id, a.id));
    expect(row).toMatchObject({ cancelledById: 'sbenali', cancelReason: 'Intervention annulée' });
    expect(await lastLog('site_activity', a.id)).toMatchObject({ action: 'cancel', reason: 'Intervention annulée' });
    expect((await loadSitemap({ site: 'ville-a' })).activities?.some((x: { id: number }) => x.id === a.id) ?? false).toBe(false);
    expect(await cancelActivity({}, form({ id: String(a.id), reason: 'Encore' }))).toEqual({ error: 'Cette activité est déjà annulée.' });
    expect(await loadEntityHistory('site_activity', String(a.id))).toMatchObject({ entries: expect.arrayContaining([expect.objectContaining({ action: 'cancel' })]) });
  });
});

describe('DUERP : historiques des unités et des versions (DUE-06)', () => {
  it('à la saisie seulement : encadrement et QHSE ; Salarié (lecture) refusé', async () => {
    const [unit] = await (await db()).select().from(t.workUnits).where(eq(t.workUnits.siteId, 'ville-a'));
    const [version] = await (await db()).select().from(t.duerpVersions).where(eq(t.duerpVersions.current, true));
    actAs('Chef de service', 'ville-a');
    expect(await loadEntityHistory('work_unit', unit.id)).toMatchObject({ entries: expect.any(Array) });
    expect(await loadEntityHistory('duerp_version', version.version)).toMatchObject({ entries: expect.any(Array) });
    actAs('Salarié', 'ville-a');
    expect(await loadEntityHistory('work_unit', unit.id)).toEqual(NOT_FOUND);
    expect(await loadEntityHistory('duerp_version', version.version)).toEqual(NOT_FOUND);
    actAs('Chef de service', 'ville-b');
    expect(await loadEntityHistory('work_unit', unit.id)).toEqual(NOT_FOUND);
  });
});

describe('habilitations : exigences, attestations et fiche salarié journalisées (HAB-03)', () => {
  const cell = async () => {
    const reqs = await (await db()).select().from(t.qualificationRequirements).where(eq(t.qualificationRequirements.personId, 'tnguyen'));
    const titles = await (await db()).select().from(t.trainingTitles).where(isNull(t.trainingTitles.archivedAt));
    return titles.find((x) => !reqs.some((r) => r.titleId === x.id))!;
  };

  it('exigence posée puis retirée : journal de la case ; historique de la case aux droits de la saisie', async () => {
    actAs('Chef de service', 'ville-a');
    const title = await cell();
    const key = `tnguyen|${title.id}`;
    expect(await setRequirement('tnguyen', title.id, true)).toEqual({});
    expect(await lastLog('qualification_requirement', key)).toMatchObject({ action: 'create', byId: 'sbenali', summary: `Titre « ${title.label} » requis pour ce salarié` });
    expect(await setRequirement('tnguyen', title.id, true)).toEqual({});
    expect((await changeLog('qualification_requirement', key)).length).toBe(1);
    expect(await setRequirement('tnguyen', title.id, false)).toEqual({});
    expect(await lastLog('qualification_requirement', key)).toMatchObject({ action: 'delete' });
    expect(await loadEntityHistory('skill_cell', key)).toMatchObject({ entries: [expect.objectContaining({ action: 'delete' }), expect.objectContaining({ action: 'create' })] });
    actAs('Salarié', 'ville-a');
    expect(await loadEntityHistory('skill_cell', key)).toEqual(NOT_FOUND);
    actAs('Chef de service', 'ville-b');
    expect(await setRequirement('tnguyen', title.id, true)).toEqual({ error: expect.stringContaining('autre site') });
    expect(await loadEntityHistory('skill_cell', key)).toEqual(NOT_FOUND);
  });

  it('attestation jointe puis retirée : journal de la formation, dans la case', async () => {
    actAs('Chef de service', 'ville-a');
    const [q] = await (await db()).select().from(t.qualifications)
      .where(and(eq(t.qualifications.personId, 'tnguyen'), isNull(t.qualifications.cancelledAt)));
    expect(await addQualificationFiles(formWith({ qualificationId: String(q.id) }, { files: [file('attestation-sst.pdf')] }))).toEqual({ count: 1 });
    expect(await lastLog('qualification', q.id)).toMatchObject({ action: 'attach', details: [{ field: 'Fichier', from: null, to: 'attestation-sst.pdf' }] });
    const [att] = await (await db()).select().from(t.attachments).where(and(eq(t.attachments.entityType, 'qualification'), eq(t.attachments.entityId, String(q.id)), eq(t.attachments.fileName, 'attestation-sst.pdf')));
    expect(await removeQualificationFile(att.id)).toEqual({});
    expect(await lastLog('qualification', q.id)).toMatchObject({ action: 'detach', details: [{ field: 'Fichier', from: 'attestation-sst.pdf', to: null }] });
    expect(await (await db()).select().from(t.attachments).where(eq(t.attachments.id, att.id))).toEqual([]);
    const history = await loadEntityHistory('skill_cell', `tnguyen|${q.titleId}`);
    expect('entries' in history && history.entries.map((e) => e.action)).toEqual(expect.arrayContaining(['attach', 'detach']));
  });

  it('fiche salarié modifiée : champs changés au journal ; historique de la fiche', async () => {
    actAs('Chef de service', 'ville-a');
    const [p] = await (await db()).select().from(t.people).where(eq(t.people.id, 'tnguyen'));
    expect(await savePerson({}, form({ id: p.id, name: p.name, job: 'Monteur confirmé', service: p.service ?? '', siteId: p.siteId!, inSkillsMatrix: p.inSkillsMatrix ? 'on' : '' }))).toMatchObject({ ok: true });
    expect(await lastLog('person', p.id)).toMatchObject({ action: 'update', details: [{ field: 'Poste', from: p.job || null, to: 'Monteur confirmé' }] });
    expect(await loadEntityHistory('person', p.id)).toMatchObject({ entries: expect.arrayContaining([expect.objectContaining({ summary: 'Fiche salarié modifiée' })]) });
  });
});

describe('veille : rattachements et contrôles journalisés (VEI-04, VEI-09)', () => {
  const openAction = async () => (await (await db()).select().from(t.actions)
    .where(and(eq(t.actions.siteId, 'ville-a'), eq(t.actions.status, 'a_faire'))))[0];

  it('exigence rattachée puis détachée : historique de l’exigence aussi', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const [req] = await (await db()).select().from(t.requirements).where(and(isNull(t.requirements.actionId), isNull(t.requirements.archivedAt)));
    const a = await openAction();
    expect(await linkAction(`requirement:${req.id}`, a.id)).toEqual({});
    expect(await lastLog('requirement', req.id)).toMatchObject({ action: 'link', summary: `Action ${a.id} rattachée` });
    expect(await unlinkAction(`requirement:${req.id}`, a.id)).toEqual({});
    expect(await lastLog('requirement', req.id)).toMatchObject({ action: 'unlink' });
  });

  it('nouvelles réserves : l’action de levée détachée est tracée sur le contrôle', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const d = await db();
    const [control] = await d.select().from(t.controls).where(and(eq(t.controls.siteId, 'ville-a'), isNull(t.controls.archivedAt)));
    const a = await openAction();
    await d.update(t.controls).set({ actionId: a.id, reserves: 'Fin de course à régler' }).where(eq(t.controls.id, control.id));
    expect(await recordControl({}, form({ controlId: String(control.id), performedOn: '2026-10-08', organization: 'Apave', reserves: 'Câble usé', notes: '' }))).toMatchObject({ ok: true });
    expect(await lastLog('control', control.id)).toMatchObject({ action: 'unlink', summary: expect.stringContaining(`Action ${a.id} détachée`) });
  });

  it('« Dernier contrôle » et réserves ne changent plus par la modification du contrôle', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const [c] = await (await db()).select().from(t.controls).where(and(eq(t.controls.siteId, 'ville-a'), isNull(t.controls.archivedAt)));
    const base = {
      id: String(c.id), equipment: c.equipment, controlType: c.controlType, periodMonths: String(c.periodMonths), organization: c.organization,
      responsibleId: c.responsibleId ?? '', siteId: c.siteId ?? '', requirementId: c.requirementId ? String(c.requirementId) : '', nextOn: c.nextOn,
    };
    expect(await saveControl({}, form({ ...base, lastOn: '2026-01-02' }))).toMatchObject({ fieldErrors: { lastOn: expect.stringContaining('Enregistrer un contrôle') } });
    expect(await saveControl({}, form({ ...base, reserves: 'Autre réserve' }))).toMatchObject({ fieldErrors: { reserves: expect.stringContaining('Enregistrer un contrôle') } });
    // Champs absents (formulaire de modification) : inchangés, le reste s'enregistre.
    expect(await saveControl({}, form({ ...base, organization: 'Bureau Veritas' }))).toMatchObject({ ok: true });
    const [after] = await (await db()).select().from(t.controls).where(eq(t.controls.id, c.id));
    expect(after).toMatchObject({ lastOn: c.lastOn, reserves: c.reserves, organization: 'Bureau Veritas' });
  });
});

describe('documents : cycle de vie journalisé, fichier exigé, renvoi motivé (DOC-04, DOC-05, DOC-06)', () => {
  const version = async (documentId: string, v: string) => (await (await db()).select().from(t.documentVersions)
    .where(and(eq(t.documentVersions.documentId, documentId), eq(t.documentVersions.version, v))))[0];

  it('approbation sans fichier refusée', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const v = await version('PR-QHSE-004', 'C');
    expect(await approveVersion({}, form({ versionId: String(v.id) }))).toEqual({ error: expect.stringContaining('Joignez le fichier') });
  });

  it('renvoi en brouillon : validateurs, motif obligatoire, journal, échéance de l’auteur ; soumission après dépôt du fichier', async () => {
    const v = await version('IT-USI-004', 'C');
    actAs('Chef de service', 'ville-a');
    expect(await returnToDraft({}, form({ versionId: String(v.id), reason: 'Compléter' }))).toEqual({ error: "Réservé à l'animateur QHSE et à la direction." });
    actAs('Animateur QHSE', 'ville-a');
    expect(await returnToDraft({}, form({ versionId: String(v.id), reason: '' }))).toMatchObject({ fieldErrors: { reason: expect.any(String) } });
    expect(await returnToDraft({}, form({ versionId: String(v.id), reason: 'Préciser la fréquence de contrôle' }))).toMatchObject({ ok: true });
    expect(await version('IT-USI-004', 'C')).toMatchObject({ status: 'brouillon', returnReason: 'Préciser la fréquence de contrôle', returnedOn: '2026-10-09' });
    expect(await lastLog('document', 'IT-USI-004')).toMatchObject({ action: 'status', reason: 'Préciser la fréquence de contrôle', summary: 'Version C renvoyée en brouillon : corrections demandées' });
    const todo = (await loadDocumentSignals()).todo.find((x) => x.title.startsWith('IT-USI-004 · version C renvoyée'));
    expect(todo).toMatchObject({ ownerIds: ['lmoreau'], siteId: 'ville-a' });

    // Soumission sans fichier refusée (DOC-05), puis fichier joint (journal) et soumission : échéance levée.
    expect(await submitVersion({}, form({ versionId: String(v.id) }))).toEqual({ error: expect.stringContaining('Joignez le fichier') });
    expect(await updateDraft({}, formWith({ versionId: String(v.id), summary: v.summary }, { file: [file('it-usi-004-c.pdf')] }))).toMatchObject({ ok: true });
    expect(await lastLog('document', 'IT-USI-004')).toMatchObject({ action: 'attach', details: [{ field: 'Fichier', from: null, to: 'it-usi-004-c.pdf' }] });
    expect(await submitVersion({}, form({ versionId: String(v.id) }))).toMatchObject({ ok: true });
    expect(await version('IT-USI-004', 'C')).toMatchObject({ status: 'en_revue', returnedOn: null, returnReason: null });
    expect(await lastLog('document', 'IT-USI-004')).toMatchObject({ action: 'status', summary: 'Version C soumise en revue', byId: 'clefevre' });
    expect((await loadDocumentSignals()).todo.some((x) => x.title.startsWith('IT-USI-004 · version C renvoyée'))).toBe(false);
    expect(await approveVersion({}, form({ versionId: String(v.id) }))).toMatchObject({ ok: true });
    expect(await lastLog('document', 'IT-USI-004')).toMatchObject({ summary: 'Version C approuvée et en vigueur · version B archivée' });
  });

  it('abandon d’un brouillon : motif obligatoire et journal ; historique du document à la saisie seulement', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const v = await version('FO-MON-003', 'C');
    expect(await abandonDraft({}, form({ versionId: String(v.id), reason: '' }))).toMatchObject({ fieldErrors: { reason: expect.any(String) } });
    expect(await abandonDraft({}, form({ versionId: String(v.id), reason: 'Correction reprise dans une autre révision' }))).toMatchObject({ ok: true });
    expect(await lastLog('document', 'FO-MON-003')).toMatchObject({ action: 'archive', reason: 'Correction reprise dans une autre révision' });
    expect(await loadEntityHistory('document', 'FO-MON-003')).toMatchObject({ entries: expect.arrayContaining([expect.objectContaining({ action: 'archive' })]) });
    actAs('Chef de service', 'ville-a'); // Documents en consultation seule pour l'encadrement
    expect(await loadEntityHistory('document', 'FO-MON-003')).toEqual(NOT_FOUND);
  });
});

describe('consultations tracées (SEC-11)', () => {
  const AT = 'EV-2026-118';
  const accesses = async (kind: string, entityId: string) => (await (await db()).select().from(t.accessLog)
    .where(and(eq(t.accessLog.kind, kind), eq(t.accessLog.entityId, entityId))));

  it('fiche d’un AT ouverte avec ses données de santé : tracée pour les rôles habilités, une fois par fenêtre', async () => {
    actAs('Chef de service', 'ville-a');
    await loadEventDetail(AT);
    expect(await accesses('sante', AT)).toEqual([]);
    actAs('Animateur QHSE', 'ville-a');
    await loadEventDetail(AT);
    await loadEventDetail(AT);
    expect(await accesses('sante', AT)).toEqual([expect.objectContaining({ personId: 'clefevre', entityType: 'event' })]);
  });

  it('pièce jointe servie par /fichiers : tracée ; pièce médicale sans cache ; journal lisible des seuls rôles habilités', async () => {
    const { GET } = await import('@/app/fichiers/[id]/route');
    actAs('Animateur QHSE', 'ville-a');
    const add = new FormData(); add.set('eventId', AT); add.set('health', '1'); add.append('files', file('avis-arret.pdf'));
    const { addEventFiles } = await import('@/server/events');
    expect(await addEventFiles(add)).toEqual({ count: 1 });
    const [att] = await (await db()).select().from(t.attachments).where(and(eq(t.attachments.entityId, AT), eq(t.attachments.fileName, 'avis-arret.pdf')));
    const res = await GET(new Request(`http://localhost:3200/fichiers/${att.id}`), { params: Promise.resolve({ id: att.id }) } as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await accesses('fichier', AT)).toEqual([expect.objectContaining({ attachmentId: att.id, health: true, personId: 'clefevre' })]);
    const log = await loadEventAccesses(AT);
    expect('entries' in log && log.entries.map((e) => e.what)).toEqual(expect.arrayContaining(['Pièce médicale ouverte · avis-arret.pdf', 'Fiche consultée avec ses données de santé']));
    actAs('Chef de service', 'ville-a');
    expect(await loadEventAccesses(AT)).toEqual({ error: 'Journal des consultations introuvable.' });
  });
});
