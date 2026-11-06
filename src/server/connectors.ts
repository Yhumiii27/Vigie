'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { formReader, type FormState } from '@/lib/forms';
import { requireApprover, requireInSite } from '@/lib/guard';
import { SOURCES } from '@/lib/foreign/labels';
import { logChange } from './changelog';
import { refreshSharedReferences } from './foreign-sync';
import { processInboundRequests } from './inbound';
import { sendOutboundMessages } from './outbound';

/**
 * « Actualiser » de l'onglet « Connecteurs » (« Gérer les sites », animateur QHSE et direction) : rafraîchit tout de suite
 * les caches des référentiels partagés et contrôle les lectures directes (src/server/foreign-sync.ts, journal sync_runs).
 * Une source indisponible n'est pas une erreur du formulaire : le message la nomme.
 */
export async function refreshConnectors(): Promise<FormState> {
  const { error } = await requireApprover();
  if (error) return { error };
  const results = await refreshSharedReferences(await getDb());
  revalidatePath('/', 'layout');
  const down = results.filter((r) => r.status !== 'ok').map((r) => `${SOURCES[r.source].label} (${SOURCES[r.source].tool})`);
  return { ok: true, message: down.length ? `Sources actualisées, sauf : ${down.join(', ')}.` : 'Sources actualisées.' };
}

/**
 * « Traiter maintenant » (onglet « Connecteurs », animateur QHSE et direction) : traite tout de suite les demandes reçues
 * des autres outils (D13, décision CV-08), sans attendre le passage de la tâche planifiée « Demandes reçues ».
 */
export async function processInboundNow(): Promise<FormState> {
  const { error } = await requireApprover();
  if (error) return { error };
  const r = await processInboundRequests(await getDb());
  revalidatePath('/', 'layout');
  if (!r.processed && !r.failed && !r.deferred) return { ok: true, message: 'Aucune demande à traiter.' };
  return {
    ok: true,
    message: `${r.processed} demande(s) traitée(s) : ${r.applied} appliquée(s), ${r.rejected} refusée(s)${r.failed ? ` ; ${r.failed} en erreur, laissée(s) à traiter (journal du serveur)` : ''}${r.deferred ? ` ; ${r.deferred} en attente d’une source indisponible` : ''}.`,
  };
}

/**
 * Refus d'une demande reçue pris en compte par le QHSE (fin de l'échéance « demande refusée »), avec motif (QUA-22) :
 * animateur QHSE et direction, site de la NC visée ; journal `inbound_request` « acknowledge ».
 */
export async function acknowledgeInboundRequest(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true });
  const reason = f.reason();
  if (!f.ok || id == null) return f.state();
  const db = await getDb();
  const [r] = await db.select().from(t.inboundRequests).where(eq(t.inboundRequests.id, id));
  if (!r) return { error: 'Demande introuvable.' };
  if (r.status !== 'rejected') return { error: 'Seul le refus d’une demande se prend en compte.' };
  if (r.acknowledgedAt) return { error: 'Refus déjà pris en compte.' };
  if (r.eventId) {
    const [ev] = await db.select({ siteId: t.events.siteId }).from(t.events).where(eq(t.events.id, r.eventId));
    const siteError = await requireInSite(ev?.siteId);
    if (siteError) return { error: siteError };
  }
  const done = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.inboundRequests).set({ acknowledgedAt: new Date(), acknowledgedById: session.user.id, acknowledgeReason: reason })
      .where(and(eq(t.inboundRequests.id, id), isNull(t.inboundRequests.acknowledgedAt))).returning({ id: t.inboundRequests.id });
    if (!row) return false;
    await logChange(tx, { entityType: 'inbound_request', entityId: id, action: 'acknowledge', summary: `Refus de la demande n° ${id} (${r.targetRef}) pris en compte`, reason });
    return true;
  });
  if (!done) return { error: 'Refus déjà pris en compte.' };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Refus pris en compte.' };
}

/**
 * « Envoyer maintenant » (onglet « Connecteurs », animateur QHSE et direction) : envoie tout de suite les messages de la
 * file d'envoi dont l'heure de reprise est venue (D12 : décisions transmises à Codex), sans attendre « Envois aux outils ».
 */
export async function sendOutboundNow(): Promise<FormState> {
  const { error } = await requireApprover();
  if (error) return { error };
  const r = await sendOutboundMessages(await getDb());
  revalidatePath('/', 'layout');
  if (r.skipped.length) return { ok: true, message: 'Envoi à Codex non configuré (VIGIE_CODEX_URL et jeton ou secret du webhook) : messages laissés à envoyer.' };
  if (!r.sent && !r.retried && !r.failed) return { ok: true, message: 'Aucun message à envoyer pour l’instant.' };
  return { ok: true, message: `${r.sent} message(s) envoyé(s), ${r.retried} à reprendre, ${r.failed} refusé(s).` };
}
