'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { isQhse } from '@/lib/action-rules';
import { canSee } from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireInSite, requireManager } from '@/lib/guard';
import { hasLeft } from '@/lib/people';
import { loadPeople } from '@/lib/queries';
import {
  LOCKOUT_ENERGIES, LOCKOUT_ENERGY_KEYS, LOCKOUT_STATUSES, lockoutPeopleError, lockoutStepError, parseIsolationPoints, pointsText, readPoints,
  stepTarget, verifyRightError, type LockoutStatus, type LockoutStep,
} from '@/lib/rules/lockouts';
import { isPlanEnded, referenceNow } from '@/lib/rules/prevention';
import { getSession } from '@/lib/session';
import { today } from '@/lib/today';
import { diffFields, logChange, type ChangeDetail } from './changelog';
import { nextEntityReference } from './references';
import { VERSION_FIELD, assertFresh, freshWrite } from './versions';

// Consignations et isolations d'un permis (PRV-22, réponses du service QHSE du 09/11/2026). Saisie, pose, levée et
// annulation par l'encadrement qui saisit la prévention (requireManager, comme les permis), sur le site du permis
// (requireInSite) ; vérification par le vérificateur désigné ou l'animateur QHSE, jamais par le poseur. Poseur et
// vérificateur : personnes présentes du cache de Cursus, distinctes. Chaque écriture est journalisée sur le permis
// (`permit`, son historique) et sur la consignation (`lockout`, version QUA-12), dans sa transaction. Champs génériques en
// attendant la procédure PR-QHSE-005.

const MISSING = 'Consignation introuvable.';
const LABELS = { energy: 'Énergie', equipment: 'Équipement', points: "Points d'isolement", applierId: 'Poseur', verifierId: 'Vérificateur', preventionPlanId: 'Plan de prévention', notes: 'Notes' } as const;

/** Journal sur le permis et sur la consignation, dans la transaction. */
async function journal(tx: DbOrTx, l: { id: string; permitId: string }, e: { action: string; byId: string; summary: string; reason?: string; details?: ChangeDetail[] }) {
  await logChange(tx, { entityType: 'permit', entityId: l.permitId, ...e, summary: `Consignation ${l.id} : ${e.summary}` });
  await logChange(tx, { entityType: 'lockout', entityId: l.id, ...e });
}

const ok = (id: string, message: string): FormState => {
  revalidatePath('/', 'layout');
  return { ok: true, id, message };
};

async function loadLockout(id: string) {
  const db = await getDb();
  const [row] = await db.select({ l: t.lockouts, permit: t.permits }).from(t.lockouts).innerJoin(t.permits, eq(t.permits.id, t.lockouts.permitId)).where(eq(t.lockouts.id, id));
  if (!row) return { db, row: null, error: MISSING } as const;
  const siteError = await requireInSite(row.l.siteId);
  if (siteError) return { db, row: null, error: siteError } as const;
  return { db, row, error: null } as const;
}

const openPermit = (p: { status: string }) => p.status === 'demande' || p.status === 'delivre';

/**
 * Crée une consignation sur un permis demandé ou délivré, ou la modifie tant qu'elle est préparée : énergie, équipement,
 * points d'isolement (un par ligne : « repère ; dispositif »), poseur et vérificateur (distincts, présents), plan de
 * prévention du même site (facultatif ; par défaut celui du permis), notes.
 */
export async function saveLockout(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const energy = f.oneOf('energy', LOCKOUT_ENERGY_KEYS, { required: true });
  const equipment = f.str('equipment', { required: true, max: 200 });
  const parsed = parseIsolationPoints(f.str('points'));
  if (parsed.error) f.fail('points', parsed.error);
  const applierId = f.str('applierId', { required: true });
  const verifierId = f.str('verifierId', { required: true });
  const peopleIssue = lockoutPeopleError(applierId, verifierId);
  if (peopleIssue) f.fail('verifierId', peopleIssue);
  const notes = f.str('notes', { max: 2000 });
  if (!f.ok) return f.state();

  const db = await getDb();
  const people = await loadPeople();
  const now = today();
  const before = id ? await loadLockout(id) : null;
  if (before && !before.row) return { error: before.error };
  const existing = before?.row?.l ?? null;
  if (existing && existing.status !== 'preparee') return { error: 'Seule une consignation préparée se modifie : levez-la ou annulez-la.' };
  const permitId = existing?.permitId ?? f.str('permitId', { required: true });
  if (!f.ok) return f.state();
  const [permit] = await db.select().from(t.permits).where(eq(t.permits.id, permitId));
  if (!permit) return { error: 'Permis introuvable.' };
  const siteError = await requireInSite(permit.siteId);
  if (siteError) return { error: siteError };
  if (!openPermit(permit)) return { error: 'Permis clos ou annulé : consignation impossible.' };
  const present = (pid: string, stored?: string) => pid === stored || (people.has(pid) && !hasLeft(people.get(pid)!, now));
  if (!present(applierId, existing?.applierId)) f.fail('applierId', 'Personne inconnue ou sortie de l’effectif.');
  if (!present(verifierId, existing?.verifierId)) f.fail('verifierId', 'Personne inconnue ou sortie de l’effectif.');
  // Plan de prévention : champ absent = celui du permis ; plan choisi : du même site, non clos (valeur enregistrée admise).
  const planInput = fd.has('preventionPlanId') ? f.opt('preventionPlanId') : existing ? existing.preventionPlanId : permit.preventionPlanId;
  if (planInput && planInput !== existing?.preventionPlanId) {
    const [plan] = await db.select().from(t.preventionPlans).where(eq(t.preventionPlans.id, planInput));
    if (!plan || plan.siteId !== permit.siteId) f.fail('preventionPlanId', 'Plan de prévention introuvable sur le site du permis.');
    else if (isPlanEnded(plan)) f.fail('preventionPlanId', `Ce plan de prévention est ${plan.status === 'annule' ? 'annulé' : 'clos'}.`);
  }
  if (!f.ok) return f.state();

  const values = { energy: energy!, equipment, points: parsed.points, applierId, verifierId, preventionPlanId: planInput, notes };
  if (existing) {
    const name = (pid: string) => people.get(pid)?.name ?? pid;
    const view = (x: typeof values) => ({ ...x, energy: LOCKOUT_ENERGIES[x.energy], points: pointsText(readPoints(x.points)), applierId: name(x.applierId), verifierId: name(x.verifierId) });
    const details = diffFields(view({ ...existing, energy: existing.energy as typeof values.energy, points: readPoints(existing.points) }), view(values), LABELS);
    if (!details.length) return { ok: true, id: existing.id };
    const stale = await freshWrite(() => db.transaction(async (tx) => {
      await assertFresh(tx, 'lockout', existing.id, fd.get(VERSION_FIELD));
      await tx.update(t.lockouts).set(values).where(eq(t.lockouts.id, existing.id));
      await journal(tx, existing, { action: 'update', byId: session.user.id, summary: 'modifiée', details });
    }));
    if (stale) return { error: stale };
    return ok(existing.id, 'Consignation enregistrée.');
  }
  const ref = await db.transaction(async (tx) => {
    const newId = await nextEntityReference(tx, 'lockout', 'CSG-', 3);
    await tx.insert(t.lockouts).values({ id: newId, permitId: permit.id, siteId: permit.siteId, ...values, createdById: session.user.id });
    await journal(tx, { id: newId, permitId: permit.id }, {
      action: 'create', byId: session.user.id,
      summary: `préparée (${LOCKOUT_ENERGIES[energy!].toLowerCase()}, ${equipment}, ${parsed.points.length} point${parsed.points.length > 1 ? 's' : ''} d'isolement)`,
    });
    return newId;
  });
  return ok(ref, 'Consignation préparée.');
}

/** Étape d'une consignation : pose (enregistrée par l'encadrement), vérification (vérificateur désigné ou QHSE), levée. */
async function step(fd: FormData, kind: LockoutStep): Promise<FormState> {
  const session = await getSession();
  if (kind !== 'verifier') {
    const { error } = await requireManager();
    if (error) return { error };
  } else if (!canSee(session.role, 'prevention')) return { error: MISSING };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const removedBy = kind === 'lever' ? f.str('removedById', { required: true }) : '';
  if (!f.ok) return f.state();
  const { db, row, error } = await loadLockout(id);
  if (!row) return { error };
  const { l, permit } = row;
  const blocked = lockoutStepError(l.status, kind);
  if (blocked) return { error: blocked };
  if (kind === 'poser' && !openPermit(permit)) return { error: 'Permis clos ou annulé : la consignation ne se pose plus.' };
  if (kind === 'verifier') {
    const denied = verifyRightError({ userId: session.user.id, qhse: isQhse(session.role) }, l);
    if (denied) return { error: denied };
  }
  const people = await loadPeople();
  if (kind === 'lever' && (!people.has(removedBy) || hasLeft(people.get(removedBy)!, today()))) return { error: 'Certains champs sont à corriger.', fieldErrors: { removedById: 'Personne inconnue ou sortie de l’effectif.' } };
  const at = referenceNow(today());
  const to: LockoutStatus = stepTarget(kind);
  const patch = kind === 'poser' ? { status: to, appliedAt: at, appliedById: session.user.id }
    : kind === 'verifier' ? { status: to, verifiedAt: at, verifiedById: session.user.id }
      : { status: to, removedAt: at, removedById: removedBy };
  const name = (pid: string | null) => (pid ? people.get(pid)?.name ?? pid : '');
  const summary = kind === 'poser' ? `posée (poseur : ${name(l.applierId)})`
    : kind === 'verifier' ? `vérifiée par ${session.user.name}` : `levée par ${name(removedBy)}`;
  await db.transaction(async (tx) => {
    await tx.update(t.lockouts).set(patch).where(and(eq(t.lockouts.id, l.id), eq(t.lockouts.status, l.status)));
    await journal(tx, l, { action: 'status', byId: session.user.id, summary, details: [{ field: 'État', from: LOCKOUT_STATUSES[l.status as LockoutStatus]?.label ?? l.status, to: LOCKOUT_STATUSES[to].label }] });
  });
  return ok(l.id, `Consignation ${l.id} ${kind === 'poser' ? 'posée' : kind === 'verifier' ? 'vérifiée' : 'levée'}.`);
}

export async function applyLockout(_prev: FormState, fd: FormData): Promise<FormState> {
  return step(fd, 'poser');
}

export async function verifyLockout(_prev: FormState, fd: FormData): Promise<FormState> {
  return step(fd, 'verifier');
}

export async function removeLockout(_prev: FormState, fd: FormData): Promise<FormState> {
  return step(fd, 'lever');
}

/** Annule une consignation jamais posée (préparée), motif obligatoire ; une consignation posée se lève. */
export async function cancelLockout(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const { db, row, error: loadError } = await loadLockout(id);
  if (!row) return { error: loadError };
  if (row.l.status !== 'preparee') return { error: row.l.status === 'annulee' ? 'Consignation déjà annulée.' : 'Consignation posée : levez-la plutôt que de l’annuler.' };
  await db.transaction(async (tx) => {
    await tx.update(t.lockouts).set({ status: 'annulee', cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason }).where(eq(t.lockouts.id, row.l.id));
    await journal(tx, row.l, { action: 'cancel', byId: session.user.id, reason, summary: 'annulée' });
  });
  return ok(row.l.id, 'Consignation annulée.');
}
