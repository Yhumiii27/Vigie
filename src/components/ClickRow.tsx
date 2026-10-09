'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

/** Ligne de tableau entièrement cliquable (la première cellule garde un vrai lien). */
export function ClickRow({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <tr className="is-link" onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) router.push(href); }}>
      {children}
    </tr>
  );
}
