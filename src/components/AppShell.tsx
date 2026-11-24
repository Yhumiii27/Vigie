'use client';

import { Binoculars } from '@phosphor-icons/react/dist/ssr';
import type { ReactNode } from 'react';
import { StatusToaster } from './feedback';
import { Sidebar, type SidebarProps } from './Sidebar';
import { AppShell as CoqueShell, MobileTopBar } from './coque';
import { Prefs } from './Prefs';
import type { Lang } from '@/i18n/translate';
import type { Theme } from '@/lib/theme';

/**
 * Coque de l'application (Norma 2.1, norma/charte/COQUE.md) : grille barre latérale 232 px | contenu, lien d'évitement
 * « Aller au contenu » (UX-11), et jusqu'à 1024 px barre supérieure (bouton « Menu », nom de l'outil, paire langue /
 * affichage en dernier) et barre latérale en tiroir (UX-01 : page inerte, Échap, voile, × ou lien suivi la ferment, focus
 * rendu au bouton). UX-14 : région d'annonce des enregistrements (StatusToaster). Corps d'interface en 13 px (`vg-app`).
 */
export function AppShell({ sidebar, lang, theme, children }: { sidebar: SidebarProps; lang: Lang; theme: Theme; children: ReactNode }) {
  return (
    <CoqueShell className="vg-app" sidebar={<Sidebar {...sidebar} />}
      topbar={<MobileTopBar name="Vigie" icon={Binoculars} prefs={<Prefs lang={lang} theme={theme} />} />}
      after={<StatusToaster />}>
      {children}
    </CoqueShell>
  );
}
