import type { ReactNode } from 'react';
import { ToneTag } from '@/components/ui';
import { fmtDate, monthName, monthOf, yearOf } from '@/lib/dates';
import { REVIEW_FOLLOW_UP, TONE, canOpen, type Role } from '@/lib/domain';
import type { DossierFinding, FollowUpRow } from '@/lib/data/review';
import type { ActionBrief } from '@/lib/queries';
import { getI18n } from '@/i18n/server';
import { fill, type T } from '@/i18n/translate';

// Éléments de mise en page du dossier de revue de direction (classes rd-* de src/app/revue-de-direction/dossier.css).

/** Actions d'un constat du dossier, quel que soit son format (dossier figé avant AUD-28, migration 0016 : une seule action). */
export const dossierFindingActions = (f: DossierFinding) => f.actions ?? (f.actionId ? [{ id: f.actionId, action: f.action ?? null }] : []);

/** Numérotation des sections dans l'ordre d'affichage (une section absente ne consomme pas de numéro). */
export function sectionCounter() {
  let n = 0;
  return () => ++n;
}

export function Section({ n, title, aside, children }: { n: number; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rd-section">
      <div className="rd-section-head">
        <h2><span className="rd-num">{n}.</span>{title}</h2>
        {aside && <span className="rd-muted" style={{ fontSize: 11.5 }}>{aside}</span>}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rd-empty rd-muted">{children}</p>;
}

/** Lignes vierges à compléter en séance. */
export function Blank({ lines = 2 }: { lines?: number }) {
  return <>{Array.from({ length: lines }, (_, i) => <div key={i} className="rd-blank" />)}</>;
}

/** Texte saisi au compte rendu, sinon l'invite à compléter et des lignes vierges (revue pas encore tenue). */
export async function RecordText({ text, held, placeholder }: { text: string | null | undefined; held: boolean; placeholder: string }) {
  const { t } = await getI18n();
  if (text) return <p className="rd-text">{text}</p>;
  if (held) return <Empty>{t('Not entered in the minutes.')}</Empty>;
  return <><p className="rd-empty rd-muted">{fill(t('[To complete: {what}]'), { what: placeholder })}</p><Blank /></>;
}

export function Kpi({ label, value, note, tone }: { label: string; value: ReactNode; note?: string; tone?: 'danger' | 'warn' | 'ok' | 'neutral' | 'accent' }) {
  return (
    <div className="rd-kpi">
      <span className="rd-kpi-label">{label}</span>
      <span className="rd-kpi-value" style={{ color: tone && tone !== 'neutral' && tone !== 'ok' ? TONE[tone].fg : undefined }}>{value}</span>
      {note && <span className="rd-kpi-note">{note}</span>}
    </div>
  );
}

export function PyramidRow({ label, n, w, color }: { label: string; n: number; w: string; color: string }) {
  return (
    <>
      <span>{label}</span>
      <span style={{ display: 'block', background: 'color-mix(in srgb, var(--color-text) 6%, transparent)', borderRadius: 4 }}>
        <span className="rd-bar" style={{ display: 'block', width: n ? w : 0, background: color }} />
      </span>
      <span className="rd-num-cell" style={{ fontWeight: 500 }}>{n}</span>
    </>
  );
}

/**
 * Référence cliquable vers son écran, seulement si le rôle peut l'ouvrir. Lien HTML simple (navigation complète) :
 * la feuille globale dossier.css ne doit pas rester chargée dans l'application. Neutralisé à l'impression.
 */
export function Ref({ href, role, children }: { href: string | null | undefined; role: Role; children: ReactNode }) {
  return href && canOpen(role, href) ? <a href={href} className="rd-link">{children}</a> : <>{children}</>;
}

export async function ActionStatus({ a, plain }: { a: Pick<ActionBrief, 'status' | 'tone' | 'pilot' | 'dueOn'>; plain?: boolean }) {
  const { t } = await getI18n();
  if (plain) return <span style={{ color: a.tone === 'neutral' ? undefined : TONE[a.tone].dot }}>{a.status}</span>;
  return (
    <span style={{ display: 'grid', gap: 2 }}>
      <ToneTag tone={a.tone} style={{ whiteSpace: 'nowrap', justifySelf: 'start' }}>{a.status}</ToneTag>
      <span className="rd-muted" style={{ fontSize: 11 }}>{a.pilot} · {fill(t('target date {date}'), { date: fmtDate(a.dueOn) })}</span>
    </span>
  );
}

type LinkedBrief = ActionBrief & { href?: string };

/** Actions liées, une par ligne : numéro (lien) · avancement. */
/**
 * UX-15 : conteneur à défilement horizontal d'un tableau du dossier sur téléphone (sans effet à l'impression) ; focalisable
 * pour défiler au clavier.
 */
export async function ScrollTable({ children }: { children: ReactNode }) {
  const { t } = await getI18n();
  return <div className="rd-scroll" tabIndex={0} role="group" aria-label={t('Table, horizontal scrolling on a small screen')}>{children}</div>;
}

export function ActionRefs({ actions, role }: { actions: LinkedBrief[] | undefined; role: Role }) {
  if (!actions?.length) return <>—</>;
  return <>{actions.map((a) => <div key={a.id} style={{ whiteSpace: 'nowrap' }}><Ref href={a.href} role={role}>{a.id}</Ref> · <ActionStatus a={a} plain /></div>)}</>;
}

export async function ActionTable({ rows, role, review, extra }: {
  rows: (LinkedBrief & { originRef?: string; review?: string })[]; role: Role; review?: boolean; extra?: (a: LinkedBrief & { originRef?: string }) => ReactNode;
}) {
  const { t } = await getI18n();
  return (
    <ScrollTable>
      <table className="table rd-table">
        <thead><tr><th>{t('No.')}</th><th>{t('Action')}</th>{review && <th>{t('Review#management')}</th>}<th>{t('Owner')}</th><th>{t('Target date')}</th><th>{t('Progress')}</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}><Ref href={a.href} role={role}>{a.id}</Ref></td>
              <td>
                {a.title}
                {extra && <div className="rd-muted" style={{ fontSize: 11 }}>{extra(a)}</div>}
                {a.efficacyNote && <div className="rd-muted" style={{ fontSize: 11 }}>{t('Effectiveness: ')}{a.efficacyNote}</div>}
              </td>
              {review && <td className="rd-muted" style={{ whiteSpace: 'nowrap' }}>{a.review ?? '—'}</td>}
              <td style={{ whiteSpace: 'nowrap' }}>{a.pilot}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.dueOn)}{a.closedOn && <div className="rd-muted" style={{ fontSize: 11 }}>{fill(t('verified on {date}#f'), { date: fmtDate(a.closedOn) })}</div>}</td>
              <td><ToneTag tone={a.tone} style={{ whiteSpace: 'nowrap' }}>{a.status}</ToneTag></td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}

/**
 * Suivi des décisions et actions des revues précédentes (§9.3.2 a, AUD-05) : suite donnée à chaque décision, objectif ou
 * besoin en ressources (action et avancement, « Sans action au plan », action abandonnée avec son motif).
 */
export async function FollowUpTable({ rows, role }: { rows: FollowUpRow[]; role: Role }) {
  const { t } = await getI18n();
  return (
    <ScrollTable>
      <table className="table rd-table">
        <thead><tr><th>{t('Review#management')}</th><th>{t('Nature')}</th><th style={{ width: '38%' }}>{t('Decision or action')}</th><th>{t('Lead')}</th><th>{t('Deadline')}</th><th>{t('Follow-up given')}</th></tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.key}>
              <td className="rd-muted" style={{ whiteSpace: 'nowrap' }}>{x.review}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{x.kindLabel}</td>
              <td>{x.text}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{x.pilot}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{x.dueOn ? fmtDate(x.dueOn) : '—'}</td>
              <td>
                {x.state === 'no_action' && <span style={{ color: x.tone === 'neutral' ? undefined : TONE[x.tone].fg }}>{REVIEW_FOLLOW_UP.no_action.label}</span>}
                {x.state === 'cancelled' && (
                  <span style={{ display: 'grid', gap: 2 }}>
                    <span>{x.actionId && <><Ref href={x.action?.href} role={role}>{x.actionId}</Ref> · </>}{x.actionId ? REVIEW_FOLLOW_UP.cancelled.label : REVIEW_FOLLOW_UP.abandoned.label}{x.cancelled?.on ? fill(t(' on {date}'), { date: fmtDate(x.cancelled.on) }) : ''}</span>
                    {x.cancelled?.reason && <span className="rd-muted" style={{ fontSize: 11 }}>{t('Reason: ')}{x.cancelled.reason}</span>}
                  </span>
                )}
                {x.state === 'action' && (x.action
                  ? <span style={{ whiteSpace: 'nowrap' }}><Ref href={x.action.href} role={role}>{x.action.id}</Ref> · <ActionStatus a={x.action} plain /></span>
                  : <span className="rd-muted">{x.actionId}</span>)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}

/** « 6 éléments · 2 ouverts · 1 sans action · 1 action abandonnée ». */
export function followUpAside(rows: FollowUpRow[], t: T) {
  const open = rows.filter((x) => x.open).length;
  const none = rows.filter((x) => x.state === 'no_action').length;
  const cancelled = rows.filter((x) => x.state === 'cancelled').length;
  return [
    plural(rows.length, t('{n} item'), t('{n} items')), plural(open, t('{n} open'), t('{n} open#plural')),
    fill(t('{n} without action'), { n: none }), plural(cancelled, t('{n} action abandoned'), t('{n} actions abandoned')),
  ].join(' · ');
}

// ─── Mise en forme ──────────────────────────────────────────────────────────

export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** « D'octobre 2025 », « De juin 2026 » (élision devant avril, août, octobre). */
export const fromMonth = (iso: string, t: T) => {
  const m = monthName(monthOf(iso));
  return fill(/^[aeiou]/.test(m) ? t('From {month}#elided') : t('From {month}'), { month: `${m} ${yearOf(iso)}` });
};

/** « 3 éléments » : `one` et `many` sont des chaînes traduites portant {n}. */
export const plural = (n: number, one: string, many: string) => fill(n > 1 ? many : one, { n });

const NUM = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const INT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
export const fmtNum = (n: number | null | undefined, digits: 0 | 1 = 1) => (n == null ? '—' : (digits ? NUM : INT).format(n));
export const fmtPct = (share: number | null | undefined) => (share == null ? '—' : `${INT.format(share * 100)} %`);

/** Évaluations de conformité au singulier et au pluriel (« 1 écart », « 3 conformes »). */
const EVAL_COUNT: Record<string, [string, string]> = {
  conforme: ['compliant', 'compliant#plural'],
  ecart: ['gap', 'gaps'],
  analyse: ['gap analysis in progress', 'gap analyses in progress'],
  a_evaluer: ['to evaluate#lower', 'to evaluate#lower'],
};
export const evalCount = (key: string, label: string, n: number, t: T) => {
  const words = EVAL_COUNT[key];
  return words ? t(words[n > 1 ? 1 : 0]) : label.toLowerCase();
};
