import Link from 'next/link';
import type { ReactNode } from 'react';
import { SkillDot } from '@/components/skills/common';
import { ToneTag } from '@/components/ui';
import type { MySpace } from '@/lib/data/my-space';
import { fmtDate } from '@/lib/dates';
import { SKILL_STATES } from '@/lib/domain';
import type { ForecastItem } from '@/lib/rules/skills';

const card = { display: 'grid', gap: 8, padding: 12, background: 'var(--color-surface)', border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)', color: 'inherit', textDecoration: 'none' } as const;
const muted = { fontSize: 12, color: 'var(--color-neutral-500)' } as const;

function Section({ id, title, count, icon, more, children }: { id: string; title: string; count?: string; icon: string; more?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <i className={`ph ${icon}`} style={{ fontSize: 17, color: 'var(--color-accent)' }} aria-hidden />
        <h2 id={id} style={{ margin: 0, fontSize: 16, fontWeight: 500, flex: 1 }}>{title}{count && <span style={{ ...muted, fontSize: 13 }}> · {count}</span>}</h2>
        {more}
      </div>
      {children}
    </section>
  );
}

/** Recyclage ou formation à prévoir (prévision HAB-09 de la seule ligne de la personne). */
function renewalText(r: ForecastItem) {
  if (r.state === 'r' || !r.expiresOn) return 'formation à suivre';
  if (r.state === 'p') return 'prérequis à régulariser';
  if (r.state === 'x') return `expiré depuis le ${fmtDate(r.expiresOn)}`;
  return `recyclage avant le ${fmtDate(r.expiresOn)}`;
}

const Empty = ({ children }: { children: ReactNode }) => (
  <div style={{ ...muted, fontSize: 12.5, padding: '14px 12px', border: '1px dashed var(--color-divider)', borderRadius: 'var(--radius-md)', textWrap: 'pretty' }}>{children}</div>
);

/**
 * Espace salarié mobile (EVT-22) : mes actions (consultation, fil et preuves dans la fiche), mes habilitations (ma ligne
 * de la matrice, recyclages à prévoir) et mes signalements. Les seules données de la personne connectée (loadMySpace).
 */
export function MySpaceView({ space, reportHref, myReportsHref }: { space: MySpace; reportHref: string; myReportsHref: string }) {
  const { actions, skills, renewals, reports } = space;
  const late = actions.filter((a) => a.late).length;
  return (
    <div style={{ padding: '14px 18px 40px', display: 'grid', gap: 22, fontFamily: 'var(--font-body)', fontSize: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Link href="/" className="vg-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 44, fontSize: 12.5 }}>
          <i className="ph ph-caret-left" aria-hidden />Retour à Vigie
        </Link>
        <Link href={reportHref} className="btn btn-primary" style={{ minHeight: 44 }}>
          <i className="ph ph-warning" style={{ fontSize: 16 }} aria-hidden />Signaler
        </Link>
      </div>
      <div style={{ display: 'grid', gap: 4 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 500, letterSpacing: '-.015em' }}>Mon espace</h1>
        <span style={muted}>{space.name} · mes actions, mes habilitations et mes signalements</span>
      </div>

      <Section id="mes-actions" title="Mes actions" icon="ph-list-checks"
        count={actions.length ? `${actions.length} en cours${late ? ` · ${late} en retard` : ''}` : undefined}>
        {actions.length === 0 ? (
          <Empty>Aucune action en cours dont vous êtes responsable.</Empty>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {actions.map((a) => (
              <li key={a.id}>
                <Link href={a.href} style={card}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, ...muted }}>
                    <span>{a.id}</span><span>·</span><span>échéance {fmtDate(a.dueOn)}</span>
                    <ToneTag tone={a.tone} style={{ marginLeft: 'auto' }}>{a.statusLabel}</ToneTag>
                  </span>
                  <span style={{ fontSize: 14, lineHeight: 1.35, textWrap: 'pretty' }}>{a.label}</span>
                  <span style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    Commenter, joindre une preuve<i className="ph ph-caret-right" style={{ marginLeft: 'auto' }} aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="mes-habilitations" title="Mes habilitations" icon="ph-identification-badge"
        count={skills ? `${skills.length} titre${skills.length > 1 ? 's' : ''}` : undefined}
        more={skills && <Link href="/habilitations" className="vg-link" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>Détail</Link>}>
        {!skills ? (
          <Empty>Vous n&apos;êtes pas suivi dans la matrice des habilitations.</Empty>
        ) : (
          <>
            {renewals.length > 0 && (
              <div className="card" style={{ gap: 6, padding: 12 }} role="note" aria-label="Recyclages à prévoir">
                <span style={{ fontSize: 13, color: 'var(--tone-warn-fg)' }}>À prévoir avec votre responsable</span>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4, fontSize: 13 }}>
                  {renewals.map((r) => (
                    <li key={r.titleId}>
                      {r.title} : {renewalText(r)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {skills.length === 0 ? <Empty>Aucun titre requis ni détenu.</Empty> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                {skills.map((s) => (
                  <li key={s.titleId} style={{ ...card, gridTemplateColumns: 'auto minmax(0, 1fr)', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
                    <SkillDot state={s.state} />
                    <span style={{ display: 'grid', gap: 2 }}>
                      <span style={{ fontSize: 14 }}>{s.title}</span>
                      <span style={muted}>
                        {SKILL_STATES[s.state].label}{s.expiresOn ? ` · échéance ${fmtDate(s.expiresOn)}` : s.state === 'r' ? '' : ' · sans échéance'}{!s.required ? ' · non requis' : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Section>

      <Section id="mes-signalements" title="Mes signalements" icon="ph-warning"
        count={reports.total ? `${reports.total} · ${reports.open} en cours` : undefined}>
        <Link href={myReportsHref} style={{ ...card, gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center' }}>
          <span style={{ fontSize: 14 }}>{reports.total ? 'Suivre mes signalements' : 'Aucun signalement nominatif'}</span>
          <i className="ph ph-caret-right" aria-hidden />
        </Link>
      </Section>
    </div>
  );
}
