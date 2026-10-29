'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChangeLogList } from '@/components/ChangeLog';
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
import { CERT_TONES, CERT_TONE_LABELS, certDot } from './shared';
import styles from './audits.module.css';

type Editing = { id: string | null } | null;

/**
 * Cycle de certification (AUD-08) : renouvellement après l'audit de renouvellement (nouveau cycle de 3 ans au plus),
 * suspension par l'organisme et levée, chacune au journal du référentiel (motif obligatoire pour la suspension et sa levée).
 */
function CertificationCycle({ cert, onDone }: { cert: CertView; onDone: () => void }) {
  return (
    <div className="vg-inset" style={{ display: 'grid', gap: 8, padding: '10px 12px' }}>
      <span style={{ fontSize: 12.5, fontWeight: 500 }}>Cycle de certification</span>
      <span style={{ fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
        Certificat émis le {fmtDate(cert.issuedOn!)}{cert.validUntil ? `, valable jusqu'au ${fmtDate(cert.validUntil)}` : ''}.
        {cert.suspendedOn && <> Suspendu depuis le {fmtDate(cert.suspendedOn)}{cert.suspendReason ? ` — ${cert.suspendReason}` : ''}.</>}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {!cert.suspendedOn && (
          <DialogButton label="Renouveler le certificat" className="btn btn-secondary vg-btn-sm" title={`Renouveler ${cert.standard}`} kicker="Cycle de certification" width={520}>
            {(close) => (
              <ActionForm action={renewCertification} hidden={{ id: cert.id }} submitLabel="Enregistrer le renouvellement" onCancel={close} onDone={() => { close(); onDone(); }}>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
                  Nouveau certificat après l&apos;audit de renouvellement : le cycle précédent reste au journal du référentiel.
                </p>
                <FormRow>
                  <Field name="issuedOn" label="Nouveau certificat émis le">
                    <Input name="issuedOn" type="date" />
                  </Field>
                  <Field name="validUntil" label="Valable jusqu'au" hint="3 ans au plus après l'émission.">
                    <Input name="validUntil" type="date" />
                  </Field>
                </FormRow>
                <Field name="organization" label="Organisme certificateur" hint="Vide : inchangé.">
                  <Input name="organization" defaultValue={cert.organization ?? ''} maxLength={120} />
                </Field>
              </ActionForm>
            )}
          </DialogButton>
        )}
        {cert.suspendedOn ? (
          <ReasonButton label="Lever la suspension" icon="ph-seal-check" title={`Lever la suspension de ${cert.standard}`} kicker="Cycle de certification"
            action={reinstateCertification} hidden={{ id: cert.id }} submitLabel="Lever la suspension" onDone={onDone}
            placeholder="Ex. décision de l'organisme du …, écarts levés" />
        ) : (
          <ReasonButton label="Suspension par l'organisme" icon="ph-prohibit" title={`Suspendre ${cert.standard}`} kicker="Cycle de certification"
            action={suspendCertification} hidden={{ id: cert.id }} submitLabel="Enregistrer la suspension" onDone={onDone}
            placeholder="Ex. écart majeur non levé dans le délai, audit de suivi non réalisé">
            <Field name="suspendedOn" label="Suspendu le">
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
export function CertificationCards({ certs, canApprove, sites = [] }: { certs: CertView[]; canApprove: boolean; sites?: readonly Option[] }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const close = () => { setEditing(null); setFileError(null); };
  const cert = editing?.id ? certs.find((c) => c.id === editing.id) : undefined;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {certs.map((c) => {
          const file = c.files.at(-1);
          const validity = [c.organization, c.validUntil && `valable jusqu'au ${fmtDate(c.validUntil)}`, c.siteId && c.site].filter(Boolean).join(' · ');
          const links = (file || c.nextAudit || c.lastAudit) && (
            <div className="vg-target-links" style={{ display: 'flex', flexWrap: 'wrap', gap: '0 12px', fontSize: 11.5, marginTop: 2 }}>
              {file && (
                <a href={fileUrl(file.id)} target="_blank" rel="noopener" className="vg-link" onClick={stop} onKeyDown={stop}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title={file.fileName}>
                  <i className="ph ph-file-pdf" style={{ fontSize: 12 }} aria-hidden />Certificat
                </a>
              )}
              {c.nextAudit && (
                <Link href={`/audits?annee=${c.nextAudit.year}&element=${c.nextAudit.id}`} scroll={false} className="vg-link" onClick={stop} onKeyDown={stop}>
                  Prochain audit · {fmtDayMonth(c.nextAudit.plannedOn)}
                </Link>
              )}
              {c.lastAudit && (
                <Link href={`/audits?annee=${c.lastAudit.year}&element=${c.lastAudit.id}`} scroll={false} className="vg-link" onClick={stop} onKeyDown={stop}>
                  Dernier audit · {c.lastAudit.findingCount} constat{c.lastAudit.findingCount > 1 ? 's' : ''}
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
                  <button type="button" className="btn btn-ghost btn-icon" aria-label={`Modifier ${c.standard}`} style={{ width: 28, height: 28, margin: '-6px -6px -6px 0' }}
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
          if (!canApprove) return <div key={c.id} className="card" style={{ gap: 6 }}>{body}</div>;
          return (
            // Carte cliquable à la souris ; au clavier, le bouton « Modifier » de la carte (pas d'élément interactif imbriqué).
            <div key={c.id} className={`card ${styles.clickCard}`} style={{ gap: 6 }} onClick={() => setEditing({ id: c.id })}>
              {body}
            </div>
          );
        })}
        {canApprove && (
          <button type="button" className={styles.addCard} onClick={() => setEditing({ id: null })}>
            <i className="ph ph-plus" style={{ fontSize: 16 }} aria-hidden />Ajouter un référentiel
          </button>
        )}
        {!certs.length && !canApprove && (
          <div className={styles.emptyCard}>
            <i className="ph ph-certificate" style={{ fontSize: 16 }} aria-hidden />Aucun référentiel suivi
          </div>
        )}
      </div>

      <Dialog open={!!editing} onClose={close} kicker="Certifications" title={cert ? `Modifier ${cert.standard}` : 'Nouveau référentiel'} width={540}>
        {editing && (
          <>
            <ActionForm action={saveCertification} onDone={close} onCancel={close} hidden={{ id: cert?.id }} encType="multipart/form-data">
              <FormRow>
                <Field name="standard" label="Référentiel">
                  <Input name="standard" defaultValue={cert?.standard} placeholder="Ex. ISO 9001:2015, MASE, ISO 3834-2" autoFocus />
                </Field>
                <Field name="domain" label="Domaine">
                  <Input name="domain" defaultValue={cert?.domain} placeholder="Ex. Qualité, Santé-sécurité" />
                </Field>
              </FormRow>
              <Field name="tone" label="Engagement">
                <RadioSeg name="tone" defaultValue={cert?.tone ?? 'warn'} options={CERT_TONES.map((k) => [k, CERT_TONE_LABELS[k], certDot(k)] as const)} />
              </Field>
              <FormRow>
                <Field name="organization" label="Organisme certificateur">
                  <Input name="organization" defaultValue={cert?.organization ?? ''} />
                </Field>
                {/* AUD-22 : site couvert par le certificat ; « Tous les sites » : certificat de l'entreprise (multisite). */}
                <Field name="siteId" label="Site">
                  <Select name="siteId" options={cert ? withCurrent(sites, cert.siteId ?? 'all', cert.site) : sites} defaultValue={cert ? cert.siteId ?? 'all' : sites[0]?.[0] ?? ''} />
                </Field>
              </FormRow>
              <FormRow>
                <Field name="issuedOn" label="Émis le">
                  <Input name="issuedOn" type="date" defaultValue={cert?.issuedOn ?? ''} />
                </Field>
                <Field name="validUntil" label="Valable jusqu'au" hint="Obligatoire pour un référentiel certifié.">
                  <Input name="validUntil" type="date" defaultValue={cert?.validUntil ?? ''} />
                </Field>
              </FormRow>
              <Field name="status" label="Précision" hint="Affichée si non certifié, ex. Déploiement en cours. Le statut et l'audit de suivi sont calculés (programme annuel).">
                <Input name="status" defaultValue={cert?.status} />
              </Field>
              <Field name="note" label="Note" hint="Cycle de certification, échéance visée…">
                <TextArea name="note" defaultValue={cert?.note} rows={2} />
              </Field>
              <Field name="certificate" label="Certificat" hint="PDF ou image, 10 Mo au maximum.">
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
                  <DeleteButton run={() => deleteCertification(cert.id)} onDone={close} label="Supprimer le référentiel"
                    note="Référentiel jamais certifié : retrait inscrit au journal." />
                ) : (
                  <span style={{ marginLeft: 'auto', color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
                    Référentiel suivi (certificat, audits) : passez-le en « Non engagé » pour arrêter la certification.
                  </span>
                )}
              </DialogFooter>
            )}
            {cert && cert.tone === 'ok' && cert.issuedOn && <CertificationCycle cert={cert} onDone={close} />}
            {cert && <ChangeLogList entries={cert.log} />}
          </>
        )}
      </Dialog>
    </>
  );
}
