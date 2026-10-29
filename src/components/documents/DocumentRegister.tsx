'use client';

import { useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { Dialog } from '@/components/Dialog';
import { Icon, MissingNotice, ToneTag } from '@/components/ui';
import { searchWith } from '@/lib/url-state';
import { fmtDate } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import type { DocumentRow, UnavailableDoc } from '@/lib/data/documents';
import { NewDocumentButton, type DocFormOptions } from './DocumentForms';
import { DocumentPanel } from './DocumentPanel';

type Props = {
  /** Documents du site sélectionné (la fiche reste ouverte même si un filtre masque la ligne). */
  docs: DocumentRow[];
  /** Références affichées après filtrage, dans l'ordre. */
  shownIds: string[];
  toolbar: ReactNode;
  emptyText: string;
  canManage: boolean;
  canApprove: boolean;
  options: DocFormOptions;
  existingIds: string[];
  /** Documents rattachés à un autre site que celui sélectionné : référence → libellé du site. */
  elsewhere: Record<string, string>;
  /** Consultation seule : documents sans version en vigueur (référence → raison), pour expliquer un lien ?doc= sans fiche. */
  unavailable?: Record<string, UnavailableDoc>;
  /** Site sélectionné (null = « Tous les sites ») : site proposé pour un nouveau document. */
  siteId: string | null;
  suggestedDueOn: string;
  /** Personne connectée (revue périodique sans modification par le propriétaire du document, DOC-15). */
  userId?: string;
};

const muted = 'var(--color-neutral-400)';

/** Registre des documents maîtrisés : tableau filtré et fiche du document en fenêtre modale. */
export function DocumentRegister({ docs, shownIds, toolbar, emptyText, canManage, canApprove, options, existingIds, elsewhere, unavailable = {}, siteId, suggestedDueOn, userId }: Props) {
  // La fiche ouverte est portée par l'URL (?doc=PR-QHSE-003) : lien profond depuis les échéances et notifications.
  // Convention d'URL (UX-12) : ouverture ajoutée à l'historique (« Précédent » ferme la fiche), fermeture en place.
  const openId = useSearchParams().get('doc');
  const open = (id: string | null) => {
    const search = searchWith(window.location.search, { doc: id ?? undefined });
    const href = `${window.location.pathname}${search}`;
    if (id) window.history.pushState(null, '', href);
    else window.history.replaceState(null, '', href);
  };

  const byId = new Map(docs.map((d) => [d.id, d]));
  const shown = shownIds.map((id) => byId.get(id)).filter((d): d is DocumentRow => !!d);
  const doc = openId ? byId.get(openId) ?? null : null;
  // Fiche demandée mais hors du site sélectionné (document créé ou déplacé vers un autre site) : on l'explique.
  const otherSite = openId && !doc && Object.hasOwn(elsewhere, openId) ? elsewhere[openId] : null;
  const notInForce = openId && !doc && Object.hasOwn(unavailable, openId) ? unavailable[openId] : null;
  const notice = otherSite
    ? <>{openId} est rattaché au {otherSite.charAt(0).toLowerCase()}{otherSite.slice(1)} : sélectionnez ce site ou « Tous les sites » pour l&apos;afficher.</>
    : notInForce === 'retired'
      ? <>{openId} a été retiré de la diffusion (document obsolète) : il n&apos;est plus consultable. Adressez-vous à l&apos;animateur QHSE pour connaître le document qui le remplace.</>
      : notInForce === 'draft'
        ? <>{openId} n&apos;est pas encore en vigueur : il sera consultable ici dès l&apos;approbation de sa première version.</>
        : null;
  // Référence inconnue, hors du périmètre ou sans fiche consultable par le rôle : bandeau commun (UX-13), même message.
  const missing = !!openId && !doc && !notice;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {toolbar}
        {canManage && <span style={{ marginLeft: 'auto' }}><NewDocumentButton options={options} existingIds={existingIds} defaultSiteId={siteId} onCreated={open} /></span>}
      </div>

      {missing && <MissingNotice text="Document introuvable ou hors du site sélectionné." onClose={() => open(null)} />}
      {notice && (
        <div className="vg-inset" role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', fontSize: 12.5, boxShadow: `inset 2px 0 0 ${TONE.accent.dot}` }}>
          <Icon name="ph-info" size={15} style={{ color: TONE.accent.dot, flex: 'none' }} />
          <span style={{ flex: 1, textWrap: 'pretty' }}>{notice}</span>
          <button type="button" className="vg-text-btn" onClick={() => open(null)}>Fermer</button>
        </div>
      )}

      <div className="card" style={{ padding: '6px 14px 10px' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 12.5, minWidth: 1080 }}>
            <thead>
              <tr>
                <th>Référence</th><th>Titre</th><th>Type</th><th>Processus</th><th>Version</th><th>Statut</th>
                <th>Propriétaire</th><th>Approuvé le</th><th>Prochaine revue</th><th>Diffusion</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={10} style={{ padding: '14px 8px', color: 'var(--color-neutral-500)', fontSize: 12 }}>{emptyText}</td></tr>
              )}
              {shown.map((d) => (
                <tr key={d.id} onClick={() => open(d.id)} className="is-clickable" data-obsolete={d.status === 'obsolete' || undefined}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="vg-text-btn" style={{ fontSize: 12.5, color: 'var(--color-neutral-300)' }}
                      onClick={(e) => { e.stopPropagation(); open(d.id); }}>
                      {d.id}
                    </button>
                  </td>
                  <td style={{ fontWeight: 500, minWidth: 200, textWrap: 'pretty' }}>{d.title}</td>
                  <td style={{ color: muted, whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name={d.typeIcon} size={12} />{d.typeLabel}</span>
                  </td>
                  <td style={{ color: muted, whiteSpace: 'nowrap' }}>{d.processLabel}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {d.current ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 500 }}>{d.current.version}</span>
                        {d.current.file && (
                          <a href={`/fichiers/${d.current.file.id}`} target="_blank" rel="noopener noreferrer" className="vg-link" onClick={(e) => e.stopPropagation()}
                            title={`Ouvrir la version ${d.current.version} · ${d.current.file.name}`} aria-label={`Ouvrir la version ${d.current.version} de ${d.id}`}
                            style={{ display: 'inline-flex' }}>
                            <Icon name="ph-file-arrow-down" size={14} />
                          </a>
                        )}
                      </span>
                    ) : <span className="vg-muted">—</span>}
                    {d.pending && (
                      <span style={{ display: 'block', fontSize: 11, color: d.pending.status === 'en_revue' ? TONE.warn.dot : 'var(--color-neutral-500)' }}>
                        {d.current ? 'révision' : 'version'} {d.pending.version} {d.pending.status === 'en_revue' ? 'en revue' : 'en cours'}
                      </span>
                    )}
                  </td>
                  <td><ToneTag tone={d.statusTone} style={{ whiteSpace: 'nowrap' }}>{d.statusLabel}</ToneTag></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{d.owner}</td>
                  <td style={{ whiteSpace: 'nowrap', color: muted }}>{d.current?.approvedOn ? fmtDate(d.current.approvedOn) : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap', color: d.overdue ? TONE.danger.dot : d.dueSoon ? TONE.warn.dot : 'var(--color-neutral-300)' }}>
                    {d.nextReviewOn ? fmtDate(d.nextReviewOn) : '—'}
                    {d.overdue && <span style={{ display: 'block', fontSize: 11 }}>en retard · +{-(d.reviewDays ?? 0)} j</span>}
                    {d.dueSoon && <span style={{ display: 'block', fontSize: 11 }}>{d.reviewDays === 0 ? "aujourd'hui" : `dans ${d.reviewDays} j`}</span>}
                  </td>
                  <td style={{ color: muted, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.distribution}>{d.distribution || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!doc} onClose={() => open(null)} width={900} title={doc?.title ?? ''}
        kicker={doc ? `${doc.id} · ${doc.typeLabel} · ${doc.processLabel}` : undefined}>
        {doc && <DocumentPanel key={doc.id} doc={doc} canManage={canManage} canApprove={canApprove} options={options} suggestedDueOn={suggestedDueOn} userId={userId} />}
      </Dialog>
    </>
  );
}
