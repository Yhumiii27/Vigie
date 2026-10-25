'use server';

import { revalidatePath } from 'next/cache';
import { getDb, type DbOrTx } from '@/db';
import { checkLinkChange } from '@/lib/action-links';
import { requireApprover } from '@/lib/guard';
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
  const db = await getDb();
  // Contrôles communs du registre (type, droits de la fiche, écran et site de l'élément, site de l'action) : checkLinkChange.
  const checked = await checkLinkChange(db, { role: session.role, userId: session.user.id }, link, actionId, mode);
  if ('error' in checked) return { error: checked.error };
  return { db, ...checked, byId: session.user.id };
}

type Checked = Exclude<Awaited<ReturnType<typeof check>>, { error: string }>;

/** Libellés lisibles des sources de ce type portées par l'action (historique : jamais la syntaxe interne « risk:12 »). */
const labelsOf = async (tx: DbOrTx, c: Checked) => (await c.parsed.def.sources(tx, [c.action.id])).map((s) => s.label);

/** Rattache l'action existante `actionId` au lien complémentaire `link` (ex. « risk:12 », « control:3 »). */
export async function linkAction(link: string, actionId: string): Promise<Result> {
  const c = await check(link, actionId, 'link');
  if ('error' in c) return { error: c.error };
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
