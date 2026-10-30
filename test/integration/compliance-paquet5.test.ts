import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, file, formWith, freshDemoDatabase, lastLog } from '../helpers';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { MP_DENIED, MP_TITLE } from '@/lib/rules/events';
import { loadAudits, loadAuditSignals } from '@/lib/data/audits';
import { loadContext } from '@/lib/data/context';
import { loadDashboard } from '@/lib/data/dashboard';
import { loadDatPrint, loadEventSignals, loadVisibleEvents } from '@/lib/data/events';
import { loadObjectives } from '@/lib/data/objectives';
import { loadRiskSignals } from '@/lib/data/risks';
import { loadSkillData } from '@/lib/data/skills';
import { loadSsctReport } from '@/lib/data/ssct';
import { loadWatch, loadWatchSignals } from '@/lib/data/watch';
import { canReadAttachment } from '@/lib/uploads';
import { reinstateCertification, renewCertification, saveFinding, suspendCertification } from '@/server/audits';
import { archiveContextItem, saveContextItem } from '@/server/context';
import { saveWasteEntry } from '@/server/environment';
import { addEventFiles, createEvent, saveEvent } from '@/server/events';
import { loadEntityHistory } from '@/server/history';
import { archiveObjective, saveObjective } from '@/server/objectives';
import { recordPlanEeSignature, signPlanEu } from '@/server/prevention';
import { updateCurrentDuerpVersion } from '@/server/risks';
import { saveQualification, saveTitle } from '@/server/skills';
import { recordControl, saveRequirement } from '@/server/watch';
import { addEntityFiles, removeEntityFile } from '@/server/entity-files';

// Paquet 5 — conformité réglementaire : droits, site, motif, journal et données de santé des server actions et des
// chargements ajoutés ou modifiés (EVT-09, EVT-10, EVT-17, PRV-07, DUE-03, HAB-10, VEI-10, VEI-11, AUD-08, AUD-09,
// AUD-13, DOC-12, CNF-03, CNF-05). Jeu de démonstration au 09/10/2026.

freshDemoDatabase();

const DENIED = 'Votre rôle ne permet pas cette modification.';
const APPROVERS_ONLY = "Réservé à l'animateur QHSE et à la direction.";
const MP = 'EV-2026-134';
const COMMUTE = 'EV-2026-135';

const db = () => getDb();
const event = async (id: string) => (await (await db()).select().from(t.events).where(eq(t.events.id, id)))[0];

const baseEvent = (fields: Record<string, string>) => form({
  title: 'Événement de test', occurredOn: '2026-10-08', location: 'Atelier montage', severity: '2', siteId: 'ville-a', declarantId: 'tnguyen', pilotId: 'clefevre', ...fields,
});

describe('EVT-09 : maladies professionnelles (données de santé) et accidents de trajet', () => {
  it('maladie professionnelle : saisie et lecture réservées à l’animateur QHSE et à la direction', async () => {
    actAs('Chef de service', 'ville-a');
    expect(await createEvent({}, baseEvent({ type: 'MP', victimKind: 'salarie', victimId: 'mgirard' }))).toEqual({ error: MP_DENIED });
    expect((await loadVisibleEvents()).some((e) => e.id === MP)).toBe(false);
    expect((await loadEventSignals()).todo.some((x) => x.title.startsWith(MP))).toBe(false);
    // Server actions : l'événement n'existe pas pour un rôle non habilité.
    expect(await saveEvent({}, baseEvent({ id: MP, type: 'MP' }))).toEqual({ error: MP_DENIED });
    expect(await saveEvent({}, baseEvent({ id: MP, type: 'PA' }))).toEqual({ error: 'Événement introuvable.' });

    actAs('Animateur QHSE', 'ville-a');
    expect((await loadVisibleEvents()).some((e) => e.id === MP)).toBe(true);
    const r = await createEvent({}, baseEvent({
      type: 'MP', title: 'Tendinite de Pierre', victimKind: 'salarie', victimId: 'mgirard', mpTable: '57', mpDisease: 'Tendinopathie du coude',
      mpCertificateOn: '2026-09-20', mpQuestionnaireReceivedOn: '2026-10-05', controlId: '1',
    }));
    expect(r).toMatchObject({ ok: true });
    const created = await event(r.id!);
    // Intitulé imposé (ni la victime ni la maladie), aucun rattachement.
    expect(created).toMatchObject({ type: 'MP', title: MP_TITLE, mpTable: '57', mpDisease: 'Tendinopathie du coude', controlId: null });
    expect(await lastLog('event', r.id!)).toMatchObject({ action: 'create' });
    // Questionnaire employeur : 30 jours francs (05/10 → 04/11), échéance de santé.
    const todo = (await loadEventSignals()).todo.find((x) => x.kind === 'Questionnaire maladie professionnelle' && x.title.startsWith(r.id!));
    expect(todo).toMatchObject({ kind: 'Questionnaire maladie professionnelle', dueOn: '2026-11-04', health: true });
    // Retour avant réception : refusé ; une MP garde son type.
    expect(await saveEvent({}, baseEvent({ id: r.id!, type: 'MP', victimKind: 'salarie', victimId: 'mgirard', mpQuestionnaireReturnedOn: '2026-10-01', mpQuestionnaireReceivedOn: '2026-10-05' })))
      .toMatchObject({ fieldErrors: { mpQuestionnaireReturnedOn: expect.any(String) } });
    expect(await saveEvent({}, baseEvent({ id: r.id!, type: 'PA' }))).toMatchObject({ fieldErrors: { type: 'Une maladie professionnelle garde son type.' } });
  });

  it('pièces d’une maladie professionnelle : jamais servies à un rôle non habilité', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await addEventFiles(formWith({ eventId: MP, health: '1' }, { files: [file('certificat.pdf')] }))).toEqual({ count: 1 });
    expect(await addEventFiles(formWith({ eventId: MP }, { files: [file('photo-poste.pdf')] }))).toEqual({ count: 1 });
    const rows = await (await db()).select().from(t.attachments).where(and(eq(t.attachments.entityType, 'event'), eq(t.attachments.entityId, MP)));
    const ordinary = rows.find((x) => !x.health)!;
    expect(await canReadAttachment(ordinary, { role: 'Animateur QHSE', user: { id: 'clefevre' }, allowedSiteIds: null })).toBe(true);
    expect(await canReadAttachment(ordinary, { role: 'Chef de service', user: { id: 'sbenali' }, allowedSiteIds: null })).toBe(false);
  });

  it('accident de trajet : déclaré comme un AT, exclu des taux et de la pyramide', async () => {
    actAs('Animateur QHSE', 'all');
    expect((await event(COMMUTE))).toMatchObject({ type: 'AT', commute: true, injury: 'arret' });
    const d = await loadDashboard();
    const kpi = d.kpis.find((k) => k.label === 'Jours sans accident avec arrêt')!;
    // Dernier AT avec arrêt de l'effectif : EV-2026-119 (08/09), pas l'accident de trajet du 30/09.
    expect(kpi.value).toBe('31');
    const r = await createEvent({}, baseEvent({ type: 'AT', commute: 'on', commuteField: '1', victimKind: 'salarie', victimId: 'tnguyen', circumstances: 'Chute sur le trajet.' }));
    expect((await event(r.id!)).commute).toBe(true);
    // Case décochée (marqueur du formulaire présent) : plus un accident de trajet ; formulaire sans le champ : conservé.
    expect(await saveEvent({}, baseEvent({ id: r.id!, type: 'AT', victimKind: 'salarie', victimId: 'tnguyen' }))).toEqual({ ok: true, id: r.id });
    expect((await event(r.id!)).commute).toBe(true);
    expect(await saveEvent({}, baseEvent({ id: r.id!, type: 'AT', commuteField: '1', victimKind: 'salarie', victimId: 'tnguyen' }))).toEqual({ ok: true, id: r.id });
    expect((await event(r.id!)).commute).toBe(false);
    expect((await lastLog('event', r.id!))?.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'Accident de trajet', from: 'Oui', to: null })]));
  });
});

describe('EVT-10 : synthèse imprimable de la DAT et feuille d’accident', () => {
  it('animateur QHSE et direction seulement ; consultation tracée', async () => {
    actAs('Chef de service', 'ville-b');
    expect(await loadDatPrint('EV-2026-119')).toBeNull();
    actAs('Animateur QHSE', 'ville-b');
    const d = await loadDatPrint('EV-2026-119');
    expect(d).toMatchObject({ id: 'EV-2026-119', duty: 'cpam', cpam: { declaredOn: '2026-09-09' } });
    expect(d!.lesionNature).not.toBeNull();
    expect(await loadDatPrint(MP)).toBeNull(); // pas un accident du travail
    const access = await (await db()).select().from(t.accessLog).where(and(eq(t.accessLog.entityId, 'EV-2026-119'), eq(t.accessLog.kind, 'sante')));
    expect(access.length).toBeGreaterThan(0);
  });
});

describe('EVT-17 : traitement d’un produit non conforme', () => {
  it('dérogation sans autorité refusée ; décision, quantité et coût journalisés', async () => {
    actAs('Chef de service', 'ville-a');
    const nc = { type: 'NC', ncOrigin: 'Fabrication', title: 'NC de test' };
    expect(await createEvent({}, baseEvent({ ...nc, ncDisposition: 'derogation' }))).toMatchObject({ fieldErrors: { ncDispositionNote: expect.any(String) } });
    expect(await createEvent({}, baseEvent({ ...nc, ncCostKeur: '-3' }))).toMatchObject({ fieldErrors: { ncCostKeur: expect.any(String) } });
    const r = await createEvent({}, baseEvent({ ...nc, ncDisposition: 'rebut', ncQuantity: '12', ncCostKeur: '1,25' }));
    expect(await event(r.id!)).toMatchObject({ ncDisposition: 'rebut', ncQuantity: 12, ncCostKeur: 1.25 });
    expect(await saveEvent({}, baseEvent({ id: r.id!, ...nc, ncDisposition: 'derogation', ncDispositionNote: '[Client A], dérogation n° 12', ncQuantity: '12', ncCostKeur: '1.25' })))
      .toEqual({ ok: true, id: r.id });
    expect((await lastLog('event', r.id!))?.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'Traitement du produit', from: 'Rebut', to: 'Acceptation par dérogation' }),
    ]));
  });
});

describe('PRV-07 : signataires du plan et date de signature EU', () => {
  const signEu = (fields: Record<string, string>) => signPlanEu({}, form({ id: 'PP-2026-016', signedEuOn: '2026-10-09', signedEuName: '[H. Marchand]', signedEuQuality: 'Directeur de site', ...fields }));
  it('nom et qualité obligatoires, date jamais future ni antérieure à l’inspection ; journal avec le signataire', async () => {
    actAs('Salarié');
    expect(await signEu({})).toEqual({ error: DENIED });
    actAs('Chef de service', 'ville-a');
    expect(await signEu({ signedEuName: '', signedEuQuality: '' })).toMatchObject({ fieldErrors: { signedEuName: 'Champ obligatoire.', signedEuQuality: 'Champ obligatoire.' } });
    expect(await signEu({ signedEuOn: '2026-10-10' })).toMatchObject({ fieldErrors: { signedEuOn: expect.stringContaining('future') } });
    expect(await signEu({ signedEuOn: '2026-01-01' })).toMatchObject({ fieldErrors: { signedEuOn: expect.stringContaining('inspection') } });
    expect(await changeLog('prevention_plan', 'PP-2026-016')).not.toContainEqual(expect.objectContaining({ action: 'sign' }));
    expect(await signEu({ signedEuOn: '2026-10-08' })).toEqual({ ok: true, id: 'PP-2026-016' });
    const [p] = await (await db()).select().from(t.preventionPlans).where(eq(t.preventionPlans.id, 'PP-2026-016'));
    expect(p).toMatchObject({ signedEuOn: '2026-10-08', signedEuName: '[H. Marchand]', signedEuQuality: 'Directeur de site' });
    expect(await lastLog('prevention_plan', 'PP-2026-016')).toMatchObject({ action: 'sign', summary: expect.stringContaining('[H. Marchand] (Directeur de site), le 08/10/2026') });
  });
  it('signature EE : nom et qualité obligatoires', async () => {
    actAs('Chef de service', 'ville-a');
    expect(await recordPlanEeSignature({}, form({ id: 'PP-2026-016', signedEeOn: '2026-10-09' }))).toMatchObject({ fieldErrors: { signedEeName: 'Champ obligatoire.' } });
  });
});

describe('DUE-03 : transmission au SPST et dépôt sur le portail', () => {
  const versionForm = (fields: Record<string, string>) => form({ version: '2026.1', validatedById: 'hmarchand', cseConsultedOn: '2026-03-20', comment: '', ...fields });
  it('dates contrôlées, journalisées ; échéance tant que la transmission n’est pas renseignée', async () => {
    actAs('Chef de service', 'ville-a');
    expect(await updateCurrentDuerpVersion({}, versionForm({ spstSentOn: '' }))).toEqual({ error: APPROVERS_ONLY });
    actAs('Animateur QHSE', 'all');
    expect(await updateCurrentDuerpVersion({}, versionForm({ spstSentOn: '2026-03-01' }))).toMatchObject({ fieldErrors: { spstSentOn: expect.stringContaining('15/03/2026') } });
    expect(await updateCurrentDuerpVersion({}, versionForm({ spstSentOn: '' }))).toEqual({ ok: true, id: '2026.1' });
    expect((await loadRiskSignals()).todo.some((x) => x.title === 'Transmission au SPST à renseigner · DUERP 2026.1')).toBe(true);
    expect(await updateCurrentDuerpVersion({}, versionForm({ spstSentOn: '2026-03-27', portalDepositedOn: '2026-04-02' }))).toEqual({ ok: true, id: '2026.1' });
    expect((await loadRiskSignals()).todo.some((x) => x.title.startsWith('Transmission au SPST'))).toBe(false);
    expect((await lastLog('duerp_version', '2026.1'))?.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'Transmission au SPST', from: null, to: '27/03/2026' }),
      expect.objectContaining({ field: 'Dépôt sur le portail numérique', to: '02/04/2026' }),
    ]));
  });
});

describe('HAB-10 : prérequis entre titres, catégories et niveaux', () => {
  const titleForm = (id: string, fields: Record<string, string>, prereq: string[] = []) => {
    const fd = form({ id, label: id === 'conduite' ? 'Autorisation de conduite' : 'CACES R489', validityMonths: '60', firstAidField: '1', prerequisitesField: '1', ...fields });
    prereq.forEach((p) => fd.append('prerequisiteIds', p));
    return fd;
  };
  it('autorisation de conduite sans CACES valide : « prérequis non valide », échéance', async () => {
    actAs('Animateur QHSE', 'all');
    const cell = (await loadSkillData('perimeter')).rows.find((r) => r.person.id === 'kbernard')!.cells.find((c) => c.title.id === 'conduite')!;
    expect(cell).toMatchObject({ state: 'p', missingPrerequisites: ['CACES R484', 'CACES R489'] });
    const proux = (await loadSkillData('perimeter')).rows.find((r) => r.person.id === 'proux')!.cells.find((c) => c.title.id === 'conduite')!;
    expect(proux.state).toBe('v');
  });
  it('prérequis : soi-même, inconnu ou circulaire refusés ; modification journalisée', async () => {
    actAs('Salarié');
    expect(await saveTitle({}, titleForm('conduite', {}, ['r489']))).toEqual({ error: DENIED });
    actAs('Animateur QHSE', 'all');
    expect(await saveTitle({}, titleForm('conduite', {}, ['conduite']))).toMatchObject({ fieldErrors: { prerequisiteIds: expect.stringContaining('propre prérequis') } });
    expect(await saveTitle({}, titleForm('conduite', {}, ['inconnu']))).toMatchObject({ fieldErrors: { prerequisiteIds: expect.any(String) } });
    expect(await saveTitle({}, titleForm('r489', { scopeLabel: 'Catégories CACES' }, ['conduite']))).toMatchObject({ fieldErrors: { prerequisiteIds: expect.stringContaining('circulaire') } });
    expect(await saveTitle({}, titleForm('conduite', {}, ['r489']))).toEqual({ ok: true, id: 'conduite' });
    expect((await lastLog('training_title', 'conduite'))?.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'Prérequis', from: 'CACES R484, CACES R489', to: 'CACES R489' }),
    ]));
  });
  it('catégories obtenues saisies avec la formation d’un titre qui en porte', async () => {
    actAs('Animateur QHSE', 'all');
    expect(await saveQualification({}, form({ personId: 'kbernard', titleId: 'r489', obtainedOn: '2026-10-05', scope: '1A, 3' }))).toMatchObject({ ok: true });
    const [q] = await (await db()).select().from(t.qualifications).where(and(eq(t.qualifications.personId, 'kbernard'), eq(t.qualifications.titleId, 'r489')));
    expect(q.scope).toBe('1A, 3');
    // CACES valide : l'autorisation de conduite redevient valide.
    const cell = (await loadSkillData('perimeter')).rows.find((r) => r.person.id === 'kbernard')!.cells.find((c) => c.title.id === 'conduite')!;
    expect(cell.state).toBe('v');
  });
});

describe('VEI-10 et VEI-11 : applicabilité par site, texte, résultat des contrôles', () => {
  const atexId = async () => (await (await db()).select().from(t.requirements)).find((r) => r.text.startsWith('Directive ATEX'))!.id;
  async function requirementForm(id: number, changes: Record<string, string> = {}, sites: string[] = []) {
    const [r] = await (await db()).select().from(t.requirements).where(eq(t.requirements.id, id));
    const fd = form({
      id: String(r.id), text: r.text, domain: r.domain, summary: r.summary, dueOn: r.dueOn ?? '', dueNote: r.dueNote ?? '', evaluation: r.evaluation,
      evaluationNote: r.evaluationNote ?? '', pilotId: r.pilotId ?? '', impact: r.impact ?? '', legifranceUrl: r.legifranceUrl ?? '', siteIdsField: '1', ...changes,
    });
    sites.forEach((s) => fd.append('siteIds', s));
    return fd;
  }
  it('exigence propre au site de [Ville B] : absente sous le site A, présente sous B et « Tous les sites »', async () => {
    const id = await atexId();
    actAs('Chef de service', 'ville-a');
    expect((await loadWatch()).requirements.some((r) => r.id === id)).toBe(false);
    actAs('Chef de service', 'ville-b');
    expect((await loadWatch()).requirements.find((r) => r.id === id)).toMatchObject({ siteLabels: ['Site de [Ville B]'] });
    actAs('Chef de service', 'all');
    expect((await loadWatch()).requirements.some((r) => r.id === id)).toBe(true);
  });
  it('lien officiel exigé ; sites journalisés', async () => {
    const id = await atexId();
    actAs('Animateur QHSE', 'all');
    expect(await saveRequirement({}, await requirementForm(id, { legifranceUrl: 'https://example.com/texte' }, ['ville-b']))).toMatchObject({ fieldErrors: { legifranceUrl: expect.any(String) } });
    expect(await saveRequirement({}, await requirementForm(id, {}, ['ville-z']))).toMatchObject({ fieldErrors: { siteIds: 'Site inconnu ou archivé.' } });
    expect(await saveRequirement({}, await requirementForm(id, {}, []))).toEqual({ ok: true, id: String(id) });
    expect((await lastLog('requirement', id))?.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'Sites concernés', from: 'Site de [Ville B]', to: 'Tous les sites' }),
    ]));
  });
  it('texte joint : ajout et retrait journalisés, lisible par les rôles de la veille', async () => {
    const id = await atexId();
    actAs('Salarié');
    expect(await addEntityFiles(formWith({ kind: 'requirement', entityId: String(id) }, { files: [file('directive.pdf')] }))).toEqual({ error: DENIED });
    actAs('Chef de service', 'all');
    expect(await addEntityFiles(formWith({ kind: 'requirement', entityId: String(id) }, { files: [file('directive.pdf')] }))).toEqual({ count: 1 });
    const [att] = await (await db()).select().from(t.attachments).where(and(eq(t.attachments.entityType, 'requirement'), eq(t.attachments.entityId, String(id))));
    expect(await canReadAttachment(att, { role: 'Chef de service', user: { id: 'sbenali' }, allowedSiteIds: null })).toBe(true);
    expect(await canReadAttachment(att, { role: 'Salarié', user: { id: 'tnguyen' }, allowedSiteIds: null })).toBe(false);
    expect(await lastLog('requirement', id)).toMatchObject({ action: 'attach', details: [{ field: 'Texte joint', from: null, to: 'directive.pdf' }] });
    // VEI-08 : retrait avec un motif obligatoire, conservé au journal.
    expect(await removeEntityFile(att.id, '')).toEqual({ error: 'Motif obligatoire.' });
    expect(await removeEntityFile(att.id, 'Mauvaise version du texte')).toEqual({});
    expect(await lastLog('requirement', id)).toMatchObject({ action: 'detach', reason: 'Mauvaise version du texte', details: [{ field: 'Texte joint', from: 'directive.pdf', to: null }] });
  });
  it('résultat obligatoire et cohérent avec les réserves ; défavorable signalé jusqu’au prochain contrôle favorable', async () => {
    actAs('Chef de service', 'ville-a');
    const [gate] = await (await db()).select().from(t.controls).where(eq(t.controls.equipment, 'Portes et portails motorisés'));
    const record = (fields: Record<string, string>) => recordControl({}, form({ controlId: String(gate.id), performedOn: '2026-10-08', organization: 'Interne — maintenance', ...fields }));
    // Jeu de démonstration : dernier contrôle défavorable.
    expect((await loadWatchSignals()).todo.some((x) => x.title.includes('défavorable'))).toBe(true);
    expect(await record({})).toMatchObject({ fieldErrors: { result: 'Choix obligatoire.' } });
    expect(await record({ result: 'reserves' })).toMatchObject({ fieldErrors: { reserves: expect.any(String) } });
    expect(await record({ result: 'favorable', reserves: '1 · capot' })).toMatchObject({ fieldErrors: { result: expect.any(String) } });
    expect(await record({ result: 'favorable' })).toMatchObject({ ok: true });
    expect((await loadWatchSignals()).todo.some((x) => x.href === `/veille?onglet=controles&controle=${gate.id}` && x.title.includes('défavorable'))).toBe(false);
    expect(await lastLog('control', gate.id)).toMatchObject({ action: 'record', summary: expect.stringContaining('favorable') });
    const view = (await loadWatch()).controls.find((c) => c.id === gate.id)!;
    expect(view.lastResult).toMatchObject({ key: 'favorable' });
  });
});

describe('AUD-08 et AUD-09 : cycle de certification, types de constat', () => {
  it('renouvellement (3 ans au plus), suspension motivée, levée ; journal du référentiel', async () => {
    actAs('Chef de service', 'ville-a');
    expect(await suspendCertification({}, form({ id: 'iso9001', suspendedOn: '2026-10-01', reason: 'Écart majeur' }))).toEqual({ error: APPROVERS_ONLY });
    actAs('Animateur QHSE', 'all');
    expect(await renewCertification({}, form({ id: 'iso9001', issuedOn: '2026-10-01', validUntil: '2030-10-01' }))).toMatchObject({ fieldErrors: { validUntil: expect.stringContaining('3 ans') } });
    expect(await renewCertification({}, form({ id: 'iso9001', issuedOn: '2025-01-01', validUntil: '2027-12-31' }))).toMatchObject({ fieldErrors: { issuedOn: expect.any(String) } });
    expect(await suspendCertification({}, form({ id: 'iso9001', suspendedOn: '2026-10-01', reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await suspendCertification({}, form({ id: 'iso9001', suspendedOn: '2026-10-01', reason: 'Écart majeur non levé' }))).toEqual({ ok: true, id: 'iso9001' });
    expect((await loadAudits({})).certs.find((c) => c.id === 'iso9001')!.state).toEqual({ label: 'Certificat suspendu depuis le 01/10/2026', tone: 'danger' });
    expect((await loadAuditSignals()).todo.some((x) => x.title === 'Certificat ISO 9001:2015 suspendu depuis le 01/10')).toBe(true);
    expect(await renewCertification({}, form({ id: 'iso9001', issuedOn: '2026-10-05', validUntil: '2029-10-04' }))).toEqual({ error: expect.stringContaining('suspendu') });
    expect(await reinstateCertification({}, form({ id: 'iso9001', reason: 'Décision de l’organisme du 08/10' }))).toEqual({ ok: true, id: 'iso9001' });
    expect(await renewCertification({}, form({ id: 'iso9001', issuedOn: '2026-10-05', validUntil: '2029-10-04' }))).toEqual({ ok: true, id: 'iso9001' });
    expect((await changeLog('certification', 'iso9001')).map((l) => l.action)).toEqual(expect.arrayContaining(['suspend', 'reinstate', 'renew']));
    expect(await lastLog('certification', 'iso9001')).toMatchObject({ action: 'renew', summary: 'Certificat renouvelé · nouveau cycle du 05/10/2026 au 04/10/2029' });
    expect(await suspendCertification({}, form({ id: 'iso45001', suspendedOn: '2026-10-01', reason: 'x' }))).toEqual({ error: expect.stringContaining('non certifié') });
  });
  it('écart majeur et observation ; délai de réponse daté, jamais avant le constat', async () => {
    actAs('Animateur QHSE', 'all');
    const [item] = await (await db()).select().from(t.auditPlanItems).where(and(eq(t.auditPlanItems.done, true), eq(t.auditPlanItems.track, 'Audits internes'), isNull(t.auditPlanItems.cancelledAt))).orderBy(asc(t.auditPlanItems.id));
    const finding = (fields: Record<string, string>) => saveFinding({}, form({ planItemId: String(item.id), text: 'Constat de test', foundOn: '2026-09-01', ...fields }));
    expect(await finding({ kind: 'ecart_majeur', responseDueOn: '2026-08-01' })).toMatchObject({ fieldErrors: { responseDueOn: expect.any(String) } });
    const r = await finding({ kind: 'ecart_majeur', responseDueOn: '2026-10-20' });
    expect(r).toMatchObject({ ok: true });
    expect((await loadAuditSignals()).todo.find((x) => x.href === `/audits?constat=${r.id}`)).toMatchObject({ date: '2026-10-20', dueOn: '2026-10-20', tone: 'warn' });
    const obs = await finding({ kind: 'observation', responseDueOn: '2026-10-20' });
    const [row] = await (await db()).select().from(t.auditFindings).where(eq(t.auditFindings.id, Number(obs.id)));
    expect(row).toMatchObject({ kind: 'observation', responseDueOn: null });
    expect(await lastLog('audit_finding', r.id!)).toMatchObject({ action: 'create', summary: expect.stringContaining('écart majeur') });
  });
});

describe('DOC-12 : refus et acceptation partielle d’un bordereau', () => {
  it('motif et quantité refusée exigés ; refus journalisé ; valorisation sur la part acceptée', async () => {
    actAs('Chef de service', 'ville-a');
    expect(await saveWasteEntry({}, form({ streamId: 'FD-01', removedOn: '2026-10-01', quantity: '100' }))).toEqual({ error: DENIED });
    actAs('Animateur QHSE', 'ville-a');
    const entry = (fields: Record<string, string>) => saveWasteEntry({}, form({ streamId: 'FD-01', removedOn: '2026-10-05', quantity: '200', bsdNumber: 'BSD-20261005-REFUS01', ...fields }));
    expect(await entry({ bsdStatus: 'accepte_partiel' })).toMatchObject({ fieldErrors: { bsdRefusalReason: expect.any(String), bsdRefusedQuantity: expect.any(String) } });
    expect(await entry({ bsdStatus: 'accepte_partiel', bsdRefusedQuantity: '200', bsdRefusalReason: 'Fûts non étiquetés' })).toMatchObject({ fieldErrors: { bsdRefusedQuantity: expect.any(String) } });
    const r = await entry({ bsdStatus: 'refuse', bsdRefusalReason: 'Déchet non conforme au certificat d’acceptation préalable' });
    expect(r).toMatchObject({ ok: true });
    const [row] = await (await db()).select().from(t.wasteEntries).where(eq(t.wasteEntries.id, Number(r.id)));
    expect(row).toMatchObject({ bsdStatus: 'refuse', bsdRefusedQuantity: 200 });
    expect(await saveWasteEntry({}, form({ id: r.id!, streamId: 'FD-01', removedOn: '2026-10-05', quantity: '200', bsdNumber: 'BSD-20261005-REFUS01', bsdStatus: 'accepte_partiel', bsdRefusedQuantity: '50', bsdRefusalReason: 'Deux fûts refusés' })))
      .toMatchObject({ ok: true });
    expect((await lastLog('waste_entry', r.id!))?.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'Quantité refusée' })]));
  });
});

describe('AUD-13 : objectifs QHSE mesurables', () => {
  const objective = (fields: Record<string, string>) => saveObjective({}, form({ year: '2026', label: 'Objectif de test', indicator: 'nc', target: '10', siteId: 'all', pilotId: 'clefevre', ...fields }));
  it('saisie réservée à l’animateur QHSE et à la direction ; contrôles ; valeur calculée ; journal', async () => {
    actAs('Chef de service', 'all');
    expect(await objective({})).toEqual({ error: DENIED });
    expect((await loadObjectives(2026)).objectives.length).toBeGreaterThan(0); // consultation
    actAs('Animateur QHSE', 'all');
    expect(await objective({ indicator: 'inconnu' })).toMatchObject({ fieldErrors: { indicator: 'Valeur non autorisée.' } });
    expect(await objective({ indicator: 'actions_retard', target: '120' })).toMatchObject({ fieldErrors: { target: expect.any(String) } });
    const [decision] = await (await db()).select().from(t.reviewDecisions).where(eq(t.reviewDecisions.kind, 'decision'));
    expect(await objective({ reviewDecisionId: String(decision.id) })).toMatchObject({ fieldErrors: { reviewDecisionId: expect.any(String) } });
    actAs('Animateur QHSE', 'ville-a');
    expect(await objective({ siteId: 'ville-b' })).toMatchObject({ fieldErrors: { siteId: expect.stringContaining('autre site') } });
    actAs('Animateur QHSE', 'all');
    const r = await objective({});
    expect(r).toMatchObject({ ok: true });
    expect(await lastLog('qhse_objective', r.id!)).toMatchObject({ action: 'create', summary: expect.stringContaining('Non-conformités ≤ 10') });
    const view = (await loadObjectives(2026)).objectives.find((o) => o.id === Number(r.id))!;
    expect(view.value).toBeGreaterThan(0);
    expect(view.status.key).toMatch(/met|missed/);
    expect(await saveObjective({}, form({ id: r.id!, year: '2026', label: 'Objectif de test', indicator: 'nc', target: '12', siteId: 'all', pilotId: 'clefevre' }))).toEqual({ ok: true, id: r.id });
    expect((await lastLog('qhse_objective', r.id!))?.details).toEqual([expect.objectContaining({ field: 'Cible', from: '≤ 10', to: '≤ 12' })]);
    expect(await archiveObjective({}, form({ id: r.id!, reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await archiveObjective({}, form({ id: r.id!, reason: 'Saisi en double' }))).toEqual({ ok: true, id: r.id });
    expect((await loadObjectives(2026)).objectives.some((o) => o.id === Number(r.id))).toBe(false);
    expect(await loadEntityHistory('qhse_objective', r.id!)).toMatchObject({ entries: expect.arrayContaining([expect.objectContaining({ action: 'archive' })]) });
    actAs('Salarié');
    expect(await loadEntityHistory('qhse_objective', r.id!)).toEqual({ error: 'Historique introuvable.' });
  });
  it('cible TF1 du tableau de bord tirée de l’objectif de l’année', async () => {
    actAs('Animateur QHSE', 'all');
    const kpi = (await loadDashboard()).kpis.find((k) => k.label === 'TF1 · 12 mois glissants')!;
    expect(kpi.note).toContain('Objectif 2026 : TF1 ≤ 4,0');
  });
});

describe('CNF-05 : contexte du système de management', () => {
  it('traitement exigé d’un risque ; saisie, archivage motivé et journal', async () => {
    actAs('Chef de service', 'all');
    expect(await saveContextItem({}, form({ kind: 'risque', label: 'Risque de test', treatment: 'x' }))).toEqual({ error: DENIED });
    actAs('Animateur QHSE', 'all');
    expect(await saveContextItem({}, form({ kind: 'risque', label: 'Risque de test' }))).toMatchObject({ fieldErrors: { treatment: expect.any(String) } });
    const r = await saveContextItem({}, form({ kind: 'risque', label: 'Risque de test', detail: 'Description', treatment: 'Plan de continuité' }));
    expect(r).toMatchObject({ ok: true });
    expect(await lastLog('context_item', r.id!)).toMatchObject({ action: 'create' });
    expect((await loadContext()).groups.find((g) => g.kind === 'risque')!.items.some((i) => i.id === Number(r.id))).toBe(true);
    expect(await archiveContextItem({}, form({ id: r.id!, reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await archiveContextItem({}, form({ id: r.id!, reason: 'Sans objet' }))).toEqual({ ok: true, id: r.id });
    expect(await lastLog('context_item', r.id!)).toMatchObject({ action: 'archive', reason: 'Sans objet' });
  });
});

describe('CNF-03 : bilan annuel SSCT', () => {
  it('rôles habilités aux données de santé ; accidentologie, MP, trajet et actions de l’année', async () => {
    actAs('Chef de service', 'all');
    expect(await loadSsctReport('2026')).toBeNull();
    actAs('Direction', 'all');
    const r = await loadSsctReport('2026');
    expect(r).toMatchObject({ year: 2026, site: 'Tous les sites' });
    expect(r!.accidents.commute).toBeGreaterThanOrEqual(1);
    expect(r!.accidents.occupationalDiseases).toBeGreaterThanOrEqual(1);
    expect(r!.accidents.arret).toBeGreaterThanOrEqual(1);
    expect(r!.duerp.map((v) => v.version)).toContain('2026.1');
    expect(r!.programs.map((p) => p.year)).toEqual([2026, 2027]);
    expect((await loadSsctReport(undefined))!.year).toBe(2025);
  });
});
