import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, file, formWith, lastLog, freshDemoDatabase } from '../helpers';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import {
  addQualificationFiles, archiveTitle, cancelQualification, reinstatePerson, removeQualificationFile, restoreTitle, saveQualification,
  savePerson, saveTitle, setPersonLeft, setRequirement,
} from '@/server/skills';
import { loadSkillData, loadSkillMatrix } from '@/lib/data/skills';

// Recette des server actions des habilitations et formations jamais exécutées jusqu'ici (QUA-05) : formations
// (création, correction, annulation, attestations), exigences, personnel (sortie, réintégration), titres suivis.
// Plan d'actions (réponses du service QHSE du 15/10/2026) : aucune formation ni aucun recyclage ne donne lieu à une action
// QSE ; le jeu neuf n'en contient plus (ancienne A-207). Une action de recyclage d'une base reprise (A-907, source « à
// compléter », origine historique skills) est simulée ici : jamais modifiée par l'écran, elle protège le rattachement de
// l'exigence tant qu'elle n'est pas close (Terminée comprise). Jeu de démonstration au 09/10/2026.

const uploads = freshDemoDatabase();

const db = () => getDb();
const action = async (id: string) => (await (await db()).select().from(t.actions).where(eq(t.actions.id, id)))[0];

/** Action de recyclage reprise (base mise à niveau par 0005) rattachée à l'exigence de la case. */
async function legacyRenewal(id: string, personId: string, titleId: string, status: 'a_faire' | 'terminee' | 'verifiee' = 'a_faire') {
  const db_ = await db();
  await db_.insert(t.actions).values({
    id, openedOn: '2026-09-01', pilotId: 'clefevre', status, dueOn: '2026-10-20', initialDueOn: '2026-10-20', source: null,
    originRef: `Habilitations · ${personId}`, detail: `Recyclage ${titleId} — ${personId}`, siteId: 'ville-a', legacyOrigin: 'skills',
    doneOn: status === 'a_faire' ? null : '2026-10-01', closedOn: status === 'verifiee' ? '2026-10-05' : null,
    qualificationPersonId: personId, qualificationTitleId: titleId,
  });
  await db_.insert(t.qualificationRequirements).values({ personId, titleId }).onConflictDoNothing();
}
/** Action de recyclage reprise de la case (HAB-04 : portée par l'action). */
const renewalOf = async (personId: string, titleId: string) =>
  (await (await db()).select({ id: t.actions.id }).from(t.actions)
    .where(and(eq(t.actions.qualificationPersonId, personId), eq(t.actions.qualificationTitleId, titleId)))).map((a) => a.id);
const quals = async (personId: string, titleId: string) =>
  (await db()).select().from(t.qualifications).where(and(eq(t.qualifications.personId, personId), eq(t.qualifications.titleId, titleId)));
const requirement = async (personId: string, titleId: string) =>
  (await (await db()).select().from(t.qualificationRequirements)
    .where(and(eq(t.qualificationRequirements.personId, personId), eq(t.qualificationRequirements.titleId, titleId))))[0];
const person = async (id: string) => (await (await db()).select().from(t.people).where(eq(t.people.id, id)))[0];
const qualFiles = async (id: number) => (await db()).select().from(t.attachments)
  .where(and(eq(t.attachments.entityType, 'qualification'), eq(t.attachments.entityId, String(id))));

const DENIED = 'Votre rôle ne permet pas cette modification.';

describe('droits : écran « Habilitations et formations » modifiable', () => {
  it('Salarié et Chef de projet (écran fermé) ne modifient rien ; Chef de service oui', async () => {
    for (const role of ['Salarié', 'Chef de projet'] as const) {
      actAs(role);
      expect(await saveQualification({}, form({ personId: 'tnguyen', titleId: 'sst', obtainedOn: '2026-10-01' }))).toEqual({ error: DENIED });
      expect(await setRequirement('kbernard', 'r484', true)).toEqual({ error: DENIED });
      expect(await savePerson({}, form({ name: 'X', siteId: 'ville-a' }))).toEqual({ error: DENIED });
      expect(await saveTitle({}, form({ label: 'Échafaudage', validityMonths: '6' }))).toEqual({ error: DENIED });
      expect(await archiveTitle({}, form({ id: 'sst', reason: 'Test' }))).toEqual({ error: DENIED });
      expect(await reinstatePerson({}, form({ id: 'ylambert', reason: 'Retour' }))).toEqual({ error: DENIED });
    }
    expect(await requirement('kbernard', 'r484')).toBeUndefined();
    actAs('Chef de service');
    expect(await setRequirement('kbernard', 'r484', true)).toEqual({});
    expect(await requirement('kbernard', 'r484')).toMatchObject({ personId: 'kbernard', titleId: 'r484' });
    expect(await setRequirement('kbernard', 'r484', false)).toEqual({});
    expect(await requirement('kbernard', 'r484')).toBeUndefined();
  });

  it('salarié d’un autre site que celui sélectionné : refusé', async () => {
    actAs('Chef de service', 'ville-b');
    expect(await setRequirement('tnguyen', 'r484', true)).toEqual({ error: 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.' });
    expect(await saveQualification({}, form({ personId: 'tnguyen', titleId: 'sst', obtainedOn: '2026-10-01' })))
      .toEqual({ error: 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.' });
  });
});

describe('saveQualification : enregistrer une formation', () => {
  it('contrôles : obtention jamais future, échéance après l’obtention, salarié et titre connus et actifs', async () => {
    actAs('Animateur QHSE');
    expect(await saveQualification({}, form({ personId: 'tnguyen', titleId: 'sst', obtainedOn: '2026-10-10' })))
      .toMatchObject({ fieldErrors: { obtainedOn: "La date d'obtention ne peut pas être postérieure à aujourd'hui." } });
    expect(await saveQualification({}, form({ personId: 'tnguyen', titleId: 'sst', obtainedOn: '2026-10-01', expiresOn: '2026-10-01' })))
      .toMatchObject({ fieldErrors: { expiresOn: "L'échéance doit suivre la date d'obtention." } });
    expect(await saveQualification({}, form({ personId: 'inconnu', titleId: 'sst', obtainedOn: '2026-10-01' }))).toMatchObject({ error: 'Salarié introuvable.' });
    expect(await saveQualification({}, form({ personId: 'tnguyen', titleId: 'pont-ancien', obtainedOn: '2026-10-01' }))).toMatchObject({ error: 'Titre archivé.' });
    expect(await saveQualification({}, form({ personId: 'ylambert', titleId: 'sst', obtainedOn: '2026-10-01' }))).toMatchObject({ error: "Salarié sorti de l'effectif." });
  });

  it('recyclage réalisé : échéance calculée, historique, attestation ; action de recyclage reprise jamais modifiée', async () => {
    actAs('Animateur QHSE');
    await legacyRenewal('A-907', 'mgirard', 'elec');
    const stored = await action('A-907');
    const actionLog = (await changeLog('action', 'A-907')).length;
    const before = (await quals('mgirard', 'elec')).length;
    // Un ancien formulaire qui posterait encore « closeRenewal » ne change rien.
    const r = await saveQualification({}, formWith(
      { personId: 'mgirard', titleId: 'elec', obtainedOn: '2026-10-05', provider: '[Apave]', closeRenewal: 'on' },
      { files: [file('attestation.pdf')] },
    ));
    expect(r).toMatchObject({ ok: true, id: expect.stringMatching(/^\d+$/) });
    const id = Number(r.id);
    const list = await quals('mgirard', 'elec');
    expect(list).toHaveLength(before + 1); // jamais écrasée
    expect(list.find((q) => q.id === id)).toMatchObject({ obtainedOn: '2026-10-05', expiresOn: '2029-10-05', provider: '[Apave]', recordedById: 'clefevre', cancelledAt: null });
    // Création, puis attestation jointe (HAB-03 : chaque fichier journalisé sur la formation).
    expect((await changeLog('qualification', id)).map(({ action, summary, byId }) => ({ action, summary, byId }))).toEqual([
      { action: 'create', summary: 'Formation du 05/10/2026 (échéance 05/10/2029) enregistrée', byId: 'clefevre' },
      { action: 'attach', summary: 'Attestation jointe', byId: 'clefevre' },
    ]);
    expect(await action('A-907')).toEqual(stored);
    expect(await changeLog('action', 'A-907')).toHaveLength(actionLog);
    expect(await renewalOf('mgirard', 'elec')).toEqual(['A-907']);
    // Matrice : action reprise affichée en consultation seule (libellé, avancement), encore à réaliser.
    const cell = (await loadSkillData()).rows.find((x) => x.person.id === 'mgirard')?.cells.find((c) => c.title.id === 'elec');
    expect(cell?.renewal).toMatchObject({ id: 'A-907', label: 'Recyclage elec — mgirard', statusLabel: 'À faire', planned: true });
    const [att] = await qualFiles(id);
    expect(att).toMatchObject({ fileName: 'attestation.pdf', uploadedBy: 'clefevre' });
    expect(existsSync(path.join(uploads, att.storagePath))).toBe(true);

    // Correction de la saisie (même case) : la ligne est mise à jour, la correction journalisée.
    const fixed = await saveQualification({}, form({ qualificationId: String(id), personId: 'mgirard', titleId: 'elec', obtainedOn: '2026-10-06', expiresOn: '' }));
    expect(fixed).toEqual({ ok: true, id: String(id) });
    expect((await quals('mgirard', 'elec')).find((q) => q.id === id)).toMatchObject({ obtainedOn: '2026-10-06', expiresOn: '2029-10-06' });
    expect(await lastLog('qualification', id)).toMatchObject({ action: 'update', summary: 'Formation du 06/10/2026 (échéance 06/10/2029) corrigée' });
    expect(await saveQualification({}, form({ qualificationId: String(id), personId: 'tnguyen', titleId: 'elec', obtainedOn: '2026-10-06' }))).toEqual({ error: 'Formation introuvable.' });
  });

  it('aucune action créée par l’enregistrement d’une formation (recyclages hors actions QSE)', async () => {
    actAs('Animateur QHSE');
    const count = async () => (await (await db()).select({ id: t.actions.id }).from(t.actions)).length;
    const n = await count();
    const r = await saveQualification({}, form({ personId: 'tnguyen', titleId: 'hauteur', obtainedOn: '2026-10-08', expiresOn: '2026-10-15' }));
    expect(r.ok).toBe(true);
    expect(await count()).toBe(n);
  });

  it('échéance bornée au mois d’arrivée (QUA-07) : 31/08 + 6 mois = 28/02', async () => {
    actAs('Animateur QHSE');
    expect(await saveTitle({}, form({ label: 'Échafaudage roulant', validityMonths: '6' }))).toEqual({ ok: true, id: 'echafaudage-roulant' });
    const r = await saveQualification({}, form({ personId: 'proux', titleId: 'echafaudage-roulant', obtainedOn: '2026-08-31' }));
    expect(r.ok).toBe(true);
    const [q] = await quals('proux', 'echafaudage-roulant');
    expect(q.expiresOn).toBe('2027-02-28');
    // Le titre devient requis pour le salarié.
    expect(await requirement('proux', 'echafaudage-roulant')).toBeDefined();
  });
});

describe('action de recyclage reprise : lisible selon canReadAction (Integration, 15/10/2026)', () => {
  it('Salarié : numéro seul pour l’action d’un autre responsable ; décrite quand il en est responsable', async () => {
    actAs('Animateur QHSE');
    await legacyRenewal('A-909', 'tnguyen', 'elec');
    actAs('Salarié');
    const cellOf = async () => (await loadSkillMatrix()).rows.find((x) => x.person.id === 'tnguyen')?.cells.find((c) => c.title.id === 'elec');
    expect((await cellOf())?.renewal).toEqual({
      id: 'A-909', label: '', dueOn: '', status: '', statusLabel: 'Action QSE reprise', tone: 'neutral', pilot: '', planned: true, readable: false,
    });
    await (await db()).update(t.actions).set({ pilotId: 'tnguyen' }).where(eq(t.actions.id, 'A-909'));
    expect((await cellOf())?.renewal).toMatchObject({ id: 'A-909', label: 'Recyclage elec — tnguyen', statusLabel: 'À faire', readable: true });
    // Le QHSE lit toujours l'action (plan de son périmètre).
    actAs('Animateur QHSE');
    const qhse = (await loadSkillData()).rows.find((x) => x.person.id === 'tnguyen')?.cells.find((c) => c.title.id === 'elec');
    expect(qhse?.renewal).toMatchObject({ id: 'A-909', readable: true });
    // Close pour la suite du fichier (archivage du titre « elec »).
    await (await db()).update(t.actions).set({ status: 'abandonnee' }).where(eq(t.actions.id, 'A-909'));
  });
});

describe('cancelQualification et attestations', () => {
  it('annulation : motif obligatoire, conservée et journalisée, puis figée', async () => {
    actAs('Chef de service');
    const r = await saveQualification({}, form({ personId: 'rfontaine', titleId: 'sst', obtainedOn: '2026-10-02' }));
    const id = Number(r.id);
    expect(await addQualificationFiles(formWith({ qualificationId: String(id) }, { files: [file('a.pdf'), file('b.png', 'image/png')] }))).toEqual({ count: 2 });
    const [fa, fb] = await qualFiles(id);
    expect(await removeQualificationFile(fa.id)).toEqual({});
    expect((await qualFiles(id)).map((f) => f.id)).toEqual([fb.id]);
    expect(await addQualificationFiles(formWith({ qualificationId: String(id) }))).toEqual({ error: 'Choisissez au moins un fichier.' });

    expect(await cancelQualification({}, form({ id: String(id), reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await cancelQualification({}, form({ id: String(id), reason: 'Saisie sur le mauvais titre' }))).toEqual({ ok: true });
    const [q] = (await quals('rfontaine', 'sst')).filter((x) => x.id === id);
    expect(q).toMatchObject({ cancelledById: 'sbenali', cancelReason: 'Saisie sur le mauvais titre' });
    expect(q.cancelledAt).toBeInstanceOf(Date);
    expect(await lastLog('qualification', id)).toMatchObject({ action: 'cancel', reason: 'Saisie sur le mauvais titre', summary: 'Formation du 02/10/2026 annulée', byId: 'sbenali' });
    expect(await cancelQualification({}, form({ id: String(id), reason: 'Encore' }))).toEqual({ error: 'Cette formation est déjà annulée.' });
    expect(await addQualificationFiles(formWith({ qualificationId: String(id) }, { files: [file()] }))).toEqual({ error: 'Formation annulée : ajout impossible.' });
    expect(await removeQualificationFile(fb.id)).toEqual({ error: 'Formation annulée : ses attestations sont conservées.' });
    expect(await saveQualification({}, form({ qualificationId: String(id), personId: 'rfontaine', titleId: 'sst', obtainedOn: '2026-10-03' })))
      .toEqual({ error: 'Formation annulée : elle ne peut plus être corrigée.' });
  });
});

describe('setRequirement : titre requis pour un salarié', () => {
  it('retrait refusé tant que le recyclage repris n’est pas clos (Terminée comprise) ; titre archivé, salarié sorti', async () => {
    actAs('Animateur QHSE');
    const refused = "L'action A-907 (recyclage) n'est pas close : le service QHSE doit la clôturer ou l'abandonner avant le retrait de l'exigence.";
    expect(await setRequirement('mgirard', 'elec', false)).toEqual({ error: refused });
    await (await db()).update(t.actions).set({ status: 'terminee', doneOn: '2026-10-06' }).where(eq(t.actions.id, 'A-907'));
    expect(await setRequirement('mgirard', 'elec', false)).toEqual({ error: refused });
    const cell = (await loadSkillData()).rows.find((x) => x.person.id === 'mgirard')?.cells.find((c) => c.title.id === 'elec');
    expect(cell?.renewal).toMatchObject({ id: 'A-907', planned: false });
    expect(await requirement('mgirard', 'elec')).toBeDefined();
    // Recyclage vérifié (clos) : le retrait est permis.
    await legacyRenewal('A-908', 'kbernard', 'sst', 'verifiee');
    expect(await renewalOf('kbernard', 'sst')).toEqual(['A-908']);
    expect(await setRequirement('kbernard', 'sst', false)).toEqual({});
    expect(await requirement('kbernard', 'sst')).toBeUndefined();
    // HAB-04 : le recyclage clos garde son lien vers la case, listé parmi les recyclages précédents.
    expect(await renewalOf('kbernard', 'sst')).toEqual(['A-908']);
    const past = (await loadSkillData()).rows.find((x) => x.person.id === 'kbernard')?.cells.find((c) => c.title.id === 'sst');
    expect(past).toMatchObject({ required: false, renewal: null, pastRenewals: [expect.objectContaining({ id: 'A-908', readable: true, planned: false })] });
    expect(await setRequirement('tnguyen', 'pont-ancien', true)).toEqual({ error: 'Titre archivé : restaurez-le pour modifier ses exigences.' });
    expect(await setRequirement('ylambert', 'sst', true)).toEqual({ error: "Salarié sorti de l'effectif." });
    expect(await setRequirement('inconnu', 'sst', true)).toEqual({ error: 'Salarié ou titre introuvable.' });
  });
});

describe('personnel : sortie de l’effectif et réintégration', () => {
  it('sortie refusée tant qu’un recyclage est ouvert ; date et motif obligatoires', async () => {
    actAs('Animateur QHSE');
    expect(await setPersonLeft({}, form({ id: 'mgirard', leftOn: '2026-10-09', leftReason: 'Démission' }))).toEqual({
      error: 'Recyclage encore ouvert (A-907) : le service QHSE doit clôturer ou abandonner ces actions avant la déclaration de sortie.',
    });
    // QUA-22 (changement volontaire) : message commun des motifs.
    expect(await setPersonLeft({}, form({ id: 'lmoreau', leftOn: '', leftReason: '' }))).toMatchObject({ fieldErrors: { leftOn: 'Date obligatoire.', leftReason: 'Motif obligatoire.' } });
    expect(await setPersonLeft({}, form({ id: 'lmoreau', leftOn: '2025-10-01', leftReason: 'Démission' })))
      .toMatchObject({ fieldErrors: { leftOn: "La date de sortie ne peut pas remonter à plus d'un an." } });
  });
  it('sortie puis réintégration, journalisées ; fiche figée pendant la sortie', async () => {
    actAs('Animateur QHSE');
    expect(await setPersonLeft({}, form({ id: 'lmoreau', leftOn: '2026-10-09', leftReason: 'Mutation dans une autre filiale' }))).toEqual({ ok: true, id: 'lmoreau' });
    expect(await person('lmoreau')).toMatchObject({ leftOn: '2026-10-09', leftReason: 'Mutation dans une autre filiale' });
    expect(await lastLog('person', 'lmoreau')).toMatchObject({ action: 'archive', summary: "Sortie de l'effectif le 09/10/2026", reason: 'Mutation dans une autre filiale', byId: 'clefevre' });
    expect(await setPersonLeft({}, form({ id: 'lmoreau', leftOn: '2026-10-09', leftReason: 'x' }))).toEqual({ error: "Salarié déjà sorti de l'effectif." });
    expect(await savePerson({}, form({ id: 'lmoreau', name: '[L. Moreau]', siteId: 'ville-a' }))).toEqual({ error: "Salarié sorti de l'effectif : réintégrez-le pour modifier sa fiche." });
    expect(await setRequirement('lmoreau', 'sst', false)).toEqual({ error: "Salarié sorti de l'effectif." });

    expect(await reinstatePerson({}, form({ id: 'lmoreau', reason: 'Sortie annulée' }))).toEqual({ ok: true, id: 'lmoreau' });
    expect(await person('lmoreau')).toMatchObject({ leftOn: null, leftReason: null });
    expect(await lastLog('person', 'lmoreau')).toMatchObject({ action: 'restore', summary: 'Salarié réintégré' });
    expect(await reinstatePerson({}, form({ id: 'lmoreau', reason: 'Encore' }))).toEqual({ error: 'Aucune sortie déclarée pour ce salarié.' });
  });
  it('modification de fiche : changement de site, journal ; e-mail et matricule absents du formulaire inchangés', async () => {
    actAs('Animateur QHSE', 'all');
    const db_ = await db();
    await db_.update(t.people).set({ matricule: 'M-0042' }).where(eq(t.people.id, 'rfontaine'));
    expect(await savePerson({}, form({ id: 'rfontaine', name: '[R. Fontaine]', job: 'Magasinier cariste', service: 'Magasin', siteId: 'ville-b' }))).toEqual({ ok: true, id: 'rfontaine' });
    expect(await person('rfontaine')).toMatchObject({ siteId: 'ville-b', job: 'Magasinier cariste', email: 'r.fontaine@epc2i.example', matricule: 'M-0042' });
    expect(await lastLog('person', 'rfontaine')).toMatchObject({ action: 'update', summary: 'Fiche salarié modifiée' });
    expect(await savePerson({}, form({ id: 'rfontaine', name: '[R. Fontaine]', siteId: 'inconnu' }))).toMatchObject({ fieldErrors: { siteId: 'Valeur non autorisée.' } });
  });
});

describe('titres suivis', () => {
  it('doublons refusés (casse et accents ignorés), titre archivé à restaurer', async () => {
    actAs('Animateur QHSE');
    expect(await saveTitle({}, form({ label: 'echafaudage ROULANT', validityMonths: '6' }))).toMatchObject({ fieldErrors: { label: 'Ce titre est déjà suivi.' } });
    expect(await saveTitle({}, form({ label: 'Pontier (ancien référentiel)', validityMonths: '60' }))).toMatchObject({ fieldErrors: { label: 'Ce titre existe déjà (archivé) : restaurez-le.' } });
    expect(await saveTitle({}, form({ id: 'pont-ancien', label: 'Pontier', validityMonths: '60' }))).toEqual({ error: 'Titre archivé : restaurez-le pour le modifier.' });
    expect(await saveTitle({}, form({ label: 'Titre', validityMonths: '300' }))).toMatchObject({ fieldErrors: { validityMonths: 'Maximum 240.' } });
    expect(await saveTitle({}, form({ id: 'echafaudage-roulant', label: 'Échafaudage roulant (R457)', validityMonths: '12' }))).toEqual({ ok: true, id: 'echafaudage-roulant' });
    expect(await lastLog('training_title', 'echafaudage-roulant')).toMatchObject({ action: 'update', summary: 'Titre « Échafaudage roulant (R457) » modifié' });
  });
  it('archivage : motif obligatoire, refusé avec un recyclage ouvert ; restauration', async () => {
    actAs('Animateur QHSE');
    expect(await archiveTitle({}, form({ id: 'elec', reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await archiveTitle({}, form({ id: 'elec', reason: 'Plus suivi' }))).toEqual({
      error: "Recyclage encore ouvert (A-907) : le service QHSE doit clôturer ou abandonner ces actions avant l'archivage du titre.",
    });
    expect(await archiveTitle({}, form({ id: 'echafaudage-roulant', reason: 'Plus d’échafaudage sur site' }))).toEqual({ ok: true, id: 'echafaudage-roulant' });
    const [ti] = await (await db()).select().from(t.trainingTitles).where(eq(t.trainingTitles.id, 'echafaudage-roulant'));
    expect(ti).toMatchObject({ archivedById: 'clefevre', archiveReason: 'Plus d’échafaudage sur site' });
    expect(await archiveTitle({}, form({ id: 'echafaudage-roulant', reason: 'Encore' }))).toEqual({ error: 'Ce titre est déjà archivé.' });
    // Historique figé pendant l'archivage.
    const [q] = await quals('proux', 'echafaudage-roulant');
    expect(await cancelQualification({}, form({ id: String(q.id), reason: 'Test' }))).toEqual({ error: 'Titre archivé : restaurez-le pour modifier ses formations.' });
    // QUA-22 (changement volontaire) : restauration avec motif, inscrit au journal.
    expect(await restoreTitle({}, form({ id: 'echafaudage-roulant', reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await restoreTitle({}, form({ id: 'echafaudage-roulant', reason: 'Échafaudage de nouveau utilisé' }))).toEqual({ ok: true, id: 'echafaudage-roulant' });
    expect(await lastLog('training_title', 'echafaudage-roulant')).toMatchObject({ action: 'restore', reason: 'Échafaudage de nouveau utilisé' });
    expect((await changeLog('training_title', 'echafaudage-roulant')).map((l) => l.action)).toEqual(['create', 'update', 'archive', 'restore']);
  });
});
