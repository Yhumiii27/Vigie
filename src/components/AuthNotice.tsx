import type { ReactNode } from 'react';

/** Cadre des pages d'authentification (accès refusé, déconnexion), affichées sans session. */
export function AuthNotice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ display: 'grid', gap: 16, justifyItems: 'center', maxWidth: 480, textAlign: 'center' }}>
        <div className="vg-brand" style={{ padding: 0 }}>
          <span className="vg-brand-mark">V</span>
          <span className="vg-brand-name">Vigie</span>
        </div>
        <div className="card" style={{ gap: 10, alignItems: 'center' }}>
          <div className="card-title" style={{ fontSize: 15 }}>{title}</div>
          {children}
        </div>
      </div>
    </main>
  );
}

export function NoticeBody({ children }: { children: ReactNode }) {
  return <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>{children}</p>;
}
