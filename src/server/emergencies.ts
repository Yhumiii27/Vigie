'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { fmtDate } from '@/lib/dates';
import { canEdit } from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireApprover, requireInSite, requireManager } from '@/lib/guard';
import { hasLeft } from '@/lib/people';
import { today } from '@/lib/today';
import { diffFields, logChange } from './changelog';
import { STALE_EDIT, VERSION_FIELD, staleEditError } from './versions';

// Situations d'urgence (CNF-08, ISO 45001 §8.2, ISO 14001 §8.2) : identification par site, moyens et consignes,
// périodicité des exercices, exercices tenus. Saisie : rôles qui modifient l'écran « Évaluation des risques »
// (canEdit(role, 'risks')) ; archivage d'une situation et annulation d'un exercice : animateur QHSE et direction, motif
// obligatoire. Jamais de suppression ; journal `emergency_situation` dans la transaction de chaque écriture.

const ENTITY = 'emergency_situation';
const NOT_FOUND = "Situation d'urgence introuvable.";
const ARCHIVED = "Situation archivée : elle reste consultable avec son historique.";

async function requireRiskEditor() {
  const r = await requireManager();
  if (r.error) return r;
  return canEdit(r.session.role, 'risks') ? r : { ...r, error: 'Votre rôle ne permet pas cette modification.' };
}

/** Situation chargée pour une écriture : existante, du site sélectionné et du périmètre (requireInSite). */
async function loadForWrite(id: number) {
  const db = await getDb();
  const [s] = await db.select().from(t.emergencySituations).where(eq(t.emergencySituations.id, id));
  if (!s) return { s: null, error: NOT_FOUND };
  const siteError = await requireInSite(s.siteId);
  if (siteError) return { s: null, error: siteError };
  return { s, error: null };
}

const LABELS = {
  label: 'Situation', siteId: 'Site', scenario: 'Scénario', response: 'Moyens et consignes', drillMonths: 'Périodicité des exercices (mois)',
  nextDrillOn: 'Exercice planifié le', owner: 'Responsable',
} as const;

/**
 * Crée ou modifie une situation d'urgence : site (requireInSite, création ou changement de site), intitulé, scénario,
 * moyens et consignes, périodicité des exercices (1 à 60 mois), exercice planifié (facultatif, pas dans le passé),
 * responsable présent (ou celui déjà enregistré). Modification : contrôle de version (QUA-12).
 */
export async function saveEmergencySituation(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireRiskEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { min: 1 });
  const siteId = f.str('siteId', { required: true });
  const label = f.str('label', { required: true, max: 160 });
  const scenario = f.str('scenario', { max: 2000 });
  const response = f.str('response', { max: 2000 });
  const drillMonths = f.int('drillMonths', { required: true, min: 1, max: 60 });
  const nextDrillOn = f.date('nextDrillOn');
  const ownerId = f.opt('ownerId');
  const now = today();
  if (!f.ok) return f.state();
  const loaded = id ? await loadForWrite(id) : null;
  if (loaded?.error) return { error: loaded.error };
  const current = loaded?.s ?? null;
  if (current?.archivedAt) return { error: ARCHIVED };
  if (nextDrillOn && nextDrillOn < now && nextDrillOn !== current?.nextDrillOn) return { error: 'Certains champs sont à corriger.', fieldErrors: { nextDrillOn: 'Date passée : enregistrez plutôt l’exercice tenu.' } };
  if (!current || current.siteId !== siteId) {
    const siteError = await requireInSite(siteId, { create: true });
    if (siteError) return { error: siteError, fieldErrors: { siteId: siteError } };
  }
  const db = await getDb();
  const people = await db.select({ id: t.people.id, name: t.people.name, leftOn: t.people.leftOn }).from(t.people);
  if (ownerId) {
    const p = people.find((x) => x.id === ownerId);
    if (!p) return { error: 'Certains champs sont à corriger.', fieldErrors: { ownerId: 'Choisissez une personne de la liste.' } };
    if (hasLeft(p, now) && ownerId !== current?.ownerId) return { error: 'Certains champs sont à corriger.', fieldErrors: { ownerId: "Personne sortie de l'effectif : choisissez une personne présente." } };
  }
  const values = { siteId, label, scenario, response, drillMonths: drillMonths!, nextDrillOn, ownerId };
  const byId = session.user.id;
  if (current) {
    const shown = (v: typeof values) => ({ ...v, drillMonths: String(v.drillMonths), nextDrillOn: v.nextDrillOn ? fmtDate(v.nextDrillOn) : null, owner: people.find((p) => p.id === v.ownerId)?.name ?? null });
    const res = await db.transaction(async (tx) => {
      if (await staleEditError(tx, ENTITY, current.id, fd.get(VERSION_FIELD))) return 'stale' as const;
      await tx.update(t.emergencySituations).set(values).where(eq(t.emergencySituations.id, current.id));
      const details = diffFields(shown({ ...current }), shown(values), LABELS);
      if (details.length) await logChange(tx, { entityType: ENTITY, entityId: current.id, action: 'update', byId, summary: "Situation d'urgence modifiée", details });
      return 'ok' as const;
    });
    if (res === 'stale') return { error: STALE_EDIT };
    revalidatePath('/', 'layout');
    return { ok: true, id: String(current.id) };
  }
  const newId = await db.transaction(async (tx) => {
    const [row] = await tx.insert(t.emergencySituations).values({ ...values, createdById: byId }).returning({ id: t.emergencySituations.id });
    await logChange(tx, { entityType: ENTITY, entityId: row.id, action: 'create', byId, summary: `Situation d'urgence identifiée : ${label} (exercice tous les ${drillMonths} mois)` });
    return row.id;
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(newId) };
}

/**
 * Enregistre un exercice tenu : date (au plus aujourd'hui), participants, déroulement et enseignements. Un exercice planifié
 * à cette date ou avant est réputé tenu (date planifiée effacée). Journal de la situation.
 */
export async function recordEmergencyDrill(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireRiskEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('situationId', { required: true, min: 1 });
  const heldOn = f.date('heldOn', { required: true });
  const participants = f.str('participants', { required: true, max: 1000 });
  const findings = f.str('findings', { required: true, max: 2000 });
  if (heldOn && heldOn > today()) f.fail('heldOn', 'Exercice à venir : planifiez-le dans la fiche de la situation.');
  if (!f.ok) return f.state();
  const { s, error: loadError } = await loadForWrite(id!);
  if (!s) return { error: loadError };
  if (s.archivedAt) return { error: ARCHIVED };
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.insert(t.emergencyDrills).values({ situationId: s.id, heldOn: heldOn!, participants, findings, createdById: session.user.id });
    if (s.nextDrillOn && s.nextDrillOn <= heldOn!) await tx.update(t.emergencySituations).set({ nextDrillOn: null }).where(eq(t.emergencySituations.id, s.id));
    await logChange(tx, { entityType: ENTITY, entityId: s.id, action: 'drill', byId: session.user.id, summary: `Exercice tenu le ${fmtDate(heldOn!)}`, details: [{ field: 'Enseignements', from: null, to: findings }] });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(s.id) };
}

/** Annule un exercice saisi par erreur (motif obligatoire, jamais supprimé) : animateur QHSE et direction. */
export async function cancelEmergencyDrill(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [drill] = await db.select().from(t.emergencyDrills).where(eq(t.emergencyDrills.id, id!));
  if (!drill) return { error: 'Exercice introuvable.' };
  const { s, error: loadError } = await loadForWrite(drill.situationId);
  if (!s) return { error: loadError };
  const done = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.emergencyDrills).set({ cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason })
      .where(and(eq(t.emergencyDrills.id, drill.id), isNull(t.emergencyDrills.cancelledAt))).returning({ id: t.emergencyDrills.id });
    if (!row) return false;
    await logChange(tx, { entityType: ENTITY, entityId: s.id, action: 'cancel', reason, byId: session.user.id, summary: `Exercice du ${fmtDate(drill.heldOn)} annulé` });
    return true;
  });
  if (!done) return { error: 'Exercice déjà annulé.' };
  revalidatePath('/', 'layout');
  return { ok: true, id: String(s.id) };
}

/** Archive une situation qui n'a plus lieu d'être (installation retirée…), motif obligatoire : animateur QHSE et direction. */
export async function archiveEmergencySituation(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const { s, error: loadError } = await loadForWrite(id!);
  if (!s) return { error: loadError };
  if (s.archivedAt) return { error: 'Situation déjà archivée.' };
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(t.emergencySituations).set({ archivedAt: new Date(), archivedById: session.user.id, archiveReason: reason }).where(eq(t.emergencySituations.id, s.id));
    await logChange(tx, { entityType: ENTITY, entityId: s.id, action: 'archive', reason, byId: session.user.id, summary: "Situation d'urgence archivée" });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(s.id) };
}
