'use client';

import type { ReactNode } from 'react';
import { ReasonButton } from '@/components/ReasonDialog';
import { Field, Select } from '@/components/form';
import { SaveStatus, announce, useActionRunner } from '@/components/feedback';
import { CURSUS_PEOPLE_NOTICE, SYNC_STATUSES, type SyncStatus } from '@/lib/integration-labels';
import { fmtParisDateTime } from '@/lib/dates';
import type { Option } from '@/lib/data/options';
import type { DepartedRow, PeopleAdmin, PeopleAdminRow } from '@/lib/data/people';
import { attachPerson, reassignResponsibilities, refreshFromCursus } from '@/server/people';
import { fmtDate } from '@/lib/dates';
import { useI18n } from '@/i18n/client';
import { labelT } from '@/i18n/labels';
import { fill } from '@/i18n/translate';

// Personnes lues dans Cursus (D01, décision CV-10) : bouton « Actualiser depuis Cursus » de l'écran Habilitations et vue
// « Personnel (Cursus) » (QHSE et direction) — fiches anciennes sans matricule à rattacher, fiches absentes de Cursus.

/** « Actualiser depuis Cursus » : personnes et catalogue des titres relus tout de suite (QHSE et direction). */
export function CursusRefreshButton() {
  const { t } = useI18n();
  const { pending, error, run } = useActionRunner();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button type="button" className="btn btn-secondary vg-btn-sm" disabled={pending} onClick={() => run(async () => {
        const r = await refreshFromCursus();
        if (r.message) announce(r.message);
        return r;
      })}>
        <i className="ph ph-arrows-clockwise" style={{ fontSize: 13 }} aria-hidden />{t('Refresh from Cursus')}
      </button>
      <SaveStatus pending={pending} error={error} label={t('Reading Cursus…')} />
    </span>
  );
}

function AttachButton({ person, choices }: { person: PeopleAdminRow; choices: readonly Option[] }) {
  const { t } = useI18n();
  return (
    <ReasonButton action={attachPerson} hidden={{ id: person.id }} label={t('Link to a Cursus employee')} icon="ph-link"
      title={fill(t('Link {name}'), { name: person.name })} kicker={t('Staff (Cursus)')} submitLabel={t('Link')} width={520}
      disabled={!choices.length} tooltip={choices.length ? undefined : t('No Cursus employee to offer.')}
      message={t('The record takes the chosen employee number; name, job, site and departure then come from Cursus. Its history is kept; the record the refresh had created for this number, without history of its own, is set as departed and marked replaced (never deleted).')}
      placeholder={t('E.g. same person, account created before Cursus took over')}
      before={(
        <Field name="matricule" label={t('Cursus employee')}>
          <Select name="matricule" options={choices} placeholder={t('Choose an employee')} />
        </Field>
      )} />
  );
}

/** HAB-05 : réaffectation en masse des responsabilités ouvertes d'une personne sortie (animateur QHSE). */
function ReassignButton({ person, present, canReassign }: { person: DepartedRow; present: readonly Option[]; canReassign: boolean }) {
  const { t } = useI18n();
  const choices = present.filter(([id]) => id !== person.id);
  return (
    <ReasonButton action={reassignResponsibilities} hidden={{ id: person.id }} label={t('Reassign')} icon="ph-users-three"
      title={fill(t('Reassign the responsibilities of {name}'), { name: person.name })} kicker={t('Staff (Cursus)')} submitLabel={t('Reassign')} width={520}
      disabled={!canReassign || !choices.length} tooltip={!canReassign ? t('Reserved for the QHSE coordinator.') : choices.length ? undefined : t('No present person to offer.')}
      message={fill(t('{summary}: taken over by the chosen person at once; each item keeps its history, the reason is written there. A person present on several sites: select “All sites”.'), { summary: person.summary })}
      placeholder={t('E.g. departure of the person, taken over by their successor')}
      before={(
        <Field name="targetId" label={t('Taken over by')}>
          <Select name="targetId" options={choices} placeholder={t('Choose a present person')} />
        </Field>
      )} />
  );
}

function Row({ p, siteLabels, children }: { p: PeopleAdminRow; siteLabels: Record<string, string>; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 0', borderTop: '1px solid var(--color-divider)' }}>
      <span style={{ display: 'grid', gap: 2, flex: '1 1 240px', minWidth: 0 }}>
        <span style={{ fontSize: 12.5 }}>{p.name}</span>
        <span style={{ fontSize: 11.5, color: 'var(--vg-text-muted)' }}>
          {[p.job, p.siteId ? siteLabels[p.siteId] ?? p.siteId : t('No site'), p.lastRole ? fill(t('Vigie role: {role}'), { role: p.lastRole }) : null].filter(Boolean).join(' · ')}
        </span>
      </span>
      {children}
    </li>
  );
}

/** Vue « Personnel (Cursus) » : rafraîchissement, fiches à rattacher, fiches absentes de Cursus. */
export function PeoplePanel({ admin, siteLabels, canReassign }: { admin: PeopleAdmin; siteLabels: Record<string, string>; canReassign: boolean }) {
  const { t } = useI18n();
  const run = admin.lastRun;
  const n = admin.counts;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card" style={{ gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 className="vg-h6" style={{ margin: 0 }}>{t('People read from Cursus')}</h2>
          <span style={{ marginLeft: 'auto' }}><CursusRefreshButton /></span>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>{CURSUS_PEOPLE_NOTICE}</p>
        <p style={{ margin: 0, fontSize: 12.5 }}>
          {fill(n.cursus > 1 ? t('{n} records held by Cursus') : t('{n} record held by Cursus'), { n: n.cursus })}
          {fill(t(' (of which {interim} and {external})'), {
            interim: fill(n.interim > 1 ? t('{n} temporary workers') : t('{n} temporary worker'), { n: n.interim }),
            external: fill(n.external > 1 ? t('{n} employees of external companies') : t('{n} employee of external companies'), { n: n.external }),
          })}
          {run ? fill(t(' · last read on {date}: {status}'), { date: fmtParisDateTime(new Date(run.at)), status: SYNC_STATUSES[run.status as SyncStatus] ? labelT(t)(SYNC_STATUSES[run.status as SyncStatus].label).toLowerCase() : run.status })
            + (run.status === 'ok' ? fill(t(', {added} taken over, {updated} updated, {removed} absent'), { added: run.added, updated: run.updated, removed: run.removed }) : '') : t(' · never read')}.
        </p>
        {admin.message && <p role="status" style={{ margin: 0, fontSize: 12.5, color: 'var(--tone-warn-fg)' }}>{admin.message}</p>}
      </div>

      <div className="card" style={{ gap: 6 }}>
        <h2 className="vg-h6" style={{ margin: 0 }}>{t('Records to link')} · {admin.toAttach.length}</h2>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
          {t('Records without a Cursus employee number, entered before the staff takeover or created at the first Microsoft sign-in: kept with their history, to link to the matching Cursus employee (reason required, written to the records’ history).')}
        </p>
        {admin.toAttach.length ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {admin.toAttach.map((p) => <Row key={p.id} p={p} siteLabels={siteLabels}><AttachButton person={p} choices={admin.choices} /></Row>)}
          </ul>
        ) : <p style={{ margin: 0, fontSize: 12, color: 'var(--vg-text-muted)' }}>{t('No record to link.')}</p>}
      </div>

      <div id="sorties" className="card" style={{ gap: 6, scrollMarginTop: 16 }}>
        <h2 className="vg-h6" style={{ margin: 0 }}>{t('Departures with open responsibilities')} · {admin.departed.length}</h2>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
          {t('People who left the workforce (departure recorded in Cursus) who are still owners of actions, leads of events or owners of plans, audits, inspections or requirements: to reassign at once to a present person.')}
        </p>
        {admin.departed.length ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {admin.departed.map((p) => (
              <Row key={p.id} p={p} siteLabels={siteLabels}>
                <span style={{ fontSize: 11.5, color: 'var(--vg-text-muted)', flex: '1 1 200px' }}>{fill(t('Left on {date}'), { date: fmtDate(p.leftOn) })} · {p.summary}</span>
                <ReassignButton person={p} present={admin.present} canReassign={canReassign} />
              </Row>
            ))}
          </ul>
        ) : <p style={{ margin: 0, fontSize: 12, color: 'var(--vg-text-muted)' }}>{t('No open responsibility held by a person who left.')}</p>}
      </div>

      <div className="card" style={{ gap: 6 }}>
        <h2 className="vg-h6" style={{ margin: 0 }}>{t('Absent from Cursus')} · {admin.absent.length}</h2>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
          {t('Records held by Cursus that its last read no longer publishes: never deleted; to check with the HR department.')}
        </p>
        {admin.absent.length ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {admin.absent.map((p) => <Row key={p.id} p={p} siteLabels={siteLabels}><span style={{ fontSize: 11.5, color: 'var(--vg-text-muted)' }}>{fill(t('Employee number {n}'), { n: p.matricule })}{p.siteMatricule ? fill(t(' · site number {n}'), { n: p.siteMatricule }) : ''}</span></Row>)}
          </ul>
        ) : <p style={{ margin: 0, fontSize: 12, color: 'var(--vg-text-muted)' }}>{t('No record absent from Cursus.')}</p>}
      </div>
    </div>
  );
}
