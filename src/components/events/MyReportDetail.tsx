import Link from 'next/link';
import type { ReactNode } from 'react';
import { ToneTag } from '@/components/ui';
import type { MyReportDetail as Report } from '@/lib/data/events';
import { fmtDate } from '@/lib/dates';
import { EVENT_DISMISSED, EVENT_STEPS, STEP_CLOSED, TONE } from '@/lib/domain';

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <div style={{ display: 'grid', gap: 6 }}>
    <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-neutral-500)' }}>{title}</span>
    {children}
  </div>
);
const text = { margin: 0, fontSize: 13.5, lineHeight: 1.45, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' } as const;

/**
 * Détail d'un signalement pour son déclarant (parcours terrain, mobile, lecture seule) : avancement daté,
 * description, mesures immédiates et suite donnée (actions et avancement). L'analyse des causes n'est pas montrée.
 */
export function MyReportDetail({ report: r, backHref, topPadding = 62 }: { report: Report; backHref: string; topPadding?: number }) {
  const closed = r.step >= STEP_CLOSED;
  const tone = TONE[r.typeTone];
  const shell = { minHeight: '100%', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'var(--font-body)', padding: `${topPadding}px 18px 40px`, display: 'grid', gap: 18, alignContent: 'start', fontSize: 14 } as const;

  return (
    <div style={shell}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Link href={backHref} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 32, fontSize: 13.5, color: 'var(--color-accent)', textDecoration: 'none' }}>
          <i className="ph ph-caret-left" style={{ fontSize: 15 }} aria-hidden />Mes signalements
        </Link>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-neutral-500)' }}><i className="ph ph-factory" aria-hidden />{r.siteLabel}</span>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-neutral-500)' }}>
          <span>{r.id}</span><span>·</span><span>{fmtDate(r.occurredOn)}</span>
          <span className="tag" style={{ marginLeft: 'auto', background: tone.bg, color: tone.fg, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <i className={`ph ${r.typeIcon}`} style={{ fontSize: 12 }} aria-hidden />{r.typeLabel}
          </span>
        </div>
        <span style={{ fontSize: 19, fontWeight: 500, lineHeight: 1.3, letterSpacing: '-.01em', textWrap: 'pretty' }}>{r.title}</span>
        <span style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>{r.location}</span>
      </div>

      {r.dismissed && (
        <div className="vg-inset" style={{ display: 'grid', gap: 4, padding: 12, fontSize: 13 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <i className="ph ph-archive" style={{ fontSize: 15, color: 'var(--color-neutral-400)' }} aria-hidden />{EVENT_DISMISSED} le {fmtDate(r.dismissed.on)}
          </span>
          {r.dismissed.reason && <span style={{ color: 'var(--color-neutral-400)', fontStyle: 'italic', textWrap: 'pretty' }}>{r.dismissed.reason}</span>}
        </div>
      )}

      <Section title="Avancement">
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
          {EVENT_STEPS.map((label, i) => {
            const passed = i < r.step || (closed && i === r.step), cur = i === r.step && !closed && !r.dismissed;
            const color = r.dismissed ? 'var(--color-neutral-500)' : passed ? 'var(--color-neutral-300)' : cur ? 'var(--color-accent)' : 'var(--vg-text-muted)';
            const date = r.stepDates[i];
            return (
              <li key={label} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr) auto', gap: 10, alignItems: 'start', paddingBottom: i < EVENT_STEPS.length - 1 ? 10 : 0, position: 'relative' }}>
                {i < EVENT_STEPS.length - 1 && <span aria-hidden style={{ position: 'absolute', left: 8, top: 18, bottom: 0, width: 1, background: i < r.step ? 'var(--color-accent-600)' : 'var(--color-neutral-800)' }} />}
                <i className={`ph ${passed ? 'ph-check-circle' : cur ? 'ph-circle-half' : 'ph-circle'}`} style={{ fontSize: 17, color, background: 'var(--color-bg)', position: 'relative' }} aria-hidden />
                <span style={{ fontSize: 13.5, color }}>{label}</span>
                <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{date && i <= r.step ? fmtDate(date) : ''}</span>
              </li>
            );
          })}
        </ol>
      </Section>

      <Section title="Description"><p style={text}>{r.description || '—'}</p></Section>
      <Section title="Mesures immédiates"><p style={text}>{r.immediateMeasures || '—'}</p></Section>

      <Section title="Suite donnée">
        {r.actions.length === 0 ? (
          <p style={{ ...text, color: 'var(--color-neutral-500)' }}>Aucune action décidée pour l&apos;instant.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {r.actions.map((a) => (
              <div key={a.id} style={{ display: 'grid', gap: 6, padding: 10, background: 'var(--color-surface)', border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)' }}>
                <span style={{ fontSize: 13.5, lineHeight: 1.35, textWrap: 'pretty' }}>{a.label}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
                  {a.id}<ToneTag tone={a.tone} style={{ marginLeft: 'auto' }}>{a.avancement}</ToneTag>
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {r.photoCount > 0 && (
        <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--color-neutral-500)' }}>
          <i className="ph ph-camera" style={{ fontSize: 15 }} aria-hidden />
          {r.photoCount} photo{r.photoCount > 1 ? 's' : ''} jointe{r.photoCount > 1 ? 's' : ''} au signalement, transmise{r.photoCount > 1 ? 's' : ''} à l&apos;animateur QHSE.
        </p>
      )}
    </div>
  );
}
