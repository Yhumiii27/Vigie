import Link from 'next/link';
import type { MyReport } from '@/lib/data/events';
import { fmtDate } from '@/lib/dates';
import { ToneTag } from '@/components/ui';
import { EVENT_DISMISSED, EVENT_STEPS, STEP_CLOSED, TONE } from '@/lib/domain';

type Props = {
  reports: MyReport[];
  userName: string;
  siteLabel: string;
  /** Retour au formulaire de signalement. */
  backHref: string;
  /** Lien vers le détail d'un signalement. */
  detailHref: (id: string) => string;
  /** Site sélectionné : le site d'un signalement fait ailleurs est affiché sur sa carte. */
  currentSiteId?: string | null;
  topPadding?: number;
};

/** « Mes signalements » (parcours terrain, mobile) : suivi des signalements nominatifs de l'utilisateur, tous sites. */
export function MyReports({ reports, userName, siteLabel, backHref, detailHref, currentSiteId, topPadding = 62 }: Props) {
  const open = reports.filter((r) => r.step < STEP_CLOSED && !r.dismissed).length;
  const shell = { minHeight: '100%', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'var(--font-body)', padding: `${topPadding}px 18px 40px`, display: 'grid', gap: 16, alignContent: 'start', fontSize: 14 } as const;

  return (
    <div style={shell}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Link href={backHref} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 32, fontSize: 13.5, color: 'var(--color-accent)', textDecoration: 'none' }}>
          <i className="ph ph-caret-left" style={{ fontSize: 15 }} />Signaler
        </Link>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-neutral-500)' }}><i className="ph ph-factory" />{siteLabel}</span>
      </div>

      <div style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-.015em' }}>Mes signalements</span>
        <span style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>
          {userName} · {reports.length} signalement{reports.length > 1 ? 's' : ''}{reports.length > 0 && ` · ${open} en cours`}
        </span>
      </div>

      {reports.length === 0 ? (
        <div style={{ display: 'grid', gap: 6, justifyItems: 'center', textAlign: 'center', padding: '28px 12px', border: '1px dashed var(--color-divider)', borderRadius: 'var(--radius-md)' }}>
          <i className="ph ph-tray" style={{ fontSize: 26, color: 'var(--color-neutral-600)' }} />
          <span style={{ fontSize: 13.5 }}>Aucun signalement nominatif</span>
          <span style={{ fontSize: 12.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>Les signalements que vous envoyez sous votre nom apparaîtront ici avec leur avancement.</span>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {reports.map((r) => {
            const closed = r.step >= STEP_CLOSED;
            const tone = TONE[r.typeTone];
            const bar = (i: number) => r.dismissed ? 'var(--color-neutral-700)' : closed ? 'var(--tone-ok-dot)' : i < r.step ? 'var(--color-accent-600)' : i === r.step ? 'var(--color-accent)' : 'var(--color-neutral-800)';
            return (
              <Link key={r.id} href={detailHref(r.id)} style={{ display: 'grid', gap: 8, padding: 12, background: 'var(--color-surface)', border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)', color: 'inherit', textDecoration: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
                  <span>{r.id}</span><span>·</span><span>{fmtDate(r.occurredOn)}</span>
                  <span className="tag" style={{ marginLeft: 'auto', background: tone.bg, color: tone.fg, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <i className={`ph ${r.typeIcon}`} style={{ fontSize: 12 }} />{r.typeLabel}
                  </span>
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.35, textWrap: 'pretty' }}>{r.title}</div>
                <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
                  {r.location}{currentSiteId !== undefined && r.siteId !== currentSiteId && <> · {r.siteLabel}</>}
                  {r.photoCount > 0 && <> · <i className="ph ph-camera" aria-hidden /> {r.photoCount}</>}
                </div>
                <div role="progressbar" aria-label="Avancement" aria-valuemin={1} aria-valuemax={EVENT_STEPS.length} aria-valuenow={r.step + 1} aria-valuetext={r.dismissed ? EVENT_DISMISSED : EVENT_STEPS[r.step]}
                  style={{ display: 'grid', gridTemplateColumns: `repeat(${EVENT_STEPS.length}, 1fr)`, gap: 3 }}>
                  {EVENT_STEPS.map((s, i) => <span key={s} style={{ height: 4, borderRadius: 2, background: bar(i) }} />)}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  {r.dismissed ? (
                    <ToneTag tone="neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><i className="ph ph-archive" style={{ fontSize: 12 }} />{EVENT_DISMISSED}</ToneTag>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: closed ? 'var(--tone-ok-fg)' : 'var(--color-accent)' }}>
                      <i className={`ph ${closed ? 'ph-check-circle' : 'ph-circle-half'}`} style={{ fontSize: 13 }} />{EVENT_STEPS[r.step]}
                    </span>
                  )}
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--color-neutral-500)' }}>
                    {!r.dismissed && <>Étape {r.step + 1}/{EVENT_STEPS.length}</>}<i className="ph ph-caret-right" style={{ fontSize: 13 }} aria-hidden />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <p style={{ margin: 0, display: 'flex', gap: 8, fontSize: 12, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
        <i className="ph ph-eye-slash" style={{ fontSize: 15, flex: 'none', marginTop: 1 }} />
        <span>Les signalements anonymes n&apos;apparaissent pas dans cette liste : par conception, rien ne les relie à votre nom. Conservez leur référence pour en parler à l&apos;animateur QHSE.</span>
      </p>

      <Link href={backHref} className="btn btn-primary btn-block" style={{ minHeight: 48, fontSize: 15 }}>
        <i className="ph ph-plus" style={{ fontSize: 17 }} />Nouveau signalement
      </Link>
    </div>
  );
}
