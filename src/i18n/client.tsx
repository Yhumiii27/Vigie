'use client';

// `{ lang, t }` des composants du navigateur (VG-N01), fourni par la mise en page racine d'après le cookie vigie-lang.
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DEFAULT_LANG, makeT, type Lang, type T } from './translate';

const Ctx = createContext<{ lang: Lang; t: T }>({ lang: DEFAULT_LANG, t: makeT(DEFAULT_LANG) });

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const value = useMemo(() => ({ lang, t: makeT(lang) }), [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Langue et traducteur des composants du navigateur. */
export const useI18n = () => useContext(Ctx);
