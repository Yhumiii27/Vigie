import type { ReactNode } from 'react';
import { ToneTag } from '@/components/ui';
import { fmtDate, monthName, monthOf, yearOf } from '@/lib/dates';
import { REVIEW_FOLLOW_UP, TONE, canOpen, type Role } from '@/lib/domain';
import type { DossierFinding, FollowUpRow } from '@/lib/data/review';
import type { ActionBrief } from '@/lib/queries';

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
export function RecordText({ text, held, placeholder }: { text: string | null | undefined; held: boolean; placeholder: string }) {
  if (text) return <p className="rd-text">{text}</p>;
  if (held) return <Empty>Non renseigné au compte rendu.</Empty>;
  return <><p className="rd-empty rd-muted">[À compléter : {placeholder}]</p><Blank /></>;
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

export function ActionStatus({ a, plain }: { a: Pick<ActionBrief, 'status' | 'tone' | 'pilot' | 'dueOn'>; plain?: boolean }) {
  if (plain) return <span style={{ color: a.tone === 'neutral' ? undefined : TONE[a.tone].dot }}>{a.status}</span>;
  return (
    <span style={{ display: 'grid', gap: 2 }}>
      <ToneTag tone={a.tone} style={{ whiteSpace: 'nowrap', justifySelf: 'start' }}>{a.status}</ToneTag>
      <span className="rd-muted" style={{ fontSize: 11 }}>{a.pilot} · date cible {fmtDate(a.dueOn)}</span>
    </span>
  );
}

type LinkedBrief = ActionBrief & { href?: string };

/** Actions liées, une par ligne : numéro (lien) · avancement. */
export function ActionRefs({ actions, role }: { actions: LinkedBrief[] | undefined; role: Role }) {
  if (!actions?.length) return <>—</>;
  return <>{actions.map((a) => <div key={a.id} style={{ whiteSpace: 'nowrap' }}><Ref href={a.href} role={role}>{a.id}</Ref> · <ActionStatus a={a} plain /></div>)}</>;
}

export function ActionTable({ rows, role, review, extra }: {
  rows: (LinkedBrief & { originRef?: string; review?: string })[]; role: Role; review?: boolean; extra?: (a: LinkedBrief & { originRef?: string }) => ReactNode;
}) {
  return (
    <table className="table rd-table">
      <thead><tr><th>N°</th><th>Action</th>{review && <th>Revue</th>}<th>Responsable</th><th>Date cible</th><th>Avancement</th></tr></thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.id}>
            <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}><Ref href={a.href} role={role}>{a.id}</Ref></td>
            <td>
              {a.title}
              {extra && <div className="rd-muted" style={{ fontSize: 11 }}>{extra(a)}</div>}
              {a.efficacyNote && <div className="rd-muted" style={{ fontSize: 11 }}>Efficacité : {a.efficacyNote}</div>}
            </td>
            {review && <td className="rd-muted" style={{ whiteSpace: 'nowrap' }}>{a.review ?? '—'}</td>}
            <td style={{ whiteSpace: 'nowrap' }}>{a.pilot}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.dueOn)}{a.closedOn && <div className="rd-muted" style={{ fontSize: 11 }}>vérifiée le {fmtDate(a.closedOn)}</div>}</td>
            <td><ToneTag tone={a.tone} style={{ whiteSpace: 'nowrap' }}>{a.status}</ToneTag></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Suivi des décisions et actions des revues précédentes (§9.3.2 a, AUD-05) : suite donnée à chaque décision, objectif ou
 * besoin en ressources (action et avancement, « Sans action au plan », action abandonnée avec son motif).
 */
export function FollowUpTable({ rows, role }: { rows: FollowUpRow[]; role: Role }) {
  return (
    <table className="table rd-table">
      <thead><tr><th>Revue</th><th>Nature</th><th style={{ width: '38%' }}>Décision ou action</th><th>Pilote</th><th>Échéance</th><th>Suite donnée</th></tr></thead>
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
                  <span>{x.actionId && <><Ref href={x.action?.href} role={role}>{x.actionId}</Ref> · </>}{REVIEW_FOLLOW_UP.cancelled.label}{x.cancelled?.on ? ` le ${fmtDate(x.cancelled.on)}` : ''}</span>
                  {x.cancelled?.reason && <span className="rd-muted" style={{ fontSize: 11 }}>Motif : {x.cancelled.reason}</span>}
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
  );
}

/** « 6 éléments · 2 ouverts · 1 sans action · 1 action abandonnée ». */
export function followUpAside(rows: FollowUpRow[]) {
  const open = rows.filter((x) => x.open).length;
  const none = rows.filter((x) => x.state === 'no_action').length;
  const cancelled = rows.filter((x) => x.state === 'cancelled').length;
  return `${plural(rows.length, 'élément', 'éléments')} · ${plural(open, 'ouvert', 'ouverts')} · ${none} sans action · ${plural(cancelled, 'action abandonnée', 'actions abandonnées')}`;
}

// ─── Mise en forme ──────────────────────────────────────────────────────────

export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** « D'octobre 2025 », « De juin 2026 » (élision devant avril, août, octobre). */
export const fromMonth = (iso: string) => {
  const m = monthName(monthOf(iso));
  return `${/^[aeiou]/.test(m) ? "D'" : 'De '}${m} ${yearOf(iso)}`;
};

export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

const NUM = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const INT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
export const fmtNum = (n: number | null | undefined, digits: 0 | 1 = 1) => (n == null ? '—' : (digits ? NUM : INT).format(n));
export const fmtPct = (share: number | null | undefined) => (share == null ? '—' : `${INT.format(share * 100)} %`);

/** Évaluations de conformité au singulier et au pluriel (« 1 écart », « 3 conformes »). */
const EVAL_COUNT: Record<string, [string, string]> = {
  conforme: ['conforme', 'conformes'],
  ecart: ['écart', 'écarts'],
  analyse: ["analyse d'écart en cours", "analyses d'écart en cours"],
  a_evaluer: ['à évaluer', 'à évaluer'],
};
export const evalCount = (key: string, label: string, n: number) => EVAL_COUNT[key]?.[n > 1 ? 1 : 0] ?? label.toLowerCase();
