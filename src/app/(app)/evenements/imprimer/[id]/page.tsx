import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PrintButton } from '@/components/PrintButton';
import { fmtDate } from '@/lib/dates';
import { canSeeHealth } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadDatPrint } from '@/lib/data/events';
import { today } from '@/lib/today';
import '../../../prevention/imprimer/print.css';

export async function generateMetadata({ params }: PageProps<'/evenements/imprimer/[id]'>): Promise<Metadata> {
  const { id } = await params;
  return { title: `Déclaration d'accident ${decodeURIComponent(id)}` };
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
const Text = ({ value, empty = 'Non renseigné.' }: { value: string | null; empty?: string }) =>
  (value ? <p className="pp-text">{value}</p> : <p className="pp-empty">{empty}</p>);
/** « AAAA-MM-JJTHH:mm » → « 08/09/2026 à 16:10 ». */
const fmtLocal = (local: string) => `${fmtDate(local.slice(0, 10))} à ${local.slice(11, 16)}`;

// Synthèse imprimable d'un accident du travail (EVT-10) : rubriques de la déclaration d'accident du travail à reporter sur
// net-entreprises.fr (Cerfa 14463), puis feuille d'accident à remettre à la victime (Cerfa 11383, art. L. 441-5 CSS). Données
// de santé : animateur QHSE et direction seulement (HEALTH_PAGES, src/lib/auth/route-access.ts), consultation tracée.
export default async function DatPrintPage({ params }: PageProps<'/evenements/imprimer/[id]'>) {
  const session = await guard('events');
  if (!canSeeHealth(session.role)) redirect('/evenements');
  const { id } = await params;
  const d = await loadDatPrint(decodeURIComponent(id));
  if (!d) notFound();
  const back = `/evenements?sel=${encodeURIComponent(d.id)}`;

  return (
    <article className="pp-doc pp-doc-narrow">
      <div className="pp-toolbar pp-noprint">
        {/* Lien HTML simple (navigation complète) : la feuille print.css ne doit pas rester chargée dans l'application. */}
        <a href={back} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} />Événement {d.id}</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="pp-muted" style={{ fontSize: 11.5 }}>Pour le PDF : « Enregistrer au format PDF » dans la boîte d&apos;impression.</span>
          <PrintButton />
        </span>
      </div>

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · Accident du travail · document confidentiel (données de santé)</div>
        <div className="pp-head-row">
          <h1>{d.id} · Déclaration d&apos;accident {d.commute ? 'de trajet' : 'du travail'}</h1>
        </div>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>
          Synthèse des rubriques à reporter sur net-entreprises.fr (formulaire Cerfa 14463) · code de la sécurité sociale, art. L. 441-2 et R. 441-3 · éditée le {fmtDate(today())}
        </div>
        {d.duty !== 'cpam' && (
          <p className="pp-muted" style={{ margin: 0, fontSize: 12 }}>
            {d.duty === 'ett'
              ? "Victime intérimaire : l'entreprise de travail temporaire déclare l'accident ; cette synthèse sert à l'informer (R. 412-2)."
              : "Victime extérieure : son employeur déclare l'accident ; cette synthèse sert à l'informer."}
          </p>
        )}
      </header>

      <Section num={1} title="Employeur · établissement">
        <Meta rows={[['Établissement', d.site.label], ['SIRET', d.site.siret ?? 'À renseigner (Gérer les sites)']]} />
      </Section>

      <Section num={2} title="Victime">
        <Meta rows={[['Nom', d.victim.label], ['Statut', d.victim.kind], ['Emploi', d.victim.job ?? '—'], ...(d.victim.company ? [['Entreprise', d.victim.company] as [string, ReactNode]] : [])]} />
      </Section>

      <Section num={3} title="Accident">
        <Meta rows={[
          ['Date et heure', `${fmtDate(d.occurredOn)}${d.occurredTime ? ` à ${d.occurredTime}` : ''}`],
          ['Nature', d.commute ? 'Accident de trajet (L. 411-2)' : 'Accident du travail (L. 411-1)'],
          ['Lieu', d.location],
          ['Horaire de travail ce jour-là', d.workSchedule ?? '—'],
          ["Connu de l'employeur le", `${fmtLocal(d.knownAt)}${d.knownIsDefault ? ' (enregistrement dans Vigie)' : ''}`],
          ['Objet ou matériel en cause', d.equipment ?? '—'],
        ]} />
        <div className="pp-sub"><h3>Activité de la victime au moment de l&apos;accident</h3><Text value={d.activity} /></div>
        <div className="pp-sub"><h3>Circonstances détaillées</h3><Text value={d.circumstances} /></div>
      </Section>

      <Section num={4} title="Lésions et soins">
        <Meta rows={[
          ['Nature des lésions', d.lesionNature ?? '—'], ['Siège des lésions', d.lesionSite ?? '—'],
          ['Conséquences', d.lostDays != null ? `${d.injury} · ${d.lostDays} j perdu${d.lostDays > 1 ? 's' : ''}` : d.injury],
        ]} />
        <div className="pp-sub"><h3>Soins dispensés</h3><Text value={d.careGiven} /></div>
      </Section>

      <Section num={5} title="Témoins et tiers">
        <div className="pp-sub"><h3>Témoins</h3><Text value={d.witnesses} empty="Aucun témoin indiqué." /></div>
        <div className="pp-sub"><h3>Tiers impliqué</h3><Text value={d.thirdParty} empty="Aucun." /></div>
      </Section>

      <Section num={6} title="Déclaration">
        <Meta rows={[
          ['Déclaration CPAM', d.cpam?.label ?? '—'],
          ...(d.cpam?.reserves ? [['Réserves motivées', d.cpam.reserves.label] as [string, ReactNode]] : []),
        ]} />
      </Section>

      <section className="pp-section" style={{ breakBefore: 'page' }}>
        <h2><span className="pp-num">7</span>Feuille d&apos;accident du travail · à remettre à la victime</h2>
        <p className="pp-muted" style={{ margin: 0, fontSize: 12 }}>
          L&apos;employeur remet à la victime la feuille d&apos;accident (Cerfa 11383), qui lui donne droit à la gratuité des soins liés à
          l&apos;accident (art. L. 441-5 du code de la sécurité sociale). Reportez ces mentions sur le formulaire officiel.
        </p>
        <Meta rows={[
          ['Victime', d.victim.label],
          ['Employeur', `${d.site.label}${d.site.siret ? ` · SIRET ${d.site.siret}` : ''}`],
          ["Date de l'accident", fmtDate(d.occurredOn)],
          ['Référence interne', d.id],
        ]} />
        <div className="pp-sign">
          <div>
            <span className="pp-sign-title">Remise de la feuille d&apos;accident</span>
            {['Remise le', 'Par (nom et qualité)', 'Signature'].map((l) => <span key={l} className="pp-blank">{l}</span>)}
          </div>
          <div>
            <span className="pp-sign-title">Victime</span>
            {['Reçue le', 'Signature'].map((l) => <span key={l} className="pp-blank">{l}</span>)}
          </div>
        </div>
      </section>
      <p className="pp-foot">Document confidentiel : données de santé réservées à l&apos;animateur QHSE et à la direction.</p>
    </article>
  );
}
