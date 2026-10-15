import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { schema as t, type DbOrTx } from '@/db';
import { formatActionNumber, transitionKind, transitionSummary } from '@/lib/action-rules';
import { ACTION_NUMBER_SCOPE, AVANCEMENT, type Avancement, type Role } from '@/lib/domain';
import type { ActionInsert, ActionRow } from '@/lib/queries';
import { logChange, type ChangeDetail } from './changelog';

// Primitives d'écriture du plan d'actions (docs/specs/actions-qse.md § 6, § 9, § 14), appelées dans la transaction de
// l'appelant (server actions du flux A : src/server/plan.ts, plan-ui.ts, action-comments.ts, action-create.ts).
// Remplace src/server/plan-core.ts (applyActionStatus, ancien modèle). Elles ne lisent jamais la session : l'auteur
// (`byId`) est passé explicitement et logChange reçoit toujours un byId explicite (getSession() dans une transaction
// PGlite bloquerait). Les contrôles de droits, de site et de validation sont faits par l'appelant, avant la transaction.
// Pas de 'use server' : ce module n'expose aucune action appelable depuis le navigateur.
//
// Recyclages de formation : aucune action QSE (réponses du service QHSE du 15/10/2026, D4 annulée) — pas de primitive
// recordRenewalTraining.

/** L'action a changé entre-temps (avancement différent de celui lu avant la transaction) : rien n'est écrit. */
export class StaleActionError extends Error {
  constructor(id: string) {
    super(`L'action ${id} a changé entre-temps.`);
    this.name = 'StaleActionError';
  }
}

/** Plus grand numéro « A-n » déjà vu (actions et journal), borne de 9 chiffres comme parseActionNumber et la reprise R8. */
async function maxUsedNumber(tx: DbOrTx): Promise<number> {
  const num = (col: unknown) => sql<number | null>`max(substring(${col} from '^A-([0-9]{1,9})$')::integer)`.mapWith(Number);
  const [a] = await tx.select({ n: num(t.actions.id) }).from(t.actions);
  const [l] = await tx.select({ n: num(t.changeLog.entityId) }).from(t.changeLog).where(eq(t.changeLog.entityType, 'action'));
  return Math.max(a?.n || 0, l?.n || 0);
}

/**
 * Prochain numéro « A-n » (ACT-35, D14) : upsert du compteur action_counters('A') — la ligne reste verrouillée jusqu'à la
 * fin de la transaction, deux créations simultanées obtiennent deux numéros distincts (la seconde attend la première et
 * voit ensuite son action). Toujours au-delà du plus grand numéro déjà vu (actions, y compris insérées hors compteur, et
 * journal : fiche disparue) : la numérotation est croissante et un numéro n'est jamais réattribué ; un compteur en retard
 * est avancé à ce numéro. Dans la transaction de création seulement (un numéro tiré hors transaction serait perdu, jamais
 * réattribué).
 */
export async function nextActionNumber(tx: DbOrTx): Promise<string> {
  const [row] = await tx.insert(t.actionCounters).values({ scope: ACTION_NUMBER_SCOPE, last: 1 })
    .onConflictDoUpdate({ target: t.actionCounters.scope, set: { last: sql`${t.actionCounters.last} + 1` } })
    .returning({ last: t.actionCounters.last });
  const max = await maxUsedNumber(tx);
  if (row.last > max) return formatActionNumber(row.last);
  // Compteur en retard sur les numéros vus (import, base modifiée à la main) : numéro suivant le plus grand vu.
  await tx.update(t.actionCounters).set({ last: max + 1 }).where(eq(t.actionCounters.scope, ACTION_NUMBER_SCOPE));
  return formatActionNumber(max + 1);
}

/**
 * Change l'avancement de `row` vers `to` (transitionKind obligatoire, sinon Error : rien n'est écrit), applique `patch`
 * (dates, vérification, abandon…) et journalise une entrée 'status' au détail structuré (D11) : la ligne « Avancement »
 * avec libellés et clés (fromKey / toKey, lues par les statistiques ACT-29), puis `details`. Résumé : `summary`, à défaut
 * transitionSummary (date effective et résultat lus dans `patch`). Garde d'avancement : la mise à jour ne vaut que si
 * l'action est encore à `row.status` (sinon StaleActionError, rien n'est écrit).
 */
export async function writeAvancement(tx: DbOrTx, row: ActionRow, to: Avancement, o: {
  byId: string | null; summary?: string; reason?: string | null; patch?: Partial<ActionInsert>; details?: ChangeDetail[];
}): Promise<void> {
  const from = row.status;
  const kind = transitionKind(from, to);
  if (!kind) throw new Error(`Changement d'avancement non permis : ${from} → ${to} (${row.id}).`);
  // Le numéro et l'avancement ne viennent jamais du patch.
  const patch: Partial<ActionInsert> = { ...o.patch };
  delete patch.id;
  delete patch.status;
  const done = await tx.update(t.actions).set({ ...patch, status: to })
    .where(and(eq(t.actions.id, row.id), eq(t.actions.status, from))).returning({ id: t.actions.id });
  if (!done.length) throw new StaleActionError(row.id);
  const doneOn = typeof patch.doneOn === 'string' ? patch.doneOn : undefined;
  const effective = typeof patch.effective === 'boolean' ? patch.effective : undefined;
  await logChange(tx, {
    entityType: 'action', entityId: row.id, action: 'status', byId: o.byId,
    summary: o.summary ?? transitionSummary(kind, from, to, { doneOn, effective }),
    reason: o.reason ?? null,
    details: [
      { field: 'Avancement', from: AVANCEMENT[from].label, to: AVANCEMENT[to].label, fromKey: from, toKey: to },
      ...(o.details ?? []),
    ],
  });
}

/**
 * Ajoute un commentaire au fil (ACT-24 : daté, signé du rôle de l'auteur, jamais modifié) et son entrée de journal
 * « Commentaire ajouté » ; renvoie son id. Le journal ne recopie pas le texte : l'historique part au navigateur, et le
 * texte d'un commentaire retiré ne doit jamais y être envoyé (D23). `at` : date du commentaire (reprise, import) ; par
 * défaut l'instant de l'écriture. Longueur (1 à 4 000 caractères) contrôlée par l'appelant et par la base (CHECK).
 */
export async function insertComment(tx: DbOrTx, c: { actionId: string; authorId: string; authorRole: Role | null; body: string; at?: Date }): Promise<number> {
  const [row] = await tx.insert(t.actionComments).values({
    actionId: c.actionId, authorId: c.authorId, authorRole: c.authorRole, body: c.body, ...(c.at ? { createdAt: c.at } : {}),
  }).returning({ id: t.actionComments.id });
  await logChange(tx, { entityType: 'action', entityId: c.actionId, action: 'comment', summary: 'Commentaire ajouté', byId: c.authorId });
  return row.id;
}
