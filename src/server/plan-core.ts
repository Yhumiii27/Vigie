import 'server-only';
import { eq } from 'drizzle-orm';
import { schema as t, type DbOrTx } from '@/db';
import { addDays, fmtDayMonth } from '@/lib/dates';
import { today } from '@/lib/today';
import { canApprove } from '@/lib/domain';
import type { FormState } from '@/lib/forms';
import type { getSession } from '@/lib/session';
import { logChange } from './changelog';

// Changement de statut d'une action, appliqué par moveAction (plan-ui.ts).
// Pas de 'use server' : les contrôles de rôle sont faits par l'appelant.

export type Session = Awaited<ReturnType<typeof getSession>>;
export type ActionRecord = typeof t.actions.$inferSelect;
export type StatusTarget = 'todo' | 'doing' | 'verify' | 'done';

/**
 * Applique la transition `to` à l'action `row` et la consigne dans l'historique.
 * La clôture exige le constat d'efficacité et un rôle de validation (animateur QHSE, direction).
 * Une action annulée n'est plus modifiable.
 */
export async function applyActionStatus(db: DbOrTx, session: Session, row: ActionRecord, to: StatusTarget, { note, verifyDueOn }: { note?: string | null; verifyDueOn?: string | null } = {}): Promise<FormState> {
  const id = row.id;
  const now = today();
  if (row.status === 'cancelled') return { error: 'Action annulée : consultation seule.' };
  let summary: string;

  if (to === 'done') {
    if (!canApprove(session.role)) return { error: "La clôture après vérification d'efficacité est réservée à l'animateur QHSE et à la direction." };
    if (!note) return { error: "Décrivez le constat d'efficacité avant de clôturer.", fieldErrors: { efficacyNote: 'Champ obligatoire.' } };
    await db.update(t.actions).set({ status: 'done', efficacyNote: note, verifiedById: session.user.id, closedOn: now }).where(eq(t.actions.id, id));
    summary = 'Clôturée — efficacité vérifiée';
  } else if (to === 'verify') {
    const due = verifyDueOn ?? row.verifyDueOn ?? addDays(now, 30);
    await db.update(t.actions).set({ status: 'verify', verifyDueOn: due, closedOn: null }).where(eq(t.actions.id, id));
    summary = `Déclarée réalisée — vérification le ${fmtDayMonth(due)}`;
  } else {
    // Retour en cours après une efficacité jugée insuffisante, ou réouverture : le constat est conservé.
    if (row.status === 'done' && !canApprove(session.role)) return { error: "Seuls l'animateur QHSE et la direction rouvrent une action clôturée." };
    await db.update(t.actions).set({ status: to, closedOn: null, efficacyNote: note ?? row.efficacyNote }).where(eq(t.actions.id, id));
    summary = row.status === 'done' ? 'Rouverte' : row.status === 'verify' ? 'Efficacité insuffisante' : to === 'doing' ? 'Démarrée' : 'Remise à lancer';
  }
  await logChange(db, {
    entityType: 'action', entityId: id, action: 'status', summary, byId: session.user.id,
    reason: to !== 'verify' && to !== 'done' && row.status === 'verify' ? note ?? null : null,
  });
  return { ok: true, id };
}
