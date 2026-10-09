'use client';

import { useState, useTransition, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { TONE, type Tone } from '@/lib/domain';
import type { FormOptions, Option } from '@/lib/data/options';
import type { PlanChoice, SiteRuleView } from '@/lib/data/prevention';

// Éléments partagés par les fenêtres de l'écran « Plans de prévention et permis ».

/** Listes de choix des formulaires du domaine (préparées par la page serveur). */
export type PreventionOptions = Pick<FormOptions, 'people' | 'sites' | 'projects' | 'origins'> & {
  contractors: Option[];
  /** Plans du site sélectionné, pour le rattachement d'un permis (filtrés par site, entreprise et dates). */
  plans: PlanChoice[];
  /** Règle de prévention des sites proposés (classement Seveso, plan « dès la première minute »). */
  siteRules: SiteRuleView[];
  /** Site proposé pour un nouvel enregistrement (site sélectionné, ou premier site). */
  defaultSiteId: string;
  /** Sites proposés pour un plan ou un permis : le seul site sélectionné, ou tous les sites. */
  recordSites: Option[];
  /** Un site est sélectionné dans la barre latérale (choix du site figé dans les formulaires). */
  siteLocked: boolean;
  /** Date du jour Vigie « AAAA-MM-JJ ». */
  today: string;
};

export const muted = { fontSize: 11, color: 'var(--color-neutral-500)' } as const;

/** Règle de prévention d'un site parmi les options du formulaire. */
export const ruleOf = (options: Pick<PreventionOptions, 'siteRules'>, siteId: string) => options.siteRules.find((r) => r.id === siteId);

/** Aide du champ Site quand un site est sélectionné (l'enregistrement reste visible à l'écran). */
export const SITE_LOCK_HINT = 'Site sélectionné dans la barre latérale ; choisissez « Tous les sites » pour saisir sur un autre site.';

/** Ligne de tableau qui ouvre une fenêtre (clic ou Entrée), sauf clic sur un lien ou un bouton. */
export function rowOpener(open: () => void) {
  return {
    className: 'is-clickable',
    tabIndex: 0,
    onClick: (e: MouseEvent<HTMLTableRowElement>) => { if (!(e.target as HTMLElement).closest('a, button')) open(); },
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); open(); } },
  };
}

/** Retire un paramètre de l'URL courante sans recharger la page (fenêtre ouverte par lien direct). */
export function dropUrlParam(replace: (href: string, opts: { scroll: boolean }) => void, key: string) {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(key)) return;
  url.searchParams.delete(key);
  replace(`${url.pathname}${url.search}`, { scroll: false });
}

/** Bandeau de faits clés (libellé en petites capitales, valeur). */
export function Facts({ items }: { items: (readonly [string, ReactNode] | false | null | undefined)[] }) {
  return (
    <div className="vg-inset" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '10px 18px', padding: '10px 12px' }}>
      {items.filter((i): i is readonly [string, ReactNode] => !!i).map(([k, v]) => (
        <div key={k} style={{ display: 'grid', gap: 2, minWidth: 0, alignContent: 'start' }}>
          <span style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>{k}</span>
          <span style={{ fontSize: 12.5, textWrap: 'pretty' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/** Titre de section dans une fenêtre. */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
      <h6 className="vg-h6" style={{ letterSpacing: '.08em', textTransform: 'uppercase', fontSize: 10 }}>{children}</h6>
      {aside}
    </div>
  );
}

/** Message encadré (alerte, information) dans une fenêtre. */
export function Notice({ tone, icon = 'ph-warning', children }: { tone: Tone; icon?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 'var(--radius-md)', fontSize: 12, border: `1px solid color-mix(in srgb, ${TONE[tone].dot} 55%, transparent)`, color: TONE[tone].fg, textWrap: 'pretty' }}>
      <i className={`ph ${icon}`} style={{ fontSize: 15, color: TONE[tone].dot, flex: 'none', marginTop: 1 }} aria-hidden />
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** Exécute une server action sans formulaire et conserve son message d'erreur. */
export function useRun() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ error?: string }>, onOk?: () => void) => start(async () => {
    const r = await fn();
    setError(r.error ?? null);
    if (!r.error) onOk?.();
  });
  return { pending, error, run, clear: () => setError(null) };
}

/** Bouton d'action irréversible : un premier clic demande confirmation. */
export function ConfirmButton({ label, confirmLabel, question, icon, onConfirm, disabled, tooltip, pending, className = 'btn btn-secondary vg-btn-sm' }: {
  label: string; confirmLabel: string; question: string; icon?: string; onConfirm: () => void; disabled?: boolean; tooltip?: string; pending?: boolean; className?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--color-neutral-300)' }}>{question}</span>
        <button type="button" className="btn btn-ghost vg-btn-sm" onClick={() => setAsking(false)}>Non</button>
        <button type="button" className="btn btn-primary vg-btn-sm" disabled={pending} onClick={() => { setAsking(false); onConfirm(); }}>{confirmLabel}</button>
      </span>
    );
  }
  return (
    <button type="button" className={className} disabled={disabled || pending} title={tooltip} onClick={() => setAsking(true)}>
      {icon && <i className={`ph ${icon}`} style={{ fontSize: 13 }} aria-hidden />}{label}
    </button>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? <div role="alert" className="vg-form-error">{error}</div> : null;
}

/** Pastille de signature (EU / EE) dans les tableaux. */
export function SignChip({ label, on, title }: { label: string; on: boolean; title: string }) {
  return (
    <span title={title} aria-label={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, padding: '1px 6px', borderRadius: 5,
      background: on ? TONE.ok.bg : 'transparent', color: on ? TONE.ok.fg : 'var(--color-neutral-500)', border: on ? '1px solid transparent' : '1px dashed var(--color-neutral-700)',
    }}>
      <i className={`ph ${on ? 'ph-check' : 'ph-minus'}`} style={{ fontSize: 10 }} aria-hidden />{label}
    </span>
  );
}
