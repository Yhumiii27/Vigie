import Link from 'next/link';
import { Icon, ToneTag } from '@/components/ui';
import type { SimopsData } from '@/lib/data/simops';
import { addDays, fmtLong } from '@/lib/dates';
import { simopsHref } from '@/lib/rules/simops';

// Opérations simultanées (SIMOPS, PRV-22) : vue en lecture de l'écran Prévention, par zone de la carte et par heure.
// Composant serveur (aucune saisie) : navigation par jour, liste accessible (pas de frise seulement visuelle).

const muted = { fontSize: 12, color: 'var(--vg-text-muted)' } as const;

export function SimopsView({ data, today }: { data: SimopsData; today: string }) {
  const { day, zones } = data;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card" style={{ gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 15, margin: 0, flex: 1, minWidth: 200 }}>Opérations simultanées du {fmtLong(day)}</h2>
          <nav aria-label="Jour affiché" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Link href={simopsHref(addDays(day, -1))} scroll={false} className="btn btn-ghost vg-btn-sm"><Icon name="ph-caret-left" size={13} />Veille</Link>
            {day !== today && <Link href={simopsHref()} scroll={false} className="btn btn-ghost vg-btn-sm">Aujourd&apos;hui</Link>}
            <Link href={simopsHref(addDays(day, 1))} scroll={false} className="btn btn-ghost vg-btn-sm">Lendemain<Icon name="ph-caret-right" size={13} /></Link>
          </nav>
          <form method="get" action="/prevention" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="hidden" name="vue" value="simops" />
            <label htmlFor="simops-jour" style={muted}>Jour</label>
            <input id="simops-jour" className="input" type="date" name="jour" defaultValue={day} style={{ fontSize: 12.5, padding: '4px 8px' }} />
            <button type="submit" className="btn btn-secondary vg-btn-sm">Afficher</button>
          </form>
        </div>
        <p style={{ ...muted, margin: 0, textWrap: 'pretty' }}>
          Permis valables ce jour-là (avec leurs consignations) et activités de la carte, par zone ; un permis prend la zone de ses activités rattachées.
          Les heures signalées sont celles où au moins deux opérations se recouvrent dans la même zone. {data.operations} opération{data.operations > 1 ? 's' : ''} · {data.simultaneousZones} zone{data.simultaneousZones > 1 ? 's' : ''} en simultané.
        </p>
      </div>
      {zones.length === 0 && <div className="card"><span style={muted}>Aucune opération ce jour-là sur le site sélectionné.</span></div>}
      {zones.map((z) => (
        <section key={z.key} className="card" style={{ gap: 8, ...(z.overlaps ? { border: '1px solid var(--tone-warn-dot)' } : {}) }} aria-labelledby={`simops-${z.key}`}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <h3 id={`simops-${z.key}`} style={{ fontSize: 13.5, margin: 0 }}>{z.label}</h3>
            {z.overlaps ? <ToneTag tone="warn">Simultanées : {z.overlaps}</ToneTag> : z.zoneId == null ? <span style={muted}>lieu non rattaché à une zone</span> : <span style={muted}>pas de recouvrement</span>}
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
                    <span style={muted}>Consignations :</span>
                    {o.lockouts.map((l) => <ToneTag key={l.id} tone={l.tone}>{l.id} · {l.label} · {l.statusLabel}</ToneTag>)}
                  </span>
                )}
                {o.with.length > 0 && <span style={{ fontSize: 12, color: 'var(--tone-warn-fg)' }}>En même temps que {o.with.join(', ')}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
