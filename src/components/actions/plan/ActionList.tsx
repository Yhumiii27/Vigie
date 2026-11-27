import { Icon, ToneTag } from '@/components/ui';
import type { ActionListItem } from '@/lib/action-view';
import { fmtDate } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import { fmtDecimal } from '@/lib/forms';
import { ActionLink, ActionTableRow } from '../ActionPlanProvider';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';

// Vue Liste (vue générale par défaut, spec § 16) : N°, Date, Responsable, Avancement (retard signalé), Priorité, Date
// cible, Source, Domaine, libellé, Site ; pied : pointage et coûts des actions affichées. Vue des Abandonnées : motif et
// date d'abandon à la place de l'avancement.

const MUTED = { color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' } as const;
const EMPTY = { color: 'var(--color-neutral-500)', fontSize: 12, padding: '14px 8px' } as const;

/** Numéro : vrai lien (nouvel onglet possible), la ligne entière ouvre la fiche. */
async function NumberCell({ a }: { a: ActionListItem }) {
  const { t } = await getI18n();
  return (
    <td style={{ ...MUTED, color: 'var(--color-neutral-300)' }}>
      <ActionLink id={a.id} style={{ color: 'inherit', textDecoration: 'none' }}>{a.id}</ActionLink>
      {a.toComplete && <span title={fill(a.missing.length > 1 ? t('To complete: {n} missing fields') : t('To complete: {n} missing field'), { n: a.missing.length })} style={{ marginLeft: 5, color: TONE.warn.dot }}><Icon name="ph-question" size={12} /></span>}
    </td>
  );
}

function SourceCell({ a }: { a: ActionListItem }) {
  return (
    <td style={{ ...MUTED, maxWidth: 220 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: a.source ? undefined : TONE.warn.dot }}><Icon name={a.sourceIcon} size={12} />{a.sourceLabel}</span>
      {a.originRef && <span style={{ display: 'block', fontSize: 11, color: 'var(--vg-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.originRef}</span>}
    </td>
  );
}

async function ResponsableCell({ a }: { a: ActionListItem }) {
  const { t } = await getI18n();
  return (
    <td style={{ whiteSpace: 'nowrap' }}>
      {a.pilot}
      {a.pilotLeft && <span style={{ display: 'block', fontSize: 11, color: 'var(--color-neutral-500)' }}>{t('person who left')}</span>}
    </td>
  );
}

async function DueCell({ a }: { a: ActionListItem }) {
  const { t } = await getI18n();
  return (
    <td style={{ whiteSpace: 'nowrap' }}>
      <span style={{ color: a.late ? TONE.danger.dot : 'var(--color-neutral-300)' }} title={a.rescheduled ? t('Target date rescheduled') : t('Target date')}>{a.due}</span>
      {a.late && <span style={{ display: 'block', fontSize: 11, color: TONE.danger.dot }}>{fill(t('{n} d late'), { n: a.lateDays })}</span>}
      {a.status === 'terminee' && a.verifyDue && (
        <span style={{ display: 'block', fontSize: 11, color: a.verifyLate ? TONE.danger.dot : 'var(--color-neutral-500)' }} title={fill(t('Effectiveness check on {date}'), { date: a.verifyDue })}>
          {fill(t('Check {date}'), { date: a.verifyDue })}
        </span>
      )}
    </td>
  );
}

const money = (n: number) => `${fmtDecimal(n)} €`;

/** Liste des actions de l'affichage courant. */
export async function ActionList({ items, totals, filtered }: { items: ActionListItem[]; totals: { hours: number; estimatedCost: number; actualCost: number }; filtered: boolean }) {
  const { t } = await getI18n();
  return (
    <div className="card" style={{ padding: '6px 14px 10px' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 1100 }}>
          <thead>
            <tr><th>{t('No.')}</th><th>{t('Date')}</th><th>{t('Owner')}</th><th>{t('Progress')}</th><th>{t('Priority')}</th><th>{t('Target date')}</th><th>{t('Source#origin')}</th><th>{t('Domain')}</th><th>{t('Action')}</th><th>{t('Site')}</th></tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <ActionTableRow key={a.id} id={a.id}>
                <NumberCell a={a} />
                <td style={MUTED}>{a.opened}</td>
                <ResponsableCell a={a} />
                <td>
                  <ToneTag tone={a.tone} style={{ whiteSpace: 'nowrap' }}>{a.statusLabel}</ToneTag>
                  {a.late && <span style={{ display: 'block', fontSize: 11, color: 'var(--color-neutral-500)', marginTop: 2 }}>{a.avancement}</span>}
                </td>
                <td style={MUTED}>{a.priorityLabel ?? '—'}</td>
                <DueCell a={a} />
                <SourceCell a={a} />
                <td style={MUTED}>{a.domainLabel ?? '—'}</td>
                <td style={{ minWidth: 220, textWrap: 'pretty' }}>{a.label}</td>
                <td style={{ ...MUTED, color: a.siteId ? MUTED.color : TONE.warn.dot }}>{a.siteShort}</td>
              </ActionTableRow>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={10} style={EMPTY}>{filtered ? t('No action matches these criteria.') : t('No action to display.')}</td></tr>
            )}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={10} style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', paddingTop: 10 }}>
                  {[
                    fill(items.length > 1 ? t('{n} actions displayed') : t('{n} action displayed'), { n: items.length }),
                    fill(t('Time logged: {h} h'), { h: fmtDecimal(totals.hours) }),
                    fill(t('Estimated cost: {cost}'), { cost: money(totals.estimatedCost) }),
                    fill(t('Actual cost: {cost}'), { cost: money(totals.actualCost) }),
                  ].join(' · ')}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/** Affichage « Abandonnées » : date et motif d'abandon. */
export async function AbandonedList({ items, filtered }: { items: ActionListItem[]; filtered: boolean }) {
  const { t } = await getI18n();
  return (
    <div className="card" style={{ padding: '6px 14px 10px' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 900 }}>
          <thead><tr><th>{t('No.')}</th><th>{t('Action')}</th><th>{t('Source#origin')}</th><th>{t('Owner')}</th><th>{t('Site')}</th><th>{t('Abandoned on')}</th><th>{t('Reason')}</th></tr></thead>
          <tbody>
            {items.map((a) => (
              <ActionTableRow key={a.id} id={a.id}>
                <NumberCell a={a} />
                <td style={{ minWidth: 200, textWrap: 'pretty' }}>{a.label}</td>
                <SourceCell a={a} />
                <ResponsableCell a={a} />
                <td style={MUTED}>{a.siteShort}</td>
                <td style={MUTED}>{a.cancelledOn ? fmtDate(a.cancelledOn) : '—'}</td>
                <td style={{ color: 'var(--color-neutral-300)', textWrap: 'pretty', minWidth: 220 }}>{a.cancelReason ?? '—'}</td>
              </ActionTableRow>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={7} style={EMPTY}>{filtered ? t('No abandoned action matches these criteria.') : t('No abandoned action.')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
