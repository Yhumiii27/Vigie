import Link from 'next/link';
import { Icon, ToneTag } from '@/components/ui';
import type { SimopsData } from '@/lib/data/simops';
import { addDays, fmtLong } from '@/lib/dates';
import { simopsHref } from '@/lib/rules/simops';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';

// Opérations simultanées (SIMOPS, PRV-22) : vue en lecture de l'écran Prévention, par zone de la carte et par heure.
// Composant serveur (aucune saisie) : navigation par jour, liste accessible (pas de frise seulement visuelle).

const muted = { fontSize: 12, color: 'var(--vg-text-muted)' } as const;

export async function SimopsView({ data, today }: { data: SimopsData; today: string }) {
  const { t } = await getI18n();
  const { day, zones } = data;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card" style={{ gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 15, margin: 0, flex: 1, minWidth: 200 }}>{fill(t('Simultaneous operations on {day}'), { day: fmtLong(day) })}</h2>
          <nav aria-label={t('Day shown')} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Link href={simopsHref(addDays(day, -1))} scroll={false} className="btn btn-ghost vg-btn-sm"><Icon name="ph-caret-left" size={13} />{t('Previous day')}</Link>
            {day !== today && <Link href={simopsHref()} scroll={false} className="btn btn-ghost vg-btn-sm">{t('Today')}</Link>}
            <Link href={simopsHref(addDays(day, 1))} scroll={false} className="btn btn-ghost vg-btn-sm">{t('Next day')}<Icon name="ph-caret-right" size={13} /></Link>
          </nav>
          <form method="get" action="/prevention" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="hidden" name="vue" value="simops" />
            <label htmlFor="simops-jour" style={muted}>{t('Day')}</label>
            <input id="simops-jour" className="input" type="date" name="jour" defaultValue={day} style={{ fontSize: 12.5, padding: '4px 8px' }} />
            <button type="submit" className="btn btn-secondary vg-btn-sm">{t('Show')}</button>
          </form>
        </div>
        <p style={{ ...muted, margin: 0, textWrap: 'pretty' }}>
          {t('Permits valid that day (with their lockouts) and map activities, by zone; a permit takes the zone of its linked activities.')}
          {' '}{t('The hours flagged are those where at least two operations overlap in the same zone.')}{' '}
          {fill(data.operations > 1 ? t('{n} operations') : t('{n} operation'), { n: data.operations })} · {fill(data.simultaneousZones > 1 ? t('{n} zones simultaneous') : t('{n} zone simultaneous'), { n: data.simultaneousZones })}.
        </p>
      </div>
      {zones.length === 0 && <div className="card"><span style={muted}>{t('No operation that day on the selected site.')}</span></div>}
      {zones.map((z) => (
        <section key={z.key} className="card" style={{ gap: 8, ...(z.overlaps ? { border: '1px solid var(--tone-warn-dot)' } : {}) }} aria-labelledby={`simops-${z.key}`}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <h3 id={`simops-${z.key}`} style={{ fontSize: 13.5, margin: 0 }}>{z.label}</h3>
            {z.overlaps ? <ToneTag tone="warn">{fill(t('Simultaneous: {hours}'), { hours: z.overlaps })}</ToneTag> : z.zoneId == null ? <span style={muted}>{t('location not linked to a zone')}</span> : <span style={muted}>{t('no overlap')}</span>}
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {z.ops.map((o) => (
              <li key={o.key} style={{ display: 'grid', gap: 3, fontSize: 12.5 }}>
                <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 120 }}>{o.slotLabel}</span>
                  <Link href={o.href} className="vg-link" style={{ fontSize: 12.5 }}>{o.ref}</Link>
                  <span style={{ flex: 1, minWidth: 180 }}>{o.label}</span>
                  {o.stateLabel && <span className="tag tag-neutral">{o.stateLabel}</span>}
                </span>
                {o.detail && <span style={muted}>{o.detail}</span>}
                {o.lockouts.length > 0 && (
                  <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={muted}>{t('Lockouts:')}</span>
                    {o.lockouts.map((l) => <ToneTag key={l.id} tone={l.tone}>{l.id} · {l.label} · {l.statusLabel}</ToneTag>)}
                  </span>
                )}
                {o.with.length > 0 && <span style={{ fontSize: 12, color: 'var(--tone-warn-fg)' }}>{fill(t('At the same time as {list}'), { list: o.with.join(', ') })}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
