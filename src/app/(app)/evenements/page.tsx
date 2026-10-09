import type { Metadata } from 'next';
import Link from 'next/link';
import { AdvanceButton, MethodSeg, StepBackButton } from '@/components/EventControls';
import { PageHeader } from '@/components/PageHeader';
import { AnalysisEditButton } from '@/components/events/AnalysisEditButton';
import { EventActions, type EventActionItem } from '@/components/events/EventActions';
import { EventAttachments } from '@/components/events/EventAttachments';
import { EventEditButton, type EditableEvent } from '@/components/events/EventEditButton';
import { addActionBlocker, hasNcOrigin, injuryLabel, readD8, readTree, readWhys } from '@/components/events/shared';
import { Dot, SegLinks, ToneTag, hrefWith } from '@/components/ui';
import { fmtDate, fmtDayMonth, today } from '@/lib/dates';
import { D8_STEPS, EVENT_STEPS, EVENT_TYPES, EVENT_TYPE_KEYS, SCREENS, SEVERITY, STEP_ACTIONS, STEP_CLOSED, TONE, canApprove, canManage, severityTone, type AnalysisMethod } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadEventDetail, type EventDetail } from '@/lib/data/events';
import { loadFormOptions, type FormOptions } from '@/lib/data/options';
import { eventView, isOpen, loadEvents, loadPeople } from '@/lib/queries';

export const metadata: Metadata = { title: SCREENS.events.title };

const H6 = ({ children }: { children: React.ReactNode }) => <h6 className="vg-h6">{children}</h6>;

export default async function EventsPage({ searchParams }: PageProps<'/evenements'>) {
  const { role } = await guard('events');
  const sp = await searchParams;
  const type = typeof sp.type === 'string' && (EVENT_TYPE_KEYS as string[]).includes(sp.type) ? sp.type : undefined;
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  const all = sp.etat === 'tous';
  const now = today();
  const [events, people, options] = await Promise.all([loadEvents(), loadPeople(), loadFormOptions()]);

  const needle = q.toLocaleLowerCase('fr');
  const matches = (e: (typeof events)[number]) => !needle || [e.id, e.title, e.location, e.equipment, e.keystoneProject].some((v) => v?.toLocaleLowerCase('fr').includes(needle));
  const found = events.filter(matches);
  const searched = all ? found : found.filter(isOpen);
  const list = searched.filter((e) => !type || e.type === type).map((e) => eventView(e, people, now));
  const selId = typeof sp.sel === 'string' && events.some((e) => e.id === sp.sel) ? sp.sel : list[0]?.id;
  const detail = selId ? await loadEventDetail(selId) : null;
  const params = { etat: all ? 'tous' : undefined, type, q: q || undefined, sel: typeof sp.sel === 'string' ? sp.sel : undefined };

  const counts = Object.fromEntries(EVENT_TYPE_KEYS.map((k) => [k, searched.filter((e) => e.type === k).length]));
  const filters = [{ key: undefined, label: 'Tous', n: searched.length }, ...EVENT_TYPE_KEYS.map((k) => ({ key: k, label: EVENT_TYPES[k].label, n: counts[k] }))];
  const openCount = events.filter(isOpen).length;

  return (
    <>
      <PageHeader title={SCREENS.events.title} sub={`${openCount} événement${openCount > 1 ? 's' : ''} ouvert${openCount > 1 ? 's' : ''} · tous types`} />
      <div style={{ padding: '0 28px 28px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10, maxWidth: 420 }}>
          <form action="/evenements" style={{ position: 'relative' }}>
            <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 10, top: 10, fontSize: 15, color: 'var(--color-neutral-500)' }} />
            {all && <input type="hidden" name="etat" value="tous" />}
            {type && <input type="hidden" name="type" value={type} />}
            <input className="input" name="q" defaultValue={q} placeholder="Référence, lieu, équipement…" style={{ fontSize: 12.5, paddingLeft: 32 }} />
          </form>
          <div>
            <SegLinks options={[
              { href: hrefWith('/evenements', params, { etat: undefined, sel: undefined }), label: <>Ouverts<span style={{ opacity: 0.6 }}>{found.filter(isOpen).length}</span></>, on: !all },
              { href: hrefWith('/evenements', params, { etat: 'tous', sel: undefined }), label: <>Tous<span style={{ opacity: 0.6 }}>{found.length}</span></>, on: all },
            ]} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {filters.map((f) => (
              <Link key={f.label} href={hrefWith('/evenements', params, { type: f.key, sel: undefined })} scroll={false} className={`vg-chip${type === f.key ? ' is-on' : ''}`}>
                {f.label}<span style={{ opacity: 0.6 }}>{f.n}</span>
              </Link>
            ))}
          </div>
          <div style={{ display: 'grid', gap: 3 }}>
            {list.length === 0 && <div className="vg-muted" style={{ fontSize: 12, padding: '8px 12px' }}>{all || q || type ? 'Aucun événement ne correspond.' : 'Aucun événement ouvert.'}</div>}
            {list.map((e) => (
              <Link key={e.id} href={hrefWith('/evenements', params, { sel: e.id })} scroll={false} className={`vg-row${e.id === selId ? ' is-on' : ''}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-neutral-500)' }}>
                  <span>{e.id}</span>
                  <span>{fmtDayMonth(e.occurredOn)} · {e.step >= STEP_CLOSED ? 'clôturé' : `J+${e.days}`}</span>
                </div>
                <div style={{ fontSize: 12.5 }}>{e.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--color-neutral-500)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}><Dot color={TONE[e.typeTone].dot} size={6} />{e.typeLabel}</span>
                  <span style={{ color: TONE[severityTone(e.severity)].dot, fontWeight: 500 }}>G{e.severity}</span>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.location}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {detail && <EventCard key={detail.event.id} detail={detail} options={options} canEdit={canManage(role)} canRevert={canApprove(role)} />}
      </div>
    </>
  );
}

function EventCard({ detail, options, canEdit, canRevert }: { detail: EventDetail; options: FormOptions; canEdit: boolean; canRevert: boolean }) {
  const { event: e, actions, analyses, attachments, blocker } = detail;
  const sev = TONE[severityTone(e.severity)];
  const closed = e.step >= STEP_CLOSED;
  const siteLabel = options.sites.find(([id]) => id === e.siteId)?.[1].split(' — ')[0] ?? e.siteId;
  const fields: [string, string][] = [
    ['Date', fmtDate(e.occurredOn)], ['Lieu', e.location], ['Site', siteLabel], ['Déclarant', e.declarantLabel], ['Projet Keystone lié', e.keystoneProject ?? '—'],
    ['Équipement', e.equipment ?? '—'], ['Pilote', e.pilot], ['Gravité potentielle', SEVERITY[e.severity]],
  ];
  if (hasNcOrigin(e.type)) fields.push(['Origine', e.ncOrigin ?? (e.type === 'RC' ? 'Réclamation client' : '—')]);
  if (e.type === 'AT') fields.push(['Blessure', e.injury === 'arret' && e.lostDays != null ? `${injuryLabel(e.injury)} · ${e.lostDays} j perdu${e.lostDays > 1 ? 's' : ''}` : injuryLabel(e.injury)]);

  const editable: EditableEvent = {
    id: e.id, siteId: e.siteId, type: e.type, title: e.title, occurredOn: e.occurredOn, location: e.location, equipment: e.equipment,
    keystoneProject: e.keystoneProject, pilotId: e.pilotId, severity: e.severity, description: e.description, immediateMeasures: e.immediateMeasures,
    ncOrigin: e.ncOrigin, injury: e.injury, lostDays: e.lostDays,
  };
  const actionItems: EventActionItem[] = actions.map((a) => ({
    id: a.id, title: a.title, description: a.description, origin: a.originKey, originRef: a.originRef, eventId: a.eventId, siteId: a.siteId, pilotId: a.pilotId, dueOn: a.dueOn, kind: a.kind === 'P' ? 'P' : 'C', verifyDueOn: a.verifyDueOn,
    kindLabel: a.kindLabel, pilot: a.pilot, due: a.due, late: a.late, tone: a.tone, statusLabel: a.statusLabel,
  }));
  const method = e.analysisMethod as AnalysisMethod;
  const hint = !canEdit ? "Réservé à l'animateur QHSE et à l'encadrement." : closed ? undefined : blocker ?? undefined;

  return (
    <div className="card" style={{ gap: 16, padding: '18px 20px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{e.id}</span>
        <ToneTag tone={e.typeTone}>{e.typeLabel}</ToneTag>
        <span className="tag" style={{ background: sev.bg, color: sev.fg }}>{SEVERITY[e.severity]}</span>
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{fmtDate(e.occurredOn)} · {closed ? 'clôturé' : `ouvert depuis ${e.days} j`}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
          {canEdit && <EventEditButton event={editable} options={{ people: options.people, sites: options.sites, projects: options.projects }} />}
          {canRevert && e.step > 0 && <StepBackButton key={`back-${e.step}`} id={e.id} label={`Revenir à « ${EVENT_STEPS[e.step - 1]} »`} />}
          <AdvanceButton key={`next-${e.step}`} id={e.id} label={closed ? 'Clôturé' : `Passer à « ${EVENT_STEPS[e.step + 1]} »`} disabled={closed || !!blocker || !canEdit} hint={hint} />
        </span>
      </div>
      <h2 style={{ fontSize: 18, margin: 0, letterSpacing: '-.01em' }}>{e.title}</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: '8px 4px' }}>
        {EVENT_STEPS.map((label, i) => {
          const done = i < e.step, cur = i === e.step;
          return (
            <div key={label} style={{ display: 'grid', gap: 6, minWidth: 0 }}>
              <div style={{ height: 3, borderRadius: 2, background: done ? 'var(--color-accent-600)' : cur ? 'var(--color-accent)' : 'var(--color-neutral-800)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: done ? 'var(--color-neutral-300)' : cur ? 'var(--color-accent)' : 'var(--color-neutral-600)' }}>
                <i className={`ph ${done ? 'ph-check-circle' : cur ? 'ph-circle-half' : 'ph-circle'}`} style={{ fontSize: 12 }} /><span>{label}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px 16px' }}>
        {fields.map(([k, v]) => (
          <div key={k} style={{ display: 'grid', gap: 2 }}>
            <span style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>{k}</span>
            <span style={{ fontSize: 12.5 }}>{v}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        <div><h6 className="vg-h6" style={{ marginBottom: 4 }}>Description</h6><p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty', whiteSpace: 'pre-line' }}>{e.description || '—'}</p></div>
        <div><h6 className="vg-h6" style={{ marginBottom: 4 }}>Mesures immédiates</h6><p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty', whiteSpace: 'pre-line' }}>{e.immediateMeasures || '—'}</p></div>
      </div>

      <EventAttachments eventId={e.id} files={attachments} canManage={canEdit} />

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <H6>Analyse des causes</H6>
          <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <MethodSeg key={e.id} id={e.id} method={method} disabled={!canEdit} />
            {canEdit && <AnalysisEditButton key={`${e.id}-${method}`} eventId={e.id} method={method} content={analyses[method]} />}
          </span>
        </div>
        <Analysis method={method} content={analyses[method]} />
      </div>

      <EventActions items={actionItems} options={options} canManage={canEdit}
        newDefaults={{ origin: e.type === 'RC' ? 'client' : 'ev', originRef: e.id, eventId: e.id, siteId: e.siteId, pilotId: e.pilotId ?? undefined, kind: 'C', lockOrigin: true }}
        emptyNote={`Aucune action liée — l'analyse des causes doit en produire au moins une avant le passage à l'étape « ${EVENT_STEPS[STEP_ACTIONS]} ».`}
        addBlocked={addActionBlocker(e.step)} />
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="vg-inset" style={{ padding: 12, fontSize: 12, color: 'var(--color-neutral-500)' }}>Aucune analyse « {label} » saisie pour cet événement.</div>;
}

function Analysis({ method, content }: { method: string; content: unknown }) {
  if (method === '5m') {
    const rows = content as [string, string][] | undefined;
    if (!rows?.length) return <Empty label="5M" />;
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
        {rows.map(([k, v]) => (
          <div key={k} className="vg-inset" style={{ padding: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--color-accent-300)', marginBottom: 4 }}>{k}</div>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-300)' }}>{v}</div>
          </div>
        ))}
      </div>
    );
  }
  if (method === 'tree') {
    const nodes = readTree(content);
    if (!nodes.length) return <Empty label="Arbre des causes" />;
    return (
      <div className="vg-inset" style={{ display: 'grid', gap: 6, padding: 12 }}>
        {nodes.map(([lvl, t, top], i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', paddingLeft: lvl * 18 }}>
            <span style={{ width: 8, height: 8, flex: 'none', borderRadius: '50%', border: '1px solid var(--color-accent)', background: top ? 'var(--color-accent)' : 'transparent' }} />
            <span style={{ fontSize: 12, color: 'var(--color-neutral-300)' }}>{t}</span>
          </div>
        ))}
      </div>
    );
  }
  if (method === 'why') {
    const whys = readWhys(content);
    if (!whys.length) return <Empty label="5 pourquoi" />;
    return (
      <div className="vg-inset" style={{ display: 'grid', gap: 6, padding: 12 }}>
        {whys.map((t, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 8, fontSize: 12, color: 'var(--color-neutral-300)' }}>
            <span style={{ color: 'var(--color-accent)' }}>{i + 1}.</span><span>{t}</span>
          </div>
        ))}
      </div>
    );
  }
  const { current, notes } = readD8(content);
  const noted = notes.map((n, i) => [D8_STEPS[i], n] as const).filter(([s, n]) => s && n);
  return (
    <div className="vg-inset" style={{ display: 'grid', gap: 10, padding: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '6px 12px' }}>
        {D8_STEPS.map((t, i) => (
          <div key={t} style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12, color: i < current ? 'var(--color-neutral-300)' : i === current ? 'var(--color-accent)' : 'var(--color-neutral-600)' }}>
            <i className={`ph ${i < current ? 'ph-check-circle' : i === current ? 'ph-circle-half' : 'ph-circle'}`} style={{ fontSize: 13 }} /><span>{t}</span>
          </div>
        ))}
      </div>
      {noted.length > 0 && (
        <div style={{ display: 'grid', gap: 6, paddingTop: 10, borderTop: '1px solid var(--color-divider)' }}>
          {noted.map(([s, n]) => (
            <div key={s} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 150px) minmax(0, 1fr)', gap: 12, fontSize: 12 }}>
              <span style={{ color: 'var(--color-accent-300)' }}>{s}</span>
              <span style={{ color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{n}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
