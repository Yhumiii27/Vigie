import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PrintButton } from '@/components/PrintButton';
import { EE_HEADCOUNT, PERMIT_TYPES, PLAN_CONTENT, PLAN_CONTENT_GROUPS } from '@/components/prevention/model';
import { fmtDate } from '@/lib/dates';
import type { PlanFormView, PlanView } from '@/lib/data/prevention';
import { today } from '@/lib/today';
import { guard } from '@/lib/guard';
import { loadPrevention } from '@/lib/data/prevention';
import '../../print.css';

export async function generateMetadata({ params }: PageProps<'/prevention/imprimer/plan/[id]'>): Promise<Metadata> {
  const { id } = await params;
  return { title: `Plan de prévention ${decodeURIComponent(id)}` };
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
function ContentBlock({ plan, field }: { plan: PlanView; field: (typeof PLAN_CONTENT)[number] }) {
  const value = plan[field.key];
  return (
    <div className="pp-sub">
      <h3>{field.label} <span className="pp-ref">· {field.ref}</span></h3>
      {value ? <p className="pp-text">{value}</p> : <p className="pp-empty">Non renseigné.</p>}
    </div>
  );
}

/** Annexe : réponses du formulaire importé (form_data), cases cochées ☑ ou non ☐ et valeurs saisies. */
function ImportedFormAnnex({ form }: { form: PlanFormView }) {
  return (
    <Section num="Annexe" title="Formulaire importé">
      <Meta rows={[['Fichier', form.fileName], ['Format', form.formatLabel], ['Importé le', form.importedOn ?? '—']]} />
      {form.sections.length === 0
        ? <p className="pp-empty">Aucune réponse enregistrée.</p>
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
function SignatureBox({ title, who, signedOn, signer }: { title: string; who: string; signedOn: string | null; signer: { name: string; quality: string | null } | null }) {
  return (
    <div>
      <span className="pp-sign-title">{title}</span>
      <span className="pp-muted">{who}</span>
      {signedOn
        ? (
          <>
            {signer ? <span>{signer.name}{signer.quality ? ` · ${signer.quality}` : ''}</span> : ['Nom', 'Qualité'].map((l) => <span key={l} className="pp-blank">{l}</span>)}
            <span>Signé le {fmtDate(signedOn)}</span>
          </>
        )
        : ['Nom', 'Qualité', 'Date', 'Signature'].map((l) => <span key={l} className="pp-blank">{l}</span>)}
    </div>
  );
}

// Plan de prévention imprimable (R. 4512-6 à R. 4512-12), ouvert dans un nouvel onglet depuis la fiche du plan.
export default async function PlanPrintPage({ params }: PageProps<'/prevention/imprimer/plan/[id]'>) {
  await guard('prevention');
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
        <a href={`/prevention?plan=${encodeURIComponent(plan.id)}`} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />Plan {plan.id}</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="pp-muted" style={{ fontSize: 11.5 }}>Pour le PDF : « Enregistrer au format PDF » dans la boîte d&apos;impression.</span>
          <PrintButton />
        </span>
      </div>

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · Plan de prévention</div>
        <div className="pp-head-row">
          <h1>{plan.id} · {plan.title}</h1>
          <span className="tag tag-neutral">{plan.statusLabel}</span>
        </div>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>
          Code du travail, articles R. 4512-6 à R. 4512-12 · édité le {fmtDate(today())}
          {plan.cancelled && ` · plan annulé le ${plan.cancelled.on}${plan.cancelled.reason ? ` : ${plan.cancelled.reason}` : ''}`}
        </div>
        {gap && (
          <div className="pp-banner pp-banner-danger">
            Écart R. 4512-6 : {gap.signedOn
              ? `plan signé par les deux entreprises le ${fmtDate(gap.signedOn)}, après le début de l'intervention (${fmtDate(plan.startOn)})`
              : `intervention commencée le ${fmtDate(plan.startOn)} sans plan signé par les deux entreprises`}
            {gap.past ? '.' : ' (écart en cours).'}
          </div>
        )}
      </header>

      <Section num={1} title="Entreprises">
        <div className="pp-parties">
          <div style={{ display: 'grid', gap: 6 }}>
            <h3 className="pp-h3">Entreprise utilisatrice</h3>
            <Meta rows={[['Site', plan.site], ['Responsable', plan.owner ?? '—']]} />
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <h3 className="pp-h3">Entreprise extérieure</h3>
            <Meta rows={[
              ['Raison sociale', plan.contractor],
              ['Corps de métier', plan.contractorTrade || '—'],
              ['Interlocuteur', c.name ?? '—'],
              ['Téléphone', c.phone ?? '—'],
              ['E-mail', c.email ?? '—'],
              ["Responsable de l'intervention", plan.eeSupervisor || '—'],
              [EE_HEADCOUNT.label, plan.eeHeadcount != null ? `${plan.eeHeadcount} ${plan.eeHeadcount > 1 ? 'personnes' : 'personne'}` : '—'],
              ['Sous-traitants', plan.subcontracting || '—'],
            ]} />
          </div>
        </div>
      </Section>

      <Section num={2} title="Intervention">
        <Meta rows={[
          ['Nature des travaux', plan.title],
          ['Lieu', plan.location],
          ['Période', `du ${fmtDate(plan.startOn)} au ${fmtDate(plan.endOn)}`],
          ['Heures sur 12 mois', `${plan.estimatedHours} h`],
          ['Travaux dangereux', plan.dangerousWork ? 'Oui (arrêté du 19 mars 1993)' : 'Non'],
          ['Plan écrit', plan.mandatory ? `Obligatoire · ${plan.mandatoryReason}` : 'Non obligatoire (moins de 400 h sur 12 mois, sans travaux dangereux)'],
          ['Projet Keystone', plan.keystoneProject ?? '—'],
        ]} />
      </Section>

      <Section num={3} title="Inspection commune préalable">
        <p className="pp-text">
          {plan.inspectionOn
            ? `${plan.inspectionDone ? 'Réalisée le' : 'Prévue le'} ${fmtDate(plan.inspectionOn)} : visite conjointe des lieux de travail, des installations et des matériels.`
            : 'Non réalisée.'}
        </p>
      </Section>

      <Section num={4} title="Risques d'interférence">
        {plan.interferenceRisks ? <p className="pp-text">{plan.interferenceRisks}</p> : <p className="pp-empty">Non renseignés.</p>}
      </Section>

      <Section num={5} title={`Mesures de prévention (${PLAN_CONTENT_GROUPS.measures.ref})`}>
        <div className="pp-sub">
          <h3>Répartition des mesures entre l&apos;entreprise utilisatrice et l&apos;entreprise extérieure</h3>
          {plan.measures ? <p className="pp-text">{plan.measures}</p> : <p className="pp-empty">Non renseignées.</p>}
        </div>
        {PLAN_CONTENT.filter((f) => f.group === 'measures').map((f) => <ContentBlock key={f.key} plan={plan} field={f} />)}
      </Section>

      <Section num={6} title={`${PLAN_CONTENT_GROUPS.sir.label} (${PLAN_CONTENT_GROUPS.sir.ref})`}>
        {PLAN_CONTENT.filter((f) => f.group === 'sir').map((f) => <ContentBlock key={f.key} plan={plan} field={f} />)}
      </Section>

      <Section num={7} title="Permis rattachés">
        {plan.permits.length === 0
          ? <p className="pp-empty">Aucun permis de feu ni permis d&apos;essai rattaché.</p>
          : (
            <table className="table pp-table">
              <thead><tr><th>Réf.</th><th>Type</th><th>Validité</th><th>Statut</th></tr></thead>
              <tbody>
                {plan.permits.map((p) => (
                  <tr key={p.id}><td className="pp-nowrap">{p.id}</td><td>{PERMIT_TYPES[p.type].label}</td><td className="pp-nowrap">{p.validity}</td><td>{p.stateLabel}</td></tr>
                ))}
              </tbody>
            </table>
          )}
      </Section>

      <Section num={8} title="Signatures">
        <p className="pp-muted" style={{ margin: 0, fontSize: 12 }}>Le plan est arrêté d&apos;un commun accord après l&apos;inspection commune et signé par les deux entreprises avant le début des travaux.</p>
        <div className="pp-sign">
          <SignatureBox title="Pour l'entreprise utilisatrice" who={plan.site} signedOn={plan.signedEuOn} signer={plan.signedEu} />
          <SignatureBox title="Pour l'entreprise extérieure" who={plan.contractor} signedOn={plan.signedEeOn} signer={plan.signedEe} />
        </div>
      </Section>

      {plan.form && <ImportedFormAnnex form={plan.form} />}

      <div className="pp-foot">Vigie · {plan.id} · document édité le {fmtDate(today())} · à conserver avec les comptes rendus d&apos;inspection et les avenants</div>
    </article>
  );
}
