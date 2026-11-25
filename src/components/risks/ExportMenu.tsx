'use client';

import { useEffect, useRef } from 'react';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

/** Menu « Exporter » : CSV de l'unité sélectionnée ou de tout le DUERP du périmètre affiché. */
export function ExportMenu({ unit, scopeLabel, unitCount }: { unit?: { id: string; label: string }; scopeLabel: string; unitCount: number }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const d = ref.current;
      if (d?.open && !d.contains(e.target as Node)) d.open = false;
    };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && ref.current?.open) ref.current.open = false; };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, []);
  const close = () => { if (ref.current) ref.current.open = false; };
  const items = [
    unit && { href: `/risques/export?unite=${encodeURIComponent(unit.id)}`, label: t('Export the unit'), sub: unit.label },
    { href: '/risques/export?portee=tout', label: t('Export the whole DUERP'), sub: `${scopeLabel} · ${fill(unitCount > 1 ? t('{n} units') : t('{n} unit'), { n: unitCount })}` },
  ].filter((i) => !!i);
  return (
    <details ref={ref} className="vg-dropdown">
      <summary className="btn btn-ghost" style={{ fontSize: 12 }}>
        <i className="ph ph-download-simple" style={{ fontSize: 13 }} aria-hidden />{t('Export')}<i className="ph ph-caret-down" style={{ fontSize: 11 }} aria-hidden />
      </summary>
      <div className="vg-menu elev-md" style={{ minWidth: 240 }}>
        {items.map((i) => (
          <a key={i.href} href={i.href} download className="vg-menu-item" onClick={close} style={{ display: 'grid', gap: 1 }}>
            <span>{i.label}</span>
            <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{i.sub} · CSV</span>
          </a>
        ))}
      </div>
    </details>
  );
}
