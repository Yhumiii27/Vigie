'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, eq, isNull, max } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { addMonths, fmtDate, yearOf } from '@/lib/dates';
import { today } from '@/lib/today';
import { fmtEuro } from '@/components/risks/format';
import {
  buildDuerpSnapshot, buildProgramSnapshot, DUERP_RETENTION, loadProgramSources, programDefaultIds, riskLinkedActionIds, versionComment, versionConflict,
} from '@/lib/data/risks';
import {
  DUERP_ACCESS_CHANNEL_KEYS, DUERP_ACCESS_CHANNELS, DUERP_REQUESTER_KEYS, DUERP_REQUESTERS, canEdit, type DuerpAccessChannel, type DuerpRequester,
} from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireApprover, requireInSite, requireManager } from '@/lib/guard';
import { loadPeople } from '@/lib/queries';
import { currentSiteId, inSite } from '@/lib/session';
import { diffFields, logChange } from './changelog';

const SCALE = { required: true, min: 1, max: 4 } as const;

/**
 * Saisie du DUERP : rôle d'encadrement ET écran « Évaluation des risques » en saisie (canEdit) — le DUERP est consultable
 * par tous les rôles (DUE-01), le chef de projet et le salarié ne le modifient pas.
 */
async function requireRiskEditor() {
  const { session, error } = await requireManager();
  if (error) return { session, error };
  if (!canEdit(session.role, 'risks')) return { session, error: 'Votre rôle ne permet pas cette modification.' };
  return { session, error: null };
}

/** Saisie réservée à l'animateur QHSE et à la direction (restauration d'un élément archivé, versions du DUERP). */
async function requireRiskApprover() {
  const { session, error } = await requireApprover();
  if (error) return { session, error };
  if (!canEdit(session.role, 'risks')) return { session, error: 'Votre rôle ne permet pas cette modification.' };
  return { session, error: null };
}

const ARCHIVED_RISK = 'Risque archivé : restaurez-le pour le modifier.';
const ARCHIVED_UNIT = 'Unité de travail archivée : restaurez-la pour la modifier.';

/** Violation de clé unique (numéro de version créé entre-temps par une autre soumission). */
const isUniqueViolation = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: unknown } | null;
  return !!e && (e.code === '23505' || (e.cause != null && isUniqueViolation(e.cause)));
};

// ─── Risques ─────────────────────────────────────────────────────────────────

const RISK_LABELS = {
  unitId: 'Unité de travail', hazard: 'Danger', situation: 'Situation dangereuse', gravity: 'Gravité', probability: 'Probabilité',
  existingMeasures: 'Mesures existantes', residualGravity: 'Gravité résiduelle', residualProbability: 'Probabilité résiduelle',
} as const;

/** Risque, site et état de son unité (contrôle du site sélectionné). */
async function riskWithSite(db: DbOrTx, id: number) {
  const [row] = await db.select({ risk: t.risks, siteId: t.workUnits.siteId, unit: t.workUnits.label, unitArchivedAt: t.workUnits.archivedAt })
    .from(t.risks).innerJoin(t.workUnits, eq(t.risks.unitId, t.workUnits.id)).where(eq(t.risks.id, id));
  return row ?? null;
}

/**
 * Crée ou modifie un risque d'une unité de travail (cotation brute et résiduelle).
 * La date de recotation du résiduel est mise à jour quand la cotation résiduelle change, ou quand le résiduel
 * est confirmé après vérification d'efficacité (case « residualReviewed »).
 */
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
  const residualReviewed = f.bool('residualReviewed');
  if (gravity && residualGravity && residualGravity > gravity) f.fail('residualGravity', 'Pas plus que la gravité brute.');
  if (probability && residualProbability && residualProbability > probability) f.fail('residualProbability', 'Pas plus que la probabilité brute.');
  if (!f.ok) return f.state();
  if (rawId && !Number.isInteger(id)) return { error: 'Risque introuvable.' };

  const db = await getDb();
  const [unit] = await db.select({ id: t.workUnits.id, siteId: t.workUnits.siteId, label: t.workUnits.label, archivedAt: t.workUnits.archivedAt })
    .from(t.workUnits).where(eq(t.workUnits.id, unitId));
  if (!unit) return { error: 'Unité de travail introuvable.', fieldErrors: { unitId: 'Unité introuvable.' } };
  if (unit.archivedAt) return { error: 'Certains champs sont à corriger.', fieldErrors: { unitId: 'Unité archivée : choisissez une unité en vigueur.' } };
  const siteError = await requireInSite(unit.siteId);
  if (siteError) return { error: siteError };

  const values = {
    unitId, hazard, situation, existingMeasures,
    gravity: gravity!, probability: probability!, residualGravity: residualGravity!, residualProbability: residualProbability!,
  };
  if (id) {
    const existing = await riskWithSite(db, id);
    if (!existing) return { error: 'Risque introuvable.' };
    if (existing.risk.archivedAt) return { error: ARCHIVED_RISK };
    if (existing.risk.unitId !== unitId) {
      const oldSiteError = await requireInSite(existing.siteId);
      if (oldSiteError) return { error: oldSiteError };
    }
    const before = existing.risk;
    const rerated = before.residualGravity !== values.residualGravity || before.residualProbability !== values.residualProbability;
    const reviewed = rerated || residualReviewed;
    const ok = await db.transaction(async (tx) => {
      const [row] = await tx.update(t.risks).set({ ...values, ...(reviewed ? { residualReviewedOn: today() } : {}) })
        .where(eq(t.risks.id, id)).returning({ id: t.risks.id });
      if (!row) return false;
      // Unité : comparaison sur l'identifiant, libellés dans le journal.
      const details = diffFields(before, values, RISK_LABELS)
        .map((d) => (d.field === RISK_LABELS.unitId ? { ...d, from: existing.unit, to: unit.label } : d));
      await logChange(tx, {
        entityType: 'risk', entityId: id, action: 'update', details,
        summary: reviewed && !rerated && !details.length ? "Résiduel confirmé après vérification d'efficacité"
          : reviewed ? 'Risque modifié · résiduel recoté' : 'Risque modifié',
      });
      return true;
    });
    if (!ok) return { error: 'Risque introuvable.' };
    revalidatePath('/', 'layout');
    return { ok: true, id: String(id) };
  }
  const newId = await db.transaction(async (tx) => {
    const [{ last }] = await tx.select({ last: max(t.risks.sort) }).from(t.risks);
    // À la création, le résiduel vient d'être coté : il ne sera à recoter qu'après la clôture d'une action.
    const [row] = await tx.insert(t.risks).values({ ...values, sort: (last ?? -1) + 1, residualReviewedOn: today() }).returning({ id: t.risks.id });
    await logChange(tx, { entityType: 'risk', entityId: row.id, action: 'create', summary: `Risque ajouté · G${values.gravity} × P${values.probability}` });
    return row.id;
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(newId) };
}

/** « Résiduel confirmé » : le résiduel reste inchangé après la vérification d'efficacité, seule la date de recotation est mise à jour. */
export async function confirmResidual(riskId: number): Promise<{ error?: string }> {
  const { error } = await requireRiskEditor();
  if (error) return { error };
  if (!Number.isInteger(riskId)) return { error: 'Risque introuvable.' };
  const db = await getDb();
  const existing = await riskWithSite(db, riskId);
  if (!existing) return { error: 'Risque introuvable.' };
  const siteError = await requireInSite(existing.siteId);
  if (siteError) return { error: siteError };
  const { risk } = existing;
  if (risk.archivedAt) return { error: ARCHIVED_RISK };
  await db.transaction(async (tx) => {
    await tx.update(t.risks).set({ residualReviewedOn: today() }).where(eq(t.risks.id, riskId));
    await logChange(tx, {
      entityType: 'risk', entityId: riskId, action: 'update',
      summary: `Résiduel confirmé après vérification d'efficacité (G${risk.residualGravity} × P${risk.residualProbability} = ${risk.residualGravity * risk.residualProbability})`,
    });
  });
  revalidatePath('/', 'layout');
  return {};
}

/** Monte ou descend un risque dans son unité (ordre du document unique et de ses exports). */
export async function moveRisk(id: number, dir: 'up' | 'down'): Promise<{ error?: string }> {
  const { error } = await requireRiskEditor();
  if (error) return { error };
  if (!Number.isInteger(id) || (dir !== 'up' && dir !== 'down')) return { error: 'Risque introuvable.' };
  const db = await getDb();
  const existing = await riskWithSite(db, id);
  if (!existing) return { error: 'Risque introuvable.' };
  const siteError = await requireInSite(existing.siteId);
  if (siteError) return { error: siteError };
  if (existing.risk.archivedAt) return { error: ARCHIVED_RISK };
  const moved = await db.transaction(async (tx) => {
    // Risques en vigueur de l'unité : les risques archivés gardent leur rang.
    const scope = await tx.select({ id: t.risks.id, sort: t.risks.sort }).from(t.risks)
      .where(and(eq(t.risks.unitId, existing.risk.unitId), isNull(t.risks.archivedAt))).orderBy(asc(t.risks.sort), asc(t.risks.id));
    const i = scope.findIndex((r) => r.id === id);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= scope.length) return false;
    [scope[i], scope[j]] = [scope[j], scope[i]];
    // Renumérotation 0..n-1 de l'unité : règle aussi les ex æquo.
    for (const [n, r] of scope.entries()) if (r.sort !== n) await tx.update(t.risks).set({ sort: n }).where(eq(t.risks.id, r.id));
    await logChange(tx, { entityType: 'risk', entityId: id, action: 'move', summary: dir === 'up' ? "Risque remonté dans l'unité" : "Risque descendu dans l'unité" });
    return true;
  });
  if (moved) revalidatePath('/', 'layout');
  return {};
}

/**
 * Archive un risque (jamais de suppression) : il sort du document unique en vigueur (tableau, matrice, échéances, exports,
 * prochain instantané) mais reste consultable avec son historique, ses actions et ses événements (filtre « Archivés »).
 */
export async function archiveRisk(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireRiskEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const existing = await riskWithSite(db, id!);
  if (!existing) return { error: 'Risque introuvable.' };
  const siteError = await requireInSite(existing.siteId);
  if (siteError) return { error: siteError };
  if (existing.risk.archivedAt) return { error: 'Risque déjà archivé.' };
  await db.transaction(async (tx) => {
    await tx.update(t.risks).set({ archivedAt: new Date(), archivedById: session.user.id, archiveReason: reason }).where(eq(t.risks.id, id!));
    await logChange(tx, { entityType: 'risk', entityId: id!, action: 'archive', summary: `Risque archivé · ${existing.unit} · ${existing.risk.hazard}`, reason });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(id) };
}

/** Restaure un risque archivé dans son unité (animateur QHSE, direction), avec motif ; l'unité doit être en vigueur. */
export async function restoreRisk(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireRiskApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const existing = await riskWithSite(db, id!);
  if (!existing) return { error: 'Risque introuvable.' };
  const siteError = await requireInSite(existing.siteId);
  if (siteError) return { error: siteError };
  if (!existing.risk.archivedAt) return { error: "Le risque n'est pas archivé." };
  if (existing.unitArchivedAt) return { error: `L'unité « ${existing.unit} » est archivée : restaurez-la d'abord.` };
  await db.transaction(async (tx) => {
    await tx.update(t.risks).set({ archivedAt: null, archivedById: null, archiveReason: null }).where(eq(t.risks.id, id!));
    await logChange(tx, { entityType: 'risk', entityId: id!, action: 'restore', summary: 'Risque restauré dans le document unique', reason });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(id) };
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
  const [units, sites] = await Promise.all([db.select().from(t.workUnits), db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites)]);
  if (!sites.some((s) => s.id === siteId)) return { error: 'Site inconnu.', fieldErrors: { siteId: 'Site inconnu.' } };
  const before = id ? units.find((u) => u.id === id) : undefined;
  if (id && !before) return { error: 'Unité de travail introuvable.' };
  if (before?.archivedAt) return { error: ARCHIVED_UNIT };
  // Unité existante : modifiable depuis son site ; nouveau site (création ou déplacement) : site actif uniquement.
  const siteError = (before ? await requireInSite(before.siteId) : null)
    ?? (before?.siteId === siteId ? null : await requireInSite(siteId, { create: true }));
  if (siteError) return { error: siteError };
  const norm = (s: string) => s.toLocaleLowerCase('fr').replace(/\s+/g, ' ');
  const homonym = units.find((u) => u.id !== id && u.siteId === siteId && norm(u.label) === norm(label));
  if (homonym) {
    return homonym.archivedAt
      ? { error: 'Une unité archivée porte déjà ce nom sur ce site.', fieldErrors: { label: "Libellé d'une unité archivée : restaurez-la plutôt (filtre « Archivés »)." } }
      : { error: 'Une unité de travail porte déjà ce nom sur ce site.', fieldErrors: { label: 'Libellé déjà utilisé sur ce site.' } };
  }

  if (id && before) {
    const ok = await db.transaction(async (tx) => {
      const [row] = await tx.update(t.workUnits).set({ label, siteId }).where(eq(t.workUnits.id, id)).returning({ id: t.workUnits.id });
      if (!row) return false;
      const site = (sid: unknown) => (sid ? sites.find((s) => s.id === sid)?.label ?? String(sid) : 'Tous les sites');
      await logChange(tx, { entityType: 'work_unit', entityId: id, action: 'update', summary: 'Unité de travail modifiée', details: diffFields(before, { label, siteId }, { label: 'Libellé', siteId: 'Site' })
        .map((d) => (d.field === 'Site' ? { ...d, from: site(before.siteId), to: site(siteId) } : d)) });
      return true;
    });
    if (!ok) return { error: 'Unité de travail introuvable.' };
    revalidatePath('/', 'layout');
    return { ok: true, id };
  }

  const base = slug(label);
  const ids = new Set(units.map((u) => u.id));
  let newId = base;
  for (let n = 2; ids.has(newId); n++) newId = `${base}-${n}`;
  const sort = Math.max(-1, ...units.map((u) => u.sort)) + 1;
  await db.transaction(async (tx) => {
    await tx.insert(t.workUnits).values({ id: newId, label, siteId, sort });
    await logChange(tx, { entityType: 'work_unit', entityId: newId, action: 'create', summary: `Unité de travail « ${label} » ajoutée` });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: newId };
}

/**
 * Archive une unité de travail sans risque en vigueur (ses risques archivés y restent rattachés) : retirée de la liste,
 * consultable avec son historique via le filtre « Archivés ». Jamais de suppression.
 */
export async function archiveWorkUnit(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireRiskEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [unit] = await db.select().from(t.workUnits).where(eq(t.workUnits.id, id));
  if (!unit) return { error: 'Unité de travail introuvable.' };
  const siteError = await requireInSite(unit.siteId);
  if (siteError) return { error: siteError };
  if (unit.archivedAt) return { error: 'Unité de travail déjà archivée.' };
  const active = await db.select({ id: t.risks.id }).from(t.risks).where(and(eq(t.risks.unitId, id), isNull(t.risks.archivedAt)));
  if (active.length) {
    return { error: `Cette unité porte encore ${active.length} risque${active.length > 1 ? 's' : ''} en vigueur : archivez-les ou déplacez-les d'abord.` };
  }
  await db.transaction(async (tx) => {
    await tx.update(t.workUnits).set({ archivedAt: new Date(), archivedById: session.user.id, archiveReason: reason }).where(eq(t.workUnits.id, id));
    await logChange(tx, { entityType: 'work_unit', entityId: id, action: 'archive', summary: `Unité de travail « ${unit.label} » archivée`, reason });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id };
}

/** Restaure une unité de travail archivée (animateur QHSE, direction), avec motif ; ses risques archivés le restent. */
export async function restoreWorkUnit(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireRiskApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [unit] = await db.select().from(t.workUnits).where(eq(t.workUnits.id, id));
  if (!unit) return { error: 'Unité de travail introuvable.' };
  const siteError = await requireInSite(unit.siteId);
  if (siteError) return { error: siteError };
  if (!unit.archivedAt) return { error: "L'unité n'est pas archivée." };
  // DUE-05 : une unité ne revient pas au document unique d'un site archivé (restaurez le site, ou recréez l'unité ailleurs).
  if (unit.siteId) {
    const [site] = await db.select({ archivedAt: t.sites.archivedAt, label: t.sites.label }).from(t.sites).where(eq(t.sites.id, unit.siteId));
    if (site?.archivedAt) return { error: `Le site « ${site.label} » est archivé : restaurez-le avant de restaurer l'unité.` };
  }
  await db.transaction(async (tx) => {
    await tx.update(t.workUnits).set({ archivedAt: null, archivedById: null, archiveReason: null }).where(eq(t.workUnits.id, id));
    await logChange(tx, { entityType: 'work_unit', entityId: id, action: 'restore', summary: `Unité de travail « ${unit.label} » restaurée`, reason });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id };
}

/**
 * Monte ou descend une unité de travail dans la liste. L'ordre est global (toutes unités renumérotées 0..n-1) ;
 * la voisine est la plus proche unité en vigueur visible sur le site sélectionné.
 */
export async function moveWorkUnit(id: string, dir: 'up' | 'down'): Promise<{ error?: string }> {
  const { error } = await requireRiskEditor();
  if (error) return { error };
  if (dir !== 'up' && dir !== 'down') return { error: 'Sens inconnu.' };
  const db = await getDb();
  const [unit] = await db.select().from(t.workUnits).where(eq(t.workUnits.id, id));
  if (!unit) return { error: 'Unité de travail introuvable.' };
  const siteError = await requireInSite(unit.siteId);
  if (siteError) return { error: siteError };
  if (unit.archivedAt) return { error: ARCHIVED_UNIT };
  const site = await currentSiteId();
  const moved = await db.transaction(async (tx) => {
    const all = await tx.select({ id: t.workUnits.id, siteId: t.workUnits.siteId, sort: t.workUnits.sort, archivedAt: t.workUnits.archivedAt })
      .from(t.workUnits).orderBy(asc(t.workUnits.sort), asc(t.workUnits.label));
    const i = all.findIndex((u) => u.id === id);
    if (i < 0) return false;
    const step = dir === 'up' ? -1 : 1;
    let j = i + step;
    while (j >= 0 && j < all.length && (!inSite(site, all[j].siteId) || all[j].archivedAt)) j += step;
    if (j < 0 || j >= all.length) return false;
    [all[i], all[j]] = [all[j], all[i]];
    for (const [n, u] of all.entries()) if (u.sort !== n) await tx.update(t.workUnits).set({ sort: n }).where(eq(t.workUnits.id, u.id));
    await logChange(tx, { entityType: 'work_unit', entityId: id, action: 'move', summary: dir === 'up' ? 'Unité remontée dans la liste' : 'Unité descendue dans la liste' });
    return true;
  });
  if (moved) revalidatePath('/', 'layout');
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
 * Nouvelle version du DUERP : fige un instantané de tous les risques en vigueur (toutes unités, tous sites, archivés exclus)
 * dans la version en vigueur, l'archive, puis ouvre la nouvelle version (mise à jour annuelle).
 */
export async function createDuerpVersion(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireRiskApprover();
  if (error) return { error };
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
      const previous = existing.find((v) => v.current)?.version;
      await logChange(tx, {
        entityType: 'duerp_version', entityId: version, action: 'create',
        summary: previous ? `Version ${version} ouverte · ${previous} archivée` : `Version ${version} ouverte`,
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
  const { error } = await requireRiskApprover();
  if (error) return { error };
  const { f, validatedById, cseConsultedOn, comment } = await readVersionFields(fd);
  const version = f.str('version', { required: true });
  if (!f.ok) return f.state();

  const db = await getDb();
  const [row] = await db.select().from(t.duerpVersions).where(eq(t.duerpVersions.version, version));
  if (!row) return { error: 'Version introuvable.' };
  if (!row.current) return { error: 'Une version archivée ne peut plus être modifiée.' };
  const people = await loadPeople();
  // La version en vigueur n'a pas d'instantané (il est pris à l'archivage) : snapshot remis à null,
  // ce qui efface aussi un commentaire hérité de l'ancien format.
  await db.transaction(async (tx) => {
    await tx.update(t.duerpVersions)
      .set({ validatedById, cseConsultedOn, comment, snapshot: null })
      .where(eq(t.duerpVersions.version, version));
    const fmt = (v: unknown) => (v == null || v === '' ? null : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? fmtDate(String(v)) : String(v));
    const name = (pid: string | null) => (pid ? people.get(pid)?.name ?? pid : null);
    await logChange(tx, {
      entityType: 'duerp_version', entityId: version, action: 'update', summary: `Version ${version} complétée`,
      details: diffFields(
        { validatedBy: name(row.validatedById), cseConsultedOn: row.cseConsultedOn, comment: versionComment(row) },
        { validatedBy: name(validatedById), cseConsultedOn, comment },
        { validatedBy: 'Validation', cseConsultedOn: 'Consultation du CSE', comment: 'Commentaire' }, fmt,
      ),
    });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: version };
}

// ─── Registre des mises à disposition du DUERP (R. 4121-4, DUE-01) ─────────

const ACCESS_LABELS = {
  requestedOn: 'Date de la demande', requesterKind: 'Demandeur', requesterName: 'Nom', siteId: 'Site', version: 'Version',
  communicatedOn: 'Communiquée le', channel: 'Modalité', note: 'Note',
} as const;

const isoDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Enregistre ou complète une demande d'accès au DUERP (animateur QHSE, direction) : demandeur, établissement, version
 * communiquée (ou demandée), date et modalité de la mise à disposition. Une demande annulée n'est plus modifiable.
 */
export async function saveDuerpAccessRequest(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireRiskApprover();
  if (error) return { error };
  const f = formReader(fd);
  const now = today();
  const rawId = f.opt('id');
  const id = rawId ? Number(rawId) : null;
  const requestedOn = f.date('requestedOn', { required: true });
  const requesterKind = f.oneOf('requesterKind', DUERP_REQUESTER_KEYS, { required: true });
  const requesterName = f.str('requesterName', { required: true, max: 120 });
  const siteId = f.opt('siteId');
  const version = f.str('version', { required: true });
  const communicatedOn = f.date('communicatedOn');
  const channel = f.oneOf('channel', DUERP_ACCESS_CHANNEL_KEYS);
  const note = f.str('note', { max: 1000 }) || null;
  if (requestedOn && requestedOn > now) f.fail('requestedOn', "Date postérieure à aujourd'hui.");
  if (communicatedOn && communicatedOn > now) f.fail('communicatedOn', "Date postérieure à aujourd'hui.");
  if (communicatedOn && requestedOn && communicatedOn < requestedOn) f.fail('communicatedOn', 'Antérieure à la demande.');
  if (communicatedOn && !channel && !f.fieldErrors.channel) f.fail('channel', 'Modalité obligatoire une fois le DUERP communiqué.');
  if (rawId && !Number.isInteger(id)) return { error: 'Demande introuvable.' };

  const db = await getDb();
  const [versions, sites] = await Promise.all([
    db.select({ version: t.duerpVersions.version }).from(t.duerpVersions),
    db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites),
  ]);
  if (version && !versions.some((v) => v.version === version)) f.fail('version', 'Version inconnue.');
  if (siteId && !sites.some((s) => s.id === siteId)) f.fail('siteId', 'Site inconnu.');
  if (!f.ok) return f.state();

  const values = { requestedOn: requestedOn!, requesterKind: requesterKind!, requesterName, siteId, version, communicatedOn, channel, note };
  const kindLabel = DUERP_REQUESTERS[values.requesterKind];
  const communicated = (on: string) => `DUERP ${version} communiqué le ${fmtDate(on)}`;

  if (id) {
    const [before] = await db.select().from(t.duerpAccessRequests).where(eq(t.duerpAccessRequests.id, id));
    if (!before) return { error: 'Demande introuvable.' };
    if (before.cancelledAt) return { error: 'Demande annulée : elle ne peut plus être modifiée.' };
    const siteError = (await requireInSite(before.siteId)) ?? (before.siteId === siteId ? null : await requireInSite(siteId, { create: true }));
    if (siteError) return { error: siteError };
    const siteName = (v: unknown) => (v ? sites.find((x) => x.id === v)?.label ?? String(v) : 'Tous les sites');
    const fmt = (field: string, v: unknown): string | null => {
      if (field === ACCESS_LABELS.siteId) return siteName(v);
      if (v == null || v === '') return null;
      if (field === ACCESS_LABELS.requesterKind) return DUERP_REQUESTERS[v as DuerpRequester] ?? String(v);
      if (field === ACCESS_LABELS.channel) return DUERP_ACCESS_CHANNELS[v as DuerpAccessChannel] ?? String(v);
      return isoDate(v) ? fmtDate(String(v)) : String(v);
    };
    const details = diffFields(before, values, ACCESS_LABELS).map((d) => {
      const key = (Object.keys(ACCESS_LABELS) as (keyof typeof ACCESS_LABELS)[]).find((k) => ACCESS_LABELS[k] === d.field)!;
      return { field: d.field, from: fmt(d.field, before[key]), to: fmt(d.field, values[key]) };
    });
    await db.transaction(async (tx) => {
      await tx.update(t.duerpAccessRequests).set(values).where(eq(t.duerpAccessRequests.id, id));
      await logChange(tx, {
        entityType: 'duerp_access_request', entityId: id, action: 'update', details,
        summary: communicatedOn && !before.communicatedOn ? communicated(communicatedOn) : `Demande d'accès modifiée · ${kindLabel}`,
      });
    });
    revalidatePath('/', 'layout');
    return { ok: true, id: String(id) };
  }

  const siteError = await requireInSite(siteId, { create: true });
  if (siteError) return { error: siteError, fieldErrors: { siteId: siteError } };
  const newId = await db.transaction(async (tx) => {
    const [row] = await tx.insert(t.duerpAccessRequests).values({ ...values, createdById: session.user.id }).returning({ id: t.duerpAccessRequests.id });
    await logChange(tx, {
      entityType: 'duerp_access_request', entityId: row.id, action: 'create',
      summary: `Demande d'accès enregistrée · ${kindLabel} · DUERP ${version}${communicatedOn ? ` · communiqué le ${fmtDate(communicatedOn)}` : ''}`,
    });
    return row.id;
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(newId) };
}

/** Annule une demande d'accès (saisie en double, demande retirée…), avec motif ; jamais de suppression. */
export async function cancelDuerpAccessRequest(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireRiskApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [row] = await db.select().from(t.duerpAccessRequests).where(eq(t.duerpAccessRequests.id, id!));
  if (!row) return { error: 'Demande introuvable.' };
  const siteError = await requireInSite(row.siteId);
  if (siteError) return { error: siteError };
  if (row.cancelledAt) return { error: 'Demande déjà annulée.' };
  await db.transaction(async (tx) => {
    await tx.update(t.duerpAccessRequests).set({ cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason }).where(eq(t.duerpAccessRequests.id, id!));
    await logChange(tx, {
      entityType: 'duerp_access_request', entityId: id!, action: 'cancel', reason,
      summary: `Demande d'accès annulée · ${DUERP_REQUESTERS[row.requesterKind as DuerpRequester] ?? row.requesterKind} · DUERP ${row.version}`,
    });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(id) };
}

// ─── Programme annuel de prévention (PAPRIPACT, L. 4121-3-1, DUE-02) ─────────

const PROGRAM_LINE_LABELS = { estimatedCost: 'Coût estimé', resources: 'Ressources', indicator: 'Indicateur' } as const;
const MAX_COST = 10_000_000;
const PROGRAM_FROZEN = 'Programme arrêté : rouvrez-le pour le modifier.';
const PROGRAM_MISSING = 'Programme introuvable.';
type ProgramLine = { estimatedCost: number | null; resources: string | null; indicator: string | null };
const EMPTY_LINE: ProgramLine = { estimatedCost: null, resources: null, indicator: null };

/** Valeur affichée d'un champ de ligne du programme (journal). */
const programLineFmt = (v: unknown) => (v == null || v === '' ? null : typeof v === 'number' ? fmtEuro(v) : String(v));
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Année du programme (champ masqué `year`) et programme ; erreur si absent. */
async function readProgram(db: DbOrTx, year: number | null) {
  if (!year) return null;
  const [row] = await db.select().from(t.preventionPrograms).where(eq(t.preventionPrograms.year, year));
  return row ?? null;
}

/** Champs d'une ligne du programme : coût estimé (€ HT), ressources, indicateur de résultat. */
function readProgramLine(f: ReturnType<typeof formReader>): ProgramLine {
  const estimatedCost = f.num('estimatedCost', { min: 0 });
  if (estimatedCost != null && estimatedCost > MAX_COST) f.fail('estimatedCost', 'Montant trop élevé.');
  const resources = f.str('resources', { max: 500 }) || null;
  const indicator = f.str('indicator', { max: 300 }) || null;
  return { estimatedCost: estimatedCost == null ? null : Math.round(estimatedCost * 100) / 100, resources, indicator };
}

/**
 * Crée le programme de l'année (N-1 à N+1), commun à tous les sites : rattaché à la version du DUERP en vigueur et
 * prérempli avec les actions issues du DUERP (programDefaultIds, tous sites).
 */
export async function createPreventionProgram(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireRiskApprover();
  if (error) return { error };
  const f = formReader(fd);
  const thisYear = yearOf(today());
  const year = f.int('year', { required: true, min: thisYear - 1, max: thisYear + 1 });
  const comment = f.str('comment', { max: 1000 }) || null;
  if (!f.ok) return f.state();
  // Programme commun à tous les sites : périmètre complet exigé.
  const siteError = await requireInSite(null, { create: true });
  if (siteError) return { error: siteError };
  const db = await getDb();
  const duplicate = { error: 'Certains champs sont à corriger.', fieldErrors: { year: 'Un programme existe déjà pour cette année.' } };
  if (await readProgram(db, year)) return duplicate;
  const [current] = await db.select({ version: t.duerpVersions.version }).from(t.duerpVersions).where(eq(t.duerpVersions.current, true));
  if (!current) return { error: "Aucune version du DUERP en vigueur : ouvrez d'abord une version." };
  try {
    await db.transaction(async (tx) => {
      await tx.insert(t.preventionPrograms).values({ year: year!, duerpVersion: current.version, comment, createdById: session.user.id });
      const sources = await loadProgramSources(tx);
      const ids = programDefaultIds(sources.actions, riskLinkedActionIds(sources), year!);
      if (ids.length) await tx.insert(t.preventionProgramActions).values(ids.map((actionId) => ({ year: year!, actionId })));
      // Historique de chaque action reprise (ACT-03 : changements faits par les autres modules).
      for (const actionId of ids) await logProgramLine(tx, actionId, year!, 'add', session.user.id);
      await logChange(tx, {
        entityType: 'prevention_program', entityId: String(year), action: 'create',
        summary: `Programme ${year} créé · ${plural(ids.length, 'action reprise', 'actions reprises')} du DUERP ${current.version}`,
      });
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return duplicate;
  }
  revalidatePath('/', 'layout');
  return { ok: true, id: String(year) };
}

/** Modifie l'objet du programme en préparation. */
export async function updatePreventionProgram(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireRiskApprover();
  if (error) return { error };
  const f = formReader(fd);
  const year = f.int('year', { required: true });
  const comment = f.str('comment', { max: 1000 }) || null;
  if (!f.ok) return f.state();
  const siteError = await requireInSite(null, { create: true });
  if (siteError) return { error: siteError };
  const db = await getDb();
  const program = await readProgram(db, year);
  if (!program) return { error: PROGRAM_MISSING };
  if (program.frozenAt) return { error: PROGRAM_FROZEN };
  await db.transaction(async (tx) => {
    await tx.update(t.preventionPrograms).set({ comment }).where(eq(t.preventionPrograms.year, year!));
    await logChange(tx, {
      entityType: 'prevention_program', entityId: String(year), action: 'update', summary: `Programme ${year} modifié`,
      details: diffFields({ comment: program.comment }, { comment }, { comment: 'Objet' }),
    });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(year) };
}

/**
 * Contrôles communs aux lignes du programme : programme en préparation, action existante ; site de l'action (sélectionné,
 * dans le périmètre). Renvoie l'action ou un message d'erreur.
 */
async function programLineContext(db: DbOrTx, year: number, actionId: string) {
  const program = await readProgram(db, year);
  if (!program) return { error: PROGRAM_MISSING } as const;
  if (program.frozenAt) return { error: PROGRAM_FROZEN } as const;
  const [action] = await db.select().from(t.actions).where(eq(t.actions.id, actionId));
  if (!action) return { error: 'Action introuvable.' } as const;
  return { program, action } as const;
}

/** Inscription ou retrait d'une action au programme de prévention (PAPRIPACT), tracé dans l'historique de l'action (ACT-03). */
async function logProgramLine(tx: DbOrTx, actionId: string, year: number, kind: 'add' | 'remove', byId: string) {
  await logChange(tx, {
    entityType: 'action', entityId: actionId, action: kind === 'add' ? 'link' : 'unlink', byId,
    summary: kind === 'add' ? `Inscrite au programme de prévention ${year} (PAPRIPACT)` : `Retirée du programme de prévention ${year} (PAPRIPACT)`,
  });
}

/** Ajoute une action du plan rattachée à un risque du DUERP en vigueur au programme en préparation. */
export async function addProgramAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireRiskApprover();
  if (error) return { error };
  const f = formReader(fd);
  const year = f.int('year', { required: true });
  const actionId = f.str('actionId', { required: true });
  const line = readProgramLine(f);
  if (!f.ok) return f.state();
  const db = await getDb();
  const ctx = await programLineContext(db, year!, actionId);
  if ('error' in ctx) return { error: ctx.error };
  const { action } = ctx;
  if (action.status === 'abandonnee') return { error: 'Action abandonnée : elle ne peut pas entrer au programme.' };
  if (!riskLinkedActionIds(await loadProgramSources(db)).has(action.id)) {
    return { error: "Action sans risque du DUERP en vigueur : rattachez-la d'abord à un risque." };
  }
  const siteError = await requireInSite(action.siteId);
  if (siteError) return { error: siteError };
  const added = await db.transaction(async (tx) => {
    const rows = await tx.insert(t.preventionProgramActions).values({ year: year!, actionId, ...line }).onConflictDoNothing()
      .returning({ actionId: t.preventionProgramActions.actionId });
    if (!rows.length) return false;
    await logProgramLine(tx, actionId, year!, 'add', session.user.id);
    await logChange(tx, {
      entityType: 'prevention_program', entityId: String(year), action: 'add', summary: `Action ${actionId} ajoutée au programme`,
      details: diffFields(EMPTY_LINE, line, PROGRAM_LINE_LABELS, programLineFmt),
    });
    return true;
  });
  if (!added) return { error: 'Action déjà au programme.' };
  revalidatePath('/', 'layout');
  return { ok: true, id: actionId };
}

/** Modifie le coût estimé, les ressources ou l'indicateur d'une ligne du programme en préparation. */
export async function saveProgramAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireRiskApprover();
  if (error) return { error };
  const f = formReader(fd);
  const year = f.int('year', { required: true });
  const actionId = f.str('actionId', { required: true });
  const line = readProgramLine(f);
  if (!f.ok) return f.state();
  const db = await getDb();
  const ctx = await programLineContext(db, year!, actionId);
  if ('error' in ctx) return { error: ctx.error };
  const where = and(eq(t.preventionProgramActions.year, year!), eq(t.preventionProgramActions.actionId, actionId));
  const [before] = await db.select().from(t.preventionProgramActions).where(where);
  if (!before) return { error: 'Action absente du programme.' };
  const siteError = await requireInSite(ctx.action.siteId);
  if (siteError) return { error: siteError };
  await db.transaction(async (tx) => {
    await tx.update(t.preventionProgramActions).set(line).where(where);
    await logChange(tx, {
      entityType: 'prevention_program', entityId: String(year), action: 'update', summary: `Ligne ${actionId} du programme modifiée`,
      details: diffFields(before, line, PROGRAM_LINE_LABELS, programLineFmt),
    });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: actionId };
}

/**
 * Retire une action du programme en préparation. Donnée de préparation : la ligne est supprimée (comme un élément de la
 * check-list d'une revue planifiée), le retrait et ses valeurs sont journalisés ; un programme arrêté n'est plus modifiable.
 */
export async function removeProgramAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireRiskApprover();
  if (error) return { error };
  const f = formReader(fd);
  const year = f.int('year', { required: true });
  const actionId = f.str('actionId', { required: true });
  if (!f.ok) return f.state();
  const db = await getDb();
  const ctx = await programLineContext(db, year!, actionId);
  if ('error' in ctx) return { error: ctx.error };
  const where = and(eq(t.preventionProgramActions.year, year!), eq(t.preventionProgramActions.actionId, actionId));
  const [before] = await db.select().from(t.preventionProgramActions).where(where);
  if (!before) return { error: 'Action absente du programme.' };
  const siteError = await requireInSite(ctx.action.siteId);
  if (siteError) return { error: siteError };
  await db.transaction(async (tx) => {
    await tx.delete(t.preventionProgramActions).where(where);
    await logProgramLine(tx, actionId, year!, 'remove', session.user.id);
    await logChange(tx, {
      entityType: 'prevention_program', entityId: String(year), action: 'remove', summary: `Action ${actionId} retirée du programme`,
      details: diffFields(before, EMPTY_LINE, PROGRAM_LINE_LABELS, programLineFmt),
    });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: actionId };
}

/**
 * Arrête le programme après la consultation du CSE : lignes (tous sites) figées dans un instantané, date de consultation,
 * auteur et date d'arrêt. Il n'est plus modifiable, sauf réouverture motivée.
 */
export async function freezePreventionProgram(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireRiskApprover();
  if (error) return { error };
  const f = formReader(fd);
  const year = f.int('year', { required: true });
  const cseConsultedOn = f.date('cseConsultedOn', { required: true });
  if (cseConsultedOn && cseConsultedOn > today()) f.fail('cseConsultedOn', "Date postérieure à aujourd'hui.");
  if (cseConsultedOn && year && yearOf(cseConsultedOn) < year - 1) f.fail('cseConsultedOn', `Consultation antérieure à ${year - 1} : trop ancienne pour le programme ${year}.`);
  if (!f.ok) return f.state();
  const siteError = await requireInSite(null, { create: true });
  if (siteError) return { error: siteError };
  const db = await getDb();
  const program = await readProgram(db, year);
  if (!program) return { error: PROGRAM_MISSING };
  if (program.frozenAt) return { error: 'Programme déjà arrêté.' };
  const result = await db.transaction(async (tx) => {
    const lines = await tx.select({ actionId: t.preventionProgramActions.actionId }).from(t.preventionProgramActions).where(eq(t.preventionProgramActions.year, year!));
    if (!lines.length) return 'Programme vide : ajoutez au moins une action.';
    const snapshot = await buildProgramSnapshot(tx, year!, session.user.name, cseConsultedOn!);
    await tx.update(t.preventionPrograms).set({ snapshot, frozenAt: new Date(), frozenById: session.user.id, cseConsultedOn }).where(eq(t.preventionPrograms.year, year!));
    await logChange(tx, {
      entityType: 'prevention_program', entityId: String(year), action: 'freeze',
      summary: `Programme ${year} arrêté · CSE consulté le ${fmtDate(cseConsultedOn!)} · ${plural(lines.length, 'action', 'actions')}`,
    });
    return null;
  });
  if (result) return { error: result };
  revalidatePath('/', 'layout');
  return { ok: true, id: String(year) };
}

/** Rouvre un programme arrêté (motif obligatoire) : instantané, date d'arrêt et consultation du CSE remis à zéro. */
export async function reopenPreventionProgram(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireRiskApprover();
  if (error) return { error };
  const f = formReader(fd);
  const year = f.int('year', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const siteError = await requireInSite(null, { create: true });
  if (siteError) return { error: siteError };
  const db = await getDb();
  const program = await readProgram(db, year);
  if (!program) return { error: PROGRAM_MISSING };
  if (!program.frozenAt) return { error: 'Programme en préparation : rien à rouvrir.' };
  await db.transaction(async (tx) => {
    await tx.update(t.preventionPrograms).set({ snapshot: null, frozenAt: null, frozenById: null, cseConsultedOn: null }).where(eq(t.preventionPrograms.year, year!));
    await logChange(tx, {
      entityType: 'prevention_program', entityId: String(year), action: 'reopen', reason,
      summary: `Programme ${year} rouvert`,
      details: program.cseConsultedOn ? [{ field: 'Consultation du CSE', from: fmtDate(program.cseConsultedOn), to: null }] : [],
    });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(year) };
}
