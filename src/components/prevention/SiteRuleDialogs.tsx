'use client';

import { useState } from 'react';
import { DialogButton } from '@/components/Dialog';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { ActionForm, Field, Select } from '@/components/form';
import type { SiteRuleView } from '@/lib/data/prevention';
import { saveSiteRule } from '@/server/sites';
import { MANDATORY_HOURS, SEVESO_LEVELS } from '@/lib/rules/prevention';
import { Notice } from './parts';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

// Règle de prévention d'un site : classement Seveso et plan de prévention « dès la première minute ».

function SiteRuleForm({ site, onDone, onCancel }: { site: SiteRuleView; onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [seveso, setSeveso] = useState(site.seveso ?? '');
  const [firstMinute, setFirstMinute] = useState(site.ppFromFirstMinute);
  return (
    <ActionForm action={saveSiteRule} onDone={onDone} onCancel={onCancel} hidden={{ siteId: site.id }}>
      <Field name="seveso" label={t('Classification')} hint={t('Establishment classified under the Seveso III directive (ICPE).')}>
        <Select name="seveso" options={SEVESO_LEVELS} value={seveso} onChange={(e) => setSeveso(e.target.value)} placeholder={t('Not classified')} autoFocus />
      </Field>
      <div style={{ display: 'grid', gap: 4 }}>
        <label className="vg-check">
          <input type="checkbox" name="ppFromFirstMinute" checked={firstMinute} onChange={(e) => setFirstMinute(e.target.checked)} />
          <span className="vg-check-box"><i className="ph ph-check" aria-hidden /></span>
          <span>{t('Require a written prevention plan from the first minute of the intervention')}</span>
        </label>
        <span className="vg-field-hint" style={{ paddingLeft: 24, marginTop: 0 }}>
          {fill(t('Internal rule, stricter than the French Labour Code (R. 4512-7: {hours} h over 12 months or dangerous work).'), { hours: MANDATORY_HOURS })}
        </span>
      </div>
      <Notice tone={firstMinute ? 'accent' : 'neutral'} icon={firstMinute ? 'ph-shield-warning' : 'ph-info'}>
        {firstMinute
          ? t('Any intervention of an external company requires a written plan, drawn up after the joint inspection and signed by both companies before the work starts, whatever its duration and nature. The fire and test permits of an external company are issued only with a signed plan covering their validity.')
          : fill(t('Legal rule: written plan required from {hours} h of work over 12 months or for dangerous work (order of 19 March 1993).'), { hours: MANDATORY_HOURS })}
      </Notice>
      {seveso === 'seuil_haut' && !firstMinute && (
        <Notice tone="warn">
          {t('Upper-tier Seveso establishment without the “from the first minute” rule: check consistency with the major-accident prevention policy and the safety management system.')}
        </Notice>
      )}
    </ActionForm>
  );
}

/** « Modifier » la règle de prévention d'un site (animateur QHSE, direction). */
export function SiteRuleButton({ site }: { site: SiteRuleView }) {
  const { t } = useI18n();
  return (
    <DialogButton label={t('Edit')} icon="ph-pencil-simple" className="btn btn-ghost vg-btn-sm" title={site.label} kicker={t('Site rule · prevention plans')} width={560}>
      {(close) => (
        <>
          <SiteRuleForm site={site} onDone={close} onCancel={close} />
          <div style={{ marginTop: 12 }}><LazyChangeLog entity="site" id={site.id} title={t('Site history')} /></div>
        </>
      )}
    </DialogButton>
  );
}
