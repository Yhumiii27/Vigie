import 'server-only';
import { getDb } from '@/db';
import { config } from '../config';
import type { Role } from '../domain';
import { readClavisAccess } from '../foreign/clavis';
import { log } from '../log';
import { roleFromClavisAccess } from './claims';

// Droits lus dans Clavis (VIGIE_ACCESS_FROM_CLAVIS=on ; décision du propriétaire du 23/11/2026 : une seule base, les droits
// lus dans la base, jamais dans le jeton — Norma § 6). Lecture de clavis.pub_acces (src/lib/foreign/clavis.ts) à la
// connexion (`fresh`, /auth/retour) puis pendant la session (src/lib/session.ts) au plus toutes les
// VIGIE_ACCESS_FROM_CLAVIS_SECONDS (60 par défaut) : un rôle changé dans Clavis vaut à la page suivante après ce délai, un
// accès fermé termine la session. Lecture impossible = refus ; un échec n'est jamais gardé (relu à la requête suivante).

export type ClavisGrant =
  | { ok: true; role: Role }
  /** closed : aucun accès ouvert à Vigie (ligne absente, accès retiré, rôle inconnu) ; unreadable : vue illisible. */
  | { ok: false; reason: 'closed' | 'unreadable'; detail: string };

const MAX_ENTRIES = 5000;
const grants = new Map<string, { grant: ClavisGrant; at: number }>();

/** Oublie les droits gardés (essais). */
export function forgetClavisAccess() {
  grants.clear();
}

/**
 * Rôle Vigie accordé par Clavis à la personne `oid` (personne_id de clavis.pub_acces). `fresh` : relit la vue (connexion) ;
 * sinon une lecture réussie sert pendant VIGIE_ACCESS_FROM_CLAVIS_SECONDS (accès ouvert comme fermé).
 */
export async function clavisGrant(oid: string, opts: { fresh?: boolean; now?: number } = {}): Promise<ClavisGrant> {
  const now = opts.now ?? Date.now();
  const c = config();
  const kept = grants.get(oid);
  if (!opts.fresh && kept && now - kept.at < c.accessFromClavisSeconds * 1000) return kept.grant;
  const read = await readClavisAccess(await getDb(), oid);
  if (!read.ok) {
    grants.delete(oid);
    log.warn('auth.clavis', 'Droits de Clavis illisibles : accès refusé', { status: read.status, message: read.message });
    return { ok: false, reason: 'unreadable', detail: read.message };
  }
  const role = roleFromClavisAccess(read.rows[0], c.entraRoles);
  const grant: ClavisGrant = role
    ? { ok: true, role }
    : { ok: false, reason: 'closed', detail: read.rows[0] ? `accès à Vigie fermé dans Clavis (rôle ${read.rows[0].role ?? 'aucun'}, ouvert ${read.rows[0].open})` : 'aucun accès à Vigie dans Clavis' };
  grants.delete(oid);
  grants.set(oid, { grant, at: now });
  if (grants.size > MAX_ENTRIES) grants.delete(grants.keys().next().value!);
  return grant;
}
