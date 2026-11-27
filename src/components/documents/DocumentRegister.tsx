'use client';

import { useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { Dialog } from '@/components/Dialog';
import { Icon, MissingNotice, ToneTag } from '@/components/ui';
import { searchWith } from '@/lib/url-state';
import { fmtDate } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import type { ActionFormOptions } from '@/lib/action-view';
import type { DocumentRow, UnavailableDoc } from '@/lib/data/documents';
import { DocumentPanel } from './DocumentPanel';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';

type Props = {
  /** Documents du site sélectionné (la fiche reste ouverte même si un filtre masque la ligne). */
  docs: DocumentRow[];
  /** Références affichées après filtrage, dans l'ordre. */
  shownIds: string[];
  toolbar: ReactNode;
  emptyText: string;
  canManage: boolean;
  /** Formulaire d'action (service QHSE seulement, ACT-22) ; null sinon. */
  actionForm: ActionFormOptions | null;
  /** Ancien identifiant (alias de Codex, dont l'identifiant de Vigie d'avant la bascule) → identifiant de Codex. */
  aliasOf: Record<string, string>;
  /** Documents rattachés à un autre site que celui sélectionné : référence → libellé du site. */
  elsewhere: Record<string, string>;
  /** Consultation seule : documents sans révision en vigueur (référence → raison), pour expliquer un lien ?doc= sans fiche. */
  unavailable?: Record<string, UnavailableDoc>;
  suggestedDueOn: string;
};

const muted = 'var(--color-neutral-400)';

/** Registre des documents lus dans Codex : tableau filtré et fiche du document en fenêtre modale. */
export function DocumentRegister({ docs, shownIds, toolbar, emptyText, canManage, actionForm, aliasOf, elsewhere, unavailable = {}, suggestedDueOn }: Props) {
  const { t } = useI18n();
  // La fiche ouverte est portée par l'URL (?doc=PRO-QUA-0002) : lien profond depuis les échéances et notifications ; un
  // ancien identifiant (alias) ouvre le document qu'il désigne.
  // Convention d'URL (UX-12) : ouverture ajoutée à l'historique (« Précédent » ferme la fiche), fermeture en place.
  const asked = useSearchParams().get('doc');
  const openId = asked && Object.hasOwn(aliasOf, asked) ? aliasOf[asked] : asked;
  const open = (id: string | null) => {
    const search = searchWith(window.location.search, { doc: id ?? undefined });
    const href = `${window.location.pathname}${search}`;
    if (id) window.history.pushState(null, '', href);
    else window.history.replaceState(null, '', href);
  };

  const byId = new Map(docs.map((d) => [d.id, d]));
  const shown = shownIds.map((id) => byId.get(id)).filter((d): d is DocumentRow => !!d);
  const doc = openId ? byId.get(openId) ?? null : null;
  const otherSite = openId && !doc && Object.hasOwn(elsewhere, openId) ? elsewhere[openId] : null;
  const notInForce = openId && !doc && Object.hasOwn(unavailable, openId) ? unavailable[openId] : null;
  const notice = otherSite
    ? fill(t('{id} is linked to the {site}: select this site or “All sites” to show it.'), { id: openId ?? '', site: `${otherSite.charAt(0).toLowerCase()}${otherSite.slice(1)}` })
    : notInForce === 'retired'
      ? fill(t('{id} was withdrawn from distribution in Codex (obsolete or archived): it can no longer be viewed here. Ask the QHSE coordinator for the document that replaces it.'), { id: openId ?? '' })
      : notInForce === 'draft'
        ? fill(t('{id} is not in force yet: it will be viewable here as soon as its first revision comes into force in Codex.'), { id: openId ?? '' })
        : null;
  // Référence inconnue, hors du périmètre, confidentielle pour le rôle : bandeau commun (UX-13), même message.
  const missing = !!openId && !doc && !notice;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>{toolbar}</div>

      {missing && <MissingNotice text={t('Document not found or outside the selected site.')} onClose={() => open(null)} />}
      {notice && (
        <div className="vg-inset" role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', fontSize: 12.5, boxShadow: `inset 2px 0 0 ${TONE.accent.dot}` }}>
          <Icon name="ph-info" size={15} style={{ color: TONE.accent.dot, flex: 'none' }} />
          <span style={{ flex: 1, textWrap: 'pretty' }}>{notice}</span>
          <button type="button" className="vg-text-btn" onClick={() => open(null)}>{t('Close')}</button>
        </div>
      )}

      <div className="card" style={{ padding: '6px 14px 10px' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 12.5, minWidth: 980 }}>
            <thead>
              <tr>
                <th>{t('Reference')}</th><th>{t('Title#qualification')}</th><th>{t('Type')}</th><th>{t('Process')}</th><th>{t('Revision')}</th><th>{t('Status')}</th>
                <th>{t('Owner#document')}</th><th>{t('Next review')}</th><th>{t('Distribution')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={9} style={{ padding: '14px 8px', color: 'var(--vg-text-muted)', fontSize: 12 }}>{emptyText}</td></tr>
              )}
              {shown.map((d) => (
                <tr key={d.id} onClick={() => open(d.id)} className="is-clickable" data-obsolete={d.withdrawn || undefined}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="vg-text-btn" style={{ fontSize: 12.5, color: 'var(--color-neutral-300)' }}
                      onClick={(e) => { e.stopPropagation(); open(d.id); }}>
                      {d.id}
                    </button>
                  </td>
                  <td style={{ fontWeight: 500, minWidth: 200, textWrap: 'pretty' }}>{d.title}</td>
                  <td style={{ color: muted, whiteSpace: 'nowrap' }}>{labelT(t)(d.typeLabel)}{d.subtype ? <span style={{ display: 'block', fontSize: 11 }}>{d.subtype}</span> : null}</td>
                  <td style={{ color: muted, whiteSpace: 'nowrap' }}>{d.processLabel}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {d.revInForce ? <span style={{ fontWeight: 500 }}>{d.revInForce}</span> : <span className="vg-muted">—</span>}
                    {canManage && d.revWorking && (
                      <span style={{ display: 'block', fontSize: 11, color: d.circuit ? TONE.warn.dot : 'var(--vg-text-muted)' }}>
                        {fill(d.circuit ? t('revision {rev} being approved') : t('revision {rev} in progress'), { rev: d.revWorking })}
                      </span>
                    )}
                  </td>
                  <td><ToneTag tone={d.statusTone} style={{ whiteSpace: 'nowrap' }}>{labelT(t)(d.statusLabel)}</ToneTag></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{d.owner}</td>
                  <td style={{ whiteSpace: 'nowrap', color: d.overdue ? TONE.danger.dot : d.dueSoon ? TONE.warn.dot : 'var(--color-neutral-300)' }}>
                    {d.nextReviewOn ? fmtDate(d.nextReviewOn) : '—'}
                    {d.overdue && <span style={{ display: 'block', fontSize: 11 }}>{fill(t('late · +{n} d'), { n: -(d.reviewDays ?? 0) })}</span>}
                    {d.dueSoon && <span style={{ display: 'block', fontSize: 11 }}>{d.reviewDays === 0 ? t('today#lower') : fill(t('in {n} d'), { n: d.reviewDays ?? 0 })}</span>}
                  </td>
                  <td style={{ color: muted, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.distribution || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!doc} onClose={() => open(null)} width={900} title={doc?.title ?? ''}
        kicker={doc ? `${doc.id} · ${labelT(t)(doc.typeLabel)} · ${doc.processLabel}` : undefined}>
        {doc && <DocumentPanel key={doc.id} doc={doc} canManage={canManage} actionForm={actionForm} suggestedDueOn={suggestedDueOn} />}
      </Dialog>
    </>
  );
}
