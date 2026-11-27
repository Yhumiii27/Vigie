import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PrintButton } from '@/components/PrintButton';
import { FIRE_WATCH_HOURS, fmtLocalLong } from '@/lib/rules/prevention';
import { fmtDate } from '@/lib/dates';
import { today } from '@/lib/today';
import { guard } from '@/lib/guard';
import { loadPrevention, type PermitView } from '@/lib/data/prevention';
import '../../print.css';
import { getI18n } from '@/i18n/server';
import { fill, type T } from '@/i18n/translate';

export async function generateMetadata({ params }: PageProps<'/prevention/imprimer/permis/[id]'>): Promise<Metadata> {
  const [{ id }, { t }] = await Promise.all([params, getI18n()]);
  return { title: fill(t('Permit {id}'), { id: decodeURIComponent(id) }) };
}

function Section({ num, title, aside, children }: { num: number; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="pp-section">
      <h2><span className="pp-num">{num}</span>{title}{aside && <span className="pp-muted" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 400 }}>{aside}</span>}</h2>
      {children}
    </section>
  );
}

const Meta = ({ rows }: { rows: ([string, ReactNode] | null)[] }) => (
  <dl className="pp-meta">
    {rows.filter((r): r is [string, ReactNode] => !!r).map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
  </dl>
);

/** Case de visa à remplir à la main (nom, heure, signature…). */
function VisaBox({ title, who, fields }: { title: string; who?: string | null; fields: string[] }) {
  return (
    <div>
      <span className="pp-sign-title">{title}</span>
      {who && <span>{who}</span>}
      {fields.map((l) => <span key={l} className="pp-blank">{l}</span>)}
    </div>
  );
}

/** Bandeau d'état : ce que vaut le document imprimé (à afficher, ou sans valeur d'autorisation). */
function banner(p: PermitView, t: T): { tone: 'ok' | 'danger' | 'neutral'; text: string } {
  switch (p.state) {
    case 'delivre':
    case 'en_cours':
      return { tone: 'ok', text: t('Permit issued: to display at the work place for their whole duration') };
    case 'demande':
      return { tone: 'danger', text: t('Request not issued: this document is not a work authorisation') };
    case 'expire':
      return {
        tone: 'danger',
        text: p.status === 'demande'
          ? t('Request lapsed, never issued: this document is not a work authorisation')
          : fill(t('Permit expired on {date} without closure: work not authorised beyond the validity'), { date: fmtLocalLong(p.watchUntil ?? p.validTo) }),
      };
    case 'clos':
      return { tone: 'neutral', text: `${t('Permit closed')}${p.closedLabel ? fill(t(' on {date}'), { date: p.closedLabel }) : ''}${t(': work finished')}` };
    case 'annule':
      return {
        tone: 'danger',
        text: `${t('Permit cancelled')}${p.closedLabel ? fill(t(' on {date}'), { date: p.closedLabel }) : ''}${p.cancelledBy ? fill(t(' by {name}'), { name: p.cancelledBy }) : ''}${t(': this document is not a work authorisation')}`
          + `${p.cancelReason ? fill(t(' (reason: {reason})'), { reason: p.cancelReason }) : ''}`,
      };
  }
}

// Fiche imprimable d'un permis de feu ou d'essai (PRV-03), à afficher sur le lieu des travaux ; ouverte dans un nouvel
// onglet depuis la fiche du permis. Permis du site sélectionné seulement (mêmes données que l'écran).
export default async function PermitPrintPage({ params }: PageProps<'/prevention/imprimer/permis/[id]'>) {
  await guard('prevention');
  const { t } = await getI18n();
  const { id } = await params;
  const d = await loadPrevention();
  const permit = d.permits.find((p) => p.id === decodeURIComponent(id));
  if (!permit) notFound();
  const state = banner(permit, t);
  const checked = permit.checklist.filter((i) => i.checked).length;
  const fire = permit.type === 'feu';
  const printedOn = fmtDate(today());

  return (
    <article className="pp-doc pp-doc-narrow">
      <div className="pp-toolbar pp-noprint">
        {/* Lien HTML simple (navigation complète) : la feuille print.css ne doit pas rester chargée dans l'application. */}
        <a href={`/prevention?onglet=permis&permis=${encodeURIComponent(permit.id)}`} className="btn btn-ghost vg-btn-sm">
          <i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{fill(t('Permit {id}'), { id: permit.id })}
        </a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="pp-muted" style={{ fontSize: 11.5 }}>{t('For the PDF: “Save as PDF” in the print dialog.')}</span>
          <PrintButton />
        </span>
      </div>

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · {permit.typeLabel}</div>
        <div className="pp-head-row">
          <h1>{permit.id} · {permit.location}</h1>
          <span className="tag tag-neutral">{permit.stateLabel}</span>
        </div>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>{permit.site} · {fill(t('printed on {date}'), { date: printedOn })}</div>
        <div className={`pp-banner${state.tone === 'neutral' ? '' : ` pp-banner-${state.tone}`}`}>{state.text}</div>
      </header>

      <Section num={1} title={t('Work')}>
        <Meta rows={[
          [t('Work'), permit.description],
          [t('Location'), permit.location],
          [t('Site'), permit.site],
          [t('Company'), permit.contractor ?? t('Internal intervention')],
          [t('Worker(s)'), permit.performer],
          [t('Prevention plan'), permit.plan
            ? `${permit.plan.id} · ${permit.plan.signed ? t('signed') : t('not signed')} · ${permit.plan.period}`
            : permit.planRequired ? t('None (signed plan required)') : '—'],
          [t('Keystone project'), permit.keystoneProject ?? '—'],
        ]} />
      </Section>

      <Section num={2} title={t('Validity')}>
        <Meta rows={[
          [t('From#date'), fmtLocalLong(permit.validFrom)],
          [t('To#date'), fmtLocalLong(permit.validTo)],
          permit.watchUntil ? [fire ? fill(t('Watch ({n} h) until'), { n: FIRE_WATCH_HOURS }) : t('Watch until'), fmtLocalLong(permit.watchUntil)] : null,
          [t('Issued by'), permit.issuer
            ? `${permit.issuer}${permit.deliveredLabel ? fill(t(' on {date}'), { date: permit.deliveredLabel }) : ''}`
            : permit.status === 'demande' ? t('Not issued') : '—'],
        ]} />
      </Section>

      <Section num={3} title={t('Prior checks')} aside={fill(t('{done}/{total} checked'), { done: checked, total: permit.checklist.length })}>
        {permit.checklist.length === 0
          ? <p className="pp-empty">{t('No check point.')}</p>
          : (
            <div className="pp-checklist">
              {permit.checklist.map((item, i) => (
                <div key={`${i}-${item.label}`} className={`pp-check${item.checked ? '' : ' pp-check-off'}`}>
                  <span className="pp-check-box" aria-hidden>{item.checked ? '☑' : '☐'}</span>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          )}
      </Section>

      {/* PRV-22 : consignations et isolations du permis (annulées exclues). */}
      {permit.lockouts.some((l) => l.status !== 'annulee') && (
        <Section num={4} title={t('Lockouts')}>
          <table className="table pp-table">
            <thead><tr><th>{t('Lockout')}</th><th>{t('Isolation points')}</th><th>{t('Applier · verifier')}</th><th>{t('State')}</th></tr></thead>
            <tbody>
              {permit.lockouts.filter((l) => l.status !== 'annulee').map((l) => (
                <tr key={l.id}>
                  <td>{l.id} · {l.energyLabel}<div className="pp-muted">{l.equipment}</div></td>
                  <td>{l.points.map((p) => (p.device ? `${p.label} (${p.device})` : p.label)).join(' ; ')}</td>
                  <td>{l.applier} · {l.verifier}</td>
                  <td>{l.statusLabel}{l.verifiedLabel ? <div className="pp-muted">{fill(t('verified on {date}'), { date: l.verifiedLabel })}</div> : null}{l.removedLabel ? <div className="pp-muted">{fill(t('removed on {date}'), { date: l.removedLabel })}</div> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section num={permit.lockouts.some((l) => l.status !== 'annulee') ? 5 : 4} title={t('Approvals')}>
        <div className="pp-sign">
          <VisaBox title={t('Issued by')} who={permit.issuer} fields={[t('Signature')]} />
          <VisaBox title={t('Worker(s): instructions received')} fields={[t('Name'), t('Signature')]} />
          <VisaBox title={t('End of the work')} fields={[t('Time'), t('Approval')]} />
          {fire
            ? <VisaBox title={fill(t('End of watch (round, {n} h)'), { n: FIRE_WATCH_HOURS })} fields={[t('Time'), t('Approval')]} />
            : <VisaBox title={t('Zone made safe again')} fields={[t('Time'), t('Approval')]} />}
        </div>
      </Section>

      <div className="pp-foot">Vigie · {permit.typeLabel.toLowerCase()} {permit.id} · {permit.site} · {fill(t('document printed on {date}'), { date: printedOn })}</div>
    </article>
  );
}
