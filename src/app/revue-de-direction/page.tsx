import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PrintButton } from '@/components/audits/PrintButton';
import { CERT_TONE_LABELS, certDot, type CertTone } from '@/components/audits/shared';
import { Dot, ToneTag } from '@/components/ui';
import { daysBetween, fmtDate, monthName, monthOf, yearOf } from '@/lib/dates';
import { FINDING_KINDS, TONE, type Tone } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadReviewDossier, type ActionBrief } from '@/lib/data/audits';
import './dossier.css';

export const metadata: Metadata = { title: 'Dossier de revue de direction' };

const BLANK_DECISIONS = 6;

// Dossier consolidé de la revue de direction (ISO 9001 §9.3), ouvert dans un nouvel onglet depuis /audits.
export default async function ReviewDossierPage() {
  await guard('audits');
  const d = await loadReviewDossier();
  const h = d.header;
  const now = h.to;
  const checklistDone = d.checklist.filter((c) => c.done).length;
  const openComplaints = d.complaints.filter((c) => c.open).length;

  return (
    <main className="rd-doc">
      <div className="rd-toolbar rd-noprint">
        {/* Lien HTML simple (navigation complète) : la feuille globale dossier.css, et sa règle @page, ne doit pas rester chargée dans l'application. */}
        <a href="/audits" className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} />Audits et certifications</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="rd-muted" style={{ fontSize: 11.5 }}>Pour le PDF : « Enregistrer au format PDF » dans la boîte d&apos;impression.</span>
          <PrintButton />
        </span>
      </div>

      <header className="rd-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · système de management QHSE</div>
        <h1>Revue de direction {h.reviewOn ? `du ${fmtDate(h.reviewOn)}` : '— date à fixer'}</h1>
        <div className="rd-muted" style={{ fontSize: 12.5 }}>Dossier préparatoire consolidé · généré le {fmtDate(now)} par {h.author}</div>
        <dl className="rd-meta">
          <dt>Période examinée</dt><dd>12 mois glissants, du {fmtDate(h.from)} au {fmtDate(now)}</dd>
          <dt>Périmètre</dt><dd>{h.site}</dd>
          <dt>Présidence</dt><dd>{h.director}</dd>
          <dt>Animation</dt><dd>{h.lead}</dd>
          <dt>Participants</dt>
          <dd>
            <span className="rd-muted">[À compléter : responsables de service, responsable qualité, représentants du personnel…]</span>
            <div className="rd-blank" /><div className="rd-blank" />
          </dd>
        </dl>
      </header>

      <Section n={1} title="Suivi des actions de la revue précédente" aside={`${d.reviewActions.length} action${d.reviewActions.length > 1 ? 's' : ''}`}>
        {d.reviewActions.length ? (
          <ActionTable rows={d.reviewActions} extra={(a) => a.originRef} />
        ) : <Empty>Aucune action issue de la revue précédente.</Empty>}
      </Section>

      <Section n={2} title="Indicateurs sécurité" aside="12 mois glissants">
        <div className="rd-kpis">
          <Kpi label="Jours sans accident avec arrêt" value={d.safety.daysWithout} note={d.safety.daysNote} />
          <Kpi label="TF1 · taux de fréquence" value={d.safety.tf1} note={`Accidents avec arrêt par million d'heures · objectif < ${d.safety.target}`} />
          <Kpi label="TG · taux de gravité" value={d.safety.tg} note="Jours perdus pour 1 000 heures travaillées" />
        </div>
        <h3 className="rd-h3">Pyramide des événements sécurité</h3>
        <div className="rd-pyramid">
          {d.safety.pyramid.map((p) => (
            <PyramidRow key={p.label} label={p.label} n={p.n} w={p.w} color={p.color} />
          ))}
        </div>
      </Section>

      <Section n={3} title="Audits et certifications">
        <h3 className="rd-h3">Certifications</h3>
        <table className="table rd-table">
          <thead><tr><th>Référentiel</th><th>Domaine</th><th>Statut</th><th>Commentaire</th></tr></thead>
          <tbody>
            {d.certs.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{c.standard}</td>
                <td>{c.domain}</td>
                <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Dot color={certDot(c.tone)} />{c.status}</span>
                  <div className="rd-muted" style={{ fontSize: 11 }}>{CERT_TONE_LABELS[c.tone as CertTone] ?? ''}</div></td>
                <td className="rd-muted">{c.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!d.certs.length && <Empty>Aucun référentiel suivi.</Empty>}

        <h3 className="rd-h3">Programme d&apos;audits et de visites</h3>
        <p className="rd-summary">
          {fromMonth(d.progFrom)} à {monthName(monthOf(d.progTo))} {yearOf(d.progTo)} (période examinée et année suivant la revue) · {d.programmeCounts.done} réalisé{d.programmeCounts.done > 1 ? 's' : ''} · {d.programmeCounts.pending} à confirmer (échéance passée) · {d.programmeCounts.upcoming} à venir
        </p>
        {d.programme.length ? (
          <table className="table rd-table">
            <thead><tr><th>Mois</th><th>Ligne</th><th>Intitulé</th><th>Responsable</th><th>État</th></tr></thead>
            <tbody>
              {d.programme.map((p) => (
                <tr key={p.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{p.plannedOn ? fmtDate(p.plannedOn) : `${capitalize(monthName(p.month))} ${p.year}`}</td>
                  <td className="rd-muted" style={{ whiteSpace: 'nowrap' }}>{p.track}</td>
                  <td>{p.detail ?? p.label}{p.action && <div className="rd-muted" style={{ fontSize: 11 }}>{p.action.id} · {p.action.status}</div>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{p.owner || '—'}</td>
                  <td><ToneTag tone={p.state.tone} style={{ whiteSpace: 'nowrap' }}>{p.state.label}</ToneTag></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>Aucun élément au programme sur cette période.</Empty>}

        <h3 className="rd-h3">Constats d&apos;audit</h3>
        {d.auditGroups.length ? d.auditGroups.map((g) => (
          <div key={g.label} style={{ display: 'grid', gap: 4 }}>
            <h4 className="rd-h4">{g.label}</h4>
            <table className="table rd-table">
              <thead><tr><th>Type</th><th>Constat</th><th>Action</th><th>Statut de l&apos;action</th></tr></thead>
              <tbody>
                {g.findings.map((f) => {
                  const k = FINDING_KINDS[f.kind] ?? { label: f.kind, tone: 'neutral' as Tone };
                  return (
                    <tr key={f.id}>
                      <td><ToneTag tone={k.tone} style={{ whiteSpace: 'nowrap' }}>{k.label}</ToneTag></td>
                      <td>{f.text}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{f.actionId ?? (f.kind === 'point_fort' ? '—' : <span className="rd-muted">Sans action</span>)}</td>
                      <td>{f.action ? <ActionStatus a={f.action} /> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )) : <Empty>Aucun constat enregistré.</Empty>}
      </Section>

      <Section n={4} title="Satisfaction client et réclamations" aside="12 mois glissants">
        <p className="rd-summary">
          {d.complaints.length} réclamation{d.complaints.length > 1 ? 's' : ''} client enregistrée{d.complaints.length > 1 ? 's' : ''}
          {d.complaints.length > 0 && ` · ${openComplaints} en cours de traitement · ${d.complaints.length - openComplaints} clôturée${d.complaints.length - openComplaints > 1 ? 's' : ''}`}
        </p>
        {d.complaints.length ? (
          <table className="table rd-table">
            <thead><tr><th>Réf.</th><th>Date</th><th>Réclamation</th><th>Projet Keystone</th><th>Étape</th><th>Actions</th></tr></thead>
            <tbody>
              {d.complaints.map((c) => (
                <tr key={c.id}>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{c.id}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(c.occurredOn)}</td>
                  <td>{c.title}<div className="rd-muted" style={{ fontSize: 11 }}>Pilote : {c.pilot}</div></td>
                  <td className="rd-muted">{c.project ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{c.step}</td>
                  <td>{c.actions.length ? c.actions.map((a) => <div key={a.id} style={{ whiteSpace: 'nowrap' }}>{a.id} · <ActionStatus a={a} plain /></div>) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>Aucune réclamation client sur la période.</Empty>}
        <h3 className="rd-h3">Perception des clients</h3>
        <p className="rd-empty rd-muted">[À compléter : résultats d&apos;enquête de satisfaction, retours clients, respect des délais de livraison]</p>
        <div className="rd-blank" /><div className="rd-blank" />
      </Section>

      <Section n={5} title="Plan d'actions" aside={`${d.totals.open} ouverte${d.totals.open > 1 ? 's' : ''} · ${d.totals.late} en retard`}>
        {d.byOrigin.length ? (
          <table className="table rd-table">
            <thead><tr><th>Origine</th><th className="rd-num-cell">Ouvertes</th><th className="rd-num-cell">dont en retard</th><th className="rd-num-cell">Efficacité à vérifier</th><th className="rd-num-cell">Clôturées · 12 mois</th></tr></thead>
            <tbody>
              {d.byOrigin.map((o) => (
                <tr key={o.key}>
                  <td>{o.label}</td>
                  <td className="rd-num-cell">{o.open}</td>
                  <td className="rd-num-cell" style={{ color: o.late ? TONE.danger.dot : undefined }}>{o.late}</td>
                  <td className="rd-num-cell">{o.verify}</td>
                  <td className="rd-num-cell">{o.closed}</td>
                </tr>
              ))}
              <tr className="rd-total">
                <td>Total</td>
                <td className="rd-num-cell">{d.totals.open}</td>
                <td className="rd-num-cell">{d.totals.late}</td>
                <td className="rd-num-cell">{d.totals.verify}</td>
                <td className="rd-num-cell">{d.totals.closed}</td>
              </tr>
            </tbody>
          </table>
        ) : <Empty>Aucune action au plan d&apos;actions.</Empty>}
        {d.lateActions.length > 0 && (
          <>
            <h3 className="rd-h3">Actions en retard</h3>
            <table className="table rd-table">
              <thead><tr><th>Réf.</th><th>Action</th><th>Origine</th><th>Pilote</th><th>Échéance</th><th className="rd-num-cell">Retard</th></tr></thead>
              <tbody>
                {d.lateActions.map((a) => (
                  <tr key={a.id}>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{a.id}</td>
                    <td>{a.title}</td>
                    <td className="rd-muted">{a.origin} · {a.originRef}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{a.pilot}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.dueOn)}</td>
                    <td className="rd-num-cell">{daysBetween(a.dueOn, now)} j</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Section>

      <Section n={6} title="Veille réglementaire" aside={d.requirementCounts.filter((c) => c.n).map((c) => `${c.n} ${evalCount(c.key, c.label, c.n)}`).join(' · ')}>
        {d.requirements.length ? (
          <table className="table rd-table">
            <thead><tr><th>Exigence</th><th>Domaine</th><th>Évaluation</th><th>Échéance</th><th>Pilote</th><th>Action</th></tr></thead>
            <tbody>
              {d.requirements.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500 }}>{r.text}</td>
                  <td className="rd-muted">{r.domain}</td>
                  <td><ToneTag tone={r.tone} style={{ whiteSpace: 'nowrap' }}>{r.evalLabel}</ToneTag>{r.evalNote && <div className="rd-muted" style={{ fontSize: 11, marginTop: 2 }}>{r.evalNote}</div>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{[r.dueOn && fmtDate(r.dueOn), r.dueNote].filter(Boolean).join(' · ') || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.pilot}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.action ? <>{r.action.id} · <ActionStatus a={r.action} plain /></> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>Aucune exigence suivie.</Empty>}
      </Section>

      <Section n={7} title="Ressources et compétences">
        <p className="rd-summary">
          {d.skillCounts.people} salarié{d.skillCounts.people > 1 ? 's' : ''} suivi{d.skillCounts.people > 1 ? 's' : ''} dans la matrice · {d.skillCounts.expired} titre{d.skillCounts.expired > 1 ? 's' : ''} expiré{d.skillCounts.expired > 1 ? 's' : ''} · {d.skillCounts.soon} expirant sous 60 jours · {d.skillCounts.never} requis jamais suivi{d.skillCounts.never > 1 ? 's' : ''}
        </p>
        <h3 className="rd-h3">Alertes d&apos;habilitation sur les affectations Keystone</h3>
        {d.skillAlerts.length ? (
          <table className="table rd-table">
            <thead><tr><th>Salarié</th><th>Titre</th><th>État</th><th>Affectation</th><th>Période</th></tr></thead>
            <tbody>
              {d.skillAlerts.map((a) => (
                <tr key={`${a.person}-${a.title}-${a.assignment}-${a.startOn}`}>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{a.person}</td>
                  <td>{a.title}</td>
                  <td><ToneTag tone={a.state.tone} style={{ whiteSpace: 'nowrap' }}>{a.state.label}</ToneTag></td>
                  <td>{a.assignment}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.startOn)} → {fmtDate(a.endOn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>Aucune affectation à venir sur un titre manquant, expiré ou expirant avant la fin de l&apos;affectation.</Empty>}
        <h3 className="rd-h3">Besoins en ressources</h3>
        <p className="rd-empty rd-muted">[À compléter : effectifs, équipements, budget, formations à programmer]</p>
        <div className="rd-blank" /><div className="rd-blank" />
      </Section>

      <Section n={8} title="Préparation, décisions et objectifs" aside={d.checklist.length ? `${checklistDone}/${d.checklist.length} éléments fournis` : undefined}>
        <h3 className="rd-h3">Éléments d&apos;entrée de la revue</h3>
        {d.checklist.length ? (
          <div>
            {d.checklist.map((c) => (
              <div key={c.id} className="rd-check">
                <i className={`ph ${c.done ? 'ph-check-square' : 'ph-square'}`} style={{ fontSize: 15, color: c.done ? TONE.ok.dot : 'var(--color-neutral-500)' }} aria-label={c.done ? 'Fourni' : 'À fournir'} />
                <span>{c.label}</span>
                <span className="rd-muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{c.done ? 'Fourni' : 'À fournir'} · {c.owner || '—'}</span>
              </div>
            ))}
          </div>
        ) : <Empty>Aucun élément de préparation saisi.</Empty>}

        <h3 className="rd-h3">Décisions et objectifs</h3>
        <table className="table rd-table">
          <thead><tr><th style={{ width: '58%' }}>Décision, objectif ou besoin en ressources</th><th>Pilote</th><th>Échéance</th></tr></thead>
          <tbody>
            {Array.from({ length: BLANK_DECISIONS }, (_, i) => (
              <tr key={i} className="rd-blank-row"><td /><td /><td /></tr>
            ))}
          </tbody>
        </table>
        <p className="rd-empty rd-muted" style={{ marginTop: 4 }}>Les décisions retenues sont saisies dans le plan d&apos;actions unique avec l&apos;origine « Revue de direction ».</p>
        <div className="rd-sign">
          <div>Date de la prochaine revue</div>
          <div>Visa de la direction</div>
        </div>
      </Section>

      <div className="rd-foot">Document généré par Vigie le {fmtDate(now)} · indicateurs calculés à cette date, à valider en séance.</div>
    </main>
  );
}

function Section({ n, title, aside, children }: { n: number; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rd-section">
      <div className="rd-section-head">
        <h2><span className="rd-num">{n}.</span>{title}</h2>
        {aside && <span className="rd-muted" style={{ fontSize: 11.5 }}>{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rd-empty rd-muted">{children}</p>;
}

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rd-kpi">
      <span className="rd-kpi-label">{label}</span>
      <span className="rd-kpi-value">{value}</span>
      {note && <span className="rd-kpi-note">{note}</span>}
    </div>
  );
}

function PyramidRow({ label, n, w, color }: { label: string; n: number; w: string; color: string }) {
  return (
    <>
      <span>{label}</span>
      <span style={{ display: 'block', background: 'color-mix(in srgb, var(--color-text) 6%, transparent)', borderRadius: 4 }}>
        <span className="rd-bar" style={{ display: 'block', width: n ? w : 0, background: color }} />
      </span>
      <span className="rd-num-cell" style={{ fontWeight: 500 }}>{n}</span>
    </>
  );
}

function ActionStatus({ a, plain }: { a: ActionBrief; plain?: boolean }) {
  if (plain) return <span style={{ color: a.tone === 'neutral' ? undefined : TONE[a.tone].dot }}>{a.status}</span>;
  return (
    <span style={{ display: 'grid', gap: 2 }}>
      <ToneTag tone={a.tone} style={{ whiteSpace: 'nowrap', justifySelf: 'start' }}>{a.status}</ToneTag>
      <span className="rd-muted" style={{ fontSize: 11 }}>{a.pilot} · échéance {fmtDate(a.dueOn)}</span>
    </span>
  );
}

function ActionTable({ rows, extra }: { rows: (ActionBrief & { originRef: string })[]; extra?: (a: ActionBrief & { originRef: string }) => ReactNode }) {
  return (
    <table className="table rd-table">
      <thead><tr><th>Réf.</th><th>Action</th><th>Pilote</th><th>Échéance</th><th>Statut</th></tr></thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.id}>
            <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{a.id}</td>
            <td>
              {a.title}
              {extra && <div className="rd-muted" style={{ fontSize: 11 }}>{extra(a)}</div>}
              {a.efficacyNote && <div className="rd-muted" style={{ fontSize: 11 }}>Efficacité : {a.efficacyNote}</div>}
            </td>
            <td style={{ whiteSpace: 'nowrap' }}>{a.pilot}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.dueOn)}{a.closedOn && <div className="rd-muted" style={{ fontSize: 11 }}>clôturée le {fmtDate(a.closedOn)}</div>}</td>
            <td><ToneTag tone={a.tone} style={{ whiteSpace: 'nowrap' }}>{a.status}</ToneTag></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/** « D'octobre 2025 », « De juin 2026 » (élision devant avril, août, octobre). */
const fromMonth = (iso: string) => {
  const m = monthName(monthOf(iso));
  return `${/^[aeiou]/.test(m) ? "D'" : 'De '}${m} ${yearOf(iso)}`;
};

/** Évaluations de conformité au singulier et au pluriel (« 1 écart », « 3 conformes »). */
const EVAL_COUNT: Record<string, [string, string]> = {
  conforme: ['conforme', 'conformes'],
  ecart: ['écart', 'écarts'],
  analyse: ["analyse d'écart en cours", "analyses d'écart en cours"],
  a_evaluer: ['à évaluer', 'à évaluer'],
};
const evalCount = (key: string, label: string, n: number) => EVAL_COUNT[key]?.[n > 1 ? 1 : 0] ?? label.toLowerCase();
