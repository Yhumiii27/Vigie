'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { DASHBOARD_ROLES, canEditRoleLayout, isDashboardRole, layoutSummary, parseLayout, type DashboardRole } from '@/lib/dashboard-cards';
import { formReader, type FormState } from '@/lib/forms';
import { getSession } from '@/lib/session';
import { logChange } from './changelog';

// Tableaux de bord configurables (TDB-19) : disposition personnelle de l'animateur QHSE et de la direction, et disposition
// par défaut d'un rôle tenue par l'animateur QHSE. Seules les cartes du catalogue fermé (src/lib/dashboard-cards.ts) et
// leurs options sont enregistrées ; les indicateurs restent calculés. Journal `dashboard_layout` (identifiant : la personne,
// ou « role:<rôle> ») dans la transaction de l'écriture.

const DENIED = 'Tableau de bord configurable par l’animateur QHSE et la direction.';
const ROLE_DENIED = 'Disposition par défaut d’un rôle tenue par l’animateur QHSE.';

/** Cible d'une écriture : sa propre disposition (« personne »), ou celle d'un rôle (animateur QHSE seulement). */
async function target(fd: FormData): Promise<{ error: string } | { userId: string; personId: string | null; role: DashboardRole | null; journalId: string; label: string }> {
  const { role, user } = await getSession();
  if (!isDashboardRole(role)) return { error: DENIED };
  const raw = fd.get('target');
  if (raw == null || raw === '' || raw === 'personne') return { userId: user.id, personId: user.id, role: null, journalId: user.id, label: 'Disposition personnelle' };
  if (!canEditRoleLayout(role)) return { error: ROLE_DENIED };
  const wanted = DASHBOARD_ROLES.find((r) => r === raw);
  if (!wanted) return { error: 'Rôle inconnu.' };
  return { userId: user.id, personId: null, role: wanted, journalId: `role:${wanted}`, label: `Disposition par défaut (${wanted})` };
}

const rowWhere = (o: { personId: string | null; role: DashboardRole | null }) =>
  (o.personId ? eq(t.dashboardLayouts.personId, o.personId) : and(isNull(t.dashboardLayouts.personId), eq(t.dashboardLayouts.role, o.role!)));

/** Enregistre la disposition (champ `cards` : JSON des cartes dans l'ordre, avec leur période et leur périmètre). */
export async function saveDashboardLayout(_prev: FormState, fd: FormData): Promise<FormState> {
  const who = await target(fd);
  if ('error' in who) return { error: who.error };
  const f = formReader(fd);
  const raw = f.str('cards', { required: true });
  if (!f.ok) return f.state();
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return { error: 'Disposition illisible.' }; }
  const { cards, error } = parseLayout(json);
  if (error) return { error };
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(t.dashboardLayouts).where(rowWhere(who));
    if (before) await tx.update(t.dashboardLayouts).set({ cards, updatedAt: new Date(), updatedById: who.userId }).where(eq(t.dashboardLayouts.id, before.id));
    else await tx.insert(t.dashboardLayouts).values({ personId: who.personId, role: who.personId ? null : who.role, cards, updatedById: who.userId });
    await logChange(tx, {
      entityType: 'dashboard_layout', entityId: who.journalId, action: before ? 'update' : 'create', byId: who.userId,
      summary: `${who.label} enregistrée (${cards.length} carte${cards.length > 1 ? 's' : ''})`,
      details: [{ field: 'Cartes', from: before ? layoutSummary(parseLayout(before.cards).cards) : null, to: layoutSummary(cards) }],
    });
  });
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Tableau de bord enregistré.' };
}

/**
 * « Revenir à la disposition par défaut » : retire la disposition personnelle (celle du rôle s'applique de nouveau), ou la
 * disposition par défaut d'un rôle (celle de Vigie s'applique). Préférence d'affichage, jamais un enregistrement métier :
 * la ligne est retirée, le journal garde l'ancienne disposition.
 */
export async function resetDashboardLayout(_prev: FormState, fd: FormData): Promise<FormState> {
  const who = await target(fd);
  if ('error' in who) return { error: who.error };
  const db = await getDb();
  const done = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(t.dashboardLayouts).where(rowWhere(who));
    if (!before) return false;
    await tx.delete(t.dashboardLayouts).where(eq(t.dashboardLayouts.id, before.id));
    await logChange(tx, {
      entityType: 'dashboard_layout', entityId: who.journalId, action: 'reset', byId: who.userId, summary: `${who.label} retirée : disposition par défaut rétablie`,
      details: [{ field: 'Cartes', from: layoutSummary(parseLayout(before.cards).cards), to: null }],
    });
    return true;
  });
  revalidatePath('/', 'layout');
  return { ok: true, message: done ? 'Disposition par défaut rétablie.' : 'La disposition par défaut s’applique déjà.' };
}
