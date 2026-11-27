'use client';

import { useState } from 'react';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select } from '@/components/form';
import { Icon } from '@/components/ui';
import { TONE } from '@/lib/domain';
import type { ConsumptionRecord, EnvironmentData } from '@/lib/data/environment';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { saveConsumptionMonth } from '@/server/environment';
import { CONSUMPTION_KINDS, fmtDelta, fmtNum, monthInitial, monthLong, monthShort, type ConsumptionKind } from '@/lib/rules/environment';
import { Note, muted, rowOpener, shortSite } from './parts';
import { useI18n } from '@/i18n/client';
import { labelT } from '@/i18n/labels';
import { fill } from '@/i18n/translate';

type Consumption = EnvironmentData['consumption'];
type KindSummary = Consumption['kinds'][number];
type Opt = readonly (readonly [string, string])[];

/** Grandes valeurs en MWh, sinon dans l'unité du relevé. */
function fmtTotal(value: number, unit: string) {
  return unit === 'kWh' && value >= 10_000 ? `${fmtNum(value / 1000)} MWh` : `${fmtNum(value)} ${unit}`;
}

// ─── Graphiques (une série par énergie, 12 derniers mois) ───────────────────

function KindChart({ k, year }: { k: KindSummary; year: number }) {
  const { t } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...k.bars.map((b) => b.value ?? 0));
  const lastWithData = k.bars.map((b) => b.value != null).lastIndexOf(true);
  const shown = hover ?? (lastWithData >= 0 ? lastWithData : null);
  const bar = shown != null ? k.bars[shown] : null;
  const deltaTone = k.delta == null ? null : k.delta > 0.005 ? TONE.warn.dot : k.delta < -0.005 ? TONE.ok.dot : 'var(--color-neutral-400)';
  const hasData = k.bars.some((b) => b.value != null);

  return (
    <div className="card" style={{ gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span className="card-title" style={{ fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name={k.icon} size={15} style={{ color: 'var(--color-neutral-400)' }} />{labelT(t)(k.label)}
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-neutral-500)', fontVariantNumeric: 'tabular-nums' }} aria-live="polite">
          {bar ? <>{monthShort(bar.month)} · <span style={{ color: 'var(--color-text)' }}>{bar.value != null ? `${fmtNum(bar.value)} ${k.unit}` : t('not entered#reading')}</span></> : k.unit}
        </span>
      </div>
      {hasData ? (
        <div role="img" aria-label={fill(t('{kind}, last 12 months: {values}'), { kind: labelT(t)(k.label), values: k.bars.map((b) => `${monthLong(b.month)} ${b.value != null ? `${fmtNum(b.value)} ${k.unit}` : t('not entered#reading')}`).join(' ; ') })}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 2, alignItems: 'end' }}
          onMouseLeave={() => setHover(null)}>
          {k.bars.map((b, i) => (
            <div key={b.month} onMouseEnter={() => setHover(i)} style={{ display: 'grid', gap: 4, justifyItems: 'center', cursor: 'default' }}>
              <div style={{ height: 64, width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                {b.value != null ? (
                  <div style={{
                    width: 'min(14px, 100%)', height: `${Math.max(2, (b.value / max) * 64)}px`, borderRadius: '4px 4px 0 0',
                    background: i === shown ? 'var(--color-accent)' : 'var(--color-accent-600)',
                  }} />
                ) : (
                  <div style={{ width: 'min(14px, 100%)', height: 2, background: 'var(--color-neutral-800)' }} title={t('Not entered#reading')} />
                )}
              </div>
              <span style={{ fontSize: 11, color: i === shown ? 'var(--color-text)' : 'var(--vg-text-muted)' }}>{monthInitial(b.month)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="vg-inset" style={{ padding: '18px 12px', fontSize: 12, color: 'var(--color-neutral-500)', textAlign: 'center' }}>{t('No reading over the last 12 months.')}</div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 11.5, color: 'var(--color-neutral-400)' }}>
        <span>{t('12 months: ')}<span style={{ color: 'var(--color-text)' }}>{fmtTotal(k.total12, k.unit)}</span></span>
        {k.period && (
          <span>
            {k.period}{t(': ')}<span style={{ color: 'var(--color-text)' }}>{fmtTotal(k.current, k.unit)}</span>
            {k.delta != null
              ? <span style={{ color: deltaTone ?? undefined, marginLeft: 6 }}>{fmtDelta(k.delta)} {fill(t('vs {id}'), { id: year - 1 })}</span>
              : <span style={{ marginLeft: 6, color: 'var(--vg-text-muted)' }}>{t('previous year incomplete')}</span>}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Onglet « Consommations » ───────────────────────────────────────────────

export function ConsumptionPanel({ data, year, canManage, sites, showSite }: {
  data: Consumption; year: number; canManage: boolean; sites: Opt; showSite: boolean;
}) {
  const { t } = useI18n();
  const [edit, setEdit] = useState<{ siteId: string; month: string } | null>(null);
  const close = () => setEdit(null);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {data.kinds.map((k) => <KindChart key={k.key} k={k} year={year} />)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${showSite ? 380 : 480}px, 1fr))`, gap: 12, alignItems: 'start' }}>
        {data.tables.map((tb) => (
          <div key={tb.siteId} className="card" style={{ padding: '10px 14px', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <span className="card-title" style={{ fontSize: 14 }}>{shortSite(tb.site)}</span>
              <span style={muted}>{tb.archived ? t('Site archived · last 12 months') : tb.missingMonths ? fill(t('{n} months without a reading'), { n: tb.missingMonths }) : t('Last 12 months')}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ fontSize: 12.5, minWidth: 360 }}>
                <thead>
                  <tr>
                    <th>{t('Month')}</th>
                    {CONSUMPTION_KINDS.map((k) => <th key={k.key} style={{ textAlign: 'right' }}>{labelT(t)(k.label)} ({k.unit})</th>)}
                  </tr>
                </thead>
                <tbody>
                  {tb.rows.map((r) => {
                    const empty = CONSUMPTION_KINDS.every((k) => r.values[k.key] == null);
                    // Site archivé : relevés consultables, plus de saisie.
                    const editable = canManage && !tb.archived;
                    return (
                      <tr key={r.month} {...(editable ? rowOpener(() => setEdit({ siteId: tb.siteId, month: r.month })) : {})}>
                        <td style={{ whiteSpace: 'nowrap', textTransform: 'capitalize' }}>{monthLong(r.month)}</td>
                        {empty && tb.archived ? (
                          <td colSpan={CONSUMPTION_KINDS.length} style={{ textAlign: 'right', color: 'var(--vg-text-muted)' }}>—</td>
                        ) : empty ? (
                          <td colSpan={CONSUMPTION_KINDS.length} style={{ textAlign: 'right', color: TONE.warn.fg }}>
                            {canManage ? t('Not entered · click to enter') : t('Not entered#reading')}
                          </td>
                        ) : CONSUMPTION_KINDS.map((k) => (
                          <td key={k.key} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {r.values[k.key] != null ? fmtNum(r.values[k.key]!) : <span style={{ color: 'var(--vg-text-muted)' }}>—</span>}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  <tr style={{ fontWeight: 500 }}>
                    <td>{t('Total 12 months')}</td>
                    {CONSUMPTION_KINDS.map((k) => (
                      <td key={k.key} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{tb.totals[k.key] ? fmtNum(tb.totals[k.key]) : '—'}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!edit} onClose={close} width={560} kicker={t('Consumption')} title={t('Enter a month')}>
        {edit && <MonthForm key={`${edit.siteId}|${edit.month}`} records={data.records} sites={sites} siteId={edit.siteId} month={edit.month} maxMonth={data.maxMonth} onDone={close} onCancel={close} />}
      </Dialog>
    </div>
  );
}

/** Bouton « Saisir un mois ». */
export function ConsumptionMonthButton({ records, sites, defaultSite, defaultMonth, maxMonth }: {
  records: ConsumptionRecord[]; sites: Opt; defaultSite: string; defaultMonth: string; maxMonth: string;
}) {
  const { t } = useI18n();
  return (
    <DialogButton label={t('Enter a month')} icon="ph-plus" className="btn btn-primary vg-btn-sm" title={t('Enter a month')} kicker={t('Consumption')} width={560}>
      {(close) => <MonthForm records={records} sites={sites} siteId={defaultSite} month={defaultMonth} maxMonth={maxMonth} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

// ─── Saisie mensuelle ───────────────────────────────────────────────────────

type Values = Record<ConsumptionKind, string>;

function valuesFor(records: ConsumptionRecord[], siteId: string, month: string): Values {
  const key = `${month.slice(0, 7)}-01`;
  return Object.fromEntries(CONSUMPTION_KINDS.map((k) => {
    const r = records.find((c) => c.siteId === siteId && c.month === key && c.kind === k.key);
    return [k.key, r ? String(r.value) : ''];
  })) as Values;
}

function MonthForm({ records, sites, siteId: initialSite, month: initialMonth, maxMonth, onDone, onCancel }: {
  records: ConsumptionRecord[]; sites: Opt; siteId: string; month: string; maxMonth: string; onDone: () => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const [siteId, setSiteId] = useState(initialSite);
  const [month, setMonth] = useState(initialMonth.slice(0, 7));
  const [values, setValues] = useState<Values>(() => valuesFor(records, initialSite, initialMonth));
  const existing = valuesFor(records, siteId, month);
  const hasExisting = /^\d{4}-\d{2}$/.test(month) && CONSUMPTION_KINDS.some((k) => existing[k.key] !== '');
  const cleared = CONSUMPTION_KINDS.filter((k) => existing[k.key] !== '' && values[k.key].trim() === '');
  const clearedNames = cleared.map((k) => labelT(t)(k.label).toLowerCase());
  const clearedList = clearedNames.length > 1 ? `${clearedNames.slice(0, -1).join(', ')}${t(' and ')}${clearedNames.at(-1)}` : clearedNames[0];

  const reload = (s: string, m: string) => {
    setSiteId(s);
    setMonth(m);
    if (/^\d{4}-\d{2}$/.test(m)) setValues(valuesFor(records, s, m));
  };

  return (
    <ActionForm action={saveConsumptionMonth} onDone={onDone} onCancel={onCancel} submitLabel={t('Save the readings')}>
      <FormRow>
        <Field name="siteId" label={t('Site')}>
          <Select name="siteId" options={sites} value={siteId} onChange={(e) => reload(e.target.value, month)} />
        </Field>
        <Field name="month" label={t('Month')}>
          <Input name="month" type="month" value={month} max={maxMonth.slice(0, 7)} placeholder={t('YYYY-MM')} onChange={(e) => reload(siteId, e.target.value)} style={{ colorScheme: 'dark' }} />
        </Field>
      </FormRow>
      <FormRow cols={3}>
        {CONSUMPTION_KINDS.map((k) => (
          <Field key={k.key} name={k.key} label={`${labelT(t)(k.label)} (${k.unit})`}>
            <Input name={k.key} type="number" min={0} step="any" inputMode="decimal" value={values[k.key]}
              onChange={(e) => setValues((v) => ({ ...v, [k.key]: e.target.value }))} placeholder="—" />
          </Field>
        ))}
      </FormRow>
      <Note icon={cleared.length ? 'ph-warning' : 'ph-info'} tone={cleared.length ? 'warn' : undefined}>
        {cleared.length
          ? fill(cleared.length > 1 ? t('Readings {list} emptied: they will be deleted when saved.') : t('Reading {list} emptied: it will be deleted when saved.'), { list: clearedList })
          : hasExisting
            ? fill(t('Readings already entered for {month}: the changed values replace the previous ones.'), { month: monthLong(`${month}-01`) })
            : t('Readings from the invoices or the meters of the site. Leave empty an energy the site does not use.')}
      </Note>
      {/* Historique des relevés du mois (DOC-10), chargé à l'ouverture ; rechargé au changement de site ou de mois. */}
      {hasExisting && <LazyChangeLog key={`${siteId}|${month}`} entity="consumption" id={`${siteId}|${month}-01`} title={t('History of the readings of the month')} />}
    </ActionForm>
  );
}
