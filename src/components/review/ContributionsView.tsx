'use client';

import Link from 'next/link';
import { useEffect, useOptimistic, useState, useTransition } from 'react';
import { ActionLink } from '@/components/audits/parts';
import { EntityFiles } from '@/components/EntityFiles';
import { Aside, CardHead, Icon, ToneTag } from '@/components/ui';
import { fmtDate, fmtDayMonth } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import type { MyContribution, MyContributions } from '@/lib/data/review';
import { setReviewItemDone } from '@/server/review';
import styles from './review.module.css';
import { SaveStatus, safeCall } from '@/components/feedback';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';

const muted = { fontSize: 11.5, color: 'var(--color-neutral-500)' } as const;

/** Revues de direction qui concernent la personne (« Mes contributions », AUD-04). */
export function ContributionsView({ data }: { data: MyContributions }) {
  const { t } = useI18n();
  const { focus } = data;
  useEffect(() => {
    if (focus != null) document.getElementById(`revue-${focus}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focus]);
  if (!data.reviews.length) {
    return (
      <div className="card" style={{ gap: 6, alignItems: 'center', textAlign: 'center', padding: '28px 16px' }}>
        <Icon name="ph-hand-arrow-up" size={22} style={{ color: 'var(--color-neutral-500)' }} />
        <div style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>{t('No contribution or management review concerning you.')}</div>
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {data.reviews.map((r) => <ReviewEntry key={r.id} review={r} now={data.now} userId={data.userId} focused={r.id === focus} />)}
    </div>
  );
}

function ReviewEntry({ review: r, now, userId, focused }: { review: MyContribution; now: string; userId: string; focused: boolean }) {
  const { t } = useI18n();
  const [items, setDone] = useOptimistic(r.myItems, (state, { id, done }: { id: number; done: boolean }) => state.map((i) => (i.id === id ? { ...i, done } : i)));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toggle = (i: MyContribution['myItems'][number]) => start(async () => {
    setError(null);
    setDone({ id: i.id, done: !i.done });
    const res = await safeCall(() => setReviewItemDone(i.id, !i.done));
    if (res.error) setError(res.error);
  });
  // Avancement : les éléments de la personne suivent la case cochée (affichage optimiste).
  const delta = items.filter((i, k) => i.done !== r.myItems[k]?.done).reduce((n, i) => n + (i.done ? 1 : -1), 0);
  const provided = r.progress.provided + delta;
  const rec = r.record;
  return (
    <section id={`revue-${r.id}`} className="card" style={{ gap: 10, scrollMarginTop: 16, ...(focused ? { boxShadow: '0 0 0 1px var(--color-accent-700)' } : {}) }}>
      <CardHead title={fill(t('{kind} of {date}'), { kind: r.kind, date: fmtDate(r.reviewOn) })} aside={(
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Aside>{r.involvementLabel} · {fill(t('{done}/{total} items provided'), { done: provided, total: r.progress.total })}</Aside>
          <ToneTag tone={r.statusTone} style={{ whiteSpace: 'nowrap' }}>{labelT(t)(r.statusLabel)}</ToneTag>
        </span>
      )} />

      <div style={{ display: 'grid', gap: 4 }}>
        <div className="vg-h6">{t('My items to provide')}</div>
        {items.map((i) => {
          const icon = <Icon name={i.done ? 'ph-check-circle' : 'ph-circle'} size={15} style={{ color: i.done ? TONE.ok.dot : 'var(--color-neutral-600)' }} />;
          const late = !i.done && !!i.dueOn && i.dueOn < now;
          return (
            <div key={i.id} style={{ display: 'grid', gap: 6, padding: '4px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5 }}>
              {i.canToggle ? (
                <button type="button" className={styles.check} aria-pressed={i.done} aria-label={i.label}
                  title={i.done ? t('Mark as not provided') : t('Mark as provided')} onClick={() => toggle(i)}>{icon}</button>
              ) : <span className={styles.auto}>{icon}</span>}
              <span style={{ flex: 1, color: i.done ? 'var(--color-neutral-400)' : 'var(--color-text)' }}>{i.label}</span>
              {i.dueOn && (
                <span style={{ fontSize: 11, whiteSpace: 'nowrap', color: late ? TONE.danger.fg : 'var(--color-neutral-500)' }}>
                  {i.done ? t('Provided') : fill(t('expected on {date}'), { date: fmtDayMonth(i.dueOn) })}
                </span>
              )}
            </div>
            {/* AUD-17 : le contributeur joint sa contribution tant que la revue est modifiable ; il ne retire que ses envois. */}
            {(i.files.length > 0 || i.canToggle) && (
              <div style={{ paddingLeft: 24 }}>
                <EntityFiles kind="review_item" entityId={i.id} title={t('Attachments')} kicker={i.label} files={i.files}
                  canAdd={i.canToggle} canRemove={(f) => i.canToggle && f.uploadedById === userId} emptyText={t('No attachment.')} />
              </div>
            )}
            </div>
          );
        })}
        {!items.length && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{t('No checklist item is assigned to you.')}</div>}
        <SaveStatus pending={pending} />
        {error && <div role="alert" style={{ fontSize: 11.5, color: 'var(--tone-danger-fg)' }}>{error}</div>}
      </div>

      {rec && (
        <div style={{ display: 'grid', gap: 6, fontSize: 12.5 }}>
          <div className="vg-h6">{t('Minutes of the meeting')}</div>
          <div><span style={muted}>{t('Participants · ')}</span>{[...rec.participants, rec.externalParticipants].filter(Boolean).join(', ') || '—'}</div>
          {rec.minutes && <div style={{ color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{rec.minutes}</div>}
          {rec.customerPerception && <div><span style={muted}>{t('Customer perception · ')}</span>{rec.customerPerception}</div>}
          {rec.resourceNeeds && <div><span style={muted}>{t('Resource needs · ')}</span>{rec.resourceNeeds}</div>}
          {rec.decisions.length > 0 && (
            <div style={{ display: 'grid', gap: 6, marginTop: 2 }}>
              <div className="vg-h6">{t('Decisions and objectives')}</div>
              {rec.decisions.map((d) => (
                <div key={d.id} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '2px 8px', alignItems: 'baseline' }}>
                  <ToneTag tone={d.cancelled ? 'neutral' : d.tone} style={{ whiteSpace: 'nowrap', fontSize: 11 }}>{labelT(t)(d.kindLabel)}</ToneTag>
                  <span style={d.cancelled ? { textDecoration: 'line-through' } : undefined}>{d.text}</span>
                  {d.cancelled && <><span /><span style={muted}>{fill(t('Abandoned on {date} · reason: {reason}'), { date: fmtDate(d.cancelled.on), reason: d.cancelled.reason })}</span></>}
                  <span />
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', ...muted }}>
                    <span>{d.pilot}{d.dueOn ? ` · ${fmtDayMonth(d.dueOn)}` : ''}</span>
                    {d.actionId && (d.action ? <ActionLink action={d.action} id={d.actionId} /> : <span>{d.actionId}</span>)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {rec.nextReviewOn && <div><span style={muted}>{t('Next review on ')}</span>{fmtDate(rec.nextReviewOn)}</div>}
          <div style={muted}>{rec.visa ? fill(t('Management sign-off: {name} on {date}'), { name: rec.visa.by, date: fmtDate(rec.visa.on) }) : t('Minutes awaiting the management sign-off')}</div>
        </div>
      )}

      {(r.openHref || r.dossierHref) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, fontSize: 12 }}>
          {r.openHref && <Link href={r.openHref} className="vg-link">{t('Open the review on the Audits screen')}</Link>}
          {/* Lien HTML simple : la feuille globale du dossier ne doit pas rester chargée dans l'application. */}
          {r.dossierHref && <a href={r.dossierHref} target="_blank" rel="noopener" className="vg-link"><i className="ph ph-file-text" style={{ fontSize: 12 }} aria-hidden /> {t('File#dossier')}</a>}
        </div>
      )}
    </section>
  );
}
