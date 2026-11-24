import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { LANG_COOKIE, langOf, makeT, type Lang, type T } from './translate';

// Langue de la requête (cookie vigie-lang, français par défaut) et traducteur des composants serveur (VG-N01).

export const getLang = cache(async (): Promise<Lang> => langOf((await cookies()).get(LANG_COOKIE)?.value));

export const getI18n = cache(async (): Promise<{ lang: Lang; t: T }> => {
  const lang = await getLang();
  return { lang, t: makeT(lang) };
});
