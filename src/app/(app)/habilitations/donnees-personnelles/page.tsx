import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PrintButton } from '@/components/PrintButton';
import { fmtDate } from '@/lib/dates';
import { canSeeHealth } from '@/lib/domain';
import { PERSON_CATEGORIES, type PersonCategory } from '@/lib/integration-labels';
import { guard } from '@/lib/guard';
import { loadPersonalData, loadPersonalDataPeople } from '@/lib/data/personal-data';
import { logAccess } from '@/server/access-log';
import { today } from '@/lib/today';
import { getI18n } from '@/i18n/server';
import { fill, type T } from '@/i18n/translate';
import '../../prevention/imprimer/print.css';

export const metadata: Metadata = { title: 'Données personnelles' };

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

function Section({ num, title, count, children }: { num: number; title: string; count?: number; children: ReactNode }) {
  return (
    <section className="pp-section">
      <h2><span className="pp-num">{num}</span>{title}{count != null && <span className="pp-muted" style={{ fontWeight: 400 }}> · {count}</span>}</h2>
      {children}
    </section>
  );
}
const None = ({ t }: { t: T }) => <p className="pp-muted" style={{ margin: 0 }}>{t('No data.')}</p>;

// Droit d'accès d'un salarié (SEC-13, RGPD art. 15) : toutes les données que Vigie conserve sur une personne, imprimables
// pour répondre à sa demande. Lecture seule — les droits d'accès à Vigie (rôle, sites) sont attribués dans Microsoft Entra
// ID et n'y sont qu'affichés. Animateur QHSE et direction (HEALTH_PAGES : accidents dont la personne est victime) ; chaque
// consultation est inscrite au journal des consultations (`donnees_personnelles`).
export default async function PersonalDataPage({ searchParams }: PageProps<'/habilitations/donnees-personnelles'>) {
  const session = await guard('skills');
  if (!canSeeHealth(session.role)) redirect('/habilitations');
  const { t } = await getI18n();
  const sp = await searchParams;
  const personId = str(sp.salarie);
  const [people, data] = await Promise.all([loadPersonalDataPeople(), personId ? loadPersonalData(personId) : Promise.resolve(null)]);
  if (data) await logAccess({ kind: 'donnees_personnelles', entityType: 'person', entityId: data.identity.id, personId: session.user.id, health: data.events.some((e) => !!e.health) });
  const id = data?.identity;
  const src = id ? (id.fromCursus ? ' (Cursus)' : ' (Vigie)') : '';
  let n = 0;
  return (
    <article className="pp-doc">
      <div className="pp-toolbar pp-noprint">
        <a href="/habilitations" className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{t('Qualifications and training')}</a>
        <form method="get" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <label htmlFor="salarie" className="pp-muted" style={{ fontSize: 12 }}>{t('Person')}</label>
          <select id="salarie" name="salarie" defaultValue={personId ?? ''} className="input" style={{ minWidth: 220 }}>
            <option value="">{t('Choose…')}</option>
            {people.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button type="submit" className="btn btn-secondary vg-btn-sm">{t('Show')}</button>
          {data && <PrintButton />}
        </form>
      </div>
      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>{t('Vigie · right of access (GDPR, art. 15)')}</div>
        <h1>{t('Personal data')}{id ? ` · ${id.name}` : ''}</h1>
        {id ? (
          <dl className="pp-meta">
            <dt>{t('Issued on')}</dt><dd>{fill(t('{date} by {name}'), { date: fmtDate(today()), name: session.user.name })}</dd>
          </dl>
        ) : null}
        <p className="pp-muted" style={{ margin: 0, fontSize: 12 }}>
          {t('Read-only view of what Vigie keeps about the person. Access rights to Vigie (role, sites) are granted in Microsoft Entra ID: they are only shown here. Viewing written to the access log.')}
        </p>
      </header>
      {personId && !data && <p className="pp-muted">{t('Person not found or outside your scope.')}</p>}
      {!personId && <p className="pp-muted">{t('Choose a person to show their data.')}</p>}
      {data && id && (
        <>
          <Section num={++n} title={t('Identity and access rights')}>
            {/* D01 (décision CV-10) : origine de chaque donnée — Cursus (RH) pour une fiche tenue par Cursus, Vigie sinon. */}
            <p className="pp-muted" style={{ margin: 0, fontSize: 12 }}>
              {id.fromCursus
                ? fill(t('Record held by Cursus (HR): the data marked “Cursus” are entered there and taken over by Vigie{absent}; access request to also send to the HR department.'), { absent: id.cursusState === 'absent' ? t(' (person absent from the last read of Cursus)') : '' })
                : id.replaced ? t('Record replaced when linked to Cursus: data entered in Vigie.') : t('Record without a Cursus employee number (to link): data entered in Vigie.')}
            </p>
            <dl className="pp-meta">
              <dt>{t('Name')}{src}</dt><dd>{id.name}</dd>
              <dt>{t('Function')}{src}{t(' · department (Vigie)')}</dt><dd>{[id.job, id.service].filter(Boolean).join(' · ') || '—'}</dd>
              <dt>{t('Home site')}{src}</dt><dd>{id.site}</dd>
              <dt>{t('Employee number')}{id.fromCursus ? ' (Cursus)' : ''}</dt><dd>{id.matricule ?? '—'}</dd>
              {id.fromCursus && <><dt>{t('Site employee number')} (Cursus)</dt><dd>{id.siteMatricule ?? '—'}</dd></>}
              {id.fromCursus && <><dt>{t('Category')} (Cursus)</dt><dd>{id.category ? PERSON_CATEGORIES[id.category as PersonCategory]?.label ?? id.category : '—'}</dd></>}
              {id.fromCursus && <><dt>{t('Agency or company')} (Cursus)</dt><dd>{id.company ?? '—'}</dd></>}
              {id.fromCursus && <><dt>{t('E-mail address')} (Cursus)</dt><dd>{id.cursusEmail ?? '—'}</dd></>}
              <dt>{t('E-mail address (Microsoft account)')}</dt><dd>{id.email ?? '—'}</dd>
              <dt>{t('Microsoft account')}</dt><dd>{id.entraLinked ? t('Linked (Entra ID identifier kept)') : t('Not linked')}</dd>
              <dt>{t('Vigie role')}</dt><dd>{id.lastRole ?? t('No sign-in')}{id.lastLoginAt ? fill(t(' · last sign-in on {date}'), { date: id.lastLoginAt }) : ''}</dd>
              <dt>{t('Qualifications matrix (Vigie)')}</dt><dd>{id.inSkillsMatrix ? t('Followed') : t('Not followed')}</dd>
              {id.leftOn && <><dt>{t('Departure from the workforce')}{src}</dt><dd>{fmtDate(id.leftOn)}{id.leftReason ? ` · ${id.leftReason}` : ''}</dd></>}
            </dl>
          </Section>
          <Section num={++n} title={t('Qualifications and training')} count={data.qualifications?.length ?? 0}>
            {data.requiredTitles.length > 0 && <p style={{ margin: '0 0 6px', fontSize: 12 }}>{fill(t('Required titles: {titles}'), { titles: data.requiredTitles.join(', ') })}</p>}
            {/* D09 : titres détenus tenus par Cursus (RH), lus par sa vue ; Vigie n'en conserve aucune copie. */}
            <p className="pp-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>{t('Titles held read from Cursus (HR), which holds them: access request to also send to the HR department.')}</p>
            {data.qualifications === null ? (
              <p role="status" style={{ margin: 0, fontSize: 12 }}>{data.qualificationsMessage}</p>
            ) : data.qualifications.length ? (
              <table className="table pp-table">
                <thead><tr><th>{t('Title#qualification')}</th><th>{t('Obtained on')}</th><th>{t('Expires on')}</th><th>{t('Provider or signatory')}</th><th>{t('State')}</th></tr></thead>
                <tbody>{data.qualifications.map((q) => (
                  <tr key={q.id}><td>{q.title}</td><td>{q.obtainedOn ? fmtDate(q.obtainedOn) : '—'}</td><td>{q.expiresOn ? fmtDate(q.expiresOn) : '—'}</td>
                    <td>{q.provider ?? '—'}</td><td>{q.suspended ? fill(t('Suspended ({reason})'), { reason: q.suspended }) : t('Held')}</td></tr>
                ))}</tbody>
              </table>
            ) : <None t={t} />}
          </Section>
          <Section num={++n} title={t('Reports and events')} count={data.events.length}>
            {data.events.length ? (
              <table className="table pp-table">
                <thead><tr><th>{t('Ref.')}</th><th>{t('Date')}</th><th>{t('Type')}</th><th>{t('Title')}</th><th>{t('Role')}</th><th>{t('Health data')}</th></tr></thead>
                <tbody>{data.events.map((e) => (
                  <tr key={e.id}><td>{e.id}</td><td>{fmtDate(e.occurredOn)}</td><td>{e.type}</td><td>{e.title}<div className="pp-muted">{e.site}</div></td><td>{e.roles.join(', ')}</td><td>{e.health ?? '—'}</td></tr>
                ))}</tbody>
              </table>
            ) : <None t={t} />}
          </Section>
          <Section num={++n} title={t('Actions the person owns')} count={data.actions.length}>
            {data.actions.length ? (
              <table className="table pp-table">
                <thead><tr><th>{t('Ref.')}</th><th>{t('Problem')}</th><th>{t('Progress')}</th><th>{t('Target date')}</th><th>{t('Site')}</th></tr></thead>
                <tbody>{data.actions.map((a) => <tr key={a.id}><td>{a.id}</td><td>{a.problem}</td><td>{a.status}</td><td>{fmtDate(a.dueOn)}</td><td>{a.site}</td></tr>)}</tbody>
              </table>
            ) : <None t={t} />}
            {data.comments.length > 0 && (
              <p style={{ margin: '6px 0 0', fontSize: 12 }}>
                {fill(data.comments.length > 1 ? t('{n} comments on the actions {ids}') : t('{n} comment on the actions {ids}'), { n: data.comments.length, ids: [...new Set(data.comments.map((c) => c.actionId))].join(', ') })}
                {data.comments.some((c) => c.withdrawn) && fill(t(' (of which {n} withdrawn, text kept in the database)'), { n: data.comments.filter((c) => c.withdrawn).length })}.
              </p>
            )}
          </Section>
          <Section num={++n} title={t('Attachments filed')} count={data.attachments.length}>
            {data.attachments.length ? (
              <table className="table pp-table">
                <thead><tr><th>{t('File')}</th><th>{t('Record')}</th><th>{t('Filed on')}</th></tr></thead>
                <tbody>{data.attachments.map((a) => <tr key={a.id}><td>{a.fileName}{a.health ? t(' (medical document)') : ''}</td><td>{a.entity}</td><td>{a.on}</td></tr>)}</tbody>
              </table>
            ) : <None t={t} />}
          </Section>
          <Section num={++n} title={t('Responsibilities in the management system')}>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
              <li>{t('Codex documents (owner): ')}{data.documents.map((d) => `${d.id} · ${d.title}`).join(' ; ') || t('none#male')}</li>
              <li>{t('Audit programme: ')}{data.planItems.map((p) => `${p.label} — ${p.role}`).join(' ; ') || t('none#male')}</li>
              <li>{t('Management reviews (participant): ')}{data.reviews.map((r) => fmtDate(r.reviewOn)).join(', ') || t('none#female')}</li>
              <li>{t('Emergency situations (owner): ')}{data.situations.map((x) => x.label).join(' ; ') || t('none#female')}</li>
              <li>{t('Change requests (requester or lead): ')}{data.changeRequests.map((x) => `${x.id} · ${x.title}`).join(' ; ') || t('none#female')}</li>
              <li>{t('Notifications received: ')}{data.notifications}</li>
            </ul>
          </Section>
          <Section num={++n} title={t('Log of the changes made by the person')} count={data.changes.total}>
            {data.changes.rows.length ? (
              <table className="table pp-table">
                <thead><tr><th>{t('On')}</th><th>{t('Record')}</th><th>{t('Change')}</th></tr></thead>
                <tbody>{data.changes.rows.map((c, i) => <tr key={i}><td style={{ whiteSpace: 'nowrap' }}>{c.at}</td><td>{c.entityType} · {c.entityId}</td><td>{c.summary}</td></tr>)}</tbody>
              </table>
            ) : <None t={t} />}
            {data.changes.total > data.changes.rows.length && <p className="pp-muted" style={{ fontSize: 11.5 }}>{fill(t('{n} most recent entries shown.'), { n: data.changes.rows.length })}</p>}
          </Section>
          <Section num={++n} title={t('Viewings made by the person')} count={data.accesses.total}>
            {data.accesses.rows.length ? (
              <table className="table pp-table">
                <thead><tr><th>{t('On')}</th><th>{t('Nature')}</th><th>{t('Record')}</th></tr></thead>
                <tbody>{data.accesses.rows.map((a, i) => <tr key={i}><td style={{ whiteSpace: 'nowrap' }}>{a.at}</td><td>{a.kind}</td><td>{a.entityType} · {a.entityId}</td></tr>)}</tbody>
              </table>
            ) : <None t={t} />}
          </Section>
        </>
      )}
      <div className="pp-foot">{t('Extract drawn up from the data of Vigie · data of the other tools not included, except those Vigie takes over from Cursus (marked) and the titles held read from Cursus.')}</div>
    </article>
  );
}
