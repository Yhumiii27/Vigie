import '../next-mocks';
import { describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { form } from '../next-mocks';
import { actAs, changeLog, file, formWith, freshDemoDatabase, lastLog } from '../helpers';
import { getDb, schema as t } from '@/db';
import { loadEnvironment } from '@/lib/data/environment';
import { loadReviewCard, loadReviewDossierPage, loadReviewSignals } from '@/lib/data/review';
import { loadSkillMatrix } from '@/lib/data/skills';
import { loadWatch } from '@/lib/data/watch';
import type { Role } from '@/lib/domain';
import { cancelFinding, restoreFinding, savePlanItem, saveFinding } from '@/server/audits';
import { addEntityFiles } from '@/server/entity-files';
import { saveWasteEntry } from '@/server/environment';
import { linkAction } from '@/server/links';
import {
  abandonReviewDecision, addReviewCorrection, createReview, deleteReviewDecision, saveReviewDecision, saveReviewItem,
} from '@/server/review';
import { createDuerpVersion, updateCurrentDuerpVersion } from '@/server/risks';
import { archiveTitle, restoreTitle, saveTitle } from '@/server/skills';
import { cancelRequirementEvaluation } from '@/server/watch';

// Paquet 12 (cohérence, droits et traçabilité) : rattachement de deux risques au même danger tracé (DUE-12), validateur
// sorti de l'effectif (DUE-15), titres suivis réservés au QHSE (HAB-12), vue Salarié indépendante du site (HAB-14),
// annulation d'une évaluation de veille (VEI-16), règle « revue de direction » (AUD-23), constat rétabli (AUD-25), dates et
// doublons de la revue (AUD-31), rectificatif d'une revue clôturée (AUD-34), décision abandonnée ou reformulée (AUD-36),
// filières d'un site archivé (DOC-20). Server actions : droits, site, motif et journal.

freshDemoDatabase();

const db = () => getDb();
const DENIED = 'Votre rôle ne permet pas cette modification.';
const APPROVERS_ONLY = "Réservé à l'animateur QHSE et à la direction.";
const SIGNER_ONLY = 'Visa réservé à la direction.';
const TITLES_RESERVED = "Titres suivis communs à tous les sites : réservés à l'animateur QHSE et à la direction.";

async function reviewOn(date: string) {
  const [r] = await (await db()).select().from(t.reviews).where(eq(t.reviews.reviewOn, date));
  if (!r) throw new Error(`revue du ${date} introuvable`);
  return r;
}

describe('DUE-12 : deux risques au même danger de la même unité', () => {
  it('le rattachement au second risque est journalisé sur l’action et le risque', async () => {
    const d = await db();
    const [risk] = await d.select().from(t.risks).where(eq(t.risks.id, 3));
    const copy: Partial<typeof risk> = { ...risk };
    delete copy.id;
    const [twin] = await d.insert(t.risks).values({ ...(copy as typeof risk), situation: `${risk.situation} (second poste)` }).returning({ id: t.risks.id });
    actAs('Animateur QHSE', 'ville-a');
    expect(await linkAction('risk:3', 'A-215')).toEqual({});
    const before = (await changeLog('action', 'A-215')).length;
    expect(await linkAction(`risk:${twin.id}`, 'A-215')).toEqual({});
    const logs = await changeLog('action', 'A-215');
    expect(logs.length).toBe(before + 1);
    expect(logs.at(-1)).toMatchObject({ action: 'link', summary: expect.stringContaining(risk.hazard) });
    expect(await lastLog('risk', twin.id)).toMatchObject({ action: 'link', summary: 'Action A-215 rattachée' });
  });
});

describe('DUE-15 : validateur de la version du DUERP sorti de l’effectif', () => {
  const versionForm = (fields: Record<string, string>) => form({ version: '2026.1', cseConsultedOn: '2026-03-20', comment: '', ...fields });
  it('conservé à la modification de la version ; jamais choisi à nouveau ni pour une nouvelle version', async () => {
    actAs('Animateur QHSE', 'all');
    expect(await updateCurrentDuerpVersion({}, versionForm({ validatedById: 'lmoreau' }))).toEqual({ ok: true, id: '2026.1' });
    await (await db()).update(t.people).set({ leftOn: '2026-10-01', leftReason: 'Mutation' }).where(eq(t.people.id, 'lmoreau'));
    // Validateur enregistré, sorti depuis : la version se complète sans le remplacer.
    expect(await updateCurrentDuerpVersion({}, versionForm({ validatedById: 'lmoreau', comment: 'Complément' }))).toEqual({ ok: true, id: '2026.1' });
    // Autre personne sortie : refusée, à la modification comme à la création.
    const left = { fieldErrors: { validatedById: "Personne sortie de l'effectif : choisissez un validateur présent." } };
    expect(await updateCurrentDuerpVersion({}, versionForm({ validatedById: 'ylambert' }))).toMatchObject(left);
    expect(await createDuerpVersion({}, form({ version: '2026.2', validatedById: 'lmoreau' }))).toMatchObject(left);
    const [v] = await (await db()).select().from(t.duerpVersions).where(eq(t.duerpVersions.version, '2026.1'));
    expect(v).toMatchObject({ current: true, validatedById: 'lmoreau', comment: 'Complément' });
    await (await db()).update(t.people).set({ leftOn: null, leftReason: null }).where(eq(t.people.id, 'lmoreau'));
  });
});

describe('HAB-12 : titres suivis communs à tous les sites', () => {
  it('Chef de service : ajout, modification, archivage et restauration refusés ; QHSE et direction oui', async () => {
    actAs('Chef de service', 'ville-a');
    expect(await saveTitle({}, form({ label: 'Nacelle', validityMonths: '60' }))).toEqual({ error: TITLES_RESERVED });
    expect(await saveTitle({}, form({ id: 'sst', label: 'SST renommé', validityMonths: '24' }))).toEqual({ error: TITLES_RESERVED });
    expect(await archiveTitle({}, form({ id: 'sst', reason: 'Test' }))).toEqual({ error: TITLES_RESERVED });
    expect(await restoreTitle({}, form({ id: 'pont-ancien', reason: 'Test' }))).toEqual({ error: TITLES_RESERVED });
    for (const role of ['Chef de projet', 'Salarié'] as Role[]) {
      actAs(role, 'ville-a');
      expect(await saveTitle({}, form({ label: 'Nacelle', validityMonths: '60' })), role).toEqual({ error: DENIED });
    }
    const [sst] = await (await db()).select().from(t.trainingTitles).where(eq(t.trainingTitles.id, 'sst'));
    expect(sst.archivedAt).toBeNull();
    expect(sst.label).not.toBe('SST renommé');
    for (const role of ['Animateur QHSE', 'Direction'] as Role[]) {
      actAs(role, 'ville-b');
      const r = await saveTitle({}, form({ label: `Nacelle ${role}`, validityMonths: '60' }));
      expect(r, role).toMatchObject({ ok: true });
      expect(await lastLog('training_title', r.id!)).toMatchObject({ action: 'create' });
    }
  });
});

describe('HAB-14 : vue Salarié indépendante du site sélectionné', () => {
  it('sa ligne sur chaque site sélectionné, et rien d’autre', async () => {
    const [me] = await (await db()).select().from(t.people).where(eq(t.people.id, 'tnguyen'));
    for (const site of ['ville-a', 'ville-b', 'all']) {
      actAs('Salarié', site);
      const m = await loadSkillMatrix();
      expect(m.self).toBe(true);
      expect(m.rows.map((r) => r.person.id), site).toEqual(['tnguyen']);
      expect([m.others, m.departed]).toEqual([[], []]);
      expect(m.archive.every((a) => a.person.id === 'tnguyen')).toBe(true);
    }
    expect(me.siteId).toBeTruthy();
    // L'encadrement reste filtré par le site sélectionné.
    actAs('Chef de service', me.siteId === 'ville-a' ? 'ville-b' : 'ville-a');
    expect((await loadSkillMatrix()).rows.some((r) => r.person.id === 'tnguyen')).toBe(false);
  });
});

describe('VEI-16 : annulation d’une évaluation de veille saisie par erreur', () => {
  it('droits, motif, journal ; évaluation courante recalculée ; preuves figées', async () => {
    const d = await db();
    const [wrong] = await d.select().from(t.requirementEvaluations).where(eq(t.requirementEvaluations.note, 'VGP pont roulant dépassée'));
    const reqId = wrong.requirementId;
    const history = await d.select().from(t.requirementEvaluations).where(eq(t.requirementEvaluations.requirementId, reqId));
    const earlier = history.find((e) => e.id !== wrong.id)!;
    for (const role of ['Chef de service', 'Chef de projet', 'Salarié'] as Role[]) {
      actAs(role, 'ville-a');
      expect(await cancelRequirementEvaluation({}, form({ id: String(wrong.id), reason: 'Erreur' })), role).toEqual({ error: APPROVERS_ONLY });
    }
    actAs('Animateur QHSE', 'all');
    expect(await cancelRequirementEvaluation({}, form({ id: String(wrong.id), reason: ' ' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await cancelRequirementEvaluation({}, form({ id: String(wrong.id), reason: 'Saisie sur la mauvaise exigence' }))).toEqual({ ok: true, id: String(reqId) });
    const [req] = await d.select().from(t.requirements).where(eq(t.requirements.id, reqId));
    expect(req).toMatchObject({ evaluation: earlier.evaluation, evaluationNote: earlier.note, lastEvaluatedOn: earlier.evaluatedOn });
    const [row] = await d.select().from(t.requirementEvaluations).where(eq(t.requirementEvaluations.id, wrong.id));
    expect(row).toMatchObject({ cancelledById: 'clefevre', cancelReason: 'Saisie sur la mauvaise exigence' });
    expect(await lastLog('requirement', reqId)).toMatchObject({
      action: 'cancel', reason: 'Saisie sur la mauvaise exigence', byId: 'clefevre', summary: expect.stringMatching(/^Évaluation « .+ » du \d{2}\/\d{2}\/\d{4} annulée$/),
      details: expect.arrayContaining([expect.objectContaining({ field: 'Évaluation' })]),
    });
    expect(await cancelRequirementEvaluation({}, form({ id: String(wrong.id), reason: 'Encore' }))).toEqual({ error: 'Évaluation déjà annulée.' });
    // Preuves d'une évaluation annulée : figées.
    expect(await addEntityFiles(formWith({ kind: 'requirement_evaluation', entityId: String(wrong.id) }, { files: [file()] })))
      .toEqual({ error: 'Évaluation annulée : ses preuves sont conservées telles quelles.' });
    // Historique : l'évaluation annulée reste listée, avec son motif.
    const view = (await loadWatch()).requirements.find((r) => r.id === reqId)!;
    expect(view.evaluations.find((e) => e.id === wrong.id)?.cancelled).toMatchObject({ reason: 'Saisie sur la mauvaise exigence' });
    expect(view.evaluation).toBe(earlier.evaluation);
    // Dernière évaluation annulée à son tour : « À évaluer », sans date.
    expect(await cancelRequirementEvaluation({}, form({ id: String(earlier.id), reason: 'Doublon de reprise' }))).toMatchObject({ ok: true });
    const [after] = await d.select().from(t.requirements).where(eq(t.requirements.id, reqId));
    expect(after).toMatchObject({ evaluation: 'a_evaluer', evaluationNote: null, lastEvaluatedOn: null });
  });
});

describe('AUD-23 : règle « revue de direction »', () => {
  it('une ligne « Revues de contrat » reste un audit : auditeur conservé, constats admis', async () => {
    actAs('Animateur QHSE', 'all');
    const r = await savePlanItem({}, form({ year: '2026', track: 'Revues de contrat', month: '9', label: 'Contrat A', detail: 'Revue de contrat client', auditor: '[A. Auditeur]', done: 'on', doneOn: '2026-09-15' }));
    expect(r).toMatchObject({ ok: true });
    const [item] = await (await db()).select().from(t.auditPlanItems).where(eq(t.auditPlanItems.id, +r.id!));
    expect(item).toMatchObject({ track: 'Revues de contrat', auditor: '[A. Auditeur]', reviewId: null });
    expect(await saveFinding({}, form({ planItemId: r.id!, kind: 'piste', text: 'Clause de pénalités à revoir' }))).toMatchObject({ ok: true });
  });
});

describe('AUD-25 : rétablir un constat annulé', () => {
  it('droits, motif, journal du constat et de ses actions ; déjà en vigueur refusé', async () => {
    const d = await db();
    const [link] = await d.select().from(t.findingActions).limit(1);
    const id = String(link.findingId);
    actAs('Animateur QHSE', 'all');
    expect(await cancelFinding({}, form({ id, reason: 'Doublon supposé' }))).toEqual({ ok: true, id });
    for (const role of ['Chef de service', 'Chef de projet', 'Salarié'] as Role[]) {
      actAs(role, 'ville-a');
      expect(await restoreFinding({}, form({ id, reason: 'Erreur' })), role).toEqual({ error: DENIED });
    }
    actAs('Animateur QHSE', 'all');
    expect(await restoreFinding({}, form({ id, reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await restoreFinding({}, form({ id, reason: 'Constat bien présent au rapport' }))).toEqual({ ok: true, id });
    const [f] = await d.select().from(t.auditFindings).where(eq(t.auditFindings.id, +id));
    expect(f).toMatchObject({ cancelledAt: null, cancelledById: null, cancelReason: null });
    expect(await lastLog('audit_finding', id)).toMatchObject({
      action: 'restore', reason: 'Constat bien présent au rapport', summary: 'Constat rétabli', byId: 'clefevre',
      details: [{ field: "Motif de l'annulation", from: 'Doublon supposé', to: null }],
    });
    expect(await lastLog('action', link.actionId)).toMatchObject({ action: 'update', summary: expect.stringContaining("Constat d'origine rétabli"), reason: 'Constat bien présent au rapport' });
    expect(await restoreFinding({}, form({ id, reason: 'Encore' }))).toEqual({ error: "Ce constat n'est pas annulé." });
    expect(await restoreFinding({}, form({ id: '99999', reason: 'x' }))).toEqual({ error: 'Constat introuvable.' });
  });
});

describe('AUD-31 : dates et doublons de la revue de direction', () => {
  it('une seule revue planifiée par type et par année', async () => {
    actAs('Animateur QHSE', 'all');
    expect(await createReview({}, form({ reviewOn: '2026-11-19', kind: 'ordinaire' }))).toMatchObject({
      error: 'La revue annuelle du 10/12/2026 est déjà planifiée en 2026 : reportez-la plutôt que d\'en planifier une seconde.',
      fieldErrors: { reviewOn: 'Revue de ce type déjà planifiée cette année.' },
    });
    expect(await createReview({}, form({ reviewOn: '2026-11-19', kind: 'intermediaire' }))).toMatchObject({ ok: true });
  });

  it('check-list : remise au plus tard à la séance, jamais passée, libellé unique ; date enregistrée gardée', async () => {
    actAs('Animateur QHSE', 'all');
    const annual = await reviewOn('2026-12-10');
    const add = (fields: Record<string, string>) => saveReviewItem({}, form({ reviewId: String(annual.id), source: 'manuel', ...fields }));
    expect(await add({ label: 'Bilan énergie', dueOn: '2026-12-15' })).toMatchObject({ fieldErrors: { dueOn: 'Remise attendue au plus tard le jour de la séance (10/12/2026).' } });
    expect(await add({ label: 'Bilan énergie', dueOn: '2026-10-01' })).toMatchObject({ fieldErrors: { dueOn: 'Date de remise déjà passée.' } });
    expect(await add({ label: ' performance des FOURNISSEURS', dueOn: '2026-11-15' })).toMatchObject({ fieldErrors: { label: 'Cet élément figure déjà dans la check-list de la revue.' } });
    expect(await add({ label: 'Bilan énergie', dueOn: '2026-11-15' })).toMatchObject({ ok: true });
    // Élément existant dont la date est déjà passée : modifiable sans changer sa date.
    const [late] = await (await db()).select().from(t.reviewItems)
      .where(and(eq(t.reviewItems.reviewId, annual.id), eq(t.reviewItems.label, "Retour d'expérience des visites sécurité")));
    expect(late.dueOn! < '2026-10-09').toBe(true);
    expect(await saveReviewItem({}, form({ id: String(late.id), label: "Retour d'expérience des visites sécurité (VS)", source: 'manuel', ownerId: late.ownerId ?? '', dueOn: late.dueOn! }))).toMatchObject({ ok: true });
  });
});

describe('AUD-36 : décision abandonnée ou reformulée après la séance', () => {
  it('reformulation : ancien libellé au journal ; échéance et doublon contrôlés ; abandon motivé, barré, hors visa et échéances', async () => {
    const d = await db();
    const [held] = await d.insert(t.reviews).values({
      reviewOn: '2026-10-01', kind: 'intermediaire', status: 'tenue', participantIds: ['hmarchand'], minutes: 'Séance', recordedById: 'clefevre',
    }).returning({ id: t.reviews.id });
    actAs('Animateur QHSE', 'all');
    const add = (fields: Record<string, string>) => saveReviewDecision({}, form({ reviewId: String(held.id), kind: 'decision', pilotId: 'clefevre', ...fields }));
    expect(await add({ text: 'Former les tuteurs', dueOn: '2026-09-15' })).toMatchObject({ fieldErrors: { dueOn: 'Échéance antérieure à la revue du 01/10/2026.' } });
    expect(await add({ text: 'Former les tuteurs', dueOn: '2026-10-05' })).toMatchObject({ fieldErrors: { dueOn: 'Échéance déjà passée.' } });
    const created = await add({ text: 'Former les tuteurs', dueOn: '2026-12-31' });
    expect(created).toMatchObject({ ok: true });
    expect(await add({ text: 'former les  tuteurs' })).toMatchObject({ fieldErrors: { text: 'Cette décision figure déjà dans la revue.' } });
    const id = created.id!;
    expect(await saveReviewDecision({}, form({ id, kind: 'decision', text: 'Former les tuteurs et les nouveaux arrivants', pilotId: 'clefevre', dueOn: '2026-12-31' }))).toEqual({ ok: true, id });
    expect(await lastLog('review', held.id)).toMatchObject({
      action: 'update', summary: expect.stringContaining('reformulé(e) après la séance'),
      details: [{ field: 'Intitulé', from: 'Former les tuteurs', to: 'Former les tuteurs et les nouveaux arrivants' }],
    });
    // Retrait refusé après la séance ; abandon : droits, motif, journal.
    expect(await deleteReviewDecision(+id)).toEqual({ error: expect.stringContaining('déclarez-les abandonnées') });
    for (const role of ['Chef de service', 'Chef de projet', 'Salarié'] as Role[]) {
      actAs(role, 'ville-a');
      expect(await abandonReviewDecision({}, form({ id, reason: 'x' })), role).toEqual({ error: DENIED });
    }
    actAs('Animateur QHSE', 'all');
    expect(await abandonReviewDecision({}, form({ id, reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await abandonReviewDecision({}, form({ id, reason: 'Reprise par le plan de formation RH' }))).toEqual({ ok: true, id });
    const [row] = await d.select().from(t.reviewDecisions).where(eq(t.reviewDecisions.id, +id));
    expect(row).toMatchObject({ cancelledById: 'clefevre', cancelReason: 'Reprise par le plan de formation RH', text: 'Former les tuteurs et les nouveaux arrivants' });
    expect(await lastLog('review', held.id)).toMatchObject({ action: 'cancel', reason: 'Reprise par le plan de formation RH', summary: expect.stringContaining('abandonné(e)') });
    expect(await abandonReviewDecision({}, form({ id, reason: 'Encore' }))).toEqual({ error: 'Décision déjà abandonnée.' });
    expect(await saveReviewDecision({}, form({ id, kind: 'decision', text: 'Autre', pilotId: 'clefevre' }))).toEqual({ error: 'Décision abandonnée : consultation seule.' });
    expect(await linkAction(`reviewdecision:${id}`, 'A-215')).toEqual({ error: 'Décision abandonnée : rattachement impossible.' });
    // Carte : barrée avec qui, quand, pourquoi ; une décision abandonnée sans pilote ne bloque pas le visa.
    await d.update(t.reviewDecisions).set({ pilotId: null }).where(eq(t.reviewDecisions.id, +id));
    const card = await loadReviewCard({ revue: String(held.id) });
    expect(card.decisions.find((x) => x.id === +id)?.cancelled).toMatchObject({ by: '[C. Lefèvre]', reason: 'Reprise par le plan de formation RH' });
    expect(card.flags.closeBlockers).toEqual([]);
  });

  it('revue clôturée : abandon réservé à la direction ; plus d’échéance « sans suite »', async () => {
    const d = await db();
    const closed = await reviewOn('2025-12-11');
    const [res] = await d.select().from(t.reviewDecisions).where(and(eq(t.reviewDecisions.reviewId, closed.id), eq(t.reviewDecisions.kind, 'ressource')));
    expect(res.actionId).toBeNull();
    actAs('Animateur QHSE', 'all');
    expect((await loadReviewSignals()).todo.some((x) => x.key === `revue-decision|${res.id}`)).toBe(true);
    expect(await abandonReviewDecision({}, form({ id: String(res.id), reason: 'Poste pourvu autrement' }))).toEqual({ error: 'Revue clôturée : abandon d’une décision réservé à la direction.' });
    // Décision portée par une action : abandonner d'abord l'action.
    const [carried] = await d.select().from(t.reviewDecisions).where(and(eq(t.reviewDecisions.reviewId, closed.id), eq(t.reviewDecisions.actionId, 'A-152')));
    actAs('Direction', 'all');
    expect(await abandonReviewDecision({}, form({ id: String(carried.id), reason: 'x' }))).toEqual({ error: "Décision portée par l'action A-152 : abandonnez d'abord l'action dans le plan d'actions." });
    expect(await abandonReviewDecision({}, form({ id: String(res.id), reason: 'Poste pourvu par mutation interne' }))).toEqual({ ok: true, id: String(res.id) });
    expect((await loadReviewSignals()).todo.some((x) => x.key === `revue-decision|${res.id}`)).toBe(false);
    // Projet de décision d'une revue planifiée : « Retirer », pas d'abandon.
    const annual = await reviewOn('2026-12-10');
    const draft = await saveReviewDecision({}, form({ reviewId: String(annual.id), kind: 'decision', text: 'Projet de décision' }));
    expect(await abandonReviewDecision({}, form({ id: draft.id!, reason: 'x' }))).toEqual({ error: 'Revue pas encore tenue : retirez le projet de décision.' });
  });
});

describe('AUD-34 : rectificatif d’une revue clôturée', () => {
  it('signé par la direction, ajouté au dossier et à l’historique ; dossier figé inchangé', async () => {
    const d = await db();
    const closed = await reviewOn('2026-06-18');
    const before = closed.snapshot;
    const fields = { id: String(closed.id), text: 'Participant omis : [L. Moreau] était présent.', reason: 'Relevé par le CSE' };
    for (const role of ['Animateur QHSE', 'Chef de service', 'Chef de projet', 'Salarié'] as Role[]) {
      actAs(role, 'all');
      const r = await addReviewCorrection({}, form(fields));
      expect(r, role).toEqual({ error: role === 'Animateur QHSE' ? SIGNER_ONLY : APPROVERS_ONLY });
    }
    actAs('Direction', 'all');
    expect(await addReviewCorrection({}, form({ ...fields, reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await addReviewCorrection({}, form({ ...fields, text: ' ' }))).toMatchObject({ fieldErrors: { text: 'Champ obligatoire.' } });
    const annual = await reviewOn('2026-12-10');
    expect(await addReviewCorrection({}, form({ ...fields, id: String(annual.id) }))).toEqual({ error: 'Seule une revue clôturée reçoit un rectificatif : avant le visa, corrigez le compte rendu.' });
    expect(await addReviewCorrection({}, form(fields))).toMatchObject({ ok: true });
    const rows = await d.select().from(t.reviewCorrections).where(eq(t.reviewCorrections.reviewId, closed.id));
    expect(rows).toEqual([expect.objectContaining({ text: fields.text, reason: fields.reason, signedById: 'hmarchand' })]);
    expect(await lastLog('review', closed.id)).toMatchObject({ action: 'correct', reason: 'Relevé par le CSE', byId: 'hmarchand', summary: expect.stringContaining('Rectificatif signé par') });
    const [after] = await d.select().from(t.reviews).where(eq(t.reviews.id, closed.id));
    expect(after).toMatchObject({ status: 'cloturee', closedOn: closed.closedOn, closedById: closed.closedById });
    expect(after.snapshot).toEqual(before);
    // Dossier et carte : le rectificatif est affiché.
    const page = await loadReviewDossierPage({ revue: String(closed.id) });
    expect('corrections' in page && page.corrections).toEqual([expect.objectContaining({ text: fields.text, reason: fields.reason, by: '[H. Marchand]' })]);
    expect((await loadReviewCard({ revue: String(closed.id) })).corrections).toHaveLength(1);
    // Ajout seulement : la table n'a ni modification ni retrait (aucune server action), un motif vide est refusé en base.
    await expect(d.insert(t.reviewCorrections).values({ reviewId: closed.id, text: 'x', reason: ' ' })).rejects.toThrow();
  });
});

describe('DOC-20 : filières d’un site archivé', () => {
  it('non proposées pour un nouvel enlèvement, refusées avec un message du champ', async () => {
    const d = await db();
    const [src] = await d.select().from(t.wasteStreams).where(eq(t.wasteStreams.id, 'FD-01'));
    await d.insert(t.wasteStreams).values({ ...src, id: 'FD-99', siteId: 'ville-c', label: 'Huiles (ancien dépôt)' });
    const [site] = await d.select({ archivedAt: t.sites.archivedAt }).from(t.sites).where(eq(t.sites.id, 'ville-c'));
    expect(site.archivedAt).not.toBeNull();
    actAs('Animateur QHSE', 'all');
    const env = await loadEnvironment();
    expect(env.streams.find((s) => s.id === 'FD-99')).toMatchObject({ siteArchived: true, archived: null });
    expect(env.streams.find((s) => s.id === 'FD-01')).toMatchObject({ siteArchived: false });
    expect(await saveWasteEntry({}, form({ streamId: 'FD-99', removedOn: '2026-10-01', quantity: '100' }))).toMatchObject({
      fieldErrors: { streamId: "Filière d'un site archivé : choisissez une filière d'un site en service." },
    });
    expect(await d.select().from(t.wasteEntries).where(and(eq(t.wasteEntries.streamId, 'FD-99'), isNull(t.wasteEntries.cancelledAt)))).toEqual([]);
  });
});
