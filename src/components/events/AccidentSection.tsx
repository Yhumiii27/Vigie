import type { ReactNode } from 'react';
import { ToneTag } from '@/components/ui';
import type { EventDetail } from '@/lib/data/events';
import { fmtDate } from '@/lib/dates';
import { BenignRegisterBlock } from './BenignRegister';
import { CancelCpamWaiverButton, CpamWaiverButton } from './CpamWaiver';
import { FieldGrid, Restricted } from './FieldGrid';
import { MedicalAttachments } from './MedicalAttachments';
import { injuryLabel } from '@/lib/rules/events';

/** « AAAA-MM-JJTHH:mm » → « 08/09/2026 à 16:10 ». */
const fmtLocal = (local: string) => `${fmtDate(local.slice(0, 10))} à ${local.slice(11, 16)}`;
const text = { margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty', whiteSpace: 'pre-line' } as const;

/**
 * Accident du travail sur la fiche (EVT-01) : rubriques de la déclaration (victime, heure, horaire, connaissance par
 * l'employeur, activité, circonstances, témoins, tiers), puis, pour l'animateur QHSE et la direction, données de santé :
 * blessure, lésions, soins, déclaration CPAM (échéance de 48 h, absence de déclaration motivée), réserves, registre des
 * accidents bénins et pièces médicales (SEC-06). Les autres rôles ne reçoivent que la mention « Données restreintes ».
 */
export function AccidentSection({ detail, canEdit, today }: { detail: EventDetail; canEdit: boolean; today: string }) {
  const { event: e, accident, cpam, health, register, medical, attachments, lock } = detail;
  if (!accident) return null;
  const fields: [string, ReactNode][] = [
    ['Victime', (
      <span key="victim" style={{ display: 'grid', gap: 2 }}>
        <span>{accident.victim}</span>
        {accident.victimKind !== '—' && <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{accident.victimKind}</span>}
      </span>
    )],
    ['Heure', accident.occurredTime ?? '—'],
    ['Horaire de travail', accident.workSchedule ?? '—'],
    ["Connu de l'employeur le", accident.knownAt.isDefault ? `${fmtLocal(accident.knownAt.local)} · à l'enregistrement dans Vigie` : fmtLocal(accident.knownAt.local)],
    ['Activité de la victime', accident.activity ?? '—'],
    ['Tiers impliqué', accident.thirdParty ?? 'Aucun'],
  ];
  const healthFields: [string, ReactNode][] = [];
  if (health) {
    healthFields.push(['Blessure', e.injury === 'arret' && e.lostDays != null ? `${injuryLabel(e.injury)} · ${e.lostDays} j perdu${e.lostDays > 1 ? 's' : ''}` : injuryLabel(e.injury)]);
    healthFields.push(['Lésions (nature · siège)', e.lesionNature || e.lesionSite ? `${e.lesionNature ?? '—'} · ${e.lesionSite ?? '—'}` : '—']);
    healthFields.push(['Soins dispensés', e.careGiven ?? '—']);
    if (cpam) {
      healthFields.push(['Déclaration CPAM', (
        <span key="cpam" style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
          {cpam.declaredOn ? <span>{cpam.label}</span> : <ToneTag tone={cpam.tone}>{cpam.label}</ToneTag>}
          {cpam.waiver && (
            <span style={{ fontSize: 12, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
              Motif : <em>{cpam.waiver.reason}</em> — {cpam.waiver.by}, le {fmtDate(cpam.waiver.on)}
            </span>
          )}
          {canEdit && cpam.canWaive && <CpamWaiverButton eventId={e.id} duty={cpam.duty} />}
          {canEdit && cpam.waiver && <CancelCpamWaiverButton eventId={e.id} />}
        </span>
      )]);
      if (cpam.reserves) healthFields.push(['Réserves motivées', <ToneTag key="reserves" tone={cpam.reserves.tone}>{cpam.reserves.label}</ToneTag>]);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h6 className="vg-h6">Accident du travail · déclaration</h6>
      <FieldGrid fields={fields} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        <div><h6 className="vg-h6" style={{ marginBottom: 4 }}>Circonstances</h6><p style={text}>{accident.circumstances || '—'}</p></div>
        <div><h6 className="vg-h6" style={{ marginBottom: 4 }}>Témoins</h6><p style={text}>{accident.witnesses || 'Aucun témoin indiqué'}</p></div>
      </div>
      {health ? (
        <div className="vg-inset" style={{ display: 'grid', gap: 12, padding: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--color-neutral-400)' }}>
            <i className="ph ph-lock-simple" style={{ fontSize: 13 }} aria-hidden />Données de santé · animateur QHSE et direction
          </span>
          <FieldGrid fields={healthFields} min={200} />
          {register && (register.entry || register.canRegister || (canEdit && register.hint)) && (
            <div style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
              <h6 className="vg-h6">Registre des accidents bénins</h6>
              <BenignRegisterBlock eventId={e.id} entry={register.entry} canRegister={canEdit && register.canRegister} firstAiders={register.firstAiders}
                href={register.href} locked={!!lock} defaultCareAt={`${e.occurredOn}T${e.occurredTime ?? '00:00'}`} today={today}
                hint={canEdit ? register.hint : null} />
            </div>
          )}
          <MedicalAttachments eventId={e.id} files={medical} others={attachments} canEdit={canEdit && !lock} />
        </div>
      ) : (
        <FieldGrid fields={[['Blessure, lésions, soins, déclaration CPAM', <Restricted key="health" />]]} />
      )}
    </div>
  );
}
