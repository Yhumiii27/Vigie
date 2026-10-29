import '../next-mocks';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { getDb, schema as t } from '@/db';
import { loadChangeSignals, loadChanges } from '@/lib/data/changes';
import { loadDocumentSignals, loadDocuments } from '@/lib/data/documents';
import { loadEmergencies, loadEmergencySignals } from '@/lib/data/emergencies';
import { loadPersonalData, loadPersonalDataPeople } from '@/lib/data/personal-data';
import { loadVisibleTodo } from '@/lib/data/todo';
import { cancelChangeRequest, completeChangeRequest, decideChangeRequest, saveChangeRequest } from '@/server/changes';
import { cancelDocumentReview, recordDocumentReview, updateDocument } from '@/server/documents';
import { archiveEmergencySituation, cancelEmergencyDrill, recordEmergencyDrill, saveEmergencySituation } from '@/server/emergencies';
import { STALE_EDIT } from '@/server/versions';

// Paquet 13, seconde moitié — revue périodique sans modification (DOC-15), conservation et documents externes (DOC-17),
// situations d'urgence (CNF-08), gestion des changements (CNF-11), données d'une personne (SEC-13). Droits par rôle et
// site, motif, journal ; échéances : visibilité par rôle et site.

freshDemoDatabase();

const db = () => getDb();
const DENIED = 'Votre rôle ne permet pas cette modification.';
const APPROVERS_ONLY = "Réservé à l'animateur QHSE et à la direction.";
const OTHER_SITE = 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.';
const REASON_REQUIRED = { fieldErrors: { reason: expect.any(String) } };

describe('DOC-15 : revue périodique sans modification', () => {
  it('propriétaire ou approbateurs ; la prochaine revue repart de la revue ; échéance levée ; annulation motivée', async () => {
    const href = '/documents?doc=PR-QHSE-005';
    actAs('Animateur QHSE', 'all');
    expect((await loadDocumentSignals()).todo.some((x) => x.href === href && x.overdue)).toBe(true);
    // Écran Documents en consultation (encadrement, Salarié) : refusé.
    for (const role of ['Chef de service', 'Chef de projet', 'Salarié'] as const) {
      actAs(role, 'ville-a');
      expect((await recordDocumentReview({}, form({ documentId: 'PR-QHSE-005', reviewedOn: '2026-10-01', conclusion: 'x' }))).error, role).toMatch(/Consultation seule|Votre rôle/);
    }
    actAs('Animateur QHSE', 'all');
    expect(await recordDocumentReview({}, form({ documentId: 'PR-QHSE-005', reviewedOn: '2026-10-10', conclusion: 'x' }))).toMatchObject({ fieldErrors: { reviewedOn: 'Date postérieure à aujourd’hui.' } });
    expect(await recordDocumentReview({}, form({ documentId: 'PR-QHSE-005', reviewedOn: '2026-10-01', conclusion: 'Procédure toujours adaptée.' }))).toEqual({ ok: true, id: 'PR-QHSE-005' });
    const row = (await loadDocuments()).rows.find((r) => r.id === 'PR-QHSE-005')!;
    expect(row).toMatchObject({ lastReviewedOn: '2026-10-01', nextReviewOn: '2029-10-01', overdue: false });
    expect(row.reviews[0]).toMatchObject({ version: 'B', reviewer: '[C. Lefèvre]', conclusion: 'Procédure toujours adaptée.', cancelled: null });
    expect(await lastLog('document', 'PR-QHSE-005')).toMatchObject({ action: 'review', summary: 'Revue périodique sans modification · version B maintenue (01/10/2026)' });
    expect((await loadDocumentSignals()).todo.some((x) => x.href === href)).toBe(false);
    // Annulation : approbateurs, motif obligatoire ; l'échéance revient.
    actAs('Chef de service', 'ville-a');
    expect(await cancelDocumentReview({}, form({ id: String(row.reviews[0].id), reason: 'x' }))).toEqual({ error: APPROVERS_ONLY });
    actAs('Animateur QHSE', 'all');
    expect(await cancelDocumentReview({}, form({ id: String(row.reviews[0].id) }))).toMatchObject(REASON_REQUIRED);
    expect(await cancelDocumentReview({}, form({ id: String(row.reviews[0].id), reason: 'Saisie sur le mauvais document' }))).toMatchObject({ ok: true });
    expect((await loadDocumentSignals()).todo.some((x) => x.href === href && x.overdue)).toBe(true);
    expect(await lastLog('document', 'PR-QHSE-005')).toMatchObject({ action: 'cancel', reason: 'Saisie sur le mauvais document' });
  });

  it('refusée pendant une révision en cours ; site du document', async () => {
    actAs('Direction', 'ville-a');
    expect(await recordDocumentReview({}, form({ documentId: 'FO-QHSE-010', reviewedOn: '2026-10-05', conclusion: 'Fiche toujours adaptée.' }))).toEqual({ ok: true, id: 'FO-QHSE-010' });
    // FO-MON-003 : révision C en brouillon.
    expect(await recordDocumentReview({}, form({ documentId: 'FO-MON-003', reviewedOn: '2026-10-05', conclusion: 'x' }))).toEqual({ error: 'Révision C en cours : son approbation tiendra lieu de revue.' });
    // Document du site A depuis le site B : refusé.
    actAs('Animateur QHSE', 'ville-b');
    expect(await recordDocumentReview({}, form({ documentId: 'IT-MON-012', reviewedOn: '2026-10-05', conclusion: 'x' }))).toEqual({ error: OTHER_SITE });
  });
});

describe('DOC-17 : conservation des enregistrements et documents d’origine externe', () => {
  it('origine, émetteur et durée de conservation enregistrés et journalisés', async () => {
    actAs('Animateur QHSE', 'all');
    const [d] = await (await db()).select().from(t.documents).where(eq(t.documents.id, 'PR-ACH-001'));
    const base = { id: d.id, title: d.title, type: d.type, process: d.process, ownerId: d.ownerId, reviewMonths: String(d.reviewMonths), distribution: d.distribution, siteId: '' };
    expect(await updateDocument({}, form({ ...base, origin: 'externe', retention: '' }))).toMatchObject({ fieldErrors: { issuer: expect.stringContaining("Indiquez l'émetteur") } });
    expect(await updateDocument({}, form({ ...base, origin: 'externe', issuer: '[Client A]', retention: '10 ans' }))).toMatchObject({ ok: true });
    expect(await lastLog('document', 'PR-ACH-001')).toMatchObject({ details: expect.arrayContaining([
      { field: 'Origine', from: 'Interne', to: "D'origine externe" }, { field: 'Émetteur', from: null, to: '[Client A]' }, { field: 'Durée de conservation', from: null, to: '10 ans' },
    ]) });
    // Formulaire sans ces champs (appel antérieur) : valeurs conservées.
    expect(await updateDocument({}, form({ ...base, title: 'Évaluation des fournisseurs et sous-traitants' }))).toMatchObject({ ok: true });
    const row = (await loadDocuments()).rows.find((r) => r.id === 'PR-ACH-001')!;
    expect(row).toMatchObject({ origin: 'externe', originLabel: "D'origine externe", issuer: '[Client A]', retention: '10 ans' });
    // Jeu de démonstration : document externe et registre avec sa durée de conservation.
    expect((await loadDocuments()).rows.find((r) => r.id === 'EXT-QHSE-001')).toMatchObject({ origin: 'externe', issuer: '[Client A]' });
  });
});

describe('CNF-08 : situations d’urgence et exercices', () => {
  it('jeu de démonstration : exercice de déversement en retard, au responsable de la situation, sur le site A', async () => {
    actAs('Animateur QHSE', 'all');
    const { situations } = await loadEmergencies();
    const spill = situations.find((s) => s.label === 'Déversement de produit chimique au magasin')!;
    expect(spill.due).toMatchObject({ late: true, tone: 'danger' });
    const sig = (await loadEmergencySignals()).todo.find((x) => x.key === `urgence-exercice|${spill.id}`)!;
    expect(sig).toMatchObject({ siteId: 'ville-a', overdue: true, ownerIds: ['rfontaine'], href: `/risques?vue=urgences&situation=${spill.id}` });
    // Site B sélectionné : échéance d'un autre site, hors de la liste « Toutes » de l'animateur.
    actAs('Animateur QHSE', 'ville-b');
    expect((await loadVisibleTodo()).find((x) => x.key === `urgence-exercice|${spill.id}`)?.elsewhere ?? true).toBe(true);
    expect((await loadEmergencies()).situations.some((s) => s.id === spill.id)).toBe(false);
    // Chef de projet (écran en consultation) : pas l'échéance d'autrui.
    actAs('Chef de projet', 'ville-a');
    expect((await loadVisibleTodo()).some((x) => x.key === `urgence-exercice|${spill.id}`)).toBe(false);
  });

  it('création, modification (version), exercice tenu, annulation motivée, archivage motivé ; droits et site', async () => {
    actAs('Chef de projet', 'ville-a');
    expect(await saveEmergencySituation({}, form({ siteId: 'ville-a', label: 'Fuite de gaz', drillMonths: '12' }))).toEqual({ error: DENIED });
    actAs('Chef de service', 'ville-b');
    expect(await saveEmergencySituation({}, form({ siteId: 'ville-a', label: 'Fuite de gaz', drillMonths: '12' }))).toMatchObject({ error: OTHER_SITE });
    actAs('Chef de service', 'ville-a');
    expect(await saveEmergencySituation({}, form({ siteId: 'ville-a', label: 'Fuite de gaz', drillMonths: '0' }))).toMatchObject({ fieldErrors: { drillMonths: 'Minimum 1.' } });
    expect(await saveEmergencySituation({}, form({ siteId: 'ville-a', label: 'Fuite de gaz', drillMonths: '12', ownerId: 'ylambert' }))).toMatchObject({ fieldErrors: { ownerId: expect.stringContaining('sortie') } });
    const r = await saveEmergencySituation({}, form({ siteId: 'ville-a', label: 'Fuite de gaz', scenario: 'Fuite au poste de soudure', drillMonths: '12', nextDrillOn: '2026-10-20', ownerId: 'sbenali' }));
    expect(r).toMatchObject({ ok: true });
    const id = Number(r.id);
    expect(await lastLog('emergency_situation', id)).toMatchObject({ action: 'create' });
    const sig = (await loadEmergencySignals()).todo.find((x) => x.key === `urgence-exercice|${id}`);
    expect(sig).toMatchObject({ dueOn: '2026-10-20', overdue: false, ownerIds: ['sbenali'], title: 'Fuite de gaz — exercice planifié le 20/10/2026' });
    // Modification avec la version lue : enregistrée ; version périmée : refusée.
    const { versions } = await loadEmergencies();
    const version = versions[String(id)];
    expect(await saveEmergencySituation({}, form({ id: String(id), version, siteId: 'ville-a', label: 'Fuite de gaz (soudure)', drillMonths: '6', nextDrillOn: '2026-10-20', ownerId: 'sbenali' }))).toMatchObject({ ok: true });
    expect(await saveEmergencySituation({}, form({ id: String(id), version, siteId: 'ville-a', label: 'Autre', drillMonths: '6' }))).toEqual({ error: STALE_EDIT });
    expect(await lastLog('emergency_situation', id)).toMatchObject({ details: expect.arrayContaining([{ field: 'Situation', from: 'Fuite de gaz', to: 'Fuite de gaz (soudure)' }]) });
    // Exercice tenu avant l'exercice planifié : la planification reste (exercice à venir) ; l'exercice planifié du 20/10 est
    // l'échéance. Exercice tenu à la date planifiée ou après : planification levée, prochain exercice dans 6 mois.
    expect(await recordEmergencyDrill({}, form({ situationId: String(id), heldOn: '2026-10-10', participants: 'x', findings: 'y' }))).toMatchObject({ fieldErrors: { heldOn: expect.any(String) } });
    expect(await recordEmergencyDrill({}, form({ situationId: String(id), heldOn: '2026-10-08', participants: 'Atelier soudure (6)', findings: 'Coupure du gaz en 1 min.' }))).toMatchObject({ ok: true });
    let view = (await loadEmergencies()).situations.find((s) => s.id === id)!;
    expect(view).toMatchObject({ lastHeldOn: '2026-10-08', nextDrillOn: '2026-10-20', due: { on: '2026-10-20', planned: true } });
    const v2 = (await loadEmergencies()).versions[String(id)];
    expect(await saveEmergencySituation({}, form({ id: String(id), version: v2, siteId: 'ville-a', label: 'Fuite de gaz (soudure)', drillMonths: '6', nextDrillOn: '', ownerId: 'sbenali' }))).toMatchObject({ ok: true });
    view = (await loadEmergencies()).situations.find((s) => s.id === id)!;
    expect(view).toMatchObject({ nextDrillOn: null, due: { on: '2027-04-08', late: false } });
    expect((await loadEmergencySignals()).todo.some((x) => x.key === `urgence-exercice|${id}`)).toBe(false);
    // Annulation d'un exercice : approbateurs, motif ; archivage : approbateurs, motif.
    expect(await cancelEmergencyDrill({}, form({ id: String(view.drills[0].id), reason: 'x' }))).toEqual({ error: APPROVERS_ONLY });
    actAs('Animateur QHSE', 'ville-a');
    expect(await cancelEmergencyDrill({}, form({ id: String(view.drills[0].id) }))).toMatchObject(REASON_REQUIRED);
    expect(await cancelEmergencyDrill({}, form({ id: String(view.drills[0].id), reason: 'Saisi sur la mauvaise situation' }))).toMatchObject({ ok: true });
    expect((await loadEmergencies()).situations.find((s) => s.id === id)?.lastHeldOn).toBeNull();
    expect(await archiveEmergencySituation({}, form({ id: String(id) }))).toMatchObject(REASON_REQUIRED);
    expect(await archiveEmergencySituation({}, form({ id: String(id), reason: 'Poste de soudure démonté' }))).toMatchObject({ ok: true });
    const after = await loadEmergencies();
    expect(after.archived.find((s) => s.id === id)).toMatchObject({ due: null, archived: { reason: 'Poste de soudure démonté' } });
    expect(await recordEmergencyDrill({}, form({ situationId: String(id), heldOn: '2026-10-08', participants: 'x', findings: 'y' }))).toEqual({ error: 'Situation archivée : elle reste consultable avec son historique.' });
    expect((await changeLog('emergency_situation', id)).map((e) => e.action)).toEqual(['create', 'update', 'drill', 'update', 'cancel', 'archive']);
  });
});

describe('CNF-11 : gestion des changements', () => {
  it('jeu de démonstration : demande à évaluer (responsable QHSE du site), changement accepté à mettre en œuvre (pilote)', async () => {
    actAs('Animateur QHSE', 'all');
    const { todo } = await loadChangeSignals();
    expect(todo.find((x) => x.key === 'changement|MC-002|demandee')).toMatchObject({ siteId: 'ville-a', ownerIds: ['clefevre'] });
    expect(todo.find((x) => x.key === 'changement|MC-001|acceptee')).toMatchObject({ dueOn: '2026-10-19', ownerIds: ['sbenali'], overdue: false });
    expect(todo.some((x) => (x.key ?? '').startsWith('changement|MC-003'))).toBe(false);
    // Chef de service (écran Audits en consultation) : sa propre échéance seulement (pilote de MC-001).
    actAs('Chef de service', 'ville-a');
    const mine = (await loadVisibleTodo()).filter((x) => x.key?.startsWith('changement|') ?? false);
    expect(mine.map((x) => x.key)).toEqual(['changement|MC-001|acceptee|warn|2026-10-19']);
  });

  it('demande, décision motivée, mise en œuvre ; droits, site, version, annulation motivée, journal', async () => {
    actAs('Chef de service', 'ville-a');
    expect(await saveChangeRequest({}, form({ kind: 'procede', title: 'x', description: 'y', siteId: 'ville-a' }))).toEqual({ error: DENIED });
    actAs('Animateur QHSE', 'ville-b');
    expect(await saveChangeRequest({}, form({ kind: 'procede', title: 'x', description: 'y', siteId: 'ville-a' }))).toMatchObject({ error: OTHER_SITE });
    actAs('Animateur QHSE', 'ville-a');
    expect(await saveChangeRequest({}, form({ kind: 'inconnu', title: 'x', description: 'y', siteId: 'ville-a' }))).toMatchObject({ fieldErrors: { kind: 'Valeur non autorisée.' } });
    const r = await saveChangeRequest({}, form({ kind: 'procede', title: 'Nouveau dégraissant', description: 'Remplacement du solvant chloré', rationale: 'Substitution CMR', impacts: 'FDS, DUERP', pilotId: 'lmoreau', siteId: 'ville-a' }));
    expect(r).toEqual({ ok: true, id: 'MC-004' });
    expect(await lastLog('change_request', 'MC-004')).toMatchObject({ action: 'create' });
    const { versions } = await loadChanges();
    expect(await saveChangeRequest({}, form({ id: 'MC-004', version: versions['MC-004'], kind: 'procede', title: 'Nouveau dégraissant aqueux', description: 'Remplacement du solvant chloré', pilotId: 'lmoreau', siteId: 'ville-a' }))).toMatchObject({ ok: true });
    expect(await saveChangeRequest({}, form({ id: 'MC-004', version: versions['MC-004'], kind: 'procede', title: 'Autre', description: 'z', siteId: 'ville-a' }))).toEqual({ error: STALE_EDIT });
    // Décision : approbateurs seulement, justification obligatoire.
    actAs('Chef de service', 'ville-a');
    expect(await decideChangeRequest({}, form({ id: 'MC-004', decision: 'acceptee', decidedOn: '2026-10-09', decisionNote: 'x' }))).toEqual({ error: APPROVERS_ONLY });
    actAs('Direction', 'ville-a');
    expect(await decideChangeRequest({}, form({ id: 'MC-004', decision: 'acceptee', decidedOn: '2026-10-09' }))).toMatchObject({ fieldErrors: { decisionNote: 'Champ obligatoire.' } });
    expect(await completeChangeRequest({}, form({ id: 'MC-004', doneOn: '2026-10-09', doneNote: 'x' }))).toEqual({ error: 'Seul un changement accepté se déclare mis en œuvre.' });
    expect(await decideChangeRequest({}, form({ id: 'MC-004', decision: 'acceptee', decidedOn: '2026-10-09', decisionNote: 'Essai sur un poste', plannedOn: '2026-10-05' }))).toMatchObject({ fieldErrors: { plannedOn: 'La mise en œuvre suit la décision.' } });
    expect(await decideChangeRequest({}, form({ id: 'MC-004', decision: 'acceptee', decidedOn: '2026-10-09', decisionNote: 'Essai sur un poste', plannedOn: '2026-10-15' }))).toMatchObject({ ok: true });
    expect(await decideChangeRequest({}, form({ id: 'MC-004', decision: 'refusee', decidedOn: '2026-10-09', decisionNote: 'x' }))).toEqual({ error: 'Décision déjà prise sur cette demande.' });
    expect((await loadChangeSignals()).todo.find((x) => x.key === 'changement|MC-004|acceptee')).toMatchObject({ ownerIds: ['lmoreau'], dueOn: '2026-10-15' });
    expect(await completeChangeRequest({}, form({ id: 'MC-004', doneOn: '2026-10-09', doneNote: 'Dégraissant aqueux en service' }))).toMatchObject({ ok: true });
    expect((await loadChanges()).rows.find((c) => c.id === 'MC-004')).toMatchObject({ status: 'realisee', statusLabel: 'Mise en œuvre', done: { on: '2026-10-09' } });
    expect(await cancelChangeRequest({}, form({ id: 'MC-004', reason: 'x' }))).toEqual({ error: 'Changement mis en œuvre : il reste au registre.' });
    expect((await changeLog('change_request', 'MC-004')).map((e) => e.action)).toEqual(['create', 'update', 'status', 'status']);
    // Annulation motivée d'une demande à évaluer.
    expect(await cancelChangeRequest({}, form({ id: 'MC-002' }))).toMatchObject(REASON_REQUIRED);
    expect(await cancelChangeRequest({}, form({ id: 'MC-002', reason: 'Doublon de la demande du magasin' }))).toMatchObject({ ok: true });
    expect((await loadChangeSignals()).todo.some((x) => x.key === 'changement|MC-002|demandee')).toBe(false);
    expect(await saveChangeRequest({}, form({ id: 'MC-002', kind: 'organisation', title: 'x', description: 'y', siteId: 'ville-a' }))).toEqual({ error: 'Demande annulée : elle reste consultable avec son historique.' });
  });
});

describe('SEC-13 : données d’une personne (droit d’accès)', () => {
  it('vue complète en lecture (identité, droits affichés, habilitations, événements, actions, journal), consultation journalisée par la page', async () => {
    actAs('Animateur QHSE', 'all');
    expect((await loadPersonalDataPeople()).some(([id]) => id === 'tnguyen')).toBe(true);
    const d = await loadPersonalData('sbenali');
    expect(d).not.toBeNull();
    expect(d!.identity).toMatchObject({ name: '[S. Benali]', site: expect.stringContaining('[Ville A]') });
    expect(d!.qualifications.length).toBeGreaterThan(0);
    expect(d!.actions.length).toBeGreaterThan(0);
    expect(d!.changes.total).toBeGreaterThan(0);
    expect(d!.situations.map((s) => s.label)).toContain("Incendie de l'atelier montage");
    expect(await loadPersonalData('inconnu')).toBeNull();
  });
});
