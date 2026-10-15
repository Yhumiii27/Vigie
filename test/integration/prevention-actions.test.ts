import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, file, formWith, lastLog, freshDemoDatabase } from '../helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import {
  addPlanAttachments, cancelPlan, closePlan, deletePlan, recordPlanEeSignature, removePlanAttachment, savePlan, signPlanEu,
} from '@/server/prevention';

// Recette des server actions des plans de prévention jamais exécutées jusqu'ici (QUA-05) : signatures EU et EE,
// clôture, annulation, suppression d'un brouillon, pièces jointes ; droits, site sélectionné, journal, motifs.
// Jeu de démonstration au 09/10/2026 (src/db/seeds/prevention.ts) : sites Seveso seuil haut « dès la première minute ».

const uploads = freshDemoDatabase();

const plan = async (id: string) => {
  const [row] = await (await getDb()).select().from(t.preventionPlans).where(eq(t.preventionPlans.id, id));
  return row;
};
const planFiles = async (id: string) => (await getDb()).select().from(t.attachments).where(eq(t.attachments.entityId, id));

describe('droits et site sélectionné', () => {
  it('Salarié : aucune action sur les plans', async () => {
    actAs('Salarié');
    const denied = { error: 'Votre rôle ne permet pas cette modification.' };
    expect(await signPlanEu('PP-2026-016')).toEqual(denied);
    expect(await closePlan('PP-2026-011')).toEqual(denied);
    expect(await deletePlan('PP-2026-018')).toEqual(denied);
    expect(await cancelPlan({}, form({ id: 'PP-2026-017', reason: 'Test' }))).toEqual(denied);
    expect(await recordPlanEeSignature({}, form({ id: 'PP-2026-013', signedEeOn: '2026-10-03' }))).toEqual(denied);
    expect(await addPlanAttachments({}, formWith({ id: 'PP-2026-016' }, { files: [file()] }))).toEqual(denied);
    expect((await plan('PP-2026-016')).signedEuOn).toBeNull();
  });

  it('plan d’un autre site que celui sélectionné : refusé', async () => {
    actAs('Chef de service', 'ville-b');
    expect(await signPlanEu('PP-2026-016')).toEqual({ error: 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.' });
    actAs('Chef de service', 'ville-a');
    expect(await closePlan('PP-2026-011')).toEqual({ error: 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.' });
    expect(await signPlanEu('PP-inconnu')).toEqual({ error: 'Plan de prévention introuvable.' });
  });
});

describe('signPlanEu : signature de l’entreprise utilisatrice', () => {
  it('signe à la date du jour après l’inspection commune, journalisé avec son auteur', async () => {
    actAs('Chef de projet', 'all');
    expect(await signPlanEu('PP-2026-016')).toEqual({});
    expect(await plan('PP-2026-016')).toMatchObject({ signedEuOn: '2026-10-09', signedEeOn: null, status: 'a_signer' });
    expect(await lastLog('prevention_plan', 'PP-2026-016')).toMatchObject({ action: 'sign', summary: "Signé pour l'entreprise utilisatrice", byId: 'edubois' });
    expect(await signPlanEu('PP-2026-016')).toEqual({ error: "Le plan est déjà signé par l'entreprise utilisatrice." });
  });
  it('refusée sans inspection commune réalisée, sans mesures de prévention, sur un plan annulé', async () => {
    actAs('Animateur QHSE', 'all');
    expect(await signPlanEu('PP-2026-015')).toEqual({ error: "Réalisez l'inspection commune préalable avant de signer le plan." });
    expect(await signPlanEu('PP-2026-018')).toEqual({ error: "Réalisez l'inspection commune préalable avant de signer le plan." }); // prévue le 15/10
    const db = await getDb();
    await db.update(t.preventionPlans).set({ inspectionOn: '2026-10-08' }).where(eq(t.preventionPlans.id, 'PP-2026-015'));
    expect(await signPlanEu('PP-2026-015')).toEqual({ error: 'Complétez les mesures de prévention avant de signer le plan.' });
    await db.update(t.preventionPlans).set({ inspectionOn: null }).where(eq(t.preventionPlans.id, 'PP-2026-015'));
    expect(await signPlanEu('PP-2026-010')).toEqual({ error: 'Ce plan est annulé.' });
    expect(await changeLog('prevention_plan', 'PP-2026-015')).toEqual([]);
  });
});

describe('recordPlanEeSignature : signature de l’entreprise extérieure', () => {
  it('contrôles de la date : obligatoire, jamais future, jamais avant l’inspection commune', async () => {
    actAs('Chef de service');
    expect(await recordPlanEeSignature({}, form({ id: 'PP-2026-013', signedEeOn: '' }))).toMatchObject({ fieldErrors: { signedEeOn: 'Date obligatoire.' } });
    expect(await recordPlanEeSignature({}, form({ id: 'PP-2026-013', signedEeOn: '2026-10-10' }))).toMatchObject({ fieldErrors: { signedEeOn: 'La date de signature ne peut pas être future.' } });
    expect(await recordPlanEeSignature({}, form({ id: 'PP-2026-013', signedEeOn: '2026-10-01' }))).toMatchObject({
      error: "La signature ne peut pas précéder l'inspection commune.", fieldErrors: { signedEeOn: expect.any(String) },
    });
    expect(await recordPlanEeSignature({}, formWith({ id: 'PP-2026-013', signedEeOn: '2026-10-03' }, { file: [file('scan.zip', 'application/zip')] })))
      .toMatchObject({ fieldErrors: { file: expect.stringContaining('Format non accepté') } });
    expect((await plan('PP-2026-013')).signedEeOn).toBeNull();
  });
  it('enregistre la date et l’exemplaire signé : plan signé, journal, pièce jointe chiffrée ou non sur disque', async () => {
    actAs('Chef de service');
    const r = await recordPlanEeSignature({}, formWith({ id: 'PP-2026-013', signedEeOn: '2026-10-03' }, { file: [file()] }));
    expect(r).toEqual({ ok: true, id: 'PP-2026-013' });
    expect(await plan('PP-2026-013')).toMatchObject({ signedEuOn: '2026-10-02', signedEeOn: '2026-10-03', status: 'signe' });
    expect(await lastLog('prevention_plan', 'PP-2026-013')).toMatchObject({
      action: 'sign', byId: 'sbenali', summary: "Signature de l'entreprise extérieure enregistrée (03/10/2026), exemplaire signé joint",
    });
    const [att] = await planFiles('PP-2026-013');
    expect(att).toMatchObject({ entityType: 'prevention_plan', fileName: 'exemplaire-signe.pdf', uploadedBy: 'sbenali' });
    expect(existsSync(path.join(uploads, att.storagePath))).toBe(true);
    expect(await recordPlanEeSignature({}, form({ id: 'PP-2026-013', signedEeOn: '2026-10-03' }))).toEqual({ error: "La signature de l'entreprise extérieure est déjà enregistrée." });
  });
});

describe('closePlan et cancelPlan', () => {
  it('jamais pendant une intervention sans le plan obligatoire signé ; motif d’annulation obligatoire', async () => {
    actAs('Animateur QHSE');
    const inProgress = 'Intervention en cours avec un plan obligatoire non signé : enregistrez les signatures des deux entreprises avant';
    expect((await closePlan('PP-2026-015')).error).toBe(`${inProgress} de clore le plan.`);
    expect(await cancelPlan({}, form({ id: 'PP-2026-015', reason: ' ' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect((await cancelPlan({}, form({ id: 'PP-2026-015', reason: 'Intervention reportée' }))).error).toBe(`${inProgress} d'annuler le plan.`);
    expect((await plan('PP-2026-015')).status).toBe('brouillon');
  });

  it('clôture d’un plan signé (intervention en cours) puis plan figé', async () => {
    actAs('Chef de service');
    expect(await closePlan('PP-2026-013')).toEqual({});
    expect((await plan('PP-2026-013')).status).toBe('clos');
    expect(await lastLog('prevention_plan', 'PP-2026-013')).toMatchObject({ action: 'status', summary: 'Plan clos', byId: 'sbenali' });
    expect(await closePlan('PP-2026-013')).toEqual({ error: 'Ce plan est clos.' });
    expect(await addPlanAttachments({}, formWith({ id: 'PP-2026-013' }, { files: [file()] }))).toEqual({ error: 'Ce plan est clos.' });
    expect(await savePlan({}, form({ id: 'PP-2026-013' }))).toMatchObject({ error: expect.any(String) });
  });

  it('intervention réalisée sans plan signé : l’écart doit être tracé par une action avant la clôture', async () => {
    actAs('Animateur QHSE');
    const created = await savePlan({}, form({
      contractorId: 'EE-002', siteId: 'ville-a', title: 'Remplacement des luminaires de l’allée centrale', location: 'Atelier usinage',
      startOn: '2026-09-14', endOn: '2026-09-18', estimatedHours: '1 200', measures: 'Nacelle balisée.', interferenceRisks: '',
    }));
    expect(created).toMatchObject({ ok: true, id: 'PP-2026-019' });
    expect(await plan('PP-2026-019')).toMatchObject({ status: 'brouillon', estimatedHours: 1200 });
    expect(await lastLog('prevention_plan', 'PP-2026-019')).toMatchObject({ action: 'create', byId: 'clefevre' });
    expect(await closePlan('PP-2026-019')).toEqual({ error: "Intervention réalisée sans plan signé : créez l'action qui trace l'écart avant de clore le plan." });
    const db = await getDb();
    await db.insert(t.actions).values({
      id: 'A-900', title: 'Tracer l’intervention sans plan signé', origin: 'prevention', originRef: 'PP-2026-019', preventionPlanId: 'PP-2026-019', siteId: 'ville-a',
      pilotId: 'clefevre', dueOn: '2026-10-20', status: 'todo', kind: 'C',
    });
    expect(await closePlan('PP-2026-019')).toEqual({});
    expect((await plan('PP-2026-019')).status).toBe('clos');
  });

  it('permis rattachés encore actifs : clôturez-les d’abord', async () => {
    actAs('Animateur QHSE', 'ville-b');
    // PE-2026-009 (demandé) est rattaché au contrat ATEX PP-2026-014, signé et en cours.
    expect(await closePlan('PP-2026-014')).toEqual({ error: 'Permis rattachés encore actifs (PE-2026-009) : clôturez-les ou annulez-les avant de clore le plan.' });
    expect((await plan('PP-2026-014')).status).toBe('signe');
  });

  it('annulation d’une intervention à venir : motif conservé, auteur et date, journal', async () => {
    actAs('Direction');
    expect(await cancelPlan({}, form({ id: 'PP-2026-017', reason: 'Vérification reportée au mois prochain' }))).toEqual({ ok: true, id: 'PP-2026-017' });
    const p = await plan('PP-2026-017');
    expect(p).toMatchObject({ status: 'annule', cancelledById: 'hmarchand', cancelReason: 'Vérification reportée au mois prochain' });
    expect(p.cancelledAt).toBeInstanceOf(Date);
    expect(await lastLog('prevention_plan', 'PP-2026-017')).toMatchObject({ action: 'cancel', reason: 'Vérification reportée au mois prochain', byId: 'hmarchand' });
    expect(await signPlanEu('PP-2026-017')).toEqual({ error: 'Ce plan est annulé.' });
  });

  it('annulation refusée tant que des activités de la carte en cours ou à venir y sont rattachées', async () => {
    actAs('Animateur QHSE');
    const db = await getDb();
    // Plan signé pour l'exercice, permis annulé : seule reste l'activité de la carte rattachée (du 06 au 16/10).
    await db.update(t.preventionPlans).set({ status: 'signe', inspectionOn: '2026-10-05', signedEuOn: '2026-10-05', signedEeOn: '2026-10-05' })
      .where(eq(t.preventionPlans.id, 'PP-2026-015'));
    await db.update(t.permits).set({ status: 'annule', cancelReason: 'Test' }).where(eq(t.permits.preventionPlanId, 'PP-2026-015'));
    expect((await cancelPlan({}, form({ id: 'PP-2026-015', reason: 'Intervention interrompue' }))).error).toMatch(/^Activités de la carte en cours ou à venir rattachées au plan/);
  });
});

describe('deletePlan : suppression d’un brouillon saisi par erreur', () => {
  it('refusée pour un plan engagé (permis, événement, inspection ou signature)', async () => {
    actAs('Animateur QHSE');
    expect((await deletePlan('PP-2026-016')).error).toBe('Plan déjà engagé (inspection commune ou signature enregistrée) : annulez-le avec un motif.');
    actAs('Animateur QHSE', 'ville-b');
    expect((await deletePlan('PP-2026-014')).error).toMatch(/^Plan déjà engagé \(inspection commune ou signature enregistrée, permis PE-2026-009\)/);
  });
  it('brouillon sans engagement : ligne et pièces jointes supprimées, journal conservé, référence jamais réattribuée', async () => {
    actAs('Animateur QHSE');
    expect(await addPlanAttachments({}, formWith({ id: 'PP-2026-018' }, { files: [file('devis.pdf'), file('photo.jpg', 'image/jpeg')] }))).toEqual({ ok: true, id: 'PP-2026-018' });
    const files = await planFiles('PP-2026-018');
    expect(files.map((f) => f.fileName).sort()).toEqual(['devis.pdf', 'photo.jpg']);
    expect(await deletePlan('PP-2026-018')).toEqual({});
    expect(await plan('PP-2026-018')).toBeUndefined();
    expect(await planFiles('PP-2026-018')).toEqual([]);
    files.forEach((f) => expect(existsSync(path.join(uploads, f.storagePath))).toBe(false));
    expect((await changeLog('prevention_plan', 'PP-2026-018')).map((l) => l.action)).toEqual(['attach', 'attach', 'delete']);
    const next = await savePlan({}, form({
      contractorId: 'EE-001', siteId: 'ville-a', title: 'Nouveau plan', location: 'Atelier', startOn: '2026-11-02', endOn: '2026-11-03', estimatedHours: '8',
    }));
    expect(next).toMatchObject({ ok: true, id: 'PP-2026-020' });
  });
});

describe('addPlanAttachments et removePlanAttachment', () => {
  it('contrôles de l’envoi : au moins un fichier, cinq au plus, formats acceptés', async () => {
    actAs('Chef de service');
    expect(await addPlanAttachments({}, formWith({ id: 'PP-2026-016' }))).toMatchObject({ fieldErrors: { files: 'Choisissez au moins un fichier.' } });
    const six = Array.from({ length: 6 }, (_, i) => file(`f${i}.pdf`));
    expect(await addPlanAttachments({}, formWith({ id: 'PP-2026-016' }, { files: six }))).toMatchObject({ fieldErrors: { files: '5 fichiers au maximum par envoi.' } });
    expect(await addPlanAttachments({}, formWith({ id: 'PP-2026-016' }, { files: [file('x.exe', 'application/x-msdownload')] })))
      .toMatchObject({ fieldErrors: { files: expect.stringContaining('Format non accepté') } });
    expect(await planFiles('PP-2026-016')).toEqual([]);
  });
  it('ajout puis retrait d’une pièce jointe, journalisés ; le formulaire importé reste attaché', async () => {
    actAs('Chef de service');
    expect(await addPlanAttachments({}, formWith({ id: 'PP-2026-016' }, { files: [file('compte-rendu.pdf'), file('avenant.pdf')] }))).toEqual({ ok: true, id: 'PP-2026-016' });
    const [a, b] = await planFiles('PP-2026-016');
    expect(await removePlanAttachment(a.id)).toEqual({});
    expect((await planFiles('PP-2026-016')).map((f) => f.id)).toEqual([b.id]);
    expect(existsSync(path.join(uploads, a.storagePath))).toBe(false);
    const log = await changeLog('prevention_plan', 'PP-2026-016');
    expect(log.slice(-3).map((l) => [l.action, l.summary, l.byId])).toEqual([
      ['attach', 'Pièce jointe ajoutée : compte-rendu.pdf', 'sbenali'],
      ['attach', 'Pièce jointe ajoutée : avenant.pdf', 'sbenali'],
      ['detach', `Pièce jointe retirée : ${a.fileName}`, 'sbenali'],
    ]);
    const db = await getDb();
    await db.update(t.preventionPlans).set({ importedFromId: b.id }).where(eq(t.preventionPlans.id, 'PP-2026-016'));
    expect(await removePlanAttachment(b.id)).toEqual({ error: 'Le formulaire importé reste attaché au plan.' });
    expect(await removePlanAttachment('inconnue')).toEqual({ error: 'Pièce jointe introuvable.' });
    actAs('Chef de service', 'ville-b');
    expect(await removePlanAttachment(b.id)).toEqual({ error: 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.' });
  });
});
