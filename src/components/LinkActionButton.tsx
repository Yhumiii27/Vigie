'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { Dialog } from '@/components/Dialog';
import { Field, Select } from '@/components/form';
import { linkAction, unlinkAction } from '@/server/links';
import { TipButton } from '@/components/Tip';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

type Option = readonly [value: string, label: string];

type Props = {
  /** Source à rattacher, syntaxe de src/lib/action-links.ts : risk:12 · finding:3 · requirement:5 · control:2 · review:1… */
  link: string;
  /** Actions proposées (loadFormOptions().actions : ni vérifiées ni abandonnées), déjà filtrées par l'appelant au besoin. */
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
 * Rattacher une action existante du plan d'actions à un lien complémentaire (et la détacher) — composant transverse
 * (risques, veille, revue, documents). À placer à côté de NewActionButton, pour le service QHSE seulement (ACT-22 : toute
 * modification d'une action relève du QHSE ; src/server/links.ts le refuse aux autres rôles). Jamais pour un événement
 * ni un audit (fixés à la création de l'action, D15), ni pour une habilitation, un plan de prévention ou un permis.
 */
export function LinkActionButton({ link, actions = [], current, label, className = 'vg-text-btn', icon = 'ph-link', style, disabled, tooltip }: Props) {
  const { t } = useI18n();
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
      setError(t('The operation failed. Try again.'));
    }
  });

  if (current) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', ...style }}>
        {confirm ? (
          <>
            <span style={{ fontSize: 12, color: 'var(--color-neutral-300)' }}>{fill(t('Detach {ref}?'), { ref: current })}</span>
            <button type="button" className="vg-text-btn" disabled={pending} onClick={() => run(() => unlinkAction(link, current), () => setConfirm(false))}>
              {pending ? t('Detaching…') : t('Confirm')}
            </button>
            <button type="button" className="vg-text-btn" disabled={pending} onClick={() => { setConfirm(false); setError(null); }}>{t('Cancel')}</button>
          </>
        ) : (
          <TipButton className={className} disabled={disabled} tip={tooltip ?? fill(t('Detach {ref} (the action stays in the plan)'), { ref: current })} onClick={() => setConfirm(true)}>
            <i className="ph ph-link-break" style={{ fontSize: 13 }} aria-hidden />{t('Detach')}
          </TipButton>
        )}
        {error && <span role="alert" style={{ fontSize: 12, color: 'var(--tone-danger-fg)' }}>{error}</span>}
      </span>
    );
  }

  const close = () => setOpen(false);
  return (
    <>
      <TipButton className={className} style={style} disabled={disabled || !actions.length} tip={tooltip ?? (actions.length ? undefined : t('No open action to link#plan'))} onClick={() => setOpen(true)}>
        {icon && <i className={`ph ${icon}`} style={{ fontSize: 13 }} aria-hidden />}{label ?? t('Link an existing action')}
      </TipButton>
      <Dialog open={open} onClose={close} title={t('Link an existing action')} kicker={t('Single action plan')} width={520}>
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
  const { t } = useI18n();
  const [picked, setPicked] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () => start(async () => {
    try {
      const r = await linkAction(link, picked);
      setError(r.error ?? null);
      if (!r.error) onDone();
    } catch {
      setError(t('The operation failed. Try again.'));
    }
  });
  return (
    <div className="vg-form">
      <Field name="actionId" label={t('Action')} hint={t('Open actions of the action plan (neither verified nor abandoned).')}>
        <Select name="actionId" options={actions} placeholder={t('Choose…')} value={picked} onChange={(e) => setPicked(e.target.value)} autoFocus />
      </Field>
      {error && <div role="alert" className="vg-form-error">{error}</div>}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>{t('Cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={!picked || pending} onClick={submit}>
          <i className="ph ph-link" style={{ fontSize: 14 }} aria-hidden />{pending ? t('Linking…') : t('Link#verb')}
        </button>
      </div>
    </div>
  );
}
