import 'server-only';
import { cookies } from 'next/headers';
import { DEMO_ROLE_COOKIE, DEMO_ROLE_PEOPLE } from '../demo';
import { demoRoleOf } from './route-access';
import type { AuthState } from './types';

/** Démonstration : rôle choisi dans le sélecteur (cookie), personne de démonstration associée, tous les sites. */
export async function readDemoAuth(): Promise<AuthState> {
  // Même règle que le proxy (redirections de rôle avant le rendu, SEC-14) : demoRoleOf.
  const role = demoRoleOf((await cookies()).get(DEMO_ROLE_COOKIE)?.value);
  return { status: 'authenticated', identity: { personId: DEMO_ROLE_PEOPLE[role], role, siteIds: null } };
}
