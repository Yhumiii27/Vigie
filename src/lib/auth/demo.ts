import 'server-only';
import { cookies } from 'next/headers';
import { DEMO_DEFAULT_ROLE, DEMO_ROLE_COOKIE, DEMO_ROLE_PEOPLE } from '../demo';
import { ROLE_KEYS, type Role } from '../domain';
import type { AuthState } from './types';

/** Démonstration : rôle choisi dans le sélecteur (cookie), personne de démonstration associée, tous les sites. */
export async function readDemoAuth(): Promise<AuthState> {
  const raw = (await cookies()).get(DEMO_ROLE_COOKIE)?.value;
  const role = raw && (ROLE_KEYS as string[]).includes(raw) ? (raw as Role) : DEMO_DEFAULT_ROLE;
  return { status: 'authenticated', identity: { personId: DEMO_ROLE_PEOPLE[role], role, siteIds: null } };
}
