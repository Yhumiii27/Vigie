import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DossierView } from '@/components/review/DossierView';
import { MissingNotice, ToneTag } from '@/components/ui';
import { fmtDate, yearOf } from '@/lib/dates';
import { canReadReviewDossier } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadReviewDossierPage } from '@/lib/data/review';
import { firstParam, missingDetail } from '@/lib/url-state';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';
import './dossier.css';

// Manifeste du signalement installable (EVT-20) : pages /signaler seulement.
export const metadata: Metadata = { title: 'Dossier de revue de direction', manifest: null };

// Dossier de la revue de direction (ISO 9001 §9.3), ouvert dans un nouvel onglet depuis /audits (?revue=<id>) :
// préparatoire tant que la revue n'est pas clôturée, figé ensuite.
export default async function ReviewDossierPage({ searchParams }: PageProps<'/revue-de-direction'>) {
  const session = await guard('audits');
  const { t } = await getI18n();
  const sp = await searchParams;
  // Dossier consolidé (données de tous les modules) : animateur QHSE et direction (AUD-02), seuls rôles qui saisissent sur
  // l'écran Audits. L'encadrement, qui consulte l'écran Audits, lit le compte rendu sur la carte et dans « Mes contributions »
  // (AUD-04) ; un rôle sans l'écran Audits (salarié) est renvoyé vers son écran d'accueil par guard().
  if (!canReadReviewDossier(session.role)) {
    const revue = typeof sp.revue === 'string' && /^\d+$/.test(sp.revue) ? sp.revue : null;
    redirect(`/audits/contributions${revue ? `?revue=${revue}` : ''}`);
  }
  const page = await loadReviewDossierPage({ revue: sp.revue });

  if (page.mode === 'none') {
    return (
      <main className="rd-doc">
        <div className="rd-toolbar rd-noprint">
          <a href="/audits" className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{t('Audits and certifications')}</a>
        </div>
        <section className="rd-section">
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>{t('No management review')}</h2>
          <p className="rd-empty rd-muted">{t('Plan the next review from the Audits and certifications screen to generate its file.')}</p>
        </section>
      </main>
    );
  }
  if (page.mode === 'cancelled') {
    const { cancel, review } = page;
    return (
      <main className="rd-doc">
        <div className="rd-toolbar rd-noprint">
          <a href={`/audits?annee=${yearOf(review.reviewOn)}&revue=${review.id}#revue`} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{t('Audits and certifications')}</a>
          <ToneTag tone={review.statusTone} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i className="ph ph-x-circle" style={{ fontSize: 12 }} aria-hidden />{review.statusLabel}</ToneTag>
        </div>
        <section className="rd-section">
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>{fill(t('{kind} of {date} — cancelled'), { kind: cancel.kind, date: fmtDate(review.reviewOn) })}</h2>
          <p className="rd-text">
            {fill(t('Cancelled on {date}'), { date: cancel.on ? fmtDate(cancel.on) : '—' })}{cancel.by ? fill(t(' by {name}'), { name: cancel.by }) : ''}.
            {cancel.reason && <><br /><span className="rd-muted">{t('Reason: ')}</span>{cancel.reason}</>}
          </p>
          <p className="rd-empty rd-muted">{t('A cancelled review has no file: its checklist stays viewable in the history of the reviews (Audits and certifications screen).')}</p>
        </section>
      </main>
    );
  }
  // UX-13 : ?revue=<id> inconnu → dossier de la revue en cours, avec le bandeau commun (jamais de repli silencieux).
  const missing = missingDetail(sp.revue, String(page.review.id) === firstParam(sp.revue));
  const notice = missing ? <MissingNotice text={t('Review not found: the file of the current review is shown.')} closeHref={`/revue-de-direction?revue=${page.review.id}`} /> : null;
  return <DossierView page={page} role={session.role} notice={notice} t={t} />;
}
