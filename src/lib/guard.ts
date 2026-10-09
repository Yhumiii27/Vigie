import 'server-only';
import { redirect } from 'next/navigation';
import { SCREENS, canApprove, canManage, canSee, homeOf, type ScreenKey } from './domain';
import { getSession } from './session';

/** Redirige vers l'écran d'accueil du rôle si l'écran ne lui est pas ouvert. */
export async function guard(screen: ScreenKey) {
  const session = await getSession();
  if (!canSee(session.role, screen)) redirect(SCREENS[homeOf(session.role)].path);
  return session;
}

/** Pour les server actions : renvoie la session si le rôle peut saisir/modifier, sinon un message d'erreur. */
export async function requireManager() {
  const session = await getSession();
  return canManage(session.role) ? { session, error: null } : { session, error: 'Votre rôle ne permet pas cette modification.' };
}

/** Pour les server actions de validation (animateur QHSE, direction). */
export async function requireApprover() {
  const session = await getSession();
  return canApprove(session.role) ? { session, error: null } : { session, error: "Réservé à l'animateur QHSE et à la direction." };
}
