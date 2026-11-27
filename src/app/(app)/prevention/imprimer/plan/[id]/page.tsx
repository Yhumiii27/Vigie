import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PrintButton } from '@/components/PrintButton';
import { EE_HEADCOUNT, PERMIT_TYPES, PLAN_CONTENT, PLAN_CONTENT_GROUPS } from '@/lib/rules/prevention';
import { fmtDate } from '@/lib/dates';
import type { PlanFormView, PlanView } from '@/lib/data/prevention';
import { today } from '@/lib/today';
import { guard } from '@/lib/guard';
import { loadPrevention } from '@/lib/data/prevention';
import '../../print.css';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';

export async function generateMetadata({ params }: PageProps<'/prevention/imprimer/plan/[id]'>): Promise<Metadata> {
  const [{ id }, { t }] = await Promise.all([params, getI18n()]);
  return { title: fill(t('Prevention plan {id}'), { id: decodeURIComponent(id) }) };
}

function Section({ num, title, children }: { num: number | string; title: string; children: ReactNode }) {
  return (
    <section className="pp-section">
      <h2><span className="pp-num">{num}</span>{title}</h2>
      {children}
    </section>
  );
}

/** Section du contenu réglementaire (R. 4512-8 1° à 5°, R. 4512-9) : intitulé, référence, texte ou « Non renseigné ». */
async function ContentBlock({ plan, field }: { plan: PlanView; field: (typeof PLAN_CONTENT)[number] }) {
  const { t } = await getI18n();
  const value = plan[field.key];
  return (
    <div className="pp-sub">
      <h3>{field.label} <span className="pp-ref">· {field.ref}</span></h3>
      {value ? <p className="pp-text">{value}</p> : <p className="pp-empty">{t('Not entered.')}</p>}
    </div>
  );
}

/** Annexe : réponses du formulaire importé (form_data), cases cochées ☑ ou non ☐ et valeurs saisies. */
async function ImportedFormAnnex({ form }: { form: PlanFormView }) {
  const { t } = await getI18n();
  return (
    <Section num={t('Appendix')} title={t('Imported form')}>
      <Meta rows={[[t('File'), form.fileName], [t('Format'), form.formatLabel], [t('Imported on'), form.importedOn ?? '—']]} />
      {form.sections.length === 0
        ? <p className="pp-empty">{t('No answer recorded.')}</p>
        : form.sections.map((sec, i) => (
          <div key={`${i}-${sec.title}`} className="pp-sub">
            {sec.title && <h3>{sec.title}</h3>}
            {sec.items.map((item, j) => (
              <div key={`${j}-${item.label}`} className={`pp-check${item.checked === false ? ' pp-check-off' : ''}`}>
                <span className="pp-check-box" aria-hidden>{item.checked === true ? '☑' : item.checked === false ? '☐' : '·'}</span>
                <span>
                  {item.label}
                  {item.value && <span className="pp-check-value">{item.value}</span>}
                </span>
              </div>
            ))}
          </div>
        ))}
    </Section>
  );
}

const Meta = ({ rows }: { rows: [string, ReactNode][] }) => (
  <dl className="pp-meta">
    {rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
  </dl>
);

/** Cadre de signature (PRV-07) : signataire (nom, qualité) et date enregistrés, sinon lignes à remplir. */
async function SignatureBox({ title, who, signedOn, signer }: { title: string; who: string; signedOn: string | null; signer: { name: string; quality: string | null } | null }) {
  const { t } = await getI18n();
  return (
    <div>
      <span className="pp-sign-title">{title}</span>
      <span className="pp-muted">{who}</span>
      {signedOn
        ? (
          <>
            {signer ? <span>{signer.name}{signer.quality ? ` · ${signer.quality}` : ''}</span> : [t('Name'), t('Capacity')].map((l) => <span key={l} className="pp-blank">{l}</span>)}
            <span>{fill(t('Signed on {date}'), { date: fmtDate(signedOn) })}</span>
          </>
        )
        : [t('Name'), t('Capacity'), t('Date'), t('Signature')].map((l) => <span key={l} className="pp-blank">{l}</span>)}
    </div>
  );
}

// Plan de prévention imprimable (R. 4512-6 à R. 4512-12), ouvert dans un nouvel onglet depuis la fiche du plan.
export default async function PlanPrintPage({ params }: PageProps<'/prevention/imprimer/plan/[id]'>) {
  await guard('prevention');
  const { t } = await getI18n();
  const { id } = await params;
  const d = await loadPrevention();
  const plan = d.plans.find((p) => p.id === decodeURIComponent(id));
  if (!plan) notFound();
  const c = plan.contractorContact;
  const gap = plan.startGap;

  return (
    <article className="pp-doc pp-doc-narrow">
      <div className="pp-toolbar pp-noprint">
        {/* Lien HTML simple (navigation complète) : la feuille print.css ne doit pas rester chargée dans l'application. */}
        <a href={`/prevention?plan=${encodeURIComponent(plan.id)}`} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{fill(t('Plan {id}'), { id: plan.id })}</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="pp-muted" style={{ fontSize: 11.5 }}>{t('For the PDF: “Save as PDF” in the print dialog.')}</span>
          <PrintButton />
        </span>
      </div>

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · {t('Prevention plan')}</div>
        <div className="pp-head-row">
          <h1>{plan.id} · {plan.title}</h1>
          <span className="tag tag-neutral">{plan.statusLabel}</span>
        </div>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>
          {t('French Labour Code, articles R. 4512-6 to R. 4512-12')} · {fill(t('printed on {date}'), { date: fmtDate(today()) })}
          {plan.cancelled && `${fill(t(' · plan cancelled on {date}'), { date: plan.cancelled.on })}${plan.cancelled.reason ? fill(t(': {reason}'), { reason: plan.cancelled.reason }) : ''}`}
        </div>
        {gap && (
          <div className="pp-banner pp-banner-danger">
            {t('R. 4512-6 gap')}{t(':#sep')} {gap.signedOn
              ? fill(t('plan signed by both companies on {date}, after the start of the intervention ({start})'), { date: fmtDate(gap.signedOn), start: fmtDate(plan.startOn) })
              : fill(t('intervention started on {start} without a plan signed by both companies'), { start: fmtDate(plan.startOn) })}
            {gap.past ? '.' : t(' (gap in progress).')}
          </div>
        )}
      </header>

      <Section num={1} title={t('Companies')}>
        <div className="pp-parties">
          <div style={{ display: 'grid', gap: 6 }}>
            <h3 className="pp-h3">{t('Host company')}</h3>
            <Meta rows={[[t('Site'), plan.site], [t('Owner'), plan.owner ?? '—']]} />
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <h3 className="pp-h3">{t('External company')}</h3>
            <Meta rows={[
              [t('Company name'), plan.contractor],
              [t('Trade'), plan.contractorTrade || '—'],
              [t('Contact'), c.name ?? '—'],
              [t('Phone'), c.phone ?? '—'],
              [t('E-mail'), c.email ?? '—'],
              [t('Manager of the intervention'), plan.eeSupervisor || '—'],
              [EE_HEADCOUNT.label, plan.eeHeadcount != null ? fill(plan.eeHeadcount > 1 ? t('{n} people') : t('{n} person'), { n: plan.eeHeadcount }) : '—'],
              [t('Subcontractors'), plan.subcontracting || '—'],
            ]} />
          </div>
        </div>
      </Section>

      <Section num={2} title={t('Intervention')}>
        <Meta rows={[
          [t('Nature of the work'), plan.title],
          [t('Location'), plan.location],
          [t('Period'), fill(t('from {from} to {to}'), { from: fmtDate(plan.startOn), to: fmtDate(plan.endOn) })],
          [t('Hours over 12 months'), `${plan.estimatedHours} h`],
          [t('Dangerous work'), plan.dangerousWork ? t('Yes (order of 19 March 1993)') : t('No')],
          [t('Written plan'), plan.mandatory ? `${t('Required')} · ${plan.mandatoryReason}` : t('Not required (less than 400 h over 12 months, no dangerous work)')],
          [t('Keystone project'), plan.keystoneProject ?? '—'],
        ]} />
      </Section>

      <Section num={3} title={t('Prior joint inspection')}>
        <p className="pp-text">
          {plan.inspectionOn
            ? `${fill(plan.inspectionDone ? t('Carried out on {date}') : t('Planned for {date}'), { date: fmtDate(plan.inspectionOn) })}${t(': joint visit of the workplaces, installations and equipment.')}`
            : t('Not carried out.')}
        </p>
      </Section>

      <Section num={4} title={t('Interference risks')}>
        {plan.interferenceRisks ? <p className="pp-text">{plan.interferenceRisks}</p> : <p className="pp-empty">{t('Not entered#mplural')}</p>}
      </Section>

      <Section num={5} title={`${t('Prevention measures')} (${PLAN_CONTENT_GROUPS.measures.ref})`}>
        <div className="pp-sub">
          <h3>{t('Split of the measures between the host company and the external company')}</h3>
          {plan.measures ? <p className="pp-text">{plan.measures}</p> : <p className="pp-empty">{t('Not entered#fplural')}</p>}
        </div>
        {PLAN_CONTENT.filter((f) => f.group === 'measures').map((f) => <ContentBlock key={f.key} plan={plan} field={f} />)}
      </Section>

      <Section num={6} title={`${PLAN_CONTENT_GROUPS.sir.label} (${PLAN_CONTENT_GROUPS.sir.ref})`}>
        {PLAN_CONTENT.filter((f) => f.group === 'sir').map((f) => <ContentBlock key={f.key} plan={plan} field={f} />)}
      </Section>

      <Section num={7} title={t('Linked permits')}>
        {plan.permits.length === 0
          ? <p className="pp-empty">{t('No fire permit or test permit linked.')}</p>
          : (
            <table className="table pp-table">
              <thead><tr><th>{t('Ref.')}</th><th>{t('Type')}</th><th>{t('Validity')}</th><th>{t('Status')}</th></tr></thead>
              <tbody>
                {plan.permits.map((p) => (
                  <tr key={p.id}><td className="pp-nowrap">{p.id}</td><td>{labelT(t)(PERMIT_TYPES[p.type].label)}</td><td className="pp-nowrap">{p.validity}</td><td>{p.stateLabel}</td></tr>
                ))}
              </tbody>
            </table>
          )}
      </Section>

      <Section num={8} title={t('Signatures')}>
        <p className="pp-muted" style={{ margin: 0, fontSize: 12 }}>{t('The plan is agreed by common consent after the joint inspection and signed by both companies before the work starts.')}</p>
        <div className="pp-sign">
          <SignatureBox title={t('For the host company')} who={plan.site} signedOn={plan.signedEuOn} signer={plan.signedEu} />
          <SignatureBox title={t('For the external company')} who={plan.contractor} signedOn={plan.signedEeOn} signer={plan.signedEe} />
        </div>
      </Section>

      {plan.form && <ImportedFormAnnex form={plan.form} />}

      <div className="pp-foot">Vigie · {plan.id} · {fill(t('document printed on {date}'), { date: fmtDate(today()) })} · {t('to keep with the inspection reports and the amendments')}</div>
    </article>
  );
}
