'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { ReasonButton } from '@/components/ReasonDialog';
import { MissingNotice, ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import type { Option } from '@/lib/form-options';
import type { SafetyTalkView } from '@/lib/data/safety-talks';
import { SAFETY_TALKS_HREF, TALK_DURATION_MAX, fmtRate, safetyTalkHref, safetyTalkPrintHref, sheetBlocker, type TalkStatsRow } from '@/lib/rules/safety-talks';
import { cancelSafetyTalk, saveSafetyTalk, sendAttendanceSheet } from '@/server/safety-talks';
import { useI18n } from '@/i18n/client';
import { fill, type Lang, type T } from '@/i18n/translate';

// Causeries et quarts d'heure sécurité (CNF-09) : liste du site, indicateurs (nombre par site et par mois, taux
// d'émargement), fiche avec la feuille d'émargement (signé / en attente), saisie et envoi de la feuille par l'encadrement.

type Data = { talks: SafetyTalkView[]; stats: (TalkStatsRow & { site: string })[]; choices: (readonly [string, string, string | null])[]; now: string };

const muted = { fontSize: 11.5, color: 'var(--vg-text-muted)' } as const;
const monthLabel = (ym: string, lang: Lang) => new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`));
const fmtLocal = (local: string, t: T) => fill(t('{date} at {time}'), { date: fmtDate(local.slice(0, 10)), time: local.slice(11, 16) });

export function SafetyTalksView({ data, canManage, openId, sites, defaultSite }: {
  data: Data; canManage: boolean; openId?: string; sites: readonly Option[]; defaultSite: string;
}) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [selId, setSelId] = useState<string | null>(openId ?? null);
  const sel = data.talks.find((x) => x.id === selId) ?? null;
  const close = () => { setSelId(null); router.replace(SAFETY_TALKS_HREF, { scroll: false }); };
  const missing = !!openId && !data.talks.some((x) => x.id === openId);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {missing && <MissingNotice text={t('Safety talk not found or outside the selected site.')} closeHref={SAFETY_TALKS_HREF} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, flex: 1, minWidth: 240 }} className="vg-muted">
          {t('Safety talks and toolbox talks held in the field; the attendance sheet is sent to the participants, who sign it from “My space”.')}
        </span>
        {canManage && <NewTalkButton choices={data.choices} sites={sites} defaultSite={defaultSite} today={data.now} />}
      </div>

      <div className="card" style={{ gap: 8 }}>
        <h2 className="card-title" style={{ fontSize: 14, margin: 0 }}>{t('Indicators')}</h2>
        {data.stats.length === 0 ? <span style={muted}>{t('No safety talk held.')}</span> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: 12.5 }}>
              <caption className="vg-sr-only">{t('Safety talks by site and by month, attendance rate')}</caption>
              <thead><tr><th scope="col">{t('Month')}</th><th scope="col">{t('Site')}</th><th scope="col">{t('Talks')}</th><th scope="col">{t('Participants')}</th><th scope="col">{t('Attendance rate')}</th></tr></thead>
              <tbody>
                {data.stats.map((r) => (
                  <tr key={`${r.siteId}|${r.month}`}>
                    <td style={{ whiteSpace: 'nowrap' }}>{monthLabel(r.month, lang)}</td><td>{r.site}</td><td>{r.talks}</td><td>{r.participants}</td><td>{fmtRate(r.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: '6px 14px 10px' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 12.5, minWidth: 640 }}>
            <thead><tr><th>{t('Date')}</th><th>{t('Topic')}</th><th>{t('Facilitator')}</th><th>{t('Site')}</th><th>{t('Sign-off')}</th></tr></thead>
            <tbody>
              {data.talks.length === 0 && <tr><td colSpan={5} style={{ ...muted, padding: '14px 8px' }}>{t('No safety talk recorded on this site.')}</td></tr>}
              {data.talks.map((x) => (
                <tr key={x.id} data-obsolete={x.cancelled ? true : undefined}>
                  <td style={{ whiteSpace: 'nowrap', textDecoration: x.cancelled ? 'line-through' : undefined }}>{fmtDate(x.heldOn)}</td>
                  <td>
                    <a href={safetyTalkHref(x.id)} className="vg-link" onClick={(e) => { e.preventDefault(); setSelId(x.id); window.history.pushState(null, '', safetyTalkHref(x.id)); }}>{x.theme}</a>
                    <span style={{ ...muted, display: 'block' }}>{x.id}</span>
                  </td>
                  <td>{x.animator}</td>
                  <td>{x.site}</td>
                  <td>{x.cancelled ? <ToneTag tone="neutral">{t('Cancelled')}</ToneTag> : <SignedTag talk={x} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Dialog open={!!sel} onClose={close} width={640} kicker={sel ? `${t('Safety talk')} · ${sel.site} · ${sel.id}` : undefined} title={sel?.theme ?? ''}>
        {sel && <TalkDetail key={sel.id} talk={sel} canManage={canManage} choices={data.choices} sites={sites} today={data.now} onClose={close} />}
      </Dialog>
    </div>
  );
}

function SignedTag({ talk }: { talk: SafetyTalkView }) {
  const { t } = useI18n();
  const signed = talk.participants.filter((p) => p.signedAt).length;
  if (!talk.participants.length) return <span style={muted}>{t('No participant')}</span>;
  return <ToneTag tone={signed === talk.participants.length ? 'ok' : talk.sheetSentAt ? 'warn' : 'neutral'}>{signed}/{talk.participants.length} · {fmtRate(talk.rate)}</ToneTag>;
}

function TalkDetail({ talk, canManage, choices, sites, today, onClose }: {
  talk: SafetyTalkView; canManage: boolean; choices: Data['choices']; sites: readonly Option[]; today: string; onClose: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const live = !talk.cancelled;
  const blocked = sheetBlocker({ heldOn: talk.heldOn, cancelled: !!talk.cancelled, participants: talk.participants.length }, today);
  const pending = talk.participants.filter((p) => !p.signedAt).length;
  if (editing) return <TalkForm talk={talk} choices={choices} sites={sites} defaultSite={talk.siteId} today={today} onDone={onClose} onCancel={() => setEditing(false)} />;
  return (
    <div style={{ display: 'grid', gap: 12, fontSize: 12.5 }}>
      <dl style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '4px 12px', margin: 0 }}>
        <dt style={muted}>{t('Date')}</dt><dd style={{ margin: 0 }}>{fmtDate(talk.heldOn)} · {talk.durationMinutes} min</dd>
        <dt style={muted}>{t('Facilitator')}</dt><dd style={{ margin: 0 }}>{talk.animator}</dd>
        <dt style={muted}>{t('Attendance sheet')}</dt><dd style={{ margin: 0 }}>{talk.sheetSentAt ? fill(t('Sent on {date}#f'), { date: fmtLocal(talk.sheetSentAt, t) }) : t('Not sent yet')}</dd>
        {talk.notes && <><dt style={muted}>{t('Notes')}</dt><dd style={{ margin: 0, whiteSpace: 'pre-line' }}>{talk.notes}</dd></>}
      </dl>
      {talk.cancelled && <span style={muted}>{fill(t('Cancelled on {date}#f'), { date: fmtDate(talk.cancelled.on) })}{fill(t(' by {name}'), { name: talk.cancelled.by })}{fill(t(' — reason: {reason}'), { reason: talk.cancelled.reason })}</span>}
      <div>
        <div className="vg-eyebrow" style={{ marginBottom: 4 }}>{fill(t('Participants ({n}) · attendance {rate}'), { n: talk.participants.length, rate: fmtRate(talk.rate) })}</div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 3 }}>
          {talk.participants.map((p) => (
            <li key={p.personId} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <span>{p.name}</span>
              {p.signedAt ? <ToneTag tone="ok">{fill(t('Signed on {date}'), { date: fmtLocal(p.signedAt, t) })}</ToneTag> : <ToneTag tone={p.notified ? 'warn' : 'neutral'}>{p.notified ? t('Awaiting signature') : t('Not sent#f')}</ToneTag>}
            </li>
          ))}
        </ul>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <a href={safetyTalkPrintHref(talk.id)} target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm"><i className="ph ph-printer" aria-hidden />{t('Print the attendance sheet')}</a>
        {canManage && live && (
          <>
            {!blocked && pending > 0 && (
              <DialogButton label={talk.sheetSentAt ? t('Remind the participants') : t('Send the attendance sheet')} icon="ph-paper-plane-tilt" className="btn btn-primary vg-btn-sm"
                title={t('Attendance sheet')} kicker={talk.theme} width={460}>
                {(close) => (
                  <ActionForm action={sendAttendanceSheet} hidden={{ id: talk.id }} onDone={close} onCancel={close} submitLabel={t('Send')} submitIcon="ph-paper-plane-tilt">
                    <p style={{ margin: 0, fontSize: 13 }}>
                      {fill(pending > 1
                        ? t('{n} participants without a signature will receive a notification (bell, “My space”) and an e-mail if their address is known and e-mail sending is configured.')
                        : t('{n} participant without a signature will receive a notification (bell, “My space”) and an e-mail if their address is known and e-mail sending is configured.'), { n: pending })}
                    </p>
                  </ActionForm>
                )}
              </DialogButton>
            )}
            {blocked && <span style={muted}>{blocked}</span>}
            <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setEditing(true)}><i className="ph ph-pencil-simple" aria-hidden />{t('Edit')}</button>
            <ReasonButton label={t('Cancel')} icon="ph-prohibit" title={t('Cancel the safety talk')} kicker={talk.theme} action={cancelSafetyTalk} hidden={{ id: talk.id }}
              submitLabel={t('Cancel the safety talk')} submitIcon="ph-prohibit" placeholder={t('E.g. talk postponed, entered twice')}
              message={t('The safety talk is never deleted: it stays listed, struck through, with its reason, and leaves the indicators.')} />
          </>
        )}
      </div>
      <LazyChangeLog entity="safety_talk" id={talk.id} title={t('Log')} />
    </div>
  );
}

function NewTalkButton({ choices, sites, defaultSite, today }: { choices: Data['choices']; sites: readonly Option[]; defaultSite: string; today: string }) {
  const { t } = useI18n();
  return (
    <DialogButton label={t('New safety talk')} icon="ph-plus" className="btn btn-primary vg-btn-sm" title={t('Safety talk or toolbox talk')} kicker={t('Prevention')} width={640}>
      {(close) => <TalkForm choices={choices} sites={sites} defaultSite={defaultSite} today={today} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

function TalkForm({ talk, choices, sites, defaultSite, today, onDone, onCancel }: {
  talk?: SafetyTalkView; choices: Data['choices']; sites: readonly Option[]; defaultSite: string; today: string; onDone: () => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const [siteId, setSiteId] = useState(talk?.siteId ?? defaultSite);
  const chosen = new Set(talk?.participants.map((p) => p.personId) ?? []);
  // Personnes du site de la causerie (ou sans site), plus celles déjà inscrites.
  const people = choices.filter(([id, , s]) => !s || s === siteId || chosen.has(id) || id === talk?.animatorId);
  const animators = people.map(([id, label]) => [id, label] as const);
  const siteChoices = talk && !sites.some(([id]) => id === talk.siteId) ? [...sites, [talk.siteId, talk.site] as const] : sites;
  return (
    <ActionForm action={saveSafetyTalk} hidden={{ id: talk?.id, version: talk?.version }} onDone={onDone} onCancel={onCancel} submitLabel={talk ? t('Save') : t('Save the safety talk')}>
      <FormRow>
        <Field name="siteId" label={t('Site')}>
          <Select name="siteId" options={siteChoices} value={siteId} onChange={(e) => setSiteId(e.target.value)} />
        </Field>
        <Field name="heldOn" label={t('Date')}>
          <Input name="heldOn" type="date" defaultValue={talk?.heldOn ?? today} />
        </Field>
      </FormRow>
      <Field name="theme" label={t('Topic')}>
        <Input name="theme" maxLength={200} defaultValue={talk?.theme ?? ''} autoFocus={!talk} placeholder={t('E.g. wearing PPE at the welding station')} />
      </Field>
      <FormRow>
        <Field name="animatorId" label={t('Facilitator')}>
          <Select name="animatorId" options={animators} defaultValue={talk?.animatorId ?? ''} placeholder={t('Choose…')} />
        </Field>
        <Field name="durationMinutes" label={t('Duration (minutes)')}>
          <Input name="durationMinutes" type="number" min={1} max={TALK_DURATION_MAX} step={1} inputMode="numeric" defaultValue={talk?.durationMinutes ?? 15} />
        </Field>
      </FormRow>
      <Field name="participants" label={t('Participants')} group hint={t('People of the site (Cursus). A participant who has signed can no longer be removed.')}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '2px 12px', maxHeight: 220, overflowY: 'auto' }}>
          {people.map(([id, label]) => (
            <label key={id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
              <input type="checkbox" name="participants" value={id} defaultChecked={chosen.has(id)} />{label}
            </label>
          ))}
        </div>
      </Field>
      <Field name="notes" label={t('Notes')} hint={t('Key messages, participants’ questions (optional).')}>
        <TextArea name="notes" rows={3} maxLength={4000} defaultValue={talk?.notes ?? ''} />
      </Field>
    </ActionForm>
  );
}
