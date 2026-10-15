import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PrintButton } from '@/components/PrintButton';
import { BENIGN_REGISTER_PATH } from '@/components/events/shared';
import { hrefWith } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { today } from '@/lib/today';
import { ALL_SITES, canSeeHealth } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadBenignRegister, type BenignRegister } from '@/lib/data/events';
import '../../prevention/imprimer/print.css';

export const metadata: Metadata = { title: 'Registre des accidents bénins' };

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
/** « AAAA-MM-JJTHH:mm » → « 07/09/2026 à 11:05 ». */
const fmtLocal = (local: string) => `${fmtDate(local.slice(0, 10))} à ${local.slice(11, 16)}`;

// Registre des accidents du travail bénins d'un site (EVT-04 ; art. L. 441-4 et D. 441-1 à D. 441-4 CSS), imprimable pour
// les visas de la victime et du donneur de soins. Données de santé : animateur QHSE et direction seulement (les autres rôles
// sont renvoyés vers /evenements). ?site= (par défaut : le site sélectionné), ?annee= (soins de l'année).
export default async function BenignRegisterPage({ searchParams }: PageProps<'/evenements/registre-benin'>) {
  const session = await guard('events');
  if (!canSeeHealth(session.role)) redirect('/evenements');
  const sp = await searchParams;
  const siteId = str(sp.site) ?? (session.site.id !== ALL_SITES ? session.site.id : null);
  const year = /^\d{4}$/.test(str(sp.annee) ?? '') ? Number(sp.annee) : undefined;
  const register = await loadBenignRegister(siteId, year);
  const now = today();

  return (
    <article className="pp-doc">
      <div className="pp-toolbar pp-noprint">
        {/* Lien HTML simple (navigation complète) : la feuille print.css ne doit pas rester chargée dans l'application. */}
        <a href="/evenements" className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} />Événements</a>
        {register?.site && (
          <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <span className="pp-muted" style={{ fontSize: 11.5 }}>Pour le PDF : « Enregistrer au format PDF » dans la boîte d&apos;impression.</span>
            <PrintButton />
          </span>
        )}
      </div>
      {register?.site ? <Register register={register} now={now} /> : <Chooser sites={(register ?? (await loadBenignRegister(null)))?.sites ?? []} unknown={!!siteId} />}
    </article>
  );
}

/** Aucun site résolu (« Tous les sites » sélectionné) ou site hors périmètre : choix du registre. */
function Chooser({ sites, unknown }: { sites: { id: string; label: string }[]; unknown: boolean }) {
  return (
    <header className="pp-head">
      <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · Signalements et événements</div>
      <h1>Registre des accidents du travail bénins</h1>
      <p className="pp-muted" style={{ margin: 0, fontSize: 12.5 }}>
        {unknown ? 'Site inconnu ou hors de votre périmètre. ' : ''}Un registre par établissement : choisissez le site.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {sites.map((s) => (
          <a key={s.id} href={`${BENIGN_REGISTER_PATH}?site=${encodeURIComponent(s.id)}`} className="btn btn-secondary vg-btn-sm">{s.label.split(' — ')[0]}</a>
        ))}
        {sites.length === 0 && <span className="pp-empty">Aucun site dans votre périmètre.</span>}
      </div>
    </header>
  );
}

function Register({ register, now }: { register: BenignRegister; now: string }) {
  const { site, entries, years, year, firstAiders } = register;
  const base = BENIGN_REGISTER_PATH;
  return (
    <>
      {/* Dix colonnes : registre imprimé en paysage (page ouverte par un lien simple, la règle ne s'applique qu'à elle). */}
      <style>{'@media print { @page { size: A4 landscape; margin: 10mm; } .bn-table { font-size: 8pt !important; } .bn-table th { white-space: normal !important; } }'}</style>
      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · Signalements et événements</div>
        <div className="pp-head-row">
          <h1>Registre des accidents du travail bénins</h1>
          <span className="pp-muted" style={{ fontSize: 12.5 }}>{site!.label}{year ? ` · soins de ${year}` : ''}</span>
        </div>
        <p className="pp-text pp-muted">
          Tenu en application des art. L. 441-4 et D. 441-1 à D. 441-4 du code de la sécurité sociale : accidents n&apos;entraînant
          ni arrêt de travail ni soins médicaux, avec les soins donnés par un secouriste du travail de l&apos;effectif ou un professionnel de santé. Le registre est visé par la
          victime et par le donneur de soins ; tout arrêt ou soin médical ultérieur fait l&apos;objet d&apos;une déclaration à la CPAM.
        </p>
        <div style={{ fontSize: 12.5 }}>
          <span className="pp-h3" style={{ display: 'block' }}>Secouristes du travail du site au {fmtDate(now)}</span>
          {firstAiders.length
            ? firstAiders.map((a) => `${a.name} (SST ${a.until ? `valide jusqu'au ${fmtDate(a.until)}` : 'sans échéance'})`).join(' · ')
            : <span style={{ color: 'var(--tone-warn-fg)' }}>Aucun secouriste du travail (SST) valide sur ce site : le registre suppose un secouriste de l&apos;effectif ou un professionnel de santé.</span>}
        </div>
        {years.length > 1 && (
          <div className="pp-noprint" style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            <a href={hrefWith(base, { site: site!.id }, {})} className={`vg-chip${!year ? ' is-on' : ''}`}>Toutes les années</a>
            {years.map((y) => (
              <a key={y} href={hrefWith(base, { site: site!.id }, { annee: String(y) })} className={`vg-chip${year === y ? ' is-on' : ''}`}>{y}</a>
            ))}
          </div>
        )}
      </header>

      <section className="pp-section">
        {entries.length === 0
          ? <p className="pp-empty">Aucune inscription{year ? ` pour les soins de ${year}` : ''} au registre de ce site.</p>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table pp-table bn-table">
                <thead>
                  <tr>
                    <th>N°</th><th>Date et heure</th><th>Victime</th><th>Lieu et circonstances</th><th>Lésions (nature · siège)</th><th>Soins dispensés</th>
                    <th>Donneur de soins (qualité)</th><th>Témoins</th><th>Visas (victime / donneur de soins)</th><th>Suite</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((r) => (
                    <tr key={r.id} style={r.cancelled ? { opacity: 0.6 } : undefined}>
                      <td className="pp-nowrap" style={r.cancelled ? { textDecoration: 'line-through' } : undefined}>{r.number}</td>
                      <td className="pp-nowrap">
                        {fmtDate(r.occurredOn)}{r.occurredTime ? ` à ${r.occurredTime}` : ''}
                        <span className="pp-muted" style={{ display: 'block' }}>soins le {fmtLocal(r.careGivenAt)}</span>
                        <span className="pp-muted" style={{ display: 'block' }}>inscrit le {fmtDate(r.registeredOn)}</span>
                      </td>
                      <td>{r.victim}</td>
                      <td>{r.location}{r.circumstances && <span className="pp-muted" style={{ display: 'block', whiteSpace: 'pre-line' }}>{r.circumstances}</span>}</td>
                      <td>{r.lesionNature || r.lesionSite ? `${r.lesionNature ?? '—'} · ${r.lesionSite ?? '—'}` : '—'}</td>
                      <td style={{ whiteSpace: 'pre-line' }}>{r.care}</td>
                      <td>{r.caregiver}<span className="pp-muted" style={{ display: 'block' }}>{r.qualification}</span></td>
                      <td style={{ whiteSpace: 'pre-line' }}>{r.witnesses || '—'}</td>
                      <td style={{ minWidth: 110 }}>
                        {r.signedOn ? `Visés le ${fmtDate(r.signedOn)}` : (
                          <span style={{ display: 'grid', gap: 6 }}>
                            <span className="pp-blank">Victime</span>
                            <span className="pp-blank">Donneur de soins</span>
                          </span>
                        )}
                      </td>
                      <td style={{ minWidth: 120 }}>
                        {r.cancelled
                          ? <>Inscription annulée le {fmtDate(r.cancelled.on)} : {r.cancelled.reason}</>
                          : r.escalated
                            ? <>Basculé en déclaration CPAM : connu le {fmtLocal(r.escalated.at)}, {r.escalated.cpamDeclaredOn ? `déclaré le ${fmtDate(r.escalated.cpamDeclaredOn)}` : 'déclaration à faire'} ({r.escalated.injuryLabel.toLowerCase()})</>
                            : '—'}
                        <span className="pp-muted" style={{ display: 'block' }}>
                          <a href={`/evenements?sel=${encodeURIComponent(r.ref)}`} className="vg-link">{r.ref}</a>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      <div className="pp-foot">Vigie · registre des accidents bénins · {site!.label} · édité le {fmtDate(now)}</div>
    </>
  );
}
