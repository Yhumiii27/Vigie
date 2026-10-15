import 'server-only';
import { cookies } from 'next/headers';
import { config, entraMissing, secureCookies } from '../config';
import { ROLE_KEYS } from '../domain';
import { openSession, sessionCookieName } from './cookie';
import type { AuthState } from './types';

/**
 * Hors démonstration : session Microsoft Entra ID (cookie chiffré et signé, VIGIE_SESSION_SECRET, établi par
 * /auth/retour). Configuration incomplète : refus explicite, jamais de rôle par défaut. Sans accès à la base
 * (appelable dans une transaction) ; l'expiration glissante (8 h) est repoussée par src/proxy.ts.
 */
export async function readEntraAuth(): Promise<AuthState> {
  const missing = entraMissing();
  if (missing.length) return { status: 'unconfigured', missing };
  const c = config();
  const token = (await cookies()).get(sessionCookieName(secureCookies(c)))?.value;
  const session = await openSession(token, c.sessionSecret!);
  if (!session) return { status: 'anonymous' };
  if (!ROLE_KEYS.includes(session.role)) return { status: 'forbidden', reason: 'rôle inconnu' };
  return { status: 'authenticated', identity: { personId: session.pid, role: session.role, siteIds: session.sites } };
}
