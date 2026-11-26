import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/PrintButton';
import { fmtDate } from '@/lib/dates';
import { guard } from '@/lib/guard';
import { loadSafetyTalk } from '@/lib/data/safety-talks';
import { fmtRate, safetyTalkHref } from '@/lib/rules/safety-talks';
import { today } from '@/lib/today';
import '../../print.css';
import { getI18n } from '@/i18n/server';
import { fill, type T } from '@/i18n/translate';

export async function generateMetadata({ params }: PageProps<'/prevention/imprimer/causerie/[id]'>): Promise<Metadata> {
  const { id } = await params;
  return { title: `Feuille d'émargement ${decodeURIComponent(id)}` };
}

const fmtLocal = (local: string, t: T) => fill(t('{date} at {time}'), { date: fmtDate(local.slice(0, 10)), time: local.slice(11, 16) });

// Feuille d'émargement imprimable d'une causerie sécurité (CNF-09) : participants et heures de signature dans Vigie ; une
// case à signer à la main pour ceux qui n'ont pas signé. Lecteurs de l'écran Prévention, site sélectionné et périmètre.
export default async function SafetyTalkPrintPage({ params }: PageProps<'/prevention/imprimer/causerie/[id]'>) {
  const session = await guard('prevention');
  const { t } = await getI18n();
  const { id } = await params;
  const talk = await loadSafetyTalk(decodeURIComponent(id));
  if (!talk) notFound();
  return (
    <article className="pp-doc">
      <div className="pp-toolbar pp-noprint">
        <a href={safetyTalkHref(talk.id)} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{t('Safety talk#short')}</a>
        <PrintButton />
      </div>
      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · {t('Prevention')} · {talk.id}</div>
        <div className="pp-head-row">
          <h1>{t('Attendance sheet · safety talk')}</h1>
          <span className="pp-muted" style={{ fontSize: 12.5 }}>{talk.site}</span>
        </div>
        <dl className="pp-meta">
          <dt>{t('Topic')}</dt><dd>{talk.theme}</dd>
          <dt>{t('Date and duration')}</dt><dd>{fmtDate(talk.heldOn)} · {talk.durationMinutes} min</dd>
          <dt>{t('Facilitator')}</dt><dd>{talk.animator}</dd>
          <dt>{t('Sign-off')}</dt><dd>{talk.participants.filter((p) => p.signedAt).length}/{talk.participants.length} ({fmtRate(talk.rate)})</dd>
          {talk.cancelled && <><dt>{t('Cancelled')}</dt><dd>{fill(t('on {date}'), { date: fmtDate(talk.cancelled.on) })}{fill(t(': {reason}'), { reason: talk.cancelled.reason })}</dd></>}
        </dl>
        {talk.notes && <p className="pp-text" style={{ whiteSpace: 'pre-line' }}>{talk.notes}</p>}
      </header>
      <section className="pp-section">
        <table className="table pp-table">
          <thead><tr><th>{t('Participant')}</th><th>{t('Signature')}</th></tr></thead>
          <tbody>
            {talk.participants.map((p) => (
              <tr key={p.personId}>
                <td>{p.name}</td>
                <td>{p.signedAt ? fill(t('Signed in Vigie on {date}'), { date: fmtLocal(p.signedAt, t) }) : <span className="pp-blank">{t('Signature')}</span>}</td>
              </tr>
            ))}
            {talk.participants.length === 0 && <tr><td colSpan={2} className="pp-empty">{t('No participant registered.')}</td></tr>}
          </tbody>
        </table>
      </section>
      <div className="pp-foot">Vigie · {fill(t('attendance sheet {id} · printed on {date} by {name}'), { id: talk.id, date: fmtDate(today()), name: session.user.name })}</div>
    </article>
  );
}
