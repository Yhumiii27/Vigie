'use client';

import type { InboundView } from '@/lib/data/inbound';
import { acknowledgeInboundRequest } from '@/server/connectors';
import { ReasonButton } from './ReasonDialog';
import { ToneTag } from './ui';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';

// Demandes reçues des autres outils (D13, décision CV-08) : historique en lecture sur la fiche d'une NC, refus à prendre
// en compte dans l'onglet « Connecteurs ». Composant du navigateur (traduction par useI18n), rendu par la fiche serveur et
// par l'onglet « Connecteurs ».

const fmtAt = (iso: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** « Prendre en compte » un refus (motif) : animateur QHSE et direction. */
function AcknowledgeButton({ id }: { id: number }) {
  const { t } = useI18n();
  return (
    <ReasonButton action={acknowledgeInboundRequest} hidden={{ id }} label={t('Acknowledge')} icon="ph-check" title={fill(t('Refusal of request no. {id}'), { id })} kicker={t('Requests received')}
      submitLabel={t('Acknowledge')} message={t('The refusal’s deadline disappears; the request stays refused and readable.')}
      placeholder={t('E.g. Keystone will resend the request after the NC is updated')} />
  );
}

/** Une demande : nature, état, personne déclarée par l'outil, commentaire, résultat du traitement. */
export function InboundItem({ r, canAcknowledge, showTarget }: { r: InboundView; canAcknowledge: boolean; showTarget?: boolean }) {
  const { t } = useI18n();
  return (
    <li style={{ display: 'grid', gap: 2, fontSize: 12.5, padding: '6px 0', borderBottom: '1px solid var(--color-divider)' }}>
      <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span>{showTarget ? `${r.targetRef} · ` : ''}{r.summary}</span>
        <ToneTag tone={r.statusTone} style={{ fontSize: 11, marginLeft: 'auto' }}>{labelT(t)(r.statusLabel)}</ToneTag>
      </span>
      {r.comment && <span style={{ color: 'var(--color-neutral-300)', fontStyle: 'italic', whiteSpace: 'pre-line' }}>{r.comment}</span>}
      {r.result && (
        <span style={{ color: 'var(--color-neutral-300)', fontWeight: r.status === 'rejected' ? 500 : undefined }}>
          {r.resultLabel ? fill(t('{label}: '), { label: r.resultLabel }) : ''}{r.result}
        </span>
      )}
      <span style={{ fontSize: 11, color: 'var(--vg-text-muted)' }}>
        {r.tool} · {fill(t('request no. {id}'), { id: r.id })}{r.person ? ` · ${r.person}` : ''} · {fill(t('received on {at}'), { at: fmtAt(r.receivedAt) })}{r.processedAt ? ` · ${fill(t('processed on {at}'), { at: fmtAt(r.processedAt) })}` : ''}
      </span>
      {r.acknowledged && (
        <span style={{ fontSize: 11, color: 'var(--vg-text-muted)' }}>{fill(t('Refusal acknowledged on {at} by {by}: {reason}'), { at: fmtAt(r.acknowledged.at), by: r.acknowledged.by, reason: r.acknowledged.reason })}</span>
      )}
      {canAcknowledge && r.status === 'rejected' && !r.acknowledged && <span><AcknowledgeButton id={r.id} /></span>}
    </li>
  );
}

/** Section « Demandes de Keystone » de la fiche d'une NC (lecture ; refus et motifs pour le QHSE seulement). */
export function EventInbound({ items, qhse }: { items: InboundView[]; qhse: boolean }) {
  const { t } = useI18n();
  if (!items.length) return null;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <h6 className="vg-h6">{t('Requests received from Keystone')}</h6>
      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--vg-text-muted)' }}>
        {t('Progress reported by Keystone and processed by Vigie under its own rules; qualification and closure remain QHSE decisions.')}
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((r) => <InboundItem key={r.id} r={r} canAcknowledge={qhse} />)}
      </ul>
    </div>
  );
}
