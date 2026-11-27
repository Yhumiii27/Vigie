import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PrintButton } from '@/components/PrintButton';
import { BENIGN_REGISTER_PATH } from '@/lib/rules/events';
import { hrefWith } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { today } from '@/lib/today';
import { ALL_SITES, canSeeHealth } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadBenignRegister, type BenignRegister } from '@/lib/data/events';
import '../../prevention/imprimer/print.css';
import { getI18n } from '@/i18n/server';
import { fill, type T } from '@/i18n/translate';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('Register of minor accidents') };
}

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
/** « AAAA-MM-JJTHH:mm » → « 07/09/2026 à 11:05 ». */
const fmtLocal = (local: string, t: T) => fill(t('{date} at {time}'), { date: fmtDate(local.slice(0, 10)), time: local.slice(11, 16) });

// Registre des accidents du travail bénins d'un site (EVT-04 ; art. L. 441-4 et D. 441-1 à D. 441-4 CSS), imprimable pour
// les visas de la victime et du donneur de soins. Données de santé : animateur QHSE et direction seulement (les autres rôles
// sont renvoyés vers /evenements). ?site= (par défaut : le site sélectionné), ?annee= (soins de l'année).
export default async function BenignRegisterPage({ searchParams }: PageProps<'/evenements/registre-benin'>) {
  const session = await guard('events');
  if (!canSeeHealth(session.role)) redirect('/evenements');
  const { t } = await getI18n();
  const sp = await searchParams;
  const siteId = str(sp.site) ?? (session.site.id !== ALL_SITES ? session.site.id : null);
  const year = /^\d{4}$/.test(str(sp.annee) ?? '') ? Number(sp.annee) : undefined;
  const register = await loadBenignRegister(siteId, year);
  const now = today();

  return (
    <article className="pp-doc">
      <div className="pp-toolbar pp-noprint">
        {/* Lien HTML simple (navigation complète) : la feuille print.css ne doit pas rester chargée dans l'application. */}
        <a href="/evenements" className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{t('Events')}</a>
        {register?.site && (
          <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <span className="pp-muted" style={{ fontSize: 11.5 }}>{t('For the PDF: “Save as PDF” in the print dialog.')}</span>
            <PrintButton />
          </span>
        )}
      </div>
      {register?.site ? <Register register={register} now={now} /> : <Chooser sites={(register ?? (await loadBenignRegister(null)))?.sites ?? []} unknown={!!siteId} />}
    </article>
  );
}

/** Aucun site résolu (« Tous les sites » sélectionné) ou site hors périmètre : choix du registre. */
async function Chooser({ sites, unknown }: { sites: { id: string; label: string }[]; unknown: boolean }) {
  const { t } = await getI18n();
  return (
    <header className="pp-head">
      <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · {t('Reports and events')}</div>
      <h1>{t('Register of minor work accidents')}</h1>
      <p className="pp-muted" style={{ margin: 0, fontSize: 12.5 }}>
        {unknown ? t('Unknown site or outside your scope. ') : ''}{t('One register per establishment: choose the site.')}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {sites.map((s) => (
          <a key={s.id} href={`${BENIGN_REGISTER_PATH}?site=${encodeURIComponent(s.id)}`} className="btn btn-secondary vg-btn-sm">{s.label.split(' — ')[0]}</a>
        ))}
        {sites.length === 0 && <span className="pp-empty">{t('No site in your scope.')}</span>}
      </div>
    </header>
  );
}

async function Register({ register, now }: { register: BenignRegister; now: string }) {
  const { t } = await getI18n();
  const { site, entries, years, year, firstAiders } = register;
  const base = BENIGN_REGISTER_PATH;
  return (
    <>
      {/* Dix colonnes : registre imprimé en paysage (page ouverte par un lien simple, la règle ne s'applique qu'à elle). */}
      <style>{'@media print { @page { size: A4 landscape; margin: 10mm; } .bn-table { font-size: 8pt !important; } .bn-table th { white-space: normal !important; } }'}</style>
      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · {t('Reports and events')}</div>
        <div className="pp-head-row">
          <h1>{t('Register of minor work accidents')}</h1>
          <span className="pp-muted" style={{ fontSize: 12.5 }}>{site!.label}{year ? fill(t(' · care in {year}'), { year }) : ''}</span>
        </div>
        <p className="pp-text pp-muted">
          {t('Kept under art. L. 441-4 and D. 441-1 to D. 441-4 of the French Social Security Code: accidents causing neither time off work nor medical care, with the care given by a workplace first aider of the workforce or a health professional. The register is countersigned by the victim and by the caregiver; any later time off or medical care is declared to the CPAM.')}
        </p>
        <div style={{ fontSize: 12.5 }}>
          <span className="pp-h3" style={{ display: 'block' }}>{fill(t('Workplace first aiders of the site on {date}'), { date: fmtDate(now) })}</span>
          {firstAiders.length
            ? firstAiders.map((a) => `${a.name} (SST ${a.until ? fill(t('valid until {date}'), { date: fmtDate(a.until) }) : t('no expiry')})`).join(' · ')
            : <span style={{ color: 'var(--tone-warn-fg)' }}>{t('No valid workplace first aider (SST) on this site: the register assumes a first aider of the workforce or a health professional.')}</span>}
        </div>
        {years.length > 1 && (
          <div className="pp-noprint" style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            <a href={hrefWith(base, { site: site!.id }, {})} className={`vg-chip${!year ? ' is-on' : ''}`}>{t('All years')}</a>
            {years.map((y) => (
              <a key={y} href={hrefWith(base, { site: site!.id }, { annee: String(y) })} className={`vg-chip${year === y ? ' is-on' : ''}`}>{y}</a>
            ))}
          </div>
        )}
      </header>

      <section className="pp-section">
        {entries.length === 0
          ? <p className="pp-empty">{year ? fill(t('No entry for the care in {year} in this site’s register.'), { year }) : t('No entry in this site’s register.')}</p>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table pp-table bn-table">
                <thead>
                  <tr>
                    <th>{t('No.')}</th><th>{t('Date and time')}</th><th>{t('Victim')}</th><th>{t('Location and circumstances')}</th><th>{t('Lesions (nature · site)')}</th><th>{t('Care given')}</th>
                    <th>{t('Caregiver (qualification)')}</th><th>{t('Witnesses')}</th><th>{t('Countersignatures (victim / caregiver)')}</th><th>{t('Follow-up#short')}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((r) => (
                    <tr key={r.id} data-obsolete={r.cancelled || undefined}>
                      <td className="pp-nowrap" style={r.cancelled ? { textDecoration: 'line-through' } : undefined}>{r.number}</td>
                      <td className="pp-nowrap">
                        {fmtDate(r.occurredOn)}{r.occurredTime ? fill(t(' at {time}'), { time: r.occurredTime }) : ''}
                        <span className="pp-muted" style={{ display: 'block' }}>{fill(t('care on {date}'), { date: fmtLocal(r.careGivenAt, t) })}</span>
                        <span className="pp-muted" style={{ display: 'block' }}>{fill(t('entered on {date}'), { date: fmtDate(r.registeredOn) })}</span>
                      </td>
                      <td>{r.victim}</td>
                      <td>{r.location}{r.circumstances && <span className="pp-muted" style={{ display: 'block', whiteSpace: 'pre-line' }}>{r.circumstances}</span>}</td>
                      <td>{r.lesionNature || r.lesionSite ? `${r.lesionNature ?? '—'} · ${r.lesionSite ?? '—'}` : '—'}</td>
                      <td style={{ whiteSpace: 'pre-line' }}>{r.care}</td>
                      <td>{r.caregiver}<span className="pp-muted" style={{ display: 'block' }}>{r.qualification}</span></td>
                      <td style={{ whiteSpace: 'pre-line' }}>{r.witnesses || '—'}</td>
                      <td style={{ minWidth: 110 }}>
                        {r.signedOn ? fill(t('Countersigned on {date}'), { date: fmtDate(r.signedOn) }) : (
                          <span style={{ display: 'grid', gap: 6 }}>
                            <span className="pp-blank">{t('Victim')}</span>
                            <span className="pp-blank">{t('Caregiver')}</span>
                          </span>
                        )}
                      </td>
                      <td style={{ minWidth: 120 }}>
                        {r.cancelled
                          ? fill(t('Entry cancelled on {date}: {reason}'), { date: fmtDate(r.cancelled.on), reason: r.cancelled.reason })
                          : r.escalated
                            ? <>{fill(t('Switched to a CPAM declaration: known on {date}'), { date: fmtLocal(r.escalated.at, t) })}, {r.escalated.cpamDeclaredOn ? fill(t('declared on {date}'), { date: fmtDate(r.escalated.cpamDeclaredOn) }) : t('declaration to make')} ({r.escalated.injuryLabel.toLowerCase()})</>
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

      <div className="pp-foot">Vigie · {t('register of minor accidents')} · {site!.label} · {fill(t('printed on {date}'), { date: fmtDate(now) })}</div>
    </>
  );
}
