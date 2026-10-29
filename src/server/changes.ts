'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { fmtDate } from '@/lib/dates';
import { CHANGE_KINDS, CHANGE_KIND_KEYS, CHANGE_STATUS, canEdit, type ChangeKind, type ChangeStatus } from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireApprover, requireInSite, requireManager } from '@/lib/guard';
import { hasLeft } from '@/lib/people';
import { ALL_SITES } from '@/lib/session';
import { today } from '@/lib/today';
import { diffFields, logChange } from './changelog';
import { nextEntityReference } from './references';
import { STALE_EDIT, VERSION_FIELD, staleEditError } from './versions';

// Gestion des changements (CNF-11, ISO 9001 §6.3 et §8.5.6, ISO 45001 §8.1.3). Demande saisie par les rôles qui saisissent
// sur l'écran Audits (animateur QHSE, direction) ; décision (acceptée, refusée : motivée) et annulation (motif) par les
// mêmes, approbateurs ; mise en œuvre constatée (date, constat). Jamais supprimée ; journal `change_request` dans la
// transaction de chaque écriture ; site de la demande (null : entreprise) contrôlé par requireInSite.

const ENTITY = 'change_request';
const NOT_FOUND = 'Demande de changement introuvable.';

async function requireChangeEditor() {
  const r = await requireManager();
  if (r.error) return r;
  return canEdit(r.session.role, 'audits') ? r : { ...r, error: 'Votre rôle ne permet pas cette modification.' };
}

/** Demande chargée pour une écriture : existante, du site sélectionné et du périmètre, non annulée. */
async function loadForWrite(id: string) {
  const db = await getDb();
  const [c] = await db.select().from(t.changeRequests).where(eq(t.changeRequests.id, id));
  if (!c) return { c: null, error: NOT_FOUND };
  const siteError = await requireInSite(c.siteId);
  if (siteError) return { c: null, error: siteError };
  if (c.cancelledAt) return { c: null, error: 'Demande annulée : elle reste consultable avec son historique.' };
  return { c, error: null };
}

const LABELS = {
  kind: 'Nature', title: 'Changement', description: 'Description', rationale: 'Motif du changement', impacts: 'Effets évalués',
  pilot: 'Pilote', plannedOn: 'Mise en œuvre prévue le', site: 'Site',
} as const;

/**
 * Crée ou modifie une demande de changement : nature, intitulé, description, motif, effets évalués (risques et
 * opportunités, ressources, exigences, documents), pilote présent (ou celui déjà enregistré), date de mise en œuvre
 * prévue, site (« Tous les sites » : entreprise, périmètre complet). Modifiable tant qu'elle n'est ni refusée ni mise en
 * œuvre ; contrôle de version (QUA-12).
 */
export async function saveChangeRequest(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireChangeEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const kind = f.oneOf('kind', CHANGE_KIND_KEYS, { required: true });
  const title = f.str('title', { required: true, max: 160 });
  const description = f.str('description', { required: true, max: 2000 });
  const rationale = f.str('rationale', { max: 2000 });
  const impacts = f.str('impacts', { max: 2000 });
  const pilotId = f.opt('pilotId');
  const plannedOn = f.date('plannedOn');
  const site = f.str('siteId');
  const siteId = !site || site === ALL_SITES ? null : site;
  if (!f.ok) return f.state();
  const loaded = id ? await loadForWrite(id) : null;
  if (loaded?.error) return { error: loaded.error };
  const current = loaded?.c ?? null;
  if (current && (current.status === 'refusee' || current.status === 'realisee')) return { error: `Demande ${CHANGE_STATUS[current.status as ChangeStatus].label.toLowerCase()} : elle ne se modifie plus.` };
  if (!current || current.siteId !== siteId) {
    const siteError = await requireInSite(siteId, { create: true });
    if (siteError) return { error: siteError, fieldErrors: { siteId: siteError } };
  }
  const db = await getDb();
  const now = today();
  const [people, sites] = await Promise.all([
    db.select({ id: t.people.id, name: t.people.name, leftOn: t.people.leftOn }).from(t.people),
    db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites),
  ]);
  if (pilotId) {
    const p = people.find((x) => x.id === pilotId);
    if (!p) return { error: 'Certains champs sont à corriger.', fieldErrors: { pilotId: 'Choisissez une personne de la liste.' } };
    if (hasLeft(p, now) && pilotId !== current?.pilotId) return { error: 'Certains champs sont à corriger.', fieldErrors: { pilotId: "Personne sortie de l'effectif : choisissez une personne présente." } };
  }
  const values = { kind: kind!, title, description, rationale, impacts, pilotId, plannedOn, siteId };
  const byId = session.user.id;
  if (current) {
    const shown = (v: Omit<typeof values, 'kind'> & { kind: string }) => ({
      ...v, kind: CHANGE_KINDS[v.kind as ChangeKind]?.label ?? v.kind, plannedOn: v.plannedOn ? fmtDate(v.plannedOn) : null,
      pilot: people.find((p) => p.id === v.pilotId)?.name ?? null, site: v.siteId ? sites.find((x) => x.id === v.siteId)?.label ?? v.siteId : 'Tous les sites',
    });
    const res = await db.transaction(async (tx) => {
      if (await staleEditError(tx, ENTITY, current.id, fd.get(VERSION_FIELD))) return 'stale' as const;
      await tx.update(t.changeRequests).set(values).where(eq(t.changeRequests.id, current.id));
      const details = diffFields(shown({ ...current }), shown(values), LABELS);
      if (details.length) await logChange(tx, { entityType: ENTITY, entityId: current.id, action: 'update', byId, summary: 'Demande de changement modifiée', details });
      return 'ok' as const;
    });
    if (res === 'stale') return { error: STALE_EDIT };
    revalidatePath('/', 'layout');
    return { ok: true, id: current.id };
  }
  const newId = await db.transaction(async (tx) => {
    const ref = await nextEntityReference(tx, 'change_request', 'MC-', 3);
    await tx.insert(t.changeRequests).values({ id: ref, ...values, createdById: byId });
    await logChange(tx, { entityType: ENTITY, entityId: ref, action: 'create', byId, summary: `Demande de changement enregistrée : ${title}` });
    return ref;
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: newId };
}

/**
 * Décision sur une demande à évaluer (animateur QHSE, direction) : acceptée ou refusée, date (au plus aujourd'hui) et
 * justification obligatoires ; une demande acceptée peut fixer la date de mise en œuvre prévue.
 */
export async function decideChangeRequest(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const decision = f.oneOf('decision', ['acceptee', 'refusee'] as const, { required: true });
  const decidedOn = f.date('decidedOn', { required: true });
  const note = f.str('decisionNote', { required: true, max: 2000 });
  const plannedOn = decision === 'acceptee' ? f.date('plannedOn') : null;
  if (decidedOn && decidedOn > today()) f.fail('decidedOn', 'Date postérieure à aujourd’hui.');
  if (plannedOn && decidedOn && plannedOn < decidedOn) f.fail('plannedOn', 'La mise en œuvre suit la décision.');
  if (!f.ok) return f.state();
  const { c, error: loadError } = await loadForWrite(id);
  if (!c) return { error: loadError };
  if (c.status !== 'demandee') return { error: 'Décision déjà prise sur cette demande.' };
  const db = await getDb();
  const done = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.changeRequests)
      .set({ status: decision!, decidedOn, decidedById: session.user.id, decisionNote: note, ...(plannedOn ? { plannedOn } : {}) })
      .where(and(eq(t.changeRequests.id, c.id), eq(t.changeRequests.status, 'demandee'), isNull(t.changeRequests.cancelledAt))).returning({ id: t.changeRequests.id });
    if (!row) return false;
    await logChange(tx, {
      entityType: ENTITY, entityId: c.id, action: 'status', byId: session.user.id,
      summary: `Changement ${decision === 'acceptee' ? 'accepté' : 'refusé'} le ${fmtDate(decidedOn!)}`,
      details: [{ field: 'Décision', from: null, to: note }, ...(plannedOn && plannedOn !== c.plannedOn ? [{ field: 'Mise en œuvre prévue le', from: c.plannedOn ? fmtDate(c.plannedOn) : null, to: fmtDate(plannedOn) }] : [])],
    });
    return true;
  });
  if (!done) return { error: 'Décision déjà prise sur cette demande.' };
  revalidatePath('/', 'layout');
  return { ok: true, id: c.id };
}

/** Mise en œuvre constatée d'un changement accepté (rôles qui saisissent) : date (au plus aujourd'hui) et constat obligatoires. */
export async function completeChangeRequest(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireChangeEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const doneOn = f.date('doneOn', { required: true });
  const doneNote = f.str('doneNote', { required: true, max: 2000 });
  if (doneOn && doneOn > today()) f.fail('doneOn', 'Date postérieure à aujourd’hui.');
  if (!f.ok) return f.state();
  const { c, error: loadError } = await loadForWrite(id);
  if (!c) return { error: loadError };
  if (c.status !== 'acceptee') return { error: 'Seul un changement accepté se déclare mis en œuvre.' };
  if (c.decidedOn && doneOn! < c.decidedOn) return { error: 'Certains champs sont à corriger.', fieldErrors: { doneOn: `Au plus tôt le ${fmtDate(c.decidedOn)} (décision).` } };
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(t.changeRequests).set({ status: 'realisee', doneOn, doneNote }).where(eq(t.changeRequests.id, c.id));
    await logChange(tx, { entityType: ENTITY, entityId: c.id, action: 'status', byId: session.user.id, summary: `Changement mis en œuvre le ${fmtDate(doneOn!)}`, details: [{ field: 'Constat', from: null, to: doneNote }] });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: c.id };
}

/** Annule une demande saisie par erreur ou sans objet (motif obligatoire, jamais supprimée) : animateur QHSE et direction. */
export async function cancelChangeRequest(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const { c, error: loadError } = await loadForWrite(id);
  if (!c) return { error: loadError };
  if (c.status === 'realisee') return { error: 'Changement mis en œuvre : il reste au registre.' };
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(t.changeRequests).set({ cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason }).where(eq(t.changeRequests.id, c.id));
    await logChange(tx, { entityType: ENTITY, entityId: c.id, action: 'cancel', reason, byId: session.user.id, summary: 'Demande de changement annulée' });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: c.id };
}
