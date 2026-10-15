'use client';

import { DialogButton } from '@/components/Dialog';
import { Icon, ToneTag } from '@/components/ui';
import { daysBetween, fmtDate } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import type { SkillAlert } from '@/lib/data/skills';
import { Fact, RenewalTag, SkillDot, lcfirst, period, stateDetail } from './common';
import { isBlocking, lapseFor, type Lapse } from './rules';

const HEADLINE: Record<Lapse, string> = {
  missing: 'Salarié au titre manquant affecté à une activité Keystone',
  expired: 'Salarié au titre expiré affecté à une activité Keystone',
  before: 'Titre expirant avant une affectation Keystone',
  during: 'Titre expirant pendant une affectation Keystone',
};

/** « expiré depuis le 28/09/2026 », « expire le 10/10/2026, avant l'affectation »… */
function lapseDetail(a: SkillAlert) {
  const on = a.expiresOn ? fmtDate(a.expiresOn) : '';
  switch (a.lapse) {
    case 'missing': return 'requis, jamais suivi';
    case 'expired': return `expiré depuis le ${on}`;
    case 'before': return `expire le ${on}, avant l'affectation`;
    case 'during': return `expire le ${on}, pendant l'affectation`;
  }
}

/** Fenêtre « Voir l'affectation » : affectation Keystone et état de tous les titres requis du salarié. */
function AssignmentView({ alert, today }: { alert: SkillAlert; today: string }) {
  const a = alert.assignment;
  const days = daysBetween(a.startOn, a.endOn) + 1;
  const toStart = daysBetween(today, a.startOn);
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px 16px' }}>
        <Fact label="Projet">{a.project}</Fact>
        <Fact label="Activité">{a.activity}</Fact>
        <Fact label="Dates">
          Du {fmtDate(a.startOn)} au {fmtDate(a.endOn)}
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
            {days} jour{days > 1 ? 's' : ''} · {toStart > 0 ? `début dans ${toStart} j` : toStart === 0 ? "débute aujourd'hui" : 'en cours'}
          </span>
        </Fact>
        <Fact label="Salarié">
          {alert.person.name}
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{alert.person.job}</span>
        </Fact>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <h6 className="vg-h6">Titres requis</h6>
        {alert.required.length === 0 ? (
          <div className="vg-inset" style={{ padding: 10, fontSize: 12, color: 'var(--color-neutral-500)' }}>Aucun titre requis pour ce salarié.</div>
        ) : (
          <table className="table" style={{ fontSize: 12.5 }}>
            <tbody>
              {alert.required.map((c) => {
                // Titre absent, expiré ou expirant avant le début (bloquant), ou expirant avant la fin de l'affectation.
                const lapse = lapseFor(c.state, c.expiresOn, a, today);
                const missing = isBlocking(lapse);
                const lapses = lapse === 'during';
                return (
                  <tr key={c.title.id}>
                    <td style={{ width: 30, paddingRight: 0 }}><SkillDot state={c.state} size={20} /></td>
                    <td>
                      <span style={{ display: 'block' }}>{c.title.label}</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{stateDetail(c, today)}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {missing && <ToneTag tone="danger">Bloquant</ToneTag>}
                        {lapses && <ToneTag tone="warn">Expire pendant l&apos;affectation</ToneTag>}
                        {c.renewal && <RenewalTag renewal={c.renewal} state={c.state} />}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
        <Icon name="ph-arrows-clockwise" size={12} style={{ marginRight: 5, verticalAlign: -1 }} />Affectation lue dans le planning Keystone.
      </p>
    </div>
  );
}

/**
 * Bandeaux d'alerte : salarié affecté à une activité Keystone sans titre requis valide pendant toute l'affectation.
 * Aucune action QSE n'est proposée (recyclages gérés par le service RH, réponses du service QHSE du 15/10/2026) ; une
 * action de recyclage reprise encore rattachée reste affichée en lien.
 */
export function SkillAlerts({ alerts, today }: { alerts: SkillAlert[]; today: string }) {
  return (
    <>
      {alerts.map((a) => {
        // Expiration en cours d'affectation : avertissement ; titre absent dès le début : alerte.
        const tone = isBlocking(a.lapse) ? TONE.danger.dot : TONE.warn.dot;
        return (
          <div key={`${a.person.id}-${a.titleId}-${a.assignment.id}`} className="card" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '12px 14px', border: `1px solid ${tone}` }}>
            <Icon name="ph-warning" size={22} style={{ color: tone }} />
            <div style={{ display: 'grid', gap: 2, flex: 1, minWidth: 240 }}>
              <span style={{ fontWeight: 500 }}>{HEADLINE[a.lapse]}</span>
              <span style={{ fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
                {a.person.name} — {lcfirst(a.title)} {lapseDetail(a)} — affecté à l&apos;activité « {a.assignment.activity} » du projet {a.assignment.project}, {period(a.assignment.startOn, a.assignment.endOn)} (planning Keystone).
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none', flexWrap: 'wrap' }}>
              <DialogButton label="Voir l'affectation" title={`Affectation de ${a.person.name}`} kicker="Planning Keystone" width={560}>
                {() => <AssignmentView alert={a} today={today} />}
              </DialogButton>
              {a.renewal && <RenewalTag renewal={a.renewal} state={a.currentState} />}
            </div>
          </div>
        );
      })}
    </>
  );
}

