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

// Causeries et quarts d'heure sécurité (CNF-09) : liste du site, indicateurs (nombre par site et par mois, taux
// d'émargement), fiche avec la feuille d'émargement (signé / en attente), saisie et envoi de la feuille par l'encadrement.

type Data = { talks: SafetyTalkView[]; stats: (TalkStatsRow & { site: string })[]; choices: (readonly [string, string, string | null])[]; now: string };

const muted = { fontSize: 11.5, color: 'var(--vg-text-muted)' } as const;
const monthLabel = (ym: string) => new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`));
const fmtLocal = (local: string) => `${fmtDate(local.slice(0, 10))} à ${local.slice(11, 16)}`;

export function SafetyTalksView({ data, canManage, openId, sites, defaultSite }: {
  data: Data; canManage: boolean; openId?: string; sites: readonly Option[]; defaultSite: string;
}) {
  const router = useRouter();
  const [selId, setSelId] = useState<string | null>(openId ?? null);
  const sel = data.talks.find((x) => x.id === selId) ?? null;
  const close = () => { setSelId(null); router.replace(SAFETY_TALKS_HREF, { scroll: false }); };
  const missing = !!openId && !data.talks.some((x) => x.id === openId);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {missing && <MissingNotice text="Causerie introuvable ou hors du site sélectionné." closeHref={SAFETY_TALKS_HREF} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, flex: 1, minWidth: 240 }} className="vg-muted">
          Causeries et quarts d&apos;heure sécurité animés sur le terrain ; la feuille d&apos;émargement est envoyée aux participants, qui la signent depuis « Mon espace ».
        </span>
        {canManage && <NewTalkButton choices={data.choices} sites={sites} defaultSite={defaultSite} today={data.now} />}
      </div>

      <div className="card" style={{ gap: 8 }}>
        <h2 className="card-title" style={{ fontSize: 14, margin: 0 }}>Indicateurs</h2>
        {data.stats.length === 0 ? <span style={muted}>Aucune causerie tenue.</span> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: 12.5 }}>
              <caption className="vg-sr-only">Causeries par site et par mois, taux d&apos;émargement</caption>
              <thead><tr><th scope="col">Mois</th><th scope="col">Site</th><th scope="col">Causeries</th><th scope="col">Participants</th><th scope="col">Taux d&apos;émargement</th></tr></thead>
              <tbody>
                {data.stats.map((r) => (
                  <tr key={`${r.siteId}|${r.month}`}>
                    <td style={{ whiteSpace: 'nowrap' }}>{monthLabel(r.month)}</td><td>{r.site}</td><td>{r.talks}</td><td>{r.participants}</td><td>{fmtRate(r.rate)}</td>
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
            <thead><tr><th>Date</th><th>Thème</th><th>Animateur</th><th>Site</th><th>Émargement</th></tr></thead>
            <tbody>
              {data.talks.length === 0 && <tr><td colSpan={5} style={{ ...muted, padding: '14px 8px' }}>Aucune causerie enregistrée sur ce site.</td></tr>}
              {data.talks.map((x) => (
                <tr key={x.id} data-obsolete={x.cancelled ? true : undefined}>
                  <td style={{ whiteSpace: 'nowrap', textDecoration: x.cancelled ? 'line-through' : undefined }}>{fmtDate(x.heldOn)}</td>
                  <td>
                    <a href={safetyTalkHref(x.id)} className="vg-link" onClick={(e) => { e.preventDefault(); setSelId(x.id); window.history.pushState(null, '', safetyTalkHref(x.id)); }}>{x.theme}</a>
                    <span style={{ ...muted, display: 'block' }}>{x.id}</span>
                  </td>
                  <td>{x.animator}</td>
                  <td>{x.site}</td>
                  <td>{x.cancelled ? <ToneTag tone="neutral">Annulée</ToneTag> : <SignedTag talk={x} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Dialog open={!!sel} onClose={close} width={640} kicker={sel ? `Causerie sécurité · ${sel.site} · ${sel.id}` : undefined} title={sel?.theme ?? ''}>
        {sel && <TalkDetail key={sel.id} talk={sel} canManage={canManage} choices={data.choices} sites={sites} today={data.now} onClose={close} />}
      </Dialog>
    </div>
  );
}

function SignedTag({ talk }: { talk: SafetyTalkView }) {
  const signed = talk.participants.filter((p) => p.signedAt).length;
  if (!talk.participants.length) return <span style={muted}>Aucun participant</span>;
  return <ToneTag tone={signed === talk.participants.length ? 'ok' : talk.sheetSentAt ? 'warn' : 'neutral'}>{signed}/{talk.participants.length} · {fmtRate(talk.rate)}</ToneTag>;
}

function TalkDetail({ talk, canManage, choices, sites, today, onClose }: {
  talk: SafetyTalkView; canManage: boolean; choices: Data['choices']; sites: readonly Option[]; today: string; onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const live = !talk.cancelled;
  const blocked = sheetBlocker({ heldOn: talk.heldOn, cancelled: !!talk.cancelled, participants: talk.participants.length }, today);
  const pending = talk.participants.filter((p) => !p.signedAt).length;
  if (editing) return <TalkForm talk={talk} choices={choices} sites={sites} defaultSite={talk.siteId} today={today} onDone={onClose} onCancel={() => setEditing(false)} />;
  return (
    <div style={{ display: 'grid', gap: 12, fontSize: 12.5 }}>
      <dl style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '4px 12px', margin: 0 }}>
        <dt style={muted}>Date</dt><dd style={{ margin: 0 }}>{fmtDate(talk.heldOn)} · {talk.durationMinutes} min</dd>
        <dt style={muted}>Animateur</dt><dd style={{ margin: 0 }}>{talk.animator}</dd>
        <dt style={muted}>Feuille d&apos;émargement</dt><dd style={{ margin: 0 }}>{talk.sheetSentAt ? `Envoyée le ${fmtLocal(talk.sheetSentAt)}` : 'Pas encore envoyée'}</dd>
        {talk.notes && <><dt style={muted}>Notes</dt><dd style={{ margin: 0, whiteSpace: 'pre-line' }}>{talk.notes}</dd></>}
      </dl>
      {talk.cancelled && <span style={muted}>Annulée le {fmtDate(talk.cancelled.on)} par {talk.cancelled.by} — motif : {talk.cancelled.reason}</span>}
      <div>
        <div className="vg-eyebrow" style={{ marginBottom: 4 }}>Participants ({talk.participants.length}) · émargement {fmtRate(talk.rate)}</div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 3 }}>
          {talk.participants.map((p) => (
            <li key={p.personId} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <span>{p.name}</span>
              {p.signedAt ? <ToneTag tone="ok">Signé le {fmtLocal(p.signedAt)}</ToneTag> : <ToneTag tone={p.notified ? 'warn' : 'neutral'}>{p.notified ? 'En attente de signature' : 'Non envoyée'}</ToneTag>}
            </li>
          ))}
        </ul>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <a href={safetyTalkPrintHref(talk.id)} target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm"><i className="ph ph-printer" aria-hidden />Imprimer la feuille d&apos;émargement</a>
        {canManage && live && (
          <>
            {!blocked && pending > 0 && (
              <DialogButton label={talk.sheetSentAt ? 'Relancer les participants' : "Envoyer la feuille d'émargement"} icon="ph-paper-plane-tilt" className="btn btn-primary vg-btn-sm"
                title="Feuille d'émargement" kicker={talk.theme} width={460}>
                {(close) => (
                  <ActionForm action={sendAttendanceSheet} hidden={{ id: talk.id }} onDone={close} onCancel={close} submitLabel="Envoyer" submitIcon="ph-paper-plane-tilt">
                    <p style={{ margin: 0, fontSize: 13 }}>
                      {pending} participant{pending > 1 ? 's' : ''} sans signature recevr{pending > 1 ? 'ont' : 'a'} une notification (cloche, « Mon espace ») et un e-mail
                      si son adresse est connue et l&apos;envoi d&apos;e-mails configuré.
                    </p>
                  </ActionForm>
                )}
              </DialogButton>
            )}
            {blocked && <span style={muted}>{blocked}</span>}
            <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setEditing(true)}><i className="ph ph-pencil-simple" aria-hidden />Modifier</button>
            <ReasonButton label="Annuler" icon="ph-prohibit" title="Annuler la causerie" kicker={talk.theme} action={cancelSafetyTalk} hidden={{ id: talk.id }}
              submitLabel="Annuler la causerie" submitIcon="ph-prohibit" placeholder="Ex. causerie reportée, saisie en double"
              message="La causerie n'est jamais supprimée : elle reste listée, barrée, avec son motif, et sort des indicateurs." />
          </>
        )}
      </div>
      <LazyChangeLog entity="safety_talk" id={talk.id} title="Journal" />
    </div>
  );
}

function NewTalkButton({ choices, sites, defaultSite, today }: { choices: Data['choices']; sites: readonly Option[]; defaultSite: string; today: string }) {
  return (
    <DialogButton label="Nouvelle causerie" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Causerie ou quart d'heure sécurité" kicker="Prévention" width={640}>
      {(close) => <TalkForm choices={choices} sites={sites} defaultSite={defaultSite} today={today} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

function TalkForm({ talk, choices, sites, defaultSite, today, onDone, onCancel }: {
  talk?: SafetyTalkView; choices: Data['choices']; sites: readonly Option[]; defaultSite: string; today: string; onDone: () => void; onCancel: () => void;
}) {
  const [siteId, setSiteId] = useState(talk?.siteId ?? defaultSite);
  const chosen = new Set(talk?.participants.map((p) => p.personId) ?? []);
  // Personnes du site de la causerie (ou sans site), plus celles déjà inscrites.
  const people = choices.filter(([id, , s]) => !s || s === siteId || chosen.has(id) || id === talk?.animatorId);
  const animators = people.map(([id, label]) => [id, label] as const);
  const siteChoices = talk && !sites.some(([id]) => id === talk.siteId) ? [...sites, [talk.siteId, talk.site] as const] : sites;
  return (
    <ActionForm action={saveSafetyTalk} hidden={{ id: talk?.id, version: talk?.version }} onDone={onDone} onCancel={onCancel} submitLabel={talk ? 'Enregistrer' : 'Enregistrer la causerie'}>
      <FormRow>
        <Field name="siteId" label="Site">
          <Select name="siteId" options={siteChoices} value={siteId} onChange={(e) => setSiteId(e.target.value)} />
        </Field>
        <Field name="heldOn" label="Date">
          <Input name="heldOn" type="date" defaultValue={talk?.heldOn ?? today} />
        </Field>
      </FormRow>
      <Field name="theme" label="Thème">
        <Input name="theme" maxLength={200} defaultValue={talk?.theme ?? ''} autoFocus={!talk} placeholder="Ex. port des EPI au poste de soudage" />
      </Field>
      <FormRow>
        <Field name="animatorId" label="Animateur">
          <Select name="animatorId" options={animators} defaultValue={talk?.animatorId ?? ''} placeholder="Choisir…" />
        </Field>
        <Field name="durationMinutes" label="Durée (minutes)">
          <Input name="durationMinutes" type="number" min={1} max={TALK_DURATION_MAX} step={1} inputMode="numeric" defaultValue={talk?.durationMinutes ?? 15} />
        </Field>
      </FormRow>
      <Field name="participants" label="Participants" group hint="Personnes du site (Cursus). Un participant qui a signé ne se retire plus.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '2px 12px', maxHeight: 220, overflowY: 'auto' }}>
          {people.map(([id, label]) => (
            <label key={id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
              <input type="checkbox" name="participants" value={id} defaultChecked={chosen.has(id)} />{label}
            </label>
          ))}
        </div>
      </Field>
      <Field name="notes" label="Notes" hint="Messages clés, questions des participants (facultatif).">
        <TextArea name="notes" rows={3} maxLength={4000} defaultValue={talk?.notes ?? ''} />
      </Field>
    </ActionForm>
  );
}
