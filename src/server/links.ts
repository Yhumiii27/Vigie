'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { EVENT_AUDIT_LOCKED, ORIGIN_LOCKED, checkActionLink, parseActionLink } from '@/lib/action-links';
import { NON_QSE_LINK_MESSAGE, actionRights, isNonQseLinkKind } from '@/lib/action-rules';
import { EVENT_AUDIT_LINK_KINDS } from '@/lib/domain';
import { requireApprover, requireInSite } from '@/lib/guard';
import { inSite } from '@/lib/session';
import { logChange } from './changelog';

// Rattacher / détacher un lien complémentaire d'une action existante (risque, exigence, contrôle, revue, décision de revue,
// version de document), pour le composant transverse LinkActionButton. Les types de liens sont décrits dans
// src/lib/action-links.ts. Toute modification d'une action relève du service QHSE (ACT-22, réponses du 15/10/2026) :
// requireApprover, puis les droits de la fiche (actionRights : canLink sur une action ni Vérifiée ni Abandonnée,
// canUnlink sauf Abandonnée). Jamais ici :
//   - l'événement ou l'audit de l'action (event, finding, plan), fixé à sa création (D15) ;
//   - les sources d'origine (plan de prévention, permis, document, filière, enlèvement : ACT-01), fixées à la création ;
//   - les éléments qui ne donnent pas lieu à une action QSE (habilitation : liens repris en lecture seule).

type Result = { error?: string };

async function check(link: string, actionId: string, mode: 'link' | 'unlink') {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const parsed = parseActionLink(link);
  if (!parsed) return { error: 'Type de rattachement inconnu.' };
  if ((EVENT_AUDIT_LINK_KINDS as readonly string[]).includes(parsed.kind)) return { error: EVENT_AUDIT_LOCKED };
  if (parsed.def.origin) return { error: ORIGIN_LOCKED };
  if (isNonQseLinkKind(parsed.kind)) return { error: NON_QSE_LINK_MESSAGE };
  const db = await getDb();
  const [action] = await db.select({ id: t.actions.id, status: t.actions.status, siteId: t.actions.siteId, pilotId: t.actions.pilotId })
    .from(t.actions).where(eq(t.actions.id, actionId));
  if (!action) return { error: 'Action introuvable.' };
  // L'action doit relever du site sélectionné (ou valoir pour tous les sites) avant que son avancement soit révélé ; puis
  // ses droits (avancement), puis la source (écran, site).
  const siteError = await requireInSite(action.siteId);
  if (siteError) return { error: siteError };
  const rights = actionRights(session.role, session.user.id, action);
  if (mode === 'link' && !rights.canLink) return { error: `L'action ${actionId} est vérifiée ou abandonnée : elle ne peut plus être rattachée.` };
  if (mode === 'unlink' && !rights.canUnlink) return { error: `L'action ${actionId} est abandonnée : consultation seule.` };
  const checked = await checkActionLink(db, session.role, link);
  if ('error' in checked) return { error: checked.error };
  // Site de la source (null = sans site ou tous sites) : sous « Tous les sites », les deux contrôles ci-dessus passent toujours.
  const sourceSiteId = (await checked.parsed.def.siteOf?.(db, checked.parsed.args)) ?? null;
  return { db, parsed: checked.parsed, action, sourceSiteId, byId: session.user.id };
}

type Checked = Exclude<Awaited<ReturnType<typeof check>>, { error: string }>;

/** Libellés lisibles des sources de ce type portées par l'action (historique : jamais la syntaxe interne « risk:12 »). */
const labelsOf = async (tx: DbOrTx, c: Checked) => (await c.parsed.def.sources(tx, [c.action.id])).map((s) => s.label);

/** Rattache l'action existante `actionId` au lien complémentaire `link` (ex. « risk:12 », « control:3 »). */
export async function linkAction(link: string, actionId: string): Promise<Result> {
  const c = await check(link, actionId, 'link');
  if ('error' in c) return { error: c.error };
  if (!inSite(c.sourceSiteId, c.action.siteId)) return { error: `L'action ${actionId} concerne un autre site que l'élément à rattacher.` };
  const error = await c.db.transaction(async (tx) => {
    const before = await labelsOf(tx, c);
    const err = await c.parsed.def.attach(tx, c.parsed.args, actionId);
    if (err) return err;
    const added = (await labelsOf(tx, c)).filter((l) => !before.includes(l));
    if (added.length) {
      await logChange(tx, { entityType: 'action', entityId: actionId, action: 'link', summary: `Rattachée à ${added.join(' ; ')}`, byId: c.byId });
      // Aussi dans l'historique de la source quand elle en a un (fiche risque).
      const source = c.parsed.def.logAs?.(c.parsed.args);
      if (source) await logChange(tx, { ...source, action: 'link', summary: `Action ${actionId} rattachée`, byId: c.byId });
    }
    return null;
  });
  if (error) return { error };
  revalidatePath('/', 'layout');
  return {};
}

/** Détache l'action `actionId` du lien complémentaire `link` ; l'action elle-même reste dans le plan. */
export async function unlinkAction(link: string, actionId: string): Promise<Result> {
  const c = await check(link, actionId, 'unlink');
  if ('error' in c) return { error: c.error };
  const error = await c.db.transaction(async (tx) => {
    const blocked = await c.parsed.def.detachBlocked?.(tx, c.parsed.args, actionId);
    if (blocked) return blocked;
    const before = await labelsOf(tx, c);
    await c.parsed.def.detach(tx, c.parsed.args, actionId);
    // Historique seulement si l'action était bien rattachée à cette source (detach est sans effet sinon).
    const after = await labelsOf(tx, c);
    const removed = before.filter((l) => !after.includes(l));
    if (removed.length) {
      await logChange(tx, { entityType: 'action', entityId: actionId, action: 'unlink', summary: `Détachée de ${removed.join(' ; ')}`, byId: c.byId });
      const source = c.parsed.def.logAs?.(c.parsed.args);
      if (source) await logChange(tx, { ...source, action: 'unlink', summary: `Action ${actionId} détachée (elle reste dans le plan d'actions)`, byId: c.byId });
    }
    return null;
  });
  if (error) return { error };
  revalidatePath('/', 'layout');
  return {};
}
