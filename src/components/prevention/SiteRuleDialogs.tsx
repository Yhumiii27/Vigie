'use client';

import { useState } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, Select } from '@/components/form';
import type { SiteRuleView } from '@/lib/data/prevention';
import { saveSiteRule } from '@/server/sites';
import { MANDATORY_HOURS, SEVESO_LEVELS } from './model';
import { Notice } from './parts';

// Règle de prévention d'un site : classement Seveso et plan de prévention « dès la première minute ».

function SiteRuleForm({ site, onDone, onCancel }: { site: SiteRuleView; onDone: () => void; onCancel: () => void }) {
  const [seveso, setSeveso] = useState(site.seveso ?? '');
  const [firstMinute, setFirstMinute] = useState(site.ppFromFirstMinute);
  return (
    <ActionForm action={saveSiteRule} onDone={onDone} onCancel={onCancel} hidden={{ siteId: site.id }}>
      <Field name="seveso" label="Classement" hint="Établissement classé au titre de la directive Seveso III (ICPE).">
        <Select name="seveso" options={SEVESO_LEVELS} value={seveso} onChange={(e) => setSeveso(e.target.value)} placeholder="Non classé" autoFocus />
      </Field>
      <div style={{ display: 'grid', gap: 4 }}>
        <label className="vg-check">
          <input type="checkbox" name="ppFromFirstMinute" checked={firstMinute} onChange={(e) => setFirstMinute(e.target.checked)} />
          <span className="vg-check-box"><i className="ph ph-check" /></span>
          <span>Exiger un plan de prévention écrit dès la première minute d&apos;intervention</span>
        </label>
        <span className="vg-field-hint" style={{ paddingLeft: 24, marginTop: 0 }}>
          Règle interne, plus stricte que le Code du travail (R. 4512-7 : {MANDATORY_HOURS} h sur 12 mois ou travaux dangereux).
        </span>
      </div>
      <Notice tone={firstMinute ? 'accent' : 'neutral'} icon={firstMinute ? 'ph-shield-warning' : 'ph-info'}>
        {firstMinute
          ? "Toute intervention d'une entreprise extérieure exige un plan écrit, établi après l'inspection commune et signé par les deux entreprises avant le début des travaux, quelles que soient sa durée et sa nature. Les permis de feu et d'essai d'une entreprise extérieure ne sont délivrés qu'avec un plan signé couvrant leur validité."
          : `Règle légale : plan écrit obligatoire dès ${MANDATORY_HOURS} h de travaux sur 12 mois ou pour des travaux dangereux (arrêté du 19 mars 1993).`}
      </Notice>
      {seveso === 'seuil_haut' && !firstMinute && (
        <Notice tone="warn">
          Établissement Seveso seuil haut sans la règle « dès la première minute » : vérifiez la cohérence avec la politique de prévention des accidents majeurs et le système de gestion de la sécurité.
        </Notice>
      )}
    </ActionForm>
  );
}

/** « Modifier » la règle de prévention d'un site (animateur QHSE, direction). */
export function SiteRuleButton({ site }: { site: SiteRuleView }) {
  return (
    <DialogButton label="Modifier" icon="ph-pencil-simple" className="btn btn-ghost vg-btn-sm" title={site.label} kicker="Règle du site · plans de prévention" width={560}>
      {(close) => <SiteRuleForm site={site} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}
