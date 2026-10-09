'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { Dialog } from '@/components/Dialog';
import { Field, Select } from '@/components/form';
import { linkAction, unlinkAction } from '@/server/links';

type Option = readonly [value: string, label: string];

type Props = {
  /** Source à rattacher, syntaxe de src/lib/action-links.ts : risk:12 · finding:3 · requirement:5 · control:2 · review:1… */
  link: string;
  /** Actions proposées (loadFormOptions().actions : ouvertes, non annulées), déjà filtrées par l'appelant au besoin. */
  actions?: readonly Option[];
  /** Action actuellement rattachée : le bouton propose alors « Détacher » (confirmation en ligne). */
  current?: string | null;
  label?: string;
  className?: string;
  icon?: string;
  style?: CSSProperties;
  disabled?: boolean;
  tooltip?: string;
};

/**
 * Rattacher une action existante du plan d'actions à une source (et la détacher) — composant transverse
 * (risques, veille, audits, revue). À placer à côté de NewActionButton.
 */
export function LinkActionButton({ link, actions = [], current, label = 'Rattacher une action existante', className = 'vg-text-btn', icon = 'ph-link', style, disabled, tooltip }: Props) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ error?: string }>, after: () => void) => start(async () => {
    try {
      const r = await fn();
      setError(r.error ?? null);
      if (!r.error) after();
    } catch {
      setError("L'opération a échoué. Réessayez.");
    }
  });

  if (current) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', ...style }}>
        {confirm ? (
          <>
            <span style={{ fontSize: 12, color: 'var(--color-neutral-300)' }}>Détacher {current} ?</span>
            <button type="button" className="vg-text-btn" disabled={pending} onClick={() => run(() => unlinkAction(link, current), () => setConfirm(false))}>
              {pending ? 'Détachement…' : 'Confirmer'}
            </button>
            <button type="button" className="vg-text-btn" disabled={pending} onClick={() => { setConfirm(false); setError(null); }}>Annuler</button>
          </>
        ) : (
          <button type="button" className={className} disabled={disabled} title={tooltip ?? `Détacher ${current} (l'action reste dans le plan)`} onClick={() => setConfirm(true)}>
            <i className="ph ph-link-break" style={{ fontSize: 13 }} />Détacher
          </button>
        )}
        {error && <span role="alert" style={{ fontSize: 12, color: 'var(--tone-danger-fg)' }}>{error}</span>}
      </span>
    );
  }

  const close = () => setOpen(false);
  return (
    <>
      <button type="button" className={className} style={style} disabled={disabled || !actions.length} title={tooltip ?? (actions.length ? undefined : 'Aucune action ouverte à rattacher')} onClick={() => setOpen(true)}>
        {icon && <i className={`ph ${icon}`} style={{ fontSize: 13 }} />}{label}
      </button>
      <Dialog open={open} onClose={close} title="Rattacher une action existante" kicker="Plan d'actions unique" width={520}>
        {open && <LinkActionForm link={link} actions={actions} onDone={close} onCancel={close} />}
      </Dialog>
    </>
  );
}

/**
 * Contenu de la fenêtre « Rattacher une action existante » (choix de l'action, rattachement) ; à afficher tel quel
 * dans une fenêtre déjà ouverte qui change de vue (fiche risque), plutôt que d'y ouvrir une seconde fenêtre.
 */
export function LinkActionForm({ link, actions, onDone, onCancel }: { link: string; actions: readonly Option[]; onDone: () => void; onCancel: () => void }) {
  const [picked, setPicked] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () => start(async () => {
    try {
      const r = await linkAction(link, picked);
      setError(r.error ?? null);
      if (!r.error) onDone();
    } catch {
      setError("L'opération a échoué. Réessayez.");
    }
  });
  return (
    <div className="vg-form">
      <Field name="actionId" label="Action" hint="Actions ouvertes du plan d'actions (ni clôturées, ni annulées).">
        <Select name="actionId" options={actions} placeholder="Choisir…" value={picked} onChange={(e) => setPicked(e.target.value)} autoFocus />
      </Field>
      {error && <div role="alert" className="vg-form-error">{error}</div>}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Annuler</button>
        <button type="button" className="btn btn-primary" disabled={!picked || pending} onClick={submit}>
          <i className="ph ph-link" style={{ fontSize: 14 }} />{pending ? 'Rattachement…' : 'Rattacher'}
        </button>
      </div>
    </div>
  );
}
