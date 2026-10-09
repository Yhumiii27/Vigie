'use server';

import { revalidatePath } from 'next/cache';
import { eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { SEVESO_LEVELS } from '@/components/prevention/model';
import { ALL_SITES } from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireApprover } from '@/lib/guard';
import { logChange } from './changelog';

// Administration des sites (fenêtre « Gérer les sites… » du sélecteur de site) : animateur QHSE et direction.
// Un site n'est jamais supprimé : archivé avec motif, il disparaît des sélecteurs et ses données restent consultables.

const LABEL_MAX = 120;
const ARCHIVE_REASON_MAX = 500;
/** Ordre d'affichage saisi (colonne int4). */
const SORT_MAX = 9999;

/** Identifiant lisible dérivé du libellé (« Site de Lyon » → « site-de-lyon »). */
function slug(label: string) {
  const s = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return s || 'site';
}

/** Création (id vide) ou modification du libellé et de l'ordre d'affichage d'un site. */
export async function saveSite(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id');
  const label = f.str('label', { required: true, max: LABEL_MAX });
  const sort = f.int('sort', { min: 0, max: SORT_MAX });
  if (!f.ok) return f.state();

  const db = await getDb();
  const sites = await db.select().from(t.sites);
  if (sites.some((s) => s.id !== id && s.label.toLowerCase() === label.toLowerCase())) {
    return { error: 'Certains champs sont à corriger.', fieldErrors: { label: 'Un site porte déjà ce nom.' } };
  }

  if (!id) {
    const base = slug(label);
    let newId = base;
    // L'identifiant réservé de « Tous les sites » (« all ») n'est jamais attribué à un site.
    for (let i = 2; newId === ALL_SITES || sites.some((s) => s.id === newId); i++) newId = `${base}-${i}`;
    const order = sort ?? Math.max(-1, ...sites.map((s) => s.sort)) + 1;
    await db.transaction(async (tx) => {
      await tx.insert(t.sites).values({ id: newId, label, sort: order });
      await logChange(tx, { entityType: 'site', entityId: newId, action: 'create', summary: `Site « ${label} » créé` });
    });
    revalidatePath('/', 'layout');
    return { ok: true, id: newId };
  }

  const before = sites.find((s) => s.id === id);
  if (!before) return { error: 'Site inconnu.' };
  const order = sort ?? before.sort;
  await db.transaction(async (tx) => {
    await tx.update(t.sites).set({ label, sort: order }).where(eq(t.sites.id, id));
    const details = [
      ...(before.label !== label ? [{ field: 'Libellé', from: before.label, to: label }] : []),
      ...(before.sort !== order ? [{ field: 'Ordre', from: String(before.sort), to: String(order) }] : []),
    ];
    if (details.length) await logChange(tx, { entityType: 'site', entityId: id, action: 'update', summary: 'Site modifié', details });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id };
}

/** Archivage d'un site (fermé, cédé) avec motif ; au moins un site doit rester actif. */
export async function archiveSite(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const siteId = f.str('siteId', { required: true });
  const reason = f.str('reason', { required: true, max: ARCHIVE_REASON_MAX });
  if (!f.ok) return f.state();

  const db = await getDb();
  const active = await db.select({ id: t.sites.id }).from(t.sites).where(isNull(t.sites.archivedAt));
  const [site] = await db.select().from(t.sites).where(eq(t.sites.id, siteId));
  if (!site) return { error: 'Site inconnu.' };
  if (site.archivedAt) return { error: 'Ce site est déjà archivé.' };
  if (active.length <= 1) return { error: 'Au moins un site doit rester actif.' };

  await db.transaction(async (tx) => {
    await tx.update(t.sites).set({ archivedAt: new Date(), archivedById: session.user.id, archiveReason: reason }).where(eq(t.sites.id, siteId));
    await logChange(tx, { entityType: 'site', entityId: siteId, action: 'archive', summary: `Site « ${site.label} » archivé`, reason });
  });
  // Le cookie de site qui vise ce site retombe sur le premier site actif (getSession).
  revalidatePath('/', 'layout');
  return { ok: true, id: siteId };
}

/** Réactivation d'un site archivé. */
export async function restoreSite(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const siteId = f.str('siteId', { required: true });
  if (!f.ok) return f.state();

  const db = await getDb();
  const [site] = await db.select().from(t.sites).where(eq(t.sites.id, siteId));
  if (!site) return { error: 'Site inconnu.' };
  if (!site.archivedAt) return { ok: true, id: siteId };
  await db.transaction(async (tx) => {
    await tx.update(t.sites).set({ archivedAt: null, archivedById: null, archiveReason: null }).where(eq(t.sites.id, siteId));
    await logChange(tx, { entityType: 'site', entityId: siteId, action: 'restore', summary: `Site « ${site.label} » réactivé` });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: siteId };
}

/**
 * Règle de prévention d'un site : classement Seveso (seuil haut, seuil bas, non classé) et règle interne
 * « plan de prévention écrit et signé dès la première minute d'intervention » d'une entreprise extérieure.
 * Réservé à l'animateur QHSE et à la direction.
 */
export async function saveSiteRule(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const siteId = f.str('siteId', { required: true });
  const seveso = f.oneOf('seveso', SEVESO_LEVELS.map(([k]) => k));
  const ppFromFirstMinute = f.bool('ppFromFirstMinute');
  if (!f.ok) return f.state();

  const db = await getDb();
  const [site] = await db.select({ archivedAt: t.sites.archivedAt }).from(t.sites).where(eq(t.sites.id, siteId));
  if (!site) return { error: 'Site inconnu.' };
  if (site.archivedAt) return { error: 'Site archivé : réactivez-le pour modifier sa règle.' };
  const [row] = await db.update(t.sites).set({ seveso, ppFromFirstMinute }).where(eq(t.sites.id, siteId)).returning({ id: t.sites.id });
  if (!row) return { error: 'Site inconnu.' };
  revalidatePath('/', 'layout');
  return { ok: true, id: row.id };
}
