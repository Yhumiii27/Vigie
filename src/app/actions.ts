'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isDemo, secureCookies } from '@/lib/config';
import { DEMO_ROLE_COOKIE } from '@/lib/demo';
import { ROLE_KEYS, SCREENS, homeOf, type Role } from '@/lib/domain';
import { SITE_COOKIE, getSession } from '@/lib/session';

const YEAR = 60 * 60 * 24 * 365;
/** Cookies de préférence : httpOnly, SameSite=Lax, Secure dès que Vigie est servi en HTTPS (SEC-05). */
const prefCookie = () => ({ path: '/', maxAge: YEAR, sameSite: 'lax', httpOnly: true, secure: secureCookies() }) as const;

/** Sélecteur de rôle : démonstration seulement (VIGIE_DEMO=1) ; hors démonstration, le rôle vient d'Entra ID. */
export async function setRole(role: string) {
  if (!isDemo() || !(ROLE_KEYS as string[]).includes(role)) return;
  (await cookies()).set(DEMO_ROLE_COOKIE, role, prefCookie());
  redirect(SCREENS[homeOf(role as Role)].path);
}

/** Site sélectionné : un site du périmètre de la personne connectée (ou « Tous les sites » s'il lui est proposé). */
export async function setSite(siteId: string) {
  const { siteOptions } = await getSession();
  if (!siteOptions.some((s) => s.id === siteId)) return;
  (await cookies()).set(SITE_COOKIE, siteId, prefCookie());
  revalidatePath('/', 'layout');
}
