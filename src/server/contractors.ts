'use server';

import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { isPlanEnded } from '@/lib/rules/prevention';
import { formReader, type FormState } from '@/lib/forms';
import { requireManager } from '@/lib/guard';
import { diffFields, logChange } from './changelog';
import { VERSION_FIELD, assertFresh, freshWrite } from './versions';
import { nextEntityReference } from './references';
import { done, isOpenPermit } from './prevention-shared';

// Entreprises extérieures : fiche, archivage et réactivation motivés (QUA-26 : extrait de src/server/prevention.ts).

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Entreprises extérieures ────────────────────────────────────────────────

/** Crée ou modifie une entreprise extérieure. */
export async function saveContractor(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const name = f.str('name', { required: true, max: 120 });
  const trade = f.str('trade', { required: true, max: 120 });
  const contactName = f.str('contactName', { max: 120 }) || null;
  const contactPhone = f.str('contactPhone', { max: 40 }) || null;
  const contactEmail = f.str('contactEmail', { max: 160 }) || null;
  if (contactEmail && !EMAIL.test(contactEmail)) f.fail('contactEmail', 'Adresse e-mail invalide.');
  if (!f.ok) return f.state();

  const db = await getDb();
  const all = await db.select().from(t.contractors);
  const key = name.toLocaleLowerCase('fr');
  if (all.some((c) => c.id !== id && c.name.toLocaleLowerCase('fr') === key)) {
    return { error: 'Cette entreprise existe déjà.', fieldErrors: { name: 'Nom déjà utilisé.' } };
  }
  const values = { name, trade, contactName, contactPhone, contactEmail };
  if (id) {
    const before = all.find((c) => c.id === id);
    if (!before) return { error: 'Entreprise introuvable.' };
    const details = diffFields(before, values, { name: 'Raison sociale', trade: 'Corps de métier', contactName: 'Interlocuteur', contactPhone: 'Téléphone', contactEmail: 'E-mail' });
    const stale = await freshWrite(() => db.transaction(async (tx) => {
      // QUA-12 : fiche modifiée depuis l'ouverture du formulaire (autre saisie, archivage) : rien n'est écrasé.
      await assertFresh(tx, 'contractor', id, fd.get(VERSION_FIELD));
      await tx.update(t.contractors).set(values).where(eq(t.contractors.id, id));
      if (details.length) await logChange(tx, { entityType: 'contractor', entityId: id, action: 'update', summary: 'Fiche modifiée', details });
    }));
    if (stale) return { error: stale };
    return done(id);
  }
  // Référence tirée sous verrou dans la transaction de création (PRD-08).
  const newId = await db.transaction(async (tx) => {
    const ref = await nextEntityReference(tx, 'contractor', 'EE-', 3);
    await tx.insert(t.contractors).values({ id: ref, ...values });
    await logChange(tx, { entityType: 'contractor', entityId: ref, action: 'create', summary: 'Entreprise ajoutée' });
    return ref;
  });
  return done(newId);
}

/**
 * Archive une entreprise qui n'intervient plus (motif obligatoire) : elle n'est plus proposée dans les formulaires,
 * ses plans et permis restent consultables. Refusé tant qu'elle a des plans ou des permis en cours, sur tout site.
 * Pas de suppression : la fiche est tracée dès l'ajout, une entreprise saisie par erreur s'archive aussi.
 */
export async function archiveContractor(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [row] = await db.select().from(t.contractors).where(eq(t.contractors.id, id));
  if (!row) return { error: 'Entreprise introuvable.' };
  if (row.archivedAt) return { error: 'Cette entreprise est déjà archivée.' };
  const [plans, permits] = await Promise.all([
    db.select({ id: t.preventionPlans.id, status: t.preventionPlans.status }).from(t.preventionPlans).where(eq(t.preventionPlans.contractorId, id)),
    db.select({ id: t.permits.id, status: t.permits.status }).from(t.permits).where(eq(t.permits.contractorId, id)),
  ]);
  const busy = [...plans.filter((p) => !isPlanEnded(p)), ...permits.filter(isOpenPermit)].map((p) => p.id);
  if (busy.length) return { error: `Plans ou permis en cours (${busy.join(', ')}) : clôturez-les ou annulez-les avant d'archiver.` };
  await db.transaction(async (tx) => {
    await tx.update(t.contractors).set({ archivedAt: new Date(), archivedById: session.user.id, archiveReason: reason }).where(eq(t.contractors.id, id));
    await logChange(tx, { entityType: 'contractor', entityId: id, action: 'archive', summary: 'Entreprise archivée', reason, byId: session.user.id });
  });
  return done(id);
}

/** Réactive une entreprise archivée (de nouveau proposée dans les formulaires), motif obligatoire (QUA-22). */
export async function restoreContractor(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [row] = await db.select().from(t.contractors).where(eq(t.contractors.id, id));
  if (!row) return { error: 'Entreprise introuvable.' };
  if (!row.archivedAt) return { error: "Cette entreprise n'est pas archivée." };
  await db.transaction(async (tx) => {
    await tx.update(t.contractors).set({ archivedAt: null, archivedById: null, archiveReason: null }).where(eq(t.contractors.id, row.id));
    await logChange(tx, { entityType: 'contractor', entityId: row.id, action: 'restore', summary: 'Entreprise réactivée', reason, byId: session.user.id });
  });
  return done(row.id);
}

