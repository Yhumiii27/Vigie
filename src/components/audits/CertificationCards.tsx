'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChangeLogList } from '@/components/ChangeLog';
import { Dialog } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, TextArea } from '@/components/form';
import { Dot } from '@/components/ui';
import { FileError, checkPickedFiles } from '@/components/watch/parts';
import { ATTACH_ACCEPT } from '@/lib/attachments';
import { fmtDate, fmtDayMonth } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import type { CertView } from '@/lib/data/audits';
import { deleteCertification, removeCertificationFile, saveCertification } from '@/server/audits';
import { DeleteButton, DialogFooter, FileList, RadioSeg, fileUrl } from './parts';
import { CERT_TONES, CERT_TONE_LABELS, certDot } from './shared';
import styles from './audits.module.css';

type Editing = { id: string | null } | null;

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

/** Cartes des référentiels (statut calculé, audits du programme, certificat) ; l'animateur QHSE et la direction les modifient. */
export function CertificationCards({ certs, canApprove }: { certs: CertView[]; canApprove: boolean }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const close = () => { setEditing(null); setFileError(null); };
  const cert = editing?.id ? certs.find((c) => c.id === editing.id) : undefined;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {certs.map((c) => {
          const file = c.files.at(-1);
          const validity = [c.organization, c.validUntil && `valable jusqu'au ${fmtDate(c.validUntil)}`].filter(Boolean).join(' · ');
          const links = (file || c.nextAudit || c.lastAudit) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 11.5, marginTop: 2 }}>
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
                {canApprove && <i className={`ph ph-pencil-simple ${styles.hoverIcon}`} aria-hidden />}
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
            <div key={c.id} role="button" tabIndex={0} aria-label={`Modifier ${c.standard}`} className={`card ${styles.clickCard}`} style={{ gap: 6 }}
              onClick={() => setEditing({ id: c.id })}
              onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setEditing({ id: c.id }); } }}>
              {body}
            </div>
          );
        })}
        {canApprove && (
          <button type="button" className={styles.addCard} onClick={() => setEditing({ id: null })}>
            <i className="ph ph-plus" style={{ fontSize: 16 }} />Ajouter un référentiel
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
              <Field name="organization" label="Organisme certificateur">
                <Input name="organization" defaultValue={cert?.organization ?? ''} />
              </Field>
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
            {cert && <ChangeLogList entries={cert.log} />}
          </>
        )}
      </Dialog>
    </>
  );
}
