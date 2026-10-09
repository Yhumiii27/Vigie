'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, eq, gte } from 'drizzle-orm';
import { coversNeed } from '@/components/skills/rules';
import { getDb, schema as t } from '@/db';
import { addDays, addMonths, today } from '@/lib/dates';
import { formReader, type FormState } from '@/lib/forms';
import { requireManager } from '@/lib/guard';

// Habilitations et formations : formations suivies, exigences par salarié, personnel et titres suivis.

const clean = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Identifiant libre dérivé de `base` (suffixe numérique en cas de doublon). */
function uniqueId(base: string, existing: Set<string>, sep = '') {
  let id = base;
  for (let n = 2; existing.has(id); n++) id = `${base}${sep}${n}`;
  return id;
}

/** « [T. Nguyen] » → tnguyen, « Jean-Marc Dupont » → jdupont (convention des identifiants du personnel). */
function personSlug(name: string) {
  const words = clean(name).replace(/[^a-z0-9\s.-]/g, ' ').split(/[\s.]+/).filter(Boolean);
  if (!words.length) return 'salarie';
  const slug = words.length === 1 ? words[0] : words[0][0] + words[words.length - 1];
  return slug.replace(/[^a-z0-9]/g, '').slice(0, 24) || 'salarie';
}

const titleSlug = (label: string) => clean(label).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'titre';

/**
 * Enregistre une formation (crée ou remplace la qualification du salarié pour ce titre).
 * Le titre devient requis pour le salarié s'il ne l'était pas ; l'échéance vaut obtention + validité du titre si elle est laissée vide.
 * `closeRenewal` fait passer l'action de recyclage rattachée à « Efficacité à vérifier », seulement si la formation
 * règle le besoin (titre valide au-delà de 60 jours et couvrant les affectations Keystone à venir) : sinon l'action reste à réaliser.
 */
export async function saveQualification(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const personId = f.str('personId', { required: true });
  const titleId = f.str('titleId', { required: true });
  const obtainedOn = f.date('obtainedOn', { required: true });
  let expiresOn = f.date('expiresOn');
  const provider = f.str('provider', { max: 120 }) || null;
  const closeRenewal = f.bool('closeRenewal');
  const now = today();
  if (obtainedOn && obtainedOn > now) f.fail('obtainedOn', "La date d'obtention ne peut pas être postérieure à aujourd'hui.");
  if (obtainedOn && expiresOn && expiresOn <= obtainedOn) f.fail('expiresOn', "L'échéance doit suivre la date d'obtention.");
  if (!f.ok) return f.state();

  const db = await getDb();
  const [[person], [title], upcoming] = await Promise.all([
    db.select({ id: t.people.id }).from(t.people).where(eq(t.people.id, personId)),
    db.select().from(t.trainingTitles).where(eq(t.trainingTitles.id, titleId)),
    db.select({ startOn: t.keystoneAssignments.startOn, endOn: t.keystoneAssignments.endOn }).from(t.keystoneAssignments)
      .where(and(eq(t.keystoneAssignments.personId, personId), gte(t.keystoneAssignments.endOn, now)))
      .orderBy(asc(t.keystoneAssignments.startOn)),
  ]);
  if (!person) return { error: 'Salarié introuvable.', fieldErrors: { personId: 'Salarié introuvable.' } };
  if (!title) return { error: 'Titre introuvable.', fieldErrors: { titleId: 'Titre introuvable.' } };
  if (!expiresOn && title.validityMonths > 0) expiresOn = addMonths(obtainedOn!, title.validityMonths);

  const values = { obtainedOn: obtainedOn!, expiresOn, provider };
  await db.transaction(async (tx) => {
    await tx.insert(t.qualifications).values({ personId, titleId, ...values })
      .onConflictDoUpdate({ target: [t.qualifications.personId, t.qualifications.titleId], set: values });
    await tx.insert(t.qualificationRequirements).values({ personId, titleId }).onConflictDoNothing();
    // Formation ancienne ou trop courte : le recyclage reste à réaliser (case masquée côté formulaire).
    if (!closeRenewal || !coversNeed(expiresOn, upcoming, now)) return;
    const [req] = await tx.select({ actionId: t.qualificationRequirements.renewalActionId }).from(t.qualificationRequirements)
      .where(and(eq(t.qualificationRequirements.personId, personId), eq(t.qualificationRequirements.titleId, titleId)));
    if (!req?.actionId) return;
    const [action] = await tx.select().from(t.actions).where(eq(t.actions.id, req.actionId));
    if (action && (action.status === 'todo' || action.status === 'doing')) {
      await tx.update(t.actions).set({ status: 'verify', verifyDueOn: action.verifyDueOn ?? addDays(now, 30), closedOn: null }).where(eq(t.actions.id, action.id));
    }
  });
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Rend un titre requis (ou non) pour un salarié. Les formations déjà enregistrées sont conservées.
 * Retirer l'exigence est refusé tant que l'action de recyclage rattachée est ouverte (le lien serait perdu).
 */
export async function setRequirement(personId: string, titleId: string, required: boolean): Promise<{ error?: string }> {
  const { error } = await requireManager();
  if (error) return { error };
  const db = await getDb();
  const [[person], [title]] = await Promise.all([
    db.select({ id: t.people.id }).from(t.people).where(eq(t.people.id, personId)),
    db.select({ id: t.trainingTitles.id }).from(t.trainingTitles).where(eq(t.trainingTitles.id, titleId)),
  ]);
  if (!person || !title) return { error: 'Salarié ou titre introuvable.' };
  const where = and(eq(t.qualificationRequirements.personId, personId), eq(t.qualificationRequirements.titleId, titleId));
  if (required) {
    await db.insert(t.qualificationRequirements).values({ personId, titleId }).onConflictDoNothing();
  } else {
    const [req] = await db.select({ actionId: t.qualificationRequirements.renewalActionId }).from(t.qualificationRequirements).where(where);
    const [action] = req?.actionId
      ? await db.select({ id: t.actions.id, status: t.actions.status }).from(t.actions).where(eq(t.actions.id, req.actionId))
      : [];
    if (action && action.status !== 'done') {
      return { error: `L'action ${action.id} (recyclage) est encore ouverte : clôturez-la avant de retirer l'exigence.` };
    }
    await db.delete(t.qualificationRequirements).where(where);
  }
  revalidatePath('/', 'layout');
  return {};
}

/** Ajoute ou modifie un salarié (saisie provisoire, en attendant le connecteur Cursus). */
export async function savePerson(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireManager();
  if (error) return { error };
  const db = await getDb();
  const [sites, people] = await Promise.all([
    db.select({ id: t.sites.id }).from(t.sites),
    db.select({ id: t.people.id, name: t.people.name, sort: t.people.sort }).from(t.people),
  ]);
  const f = formReader(fd);
  const id = f.opt('id');
  const name = f.str('name', { required: true, max: 80 });
  const job = f.str('job', { max: 80 });
  const siteId = f.oneOf('siteId', sites.map((s) => s.id), { required: true });
  const inSkillsMatrix = f.bool('inSkillsMatrix');
  if (name && people.some((p) => p.id !== id && clean(p.name) === clean(name))) f.fail('name', 'Un salarié porte déjà ce nom.');
  if (!f.ok) return f.state();

  const values = { name, job, siteId, inSkillsMatrix };
  if (id) {
    const [row] = await db.update(t.people).set(values).where(eq(t.people.id, id)).returning({ id: t.people.id });
    if (!row) return { error: 'Salarié introuvable.' };
    revalidatePath('/', 'layout');
    return { ok: true, id };
  }
  const newId = uniqueId(personSlug(name), new Set(people.map((p) => p.id)));
  const sort = Math.max(-1, ...people.map((p) => p.sort)) + 1;
  await db.insert(t.people).values({ id: newId, ...values, sort });
  revalidatePath('/', 'layout');
  return { ok: true, id: newId };
}

/** Ajoute un titre suivi ou modifie son intitulé et sa durée de validité (les échéances enregistrées ne sont pas recalculées). */
export async function saveTitle(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireManager();
  if (error) return { error };
  const db = await getDb();
  const titles = await db.select().from(t.trainingTitles);
  const f = formReader(fd);
  const id = f.opt('id');
  const label = f.str('label', { required: true, max: 60 });
  const validityMonths = f.int('validityMonths', { required: true, min: 0, max: 240 });
  if (label && titles.some((x) => x.id !== id && clean(x.label) === clean(label))) f.fail('label', 'Ce titre est déjà suivi.');
  if (!f.ok) return f.state();

  if (id) {
    const [row] = await db.update(t.trainingTitles).set({ label, validityMonths: validityMonths! }).where(eq(t.trainingTitles.id, id)).returning({ id: t.trainingTitles.id });
    if (!row) return { error: 'Titre introuvable.' };
    revalidatePath('/', 'layout');
    return { ok: true, id };
  }
  const newId = uniqueId(titleSlug(label), new Set(titles.map((x) => x.id)), '-');
  const sort = Math.max(-1, ...titles.map((x) => x.sort)) + 1;
  await db.insert(t.trainingTitles).values({ id: newId, label, validityMonths: validityMonths!, sort });
  revalidatePath('/', 'layout');
  return { ok: true, id: newId };
}
