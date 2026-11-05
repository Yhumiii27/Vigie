'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { readDocumentsByRef } from '@/lib/foreign/codex';
import { proposeTargetsFor } from '@/lib/data/engineering';
import { unknownArticlesError, unknownProjectError } from '@/lib/foreign/keystone';
import { unavailableMessage } from '@/lib/foreign/labels';
import { fmtDate } from '@/lib/dates';
import { canApprove, canSee } from '@/lib/domain';
import { EDIT_DENIED } from '@/lib/edit-rights';
import { formReader, type FormState } from '@/lib/forms';
import { requireEditor, requireInSite } from '@/lib/guard';
import { hasLeft } from '@/lib/people';
import { isWithdrawn } from '@/lib/rules/documents';
import {
  ECO_APPROVAL_KEYS, ECO_APPROVAL_KEY_LIST, ECO_STATUSES, ECO_TITLE_MAX, ECO_TYPE_KEYS, ECO_TYPES, ECR_KINDS, ECR_KIND_KEYS, ECR_STATUSES, ECR_SUBJECTS,
  ECR_SUBJECT_KEYS, ECR_TEXT_MAX, EFFECTIVITY_DISPOSITIONS, EFFECTIVITY_DISPOSITION_KEYS, INTERCHANGEABILITY, REVISION_MAX, canDecideApproval,
  dispositionError, documentLinesText, ecoEditable, ecoOpen, ecoStepBlocker, ecrSubjectError, invalidRefs, matriculeOrNull, parseDocumentLines,
  parseRefList, targetText, type EcoApprovalKey, type EcoStatus, type EcoType, type EcrKind, type EcrStatus, type EcrSubject, type EffectivityDisposition,
  type EffectivityTarget,
} from '@/lib/rules/engineering';
import { ALL_SITES, getSession } from '@/lib/session';
import { today } from '@/lib/today';
import { diffFields, logChange } from './changelog';
import {
  ECO_ENTITY, ECR_ENTITY, closeLinkedEcrs, enqueueCodexDecision, nextEcoRef, nextEcrRef, settleEco, writeApproval, writeApprovers, writeEcoLists, writeEcoStep,
} from './engineering-core';
import { STALE_EDIT, VERSION_FIELD, staleEditError } from './versions';

// Modifications techniques (D12, lot 5 de M-02, décision CV-06 du 05/11/2026 ; docs/specs/modifications-techniques.md).
// Création, instruction, décision, approbation pour le compte d'un approbateur, effectivité et annulation : animateur QHSE
// et direction (requireEditor('engineering', { approver: true })) ; un approbateur désigné dans Vigie décide sa propre clé
// (canDecideApproval). Fiche du site sélectionné et du périmètre (requireInSite ; création ou changement de site :
// { create: true }) ; « Tous les sites » : périmètre complet. Jamais de suppression : annulation motivée (publiée
// « rejected »). Journal `ecr` / `eco` dans la transaction de chaque écriture ; contrôle de version (QUA-12).

const TO_FIX = 'Certains champs sont à corriger.';
const ECR_NOT_FOUND = 'Demande de modification introuvable.';
const ECO_NOT_FOUND = 'Ordre de modification introuvable.';

const requireQhse = () => requireEditor('engineering', { approver: true });
const done = (id: string): FormState => {
  revalidatePath('/', 'layout');
  return { ok: true, id };
};

type Person = { id: string; name: string; leftOn: string | null; matricule: string | null };
async function people(db: DbOrTx): Promise<Person[]> {
  return db.select({ id: t.people.id, name: t.people.name, leftOn: t.people.leftOn, matricule: t.people.matricule }).from(t.people);
}
const siteOf = (raw: string) => (!raw || raw === ALL_SITES ? null : raw);

// ─── Demandes de modification (ECR) ──────────────────────────────────────────

async function loadEcrForWrite(id: string | null) {
  if (!id) return { r: null, error: ECR_NOT_FOUND };
  const db = await getDb();
  const [r] = await db.select().from(t.ecrs).where(eq(t.ecrs.id, id));
  if (!r) return { r: null, error: ECR_NOT_FOUND };
  const siteError = await requireInSite(r.siteId);
  if (siteError) return { r: null, error: siteError };
  if (r.cancelledAt) return { r: null, error: 'Demande annulée : elle reste consultable avec son historique.' };
  return { r, error: null };
}

const ECR_LABELS = { kind: 'Nature', subject: 'Objet', title: 'Intitulé', reason: 'Motif', description: 'Description', ref: 'Élément visé', site: 'Site' } as const;

/**
 * Crée (« Vigie ») ou modifie une demande encore à décider : nature, objet et sa référence (document de Codex, article ou
 * projet de Keystone contrôlés contre leurs vues, ou événement de Vigie du périmètre), intitulé, motif, description, site.
 * Demandeur : la personne connectée (nom et matricule). Une demande de Codex ne se modifie pas dans Vigie (elle se décide).
 */
export async function saveEcr(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireQhse();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const kind = f.oneOf('kind', ECR_KIND_KEYS, { required: true });
  const subject = f.oneOf('subject', ECR_SUBJECT_KEYS, { required: true });
  const title = f.str('title', { required: true, max: ECO_TITLE_MAX });
  const reason = f.str('ecrReason', { required: true, max: ECR_TEXT_MAX });
  const description = f.str('description', { max: ECR_TEXT_MAX * 2 });
  const refs = {
    codexDocId: subject === 'document' ? f.opt('codexDocId') : null,
    partRef: subject === 'part' ? f.opt('partRef') : null,
    projectCode: subject === 'project' ? (f.opt('keystoneProjectCode')?.toUpperCase() ?? null) : null,
    eventId: subject === 'event' ? f.opt('eventId') : null,
  };
  const siteId = siteOf(f.str('siteId'));
  if (subject) {
    const missing = ecrSubjectError(subject, refs);
    if (missing) f.fail(missing.field === 'projectCode' ? 'keystoneProjectCode' : missing.field, missing.message);
  }
  if (!f.ok) return f.state();
  const loaded = id ? await loadEcrForWrite(id) : null;
  if (loaded?.error) return { error: loaded.error };
  const current = loaded?.r ?? null;
  if (current && current.status !== 'submitted') return { error: `Demande ${ECR_STATUSES[current.status as EcrStatus].label.toLowerCase()} : elle ne se modifie plus.` };
  if (current && current.source === 'codex') return { error: 'Demande de Codex : elle se décide dans Vigie et se modifie dans Codex.' };
  if (!current || current.siteId !== siteId) {
    const siteError = await requireInSite(siteId, { create: true });
    if (siteError) return { error: siteError, fieldErrors: { siteId: siteError } };
  }
  const db = await getDb();
  // Références contrôlées contre les vues des autres outils (valeur déjà enregistrée admise ; source indisponible : refus).
  if (refs.codexDocId && refs.codexDocId !== current?.codexDocId) {
    const read = await readDocumentsByRef(db, [refs.codexDocId]);
    if (!read.ok) return { error: TO_FIX, fieldErrors: { codexDocId: unavailableMessage('documents') } };
    const d = read.rows.find((x) => x.id === refs.codexDocId || x.aliases.includes(refs.codexDocId!));
    if (!d) return { error: TO_FIX, fieldErrors: { codexDocId: 'Document inconnu de Codex.' } };
    if (isWithdrawn(d)) return { error: TO_FIX, fieldErrors: { codexDocId: 'Document retiré de la diffusion dans Codex.' } };
    refs.codexDocId = d.id;
  }
  if (refs.codexDocId) {
    const [open] = await db.select({ id: t.ecrs.id }).from(t.ecrs)
      .where(and(eq(t.ecrs.codexDocId, refs.codexDocId), inArray(t.ecrs.status, ['submitted', 'accepted'])));
    if (open && open.id !== current?.id) return { error: TO_FIX, fieldErrors: { codexDocId: `Une demande est déjà en cours pour ce document : ${open.id}.` } };
  }
  if (refs.partRef) {
    const partError = invalidRefs([refs.partRef]).length ? 'Référence d’article invalide.' : await unknownArticlesError(db, [refs.partRef], current?.partRef ? [current.partRef] : []);
    if (partError) return { error: TO_FIX, fieldErrors: { partRef: partError } };
  }
  const projectError = await unknownProjectError(db, refs.projectCode, current?.keystoneProjectCode);
  if (projectError) return { error: TO_FIX, fieldErrors: { keystoneProjectCode: projectError } };
  if (refs.eventId && refs.eventId !== current?.eventId) {
    const [ev] = await db.select({ id: t.events.id, siteId: t.events.siteId, type: t.events.type }).from(t.events).where(eq(t.events.id, refs.eventId));
    // Jamais un AT ni une MP (données de santé) : seuls les événements qualité et environnement sont proposés.
    if (!ev || ev.type === 'AT' || ev.type === 'MP' || (await requireInSite(ev.siteId))) return { error: TO_FIX, fieldErrors: { eventId: 'Événement introuvable ou hors du site sélectionné.' } };
  }
  const values = {
    kind: kind!, subject: subject!, title, reason, description, siteId,
    codexDocId: refs.codexDocId, partRef: refs.partRef, keystoneProjectCode: refs.projectCode, eventId: refs.eventId,
  };
  const refText = (v: typeof values) => v.codexDocId ?? v.partRef ?? v.keystoneProjectCode ?? v.eventId;
  const shown = (v: typeof values) => ({
    kind: ECR_KINDS[v.kind as EcrKind], subject: ECR_SUBJECTS[v.subject as EcrSubject], title: v.title, reason: v.reason, description: v.description,
    ref: refText(v), site: v.siteId ?? 'Tous les sites',
  });
  const byId = session.user.id;
  if (current) {
    const res = await db.transaction(async (tx) => {
      if (await staleEditError(tx, ECR_ENTITY, current.id, fd.get(VERSION_FIELD))) return 'stale' as const;
      await tx.update(t.ecrs).set({ ...values, updatedAt: new Date() }).where(eq(t.ecrs.id, current.id));
      const details = diffFields(shown(current as typeof values), shown(values), ECR_LABELS);
      if (details.length) await logChange(tx, { entityType: ECR_ENTITY, entityId: current.id, action: 'update', byId, summary: 'Demande de modification modifiée', details });
      return 'ok' as const;
    });
    return res === 'stale' ? { error: STALE_EDIT } : done(current.id);
  }
  const all = await people(db);
  const me = all.find((p) => p.id === byId);
  const newId = await db.transaction(async (tx) => {
    const ref = await nextEcrRef(tx);
    await tx.insert(t.ecrs).values({
      id: ref, ...values, source: 'vigie', requesterName: me?.name ?? session.user.name, requesterMatricule: matriculeOrNull(me?.matricule), createdById: byId,
    });
    await logChange(tx, { entityType: ECR_ENTITY, entityId: ref, action: 'create', byId, summary: `Demande de modification créée : ${ECR_KINDS[values.kind]} · ${refText(values)}` });
    return ref;
  });
  return done(newId);
}

/**
 * Décide une demande (QHSE) : acceptée — éventuellement rattachée à un ordre ouvert, ou avec un nouvel ordre en brouillon
 * créé d'après elle (« new ») ; rédacteur désigné dans Codex pour un document — ou refusée (motif obligatoire). Une demande
 * de Codex reçoit la décision par son webhook (file d'envoi) : aussitôt pour un refus ou une acceptation sans ordre, à la
 * libération (ou au rejet) de l'ordre sinon.
 */
export async function decideEcr(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireQhse();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const decision = f.oneOf('decision', ['accepted', 'rejected'] as const, { required: true });
  const note = f.str('note', { max: ECR_TEXT_MAX });
  const ecoChoice = f.opt('ecoId');
  const modifierRef = f.str('modifierRef', { max: 64 }) || null;
  if (decision === 'rejected' && !note) f.fail('note', 'Motif du refus obligatoire.');
  if (!f.ok) return f.state();
  const { r, error: loadError } = await loadEcrForWrite(id);
  if (!r) return { error: loadError };
  if (r.status !== 'submitted') return { error: `Demande déjà décidée (${ECR_STATUSES[r.status as EcrStatus].label.toLowerCase()}).` };
  const db = await getDb();
  let target: { id: string; status: string; siteId: string | null } | null = null;
  if (decision === 'accepted' && ecoChoice && ecoChoice !== 'new') {
    const [eco] = await db.select({ id: t.ecos.id, status: t.ecos.status, siteId: t.ecos.siteId, cancelledAt: t.ecos.cancelledAt }).from(t.ecos).where(eq(t.ecos.id, ecoChoice));
    if (!eco || eco.cancelledAt || eco.status === 'rejected' || (await requireInSite(eco.siteId))) return { error: TO_FIX, fieldErrors: { ecoId: 'Ordre introuvable, rejeté ou hors du site sélectionné.' } };
    target = eco;
  }
  const byId = session.user.id;
  const res = await db.transaction(async (tx) => {
    if (await staleEditError(tx, ECR_ENTITY, r.id, fd.get(VERSION_FIELD))) return 'stale' as const;
    let ecoId = target?.id ?? null;
    if (decision === 'accepted' && ecoChoice === 'new') {
      ecoId = await nextEcoRef(tx);
      const all = await people(tx);
      const me = all.find((p) => p.id === byId);
      await tx.insert(t.ecos).values({
        id: ecoId, title: r.title.slice(0, ECO_TITLE_MAX), ecoType: r.kind === 'obsolescence' ? 'obs' : 'rev', fromRevision: '', toRevision: '',
        requestedByName: r.requesterName, requestedByMatricule: r.requesterMatricule, raisedOn: today(), pilotId: byId, siteId: r.siteId,
        source: r.source, description: [r.reason, r.description].filter(Boolean).join('\n\n'), createdById: byId,
      });
      await writeApprovers(tx, ecoId, defaultApprovers(me?.name ?? null));
      await writeEcoLists(tx, ecoId, {
        parts: r.partRef ? [r.partRef] : [], projects: r.keystoneProjectCode ? [r.keystoneProjectCode] : [],
        documents: r.codexDocId ? [{ refLabel: r.codexDocId, codexDocId: r.codexDocId, ecrId: r.id }] : [],
      });
      await logChange(tx, { entityType: ECO_ENTITY, entityId: ecoId, action: 'create', byId, summary: `Ordre créé d’après la demande ${r.id}` });
    } else if (ecoId && r.codexDocId) {
      // Document de Codex de la demande cité par l'ordre (avec la demande transmise à Codex pour lui).
      const docs = await tx.select().from(t.ecoDocuments).where(eq(t.ecoDocuments.ecoId, ecoId));
      const same = docs.find((d) => d.codexDocId === r.codexDocId);
      if (same) await tx.update(t.ecoDocuments).set({ ecrId: r.id }).where(and(eq(t.ecoDocuments.ecoId, ecoId), eq(t.ecoDocuments.position, same.position)));
      else await tx.insert(t.ecoDocuments).values({ ecoId, position: Math.max(0, ...docs.map((d) => d.position)) + 1, refLabel: r.codexDocId, codexDocId: r.codexDocId, ecrId: r.id });
    }
    const now = new Date();
    await tx.update(t.ecrs).set({
      status: decision!, decisionNote: note || null, decidedById: byId, decidedAt: now, ecoId: decision === 'accepted' ? ecoId : null,
      modifierRef: decision === 'accepted' ? modifierRef : null, updatedAt: now,
    }).where(eq(t.ecrs.id, r.id));
    await logChange(tx, {
      entityType: ECR_ENTITY, entityId: r.id, action: 'decide', byId,
      summary: decision === 'accepted' ? `Demande acceptée${ecoId ? ` : ordre ${ecoId}` : ''}` : 'Demande refusée',
      reason: decision === 'rejected' ? note : null,
      details: [
        { field: 'État', from: ECR_STATUSES.submitted.label, to: ECR_STATUSES[decision!].label },
        ...(ecoId ? [{ field: 'Ordre de modification', from: null, to: ecoId }] : []),
        ...(modifierRef && decision === 'accepted' ? [{ field: 'Rédacteur désigné (Codex)', from: null, to: modifierRef }] : []),
        ...(note && decision === 'accepted' ? [{ field: 'Note de décision', from: null, to: note }] : []),
      ],
    });
    if (ecoId && decision === 'accepted' && target) {
      await logChange(tx, { entityType: ECO_ENTITY, entityId: ecoId, action: 'link', byId, summary: `Demande ${r.id} rattachée` });
    }
    // Décision transmise à Codex : refus et acceptation sans ordre aussitôt ; ordre déjà libéré : acceptée avec son numéro.
    const fresh = { ...r, modifierRef: decision === 'accepted' ? modifierRef : null };
    if (decision === 'rejected') await enqueueCodexDecision(tx, fresh, { accepted: false, ecoRef: null, note });
    else if (!ecoId) await enqueueCodexDecision(tx, fresh, { accepted: true, ecoRef: null, note: note || null });
    else if (target?.status === 'released') await enqueueCodexDecision(tx, fresh, { accepted: true, ecoRef: ecoId, note: note || null });
    return ecoId;
  });
  return res === 'stale' ? { error: STALE_EDIT } : done(r.id);
}

/** Demande acceptée hors document de Codex (article, projet, événement) : mise en œuvre constatée par le QHSE. */
export async function implementEcr(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireQhse();
  if (error) return { error };
  const f = formReader(fd);
  const note = f.str('note', { max: ECR_TEXT_MAX });
  if (!f.ok) return f.state();
  const { r, error: loadError } = await loadEcrForWrite(f.opt('id'));
  if (!r) return { error: loadError };
  if (r.status !== 'accepted') return { error: 'Seule une demande acceptée se constate mise en œuvre.' };
  if (r.source === 'codex' && r.codexDocId) return { error: 'Demande de Codex : sa mise en œuvre est constatée par Codex (révision ouverte).' };
  const db = await getDb();
  if (r.ecoId) {
    const [eco] = await db.select({ status: t.ecos.status }).from(t.ecos).where(eq(t.ecos.id, r.ecoId));
    if (eco?.status !== 'released') return { error: `L’ordre ${r.ecoId} n’est pas encore libéré.` };
  }
  await db.transaction(async (tx) => {
    const now = new Date();
    await tx.update(t.ecrs).set({ status: 'implemented', implementedAt: now, updatedAt: now }).where(eq(t.ecrs.id, r.id));
    await logChange(tx, {
      entityType: ECR_ENTITY, entityId: r.id, action: 'status', byId: session.user.id, summary: 'Demande mise en œuvre',
      details: [{ field: 'État', from: ECR_STATUSES.accepted.label, to: ECR_STATUSES.implemented.label }, ...(note ? [{ field: 'Constat', from: null, to: note }] : [])],
    });
  });
  return done(r.id);
}

/** Annule une demande saisie par erreur dans Vigie (encore à décider) : motif, publiée « refusée », jamais supprimée. */
export async function cancelEcr(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireQhse();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const reason = f.reason();
  if (!f.ok) return f.state();
  const { r, error: loadError } = await loadEcrForWrite(id);
  if (!r) return { error: loadError };
  if (r.status !== 'submitted') return { error: 'Seule une demande encore à décider s’annule.' };
  if (r.source !== 'vigie') return { error: `Demande de ${r.source === 'codex' ? 'Codex' : 'Keystone'} : elle se refuse (motif), elle ne s’annule pas.` };
  const db = await getDb();
  const ok = await db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx.update(t.ecrs).set({
      status: 'rejected', decidedAt: now, decidedById: session.user.id, decisionNote: `Annulée : ${reason}`.slice(0, ECR_TEXT_MAX),
      cancelledAt: now, cancelledById: session.user.id, cancelReason: reason, updatedAt: now,
    }).where(and(eq(t.ecrs.id, r.id), isNull(t.ecrs.cancelledAt), eq(t.ecrs.status, 'submitted'))).returning({ id: t.ecrs.id });
    if (!row) return false;
    await logChange(tx, { entityType: ECR_ENTITY, entityId: r.id, action: 'cancel', reason, byId: session.user.id, summary: 'Demande annulée' });
    return true;
  });
  return ok ? done(r.id) : { error: 'Demande déjà annulée ou décidée.' };
}

// ─── Ordres de modification (ECO) ───────────────────────────────────────────

async function loadEcoForWrite(id: string | null) {
  if (!id) return { e: null, error: ECO_NOT_FOUND };
  const db = await getDb();
  const [e] = await db.select().from(t.ecos).where(eq(t.ecos.id, id));
  if (!e) return { e: null, error: ECO_NOT_FOUND };
  const siteError = await requireInSite(e.siteId);
  if (siteError) return { e: null, error: siteError };
  if (e.cancelledAt) return { e: null, error: 'Ordre annulé : il reste consultable avec son historique.' };
  return { e, error: null };
}

/** Approbateurs par défaut d'un nouvel ordre : libellés des clés (la clé qualité au QHSE qui crée l'ordre). */
function defaultApprovers(qhseName: string | null): Record<EcoApprovalKey, { text: string; approverId: string | null }> {
  return {
    englead: { text: ECO_APPROVAL_KEYS.englead.fallback, approverId: null },
    quality: { text: qhseName ?? ECO_APPROVAL_KEYS.quality.fallback, approverId: null },
    pm: { text: ECO_APPROVAL_KEYS.pm.fallback, approverId: null },
  };
}

const ECO_LABELS = {
  title: 'Intitulé', ecoType: 'Type', fromRevision: 'Indice de départ', toRevision: 'Nouvel indice', interchangeability: 'Interchangeabilité',
  costEur: 'Coût (€)', scheduleDays: 'Délai (jours)', stockImpact: 'Impact sur le stock', description: 'Description', pilot: 'Pilote', site: 'Site',
  parts: 'Articles', projects: 'Projets', documents: 'Documents', approvers: 'Approbateurs',
} as const;

/**
 * Crée ou modifie un ordre (brouillon ou analyse d'impact) : intitulé, type, indices, interchangeabilité, coût, délai,
 * impact sur le stock, description, pilote présent, site, articles et projets (contrôlés contre keystone.pub_articles et
 * pub_projets), documents cités (libellé | identifiant Codex), approbateurs (texte et personne désignée). Création depuis
 * Keystone (« Raise ECO ») : source « keystone ». Demandeur : la personne connectée.
 */
export async function saveEco(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireQhse();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const title = f.str('title', { required: true, max: ECO_TITLE_MAX });
  const ecoType = f.oneOf('ecoType', ECO_TYPE_KEYS, { required: true });
  const fromRevision = f.str('fromRevision', { max: REVISION_MAX });
  const toRevision = f.str('toRevision', { max: REVISION_MAX });
  const interchangeability = f.oneOf('interchangeability', ['yes', 'no'] as const);
  const costEur = f.decimal('costEur', { min: 0, max: 9_999_999_999 }) ?? 0;
  const scheduleDays = f.int('scheduleDays', { min: 0, max: 3650 }) ?? 0;
  const stockImpact = f.str('stockImpact', { max: ECR_TEXT_MAX });
  const description = f.str('description', { max: ECR_TEXT_MAX * 2 });
  const pilotId = f.opt('pilotId');
  const siteId = siteOf(f.str('siteId'));
  const parts = parseRefList(f.str('parts', { max: 4000 }));
  const projects = parseRefList(f.str('projects', { max: 4000 }).toUpperCase());
  const documents = parseDocumentLines(f.str('documents', { max: 8000 }));
  const source = f.oneOf('source', ['vigie', 'keystone'] as const) ?? 'vigie';
  const approvers = Object.fromEntries(ECO_APPROVAL_KEY_LIST.map((k) => [k, {
    text: f.str(`approver_${k}`, { max: 200 }) || ECO_APPROVAL_KEYS[k].fallback, approverId: f.opt(`approverId_${k}`),
  }])) as Record<EcoApprovalKey, { text: string; approverId: string | null }>;
  const bad = invalidRefs(parts);
  if (bad.length) f.fail('parts', `Référence invalide : ${bad.join(', ')}.`);
  if (invalidRefs(projects).length) f.fail('projects', 'Code projet invalide.');
  if (documents.some((d) => d.refLabel.length > 200 || (d.codexDocId?.length ?? 0) > 64)) f.fail('documents', 'Libellé de 200 caractères et identifiant de 64 au plus.');
  if (!f.ok) return f.state();
  const loaded = id ? await loadEcoForWrite(id) : null;
  if (loaded?.error) return { error: loaded.error };
  const current = loaded?.e ?? null;
  if (current && !ecoEditable(current.status as EcoStatus)) return { error: `Ordre ${ECO_STATUSES[current.status as EcoStatus].label.toLowerCase()} : ses champs ne se modifient plus.` };
  if (!current || current.siteId !== siteId) {
    const siteError = await requireInSite(siteId, { create: true });
    if (siteError) return { error: siteError, fieldErrors: { siteId: siteError } };
  }
  const db = await getDb();
  const [curParts, curProjects, curDocs] = current
    ? await Promise.all([
      db.select().from(t.ecoParts).where(eq(t.ecoParts.ecoId, current.id)).orderBy(t.ecoParts.position),
      db.select().from(t.ecoProjects).where(eq(t.ecoProjects.ecoId, current.id)).orderBy(t.ecoProjects.position),
      db.select().from(t.ecoDocuments).where(eq(t.ecoDocuments.ecoId, current.id)).orderBy(t.ecoDocuments.position),
    ])
    : [[], [], []];
  const partsError = await unknownArticlesError(db, parts, curParts.map((p) => p.partRef));
  if (partsError) return { error: TO_FIX, fieldErrors: { parts: partsError } };
  for (const code of projects) {
    const projectError = await unknownProjectError(db, code, curProjects.some((p) => p.keystoneProjectCode === code) ? code : null);
    if (projectError) return { error: TO_FIX, fieldErrors: { projects: `${code} : ${projectError}` } };
  }
  const all = await people(db);
  const now = today();
  const present = (pid: string | null, keep: string | null | undefined) => {
    if (!pid) return null;
    const p = all.find((x) => x.id === pid);
    if (!p) return 'Choisissez une personne de la liste.';
    return hasLeft(p, now) && pid !== keep ? "Personne sortie de l'effectif : choisissez une personne présente." : null;
  };
  const pilotError = present(pilotId, current?.pilotId);
  if (pilotError) return { error: TO_FIX, fieldErrors: { pilotId: pilotError } };
  const curApprovals = current ? await db.select().from(t.ecoApprovals).where(eq(t.ecoApprovals.ecoId, current.id)) : [];
  for (const k of ECO_APPROVAL_KEY_LIST) {
    const e = present(approvers[k].approverId, curApprovals.find((a) => a.approvalKey === k)?.approverId);
    if (e) return { error: TO_FIX, fieldErrors: { [`approverId_${k}`]: e } };
  }
  // Documents : ECR déjà rattachées gardées (même identifiant Codex).
  const docs = documents.map((d) => ({ ...d, ecrId: curDocs.find((c) => c.codexDocId && c.codexDocId === d.codexDocId)?.ecrId ?? null }));
  const values = {
    title, ecoType: ecoType!, fromRevision, toRevision, interchangeability, costEur, scheduleDays, stockImpact, description, pilotId, siteId,
  };
  const name = (pid: string | null) => (pid ? all.find((p) => p.id === pid)?.name ?? pid : null);
  const approverText = (a: Record<EcoApprovalKey, { text: string; approverId: string | null }>) =>
    ECO_APPROVAL_KEY_LIST.map((k) => `${ECO_APPROVAL_KEYS[k].short} : ${a[k].text}${a[k].approverId ? ` (${name(a[k].approverId)})` : ''}`).join(' ; ');
  const shown = (v: typeof values, p: string[], pr: string[], d: { refLabel: string; codexDocId: string | null }[], a: string) => ({
    title: v.title, ecoType: ECO_TYPES[v.ecoType as EcoType], fromRevision: v.fromRevision, toRevision: v.toRevision,
    interchangeability: v.interchangeability ? INTERCHANGEABILITY[v.interchangeability as 'yes' | 'no'] : null, costEur: String(v.costEur), scheduleDays: String(v.scheduleDays),
    stockImpact: v.stockImpact, description: v.description, pilot: name(v.pilotId), site: v.siteId ?? 'Tous les sites',
    parts: p.join(', '), projects: pr.join(', '), documents: documentLinesText(d), approvers: a,
  });
  const byId = session.user.id;
  if (current) {
    const before = Object.fromEntries(ECO_APPROVAL_KEY_LIST.map((k) => {
      const a = curApprovals.find((x) => x.approvalKey === k);
      return [k, { text: a?.approverText ?? '', approverId: a?.approverId ?? null }];
    })) as Record<EcoApprovalKey, { text: string; approverId: string | null }>;
    const res = await db.transaction(async (tx) => {
      if (await staleEditError(tx, ECO_ENTITY, current.id, fd.get(VERSION_FIELD))) return 'stale' as const;
      await tx.update(t.ecos).set({ ...values, updatedAt: new Date() }).where(eq(t.ecos.id, current.id));
      await writeEcoLists(tx, current.id, { parts, projects, documents: docs });
      await writeApprovers(tx, current.id, approvers);
      const details = diffFields(
        shown(current as typeof values, curParts.map((p) => p.partRef), curProjects.map((p) => p.keystoneProjectCode), curDocs, approverText(before)),
        shown(values, parts, projects, docs, approverText(approvers)), ECO_LABELS,
      );
      if (details.length) await logChange(tx, { entityType: ECO_ENTITY, entityId: current.id, action: 'update', byId, summary: 'Ordre de modification modifié', details });
      return 'ok' as const;
    });
    return res === 'stale' ? { error: STALE_EDIT } : done(current.id);
  }
  const me = all.find((p) => p.id === byId);
  const newId = await db.transaction(async (tx) => {
    const ref = await nextEcoRef(tx);
    await tx.insert(t.ecos).values({
      id: ref, ...values, requestedByName: me?.name ?? session.user.name, requestedByMatricule: matriculeOrNull(me?.matricule), raisedOn: now, source, createdById: byId,
    });
    await writeEcoLists(tx, ref, { parts, projects, documents: docs });
    await writeApprovers(tx, ref, approvers);
    await logChange(tx, { entityType: ECO_ENTITY, entityId: ref, action: 'create', byId, summary: `Ordre de modification créé : ${ECO_TYPES[values.ecoType]}${source === 'keystone' ? ' (depuis Keystone)' : ''}` });
    return ref;
  });
  return done(newId);
}

/** Passe un ordre à l'étape suivante (brouillon → analyse d'impact → en approbation : interchangeabilité évaluée). */
export async function advanceEco(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireQhse();
  if (error) return { error };
  const f = formReader(fd);
  const target = f.oneOf('to', ['impact_analysis', 'in_approval'] as const, { required: true });
  if (!f.ok) return f.state();
  const { e, error: loadError } = await loadEcoForWrite(f.opt('id'));
  if (!e) return { error: loadError };
  const blocker = ecoStepBlocker(e as { status: EcoStatus; interchangeability: string | null }, target!);
  if (blocker) return { error: blocker };
  const db = await getDb();
  const res = await db.transaction(async (tx) => {
    if (await staleEditError(tx, ECO_ENTITY, e.id, fd.get(VERSION_FIELD))) return 'stale' as const;
    if (!(await writeEcoStep(tx, e, target!, { byId: session.user.id }))) return 'stale' as const;
    // Ordre soumis sans cible ni disposition à décider et déjà approuvé (cas d'une reprise) : issue évaluée aussitôt.
    await settleEco(tx, e.id, { byId: session.user.id });
    return 'ok' as const;
  });
  return res === 'stale' ? { error: STALE_EDIT } : done(e.id);
}

/**
 * Décide une clé d'approbation (ordre en approbation) : le service QHSE pour toute clé (pour le compte de l'approbateur),
 * l'approbateur désigné pour la sienne. Refus : commentaire obligatoire ; l'ordre est alors rejeté. Libération d'office
 * quand les trois clés sont approuvées et les dispositions décidées.
 */
export async function decideEcoApproval(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await getSession();
  if (!canSee(session.role, 'engineering')) return { error: EDIT_DENIED };
  const f = formReader(fd);
  const key = f.oneOf('key', ECO_APPROVAL_KEY_LIST, { required: true });
  const decision = f.oneOf('decision', ['ok', 'rejected'] as const, { required: true });
  const comment = f.str('comment', { max: ECR_TEXT_MAX });
  if (decision === 'rejected' && !comment) f.fail('comment', 'Motif du refus obligatoire.');
  if (!f.ok) return f.state();
  const db = await getDb();
  const id = f.opt('id');
  const [e] = id ? await db.select().from(t.ecos).where(eq(t.ecos.id, id)) : [];
  if (!e || e.cancelledAt) return { error: ECO_NOT_FOUND };
  // Lecture du périmètre (l'approbateur désigné peut avoir un rôle en consultation) ; site sélectionné exigé.
  const siteError = await requireInSite(e.siteId);
  if (siteError) return { error: siteError };
  const [a] = await db.select().from(t.ecoApprovals).where(and(eq(t.ecoApprovals.ecoId, e.id), eq(t.ecoApprovals.approvalKey, key!)));
  if (!a) return { error: ECO_NOT_FOUND };
  if (!canDecideApproval({ qhse: canApprove(session.role), userId: session.user.id, approverId: a.approverId })) {
    return { error: 'Seul l’approbateur désigné (ou le service QHSE) décide cette clé.' };
  }
  if (e.status !== 'in_approval') return { error: 'L’ordre n’est pas en approbation.' };
  if (a.decision !== 'pending') return { error: 'Clé déjà décidée.' };
  const all = await people(db);
  const me = all.find((p) => p.id === session.user.id);
  const res = await db.transaction(async (tx) => {
    if (await staleEditError(tx, ECO_ENTITY, e.id, fd.get(VERSION_FIELD))) return 'stale' as const;
    const ok = await writeApproval(tx, e.id, key!, {
      decision: decision!, comment: comment || null, byId: session.user.id, byName: me?.name ?? session.user.name, byMatricule: matriculeOrNull(me?.matricule), via: 'vigie',
      details: a.approverId && a.approverId !== session.user.id ? [{ field: 'Pour le compte de', from: null, to: all.find((p) => p.id === a.approverId)?.name ?? a.approverText }] : [],
    });
    return ok ? 'ok' as const : 'stale' as const;
  });
  return res === 'stale' ? { error: STALE_EDIT } : done(e.id);
}

/**
 * Effectivité proposée d'après Keystone (projets déclarés, nomenclatures, parc installé) : ajoute les cibles absentes,
 * sans toucher celles déjà présentes ni leurs dispositions. Ordre ouvert seulement ; Keystone indisponible : refus motivé.
 */
export async function proposeEcoEffectivity(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireQhse();
  if (error) return { error };
  const { e, error: loadError } = await loadEcoForWrite(formReader(fd).opt('id'));
  if (!e) return { error: loadError };
  if (!ecoOpen(e.status as EcoStatus)) return { error: 'Ordre libéré ou rejeté : son effectivité ne change plus.' };
  const db = await getDb();
  const proposal = await proposeTargetsFor(db, e.id);
  if (!proposal.ok) return { error: proposal.message };
  const res = await db.transaction(async (tx) => {
    if (await staleEditError(tx, ECO_ENTITY, e.id, fd.get(VERSION_FIELD))) return 'stale' as const;
    const existing = await tx.select().from(t.ecoEffectivity).where(eq(t.ecoEffectivity.ecoId, e.id));
    const key = (x: { targetType: string; targetRef: string }) => `${x.targetType}|${x.targetRef}`;
    const known = new Set(existing.map(key));
    const added = proposal.targets.filter((p) => !known.has(key(p)));
    let pos = Math.max(0, ...existing.map((x) => x.position));
    if (added.length) await tx.insert(t.ecoEffectivity).values(added.map((p) => ({ ecoId: e.id, ...p, position: ++pos })));
    await tx.update(t.ecos).set({ updatedAt: new Date() }).where(eq(t.ecos.id, e.id));
    await logChange(tx, {
      entityType: ECO_ENTITY, entityId: e.id, action: 'effectivity', byId: session.user.id,
      summary: added.length ? `Effectivité proposée d’après Keystone : ${added.length} cible(s) ajoutée(s)` : 'Effectivité proposée d’après Keystone : aucune cible nouvelle',
      details: added.map((p) => ({ field: 'Cible ajoutée', from: null, to: targetText(p) })),
    });
    return 'ok' as const;
  });
  if (res === 'stale') return { error: STALE_EDIT };
  revalidatePath('/', 'layout');
  return { ok: true, id: e.id, message: 'Effectivité proposée d’après Keystone.' };
}

/**
 * Disposition d'une cible (à décider tant que l'ordre est ouvert ; le rétrofit ne vaut que pour une machine), note,
 * échéance et date de réalisation (une mise à jour ou un rétrofit se réalise après la libération). Une disposition décidée
 * peut libérer d'office un ordre approuvé.
 */
export async function saveEffectivityTarget(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireQhse();
  if (error) return { error };
  const f = formReader(fd);
  const targetType = f.oneOf('targetType', ['project', 'machine'] as const, { required: true });
  const targetRef = f.str('targetRef', { required: true, max: 64 });
  const disposition = f.oneOf('disposition', EFFECTIVITY_DISPOSITION_KEYS);
  const note = f.str('note', { max: ECR_TEXT_MAX }) || null;
  const dueOn = f.date('dueOn');
  const doneOn = f.date('doneOn');
  if (doneOn && doneOn > today()) f.fail('doneOn', 'Date de réalisation à venir : pas encore réalisée.');
  if (targetType) {
    const dError = dispositionError(targetType, disposition);
    if (dError) f.fail('disposition', dError);
  }
  if (!f.ok) return f.state();
  const { e, error: loadError } = await loadEcoForWrite(f.opt('id'));
  if (!e) return { error: loadError };
  if (e.status === 'rejected') return { error: 'Ordre rejeté : son effectivité ne change plus.' };
  const db = await getDb();
  const where = and(eq(t.ecoEffectivity.ecoId, e.id), eq(t.ecoEffectivity.targetType, targetType!), eq(t.ecoEffectivity.targetRef, targetRef));
  const [g] = await db.select().from(t.ecoEffectivity).where(where);
  if (!g) return { error: 'Cible introuvable.' };
  const released = e.status === 'released';
  if (released && (disposition ?? null) !== g.disposition) return { error: 'Ordre libéré : la disposition d’une cible ne change plus (échéance et réalisation seulement).' };
  if (!released && doneOn) return { error: TO_FIX, fieldErrors: { doneOn: 'La réalisation se constate une fois l’ordre libéré.' } };
  const res = await db.transaction(async (tx) => {
    if (await staleEditError(tx, ECO_ENTITY, e.id, fd.get(VERSION_FIELD))) return 'stale' as const;
    await tx.update(t.ecoEffectivity).set({ disposition, note, dueOn, doneOn }).where(where);
    await tx.update(t.ecos).set({ updatedAt: new Date() }).where(eq(t.ecos.id, e.id));
    const label = (d: string | null) => (d ? EFFECTIVITY_DISPOSITIONS[d as EffectivityDisposition].label : 'À décider');
    const details = [
      ...(g.disposition !== disposition ? [{ field: 'Disposition', from: label(g.disposition), to: label(disposition) }] : []),
      ...(g.note !== note ? [{ field: 'Note', from: g.note, to: note }] : []),
      ...(g.dueOn !== dueOn ? [{ field: 'Échéance', from: g.dueOn ? fmtDate(g.dueOn) : null, to: dueOn ? fmtDate(dueOn) : null }] : []),
      ...(g.doneOn !== doneOn ? [{ field: 'Réalisée le', from: g.doneOn ? fmtDate(g.doneOn) : null, to: doneOn ? fmtDate(doneOn) : null }] : []),
    ];
    if (details.length) {
      await logChange(tx, { entityType: ECO_ENTITY, entityId: e.id, action: 'effectivity', byId: session.user.id, summary: `Effectivité : ${targetText({ targetType: targetType as EffectivityTarget, label: g.label })}`, details });
    }
    await settleEco(tx, e.id, { byId: session.user.id });
    return 'ok' as const;
  });
  return res === 'stale' ? { error: STALE_EDIT } : done(e.id);
}

/**
 * Annule un ordre non libéré (saisie par erreur, modification abandonnée) : motif obligatoire, publié « rejected », jamais
 * supprimé ; ses demandes acceptées passent refusées et Codex en est prévenu.
 */
export async function cancelEco(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireQhse();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const reason = f.reason();
  if (!f.ok) return f.state();
  const { e, error: loadError } = await loadEcoForWrite(id);
  if (!e) return { error: loadError };
  if (!ecoOpen(e.status as EcoStatus)) return { error: 'Ordre libéré ou rejeté : il ne s’annule plus.' };
  const db = await getDb();
  const ok = await db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx.update(t.ecos).set({ status: 'rejected', rejectedAt: now, cancelledAt: now, cancelledById: session.user.id, cancelReason: reason, updatedAt: now })
      .where(and(eq(t.ecos.id, e.id), isNull(t.ecos.cancelledAt), eq(t.ecos.status, e.status))).returning({ id: t.ecos.id });
    if (!row) return false;
    await logChange(tx, {
      entityType: ECO_ENTITY, entityId: e.id, action: 'cancel', reason, byId: session.user.id, summary: 'Ordre annulé',
      details: [{ field: 'Étape', from: ECO_STATUSES[e.status as EcoStatus].label, to: ECO_STATUSES.rejected.label }],
    });
    await closeLinkedEcrs(tx, e.id, 'cancelled', session.user.id, reason);
    return true;
  });
  return ok ? done(e.id) : { error: 'Ordre déjà annulé ou modifié entre-temps.' };
}
