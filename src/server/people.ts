'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { readCursusPeople } from '@/lib/foreign/cursus';
import { SOURCES, unavailableMessage } from '@/lib/foreign/labels';
import { formReader, type FormState } from '@/lib/forms';
import { requireEditor, requireInSite } from '@/lib/guard';
import { newCachedPerson } from '@/lib/rules/people-sync';
import { RESPONSIBILITY_KINDS, reassignTargetError, responsibilitySummary, type ResponsibilityCounts } from '@/lib/rules/responsibilities';
import { openResponsibilities } from '@/lib/data/people';
import { hasLeft } from '@/lib/people';
import { notifyReassigned } from './action-create';
import { today } from '@/lib/today';
import { logChange } from './changelog';
import { refreshSharedReferences } from './foreign-sync';

// Personnes lues dans Cursus (D01 de Matrix, décision CV-10 du 03/11/2026) : Vigie ne crée plus de fiche (src/server/skills.ts,
// savePerson) ; une fiche ancienne sans matricule (saisie avant D01, ou créée à la première connexion Entra) se rattache à un
// salarié publié par cursus.pub_salaries (attachPerson). Jamais de fusion qui supprime une ligne : la fiche que le
// rafraîchissement avait créée pour ce matricule, sans historique propre, est sortie de l'effectif et marquée « remplacée »
// (replaced_by_id) ; une fiche qui a son propre historique n'est jamais dépossédée de son matricule (refus).

/** QHSE et direction, sur l'écran Habilitations (fiches du personnel). */
const requirePeopleEditor = () => requireEditor('skills', { approver: true });

/** Tables qui ne comptent pas comme historique propre d'une fiche : caches rafraîchis (affectations de Keystone, par matricule). */
const CACHE_TABLES = new Set(['keystone_assignments', 'people']);

/**
 * Fiche créée par le rafraîchissement et sans historique propre : ni compte Microsoft, ni journal écrit par une personne
 * (sur la fiche ou par elle), ni ligne d'une autre table qui la désigne (toute clé étrangère vers people.id, hors caches).
 * Sinon : null avec le motif du refus.
 */
async function bareCacheHolder(db: DbOrTx, holder: { id: string; entraObjectId: string | null; lastLoginAt: Date | null }): Promise<boolean> {
  if (holder.entraObjectId || holder.lastLoginAt) return false;
  const [{ created }] = (await db.select({ created: sql<number>`count(*)::int` }).from(t.changeLog)
    .where(and(eq(t.changeLog.entityType, 'person'), eq(t.changeLog.entityId, holder.id), eq(t.changeLog.action, 'create'), isNull(t.changeLog.byId))));
  if (!created) return false;
  const [{ written }] = (await db.select({ written: sql<number>`count(*)::int` }).from(t.changeLog)
    .where(sql`(${t.changeLog.byId} = ${holder.id}) or (${t.changeLog.entityType} = 'person' and ${t.changeLog.entityId} = ${holder.id} and ${t.changeLog.byId} is not null)`));
  if (written) return false;
  const refs = (await db.execute(sql`select c.conrelid::regclass::text as tbl, (select relname from pg_class where oid = c.conrelid) as rel, quote_ident(a.attname) as col
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = to_regclass('people') and array_length(c.conkey, 1) = 1`)) as unknown as { rows: { tbl: string; rel: string; col: string }[] };
  for (const r of refs.rows) {
    if (CACHE_TABLES.has(r.rel)) continue;
    const hit = (await db.execute(sql`select exists (select 1 from ${sql.raw(r.tbl)} where ${sql.raw(r.col)} = ${holder.id}) as hit`)) as unknown as { rows: { hit: boolean }[] };
    if (hit.rows[0]?.hit) return false;
  }
  return true;
}

/**
 * « Rattacher à un salarié Cursus » (QHSE et direction, site de la fiche, motif obligatoire) : la fiche ancienne sans
 * matricule prend le matricule choisi dans cursus.pub_salaries et les données que Cursus publie (nom, poste, site, sortie,
 * catégorie, entreprise, e-mail). Matricule déjà porté : refusé, sauf par la fiche que le rafraîchissement avait créée et
 * qui n'a aucun historique propre (sortie, marquée « remplacée », jamais supprimée). Journal sur les deux fiches.
 */
export async function attachPerson(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requirePeopleEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const matricule = f.str('matricule', { required: true, max: 40 });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [person] = await db.select().from(t.people).where(eq(t.people.id, id));
  if (!person) return { error: 'Personne introuvable.' };
  if (person.matricule) return { error: 'Fiche déjà rattachée à Cursus.' };
  if (person.replacedById) return { error: 'Fiche remplacée par une autre lors d’un rattachement : rien à rattacher.' };
  const blocked = await requireInSite(person.siteId);
  if (blocked) return { error: blocked };
  const read = await readCursusPeople(db);
  if (!read.ok) return { error: unavailableMessage('people') };
  const src = read.rows.find((r) => r.matricule === matricule);
  if (!src) return { fieldErrors: { matricule: 'Matricule absent de Cursus.' } };
  const [holder] = await db.select({ id: t.people.id, name: t.people.name, entraObjectId: t.people.entraObjectId, lastLoginAt: t.people.lastLoginAt, leftOn: t.people.leftOn })
    .from(t.people).where(and(eq(t.people.matricule, matricule), ne(t.people.id, id)));
  if (holder && !(await bareCacheHolder(db, holder))) {
    return { fieldErrors: { matricule: `Matricule déjà rattaché à une autre fiche de Vigie (${holder.name}), qui a son propre historique.` } };
  }
  const now = today();
  const sites = await db.select({ id: t.sites.id, label: t.sites.label, archivedAt: t.sites.archivedAt }).from(t.sites);
  // Matricule de site (lot 14 de Cursus) : repris de la fiche remplacée ; jamais pris à une autre fiche (unique).
  const [siteHolder] = src.siteMatricule
    ? await db.select({ id: t.people.id }).from(t.people).where(and(eq(t.people.siteMatricule, src.siteMatricule), ne(t.people.id, id)))
    : [];
  const kept = siteHolder && siteHolder.id !== holder?.id ? { ...src, siteMatricule: undefined } : src;
  const values = newCachedPerson(kept, new Set(sites.filter((s) => !s.archivedAt).map((s) => s.id)));
  const siteLabel = (sid: string | null) => (sid ? sites.find((s) => s.id === sid)?.label ?? sid : null);
  await db.transaction(async (tx) => {
    if (holder) {
      await tx.update(t.people).set({
        matricule: null, siteMatricule: null, cursusState: null, replacedById: id,
        ...(holder.leftOn && holder.leftOn <= now ? {} : { leftOn: now, leftReason: 'Fiche en double, remplacée lors d’un rattachement à Cursus' }),
      }).where(eq(t.people.id, holder.id));
      await logChange(tx, {
        entityType: 'person', entityId: holder.id, action: 'archive', reason, byId: session.user.id,
        summary: `Fiche remplacée par la fiche rattachée au même salarié de Cursus (${matricule})`,
      });
    }
    await tx.update(t.people).set({ matricule, ...values }).where(eq(t.people.id, id));
    const details = [
      { field: 'Matricule', from: null, to: matricule },
      ...(values.name !== person.name ? [{ field: 'Nom', from: person.name, to: values.name }] : []),
      ...(values.job !== person.job ? [{ field: 'Poste', from: person.job || null, to: values.job || null }] : []),
      ...(values.siteId !== person.siteId ? [{ field: 'Site de rattachement', from: siteLabel(person.siteId), to: siteLabel(values.siteId) }] : []),
      ...((values.leftOn ?? null) !== (person.leftOn ?? null) ? [{ field: 'Sortie', from: person.leftOn, to: values.leftOn }] : []),
      ...(values.siteMatricule ? [{ field: 'Matricule de site', from: null, to: values.siteMatricule }] : []),
    ];
    await logChange(tx, { entityType: 'person', entityId: id, action: 'link', summary: `Fiche rattachée à Cursus (matricule ${matricule})`, reason, details, byId: session.user.id });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id, message: 'Fiche rattachée à Cursus.' };
}

/**
 * « Actualiser depuis Cursus » (écran Habilitations, QHSE et direction) : rafraîchit tout de suite les personnes et le
 * catalogue des titres (src/server/foreign-sync.ts), sans attendre la tâche « Référentiels partagés ».
 */
export async function refreshFromCursus(): Promise<FormState> {
  const { error } = await requirePeopleEditor();
  if (error) return { error };
  const results = await refreshSharedReferences(await getDb(), { only: ['people', 'titles', 'heldTitles'] });
  revalidatePath('/', 'layout');
  const down = results.filter((r) => r.status !== 'ok').map((r) => SOURCES[r.source].label);
  const people = results.find((r) => r.source === 'people');
  if (down.length) return { ok: true, message: `Cursus actualisé, sauf : ${down.join(', ')} (source indisponible).` };
  return { ok: true, message: `Cursus actualisé : ${people?.added ?? 0} fiche(s) reprise(s), ${people?.updated ?? 0} mise(s) à jour.` };
}

/**
 * HAB-05 (réponse du service QHSE du 09/11/2026 : « proposer de les réaffecter en masse ») : réaffecte toutes les
 * responsabilités ouvertes d'une personne sortie de l'effectif (openResponsibilities : actions QSE, événements, plans de
 * prévention, éléments du programme d'audit, contrôles, exigences de veille) à une personne présente, en une transaction,
 * motif obligatoire, journal sur chaque élément et sur les deux fiches. Animateur QHSE seulement (actions et événements
 * modifiés : ACT-P17, EVT-29) ; chaque élément doit appartenir au site sélectionné ou être commun (requireInSite :
 * « Tous les sites » pour une personne présente sur plusieurs sites). Chaque action réaffectée notifie « Action confiée ».
 */
export async function reassignResponsibilities(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireEditor('actions', { qhse: true });
  if (error) return { error };
  const f = formReader(fd);
  const personId = f.str('id', { required: true });
  const targetId = f.str('targetId', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const now = today();
  const people = await db.select({ id: t.people.id, name: t.people.name, leftOn: t.people.leftOn, siteId: t.people.siteId }).from(t.people)
    .where(inArray(t.people.id, [personId, targetId]));
  const person = people.find((p) => p.id === personId);
  if (!person) return { error: 'Personne introuvable.' };
  if (!hasLeft(person, now)) return { error: "Cette personne est encore à l'effectif : ses responsabilités se modifient fiche par fiche." };
  const target = people.find((p) => p.id === targetId);
  const targetError = reassignTargetError(personId, target && { id: target.id, left: hasLeft(target, now) });
  if (targetError || !target) return { error: 'Certains champs sont à corriger.', fieldErrors: { targetId: targetError ?? 'Personne inconnue.' } };
  const open = await openResponsibilities(db, [personId]);
  const total = RESPONSIBILITY_KINDS.reduce((n, k) => n + open[k].length, 0);
  if (!total) return { error: 'Aucune responsabilité ouverte à réaffecter.' };
  for (const k of RESPONSIBILITY_KINDS) {
    for (const item of open[k]) {
      const siteError = await requireInSite(item.siteId);
      if (siteError) return { error: `${siteError} (élément ${item.id}). Sélectionnez « Tous les sites » pour tout réaffecter.` };
    }
  }
  const details = [{ field: 'Responsable', from: person.name, to: target.name }];
  const summary = (what: string) => `${what} réaffecté(e) à ${target.name} (sortie de ${person.name})`;
  const by = { id: session.user.id, name: session.user.name };
  await db.transaction(async (tx) => {
    // Relu dans la transaction : seuls les éléments encore ouverts et encore portés par la personne changent.
    const live = await openResponsibilities(tx, [personId]);
    for (const a of live.actions) {
      await tx.update(t.actions).set({ pilotId: target.id }).where(and(eq(t.actions.id, a.id), eq(t.actions.pilotId, personId)));
      await logChange(tx, { entityType: 'action', entityId: a.id, action: 'update', summary: summary('Action'), details, reason, byId: by.id });
      const [row] = await tx.select({ id: t.actions.id, detail: t.actions.detail }).from(t.actions).where(eq(t.actions.id, a.id));
      if (row) await notifyReassigned(tx, row, target.id, by);
    }
    for (const e of live.events) {
      await tx.update(t.events).set({ pilotId: target.id }).where(and(eq(t.events.id, e.id), eq(t.events.pilotId, personId)));
      await logChange(tx, { entityType: 'event', entityId: e.id, action: 'update', summary: summary('Pilote'), details: [{ field: 'Pilote', from: person.name, to: target.name }], reason, byId: by.id });
    }
    for (const p of live.plans) {
      await tx.update(t.preventionPlans).set({ ownerId: target.id }).where(and(eq(t.preventionPlans.id, p.id), eq(t.preventionPlans.ownerId, personId)));
      await logChange(tx, { entityType: 'prevention_plan', entityId: p.id, action: 'update', summary: summary('Responsable'), details, reason, byId: by.id });
    }
    for (const i of live.audits) {
      await tx.update(t.auditPlanItems).set({ ownerId: target.id }).where(and(eq(t.auditPlanItems.id, Number(i.id)), eq(t.auditPlanItems.ownerId, personId)));
      await logChange(tx, { entityType: 'audit_plan_item', entityId: i.id, action: 'update', summary: summary('Responsable'), details, reason, byId: by.id });
    }
    for (const c of live.controls) {
      await tx.update(t.controls).set({ responsibleId: target.id }).where(and(eq(t.controls.id, Number(c.id)), eq(t.controls.responsibleId, personId)));
      await logChange(tx, { entityType: 'control', entityId: c.id, action: 'update', summary: summary('Responsable'), details, reason, byId: by.id });
    }
    for (const r of live.requirements) {
      await tx.update(t.requirements).set({ pilotId: target.id }).where(and(eq(t.requirements.id, Number(r.id)), eq(t.requirements.pilotId, personId)));
      await logChange(tx, { entityType: 'requirement', entityId: r.id, action: 'update', summary: summary('Pilote'), details: [{ field: 'Pilote', from: person.name, to: target.name }], reason, byId: by.id });
    }
    const counts = Object.fromEntries(RESPONSIBILITY_KINDS.map((k) => [k, live[k].length])) as ResponsibilityCounts;
    await logChange(tx, { entityType: 'person', entityId: personId, action: 'reassign', summary: `Responsabilités réaffectées à ${target.name} : ${responsibilitySummary(counts)}`, reason, byId: by.id });
    await logChange(tx, { entityType: 'person', entityId: target.id, action: 'reassign', summary: `Responsabilités reprises de ${person.name} : ${responsibilitySummary(counts)}`, reason, byId: by.id });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: personId, message: `${total} élément${total > 1 ? 's' : ''} réaffecté${total > 1 ? 's' : ''} à ${target.name}.` };
}
