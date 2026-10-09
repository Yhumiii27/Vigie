'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ROLE_KEYS, SCREENS, homeOf, type Role } from '@/lib/domain';
import { ROLE_COOKIE, SITE_COOKIE } from '@/lib/session';

const YEAR = 60 * 60 * 24 * 365;

export async function setRole(role: string) {
  if (!(ROLE_KEYS as string[]).includes(role)) return;
  (await cookies()).set(ROLE_COOKIE, role, { path: '/', maxAge: YEAR, sameSite: 'lax' });
  redirect(SCREENS[homeOf(role as Role)].path);
}

export async function setSite(siteId: string) {
  (await cookies()).set(SITE_COOKIE, siteId, { path: '/', maxAge: YEAR, sameSite: 'lax' });
  revalidatePath('/', 'layout');
}
