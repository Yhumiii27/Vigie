import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PrintButton } from '@/components/PrintButton';
import { FIRE_WATCH_HOURS, fmtLocalLong } from '@/components/prevention/model';
import { fmtDate } from '@/lib/dates';
import { today } from '@/lib/today';
import { guard } from '@/lib/guard';
import { loadPrevention, type PermitView } from '@/lib/data/prevention';
import '../../print.css';

export async function generateMetadata({ params }: PageProps<'/prevention/imprimer/permis/[id]'>): Promise<Metadata> {
  const { id } = await params;
  return { title: `Permis ${decodeURIComponent(id)}` };
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
function banner(p: PermitView): { tone: 'ok' | 'danger' | 'neutral'; text: string } {
  switch (p.state) {
    case 'delivre':
    case 'en_cours':
      return { tone: 'ok', text: 'Permis délivré : à afficher sur le lieu des travaux pendant toute leur durée' };
    case 'demande':
      return { tone: 'danger', text: 'Demande non délivrée : ce document ne vaut pas autorisation de travaux' };
    case 'expire':
      return {
        tone: 'danger',
        text: p.status === 'demande'
          ? 'Demande échue, jamais délivrée : ce document ne vaut pas autorisation de travaux'
          : `Permis expiré le ${fmtLocalLong(p.watchUntil ?? p.validTo)} sans clôture : travaux non autorisés au-delà de la validité`,
      };
    case 'clos':
      return { tone: 'neutral', text: `Permis clos${p.closedLabel ? ` le ${p.closedLabel}` : ''} : travaux terminés` };
    case 'annule':
      return {
        tone: 'danger',
        text: `Permis annulé${p.closedLabel ? ` le ${p.closedLabel}` : ''}${p.cancelledBy ? ` par ${p.cancelledBy}` : ''} : ce document ne vaut pas autorisation de travaux`
          + `${p.cancelReason ? ` (motif : ${p.cancelReason})` : ''}`,
      };
  }
}

// Fiche imprimable d'un permis de feu ou d'essai (PRV-03), à afficher sur le lieu des travaux ; ouverte dans un nouvel
// onglet depuis la fiche du permis. Permis du site sélectionné seulement (mêmes données que l'écran).
export default async function PermitPrintPage({ params }: PageProps<'/prevention/imprimer/permis/[id]'>) {
  await guard('prevention');
  const { id } = await params;
  const d = await loadPrevention();
  const permit = d.permits.find((p) => p.id === decodeURIComponent(id));
  if (!permit) notFound();
  const state = banner(permit);
  const checked = permit.checklist.filter((i) => i.checked).length;
  const fire = permit.type === 'feu';
  const printedOn = fmtDate(today());

  return (
    <article className="pp-doc pp-doc-narrow">
      <div className="pp-toolbar pp-noprint">
        {/* Lien HTML simple (navigation complète) : la feuille print.css ne doit pas rester chargée dans l'application. */}
        <a href={`/prevention?onglet=permis&permis=${encodeURIComponent(permit.id)}`} className="btn btn-ghost vg-btn-sm">
          <i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />Permis {permit.id}
        </a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="pp-muted" style={{ fontSize: 11.5 }}>Pour le PDF : « Enregistrer au format PDF » dans la boîte d&apos;impression.</span>
          <PrintButton />
        </span>
      </div>

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · {permit.typeLabel}</div>
        <div className="pp-head-row">
          <h1>{permit.id} · {permit.location}</h1>
          <span className="tag tag-neutral">{permit.stateLabel}</span>
        </div>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>{permit.site} · édité le {printedOn}</div>
        <div className={`pp-banner${state.tone === 'neutral' ? '' : ` pp-banner-${state.tone}`}`}>{state.text}</div>
      </header>

      <Section num={1} title="Travaux">
        <Meta rows={[
          ['Travaux', permit.description],
          ['Lieu', permit.location],
          ['Site', permit.site],
          ['Entreprise', permit.contractor ?? 'Intervention interne'],
          ['Intervenant(s)', permit.performer],
          ['Plan de prévention', permit.plan
            ? `${permit.plan.id} · ${permit.plan.signed ? 'signé' : 'non signé'} · ${permit.plan.period}`
            : permit.planRequired ? 'Aucun (plan signé exigé)' : '—'],
          ['Projet Keystone', permit.keystoneProject ?? '—'],
        ]} />
      </Section>

      <Section num={2} title="Validité">
        <Meta rows={[
          ['Du', fmtLocalLong(permit.validFrom)],
          ['Au', fmtLocalLong(permit.validTo)],
          permit.watchUntil ? [fire ? `Surveillance (${FIRE_WATCH_HOURS} h) jusqu'à` : "Surveillance jusqu'à", fmtLocalLong(permit.watchUntil)] : null,
          ['Délivré par', permit.issuer
            ? `${permit.issuer}${permit.deliveredLabel ? ` le ${permit.deliveredLabel}` : ''}`
            : permit.status === 'demande' ? 'Non délivré' : '—'],
        ]} />
      </Section>

      <Section num={3} title="Vérifications préalables" aside={`${checked}/${permit.checklist.length} vérifiés`}>
        {permit.checklist.length === 0
          ? <p className="pp-empty">Aucun point de contrôle.</p>
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

      <Section num={4} title="Visas">
        <div className="pp-sign">
          <VisaBox title="Délivré par" who={permit.issuer} fields={['Signature']} />
          <VisaBox title="Intervenant(s) : consignes reçues" fields={['Nom', 'Signature']} />
          <VisaBox title="Fin des travaux" fields={['Heure', 'Visa']} />
          {fire
            ? <VisaBox title={`Fin de surveillance (ronde, ${FIRE_WATCH_HOURS} h)`} fields={['Heure', 'Visa']} />
            : <VisaBox title="Zone remise en sécurité" fields={['Heure', 'Visa']} />}
        </div>
      </Section>

      <div className="pp-foot">Vigie · {permit.typeLabel.toLowerCase()} {permit.id} · {permit.site} · document édité le {printedOn}</div>
    </article>
  );
}
