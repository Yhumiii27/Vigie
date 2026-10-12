'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { SEVESO_LEVELS } from '@/components/prevention/model';
import { ALL_SITES } from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireApprover } from '@/lib/guard';
import { hasLeft } from '@/lib/people';
import { today } from '@/lib/today';
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

/**
 * Création (id vide) ou modification d'un site : libellé, ordre d'affichage, responsable QHSE (champ `qhseLeadId`,
 * vide = poste vacant ; absent du formulaire = inchangé) et droit local d'Alsace-Moselle (case `alsaceMoselle`, lue
 * seulement si le formulaire porte `alsaceMoselleField` ; jours fériés du délai de déclaration CPAM, EVT-03). Le premier
 * site créé (amorçage d'une base vide) devient le site de rattachement de la personne qui le crée, si elle n'en a pas.
 */
export async function saveSite(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id');
  const label = f.str('label', { required: true, max: LABEL_MAX });
  const sort = f.int('sort', { min: 0, max: SORT_MAX });

  const db = await getDb();
  const [sites, people] = await Promise.all([
    db.select().from(t.sites),
    db.select({ id: t.people.id, name: t.people.name, leftOn: t.people.leftOn }).from(t.people),
  ]);
  const before = id ? sites.find((s) => s.id === id) : undefined;
  // Responsable : une personne présente à l'effectif (le responsable actuel reste admis, même sorti, pour ne rien changer).
  const now = today();
  const leadField = fd.has('qhseLeadId');
  const leadChoices = people.filter((p) => !hasLeft(p, now) || p.id === before?.qhseLeadId).map((p) => p.id);
  const qhseLeadId = leadField ? f.oneOf('qhseLeadId', leadChoices) : before?.qhseLeadId ?? null;
  const alsaceMoselle = fd.has('alsaceMoselleField') ? f.bool('alsaceMoselle') : before?.alsaceMoselle ?? false;
  if (!f.ok) return f.state();
  if (sites.some((s) => s.id !== id && s.label.toLowerCase() === label.toLowerCase())) {
    return { error: 'Certains champs sont à corriger.', fieldErrors: { label: 'Un site porte déjà ce nom.' } };
  }
  const leadName = (pid: string | null | undefined) => (pid ? people.find((p) => p.id === pid)?.name ?? pid : 'à désigner');

  if (!id) {
    const base = slug(label);
    let newId = base;
    // L'identifiant réservé de « Tous les sites » (« all ») n'est jamais attribué à un site.
    for (let i = 2; newId === ALL_SITES || sites.some((s) => s.id === newId); i++) newId = `${base}-${i}`;
    const order = sort ?? Math.max(-1, ...sites.map((s) => s.sort)) + 1;
    await db.transaction(async (tx) => {
      await tx.insert(t.sites).values({ id: newId, label, sort: order, qhseLeadId, alsaceMoselle });
      if (!sites.length) {
        await tx.update(t.people).set({ siteId: newId }).where(and(eq(t.people.id, session.user.id), isNull(t.people.siteId)));
      }
      await logChange(tx, {
        byId: session.user.id, entityType: 'site', entityId: newId, action: 'create',
        summary: `Site « ${label} » créé${qhseLeadId ? ` · responsable QHSE ${leadName(qhseLeadId)}` : ''}${alsaceMoselle ? ' · droit local d’Alsace-Moselle' : ''}`,
      });
    });
    revalidatePath('/', 'layout');
    return { ok: true, id: newId };
  }

  if (!before) return { error: 'Site inconnu.' };
  const order = sort ?? before.sort;
  await db.transaction(async (tx) => {
    await tx.update(t.sites).set({ label, sort: order, qhseLeadId, alsaceMoselle }).where(eq(t.sites.id, id));
    const details = [
      ...(before.label !== label ? [{ field: 'Libellé', from: before.label, to: label }] : []),
      ...(before.sort !== order ? [{ field: 'Ordre', from: String(before.sort), to: String(order) }] : []),
      ...(before.qhseLeadId !== qhseLeadId ? [{ field: 'Responsable QHSE', from: leadName(before.qhseLeadId), to: leadName(qhseLeadId) }] : []),
      ...(before.alsaceMoselle !== alsaceMoselle ? [{ field: 'Droit local d’Alsace-Moselle', from: before.alsaceMoselle ? 'oui' : 'non', to: alsaceMoselle ? 'oui' : 'non' }] : []),
    ];
    if (details.length) await logChange(tx, { byId: session.user.id, entityType: 'site', entityId: id, action: 'update', summary: 'Site modifié', details });
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
  const reason = f.reason();
  if (reason.length > ARCHIVE_REASON_MAX) f.fail('reason', `${ARCHIVE_REASON_MAX} caractères au maximum.`);
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
