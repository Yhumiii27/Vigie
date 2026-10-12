'use client';

import Link from 'next/link';
import { useTransition, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { markNotificationsRead, openTodo } from '@/server/notifications';

/** Échéance affichée (cloche, page À faire, carte « À traiter ») : clé d'état lu, lien, autre site, état lu. */
export type TodoLinkItem = { key: string; href?: string; elsewhere: boolean; read?: boolean };

type Props = {
  item: TodoLinkItem;
  /** Marquer l'échéance comme lue à l'ouverture (cloche). */
  markRead?: boolean;
  /** Appelé à l'ouverture (fermeture du panneau de la cloche). */
  onOpen?: () => void;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
};

const modified = (e: MouseEvent) => e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

/**
 * Lien d'une échéance :
 * - sans lien (écran source fermé au rôle et sans vue en lecture, TDB-02) : simple bloc, non cliquable ;
 * - échéance d'un autre site (TDB-05) : openTodo sélectionne d'abord son site, puis ouvre l'élément (un clic avec une
 *   touche de modification garde le comportement du navigateur, sur le site sélectionné) ;
 * - sinon : lien de navigation, qui marque l'échéance comme lue si demandé.
 */
export function TodoLink({ item, markRead, onOpen, className, style, children }: Props) {
  const [pending, start] = useTransition();
  if (!item.href) return <div className={className} style={style}>{children}</div>;
  if (item.elsewhere) {
    return (
      <a href={item.href} className={className} style={style} aria-busy={pending || undefined}
        onClick={(e) => {
          if (modified(e)) return;
          e.preventDefault();
          onOpen?.();
          start(() => openTodo(item.key, { markRead }));
        }}>
        {children}
      </a>
    );
  }
  return (
    <Link href={item.href} className={className} style={style}
      onClick={() => {
        if (markRead && !item.read) start(() => markNotificationsRead([item.key]));
        onOpen?.();
      }}>
      {children}
    </Link>
  );
}
