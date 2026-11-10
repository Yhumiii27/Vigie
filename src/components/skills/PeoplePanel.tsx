'use client';

import type { ReactNode } from 'react';
import { ReasonButton } from '@/components/ReasonDialog';
import { Field, Select } from '@/components/form';
import { SaveStatus, announce, useActionRunner } from '@/components/feedback';
import { CURSUS_PEOPLE_NOTICE, SYNC_STATUSES, type SyncStatus } from '@/lib/foreign/labels';
import { fmtParisDateTime } from '@/lib/dates';
import type { Option } from '@/lib/data/options';
import type { DepartedRow, PeopleAdmin, PeopleAdminRow } from '@/lib/data/people';
import { attachPerson, reassignResponsibilities, refreshFromCursus } from '@/server/people';
import { fmtDate } from '@/lib/dates';

// Personnes lues dans Cursus (D01, décision CV-10) : bouton « Actualiser depuis Cursus » de l'écran Habilitations et vue
// « Personnel (Cursus) » (QHSE et direction) — fiches anciennes sans matricule à rattacher, fiches absentes de Cursus.

/** « Actualiser depuis Cursus » : personnes et catalogue des titres relus tout de suite (QHSE et direction). */
export function CursusRefreshButton() {
  const { pending, error, run } = useActionRunner();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button type="button" className="btn btn-secondary vg-btn-sm" disabled={pending} onClick={() => run(async () => {
        const r = await refreshFromCursus();
        if (r.message) announce(r.message);
        return r;
      })}>
        <i className="ph ph-arrows-clockwise" style={{ fontSize: 13 }} aria-hidden />Actualiser depuis Cursus
      </button>
      <SaveStatus pending={pending} error={error} label="Lecture de Cursus…" />
    </span>
  );
}

function AttachButton({ person, choices }: { person: PeopleAdminRow; choices: readonly Option[] }) {
  return (
    <ReasonButton action={attachPerson} hidden={{ id: person.id }} label="Rattacher à un salarié Cursus" icon="ph-link"
      title={`Rattacher ${person.name}`} kicker="Personnel (Cursus)" submitLabel="Rattacher" width={520}
      disabled={!choices.length} tooltip={choices.length ? undefined : 'Aucun salarié de Cursus à proposer.'}
      message="La fiche prend le matricule choisi ; nom, poste, site et sortie viennent ensuite de Cursus. Son historique est conservé ; la fiche que le rafraîchissement avait créée pour ce matricule, sans historique propre, est sortie et marquée remplacée (jamais supprimée)."
      placeholder="Ex. même personne, compte créé avant la reprise de Cursus"
      before={(
        <Field name="matricule" label="Salarié de Cursus">
          <Select name="matricule" options={choices} placeholder="Choisir un salarié" />
        </Field>
      )} />
  );
}

/** HAB-05 : réaffectation en masse des responsabilités ouvertes d'une personne sortie (animateur QHSE). */
function ReassignButton({ person, present, canReassign }: { person: DepartedRow; present: readonly Option[]; canReassign: boolean }) {
  const choices = present.filter(([id]) => id !== person.id);
  return (
    <ReasonButton action={reassignResponsibilities} hidden={{ id: person.id }} label="Réaffecter" icon="ph-users-three"
      title={`Réaffecter les responsabilités de ${person.name}`} kicker="Personnel (Cursus)" submitLabel="Réaffecter" width={520}
      disabled={!canReassign || !choices.length} tooltip={!canReassign ? "Réservé à l'animateur QHSE." : choices.length ? undefined : 'Aucune personne présente à proposer.'}
      message={`${person.summary} : repris par la personne choisie en une fois ; chaque élément garde son historique, le motif y est inscrit. Une personne présente sur plusieurs sites : sélectionnez « Tous les sites ».`}
      placeholder="Ex. départ de la personne, reprise par son successeur"
      before={(
        <Field name="targetId" label="Repris par">
          <Select name="targetId" options={choices} placeholder="Choisir une personne présente" />
        </Field>
      )} />
  );
}

function Row({ p, siteLabels, children }: { p: PeopleAdminRow; siteLabels: Record<string, string>; children?: ReactNode }) {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 0', borderTop: '1px solid var(--color-divider)' }}>
      <span style={{ display: 'grid', gap: 2, flex: '1 1 240px', minWidth: 0 }}>
        <span style={{ fontSize: 12.5 }}>{p.name}</span>
        <span style={{ fontSize: 11.5, color: 'var(--vg-text-muted)' }}>
          {[p.job, p.siteId ? siteLabels[p.siteId] ?? p.siteId : 'Sans site', p.lastRole ? `rôle Vigie : ${p.lastRole}` : null].filter(Boolean).join(' · ')}
        </span>
      </span>
      {children}
    </li>
  );
}

/** Vue « Personnel (Cursus) » : rafraîchissement, fiches à rattacher, fiches absentes de Cursus. */
export function PeoplePanel({ admin, siteLabels, canReassign }: { admin: PeopleAdmin; siteLabels: Record<string, string>; canReassign: boolean }) {
  const run = admin.lastRun;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card" style={{ gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 className="vg-h6" style={{ margin: 0 }}>Personnes lues dans Cursus</h2>
          <span style={{ marginLeft: 'auto' }}><CursusRefreshButton /></span>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>{CURSUS_PEOPLE_NOTICE}</p>
        <p style={{ margin: 0, fontSize: 12.5 }}>
          {admin.counts.cursus} fiche{admin.counts.cursus > 1 ? 's' : ''} tenue{admin.counts.cursus > 1 ? 's' : ''} par Cursus
          {` (dont ${admin.counts.interim} intérimaire${admin.counts.interim > 1 ? 's' : ''} et ${admin.counts.external} salarié${admin.counts.external > 1 ? 's' : ''} d’entreprises extérieures)`}
          {run ? ` · dernière lecture le ${fmtParisDateTime(new Date(run.at))} : ${SYNC_STATUSES[run.status as SyncStatus]?.label.toLowerCase() ?? run.status}${run.status === 'ok' ? `, ${run.added} reprise(s), ${run.updated} mise(s) à jour, ${run.removed} absente(s)` : ''}` : ' · jamais lue'}.
        </p>
        {admin.message && <p role="status" style={{ margin: 0, fontSize: 12.5, color: 'var(--tone-warn-fg)' }}>{admin.message}</p>}
      </div>

      <div className="card" style={{ gap: 6 }}>
        <h2 className="vg-h6" style={{ margin: 0 }}>Fiches à rattacher · {admin.toAttach.length}</h2>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
          Fiches sans matricule de Cursus, saisies avant la reprise du personnel ou créées à la première connexion Microsoft : conservées avec leur
          historique, à rattacher au salarié de Cursus correspondant (motif obligatoire, inscrit à l’historique des fiches).
        </p>
        {admin.toAttach.length ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {admin.toAttach.map((p) => <Row key={p.id} p={p} siteLabels={siteLabels}><AttachButton person={p} choices={admin.choices} /></Row>)}
          </ul>
        ) : <p style={{ margin: 0, fontSize: 12, color: 'var(--vg-text-muted)' }}>Aucune fiche à rattacher.</p>}
      </div>

      <div id="sorties" className="card" style={{ gap: 6, scrollMarginTop: 16 }}>
        <h2 className="vg-h6" style={{ margin: 0 }}>Sorties avec des responsabilités ouvertes · {admin.departed.length}</h2>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
          Personnes sorties de l’effectif (sortie enregistrée dans Cursus) qui restent responsables d’actions, pilotes d’événements ou responsables de plans, d’audits, de contrôles ou d’exigences : à réaffecter en une fois à une personne présente.
        </p>
        {admin.departed.length ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {admin.departed.map((p) => (
              <Row key={p.id} p={p} siteLabels={siteLabels}>
                <span style={{ fontSize: 11.5, color: 'var(--vg-text-muted)', flex: '1 1 200px' }}>Sortie le {fmtDate(p.leftOn)} · {p.summary}</span>
                <ReassignButton person={p} present={admin.present} canReassign={canReassign} />
              </Row>
            ))}
          </ul>
        ) : <p style={{ margin: 0, fontSize: 12, color: 'var(--vg-text-muted)' }}>Aucune responsabilité ouverte portée par une personne sortie.</p>}
      </div>

      <div className="card" style={{ gap: 6 }}>
        <h2 className="vg-h6" style={{ margin: 0 }}>Absentes de Cursus · {admin.absent.length}</h2>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
          Fiches tenues par Cursus que sa dernière lecture ne publie plus : jamais supprimées ; à vérifier auprès du service RH.
        </p>
        {admin.absent.length ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {admin.absent.map((p) => <Row key={p.id} p={p} siteLabels={siteLabels}><span style={{ fontSize: 11.5, color: 'var(--vg-text-muted)' }}>Matricule {p.matricule}{p.siteMatricule ? ` · matricule de site ${p.siteMatricule}` : ''}</span></Row>)}
          </ul>
        ) : <p style={{ margin: 0, fontSize: 12, color: 'var(--vg-text-muted)' }}>Aucune fiche absente de Cursus.</p>}
      </div>
    </div>
  );
}
