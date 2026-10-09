'use server';

import { revalidatePath } from 'next/cache';
import { eq, max } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { addMonths, today } from '@/lib/dates';
import { buildDuerpSnapshot, DUERP_RETENTION, versionComment, versionConflict } from '@/lib/data/risks';
import { canSee } from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireApprover, requireManager } from '@/lib/guard';

const SCALE = { required: true, min: 1, max: 4 } as const;

/**
 * Saisie du DUERP : rôle d'encadrement ET accès à l'écran « Évaluation des risques »
 * (le chef de projet peut saisir ailleurs mais ne voit pas le DUERP).
 */
async function requireRiskEditor() {
  const { session, error } = await requireManager();
  if (error) return { session, error };
  if (!canSee(session.role, 'risks')) return { session, error: 'Votre rôle ne permet pas cette modification.' };
  return { session, error: null };
}

/** Violation de clé unique (numéro de version créé entre-temps par une autre soumission). */
const isUniqueViolation = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: unknown } | null;
  return !!e && (e.code === '23505' || (e.cause != null && isUniqueViolation(e.cause)));
};

// ─── Risques ─────────────────────────────────────────────────────────────────

/** Crée ou modifie un risque d'une unité de travail (cotation brute et résiduelle). */
export async function saveRisk(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireRiskEditor();
  if (error) return { error };
  const f = formReader(fd);
  const rawId = f.opt('id');
  const id = rawId ? Number(rawId) : null;
  const unitId = f.str('unitId', { required: true });
  const hazard = f.str('hazard', { required: true, max: 120 });
  const situation = f.str('situation', { required: true, max: 500 });
  const gravity = f.int('gravity', SCALE);
  const probability = f.int('probability', SCALE);
  const existingMeasures = f.str('existingMeasures', { max: 1000 });
  const residualGravity = f.int('residualGravity', SCALE);
  const residualProbability = f.int('residualProbability', SCALE);
  if (gravity && residualGravity && residualGravity > gravity) f.fail('residualGravity', 'Pas plus que la gravité brute.');
  if (probability && residualProbability && residualProbability > probability) f.fail('residualProbability', 'Pas plus que la probabilité brute.');
  if (!f.ok) return f.state();
  if (rawId && !Number.isInteger(id)) return { error: 'Risque introuvable.' };

  const db = await getDb();
  const [unit] = await db.select({ id: t.workUnits.id }).from(t.workUnits).where(eq(t.workUnits.id, unitId));
  if (!unit) return { error: 'Unité de travail introuvable.', fieldErrors: { unitId: 'Unité introuvable.' } };

  const values = {
    unitId, hazard, situation, existingMeasures,
    gravity: gravity!, probability: probability!, residualGravity: residualGravity!, residualProbability: residualProbability!,
  };
  if (id) {
    const [row] = await db.update(t.risks).set(values).where(eq(t.risks.id, id)).returning({ id: t.risks.id });
    if (!row) return { error: 'Risque introuvable (supprimé entre-temps ?).' };
    revalidatePath('/', 'layout');
    return { ok: true, id: String(id) };
  }
  const [{ last }] = await db.select({ last: max(t.risks.sort) }).from(t.risks);
  const [row] = await db.insert(t.risks).values({ ...values, sort: (last ?? -1) + 1 }).returning({ id: t.risks.id });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(row.id) };
}

/** Supprime un risque et ses rattachements au plan d'actions (les actions elles-mêmes sont conservées). */
export async function deleteRisk(id: number): Promise<{ error?: string }> {
  const { error } = await requireRiskEditor();
  if (error) return { error };
  if (!Number.isInteger(id)) return { error: 'Risque introuvable.' };
  const db = await getDb();
  const deleted = await db.transaction(async (tx) => {
    await tx.delete(t.riskActions).where(eq(t.riskActions.riskId, id));
    return tx.delete(t.risks).where(eq(t.risks.id, id)).returning({ id: t.risks.id });
  });
  if (!deleted.length) return { error: 'Risque introuvable (déjà supprimé ?).' };
  revalidatePath('/', 'layout');
  return {};
}

// ─── Unités de travail ──────────────────────────────────────────────────────

const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'unite';

/** Crée une unité de travail ou modifie son libellé et son site. */
export async function saveWorkUnit(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireRiskEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const label = f.str('label', { required: true, max: 80 });
  const siteId = f.str('siteId', { required: true });
  if (!f.ok) return f.state();

  const db = await getDb();
  const [units, sites] = await Promise.all([db.select().from(t.workUnits), db.select({ id: t.sites.id }).from(t.sites)]);
  if (!sites.some((s) => s.id === siteId)) return { error: 'Site inconnu.', fieldErrors: { siteId: 'Site inconnu.' } };
  const norm = (s: string) => s.toLocaleLowerCase('fr').replace(/\s+/g, ' ');
  if (units.some((u) => u.id !== id && u.siteId === siteId && norm(u.label) === norm(label))) {
    return { error: 'Une unité de travail porte déjà ce nom sur ce site.', fieldErrors: { label: 'Libellé déjà utilisé sur ce site.' } };
  }

  if (id) {
    const [row] = await db.update(t.workUnits).set({ label, siteId }).where(eq(t.workUnits.id, id)).returning({ id: t.workUnits.id });
    if (!row) return { error: 'Unité de travail introuvable.' };
    revalidatePath('/', 'layout');
    return { ok: true, id };
  }

  const base = slug(label);
  const ids = new Set(units.map((u) => u.id));
  let newId = base;
  for (let n = 2; ids.has(newId); n++) newId = `${base}-${n}`;
  const sort = Math.max(-1, ...units.map((u) => u.sort)) + 1;
  await db.insert(t.workUnits).values({ id: newId, label, siteId, sort });
  revalidatePath('/', 'layout');
  return { ok: true, id: newId };
}

/** Supprime une unité de travail vide (une unité qui porte des risques ne peut pas être supprimée). */
export async function deleteWorkUnit(id: string): Promise<{ error?: string }> {
  const { error } = await requireRiskEditor();
  if (error) return { error };
  const db = await getDb();
  const used = await db.select({ id: t.risks.id }).from(t.risks).where(eq(t.risks.unitId, id)).limit(1);
  if (used.length) return { error: "Cette unité porte encore des risques : supprimez-les ou déplacez-les d'abord." };
  const deleted = await db.delete(t.workUnits).where(eq(t.workUnits.id, id)).returning({ id: t.workUnits.id });
  if (!deleted.length) return { error: 'Unité de travail introuvable.' };
  revalidatePath('/', 'layout');
  return {};
}

// ─── Versions du DUERP ──────────────────────────────────────────────────────

async function readVersionFields(fd: FormData) {
  const f = formReader(fd);
  const validatedById = f.str('validatedById', { required: true });
  const cseConsultedOn = f.date('cseConsultedOn');
  const comment = f.str('comment', { max: 1000 }) || null;
  if (cseConsultedOn && cseConsultedOn > today()) f.fail('cseConsultedOn', "Date postérieure à aujourd'hui.");
  if (validatedById) {
    const db = await getDb();
    const [p] = await db.select({ id: t.people.id }).from(t.people).where(eq(t.people.id, validatedById));
    if (!p) f.fail('validatedById', 'Personne inconnue.');
  }
  return { f, validatedById, cseConsultedOn, comment };
}

/**
 * Nouvelle version du DUERP : fige un instantané de tous les risques (toutes unités, tous sites)
 * dans la version en vigueur, l'archive, puis ouvre la nouvelle version (mise à jour annuelle).
 */
export async function createDuerpVersion(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  if (!canSee(session.role, 'risks')) return { error: 'Votre rôle ne permet pas cette modification.' };
  const { f, validatedById, cseConsultedOn, comment } = await readVersionFields(fd);
  const version = f.str('version', { required: true, max: 20 });

  const db = await getDb();
  if (version) {
    const msg = versionConflict((await db.select({ version: t.duerpVersions.version }).from(t.duerpVersions)).map((v) => v.version), version);
    if (msg) f.fail('version', msg);
  }
  if (!f.ok) return f.state();

  const now = today();
  let conflict: string | null;
  try {
    conflict = await db.transaction(async (tx) => {
      // Nouveau contrôle dans la transaction : une autre soumission a pu créer la version entre-temps.
      const existing = await tx.select().from(t.duerpVersions);
      const msg = versionConflict(existing.map((v) => v.version), version);
      if (msg) return msg;
      for (const c of existing.filter((v) => v.current)) {
        // Le commentaire reste dans sa colonne (repris de l'ancien emplacement dans le JSON si besoin) ; l'instantané ne porte que les risques.
        const snapshot = await buildDuerpSnapshot(tx, session.user.name);
        await tx.update(t.duerpVersions)
          .set({ current: false, archivedOn: now, comment: versionComment(c), snapshot })
          .where(eq(t.duerpVersions.version, c.version));
      }
      await tx.insert(t.duerpVersions).values({
        version, current: true, updatedOn: now, nextUpdateOn: addMonths(now, 12), retention: DUERP_RETENTION,
        validatedById, cseConsultedOn, archivedOn: null, comment, snapshot: null,
      });
      return null;
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    conflict = 'Ce numéro de version existe déjà.';
  }
  if (conflict) return { error: 'Certains champs sont à corriger.', fieldErrors: { version: conflict } };
  revalidatePath('/', 'layout');
  return { ok: true, id: version };
}

/** Complète la version en vigueur (validation, date de consultation du CSE, commentaire). Les versions archivées sont figées. */
export async function updateCurrentDuerpVersion(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  if (!canSee(session.role, 'risks')) return { error: 'Votre rôle ne permet pas cette modification.' };
  const { f, validatedById, cseConsultedOn, comment } = await readVersionFields(fd);
  const version = f.str('version', { required: true });
  if (!f.ok) return f.state();

  const db = await getDb();
  const [row] = await db.select().from(t.duerpVersions).where(eq(t.duerpVersions.version, version));
  if (!row) return { error: 'Version introuvable.' };
  if (!row.current) return { error: 'Une version archivée ne peut plus être modifiée.' };
  // La version en vigueur n'a pas d'instantané (il est pris à l'archivage) : snapshot remis à null,
  // ce qui efface aussi un commentaire hérité de l'ancien format.
  await db.update(t.duerpVersions)
    .set({ validatedById, cseConsultedOn, comment, snapshot: null })
    .where(eq(t.duerpVersions.version, version));
  revalidatePath('/', 'layout');
  return { ok: true, id: version };
}
