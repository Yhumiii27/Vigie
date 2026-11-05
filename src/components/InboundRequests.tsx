import type { InboundView } from '@/lib/data/inbound';
import { acknowledgeInboundRequest } from '@/server/connectors';
import { ReasonButton } from './ReasonDialog';
import { ToneTag } from './ui';

// Demandes reçues des autres outils (D13, décision CV-08) : historique en lecture sur la fiche d'une NC, refus à prendre
// en compte dans l'onglet « Connecteurs ». Composant sans état, utilisable côté serveur ou navigateur.

const fmtAt = (iso: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** « Prendre en compte » un refus (motif) : animateur QHSE et direction. */
function AcknowledgeButton({ id }: { id: number }) {
  return (
    <ReasonButton action={acknowledgeInboundRequest} hidden={{ id }} label="Prendre en compte" icon="ph-check" title={`Refus de la demande n° ${id}`} kicker="Demandes reçues"
      submitLabel="Prendre en compte" message="L’échéance du refus disparaît ; la demande reste refusée et lisible."
      placeholder="Ex. Keystone renverra la demande après la mise à jour de la NC" />
  );
}

/** Une demande : nature, état, personne déclarée par l'outil, commentaire, résultat du traitement. */
export function InboundItem({ r, canAcknowledge, showTarget }: { r: InboundView; canAcknowledge: boolean; showTarget?: boolean }) {
  return (
    <li style={{ display: 'grid', gap: 2, fontSize: 12.5, padding: '6px 0', borderBottom: '1px solid var(--color-divider)' }}>
      <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span>{showTarget ? `${r.targetRef} · ` : ''}{r.summary}</span>
        <ToneTag tone={r.statusTone} style={{ fontSize: 11, marginLeft: 'auto' }}>{r.statusLabel}</ToneTag>
      </span>
      {r.comment && <span style={{ color: 'var(--color-neutral-300)', fontStyle: 'italic', whiteSpace: 'pre-line' }}>{r.comment}</span>}
      {r.result && (
        <span style={{ color: 'var(--color-neutral-300)', fontWeight: r.status === 'rejected' ? 500 : undefined }}>
          {r.resultLabel ? `${r.resultLabel} : ` : ''}{r.result}
        </span>
      )}
      <span style={{ fontSize: 11, color: 'var(--vg-text-muted)' }}>
        {r.tool} · demande n° {r.id}{r.person ? ` · ${r.person}` : ''} · reçue le {fmtAt(r.receivedAt)}{r.processedAt ? ` · traitée le ${fmtAt(r.processedAt)}` : ''}
      </span>
      {r.acknowledged && (
        <span style={{ fontSize: 11, color: 'var(--vg-text-muted)' }}>Refus pris en compte le {fmtAt(r.acknowledged.at)} par {r.acknowledged.by} : {r.acknowledged.reason}</span>
      )}
      {canAcknowledge && r.status === 'rejected' && !r.acknowledged && <span><AcknowledgeButton id={r.id} /></span>}
    </li>
  );
}

/** Section « Demandes de Keystone » de la fiche d'une NC (lecture ; refus et motifs pour le QHSE seulement). */
export function EventInbound({ items, qhse }: { items: InboundView[]; qhse: boolean }) {
  if (!items.length) return null;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <h6 className="vg-h6">Demandes reçues de Keystone</h6>
      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--vg-text-muted)' }}>
        Avancement signalé par Keystone et traité par Vigie selon ses propres règles ; la qualification et la clôture restent des décisions du QHSE.
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((r) => <InboundItem key={r.id} r={r} canAcknowledge={qhse} />)}
      </ul>
    </div>
  );
}
