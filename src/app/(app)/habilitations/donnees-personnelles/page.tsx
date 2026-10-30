import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PrintButton } from '@/components/PrintButton';
import { fmtDate } from '@/lib/dates';
import { canSeeHealth } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadPersonalData, loadPersonalDataPeople } from '@/lib/data/personal-data';
import { logAccess } from '@/server/access-log';
import { today } from '@/lib/today';
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
const None = () => <p className="pp-muted" style={{ margin: 0 }}>Aucune donnée.</p>;

// Droit d'accès d'un salarié (SEC-13, RGPD art. 15) : toutes les données que Vigie conserve sur une personne, imprimables
// pour répondre à sa demande. Lecture seule — les droits d'accès à Vigie (rôle, sites) sont attribués dans Microsoft Entra
// ID et n'y sont qu'affichés. Animateur QHSE et direction (HEALTH_PAGES : accidents dont la personne est victime) ; chaque
// consultation est inscrite au journal des consultations (`donnees_personnelles`).
export default async function PersonalDataPage({ searchParams }: PageProps<'/habilitations/donnees-personnelles'>) {
  const session = await guard('skills');
  if (!canSeeHealth(session.role)) redirect('/habilitations');
  const sp = await searchParams;
  const personId = str(sp.salarie);
  const [people, data] = await Promise.all([loadPersonalDataPeople(), personId ? loadPersonalData(personId) : Promise.resolve(null)]);
  if (data) await logAccess({ kind: 'donnees_personnelles', entityType: 'person', entityId: data.identity.id, personId: session.user.id, health: data.events.some((e) => !!e.health) });
  const id = data?.identity;
  let n = 0;
  return (
    <article className="pp-doc">
      <div className="pp-toolbar pp-noprint">
        <a href="/habilitations" className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />Habilitations et formations</a>
        <form method="get" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <label htmlFor="salarie" className="pp-muted" style={{ fontSize: 12 }}>Personne</label>
          <select id="salarie" name="salarie" defaultValue={personId ?? ''} className="input" style={{ minWidth: 220 }}>
            <option value="">Choisir…</option>
            {people.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button type="submit" className="btn btn-secondary vg-btn-sm">Afficher</button>
          {data && <PrintButton />}
        </form>
      </div>
      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · droit d&apos;accès (RGPD, art. 15)</div>
        <h1>Données personnelles{id ? ` · ${id.name}` : ''}</h1>
        {id ? (
          <dl className="pp-meta">
            <dt>Édité le</dt><dd>{fmtDate(today())} par {session.user.name}</dd>
          </dl>
        ) : null}
        <p className="pp-muted" style={{ margin: 0, fontSize: 12 }}>
          Vue en lecture seule de ce que Vigie conserve sur la personne. Les droits d&apos;accès à Vigie (rôle, sites) sont attribués dans
          Microsoft Entra ID : ils sont seulement affichés ici. Consultation inscrite au journal des consultations.
        </p>
      </header>
      {personId && !data && <p className="pp-muted">Personne introuvable ou hors de votre périmètre.</p>}
      {!personId && <p className="pp-muted">Choisissez une personne pour afficher ses données.</p>}
      {data && id && (
        <>
          <Section num={++n} title="Identité et droits d'accès">
            <dl className="pp-meta">
              <dt>Nom</dt><dd>{id.name}</dd>
              <dt>Fonction · service</dt><dd>{[id.job, id.service].filter(Boolean).join(' · ') || '—'}</dd>
              <dt>Site de rattachement</dt><dd>{id.site}</dd>
              <dt>Adresse e-mail</dt><dd>{id.email ?? '—'}</dd>
              <dt>Matricule</dt><dd>{id.matricule ?? '—'}</dd>
              <dt>Compte Microsoft</dt><dd>{id.entraLinked ? 'Rattaché (identifiant Entra ID conservé)' : 'Non rattaché'}</dd>
              <dt>Rôle Vigie</dt><dd>{id.lastRole ?? 'Aucune connexion'}{id.lastLoginAt ? ` · dernière connexion le ${id.lastLoginAt}` : ''}</dd>
              <dt>Matrice des habilitations</dt><dd>{id.inSkillsMatrix ? 'Suivi' : 'Non suivi'}</dd>
              {id.leftOn && <><dt>Sortie de l&apos;effectif</dt><dd>{fmtDate(id.leftOn)}{id.leftReason ? ` · ${id.leftReason}` : ''}</dd></>}
            </dl>
          </Section>
          <Section num={++n} title="Habilitations et formations" count={data.qualifications.length}>
            {data.requiredTitles.length > 0 && <p style={{ margin: '0 0 6px', fontSize: 12 }}>Titres requis : {data.requiredTitles.join(', ')}</p>}
            {data.qualifications.length ? (
              <table className="table pp-table">
                <thead><tr><th>Titre</th><th>Obtenu le</th><th>Expire le</th><th>Organisme · portée</th><th>État</th></tr></thead>
                <tbody>{data.qualifications.map((q) => (
                  <tr key={q.id}><td>{q.title}</td><td>{fmtDate(q.obtainedOn)}</td><td>{q.expiresOn ? fmtDate(q.expiresOn) : '—'}</td>
                    <td>{[q.provider, q.scope].filter(Boolean).join(' · ') || '—'}</td><td>{q.cancelled ? `Annulée le ${fmtDate(q.cancelled.on)} (${q.cancelled.reason})` : q.effectiveness ?? 'Enregistrée'}</td></tr>
                ))}</tbody>
              </table>
            ) : <None />}
          </Section>
          <Section num={++n} title="Signalements et événements" count={data.events.length}>
            {data.events.length ? (
              <table className="table pp-table">
                <thead><tr><th>Réf.</th><th>Date</th><th>Type</th><th>Intitulé</th><th>Rôle</th><th>Données de santé</th></tr></thead>
                <tbody>{data.events.map((e) => (
                  <tr key={e.id}><td>{e.id}</td><td>{fmtDate(e.occurredOn)}</td><td>{e.type}</td><td>{e.title}<div className="pp-muted">{e.site}</div></td><td>{e.roles.join(', ')}</td><td>{e.health ?? '—'}</td></tr>
                ))}</tbody>
              </table>
            ) : <None />}
          </Section>
          <Section num={++n} title="Actions dont la personne est responsable" count={data.actions.length}>
            {data.actions.length ? (
              <table className="table pp-table">
                <thead><tr><th>Réf.</th><th>Problème</th><th>Avancement</th><th>Date cible</th><th>Site</th></tr></thead>
                <tbody>{data.actions.map((a) => <tr key={a.id}><td>{a.id}</td><td>{a.problem}</td><td>{a.status}</td><td>{fmtDate(a.dueOn)}</td><td>{a.site}</td></tr>)}</tbody>
              </table>
            ) : <None />}
            {data.comments.length > 0 && (
              <p style={{ margin: '6px 0 0', fontSize: 12 }}>
                {data.comments.length} commentaire{data.comments.length > 1 ? 's' : ''} sur les actions {[...new Set(data.comments.map((c) => c.actionId))].join(', ')}
                {data.comments.some((c) => c.withdrawn) && ` (dont ${data.comments.filter((c) => c.withdrawn).length} retiré(s), texte conservé en base)`}.
              </p>
            )}
          </Section>
          <Section num={++n} title="Pièces jointes déposées" count={data.attachments.length}>
            {data.attachments.length ? (
              <table className="table pp-table">
                <thead><tr><th>Fichier</th><th>Fiche</th><th>Déposé le</th></tr></thead>
                <tbody>{data.attachments.map((a) => <tr key={a.id}><td>{a.fileName}{a.health ? ' (pièce médicale)' : ''}</td><td>{a.entity}</td><td>{a.on}</td></tr>)}</tbody>
              </table>
            ) : <None />}
          </Section>
          <Section num={++n} title="Responsabilités dans le système de management">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
              <li>Documents maîtrisés (propriétaire) : {data.documents.map((d) => `${d.id} · ${d.title}`).join(' ; ') || 'aucun'}</li>
              <li>Programme d&apos;audit : {data.planItems.map((p) => `${p.label} — ${p.role}`).join(' ; ') || 'aucun'}</li>
              <li>Revues de direction (participant) : {data.reviews.map((r) => fmtDate(r.reviewOn)).join(', ') || 'aucune'}</li>
              <li>Situations d&apos;urgence (responsable) : {data.situations.map((x) => x.label).join(' ; ') || 'aucune'}</li>
              <li>Demandes de changement (demandeur ou pilote) : {data.changeRequests.map((x) => `${x.id} · ${x.title}`).join(' ; ') || 'aucune'}</li>
              <li>Notifications reçues : {data.notifications}</li>
            </ul>
          </Section>
          <Section num={++n} title="Journal des modifications effectuées par la personne" count={data.changes.total}>
            {data.changes.rows.length ? (
              <table className="table pp-table">
                <thead><tr><th>Le</th><th>Fiche</th><th>Modification</th></tr></thead>
                <tbody>{data.changes.rows.map((c, i) => <tr key={i}><td style={{ whiteSpace: 'nowrap' }}>{c.at}</td><td>{c.entityType} · {c.entityId}</td><td>{c.summary}</td></tr>)}</tbody>
              </table>
            ) : <None />}
            {data.changes.total > data.changes.rows.length && <p className="pp-muted" style={{ fontSize: 11.5 }}>{data.changes.rows.length} entrées les plus récentes affichées.</p>}
          </Section>
          <Section num={++n} title="Consultations effectuées par la personne" count={data.accesses.total}>
            {data.accesses.rows.length ? (
              <table className="table pp-table">
                <thead><tr><th>Le</th><th>Nature</th><th>Fiche</th></tr></thead>
                <tbody>{data.accesses.rows.map((a, i) => <tr key={i}><td style={{ whiteSpace: 'nowrap' }}>{a.at}</td><td>{a.kind}</td><td>{a.entityType} · {a.entityId}</td></tr>)}</tbody>
              </table>
            ) : <None />}
          </Section>
        </>
      )}
      <div className="pp-foot">Extraction établie d&apos;après les données de Vigie · données des autres outils (Cursus, Keystone, Codex) non comprises.</div>
    </article>
  );
}
