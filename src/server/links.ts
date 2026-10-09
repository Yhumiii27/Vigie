'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { checkActionLink } from '@/lib/action-links';
import { isClosedActionStatus } from '@/lib/domain';
import { requireInSite, requireManager } from '@/lib/guard';
import { inSite } from '@/lib/session';
import { logChange } from './changelog';

// Rattacher / détacher une action existante à une source (risque, constat, exigence, contrôle, revue…),
// pour le composant transverse LinkActionButton. Les types de liens sont décrits dans src/lib/action-links.ts.

type Result = { error?: string };

async function check(link: string, actionId: string) {
  const { session, error } = await requireManager();
  if (error) return { error };
  const db = await getDb();
  const checked = await checkActionLink(db, session.role, link);
  if ('error' in checked) return { error: checked.error };
  const [action] = await db.select({ id: t.actions.id, status: t.actions.status, siteId: t.actions.siteId }).from(t.actions).where(eq(t.actions.id, actionId));
  if (!action) return { error: 'Action introuvable.' };
  // L'action aussi doit relever du site sélectionné (ou valoir pour tous les sites).
  const siteError = await requireInSite(action.siteId);
  if (siteError) return { error: siteError };
  // Site de la source (null = sans site ou tous sites) : sous « Tous les sites », les deux contrôles ci-dessus passent toujours.
  const sourceSiteId = (await checked.parsed.def.siteOf?.(db, checked.parsed.args)) ?? null;
  return { db, parsed: checked.parsed, action, sourceSiteId };
}

type Checked = Exclude<Awaited<ReturnType<typeof check>>, { error: string }>;

/** Libellés lisibles des sources de ce type portées par l'action (historique : jamais la syntaxe interne « risk:12 »). */
const labelsOf = async (tx: DbOrTx, c: Checked) => (await c.parsed.def.sources(tx, [c.action.id])).map((s) => s.label);

/** Rattache l'action existante `actionId` à la source `link` (ex. « risk:12 », « control:3 »). */
export async function linkAction(link: string, actionId: string): Promise<Result> {
  const c = await check(link, actionId);
  if ('error' in c) return { error: c.error };
  if (isClosedActionStatus(c.action.status)) return { error: `L'action ${actionId} est clôturée ou annulée : elle ne peut plus être rattachée.` };
  if (!inSite(c.sourceSiteId, c.action.siteId)) return { error: `L'action ${actionId} concerne un autre site que l'élément à rattacher.` };
  const error = await c.db.transaction(async (tx) => {
    const before = await labelsOf(tx, c);
    const err = await c.parsed.def.attach(tx, c.parsed.args, actionId);
    if (err) return err;
    const added = (await labelsOf(tx, c)).filter((l) => !before.includes(l));
    if (added.length) {
      await logChange(tx, { entityType: 'action', entityId: actionId, action: 'link', summary: `Rattachée à ${added.join(' ; ')}` });
      // Aussi dans l'historique de la source quand elle en a un (fiche risque).
      const source = c.parsed.def.logAs?.(c.parsed.args);
      if (source) await logChange(tx, { ...source, action: 'link', summary: `Action ${actionId} rattachée` });
    }
    return null;
  });
  if (error) return { error };
  revalidatePath('/', 'layout');
  return {};
}

/** Détache l'action `actionId` de la source `link` ; l'action elle-même reste dans le plan. */
export async function unlinkAction(link: string, actionId: string): Promise<Result> {
  const c = await check(link, actionId);
  if ('error' in c) return { error: c.error };
  await c.db.transaction(async (tx) => {
    const before = await labelsOf(tx, c);
    await c.parsed.def.detach(tx, c.parsed.args, actionId);
    // Historique seulement si l'action était bien rattachée à cette source (detach est sans effet sinon).
    const after = await labelsOf(tx, c);
    const removed = before.filter((l) => !after.includes(l));
    if (removed.length) {
      await logChange(tx, { entityType: 'action', entityId: actionId, action: 'unlink', summary: `Détachée de ${removed.join(' ; ')}` });
      const source = c.parsed.def.logAs?.(c.parsed.args);
      if (source) await logChange(tx, { ...source, action: 'unlink', summary: `Action ${actionId} détachée (elle reste dans le plan d'actions)` });
    }
  });
  revalidatePath('/', 'layout');
  return {};
}
