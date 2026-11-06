'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { ActionFields } from '@/components/ActionFormDialog';
import { Dot, Icon, ToneTag } from '@/components/ui';
import { LinkedEvents } from '@/components/LinkedEvents';
import { newEventHref } from '@/lib/event-prefill';
import { QHSE_ONLY_CREATE_MESSAGE, actionHref } from '@/lib/action-rules';
import type { ActionFormOptions } from '@/lib/action-view';
import { fmtDate } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import { CODEX_DOCUMENTS_NOTICE } from '@/lib/foreign/labels';
import type { DocumentRow, LinkedAction } from '@/lib/data/documents';
import { documentActionDefaults } from './action-defaults';

const H6 = ({ children }: { children: ReactNode }) => <h6 className="vg-h6">{children}</h6>;

function Meta({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div style={{ display: 'grid', gap: 2, minWidth: 0, gridColumn: wide ? '1 / -1' : undefined }}>
      <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--vg-text-muted)' }}>{label}</span>
      <span style={{ fontSize: 12.5, textWrap: 'pretty' }}>{children}</span>
    </div>
  );
}

function ActionLink({ action }: { action: LinkedAction }) {
  return (
    <Link href={actionHref(action.id)} className="vg-link" aria-label={`${action.id} · ${action.label} · ${action.statusLabel}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
      <Dot color={TONE[action.tone].dot} size={6} />{action.id}
    </Link>
  );
}

/** Lien « Ouvrir dans Codex » (nouvel onglet) ; sans adresse de Codex configurée, rien. */
export function CodexLink({ href, label = 'Ouvrir dans Codex', className = 'btn btn-secondary vg-btn-sm' }: { href: string | null; label?: string; className?: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} onClick={(e) => e.stopPropagation()}>
      <Icon name="ph-arrow-square-out" size={13} />{label}
    </a>
  );
}

const reviewText = (doc: DocumentRow) => {
  if (!doc.nextReviewOn || doc.reviewDays == null) return null;
  if (doc.overdue) return `Revue périodique dépassée depuis le ${fmtDate(doc.nextReviewOn)} (+${-doc.reviewDays} j).`;
  return `Revue périodique prévue le ${fmtDate(doc.nextReviewOn)} (${doc.reviewDays === 0 ? "aujourd'hui" : `dans ${doc.reviewDays} j`}).`;
};

/**
 * Fiche d'un document lu dans Codex (lot 4 de M-02) : informations, circuit en cours, révisions, actions et événements
 * rattachés. Consultation seule : la revue, la révision ou le retrait se font dans Codex ; le service QHSE crée ici une
 * action du plan (revue périodique ou action libre) rattachée au document ou à sa révision ouverte.
 */
export function DocumentPanel({ doc, canManage, actionForm, suggestedDueOn }: {
  doc: DocumentRow; canManage: boolean; actionForm: ActionFormOptions | null; suggestedDueOn: string;
}) {
  const [mode, setMode] = useState<'view' | 'action'>('view');
  const [reviewAction, setReviewAction] = useState(true);
  const newAction = (review: boolean) => { setReviewAction(review); setMode('action'); };
  const back = () => setMode('view');
  const inForce = doc.revisions.find((r) => r.status === 'in_force') ?? null;
  const open = doc.revisions.find((r) => r.status === 'draft' || r.status === 'in_review' || r.status === 'approved') ?? null;
  const review = reviewText(doc);
  const showReview = !!review && (doc.overdue || doc.dueSoon) && mode === 'view';

  if (mode === 'action' && actionForm) {
    return (
      <section style={{ display: 'grid', gap: 10, marginTop: 6 }}>
        <H6>Nouvelle action · plan d&apos;actions unique</H6>
        <ActionFields options={actionForm} onDone={back} onCancel={back}
          defaults={documentActionDefaults({ ...doc, pending: open ? { letter: open.letter, action: open.action } : null }, { review: reviewAction, suggestedDueOn })} />
      </section>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16, marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <ToneTag tone={doc.statusTone}>{doc.statusLabel}</ToneTag>
        {inForce && <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>Révision {inForce.letter} en vigueur{inForce.inForceAt ? ` depuis le ${fmtDate(inForce.inForceAt)}` : ''}</span>}
        {canManage && open && (
          <span style={{ fontSize: 12, color: open.status === 'in_review' ? TONE.warn.dot : 'var(--color-neutral-400)' }}>
            {inForce ? '· ' : ''}révision {open.letter} {open.status === 'in_review' ? 'en validation' : open.status === 'approved' ? 'approuvée, en attente de mise en vigueur' : 'en rédaction'}
          </span>
        )}
        {doc.legalHold && <ToneTag tone="warn">Gel juridique</ToneTag>}
        <span style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 }}>
          <CodexLink href={doc.codexHref} />
        </span>
      </div>

      {doc.withdrawn && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)', background: TONE.neutral.bg }}>
          <Icon name="ph-prohibit" size={14} style={{ color: 'var(--color-neutral-400)', flex: 'none', alignSelf: 'center' }} />
          <span style={{ fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
            {doc.statusLabel}{doc.withdrawnOn ? ` depuis le ${fmtDate(doc.withdrawnOn)}` : ''} dans Codex : ne plus appliquer.
          </span>
        </div>
      )}

      {showReview && (
        <div className="vg-inset" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', boxShadow: `inset 2px 0 0 ${doc.overdue ? TONE.danger.dot : TONE.warn.dot}` }}>
          <Icon name="ph-clock-countdown" size={16} style={{ color: doc.overdue ? TONE.danger.dot : TONE.warn.dot }} />
          <div style={{ display: 'grid', gap: 2, flex: 1, minWidth: 220 }}>
            <span style={{ fontSize: 12.5 }}>{review}</span>
            <span style={{ fontSize: 11, color: 'var(--vg-text-muted)', textWrap: 'pretty' }}>
              La revue (sans modification ou par une nouvelle révision) se fait dans Codex par le propriétaire du document.
            </span>
          </div>
          {doc.openActions.length > 0 ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-neutral-400)' }}>
              Action{doc.openActions.length > 1 ? 's' : ''} {doc.openActions.map((a) => <ActionLink key={a.id} action={a} />)}
            </span>
          ) : actionForm ? (
            <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => newAction(true)}><Icon name="ph-list-plus" size={13} />Créer une action</button>
          ) : canManage && (
            <span style={{ fontSize: 11.5, color: 'var(--vg-text-muted)' }}>{QHSE_ONLY_CREATE_MESSAGE}</span>
          )}
        </div>
      )}

      <section style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <H6>Informations</H6>
          {actionForm && !doc.withdrawn && <button type="button" className="vg-text-btn" onClick={() => newAction(false)}>Nouvelle action</button>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px 16px' }}>
          <Meta label="Référence">{doc.id}{doc.aliases.length > 0 && <span style={{ display: 'block', fontSize: 11, color: 'var(--vg-text-muted)' }}>Anciennement {doc.aliases.join(', ')}</span>}</Meta>
          <Meta label="Type">{doc.typeLabel}{doc.subtype ? ` · ${doc.subtype}` : ''}</Meta>
          <Meta label="Processus">{doc.processLabel}</Meta>
          <Meta label="Propriétaire">{doc.owner}</Meta>
          <Meta label="Confidentialité">{doc.confLabel}</Meta>
          <Meta label="Périodicité de revue">{doc.reviewMonths ? `${doc.reviewMonths} mois` : '—'}</Meta>
          <Meta label="Prochaine revue">
            <span style={{ color: doc.overdue ? TONE.danger.dot : doc.dueSoon ? TONE.warn.dot : undefined }}>{doc.nextReviewOn ? fmtDate(doc.nextReviewOn) : '—'}</span>
          </Meta>
          <Meta label="Site">{doc.siteLabel}</Meta>
          <Meta label="Origine">{doc.origin === 'externe' ? `Externe${doc.sourceOrg ? ` · ${doc.sourceOrg}` : ''}` : 'Interne'}</Meta>
          <Meta label="Conservation (par type, Codex)">{doc.retention ?? '—'}</Meta>
          <Meta label="Diffusion" wide>{doc.distribution || '—'}</Meta>
        </div>
      </section>

      {canManage && doc.circuit && (
        <section style={{ display: 'grid', gap: 6 }}>
          <H6>Circuit de validation en cours · révision {doc.circuit.revision}</H6>
          <span style={{ fontSize: 12, color: doc.circuit.overdue ? TONE.danger.dot : 'var(--color-neutral-400)' }}>
            {doc.circuit.submittedOn ? `Lancé le ${fmtDate(doc.circuit.submittedOn)}` : 'Lancé'}{doc.circuit.due ? ` · échéance le ${fmtDate(doc.circuit.due)}${doc.circuit.overdue ? ' (dépassée)' : ''}` : ''}
          </span>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 3, fontSize: 12.5 }}>
            {doc.circuit.steps.map((s) => (
              <li key={s.idx}>
                {s.label} · {s.assignee}
                {s.doneOn ? <span style={{ color: TONE.ok.dot }}> · validé le {fmtDate(s.doneOn)}</span> : s.current ? <span style={{ color: TONE.warn.dot }}> · étape en cours</span> : null}
              </li>
            ))}
          </ol>
        </section>
      )}

      {canManage && doc.openActions.length > 0 && !showReview && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--color-neutral-400)' }}>
          <H6>Actions liées</H6>
          {doc.openActions.map((a) => <span key={a.id} style={{ display: 'inline-flex', gap: 6 }}><ActionLink action={a} /><span>{a.label}</span></span>)}
        </div>
      )}
      {canManage && doc.closedActions.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--color-neutral-400)' }}>
          <H6>Actions clôturées</H6>
          {doc.closedActions.map((a) => <span key={a.id} style={{ display: 'inline-flex', gap: 6 }}><ActionLink action={a} /><span>{a.label}</span></span>)}
        </div>
      )}
      {canManage && <LinkedEvents events={doc.events} reportHref={newEventHref('document', doc.id)} />}

      <section style={{ display: 'grid', gap: 8 }}>
        <H6>{canManage ? 'Révisions' : 'Révision en vigueur'}</H6>
        {/* Défilement horizontal sur téléphone : conteneur focalisable pour défiler au clavier (axe, scrollable-region-focusable). */}
        <div style={{ overflowX: 'auto' }} tabIndex={0} role="group" aria-label="Révisions du document, défilement horizontal sur petit écran">
          <table className="table" style={{ fontSize: 12, minWidth: canManage ? 760 : 560 }}>
            <thead>
              <tr>
                <th>Révision</th><th>Statut</th><th>Objet</th><th>Auteur</th><th>Approuvée le</th><th>Fichier</th>{canManage && <th>Action liée</th>}
              </tr>
            </thead>
            <tbody>
              {doc.revisions.length === 0 && <tr><td colSpan={canManage ? 7 : 6} style={{ color: 'var(--vg-text-muted)' }}>Aucune révision publiée par Codex.</td></tr>}
              {doc.revisions.map((r) => (
                <tr key={r.letter} style={r.status === 'superseded' || r.status === 'cancelled' ? { color: 'var(--color-neutral-400)' } : undefined}>
                  <td style={{ fontWeight: 500 }}>{r.letter}</td>
                  <td><ToneTag tone={r.tone} style={{ whiteSpace: 'nowrap' }}>{r.statusLabel}</ToneTag></td>
                  <td style={{ minWidth: 220, textWrap: 'pretty' }}>{r.comment || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.author ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.approvedAt ? fmtDate(r.approvedAt) : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.fileName ? (doc.codexHref ? <CodexLink href={doc.codexHref} label={r.fileName} className="vg-link" /> : r.fileName) : <span className="vg-muted">—</span>}</td>
                  {canManage && <td>{r.action ? <ActionLink action={r.action} /> : <span className="vg-muted">—</span>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--vg-text-muted)', textWrap: 'pretty' }}>{CODEX_DOCUMENTS_NOTICE}</p>
    </div>
  );
}
