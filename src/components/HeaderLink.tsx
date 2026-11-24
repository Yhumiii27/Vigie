'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useHeaderMenu } from './coque';

/**
 * Lien d'action de l'en-tête de page (COQUE.md § 3.3) : bouton secondaire, ou ligne du menu « Actions » quand l'écran a
 * plus de trois actions (role="menuitem", le menu se ferme au clic). `plain` : lien HTML simple (feuille imprimable ouverte
 * dans un nouvel onglet, sans préchargement).
 */
export function HeaderLink({ href, icon, plain, className = '', children }: { href: string; icon: string; plain?: boolean; className?: string; children: ReactNode }) {
  const menu = useHeaderMenu();
  const inner = <><i className={`ph ${icon}`} style={{ fontSize: 14 }} aria-hidden />{children}</>;
  const props = menu
    ? { role: 'menuitem' as const, className: `vg-menu-item vg-menu-row ${className}`.trim(), onClick: () => menu.close() }
    : { className: `btn btn-secondary ${className}`.trim() };
  return plain ? <a href={href} target="_blank" rel="noreferrer" {...props}>{inner}</a> : <Link href={href} {...props}>{inner}</Link>;
}
