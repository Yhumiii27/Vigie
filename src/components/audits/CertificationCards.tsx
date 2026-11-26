'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { withCurrent, type Option } from '@/lib/form-options';
import { Dot } from '@/components/ui';
import { FileError, checkPickedFiles } from '@/components/watch/parts';
import { ATTACH_ACCEPT } from '@/lib/attachments';
import { fmtDate, fmtDayMonth } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import type { CertView } from '@/lib/data/audits';
import { ReasonButton } from '@/components/ReasonDialog';
import { deleteCertification, reinstateCertification, removeCertificationFile, renewCertification, saveCertification, suspendCertification } from '@/server/audits';
import { DeleteButton, DialogFooter, FileList, RadioSeg, fileUrl } from './parts';
import { CERT_TONES, CERT_TONE_LABELS, certDot } from '@/lib/rules/audits';
import styles from './audits.module.css';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

type Editing = { id: string | null } | null;

/**
 * Cycle de certification (AUD-08) : renouvellement après l'audit de renouvellement (nouveau cycle de 3 ans au plus),
 * suspension par l'organisme et levée, chacune au journal du référentiel (motif obligatoire pour la suspension et sa levée).
 */
function CertificationCycle({ cert, onDone }: { cert: CertView; onDone: () => void }) {
  const { t } = useI18n();
  return (
    <div className="vg-inset" style={{ display: 'grid', gap: 8, padding: '10px 12px' }}>
      <span style={{ fontSize: 12.5, fontWeight: 500 }}>{t('Certification cycle')}</span>
      <span style={{ fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
        {fill(t('Certificate issued on {date}'), { date: fmtDate(cert.issuedOn!) })}{cert.validUntil ? fill(t(', valid until {date}'), { date: fmtDate(cert.validUntil) }) : ''}.
        {cert.suspendedOn && <>{fill(t(' Suspended since {date}'), { date: fmtDate(cert.suspendedOn) })}{cert.suspendReason ? ` — ${cert.suspendReason}` : ''}.</>}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {!cert.suspendedOn && (
          <DialogButton label={t('Renew the certificate')} className="btn btn-secondary vg-btn-sm" title={fill(t('Renew {standard}'), { standard: cert.standard })} kicker={t('Certification cycle')} width={520}>
            {(close) => (
              <ActionForm action={renewCertification} hidden={{ id: cert.id }} submitLabel={t('Save the renewal')} onCancel={close} onDone={() => { close(); onDone(); }}>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
                  {t('New certificate after the renewal audit: the previous cycle stays in the log of the standard.')}
                </p>
                <FormRow>
                  <Field name="issuedOn" label={t('New certificate issued on')}>
                    <Input name="issuedOn" type="date" />
                  </Field>
                  <Field name="validUntil" label={t('Valid until')} hint={t('3 years at most after issue.')}>
                    <Input name="validUntil" type="date" />
                  </Field>
                </FormRow>
                <Field name="organization" label={t('Certification body')} hint={t('Empty: unchanged.')}>
                  <Input name="organization" defaultValue={cert.organization ?? ''} maxLength={120} />
                </Field>
              </ActionForm>
            )}
          </DialogButton>
        )}
        {cert.suspendedOn ? (
          <ReasonButton label={t('Lift the suspension')} icon="ph-seal-check" title={fill(t('Lift the suspension of {standard}'), { standard: cert.standard })} kicker={t('Certification cycle')}
            action={reinstateCertification} hidden={{ id: cert.id }} submitLabel={t('Lift the suspension')} onDone={onDone}
            placeholder={t('E.g. decision of the body of …, gaps lifted')} />
        ) : (
          <ReasonButton label={t('Suspension by the body')} icon="ph-prohibit" title={fill(t('Suspend {standard}'), { standard: cert.standard })} kicker={t('Certification cycle')}
            action={suspendCertification} hidden={{ id: cert.id }} submitLabel={t('Save the suspension')} onDone={onDone}
            placeholder={t('E.g. major gap not lifted in time, surveillance audit not carried out')}>
            <Field name="suspendedOn" label={t('Suspended on')}>
              <Input name="suspendedOn" type="date" />
            </Field>
          </ReasonButton>
        )}
      </div>
    </div>
  );
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

/** Cartes des référentiels (statut calculé, audits du programme, certificat) ; l'animateur QHSE et la direction les modifient. */
export function CertificationCards({ certs, canApprove, sites = [], initialId, closeHref }: {
  certs: CertView[]; canApprove: boolean; sites?: readonly Option[];
  /** AUD-19 : référentiel visé par un lien profond (?referentiel=<id>, échéances de certification) — fiche ouverte pour qui la modifie, carte mise en évidence sinon. */
  initialId?: string;
  /** URL sans le lien profond, rétablie à la fermeture. */
  closeHref?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(initialId && canApprove ? { id: initialId } : null);
  const [deepLink, setDeepLink] = useState(!!initialId);
  const [fileError, setFileError] = useState<string | null>(null);
  const flashId = initialId && !canApprove ? initialId : undefined;
  useEffect(() => {
    if (initialId) document.getElementById(`referentiel-${initialId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [initialId]);
  const close = () => {
    setEditing(null); setFileError(null);
    if (deepLink && closeHref) { setDeepLink(false); router.replace(closeHref, { scroll: false }); }
  };
  const cert = editing?.id ? certs.find((c) => c.id === editing.id) : undefined;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {certs.map((c) => {
          const file = c.files.at(-1);
          const validity = [c.organization, c.validUntil && fill(t('valid until {date}#cert'), { date: fmtDate(c.validUntil) }), c.siteId && c.site].filter(Boolean).join(' · ');
          const links = (file || c.nextAudit || c.lastAudit) && (
            <div className="vg-target-links" style={{ display: 'flex', flexWrap: 'wrap', gap: '0 12px', fontSize: 11.5, marginTop: 2 }}>
              {file && (
                <a href={fileUrl(file.id)} target="_blank" rel="noopener" className="vg-link" onClick={stop} onKeyDown={stop}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title={file.fileName}>
                  <i className="ph ph-file-pdf" style={{ fontSize: 12 }} aria-hidden />{t('Certificate')}
                </a>
              )}
              {c.nextAudit && (
                <Link href={`/audits?annee=${c.nextAudit.year}&element=${c.nextAudit.id}`} scroll={false} className="vg-link" onClick={stop} onKeyDown={stop}>
                  {t('Next audit')} · {fmtDayMonth(c.nextAudit.plannedOn)}
                </Link>
              )}
              {c.lastAudit && (
                <Link href={`/audits?annee=${c.lastAudit.year}&element=${c.lastAudit.id}`} scroll={false} className="vg-link" onClick={stop} onKeyDown={stop}>
                  {t('Last audit')} · {fill(c.lastAudit.findingCount > 1 ? t('{n} findings') : t('{n} finding'), { n: c.lastAudit.findingCount })}
                </Link>
              )}
            </div>
          );
          const body = (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span className="card-kicker">{c.domain}</span>
                {/* Bouton nommé (clavier, lecteurs d'écran) ; la carte entière reste cliquable à la souris (UX-10). */}
                {canApprove && (
                  <button type="button" className="btn btn-ghost btn-icon" aria-label={fill(t('Edit {name}'), { name: c.standard })} style={{ width: 28, height: 28, margin: '-6px -6px -6px 0' }}
                    onClick={(e) => { e.stopPropagation(); setEditing({ id: c.id }); }}>
                    <i className={`ph ph-pencil-simple ${styles.hoverIcon}`} aria-hidden />
                  </button>
                )}
              </div>
              <div className="card-title" style={{ fontSize: 16 }}>{c.standard}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}><Dot color={TONE[c.state.tone].dot} />{c.state.label}</div>
              {validity && <div style={{ fontSize: 11.5, color: 'var(--color-neutral-400)' }}>{validity}</div>}
              {c.note && <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{c.note}</div>}
              {links}
            </>
          );
          if (!canApprove) return <div key={c.id} id={`referentiel-${c.id}`} className={`card${flashId === c.id ? ` ${styles.flash}` : ''}`} style={{ gap: 6, scrollMarginTop: 16 }}>{body}</div>;
          return (
            // Carte cliquable à la souris ; au clavier, le bouton « Modifier » de la carte (pas d'élément interactif imbriqué).
            <div key={c.id} id={`referentiel-${c.id}`} className={`card ${styles.clickCard}`} style={{ gap: 6, scrollMarginTop: 16 }} onClick={() => setEditing({ id: c.id })}>
              {body}
            </div>
          );
        })}
        {canApprove && (
          <button type="button" className={styles.addCard} onClick={() => setEditing({ id: null })}>
            <i className="ph ph-plus" style={{ fontSize: 16 }} aria-hidden />{t('Add a standard')}
          </button>
        )}
        {!certs.length && !canApprove && (
          <div className={styles.emptyCard}>
            <i className="ph ph-certificate" style={{ fontSize: 16 }} aria-hidden />{t('No standard followed')}
          </div>
        )}
      </div>

      <Dialog open={!!editing} onClose={close} kicker={t('Certifications')} title={cert ? fill(t('Edit {name}'), { name: cert.standard }) : t('New standard')} width={540}>
        {editing && (
          <>
            <ActionForm action={saveCertification} onDone={close} onCancel={close} hidden={{ id: cert?.id, version: cert?.version }} encType="multipart/form-data">
              <FormRow>
                <Field name="standard" label={t('Standard')}>
                  <Input name="standard" defaultValue={cert?.standard} placeholder={t('E.g. ISO 9001:2015, MASE, ISO 3834-2')} autoFocus />
                </Field>
                <Field name="domain" label={t('Domain')}>
                  <Input name="domain" defaultValue={cert?.domain} placeholder={t('E.g. Quality, Health and safety')} />
                </Field>
              </FormRow>
              <Field name="tone" label={t('Commitment')}>
                <RadioSeg name="tone" defaultValue={cert?.tone ?? 'warn'} options={CERT_TONES.map((k) => [k, CERT_TONE_LABELS[k], certDot(k)] as const)} />
              </Field>
              <FormRow>
                <Field name="organization" label={t('Certification body')}>
                  <Input name="organization" defaultValue={cert?.organization ?? ''} />
                </Field>
                {/* AUD-22 : site couvert par le certificat ; « Tous les sites » : certificat de l'entreprise (multisite). */}
                <Field name="siteId" label={t('Site')}>
                  <Select name="siteId" options={cert ? withCurrent(sites, cert.siteId ?? 'all', cert.site) : sites} defaultValue={cert ? cert.siteId ?? 'all' : sites[0]?.[0] ?? ''} />
                </Field>
              </FormRow>
              <FormRow>
                <Field name="issuedOn" label={t('Issued on#cert')}>
                  <Input name="issuedOn" type="date" defaultValue={cert?.issuedOn ?? ''} />
                </Field>
                <Field name="validUntil" label={t('Valid until')} hint={t('Required for a certified standard.')}>
                  <Input name="validUntil" type="date" defaultValue={cert?.validUntil ?? ''} />
                </Field>
              </FormRow>
              <Field name="status" label={t('Detail')} hint={t('Shown if not certified, e.g. Roll-out in progress. The status and the surveillance audit are computed (annual programme).')}>
                <Input name="status" defaultValue={cert?.status} />
              </Field>
              <Field name="note" label={t('Note')} hint={t('Certification cycle, target deadline…')}>
                <TextArea name="note" defaultValue={cert?.note} rows={2} />
              </Field>
              <Field name="certificate" label={t('Certificate')} hint={t('PDF or image, 10 MB at most.')}>
                <Input name="certificate" type="file" accept={ATTACH_ACCEPT} onChange={(e) => setFileError(checkPickedFiles(e.currentTarget))} />
              </Field>
              <FileError error={fileError} />
            </ActionForm>
            {cert && (
              <DialogFooter>
                {cert.files.length > 0 && (
                  <div style={{ flex: '1 1 100%' }}>
                    <FileList files={cert.files} icon="ph-file-pdf" onRemove={removeCertificationFile} />
                  </div>
                )}
                {cert.removable ? (
                  <DeleteButton run={() => deleteCertification(cert.id)} onDone={close} label={t('Delete the standard')}
                    note={t('Standard never certified: removal written to the log.')} />
                ) : (
                  <span style={{ marginLeft: 'auto', color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
                    {t('Standard followed (certificate, audits): set it to “Not committed” to stop the certification.')}
                  </span>
                )}
              </DialogFooter>
            )}
            {cert && cert.tone === 'ok' && cert.issuedOn && <CertificationCycle cert={cert} onDone={close} />}
            {cert && <LazyChangeLog entity="certification" id={cert.id} />}
          </>
        )}
      </Dialog>
    </>
  );
}
