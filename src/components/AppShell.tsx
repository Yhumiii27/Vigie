'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { StatusToaster } from './feedback';
import { Sidebar, type SidebarProps } from './Sidebar';
import { Icon } from './ui';

const WIDE = '(min-width: 761px)';
/** Cible du lien d'évitement (UX-11). */
export const MAIN_ID = 'contenu';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Coque de l'application : barre latérale, et sur téléphone (≤ 760 px) barre supérieure et tiroir de navigation (UX-01).
 * Tiroir ouvert : barre supérieure et contenu inertes (focus gardé dans le tiroir), Échap ou le fond le ferment et rendent
 * le focus au bouton du menu ; un lien, le choix du site ou du rôle le ferment aussi. Passage en grand écran : fermé.
 * UX-11 : lien d'évitement « Aller au contenu » (premier élément de la page, vers <main id="contenu">) ; UX-14 : région
 * d'annonce des enregistrements (StatusToaster).
 */
export function AppShell({ sidebar, children }: { sidebar: SidebarProps; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // Fermeture par Échap, le fond ou « Fermer le menu » : focus rendu au bouton une fois l'inertie levée (effet ci-dessous).
  const restoreFocus = useRef(false);
  const close = useCallback(() => { restoreFocus.current = true; setOpen(false); }, []);
  const navigate = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) {
      if (restoreFocus.current) toggleRef.current?.focus();
      restoreFocus.current = false;
      return;
    }
    document.getElementById('vg-side')?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    // Un menu ouvert dans le tiroir (site, rôle) traite Échap avant (capture + preventDefault, Sidebar).
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const onChange = (e: MediaQueryListEvent) => { if (e.matches) setOpen(false); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return (
    <div className={`vg-app${open ? ' is-nav-open' : ''}`}>
      <a href={`#${MAIN_ID}`} className="vg-skip" inert={open || undefined}>Aller au contenu</a>
      <div className="vg-topbar" inert={open || undefined}>
        <button ref={toggleRef} type="button" className="btn btn-ghost btn-icon" aria-label="Ouvrir le menu de navigation"
          aria-expanded={open} aria-controls="vg-side" onClick={() => setOpen(true)}>
          <Icon name="ph-list" size={20} />
        </button>
        <span className="vg-brand-mark" aria-hidden>V</span>
        <span className="vg-brand-name" style={{ fontSize: 15 }}>Vigie</span>
        <span className="vg-topbar-site">{sidebar.site.label.split(' — ')[0]}</span>
      </div>
      <Sidebar {...sidebar} open={open} onNavigate={navigate} onClose={close} />
      {open && <div className="vg-side-backdrop" onClick={close} />}
      <main id={MAIN_ID} tabIndex={-1} className="vg-main" inert={open || undefined}>{children}</main>
      <StatusToaster />
    </div>
  );
}
