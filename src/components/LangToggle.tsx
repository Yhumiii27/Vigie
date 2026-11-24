'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useI18n } from '@/i18n/client';
import { LANGS, langCookie, type Lang } from '@/i18n/translate';

/** Nom de chaque langue dans sa propre langue (jamais traduit). */
const NAMES: Record<Lang, string> = { fr: 'Français', en: 'English' };

/** Applique la langue dans le navigateur : cookie (relu par le serveur au rendu) et attribut lang de <html>. */
function applyLang(lang: Lang) {
  document.cookie = langCookie(lang);
  document.documentElement.lang = lang;
}

/**
 * Sélecteur FR / EN (Norma § 7, VG-N01), juste avant la bascule sombre / clair dans l'en-tête de la barre latérale :
 * écrit le cookie vigie-lang dans le navigateur puis relit la page (le serveur rend l'interface dans la langue choisie,
 * src/i18n/server.ts). Même forme que ThemeToggle (groupe de boutons radio, infobulle accessible).
 */
export function LangToggle({ lang: initial }: { lang: Lang }) {
  const { t } = useI18n();
  const router = useRouter();
  const [lang, setLang] = useState<Lang>(initial);
  const [pending, startTransition] = useTransition();
  const choose = (v: Lang) => {
    setLang(v);
    applyLang(v);
    startTransition(() => router.refresh());
  };
  return (
    <div className="seg vg-theme-toggle vg-lang-toggle" role="radiogroup" aria-label={t('Language')} aria-busy={pending || undefined}>
      {LANGS.map((value) => (
        <label key={value} className="seg-opt vg-tip" lang={value}>
          <input type="radio" name="vg-lang" value={value} checked={lang === value} onChange={() => choose(value)} />
          <span aria-hidden>{value.toUpperCase()}</span>
          <span className="vg-sr-only">{NAMES[value]}</span>
          <span className="vg-tip-bubble" aria-hidden>{NAMES[value]}</span>
        </label>
      ))}
    </div>
  );
}
