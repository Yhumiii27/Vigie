'use client';

import { DialogButton } from '@/components/Dialog';
import { Icon, ToneTag } from '@/components/ui';
import { daysBetween, fmtDate } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import type { SkillAlert } from '@/lib/data/skills';
import { Fact, RenewalTag, SkillDot, lcfirst, period, stateDetail } from './common';
import { isBlocking, lapseFor, type Lapse } from '@/lib/rules/skills';
import { useI18n } from '@/i18n/client';
import { fill, type T } from '@/i18n/translate';

const HEADLINE: Record<Lapse, string> = {
  missing: 'Employee with a missing title assigned to a Keystone activity',
  expired: 'Employee with an expired title assigned to a Keystone activity',
  before: 'Title expiring before a Keystone assignment',
  during: 'Title expiring during a Keystone assignment',
};

/** « expiré depuis le 28/09/2026 », « expire le 10/10/2026, avant l'affectation »… */
function lapseDetail(a: SkillAlert, t: T) {
  const on = a.expiresOn ? fmtDate(a.expiresOn) : '';
  switch (a.lapse) {
    case 'missing': return t('required, never attended');
    case 'expired': return fill(t('expired since {date}'), { date: on });
    case 'before': return fill(t('expires on {date}, before the assignment'), { date: on });
    case 'during': return fill(t('expires on {date}, during the assignment'), { date: on });
  }
}

/** Fenêtre « Voir l'affectation » : affectation Keystone et état de tous les titres requis du salarié. */
function AssignmentView({ alert, today }: { alert: SkillAlert; today: string }) {
  const { t } = useI18n();
  const a = alert.assignment;
  const days = daysBetween(a.startOn, a.endOn) + 1;
  const toStart = daysBetween(today, a.startOn);
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px 16px' }}>
        <Fact label={t('Project')}>{a.project}</Fact>
        <Fact label={t('Activity')}>{a.activity}</Fact>
        <Fact label={t('Dates')}>
          {fill(t('From {start} to {end}'), { start: fmtDate(a.startOn), end: fmtDate(a.endOn) })}
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
            {fill(days > 1 ? t('{n} days') : t('{n} day'), { n: days })} · {toStart > 0 ? fill(t('starts in {n} d'), { n: toStart }) : toStart === 0 ? t('starts today') : t('in progress')}
          </span>
        </Fact>
        <Fact label={t('Employee')}>
          {alert.person.name}
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{alert.person.job}</span>
        </Fact>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <h6 className="vg-h6">{t('Required titles')}</h6>
        {alert.required.length === 0 ? (
          <div className="vg-inset" style={{ padding: 10, fontSize: 12, color: 'var(--color-neutral-500)' }}>{t('No title required for this employee.')}</div>
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
                      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{stateDetail(c, today, t)}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {missing && <ToneTag tone="danger">{t('Blocking#male')}</ToneTag>}
                        {lapses && <ToneTag tone="warn">{t('Expires during the assignment')}</ToneTag>}
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
        <Icon name="ph-arrows-clockwise" size={12} style={{ marginRight: 5, verticalAlign: -1 }} />{t('Assignment read from the Keystone schedule.')}
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
  const { t } = useI18n();
  return (
    <>
      {alerts.map((a) => {
        // Expiration en cours d'affectation : avertissement ; titre absent dès le début : alerte.
        const tone = isBlocking(a.lapse) ? TONE.danger.dot : TONE.warn.dot;
        return (
          <div key={`${a.person.id}-${a.titleId}-${a.assignment.id}`} className="card" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '12px 14px', border: `1px solid ${tone}` }}>
            <Icon name="ph-warning" size={22} style={{ color: tone }} />
            <div style={{ display: 'grid', gap: 2, flex: 1, minWidth: 240 }}>
              <span style={{ fontWeight: 500 }}>{t(HEADLINE[a.lapse])}</span>
              <span style={{ fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
                {a.person.name} — {lcfirst(a.title)} {lapseDetail(a, t)} — {fill(t('assigned to the activity “{activity}” of the project {project}, {period} (Keystone schedule).'), { activity: a.assignment.activity, project: a.assignment.project, period: period(a.assignment.startOn, a.assignment.endOn) })}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none', flexWrap: 'wrap' }}>
              <DialogButton label={t('See the assignment')} title={fill(t('Assignment of {name}'), { name: a.person.name })} kicker={t('Keystone schedule')} width={560}>
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

