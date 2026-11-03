'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { SEVESO_LEVELS } from '@/lib/rules/prevention';
import { siteCodeError } from '@/lib/rules/process-safety';
import { ALL_SITES } from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireApprover } from '@/lib/guard';
import { hasLeft } from '@/lib/people';
import { today } from '@/lib/today';
import { logChange } from './changelog';
import { readMatrixSites } from '@/lib/foreign/matrix';
import { unavailableMessage } from '@/lib/foreign/labels';

// Administration des sites (fenêtre « Gérer les sites… » du sélecteur de site) : animateur QHSE et direction.
// Sites suivis = cache de matrix.pub_sites (D14) : un site se suit en le choisissant dans la liste de Matrix, jamais créé
// librement. Un site n'est jamais supprimé : « ne plus suivre » l'archive avec motif ; il disparaît des sélecteurs et ses
// données restent consultables.

/**
 * Suivre un site de Matrix (id vide : création) ou modifier les attributs propres à Vigie d'un site suivi (D14, décision
 * CV-09). L'identifiant d'un site est son code commun (matrix.pub_sites.code) : à la création, le site est choisi parmi les
 * sites actifs de la vue non encore suivis (champ `code`) ; libellé et ordre viennent de Matrix (lecture seule, rafraîchis
 * par src/server/foreign-sync.ts). Attributs locaux : responsable QHSE (champ `qhseLeadId`, vide = poste vacant ; absent du
 * formulaire = inchangé) et droit local d'Alsace-Moselle (case `alsaceMoselle`, lue seulement si le formulaire porte
 * `alsaceMoselleField` ; jours fériés du délai de déclaration CPAM, EVT-03) ; Seveso (saveSiteRule) et SIRET (écran
 * Environnement) ailleurs. Sites de Matrix indisponibles : création refusée avec un message. Le premier site suivi
 * (amorçage d'une base vide) devient le site de rattachement de la personne qui le crée, si elle n'en a pas.
 */
export async function saveSite(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id');

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
  const leadName = (pid: string | null | undefined) => (pid ? people.find((p) => p.id === pid)?.name ?? pid : 'à désigner');

  if (!id) {
    const code = f.str('code', { required: true, max: 32 });
    if (!f.ok) return f.state();
    // Un site de Matrix n'est suivi qu'une fois ; « all » (Tous les sites) et un code hors du format de Matrix, jamais.
    const codeError = siteCodeError(code) ?? (code === ALL_SITES ? 'Identifiant réservé.' : null);
    if (codeError) return { error: 'Certains champs sont à corriger.', fieldErrors: { code: codeError } };
    const followed = sites.find((s) => s.id === code);
    if (followed) {
      return { error: 'Certains champs sont à corriger.', fieldErrors: { code: followed.archivedAt ? 'Site déjà suivi, archivé : réactivez-le.' : 'Site déjà suivi par Vigie.' } };
    }
    const matrix = await readMatrixSites(db);
    if (!matrix.ok) return { error: unavailableMessage('sites') };
    const src = matrix.rows.find((s) => s.code === code);
    if (!src || !src.active) return { error: 'Certains champs sont à corriger.', fieldErrors: { code: src ? 'Site fermé dans Matrix.' : 'Site inconnu de Matrix.' } };
    await db.transaction(async (tx) => {
      await tx.insert(t.sites).values({ id: code, label: src.label, sort: src.sort, qhseLeadId, alsaceMoselle, matrixState: 'actif' });
      if (!sites.length) {
        await tx.update(t.people).set({ siteId: code }).where(and(eq(t.people.id, session.user.id), isNull(t.people.siteId)));
      }
      await logChange(tx, {
        byId: session.user.id, entityType: 'site', entityId: code, action: 'create',
        summary: `Site « ${src.label} » suivi (Matrix : ${code})${qhseLeadId ? ` · responsable QHSE ${leadName(qhseLeadId)}` : ''}${alsaceMoselle ? ' · droit local d’Alsace-Moselle' : ''}`,
      });
    });
    revalidatePath('/', 'layout');
    return { ok: true, id: code };
  }

  if (!f.ok) return f.state();
  if (!before) return { error: 'Site inconnu.' };
  await db.transaction(async (tx) => {
    await tx.update(t.sites).set({ qhseLeadId, alsaceMoselle }).where(eq(t.sites.id, id));
    const details = [
      ...(before.qhseLeadId !== qhseLeadId ? [{ field: 'Responsable QHSE', from: leadName(before.qhseLeadId), to: leadName(qhseLeadId) }] : []),
      ...(before.alsaceMoselle !== alsaceMoselle ? [{ field: 'Droit local d’Alsace-Moselle', from: before.alsaceMoselle ? 'oui' : 'non', to: alsaceMoselle ? 'oui' : 'non' }] : []),
    ];
    if (details.length) await logChange(tx, { byId: session.user.id, entityType: 'site', entityId: id, action: 'update', summary: 'Site modifié', details });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id };
}

/** « Ne plus suivre » un site (archivage avec motif : site fermé, cédé, hors du périmètre QHSE) ; au moins un site doit rester actif. */
export async function archiveSite(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const siteId = f.str('siteId', { required: true });
  const reason = f.reason();
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

/** Réactivation d'un site archivé, motif obligatoire (QUA-22). */
export async function restoreSite(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const siteId = f.str('siteId', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();

  const db = await getDb();
  const [site] = await db.select().from(t.sites).where(eq(t.sites.id, siteId));
  if (!site) return { error: 'Site inconnu.' };
  if (!site.archivedAt) return { ok: true, id: siteId };
  await db.transaction(async (tx) => {
    await tx.update(t.sites).set({ archivedAt: null, archivedById: null, archiveReason: null }).where(eq(t.sites.id, siteId));
    await logChange(tx, { entityType: 'site', entityId: siteId, action: 'restore', summary: `Site « ${site.label} » réactivé`, reason });
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
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const siteId = f.str('siteId', { required: true });
  const seveso = f.oneOf('seveso', SEVESO_LEVELS.map(([k]) => k));
  const ppFromFirstMinute = f.bool('ppFromFirstMinute');
  if (!f.ok) return f.state();

  const db = await getDb();
  const [site] = await db.select({ archivedAt: t.sites.archivedAt, label: t.sites.label, seveso: t.sites.seveso, ppFromFirstMinute: t.sites.ppFromFirstMinute })
    .from(t.sites).where(eq(t.sites.id, siteId));
  if (!site) return { error: 'Site inconnu.' };
  if (site.archivedAt) return { error: 'Site archivé : réactivez-le pour modifier sa règle.' };
  // La règle s'applique aussi aux interventions passées (écarts R. 4512-6 recalculés) : chaque changement est journalisé
  // sur le site (TDB-09), dans la transaction de l'écriture.
  const sevesoLabel = (v: string | null) => SEVESO_LEVELS.find(([k]) => k === v)?.[1] ?? 'Non classé';
  const details = [
    ...((site.seveso ?? null) !== (seveso ?? null) ? [{ field: 'Classement Seveso', from: sevesoLabel(site.seveso), to: sevesoLabel(seveso) }] : []),
    ...(site.ppFromFirstMinute !== ppFromFirstMinute
      ? [{ field: 'Plan de prévention dès la première minute', from: site.ppFromFirstMinute ? 'oui' : 'non', to: ppFromFirstMinute ? 'oui' : 'non' }] : []),
  ];
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(t.sites).set({ seveso, ppFromFirstMinute }).where(eq(t.sites.id, siteId)).returning({ id: t.sites.id });
    if (updated && details.length) {
      await logChange(tx, {
        byId: session.user.id, entityType: 'site', entityId: siteId, action: 'update', details,
        summary: `Règle de prévention du site « ${site.label} » modifiée : écarts des interventions recalculés`,
      });
    }
    return updated;
  });
  if (!row) return { error: 'Site inconnu.' };
  revalidatePath('/', 'layout');
  return { ok: true, id: row.id };
}
