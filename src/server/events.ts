'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, like } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import {
  FIVE_M, INJURY_KEYS, MAX_BATCH_BYTES, MAX_FILES_PER_BATCH, MAX_PHOTOS, MAX_TREE_LINES, MAX_WHYS,
  advanceBlocker, hasNcOrigin, normalizeTree, type D8Content, type TreeLine,
} from '@/components/events/shared';
import { today } from '@/lib/dates';
import { D8_STEPS, EVENT_STEPS, EVENT_TYPE_KEYS, METHODS, NC_ORIGINS, type AnalysisMethod, type EventType } from '@/lib/domain';
import { formReader, nextRef, type FormState } from '@/lib/forms';
import { requireApprover, requireManager } from '@/lib/guard';
import { ALL_SITES, getSession } from '@/lib/session';
import { checkUpload, deleteAttachment, saveUpload } from '@/lib/uploads';

const METHOD_KEYS = METHODS.map(([k]) => k);
const done = () => revalidatePath('/', 'layout');

// ─── Workflow ───────────────────────────────────────────────────────────────

/** Passe l'événement à l'étape suivante du workflow (règles : action liée pour « Actions », actions clôturées pour « Efficacité vérifiée »). */
export async function advanceEvent(id: string): Promise<{ error?: string }> {
  const { error } = await requireManager();
  if (error) return { error: "Seuls l'animateur QHSE et l'encadrement font avancer un événement." };
  const db = await getDb();
  const [ev] = await db.select().from(t.events).where(eq(t.events.id, id));
  if (!ev) return { error: 'Événement introuvable.' };
  const linked = await db.select({ status: t.actions.status }).from(t.actions).where(eq(t.actions.eventId, id));
  const blocker = advanceBlocker(ev.step, linked);
  if (blocker) return { error: blocker };
  const [row] = await db.update(t.events).set({ step: ev.step + 1 }).where(and(eq(t.events.id, id), eq(t.events.step, ev.step))).returning({ id: t.events.id });
  if (!row) return { error: "L'événement vient d'être modifié par ailleurs : rechargez la page." };
  done();
  return {};
}

/** Ramène l'événement à l'étape précédente (correction d'une erreur de saisie) — animateur QHSE et direction. */
export async function revertEvent(id: string): Promise<{ error?: string }> {
  const { error } = await requireApprover();
  if (error) return { error };
  const db = await getDb();
  const [ev] = await db.select().from(t.events).where(eq(t.events.id, id));
  if (!ev) return { error: 'Événement introuvable.' };
  if (ev.step <= 0) return { error: `L'événement est déjà à l'étape « ${EVENT_STEPS[0]} ».` };
  const [row] = await db.update(t.events).set({ step: ev.step - 1 }).where(and(eq(t.events.id, id), eq(t.events.step, ev.step))).returning({ id: t.events.id });
  if (!row) return { error: "L'événement vient d'être modifié par ailleurs : rechargez la page." };
  done();
  return {};
}

export async function setAnalysisMethod(id: string, method: string): Promise<{ error?: string }> {
  const { error } = await requireManager();
  if (error) return { error };
  if (!METHOD_KEYS.includes(method as AnalysisMethod)) return { error: "Méthode d'analyse inconnue." };
  const db = await getDb();
  await db.update(t.events).set({ analysisMethod: method }).where(eq(t.events.id, id));
  done();
  return {};
}

// ─── Fiche événement ────────────────────────────────────────────────────────

/** Modifie la fiche d'un événement (qualification par l'animateur QHSE ou l'encadrement). */
export async function saveEvent(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const type = f.oneOf('type', EVENT_TYPE_KEYS, { required: true });
  const title = f.str('title', { required: true, max: 200 });
  const occurredOn = f.date('occurredOn', { required: true });
  const location = f.str('location', { required: true, max: 120 });
  const equipment = f.str('equipment', { max: 120 }) || null;
  const keystoneProject = f.opt('keystoneProject');
  const pilotId = f.opt('pilotId');
  const severity = f.int('severity', { required: true, min: 1, max: 4 });
  const siteId = f.str('siteId', { required: true });
  const description = f.str('description', { max: 4000 });
  const immediateMeasures = f.str('immediateMeasures', { max: 4000 });
  const ncOrigin = type && hasNcOrigin(type) ? f.oneOf('ncOrigin', NC_ORIGINS) : null;
  const injury = type === 'AT' ? f.oneOf('injury', INJURY_KEYS) : null;
  const lostDays = injury === 'arret' ? f.int('lostDays', { min: 0, max: 3650 }) : null;
  if (occurredOn && occurredOn > today()) f.fail('occurredOn', "La date ne peut pas être postérieure à aujourd'hui.");
  if (!f.ok) return f.state();

  const db = await getDb();
  const [[ev], sites, people, projects] = await Promise.all([
    db.select().from(t.events).where(eq(t.events.id, id)),
    db.select({ id: t.sites.id }).from(t.sites),
    db.select({ id: t.people.id }).from(t.people),
    db.select({ id: t.keystoneProjects.id, client: t.keystoneProjects.client }).from(t.keystoneProjects),
  ]);
  if (!ev) return { error: 'Événement introuvable.' };
  if (!sites.some((s) => s.id === siteId)) f.fail('siteId', 'Site inconnu.');
  if (pilotId && !people.some((p) => p.id === pilotId)) f.fail('pilotId', 'Personne inconnue.');
  if (keystoneProject && keystoneProject !== ev.keystoneProject && !projects.some((p) => `${p.id} · ${p.client}` === keystoneProject)) {
    f.fail('keystoneProject', 'Projet Keystone inconnu.');
  }
  if (!f.ok) return f.state();

  await db.transaction(async (tx) => {
    await tx.update(t.events).set({
      type: type!, title, occurredOn: occurredOn!, location, equipment, keystoneProject, pilotId, severity: severity!, siteId,
      description, immediateMeasures, ncOrigin, injury, lostDays,
    }).where(eq(t.events.id, id));
    // Les actions rattachées au site de l'événement le suivent s'il change de site.
    if (siteId !== ev.siteId) {
      await tx.update(t.actions).set({ siteId }).where(and(eq(t.actions.eventId, id), eq(t.actions.siteId, ev.siteId)));
    }
  });
  done();
  return { ok: true, id };
}

// ─── Analyse des causes ─────────────────────────────────────────────────────

const texts = (fd: FormData, name: string) => fd.getAll(name).map((v) => (typeof v === 'string' ? v.trim() : ''));

/** Enregistre le contenu de l'analyse des causes pour la méthode donnée (formats lus par la fiche événement). */
export async function saveAnalysis(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const eventId = f.str('eventId', { required: true });
  const method = f.oneOf('method', METHOD_KEYS, { required: true });
  if (!f.ok || !method) return { error: 'Analyse introuvable.' };

  let content: unknown;
  if (method === '5m') {
    const rows = FIVE_M.map((cat, i) => [cat, f.str(`m${i}`, { max: 1000 })] as [string, string]);
    if (!f.ok) return f.state();
    const filled = rows.filter(([, v]) => v);
    content = filled.length ? filled : null;
  } else if (method === 'tree') {
    const labels = texts(fd, 'tree_text');
    const levels = fd.getAll('tree_level');
    const mains = fd.getAll('tree_main');
    if (labels.some((l) => l.length > 300)) return { error: "Chaque ligne de l'arbre est limitée à 300 caractères." };
    const lines = labels
      .map((text, i) => ({ level: Number(levels[i]) || 0, text, main: mains[i] === '1' }))
      .filter((l) => l.text);
    if (lines.length > MAX_TREE_LINES) return { error: `L'arbre des causes est limité à ${MAX_TREE_LINES} lignes.` };
    content = lines.length ? normalizeTree(lines).map((l) => [l.level, l.text, l.main] as TreeLine) : null;
  } else if (method === 'why') {
    const whys = texts(fd, 'why').filter(Boolean);
    if (whys.length > MAX_WHYS) return { error: `${MAX_WHYS} « pourquoi » au maximum.` };
    if (whys.some((w) => w.length > 300)) return { error: 'Chaque « pourquoi » est limité à 300 caractères.' };
    content = whys.length ? whys : null;
  } else {
    const current = f.int('current', { required: true, min: 0, max: D8_STEPS.length });
    const notes = texts(fd, 'note').slice(0, D8_STEPS.length);
    if (notes.some((n) => n.length > 1000)) return { error: 'Chaque note est limitée à 1 000 caractères.' };
    if (!f.ok) return f.state();
    const value: D8Content = { current: current! };
    if (notes.some(Boolean)) value.notes = D8_STEPS.map((_, i) => notes[i] ?? '');
    content = value;
  }

  const db = await getDb();
  const [ev] = await db.select({ id: t.events.id }).from(t.events).where(eq(t.events.id, eventId));
  if (!ev) return { error: 'Événement introuvable.' };
  const key = and(eq(t.eventAnalyses.eventId, eventId), eq(t.eventAnalyses.method, method));
  if (content === null) {
    await db.delete(t.eventAnalyses).where(key);
  } else {
    await db.insert(t.eventAnalyses).values({ eventId, method, content })
      .onConflictDoUpdate({ target: [t.eventAnalyses.eventId, t.eventAnalyses.method], set: { content } });
  }
  done();
  return { ok: true, id: eventId };
}

// ─── Pièces jointes ─────────────────────────────────────────────────────────

/** Ajoute des photos ou documents à un événement (champ `files`, multipart). */
export async function addEventFiles(fd: FormData): Promise<{ error?: string; count?: number }> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const eventId = f.str('eventId', { required: true });
  const files = f.files('files');
  if (!files.length) return { error: 'Choisissez au moins un fichier.' };
  if (files.length > MAX_FILES_PER_BATCH) return { error: `${MAX_FILES_PER_BATCH} fichiers au maximum par envoi.` };
  if (files.reduce((s, x) => s + x.size, 0) > MAX_BATCH_BYTES) return { error: `L'envoi dépasse ${MAX_BATCH_BYTES / 1024 / 1024} Mo : ajoutez les fichiers en plusieurs fois.` };
  const invalid = files.map(checkUpload).find(Boolean);
  if (invalid) return { error: invalid };
  const db = await getDb();
  const [ev] = await db.select({ id: t.events.id }).from(t.events).where(eq(t.events.id, eventId));
  if (!ev) return { error: 'Événement introuvable.' };
  for (const file of files) await saveUpload(file, 'event', eventId, session.user.id);
  done();
  return { count: files.length };
}

export async function removeEventFile(attachmentId: string): Promise<{ error?: string }> {
  const { error } = await requireManager();
  if (error) return { error };
  const db = await getDb();
  const [row] = await db.select({ entityType: t.attachments.entityType }).from(t.attachments).where(eq(t.attachments.id, attachmentId));
  if (!row || row.entityType !== 'event') return { error: 'Pièce jointe introuvable.' };
  await deleteAttachment(attachmentId);
  done();
  return {};
}

// ─── Signalement terrain ────────────────────────────────────────────────────

export type ReportResult = { id?: string; error?: string; warning?: string };

/**
 * Signalement terrain (formulaire mobile, tous rôles) : crée l'événement à l'étape « Déclaré »
 * et enregistre les photos jointes (champ `photos`, 4 au maximum).
 */
export async function createReport(fd: FormData): Promise<ReportResult> {
  const f = formReader(fd);
  const type = f.str('type');
  if (!(EVENT_TYPE_KEYS as string[]).includes(type)) return { error: 'Choisissez le type de signalement.' };
  const description = f.str('description');
  if (!description) return { error: "Décrivez ce qui s'est passé." };
  if (description.length > 4000) return { error: 'La description est limitée à 4 000 caractères.' };
  const location = f.str('location').slice(0, 120) || 'Lieu non précisé';
  const gravity = f.opt('gravity');
  const anonymous = f.bool('anonymous');
  const photos = f.files('photos');
  if (photos.length > MAX_PHOTOS) return { error: `${MAX_PHOTOS} photos au maximum.` };
  if (photos.reduce((s, p) => s + p.size, 0) > MAX_BATCH_BYTES) return { error: 'Les photos sont trop lourdes : retirez-en une.' };
  for (const p of photos) {
    if (!p.type.startsWith('image/')) return { error: `« ${p.name} » n'est pas une photo.` };
    const err = checkUpload(p);
    if (err) return { error: err };
  }

  const { user, site, siteOptions } = await getSession();
  const db = await getDb();
  const now = today();
  const prefix = `EV-${now.slice(0, 4)}-`;
  const existing = await db.select({ id: t.events.id }).from(t.events).where(like(t.events.id, `${prefix}%`));
  const id = nextRef(existing.map((e) => e.id), prefix);
  const firstSentence = description.split(/(?<=[.!?])\s/)[0];
  const title = firstSentence.length > 90 ? `${firstSentence.slice(0, 87)}…` : firstSentence;
  const severity = gravity === 'Oui' ? 3 : gravity === 'Peut-être' ? 2 : 1;
  await db.insert(t.events).values({
    id,
    siteId: site.id === ALL_SITES ? siteOptions[0].id : site.id,
    type: type as EventType,
    title,
    occurredOn: now,
    location,
    declarant: anonymous ? null : user.name,
    anonymous,
    severity,
    step: 0,
    description,
  });

  // Signalement anonyme : la photo n'est pas non plus rattachée à son auteur.
  let warning: string | undefined;
  for (const p of photos) {
    try {
      await saveUpload(p, 'event', id, anonymous ? null : user.id);
    } catch {
      warning = "Le signalement est enregistré, mais une photo n'a pas pu l'être : transmettez-la à l'animateur QHSE.";
    }
  }
  done();
  return { id, warning };
}
