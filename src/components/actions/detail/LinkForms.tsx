'use client';

// Liens complémentaires depuis la fiche d'une action (ACT-02, décidé le 15/10/2026) : « Rattacher » un risque du DUERP,
// une exigence, un contrôle, une version de document en révision, une revue ou une décision de revue, et « Détacher » l'un
// d'eux. Service QHSE seulement, sur le site de l'action (linkAction / unlinkAction, src/server/links.ts, appliquent les
// mêmes règles) ; jamais l'événement ni l'audit, ni une source d'origine (fixés à la création).

import { useMemo, useState, useTransition } from 'react';
import { Field, Select } from '@/components/form';
import { Icon } from '@/components/ui';
import { COMPLEMENTARY_LINK_KINDS, COMPLEMENTARY_LINK_LABELS, type ComplementaryLinkKind } from '@/lib/action-rules';
import type { LinkTargetOption } from '@/lib/action-view';
import { linkAction, unlinkAction } from '@/server/links';
import { TipButton } from '@/components/Tip';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

/** Fenêtre « Rattacher un élément » : type d'élément, puis élément ; `onDone` reçoit le libellé rattaché. */
export function LinkTargetForm({ actionId, targets, onDone, onCancel }: {
  actionId: string; targets: readonly LinkTargetOption[]; onDone: (label: string) => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const kinds = useMemo(() => COMPLEMENTARY_LINK_KINDS.filter((k) => targets.some((o) => o.kind === k)), [targets]);
  const [kind, setKind] = useState<ComplementaryLinkKind | ''>(kinds.length === 1 ? kinds[0] : '');
  const [picked, setPicked] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const choices = targets.filter((o) => o.kind === kind).map((o) => [o.value, o.label] as const);
  const submit = () => start(async () => {
    try {
      const r = await linkAction(picked, actionId);
      setError(r.error ?? null);
      if (!r.error) onDone(targets.find((o) => o.value === picked)?.label ?? '');
    } catch {
      setError(t('The operation failed. Try again.'));
    }
  });
  return (
    <div className="vg-form">
      <Field name="linkKind" label={t('Item type')} hint={t('Complementary link: the event or audit and the source stay those of the creation.')}>
        <Select name="linkKind" options={kinds.map((k) => [k, COMPLEMENTARY_LINK_LABELS[k]] as const)} placeholder={t('Choose…')} value={kind}
          onChange={(e) => { setKind(e.target.value as ComplementaryLinkKind | ''); setPicked(''); }} autoFocus />
      </Field>
      <Field name="link" label={t('Item')} hint={t('Items of the action’s site or common to the company, still open to actions.')}>
        <Select name="link" options={choices} placeholder={kind ? t('Choose…') : t('Choose the type first')} value={picked}
          onChange={(e) => setPicked(e.target.value)} disabled={!kind} />
      </Field>
      {error && <div role="alert" className="vg-form-error">{error}</div>}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>{t('Cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={!picked || pending} onClick={submit}>
          <Icon name="ph-link" size={14} />{pending ? t('Linking…') : t('Link')}
        </button>
      </div>
    </div>
  );
}

/** « Détacher » un lien complémentaire de la fiche, avec confirmation en ligne ; l'action reste dans le plan. */
export function DetachLinkButton({ actionId, link, label, disabled, onDone }: {
  actionId: string; link: string; label: string; disabled?: boolean; onDone: (label: string) => void;
}) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = () => start(async () => {
    try {
      const r = await unlinkAction(link, actionId);
      setError(r.error ?? null);
      if (!r.error) { setConfirm(false); onDone(label); }
    } catch {
      setError(t('The operation failed. Try again.'));
    }
  });
  return (
    <span className="vg-source-actions">
      {confirm ? (
        <>
          <span className="vg-muted">{t('Detach?')}</span>
          <button type="button" className="vg-text-btn" disabled={pending} onClick={run}>{pending ? t('Detaching…') : t('Confirm')}</button>
          <button type="button" className="vg-text-btn" disabled={pending} onClick={() => { setConfirm(false); setError(null); }}>{t('Cancel')}</button>
        </>
      ) : (
        <TipButton className="vg-text-btn" disabled={disabled} tip={fill(t('Detach {id} from this item (the action stays in the plan)'), { id: actionId })}
          onClick={() => setConfirm(true)}>
          <Icon name="ph-link-break" size={12} />{t('Detach')}
        </TipButton>
      )}
      {error && <span role="alert" style={{ color: 'var(--tone-danger-fg)' }}>{error}</span>}
    </span>
  );
}
