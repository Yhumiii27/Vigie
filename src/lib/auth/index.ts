import 'server-only';
import { cache } from 'react';
import { isDemo } from '../config';
import { readDemoAuth } from './demo';
import { readEntraAuth } from './entra';
import { LOGIN_PATH, accessHref } from './paths';
import type { AuthState } from './types';

export type { AccessDenial, AuthIdentity, AuthState } from './types';

/**
 * Identité de la requête (mémorisée par requête), sans accès à la base :
 * démonstration → sélecteur de rôle ; sinon → session Entra ID.
 */
export const getAuthState = cache(async (): Promise<AuthState> => (isDemo() ? readDemoAuth() : readEntraAuth()));

/** Page vers laquelle renvoyer une requête sans identité valide. */
export function authFailureHref(state: Exclude<AuthState, { status: 'authenticated' }>): string {
  switch (state.status) {
    case 'anonymous': return LOGIN_PATH;
    case 'unconfigured': return accessHref('configuration');
    case 'forbidden': return accessHref('non-autorise');
  }
}
