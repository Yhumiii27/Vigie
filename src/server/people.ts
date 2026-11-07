'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { readCursusPeople } from '@/lib/foreign/cursus';
import { SOURCES, unavailableMessage } from '@/lib/foreign/labels';
import { formReader, type FormState } from '@/lib/forms';
import { requireEditor, requireInSite } from '@/lib/guard';
import { newCachedPerson } from '@/lib/rules/people-sync';
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
  const values = newCachedPerson(src, new Set(sites.filter((s) => !s.archivedAt).map((s) => s.id)));
  const siteLabel = (sid: string | null) => (sid ? sites.find((s) => s.id === sid)?.label ?? sid : null);
  await db.transaction(async (tx) => {
    if (holder) {
      await tx.update(t.people).set({
        matricule: null, cursusState: null, replacedById: id,
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
