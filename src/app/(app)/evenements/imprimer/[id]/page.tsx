import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PrintButton } from '@/components/PrintButton';
import { fmtDate } from '@/lib/dates';
import { canSeeHealth } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadDatPrint } from '@/lib/data/events';
import { today } from '@/lib/today';
import { getI18n } from '@/i18n/server';
import { msgT } from '@/i18n/msg';
import { labelT } from '@/i18n/labels';
import { fill, type T } from '@/i18n/translate';
import '../../../prevention/imprimer/print.css';

export async function generateMetadata({ params }: PageProps<'/evenements/imprimer/[id]'>): Promise<Metadata> {
  const [{ id }, { t }] = await Promise.all([params, getI18n()]);
  return { title: fill(t('Accident declaration {id}'), { id: decodeURIComponent(id) }) };
}

function Section({ num, title, children }: { num: number | string; title: string; children: ReactNode }) {
  return (
    <section className="pp-section">
      <h2><span className="pp-num">{num}</span>{title}</h2>
      {children}
    </section>
  );
}

const Meta = ({ rows }: { rows: [string, ReactNode][] }) => (
  <dl className="pp-meta">
    {rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v ?? '—'}</dd></div>)}
  </dl>
);
const Text = ({ value, empty }: { value: string | null; empty: string }) =>
  (value ? <p className="pp-text">{value}</p> : <p className="pp-empty">{empty}</p>);
/** « AAAA-MM-JJTHH:mm » → « 08/09/2026 à 16:10 ». */
const fmtLocal = (local: string, t: T) => fill(t('{date} at {time}'), { date: fmtDate(local.slice(0, 10)), time: local.slice(11, 16) });

// Synthèse imprimable d'un accident du travail (EVT-10) : rubriques de la déclaration d'accident du travail à reporter sur
// net-entreprises.fr (Cerfa 14463), puis feuille d'accident à remettre à la victime (Cerfa 11383, art. L. 441-5 CSS). Données
// de santé : animateur QHSE et direction seulement (HEALTH_PAGES, src/lib/auth/route-access.ts), consultation tracée.
export default async function DatPrintPage({ params }: PageProps<'/evenements/imprimer/[id]'>) {
  const session = await guard('events');
  const { t } = await getI18n();
  const l = labelT(t);
  const notEntered = t('Not entered.');
  if (!canSeeHealth(session.role)) redirect('/evenements');
  const { id } = await params;
  const d = await loadDatPrint(decodeURIComponent(id));
  if (!d) notFound();
  const back = `/evenements?sel=${encodeURIComponent(d.id)}`;

  return (
    <article className="pp-doc pp-doc-narrow">
      <div className="pp-toolbar pp-noprint">
        {/* Lien HTML simple (navigation complète) : la feuille print.css ne doit pas rester chargée dans l'application. */}
        <a href={back} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{fill(t('Event {id}'), { id: d.id })}</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="pp-muted" style={{ fontSize: 11.5 }}>{t('For the PDF: “Save as PDF” in the print dialog.')}</span>
          <PrintButton />
        </span>
      </div>

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>{t('Vigie · Work accident · confidential document (health data)')}</div>
        <div className="pp-head-row">
          <h1>{d.id} · {d.commute ? t('Commuting accident declaration') : t('Work accident declaration')}</h1>
        </div>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>
          {fill(t('Summary of the items to enter on net-entreprises.fr (Cerfa form 14463) · social security code, art. L. 441-2 and R. 441-3 · printed on {date}'), { date: fmtDate(today()) })}
        </div>
        {d.duty !== 'cpam' && (
          <p className="pp-muted" style={{ margin: 0, fontSize: 12 }}>
            {d.duty === 'ett'
              ? t('Temporary worker victim: the temporary work agency declares the accident; this summary is used to inform it (R. 412-2).')
              : t('External victim: their employer declares the accident; this summary is used to inform them.')}
          </p>
        )}
      </header>

      <Section num={1} title={t('Employer · establishment')}>
        <Meta rows={[[t('Establishment'), d.site.label], ['SIRET', d.site.siret ?? t('To fill in (Manage sites)')]]} />
      </Section>

      <Section num={2} title={t('Victim')}>
        <Meta rows={[[t('Name'), d.victim.label], [t('Status'), l(d.victim.kind)], [t('Job#dat'), d.victim.job ?? '—'], ...(d.victim.company ? [[t('Company'), d.victim.company] as [string, ReactNode]] : [])]} />
      </Section>

      <Section num={3} title={t('Accident')}>
        <Meta rows={[
          [t('Date and time'), d.occurredTime ? fill(t('{date} at {time}'), { date: fmtDate(d.occurredOn), time: d.occurredTime }) : fmtDate(d.occurredOn)],
          [t('Nature'), d.commute ? t('Commuting accident (L. 411-2)') : t('Work accident (L. 411-1)')],
          [t('Location'), d.location],
          [t('Working hours that day'), d.workSchedule ?? '—'],
          [t('Known to the employer on'), `${fmtLocal(d.knownAt, t)}${d.knownIsDefault ? t(' (recorded in Vigie)') : ''}`],
          [t('Object or equipment involved'), d.equipment ?? '—'],
        ]} />
        <div className="pp-sub"><h3>{t('Activity of the victim at the time of the accident')}</h3><Text value={d.activity} empty={notEntered} /></div>
        <div className="pp-sub"><h3>{t('Detailed circumstances')}</h3><Text value={d.circumstances} empty={notEntered} /></div>
      </Section>

      <Section num={4} title={t('Lesions and care')}>
        <Meta rows={[
          [t('Nature of the lesions'), d.lesionNature ?? '—'], [t('Site of the lesions'), d.lesionSite ?? '—'],
          [t('Consequences'), d.lostDays != null ? `${l(d.injury)} · ${fill(d.lostDays > 1 ? t('{n} days lost') : t('{n} day lost'), { n: d.lostDays })}` : l(d.injury)],
        ]} />
        <div className="pp-sub"><h3>{t('Care given')}</h3><Text value={d.careGiven} empty={notEntered} /></div>
      </Section>

      <Section num={5} title={t('Witnesses and third parties')}>
        <div className="pp-sub"><h3>{t('Witnesses')}</h3><Text value={d.witnesses} empty={t('No witness given.')} /></div>
        <div className="pp-sub"><h3>{t('Third party involved')}</h3><Text value={d.thirdParty} empty={t('None.#m')} /></div>
      </Section>

      <Section num={6} title={t('Declaration')}>
        <Meta rows={[
          [t('CPAM declaration'), d.cpam ? msgT(t)(d.cpam.text) : '—'],
          ...(d.cpam?.reserves ? [[t('Reasoned reservations'), msgT(t)(d.cpam.reserves.text)] as [string, ReactNode]] : []),
        ]} />
      </Section>

      <section className="pp-section" style={{ breakBefore: 'page' }}>
        <h2><span className="pp-num">7</span>{t('Work accident sheet · to hand to the victim')}</h2>
        <p className="pp-muted" style={{ margin: 0, fontSize: 12 }}>
          {t('The employer hands the victim the accident sheet (Cerfa 11383), which entitles them to free care related to the accident (art. L. 441-5 of the social security code). Copy these items onto the official form.')}
        </p>
        <Meta rows={[
          [t('Victim'), d.victim.label],
          [t('Employer'), `${d.site.label}${d.site.siret ? ` · SIRET ${d.site.siret}` : ''}`],
          [t('Date of the accident'), fmtDate(d.occurredOn)],
          [t('Internal reference'), d.id],
        ]} />
        <div className="pp-sign">
          <div>
            <span className="pp-sign-title">{t('Handing over of the accident sheet')}</span>
            {[t('Handed over on'), t('By (name and position)'), t('Signature')].map((x) => <span key={x} className="pp-blank">{x}</span>)}
          </div>
          <div>
            <span className="pp-sign-title">{t('Victim')}</span>
            {[t('Received on#f'), t('Signature')].map((x, i) => <span key={`${i}-${x}`} className="pp-blank">{x}</span>)}
          </div>
        </div>
      </section>
      <p className="pp-foot">{t('Confidential document: health data reserved to the QHSE coordinator and management.')}</p>
    </article>
  );
}
