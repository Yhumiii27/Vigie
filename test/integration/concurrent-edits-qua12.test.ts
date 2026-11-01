import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, freshDemoDatabase } from '../helpers';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { toParisLocal } from '@/lib/dates';
import type { FormState } from '@/lib/forms';
import { loadAudits } from '@/lib/data/audits';
import { loadContext } from '@/lib/data/context';
import { loadDocuments } from '@/lib/data/documents';
import { loadEnvironment } from '@/lib/data/environment';
import { loadObjectives } from '@/lib/data/objectives';
import { loadPrevention } from '@/lib/data/prevention';
import { loadReviewCard } from '@/lib/data/review';
import { loadRisks } from '@/lib/data/risks';
import { loadSkillMatrix } from '@/lib/data/skills';
import { loadSafetyNotices, loadWatch } from '@/lib/data/watch';
import { saveCertification, saveFinding, savePlanItem } from '@/server/audits';
import { saveContextItem } from '@/server/context';
import { saveContractor } from '@/server/contractors';
import { updateDocument, updateDraft } from '@/server/documents';
import { saveWasteEntry, saveWasteStream } from '@/server/environment';
import { saveObjective } from '@/server/objectives';
import { savePermit } from '@/server/permits';
import { saveReviewDecision, saveReviewItem } from '@/server/review';
import { saveWorkUnit } from '@/server/risks';
import { savePerson, saveQualification, saveTitle } from '@/server/skills';
import { STALE_EDIT, entityVersion } from '@/server/versions';
import { saveControl, saveRequirement, saveSafetyNotice } from '@/server/watch';

// QUA-12 (classe 1, lot A) : contrôle de version étendu aux autres fiches éditées. Pour chacune : la version lue à
// l'ouverture (chargement de l'écran) est celle du journal ; une première modification avec cette version passe ; une
// seconde, envoyée avec la même version (fenêtre restée ouverte), est refusée (STALE_EDIT) sans rien écraser.

freshDemoDatabase();

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** Deux enregistrements depuis la même version : le premier passe, le second est refusé ; la fiche garde la première valeur. */
async function staleCase(entity: string, id: string | number, action: Action, fields: Record<string, string>, changes: [Record<string, string>, Record<string, string>]) {
  const opened = await entityVersion(await getDb(), entity, id);
  const first = await action({}, form({ ...fields, ...changes[0], version: opened }));
  expect(first, `${entity} : première modification`).toMatchObject({ ok: true });
  expect(await entityVersion(await getDb(), entity, id), `${entity} : journal`).not.toBe(opened);
  expect(await action({}, form({ ...fields, ...changes[1], version: opened })), `${entity} : seconde fenêtre`).toEqual({ error: STALE_EDIT });
  return opened;
}

describe('QUA-12 : veille réglementaire', () => {
  it('exigence, contrôle, observation du registre de sécurité', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const db = await getDb();
    const [r] = await db.select().from(t.requirements).where(isNull(t.requirements.archivedAt)).orderBy(asc(t.requirements.sort)).limit(1);
    const watch = await loadWatch();
    expect(watch.requirements.find((x) => x.id === r.id)!.version).toBe(await entityVersion(db, 'requirement', r.id));
    await staleCase('requirement', r.id, saveRequirement, {
      id: String(r.id), text: r.text, domain: r.domain, summary: r.summary, dueOn: r.dueOn ?? '', dueNote: r.dueNote ?? '', evaluation: r.evaluation,
      evaluationNote: r.evaluationNote ?? '', pilotId: r.pilotId ?? '', impact: r.impact ?? '', affectsProjects: r.affectsProjects ? 'on' : '',
      keystoneProjects: r.keystoneProjects != null ? String(r.keystoneProjects) : '', featured: r.featured ? 'on' : '',
    }, [{ summary: 'Résumé de A' }, { summary: 'Résumé de B' }]);
    expect((await db.select().from(t.requirements).where(eq(t.requirements.id, r.id)))[0].summary).toBe('Résumé de A');

    const c = watch.controls.find((x) => !x.archived && x.siteId === 'ville-a')!;
    expect(c.version).toBe(await entityVersion(db, 'control', c.id));
    await staleCase('control', c.id, saveControl, {
      id: String(c.id), equipment: c.equipment, controlType: c.controlType, periodMonths: String(c.periodMonths), organization: c.organization,
      responsibleId: c.responsibleId ?? '', siteId: c.siteId ?? '', requirementId: c.requirementId != null ? String(c.requirementId) : '',
      lastOn: c.lastOn, nextOn: c.nextOn, reserves: c.reserves ?? '',
    }, [{ organization: 'Organisme A' }, { organization: 'Organisme B' }]);

    const notice = { kind: 'observation', siteId: 'ville-a', receivedOn: '2026-10-01', authority: 'Inspection du travail', text: 'Observation de test' };
    const created = await saveSafetyNotice({}, form(notice));
    expect(created).toMatchObject({ ok: true });
    expect((await loadSafetyNotices()).notices.find((n) => n.id === Number(created.id))!.version).toBe(await entityVersion(db, 'safety_notice', created.id!));
    await staleCase('safety_notice', created.id!, saveSafetyNotice, { ...notice, id: created.id! }, [{ text: 'Texte A' }, { text: 'Texte B' }]);
  });
});

describe('QUA-12 : habilitations', () => {
  it('fiche salarié, titre suivi, correction d’une formation', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const db = await getDb();
    const matrix = await loadSkillMatrix();
    const row = matrix.rows.find((x) => x.person.siteId === 'ville-a')!;
    const p = row.person;
    expect(matrix.versions.person[p.id]).toBe(await entityVersion(db, 'person', p.id));
    await staleCase('person', p.id, savePerson, { id: p.id, name: p.name, job: p.job ?? '', service: p.service ?? '', siteId: p.siteId ?? '', inSkillsMatrix: 'on' },
      [{ job: 'Fonction A' }, { job: 'Fonction B' }]);

    const title = matrix.titles.find((x) => !x.firstAid && !x.scopeLabel)!;
    expect(matrix.versions.title[title.id]).toBe(await entityVersion(db, 'training_title', title.id));
    await staleCase('training_title', title.id, saveTitle, {
      id: title.id, validityMonths: String(title.validityMonths), firstAidField: '1', prerequisitesField: '1', awarenessField: '1', internalAuditorField: '1',
      ...(title.prerequisiteIds ?? []).reduce((acc, x, i) => ({ ...acc, [`prerequisiteIds${i}`]: x }), {}),
    }, [{ label: `${title.label} (A)` }, { label: `${title.label} (B)` }]);

    const cell = matrix.rows.flatMap((x) => x.cells.map((cl) => ({ person: x.person, cell: cl })))
      .find((x) => x.person.siteId === 'ville-a' && x.cell.qualificationId && !x.cell.title.scopeLabel)!;
    const q = cell.cell;
    expect(matrix.versions.qualification[String(q.qualificationId)]).toBe(await entityVersion(db, 'qualification', q.qualificationId!));
    await staleCase('qualification', q.qualificationId!, saveQualification, {
      qualificationId: String(q.qualificationId), personId: cell.person.id, titleId: q.title.id, obtainedOn: q.obtainedOn!, expiresOn: q.expiresOn ?? '',
    }, [{ provider: 'Organisme A' }, { provider: 'Organisme B' }]);
  });
});

describe('QUA-12 : documents maîtrisés', () => {
  it('informations du document et brouillon (journal du document)', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const db = await getDb();
    const { rows } = await loadDocuments();
    const d = rows.find((x) => x.id === 'IT-MON-012')!;
    expect(d.version).toBe(await entityVersion(db, 'document', d.id));
    const [doc] = await db.select().from(t.documents).where(eq(t.documents.id, d.id));
    const base = { id: doc.id, title: doc.title, type: doc.type, process: doc.process, ownerId: doc.ownerId, reviewMonths: String(doc.reviewMonths), distribution: doc.distribution, siteId: doc.siteId ?? '' };
    const opened = await staleCase('document', doc.id, updateDocument, base, [{ title: `${doc.title} (A)` }, { title: `${doc.title} (B)` }]);
    // Le brouillon partage le journal du document : ouvert avant la modification ci-dessus, il est périmé aussi.
    const [v] = await db.select().from(t.documentVersions).where(and(eq(t.documentVersions.documentId, doc.id), eq(t.documentVersions.status, 'brouillon')));
    expect(await updateDraft({}, form({ versionId: String(v.id), summary: 'Objet B', version: opened }))).toEqual({ error: STALE_EDIT });
    const fresh = await entityVersion(db, 'document', doc.id);
    expect(await updateDraft({}, form({ versionId: String(v.id), summary: 'Objet A', version: fresh }))).toMatchObject({ ok: true });
    expect(await updateDraft({}, form({ versionId: String(v.id), summary: 'Objet C', version: fresh }))).toEqual({ error: STALE_EDIT });
    expect((await db.select().from(t.documentVersions).where(eq(t.documentVersions.id, v.id)))[0].summary).toBe('Objet A');
  });
});

describe('QUA-12 : revue de direction (journal de la revue)', () => {
  it('élément de la check-list et décision', async () => {
    actAs('Animateur QHSE', 'all');
    const db = await getDb();
    const [review] = await db.select().from(t.reviews).where(eq(t.reviews.status, 'planifiee')).orderBy(asc(t.reviews.reviewOn)).limit(1);
    const card = await loadReviewCard({ revue: String(review.id) });
    expect(card.version).toBe(await entityVersion(db, 'review', review.id));
    const item = await saveReviewItem({}, form({ reviewId: String(review.id), label: 'Élément de test QUA-12', source: 'manuel', ownerId: 'clefevre' }));
    expect(item).toMatchObject({ ok: true });
    await staleCase('review', review.id, saveReviewItem, { id: item.id!, source: 'manuel', ownerId: 'clefevre' },
      [{ label: 'Élément de test QUA-12 (A)' }, { label: 'Élément de test QUA-12 (B)' }]);
    const decision = await saveReviewDecision({}, form({ reviewId: String(review.id), kind: 'decision', text: 'Décision de test QUA-12', pilotId: 'clefevre' }));
    expect(decision).toMatchObject({ ok: true });
    await staleCase('review', review.id, saveReviewDecision, { id: decision.id!, kind: 'decision', pilotId: 'clefevre' },
      [{ text: 'Décision de test QUA-12 (A)' }, { text: 'Décision de test QUA-12 (B)' }]);
  });
});

describe('QUA-12 : audits', () => {
  it('référentiel, élément du programme, constat, objectif, élément du contexte', async () => {
    actAs('Animateur QHSE', 'all');
    const db = await getDb();
    const cert = { standard: 'MASE', domain: 'Santé-sécurité', tone: 'warn', siteId: 'ville-a' };
    const c = await saveCertification({}, form(cert));
    expect(c).toMatchObject({ ok: true });
    await staleCase('certification', c.id!, saveCertification, { ...cert, id: c.id! }, [{ domain: 'Domaine A' }, { domain: 'Domaine B' }]);

    const item = { year: '2026', month: '12', track: 'Audits internes', label: 'Audit QUA-12', siteId: 'ville-a' };
    const p = await savePlanItem({}, form(item));
    expect(p).toMatchObject({ ok: true });
    await staleCase('audit_plan_item', p.id!, savePlanItem, { ...item, id: p.id! }, [{ label: 'Audit QUA-12 (A)' }, { label: 'Audit QUA-12 (B)' }]);

    const audits = await loadAudits({});
    const done = audits.auditOptions[0][0];
    const f = await saveFinding({}, form({ planItemId: done, kind: 'observation', text: 'Constat QUA-12' }));
    expect(f).toMatchObject({ ok: true });
    await staleCase('audit_finding', f.id!, saveFinding, { id: f.id!, planItemId: done, kind: 'observation' }, [{ text: 'Constat A' }, { text: 'Constat B' }]);
    const reloaded = await loadAudits({});
    expect(reloaded.certs.find((x) => x.id === c.id)!.version).toBe(await entityVersion(db, 'certification', c.id!));
    expect(reloaded.auditGroups.flatMap((g) => g.findings).find((x) => x.id === Number(f.id))!.version).toBe(await entityVersion(db, 'audit_finding', f.id!));

    const objective = { year: '2026', label: 'Objectif QUA-12', indicator: 'nc', target: '10', siteId: 'all', pilotId: 'clefevre' };
    const o = await saveObjective({}, form(objective));
    expect(o).toMatchObject({ ok: true });
    expect((await loadObjectives(2026)).objectives.find((x) => x.id === Number(o.id))!.version).toBe(await entityVersion(db, 'qhse_objective', o.id!));
    await staleCase('qhse_objective', o.id!, saveObjective, { ...objective, id: o.id! }, [{ target: '11' }, { target: '12' }]);

    const ctx = { kind: 'risque', label: 'Risque QUA-12', treatment: 'Traitement' };
    const k = await saveContextItem({}, form(ctx));
    expect(k).toMatchObject({ ok: true });
    expect((await loadContext()).groups.flatMap((g) => g.items).find((x) => x.id === Number(k.id))!.version).toBe(await entityVersion(db, 'context_item', k.id!));
    await staleCase('context_item', k.id!, saveContextItem, { ...ctx, id: k.id! }, [{ treatment: 'Traitement A' }, { treatment: 'Traitement B' }]);
  });
});

describe('QUA-12 : environnement', () => {
  it('filière et enlèvement', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const db = await getDb();
    const stream = {
      label: 'Batteries QUA-12', ewcCode: '16 06 01*', channel: 'Regroupement', collector: '[Collecteur DD Ouest]', destination: '[Plateforme]',
      siteId: 'ville-a', unit: 'kg', qualification: '', collectorSiret: '', collectorAddress: '', collectorReceipt: '', destinationSiret: '', destinationAddress: '', treatmentCode: 'R13',
    };
    const s = await saveWasteStream({}, form(stream));
    expect(s).toMatchObject({ ok: true });
    await staleCase('waste_stream', s.id!, saveWasteStream, { ...stream, id: s.id! }, [{ collector: 'Collecteur A' }, { collector: 'Collecteur B' }]);

    const env = await loadEnvironment();
    const entry = env.entries.find((e) => !e.cancelled && e.siteId === 'ville-a')!;
    expect(entry.version).toBe(await entityVersion(db, 'waste_entry', entry.id));
    expect(env.streams.find((x) => x.id === s.id)!.version).toBe(await entityVersion(db, 'waste_stream', s.id!));
    const [row] = await db.select().from(t.wasteEntries).where(eq(t.wasteEntries.id, entry.id));
    const fields = Object.fromEntries(Object.entries(row).filter(([, v]) => v != null && typeof v !== 'object').map(([k, v]) => [k, String(v)]));
    await staleCase('waste_entry', entry.id, saveWasteEntry, { ...fields, id: String(entry.id) }, [{ notes: 'Note A' }, { notes: 'Note B' }]);
  });
});

describe('QUA-12 : prévention et DUERP', () => {
  it('entreprise extérieure, permis, unité de travail', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const db = await getDb();
    const k = await saveContractor({}, form({ name: 'Levage QUA-12', trade: 'Levage' }));
    expect(k).toMatchObject({ ok: true });
    await staleCase('contractor', k.id!, saveContractor, { id: k.id!, name: 'Levage QUA-12' }, [{ trade: 'Levage A' }, { trade: 'Levage B' }]);

    const prevention = await loadPrevention();
    expect(prevention.contractors.find((x) => x.id === k.id)!.version).toBe(await entityVersion(db, 'contractor', k.id!));
    const [p] = await db.select().from(t.permits).where(and(eq(t.permits.status, 'demande'), eq(t.permits.siteId, 'ville-a'))).limit(1);
    const permit = {
      id: p.id, type: p.type, siteId: p.siteId, location: p.location, description: p.description, contractorId: p.contractorId ?? '', performer: p.performer,
      preventionPlanId: p.preventionPlanId ?? '', keystoneProject: p.keystoneProject ?? '', validFrom: toParisLocal(p.validFrom).slice(0, 16),
      validTo: toParisLocal(p.validTo).slice(0, 16), checklist: JSON.stringify(p.checklist),
    };
    await staleCase('permit', p.id, savePermit, permit, [{ location: 'Lieu A' }, { location: 'Lieu B' }]);

    const u = await saveWorkUnit({}, form({ label: 'Unité QUA-12', siteId: 'ville-a' }));
    expect(u).toMatchObject({ ok: true });
    expect((await loadRisks()).units.find((x) => x.id === u.id)!.version).toBe(await entityVersion(db, 'work_unit', u.id!));
    await staleCase('work_unit', u.id!, saveWorkUnit, { id: u.id!, siteId: 'ville-a' }, [{ label: 'Unité QUA-12 A' }, { label: 'Unité QUA-12 B' }]);
  });
});
