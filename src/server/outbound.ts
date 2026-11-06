import 'server-only';
import { createHmac } from 'node:crypto';
import { and, asc, desc, eq, lte } from 'drizzle-orm';
import { schema as t, type Db } from '@/db';
import { config } from '@/lib/config';
import { log } from '@/lib/log';
import { OUTBOUND_MAX_ATTEMPTS, OUTBOUND_TARGETS, readCodexResponse, retryDelayMs, type DeliveryOutcome, type OutboundTarget } from '@/lib/rules/outbound';
import { logChange } from './changelog';
import { ECR_ENTITY } from './engineering-core';

// Envois aux autres outils (D12, lot 5 de M-02) : la tâche planifiée « Envois aux outils » (src/db/scheduler.ts, à chaque
// passage, serveur Next.js seulement) et « Envoyer maintenant » (onglet « Connecteurs ») envoient les messages
// outbound_messages « à envoyer » dont l'heure de reprise est passée. Codex : POST <VIGIE_CODEX_URL>/api/integrations/vigie,
// jeton (Authorization: Bearer) et / ou signature HMAC-SHA256 (X-Codex-Timestamp, X-Codex-Signature: v1=…) selon les
// variables posées (docs/api.md de Codex, « Authentification »). Sans adresse ni identifiant : rien n'est envoyé, les
// messages restent « à envoyer » (onglet « Connecteurs »), jamais d'erreur de page. Reprises espacées (retryDelayMs) ;
// refus définitif (4xx) ou trop de tentatives : « refusé ». Journal du serveur : identifiant, destinataire et statut
// seulement — jamais le corps, le jeton ni la signature.

export type OutboundRunResult = { sent: number; retried: number; failed: number; skipped: OutboundTarget[] };

/** Nombre maximal de messages envoyés par passage (le reste attend le passage suivant). */
const BATCH = 50;
const TIMEOUT_MS = 10_000;

/** Adresse et en-têtes d'authentification de Codex, ou null quand l'envoi n'est pas configuré. */
function codexEndpoint(): { url: string; token: string | null; secret: string | null } | null {
  const c = config();
  if (!c.codexUrl || (!c.codexWebhook.token && !c.codexWebhook.secret)) return null;
  return { url: `${c.codexUrl}${OUTBOUND_TARGETS.codex.path}`, ...c.codexWebhook };
}

/** En-têtes d'un envoi signé (contrat de Codex : HMAC-SHA256 de « <horodatage>.<corps brut> », en hexadécimal). */
export function codexHeaders(body: string, auth: { token: string | null; secret: string | null }, now = Date.now()): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (auth.secret) {
    const timestamp = String(Math.floor(now / 1000));
    headers['X-Codex-Timestamp'] = timestamp;
    headers['X-Codex-Signature'] = `v1=${createHmac('sha256', auth.secret).update(`${timestamp}.`).update(body).digest('hex')}`;
  }
  return headers;
}

type Message = typeof t.outboundMessages.$inferSelect;

/** Applique l'issue d'un envoi au message et, pour une décision sur une demande, à la demande (état d'envoi, mise en œuvre). */
async function record(db: Db, m: Message, outcome: DeliveryOutcome, status: number | null, retryAfterS: number | null, now: Date) {
  const attempts = m.attempts + 1;
  const giveUp = outcome.kind === 'retry' && attempts >= OUTBOUND_MAX_ATTEMPTS;
  const next: 'sent' | 'pending' | 'failed' = outcome.kind === 'sent' ? 'sent' : outcome.kind === 'failed' || giveUp ? 'failed' : 'pending';
  const error = outcome.kind === 'sent' ? null : giveUp ? `${outcome.error} · ${attempts} tentatives, abandon` : outcome.error;
  await db.transaction(async (tx) => {
    const [row] = await tx.update(t.outboundMessages).set({
      status: next, attempts, lastStatus: status, lastError: error, sentAt: next === 'sent' ? now : null,
      nextAttemptAt: next === 'pending' ? new Date(now.getTime() + retryDelayMs(attempts, retryAfterS)) : m.nextAttemptAt,
    }).where(and(eq(t.outboundMessages.id, m.id), eq(t.outboundMessages.status, 'pending'), eq(t.outboundMessages.attempts, m.attempts))).returning({ id: t.outboundMessages.id });
    if (!row || m.entityType !== ECR_ENTITY) return;
    // État d'envoi recopié sur la demande seulement pour son dernier message (une décision plus récente l'emporte).
    const [latest] = await tx.select({ id: t.outboundMessages.id }).from(t.outboundMessages)
      .where(and(eq(t.outboundMessages.entityType, ECR_ENTITY), eq(t.outboundMessages.entityId, m.entityId))).orderBy(desc(t.outboundMessages.id)).limit(1);
    if (latest && latest.id !== m.id) return;
    await tx.update(t.ecrs).set({ notifyStatus: next, notifyAttempts: attempts, notifyError: error, updatedAt: now }).where(eq(t.ecrs.id, m.entityId));
    if (next === 'sent') {
      const implemented = outcome.kind === 'sent' && outcome.implemented;
      const [ecr] = await tx.select({ status: t.ecrs.status }).from(t.ecrs).where(eq(t.ecrs.id, m.entityId));
      if (implemented && ecr?.status === 'accepted') {
        const revision = outcome.kind === 'sent' ? outcome.revision : null;
        await tx.update(t.ecrs).set({ status: 'implemented', implementedAt: now, codexRevision: revision, updatedAt: now }).where(eq(t.ecrs.id, m.entityId));
        await logChange(tx, {
          entityType: ECR_ENTITY, entityId: m.entityId, action: 'status', byId: null,
          summary: `Codex : décision appliquée${revision ? `, révision ${revision} ouverte` : ''}`,
          details: [{ field: 'État', from: 'Acceptée', to: 'Mise en œuvre' }],
        });
      } else {
        await logChange(tx, {
          entityType: ECR_ENTITY, entityId: m.entityId, action: 'notify', byId: null,
          summary: outcome.kind === 'sent' && outcome.pending ? 'Décision transmise à Codex (acceptation en attente chez Codex)' : 'Décision transmise à Codex',
        });
      }
    } else if (next === 'failed') {
      await logChange(tx, { entityType: ECR_ENTITY, entityId: m.entityId, action: 'notify', byId: null, summary: `Décision refusée par Codex : ${error}` });
    }
  });
  return next;
}

/**
 * Envoie les messages « à envoyer » dont l'heure est venue, du plus ancien au plus récent ; jamais d'exception (erreur
 * réseau : reprise). `fetchImpl` : remplacé par les tests.
 */
export async function sendOutboundMessages(db: Db, opts: { fetchImpl?: typeof fetch; now?: () => Date } = {}): Promise<OutboundRunResult> {
  const out: OutboundRunResult = { sent: 0, retried: 0, failed: 0, skipped: [] };
  const clock = opts.now ?? (() => new Date());
  const doFetch = opts.fetchImpl ?? fetch;
  const due = await db.select().from(t.outboundMessages)
    .where(and(eq(t.outboundMessages.status, 'pending'), lte(t.outboundMessages.nextAttemptAt, clock()))).orderBy(asc(t.outboundMessages.id)).limit(BATCH);
  if (!due.length) return out;
  const endpoint = codexEndpoint();
  for (const m of due) {
    if (m.target !== 'codex' || !endpoint) {
      if (!out.skipped.includes(m.target as OutboundTarget)) out.skipped.push(m.target as OutboundTarget);
      continue;
    }
    const body = JSON.stringify(m.payload);
    let outcome: DeliveryOutcome;
    let status: number | null = null;
    let retryAfter: number | null = null;
    try {
      const res = await doFetch(endpoint.url, { method: 'POST', headers: codexHeaders(body, endpoint), body, signal: AbortSignal.timeout(TIMEOUT_MS) });
      status = res.status;
      retryAfter = Number(res.headers.get('retry-after')) || null;
      const parsed: unknown = await res.json().catch(() => null);
      outcome = readCodexResponse(res.status, parsed);
    } catch (err) {
      outcome = { kind: 'retry', error: err instanceof Error && err.name === 'TimeoutError' ? 'délai dépassé' : 'Codex injoignable' };
    }
    try {
      const next = await record(db, m, outcome, status, retryAfter, clock());
      if (next === 'sent') out.sent++;
      else if (next === 'failed') out.failed++;
      else out.retried++;
      log[next === 'sent' ? 'info' : 'warn']('outbound.send', next === 'sent' ? 'Message envoyé' : next === 'failed' ? 'Message refusé' : 'Message à reprendre', {
        outbound: m.id, target: m.target, httpStatus: status, attempts: m.attempts + 1,
      });
    } catch (err) {
      log.error('outbound.send', 'État du message non enregistré', { outbound: m.id, error: err });
    }
  }
  if (out.skipped.length) log.info('outbound.send', 'Envoi non configuré : messages laissés à envoyer', { targets: out.skipped.join(',') });
  return out;
}
