'use client';

import { useState } from 'react';
import { Dialog } from '@/components/Dialog';
import { GLOSSARY, SCREEN_HELP, helpScreenOf } from '@/lib/help';
import { SCREENS } from '@/lib/domain';
import { Icon } from './ui';

const clean = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Aide en ligne (UX-16) : entrée « Aide » de la barre latérale, fenêtre accessible au clavier (élément <dialog>, Échap pour
 * fermer) avec l'aide de l'écran affiché et le glossaire des indicateurs (TF1, TG, DUERP…), filtrable. Contenu statique de
 * src/lib/help.ts, sans service externe.
 */
export function HelpButton({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const screen = helpScreenOf(pathname);
  const topic = screen ? SCREEN_HELP[screen] : undefined;
  const q = clean(query.trim());
  const terms = GLOSSARY.filter((g) => !q || clean(`${g.term} ${g.definition}`).includes(q));
  return (
    <>
      <button type="button" className="vg-mobile-link vg-help-link" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="ph-question" size={15} />
        <span style={{ flex: 1, textAlign: 'left' }}>Aide et glossaire</span>
      </button>
      <Dialog open={open} onClose={() => { setOpen(false); setQuery(''); }} title={topic && screen ? SCREENS[screen].title : 'Aide'} kicker="Aide en ligne" width={620}>
        {open && (
          <div style={{ display: 'grid', gap: 16 }}>
            {topic ? (
              <section aria-labelledby="vg-help-screen" style={{ display: 'grid', gap: 6 }}>
                <h3 id="vg-help-screen" className="vg-h6" style={{ margin: 0 }}>Cet écran</h3>
                <p style={{ margin: 0, fontSize: 13, textWrap: 'pretty' }}>{topic.intro}</p>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 12.5, color: 'var(--color-neutral-300)' }}>
                  {topic.tips.map((tip) => <li key={tip} style={{ textWrap: 'pretty' }}>{tip}</li>)}
                </ul>
              </section>
            ) : (
              <p style={{ margin: 0, fontSize: 13 }}>Choisissez un écran dans la barre latérale ; cette fenêtre présente alors son aide.</p>
            )}
            <section aria-labelledby="vg-help-glossary" style={{ display: 'grid', gap: 8 }}>
              <h3 id="vg-help-glossary" className="vg-h6" style={{ margin: 0 }}>Glossaire</h3>
              <input type="search" className="input" data-vg-no-dirty aria-label="Rechercher dans le glossaire" placeholder="TF1, DUERP, BSD…" value={query}
                onChange={(e) => setQuery(e.target.value)} maxLength={60} />
              <dl style={{ margin: 0, display: 'grid', gap: 8 }}>
                {terms.map((g) => (
                  <div key={g.term} style={{ display: 'grid', gap: 1 }}>
                    <dt style={{ fontSize: 12.5, fontWeight: 500 }}>{g.term}</dt>
                    <dd style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>{g.definition}</dd>
                  </div>
                ))}
              </dl>
              {terms.length === 0 && <p role="status" style={{ margin: 0, fontSize: 12, color: 'var(--vg-text-muted)' }}>Aucun terme ne correspond.</p>}
            </section>
            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--vg-text-muted)', textWrap: 'pretty' }}>
              Une question sur vos droits ou une donnée manquante : adressez-vous à l&apos;animateur QHSE de votre site.
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}
