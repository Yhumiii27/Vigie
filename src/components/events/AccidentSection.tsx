import type { ReactNode } from 'react';
import { ToneTag } from '@/components/ui';
import type { EventDetail } from '@/lib/data/events';
import { fmtDate } from '@/lib/dates';
import { BenignRegisterBlock } from './BenignRegister';
import { CancelCpamWaiverButton, CpamWaiverButton } from './CpamWaiver';
import { FieldGrid, Restricted } from './FieldGrid';
import { MedicalAttachments } from './MedicalAttachments';
import { injuryLabel } from '@/lib/rules/events';
import { getI18n } from '@/i18n/server';
import { msgT } from '@/i18n/msg';
import { fill, type T } from '@/i18n/translate';

/** « AAAA-MM-JJTHH:mm » → « 08/09/2026 à 16:10 ». */
const fmtLocal = (local: string, t: T) => fill(t('{date} at {time}'), { date: fmtDate(local.slice(0, 10)), time: local.slice(11, 16) });
const text = { margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty', whiteSpace: 'pre-line' } as const;

/**
 * Accident du travail sur la fiche (EVT-01) : rubriques de la déclaration (victime, heure, horaire, connaissance par
 * l'employeur, activité, circonstances, témoins, tiers), puis, pour l'animateur QHSE et la direction, données de santé :
 * blessure, lésions, soins, déclaration CPAM (échéance de 48 h, absence de déclaration motivée), réserves, registre des
 * accidents bénins et pièces médicales (SEC-06). Les autres rôles ne reçoivent que la mention « Données restreintes ».
 */
export async function AccidentSection({ detail, canEdit, today }: { detail: EventDetail; canEdit: boolean; today: string }) {
  const { t } = await getI18n();
  const { event: e, accident, cpam, health, register, medical, attachments, lock } = detail;
  if (!accident) return null;
  const fields: [string, ReactNode][] = [
    [t('Victim'), (
      <span key="victim" style={{ display: 'grid', gap: 2 }}>
        <span>{accident.victim}</span>
        {accident.victimKind !== '—' && <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{accident.victimKind}</span>}
      </span>
    )],
    [t('Time'), accident.occurredTime ?? '—'],
    [t('Working hours'), accident.workSchedule ?? '—'],
    [t('Known to the employer on'), accident.knownAt.isDefault ? fill(t('{date} · when recorded in Vigie'), { date: fmtLocal(accident.knownAt.local, t) }) : fmtLocal(accident.knownAt.local, t)],
    [t('Victim’s activity'), accident.activity ?? '—'],
    [t('Third party involved'), accident.thirdParty ?? t('None')],
  ];
  const healthFields: [string, ReactNode][] = [];
  if (health) {
    healthFields.push([t('Injury'), e.injury === 'arret' && e.lostDays != null ? `${injuryLabel(e.injury)} · ${fill(e.lostDays > 1 ? t('{n} days lost') : t('{n} day lost'), { n: e.lostDays })}` : injuryLabel(e.injury)]);
    healthFields.push([t('Lesions (nature · site)'), e.lesionNature || e.lesionSite ? `${e.lesionNature ?? '—'} · ${e.lesionSite ?? '—'}` : '—']);
    healthFields.push([t('Care given'), e.careGiven ?? '—']);
    if (cpam) {
      healthFields.push([t('CPAM declaration'), (
        <span key="cpam" style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
          {cpam.declaredOn ? <span>{msgT(t)(cpam.text)}</span> : <ToneTag tone={cpam.tone}>{msgT(t)(cpam.text)}</ToneTag>}
          {cpam.waiver && (
            <span style={{ fontSize: 12, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
              {t('Reason: ')}<em>{cpam.waiver.reason}</em>{fill(t(' — {by}, on {date}'), { by: cpam.waiver.by, date: fmtDate(cpam.waiver.on) })}
            </span>
          )}
          {canEdit && cpam.canWaive && <CpamWaiverButton eventId={e.id} duty={cpam.duty} />}
          {canEdit && cpam.waiver && <CancelCpamWaiverButton eventId={e.id} />}
        </span>
      )]);
      if (cpam.reserves) healthFields.push([t('Reasoned reservations'), <ToneTag key="reserves" tone={cpam.reserves.tone}>{msgT(t)(cpam.reserves.text)}</ToneTag>]);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h6 className="vg-h6">{t('Occupational accident · declaration')}</h6>
      <FieldGrid fields={fields} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        <div><h6 className="vg-h6" style={{ marginBottom: 4 }}>{t('Circumstances')}</h6><p style={text}>{accident.circumstances || '—'}</p></div>
        <div><h6 className="vg-h6" style={{ marginBottom: 4 }}>{t('Witnesses')}</h6><p style={text}>{accident.witnesses || t('No witness given')}</p></div>
      </div>
      {health ? (
        <div className="vg-inset" style={{ display: 'grid', gap: 12, padding: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--color-neutral-400)' }}>
            <i className="ph ph-lock-simple" style={{ fontSize: 13 }} aria-hidden />{t('Health data · QHSE coordinator and senior management')}
          </span>
          <FieldGrid fields={healthFields} min={200} />
          {register && (register.entry || register.canRegister || (canEdit && register.hint)) && (
            <div style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
              <h6 className="vg-h6">{t('Minor accident register')}</h6>
              <BenignRegisterBlock eventId={e.id} entry={register.entry} canRegister={canEdit && register.canRegister} canEdit={canEdit} firstAiders={register.firstAiders}
                href={register.href} locked={!!lock} defaultCareAt={`${e.occurredOn}T${e.occurredTime ?? '00:00'}`} today={today}
                hint={canEdit ? register.hint : null} />
            </div>
          )}
          <MedicalAttachments eventId={e.id} files={medical} others={attachments} canEdit={canEdit && !lock} />
        </div>
      ) : (
        <FieldGrid fields={[[t('Injury, lesions, care, CPAM declaration'), <Restricted key="health" />]]} />
      )}
    </div>
  );
}
