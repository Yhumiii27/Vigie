'use client';

import { useState } from 'react';
import { Dialog } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, TextArea } from '@/components/form';
import { Dot } from '@/components/ui';
import type { Certification } from '@/lib/data/audits';
import { deleteCertification, saveCertification } from '@/server/audits';
import { DeleteButton, DialogFooter, RadioSeg } from './parts';
import { CERT_TONES, CERT_TONE_LABELS, certDot } from './shared';
import styles from './audits.module.css';

type Editing = { id: string | null } | null;

/** Cartes des référentiels ; l'animateur QHSE et la direction les modifient. */
export function CertificationCards({ certs, canApprove }: { certs: Certification[]; canApprove: boolean }) {
  const [editing, setEditing] = useState<Editing>(null);
  const close = () => setEditing(null);
  const cert = editing?.id ? certs.find((c) => c.id === editing.id) : undefined;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {certs.map((c) => {
          const body = (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span className="card-kicker">{c.domain}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {canApprove && <i className={`ph ph-pencil-simple ${styles.hoverIcon}`} aria-hidden />}
                  <span className="tag tag-outline" style={{ fontSize: 10 }}>À confirmer</span>
                </span>
              </div>
              <div className="card-title" style={{ fontSize: 16 }}>{c.standard}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}><Dot color={certDot(c.tone)} />{c.status}</div>
              <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{c.note}</div>
            </>
          );
          if (!canApprove) return <div key={c.id} className="card" style={{ gap: 6 }}>{body}</div>;
          return (
            <div key={c.id} role="button" tabIndex={0} aria-label={`Modifier ${c.standard}`} className={`card ${styles.clickCard}`} style={{ gap: 6 }}
              onClick={() => setEditing({ id: c.id })}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing({ id: c.id }); } }}>
              {body}
            </div>
          );
        })}
        {canApprove && (
          <button type="button" className={styles.addCard} onClick={() => setEditing({ id: null })}>
            <i className="ph ph-plus" style={{ fontSize: 16 }} />Ajouter un référentiel
          </button>
        )}
      </div>

      <Dialog open={!!editing} onClose={close} kicker="Certifications" title={cert ? `Modifier ${cert.standard}` : 'Nouveau référentiel'} width={520}>
        {editing && (
          <>
            <ActionForm action={saveCertification} onDone={close} onCancel={close} hidden={{ id: cert?.id }}>
              <FormRow>
                <Field name="standard" label="Référentiel">
                  <Input name="standard" defaultValue={cert?.standard} placeholder="Ex. ISO 9001:2015, MASE, ISO 3834-2" autoFocus />
                </Field>
                <Field name="domain" label="Domaine">
                  <Input name="domain" defaultValue={cert?.domain} placeholder="Ex. Qualité, Santé-sécurité" />
                </Field>
              </FormRow>
              <Field name="tone" label="État">
                <RadioSeg name="tone" defaultValue={cert?.tone ?? 'warn'} options={CERT_TONES.map((k) => [k, CERT_TONE_LABELS[k], certDot(k)] as const)} />
              </Field>
              <Field name="status" label="Statut affiché" hint="Ex. Certifié · suivi le 17/11/2026, Déploiement en cours.">
                <Input name="status" defaultValue={cert?.status} />
              </Field>
              <Field name="note" label="Note" hint="Organisme, cycle de certification, échéance visée…">
                <TextArea name="note" defaultValue={cert?.note} rows={2} />
              </Field>
            </ActionForm>
            {cert && (
              <DialogFooter>
                <DeleteButton run={() => deleteCertification(cert.id)} onDone={close} label="Supprimer le référentiel" />
              </DialogFooter>
            )}
          </>
        )}
      </Dialog>
    </>
  );
}
