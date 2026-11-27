import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { SCREENS, type ScreenKey } from '@/lib/domain';
import { SCREEN_TITLE_EN } from './nav';
import { LANG_COOKIE, langOf, makeT, type Lang, type T } from './translate';

// Langue de la requête (cookie vigie-lang, français par défaut) et traducteur des composants serveur (VG-N01).

export const getLang = cache(async (): Promise<Lang> => langOf((await cookies()).get(LANG_COOKIE)?.value));

export const getI18n = cache(async (): Promise<{ lang: Lang; t: T }> => {
  const lang = await getLang();
  return { lang, t: makeT(lang) };
});

/** Titre de l'onglet d'un écran (SCREENS.title) dans la langue de la requête (SCREEN_TITLE_EN, sinon le titre français). */
export async function screenMetadata(key: ScreenKey): Promise<Metadata> {
  const { t } = await getI18n();
  const en = SCREEN_TITLE_EN[key];
  return { title: en ? t(en) : SCREENS[key].title };
}

