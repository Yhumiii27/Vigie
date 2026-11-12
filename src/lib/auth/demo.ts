import 'server-only';
import { cookies } from 'next/headers';
import { DEMO_CSE_PEOPLE, DEMO_ROLE_COOKIE, DEMO_ROLE_PEOPLE } from '../demo';
import { demoRoleOf } from './route-access';
import type { AuthState } from './types';

/** Démonstration : rôle choisi dans le sélecteur (cookie), personne de démonstration associée, tous les sites. */
export async function readDemoAuth(): Promise<AuthState> {
  // Même règle que le proxy (redirections de rôle avant le rendu, SEC-14) : demoRoleOf.
  const role = demoRoleOf((await cookies()).get(DEMO_ROLE_COOKIE)?.value);
  const personId = DEMO_ROLE_PEOPLE[role];
  return { status: 'authenticated', identity: { personId, role, siteIds: null, cse: DEMO_CSE_PEOPLE.includes(personId) } };
}
