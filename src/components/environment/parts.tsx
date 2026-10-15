'use client';

import Link from 'next/link';
import { useState, useTransition, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { NewActionButton, type ActionDefaults } from '@/components/ActionFormDialog';
import { actionHref } from '@/lib/action-rules';
import type { ActionFormOptions } from '@/lib/action-view';
import { Field, Input } from '@/components/form';
import { Dot } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import type { EnvAction } from '@/lib/data/environment';
import { fmtSiret, isEuVatNumber, isSiret, normalizeSiret } from '@/lib/siret';

/** Listes du formulaire d'action : fournies au service QHSE seulement, seul à créer une action (ACT-22). */
export type ActionOptions = ActionFormOptions;

/** Ligne de tableau qui ouvre une fenêtre (clic ou Entrée), sauf clic sur un lien ou un bouton de la ligne. */
export function rowOpener(open: () => void) {
  return {
    className: 'is-clickable',
    tabIndex: 0,
    onClick: (e: MouseEvent<HTMLTableRowElement>) => { if (!(e.target as HTMLElement).closest('a, button')) open(); },
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); open(); } },
  };
}

/** Encadré d'information sous un champ (icône + texte). */
export function Note({ icon, tone, children }: { icon: string; tone?: 'warn' | 'danger' | 'ok'; children: ReactNode }) {
  return (
    <div className="vg-inset" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', fontSize: 12, color: 'var(--color-neutral-300)' }}>
      <i className={`ph ${icon}`} aria-hidden style={{ fontSize: 15, flex: 'none', marginTop: 1, color: tone ? TONE[tone].dot : 'var(--color-accent)' }} />
      <span style={{ textWrap: 'pretty', minWidth: 0 }}>{children}</span>
    </div>
  );
}

/** Suppression en deux temps sous le formulaire d'une fenêtre ; appelle `onDone` une fois l'élément supprimé. */
export function DeleteZone({ run, onDone, label, question }: { run: () => Promise<{ error?: string }>; onDone: () => void; label: string; question: ReactNode }) {
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingTop: 10, marginTop: 2, background: 'var(--rule-soft) no-repeat top / 100% 1px' }}>
      {!asking ? (
        <button type="button" className="btn btn-ghost vg-btn-sm" style={{ color: 'var(--tone-danger-fg)' }} onClick={() => setAsking(true)}>
          <i className="ph ph-trash" style={{ fontSize: 13 }} />{label}
        </button>
      ) : (
        <>
          <span style={{ fontSize: 12, color: 'var(--color-neutral-300)', flex: '1 1 220px', textWrap: 'pretty' }}>{question}</span>
          <span style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button type="button" className="btn btn-secondary vg-btn-sm" disabled={pending} onClick={() => { setAsking(false); setError(null); }}>Annuler</button>
            <button type="button" className="btn btn-secondary vg-btn-sm" disabled={pending} style={{ color: 'var(--tone-danger-fg)', borderColor: TONE.danger.dot }}
              onClick={() => start(async () => {
                const r = await run();
                if (r.error) setError(r.error);
                else onDone();
              })}>
              <i className="ph ph-trash" style={{ fontSize: 13 }} />{pending ? 'Suppression…' : 'Confirmer la suppression'}
            </button>
          </span>
        </>
      )}
      {error && <span role="alert" style={{ flexBasis: '100%', fontSize: 11.5, color: 'var(--tone-danger-fg)' }}>{error}</span>}
    </div>
  );
}

/** Suggestions de saisie (collecteurs, exutoires…) pour un champ texte. */
export function Suggestions({ id, values }: { id: string; values: string[] }) {
  return <datalist id={id}>{values.map((v) => <option key={v} value={v} />)}</datalist>;
}

/** Libellé court d'un site : « Site de [Ville A] ». */
export const shortSite = (label: string) => label.split(' — ')[0];

export const muted = { fontSize: 11, color: 'var(--color-neutral-500)' } as const;

/**
 * Actions du plan rattachées (filière, enlèvement) et, pour le service QHSE (`options` fourni), création d'une nouvelle
 * action pré-remplie (source « Déchets », élément lié : voir action-defaults.ts).
 */
export function LinkedActions({ actions, options, defaults, canAct, empty = 'Aucune action rattachée.' }: {
  actions: EnvAction[]; options: ActionOptions | null; defaults: ActionDefaults; canAct: boolean; empty?: string;
}) {
  return (
    <section style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <h6 className="vg-h6">Actions liées</h6>
        {canAct && options && (
          <NewActionButton options={options} label="Nouvelle action" className="vg-text-btn" icon="ph-plus"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} defaults={defaults} />
        )}
      </div>
      {actions.length === 0 ? (
        <span style={muted}>{empty}</span>
      ) : actions.map((a) => (
        <Link key={a.id} href={actionHref(a.id)} className="vg-link"
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, minWidth: 0 }} title={`${a.statusLabel} · ${a.pilot} · date cible ${fmtDate(a.dueOn)}`}>
          <Dot color={TONE[a.tone].dot} size={6} />
          <span style={{ whiteSpace: 'nowrap' }}>{a.id}</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-neutral-300)' }}>{a.label}</span>
          <span style={{ ...muted, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{a.statusLabel.toLowerCase()}</span>
        </Link>
      ))}
    </section>
  );
}

/** Identité d'un transporteur ou d'un collecteur connu (mentions du registre), proposée à la saisie de son nom. */
export type Carrier = { siret: string | null; address: string | null; receipt: string | null };
/** Identité d'une installation de destination connue. */
export type Installation = { siret: string | null; address: string | null };

/** Consigne d'un champ SIRET : valeur reconnue mise en forme, ou format attendu (contrôle définitif par le serveur). */
function companyIdHint(raw: string, foreign: boolean, empty: ReactNode): ReactNode {
  const v = normalizeSiret(raw);
  if (!v) return empty;
  if (isSiret(v)) return `SIRET ${fmtSiret(v)}`;
  if (foreign && isEuVatNumber(v)) return `N° de TVA intracommunautaire ${v}`;
  return (
    <span style={{ color: TONE.warn.fg }}>
      {foreign ? 'SIRET de 14 chiffres (clé de contrôle) ou n° de TVA intracommunautaire étranger attendu.' : 'SIRET invalide : 14 chiffres, clé de contrôle incorrecte.'}
    </span>
  );
}

/** Champ SIRET (registre des déchets) ; `foreign` : n° de TVA intracommunautaire admis pour une entreprise étrangère. */
export function CompanyIdField({ name, label, value, onChange, foreign = false, hint }: {
  name: string; label: ReactNode; value: string; onChange: (v: string) => void; foreign?: boolean; hint?: ReactNode;
}) {
  return (
    <Field name={name} label={label} hint={companyIdHint(value, foreign, hint ?? (foreign ? "SIRET, ou n° de TVA d'une entreprise étrangère." : undefined))}>
      <Input name={name} value={value} onChange={(e) => onChange(e.target.value)} placeholder="000 000 000 00000" maxLength={40} autoComplete="off"
        inputMode={foreign ? undefined : 'numeric'} spellCheck={false} />
    </Field>
  );
}

/** « SIRET à renseigner » (avertissement) ou SIRET mis en forme, sous un nom d'entreprise dans un tableau. */
export function SiretLine({ siret }: { siret: string | null }) {
  return siret
    ? <div style={{ ...muted, fontVariantNumeric: 'tabular-nums' }}>{fmtSiret(siret)}</div>
    : <div style={{ ...muted, color: TONE.warn.fg }}>SIRET à renseigner</div>;
}
