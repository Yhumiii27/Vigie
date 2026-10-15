import { PrintButton } from '@/components/PrintButton';
import { CERT_TONE_LABELS, certDot, type CertTone } from '@/components/audits/shared';
import { Dot, ToneTag } from '@/components/ui';
import { daysBetween, fmtDate, monthName, yearOf } from '@/lib/dates';
import { TONE, type Role } from '@/lib/domain';
import type { ReviewDossierPage, ReviewRecordOnly, StoredDossier } from '@/lib/data/review';
import {
  ActionRefs, ActionStatus, ActionTable, Blank, Empty, FollowUpTable, Kpi, PyramidRow, RecordText, Ref, Section,
  capitalize, evalCount, fmtNum, fmtPct, followUpAside, fromMonth, plural, sectionCounter,
} from './dossier-parts';

/**
 * Contenu du dossier : calculé (préparatoire), figé à la saisie du compte rendu (dossier de séance), figé au visa
 * (instantané), ou compte rendu seul (revue antérieure à Vigie). Chaque section vérifie ses données : un instantané d'un
 * format antérieur reste lisible (section 1 « previousActions » des instantanés de version 1).
 */
type DossierData = ReviewRecordOnly & Partial<Omit<StoredDossier, keyof ReviewRecordOnly>>;

const BLANK_DECISIONS = 3;

export function DossierView({ page, role }: { page: Exclude<ReviewDossierPage, { mode: 'none' | 'cancelled' }>; role: Role }) {
  const d: DossierData = page.mode === 'record' ? page.record : page.dossier;
  const h = d.header;
  const r = d.record;
  // Date d'arrêt des indicateurs (fin de la période examinée) : retards, échéances ; la séance une fois passée (AUD-06).
  const asOf = page.mode === 'record' ? page.now : page.asOf || h.to;
  const atSeance = asOf === h.reviewOn;
  const held = h.status !== 'planifiee';
  const n = sectionCounter();
  const others = page.reviews.filter((x) => x.id !== page.review.id);
  const kind = h.kind.replace(/^Revue\s+/i, '').toLowerCase();
  const done = d.checklist.filter((c) => c.done).length;
  const participants = [...(r.participants ?? []), r.externalParticipants].filter(Boolean);

  const stopped = `indicateurs arrêtés ${atSeance ? 'à la séance du' : 'au'} ${fmtDate(asOf)}`;
  const taken = (on: string, by: string) => `le ${on ? fmtDate(on) : '—'}${by ? ` par ${by}` : ''}`;
  const banner = page.mode === 'snapshot'
    ? { icon: 'ph-lock-simple', tone: 'ok' as const, text: `Dossier figé au visa ${taken(page.takenOn, page.takenBy)} · ${stopped}` }
    : page.mode === 'seance'
      ? { icon: 'ph-lock-simple-open', tone: 'accent' as const, text: `Dossier de séance figé ${taken(page.takenOn, '')} · ${stopped} · compte rendu modifiable jusqu'au visa` }
      : page.mode === 'record'
        ? { icon: 'ph-archive', tone: 'neutral' as const, text: 'Revue antérieure à Vigie · dossier non archivé' }
        : { icon: 'ph-arrows-clockwise', tone: 'warn' as const, text: `Dossier préparatoire · indicateurs calculés le ${fmtDate(page.now)}${asOf < page.now ? `, arrêtés à la séance du ${fmtDate(asOf)}` : ''}` };

  return (
    <main className="rd-doc">
      <div className="rd-toolbar rd-noprint">
        {/* Liens HTML simples (navigation complète) : la feuille globale dossier.css, et sa règle @page, ne doit pas rester chargée dans l'application. */}
        <a href={`/audits?annee=${yearOf(h.reviewOn)}&revue=${page.review.id}#revue`} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} />Audits et certifications</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="rd-muted" style={{ fontSize: 11.5 }}>Pour le PDF : « Enregistrer au format PDF » dans la boîte d&apos;impression.</span>
          <PrintButton />
        </span>
      </div>
      <div className="rd-toolbar rd-noprint">
        <ToneTag tone={banner.tone} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i className={`ph ${banner.icon}`} style={{ fontSize: 12 }} />{banner.text}</ToneTag>
        {others.length > 0 && (
          <nav aria-label="Autres revues" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, fontSize: 12 }}>
            <span className="rd-muted">Autres revues :</span>
            {others.map((o) => (
              <a key={o.id} href={`/revue-de-direction?revue=${o.id}`} className="rd-link" title={o.statusLabel}>{o.kindShort} {fmtDate(o.reviewOn)}</a>
            ))}
          </nav>
        )}
      </div>

      <header className="rd-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · système de management QHSE</div>
        <h1>Revue de direction {kind} du {fmtDate(h.reviewOn)}</h1>
        <div className="rd-muted" style={{ fontSize: 12.5 }}>
          {page.mode === 'snapshot' && `Dossier figé au visa de la direction ${taken(page.takenOn, page.takenBy)}${page.seance ? ` · dossier de séance du ${page.seance.takenOn ? fmtDate(page.seance.takenOn) : '—'}` : ''} · ${stopped}`}
          {page.mode === 'seance' && `Dossier de séance figé ${taken(page.takenOn, page.takenBy)} · ${stopped} · compte rendu modifiable jusqu'au visa`}
          {page.mode === 'record' && 'Compte rendu enregistré · revue antérieure à Vigie : dossier préparatoire non archivé'}
          {page.mode === 'live' && `Dossier préparatoire consolidé · généré le ${fmtDate(page.now)} par ${h.author}`}
        </div>
        <dl className="rd-meta">
          {page.mode !== 'record' && <><dt>Période examinée</dt><dd>12 mois glissants, du {fmtDate(h.from)} au {fmtDate(h.to)}</dd></>}
          <dt>Périmètre</dt><dd>{h.site}</dd>
          <dt>Présidence</dt><dd>{h.director}</dd>
          <dt>Animation</dt><dd>{h.lead}</dd>
          <dt>Participants</dt>
          <dd>
            {participants.length ? participants.join(', ') : (
              <><span className="rd-muted">[À compléter : responsables de service, responsable qualité, représentants du personnel…]</span><Blank /></>
            )}
          </dd>
        </dl>
      </header>

      {d.previousFollowUp ? (
        <Section n={n()} title="Suivi des décisions et actions des revues précédentes" aside={followUpAside(d.previousFollowUp)}>
          {d.previousFollowUp.length ? <FollowUpTable rows={d.previousFollowUp} role={role} />
            : <Empty>Aucune décision ni action issue des revues précédentes.</Empty>}
        </Section>
      ) : d.previousActions && (
        // Instantané de version 1 (avant le lot 2) : actions des revues précédentes seulement.
        <Section n={n()} title="Suivi des actions des revues précédentes" aside={plural(d.previousActions.length, 'action', 'actions')}>
          {d.previousActions.length ? <ActionTable rows={d.previousActions} role={role} review extra={(a) => a.originRef} />
            : <Empty>Aucune action issue des revues précédentes.</Empty>}
        </Section>
      )}

      {d.safety && (
        <Section n={n()} title="Indicateurs sécurité" aside={d.safety.missingMonths !== undefined ? '12 derniers mois complets' : '12 mois glissants'}>
          <div className="rd-kpis">
            <Kpi label="Jours sans accident avec arrêt" value={d.safety.daysWithout} note={d.safety.daysNote} />
            <Kpi label="TF1 · taux de fréquence" value={d.safety.tf1}
              note={`Accidents avec arrêt par million d'heures · objectif < ${d.safety.target}${d.safety.missingMonths ? ` · ${plural(d.safety.missingMonths, 'mois', 'mois')} sans heures saisies` : ''}`} />
            <Kpi label="TG · taux de gravité" value={d.safety.tg} note="Jours perdus pour 1 000 heures travaillées" />
          </div>
          <h3 className="rd-h3">Pyramide des événements sécurité</h3>
          <div className="rd-pyramid">
            {d.safety.pyramid.map((p) => <PyramidRow key={p.label} label={p.label} n={p.n} w={p.w} color={p.color} />)}
          </div>
        </Section>
      )}

      {d.events && (
        <Section n={n()} title="Non-conformités et événements" aside={`${plural(d.events.openNc?.length ?? 0, 'NC ouverte', 'NC ouvertes')}`}>
          <div className="rd-cols">
            <table className="table rd-table">
              <thead><tr><th>Type</th><th className="rd-num-cell">12 mois</th><th className="rd-num-cell">ouverts</th></tr></thead>
              <tbody>
                {d.events.byType?.map((t) => (
                  <tr key={t.key}><td>{t.label}</td><td className="rd-num-cell">{t.n12}</td><td className="rd-num-cell">{t.open}</td></tr>
                ))}
              </tbody>
            </table>
            <table className="table rd-table">
              <thead><tr><th>Non-conformités par origine</th><th className="rd-num-cell">12 mois</th><th className="rd-num-cell">ouvertes</th></tr></thead>
              <tbody>
                {d.events.ncByOrigin?.map((o) => (
                  <tr key={o.origin}><td>{o.origin}</td><td className="rd-num-cell">{o.n12}</td><td className="rd-num-cell">{o.open}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="rd-empty rd-muted">Les réclamations client sont comptées sous l&apos;origine « Réclamation client ».</p>
          <h3 className="rd-h3">Non-conformités ouvertes</h3>
          {d.events.openNc?.length ? (
            <table className="table rd-table">
              <thead><tr><th>Réf.</th><th>Date</th><th>Non-conformité</th><th>Origine</th><th>Étape</th><th>Actions</th></tr></thead>
              <tbody>
                {d.events.openNc.map((e) => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}><Ref href={e.href} role={role}>{e.id}</Ref></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.occurredOn)}</td>
                    <td>{e.title}<div className="rd-muted" style={{ fontSize: 11 }}>Pilote : {e.pilot}</div></td>
                    <td className="rd-muted">{e.origin}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{e.step}</td>
                    <td><ActionRefs actions={e.actions} role={role} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>Aucune non-conformité ouverte.</Empty>}
        </Section>
      )}

      {d.complaints && (() => {
        const open = d.complaints.filter((c) => c.open).length;
        const closed = d.complaints.length - open;
        return (
          <Section n={n()} title="Satisfaction client et réclamations" aside="12 mois glissants">
            <p className="rd-summary">
              {d.complaints.length} réclamation{d.complaints.length > 1 ? 's' : ''} client enregistrée{d.complaints.length > 1 ? 's' : ''}
              {d.complaints.length > 0 && ` · ${open} en cours de traitement · ${closed} clôturée${closed > 1 ? 's' : ''}`}
            </p>
            {d.complaints.length ? (
              <table className="table rd-table">
                <thead><tr><th>Réf.</th><th>Date</th><th>Réclamation</th><th>Projet Keystone</th><th>Étape</th><th>Actions</th></tr></thead>
                <tbody>
                  {d.complaints.map((c) => (
                    <tr key={c.id}>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}><Ref href={c.href} role={role}>{c.id}</Ref></td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(c.occurredOn)}</td>
                      <td>{c.title}<div className="rd-muted" style={{ fontSize: 11 }}>Pilote : {c.pilot}</div></td>
                      <td className="rd-muted">{c.project ?? '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{c.step}</td>
                      <td><ActionRefs actions={c.actions} role={role} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty>Aucune réclamation client sur la période.</Empty>}
            <h3 className="rd-h3">Perception des clients</h3>
            <RecordText text={r.customerPerception} held={held} placeholder="résultats d'enquête de satisfaction, retours clients, respect des délais de livraison" />
          </Section>
        );
      })()}

      {d.suppliers && (
        <Section n={n()} title="Performance des fournisseurs">
          <p className="rd-summary">
            {plural(d.suppliers.summary?.audits ?? 0, 'audit fournisseur au programme', 'audits fournisseurs au programme')} ({d.suppliers.summary?.auditsDone ?? 0} réalisé{(d.suppliers.summary?.auditsDone ?? 0) > 1 ? 's' : ''})
            {' · '}{plural(d.suppliers.summary?.ncs ?? 0, 'non-conformité fournisseur', 'non-conformités fournisseurs')} sur 12 mois, dont {d.suppliers.summary?.ncOpen ?? 0} ouverte{(d.suppliers.summary?.ncOpen ?? 0) > 1 ? 's' : ''}
          </p>
          <h3 className="rd-h3">Audits fournisseurs du programme</h3>
          {d.suppliers.audits?.length ? (
            <table className="table rd-table">
              <thead><tr><th>Date</th><th>Intitulé</th><th>Auditeur</th><th>État</th></tr></thead>
              <tbody>
                {d.suppliers.audits.map((p) => (
                  <tr key={p.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{p.plannedOn ? fmtDate(p.plannedOn) : `${capitalize(monthName(p.month))} ${p.year}`}</td>
                    <td><Ref href={p.href} role={role}>{p.detail ?? p.label}</Ref></td>
                    <td className="rd-muted">{p.auditor ?? p.owner ?? '—'}</td>
                    <td><ToneTag tone={p.state.tone} style={{ whiteSpace: 'nowrap' }}>{p.state.label}</ToneTag></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>Aucun audit fournisseur sur la période.</Empty>}
          <h3 className="rd-h3">Non-conformités d&apos;origine fournisseur</h3>
          {d.suppliers.ncs?.length ? (
            <table className="table rd-table">
              <thead><tr><th>Réf.</th><th>Date</th><th>Non-conformité</th><th>Étape</th><th>Actions</th></tr></thead>
              <tbody>
                {d.suppliers.ncs.map((e) => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}><Ref href={e.href} role={role}>{e.id}</Ref></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.occurredOn)}</td>
                    <td>{e.title}<div className="rd-muted" style={{ fontSize: 11 }}>Pilote : {e.pilot}</div></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{e.step}</td>
                    <td><ActionRefs actions={e.actions} role={role} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>Aucune non-conformité fournisseur sur la période.</Empty>}
        </Section>
      )}

      {d.audits && (
        <Section n={n()} title="Audits et certifications">
          <h3 className="rd-h3">Certifications</h3>
          {d.audits.certs?.length ? (
            <table className="table rd-table">
              <thead><tr><th>Référentiel</th><th>Domaine</th><th>Statut</th><th>Commentaire</th></tr></thead>
              <tbody>
                {d.audits.certs.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{c.standard}</td>
                    <td>{c.domain}</td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Dot color={certDot(c.tone)} />{c.status?.label}</span>
                      <div className="rd-muted" style={{ fontSize: 11 }}>{[CERT_TONE_LABELS[c.tone as CertTone], c.organization].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="rd-muted">{c.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>Aucun référentiel suivi.</Empty>}

          <h3 className="rd-h3"><Ref href={d.audits.programmeHref} role={role}>Programme d&apos;audits et de visites</Ref></h3>
          {d.audits.progFrom && d.audits.progTo && d.audits.programmeCounts && (
            <p className="rd-summary">
              {fromMonth(d.audits.progFrom)} à {monthName(+d.audits.progTo.slice(5, 7))} {yearOf(d.audits.progTo)} (période examinée et année suivant la revue) · {d.audits.programmeCounts.done} réalisé{d.audits.programmeCounts.done > 1 ? 's' : ''} · {d.audits.programmeCounts.pending} à confirmer (échéance passée) · {d.audits.programmeCounts.upcoming} à venir
              {d.audits.programmeCounts.cancelled != null && ` · ${d.audits.programmeCounts.cancelled} annulé${d.audits.programmeCounts.cancelled > 1 ? 's' : ''}`}
              {d.audits.programmeCounts.postponed != null && ` · ${d.audits.programmeCounts.postponed} reporté${d.audits.programmeCounts.postponed > 1 ? 's' : ''}`}
            </p>
          )}
          {d.audits.programme?.length ? (
            <table className="table rd-table">
              <thead><tr><th>Mois</th><th>Ligne</th><th>Intitulé</th><th>Responsable</th><th>État</th></tr></thead>
              <tbody>
                {d.audits.programme.map((p) => (
                  <tr key={p.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{p.plannedOn ? fmtDate(p.plannedOn) : `${capitalize(monthName(p.month))} ${p.year}`}</td>
                    <td className="rd-muted" style={{ whiteSpace: 'nowrap' }}>{p.track}</td>
                    <td>
                      <Ref href={p.href} role={role}>{p.detail ?? p.label}</Ref>
                      {p.postponedFrom && <div className="rd-muted" style={{ fontSize: 11 }}>Reporté · initialement {p.postponedFrom.endsWith('-01') ? `${monthName(+p.postponedFrom.slice(5, 7))} ${yearOf(p.postponedFrom)}` : fmtDate(p.postponedFrom)}</div>}
                      {p.action && <div className="rd-muted" style={{ fontSize: 11 }}><Ref href={p.action.href} role={role}>{p.action.id}</Ref> · {p.action.status}</div>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{p.owner || '—'}</td>
                    <td><ToneTag tone={p.state.tone} style={{ whiteSpace: 'nowrap' }}>{p.state.label}</ToneTag></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>Aucun élément au programme sur cette période.</Empty>}

          <h3 className="rd-h3">Constats d&apos;audit</h3>
          {d.audits.auditGroups?.length ? d.audits.auditGroups.map((g) => (
            <div key={g.label} style={{ display: 'grid', gap: 4 }}>
              <h4 className="rd-h4">{g.label}</h4>
              <table className="table rd-table">
                <thead><tr><th>Type</th><th>Constat</th><th>Action</th><th>Statut de l&apos;action</th></tr></thead>
                <tbody>
                  {g.findings.map((f) => (
                    <tr key={f.id}>
                      <td><ToneTag tone={f.tone} style={{ whiteSpace: 'nowrap' }}>{f.kindLabel}</ToneTag></td>
                      <td>{f.text}{f.clause && <span className="rd-muted"> · {f.clause}</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {f.actionId ? <Ref href={f.action?.href} role={role}>{f.actionId}</Ref> : f.kind === 'point_fort' ? '—' : <span className="rd-muted">Sans action</span>}
                      </td>
                      <td>{f.action ? <ActionStatus a={f.action} /> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )) : <Empty>Aucun constat enregistré.</Empty>}
        </Section>
      )}

      {d.actions && (
        <Section n={n()} title="Plan d'actions" aside={`${plural(d.actions.totals?.open ?? 0, 'ouverte', 'ouvertes')} · ${d.actions.totals?.late ?? 0} en retard`}>
          {d.actions.byOrigin?.length ? (
            <table className="table rd-table">
              <thead><tr><th>Origine</th><th className="rd-num-cell">Ouvertes</th><th className="rd-num-cell">dont en retard</th><th className="rd-num-cell">Efficacité à vérifier</th><th className="rd-num-cell">Clôturées · 12 mois</th></tr></thead>
              <tbody>
                {d.actions.byOrigin.map((o) => (
                  <tr key={o.key}>
                    <td>{o.label}</td>
                    <td className="rd-num-cell">{o.open}</td>
                    <td className="rd-num-cell" style={{ color: o.late ? TONE.danger.dot : undefined }}>{o.late}</td>
                    <td className="rd-num-cell">{o.verify}</td>
                    <td className="rd-num-cell">{o.closed}</td>
                  </tr>
                ))}
                {d.actions.totals && (
                  <tr className="rd-total">
                    <td>Total</td>
                    <td className="rd-num-cell">{d.actions.totals.open}</td>
                    <td className="rd-num-cell">{d.actions.totals.late}</td>
                    <td className="rd-num-cell">{d.actions.totals.verify}</td>
                    <td className="rd-num-cell">{d.actions.totals.closed}</td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : <Empty>Aucune action au plan d&apos;actions.</Empty>}
          {!!d.actions.lateActions?.length && (
            <>
              <h3 className="rd-h3">Actions en retard</h3>
              <table className="table rd-table">
                <thead><tr><th>Réf.</th><th>Action</th><th>Origine</th><th>Pilote</th><th>Échéance</th><th className="rd-num-cell">Retard</th></tr></thead>
                <tbody>
                  {d.actions.lateActions.map((a) => (
                    <tr key={a.id}>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}><Ref href={a.href} role={role}>{a.id}</Ref></td>
                      <td>{a.title}</td>
                      <td className="rd-muted">{a.origin} · {a.originRef}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{a.pilot}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.dueOn)}</td>
                      <td className="rd-num-cell">{daysBetween(a.dueOn, asOf)} j</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Section>
      )}

      {d.watch && (
        <Section n={n()} title="Veille réglementaire et contrôles périodiques"
          aside={d.watch.requirementCounts?.filter((c) => c.n).map((c) => `${c.n} ${evalCount(c.key, c.label, c.n)}`).join(' · ')}>
          <h3 className="rd-h3">Exigences réglementaires</h3>
          {d.watch.requirements?.length ? (
            <table className="table rd-table">
              <thead><tr><th>Exigence</th><th>Domaine</th><th>Évaluation</th><th>Échéance</th><th>Pilote</th><th>Action</th></tr></thead>
              <tbody>
                {d.watch.requirements.map((q) => (
                  <tr key={q.id}>
                    <td style={{ fontWeight: 500 }}><Ref href={q.href} role={role}>{q.text}</Ref></td>
                    <td className="rd-muted">{q.domain}</td>
                    <td>
                      <ToneTag tone={q.tone} style={{ whiteSpace: 'nowrap' }}>{q.evalLabel}</ToneTag>
                      {q.evalNote && <div className="rd-muted" style={{ fontSize: 11, marginTop: 2 }}>{q.evalNote}</div>}
                      {q.lastEvaluatedOn && <div className="rd-muted" style={{ fontSize: 11 }}>évaluée le {fmtDate(q.lastEvaluatedOn)}</div>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{[q.dueOn && fmtDate(q.dueOn), q.dueNote].filter(Boolean).join(' · ') || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{q.pilot}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{q.action ? <><Ref href={q.action.href} role={role}>{q.action.id}</Ref> · <ActionStatus a={q.action} plain /></> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>Aucune exigence suivie.</Empty>}
          {d.watch.controls && (
            <>
              <h3 className="rd-h3">Contrôles périodiques</h3>
              <p className="rd-summary">
                {d.watch.controls.overdue} dépassé{d.watch.controls.overdue > 1 ? 's' : ''} · {d.watch.controls.soon} sous 30 jours · {d.watch.controls.planned} planifié{d.watch.controls.planned > 1 ? 's' : ''} · {plural(d.watch.controls.withReserves, 'contrôle avec réserves', 'contrôles avec réserves')}
              </p>
              {d.watch.controls.rows?.length ? (
                <table className="table rd-table">
                  <thead><tr><th>Équipement</th><th>Contrôle</th><th>Organisme</th><th>Échéance</th><th>État</th><th>Réserves</th></tr></thead>
                  <tbody>
                    {d.watch.controls.rows.map((c) => (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 500 }}><Ref href={c.href} role={role}>{c.equipment}</Ref></td>
                        <td>{c.type}</td>
                        <td className="rd-muted">{c.organization}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(c.nextOn)}</td>
                        <td><ToneTag tone={c.status.tone} style={{ whiteSpace: 'nowrap' }}>{c.status.label}</ToneTag></td>
                        <td>
                          {c.reserves ?? '—'}
                          {c.action && <div className="rd-muted" style={{ fontSize: 11 }}><Ref href={c.action.href} role={role}>{c.action.id}</Ref> · {c.action.status}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <Empty>Aucun contrôle dépassé, à échéance sous 30 jours ou avec réserves.</Empty>}
            </>
          )}
        </Section>
      )}

      {d.risks && (
        <Section n={n()} title="Évaluation des risques (DUERP)">
          {d.risks.version ? (
            <p className="rd-summary">
              Version {d.risks.version.version} du {fmtDate(d.risks.version.updatedOn)} · prochaine mise à jour le {fmtDate(d.risks.version.nextUpdateOn)}
              {d.risks.version.daysToUpdate != null && d.risks.version.daysToUpdate < 0 && <span style={{ color: TONE.danger.fg }}> (dépassée de {-d.risks.version.daysToUpdate} j)</span>}
              {' · '}{d.risks.version.cseConsultedOn ? `CSE consulté le ${fmtDate(d.risks.version.cseConsultedOn)}` : 'consultation du CSE non enregistrée'}
            </p>
          ) : <Empty>Aucune version du DUERP en vigueur.</Empty>}
          {d.risks.priority && (
            <>
              <h3 className="rd-h3">Risques prioritaires</h3>
              <p className="rd-summary">
                {plural(d.risks.priority.count, 'risque coté au-dessus du seuil d’action', 'risques cotés au-dessus du seuil d’action')} · {d.risks.priority.withoutAction} sans action en cours
              </p>
              {d.risks.priority.top?.length ? (
                <table className="table rd-table">
                  <thead><tr><th>Unité de travail</th><th>Danger</th><th className="rd-num-cell">Brut → résiduel</th><th>Actions</th></tr></thead>
                  <tbody>
                    {d.risks.priority.top.map((k) => (
                      <tr key={k.id}>
                        <td style={{ whiteSpace: 'nowrap' }}><Ref href={k.href} role={role}>{k.unit}</Ref></td>
                        <td>{k.hazard}</td>
                        <td className="rd-num-cell">{k.score} → {k.residual}</td>
                        <td>{k.actions.length ? k.actions.map((a) => (
                          <div key={a.id} style={{ whiteSpace: 'nowrap' }}><Ref href={a.href} role={role}>{a.id}</Ref> · <span style={{ color: a.tone === 'neutral' ? undefined : TONE[a.tone].dot }}>{a.status}</span></div>
                        )) : <span className="rd-muted">Sans action</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <Empty>Aucun risque au-dessus du seuil d&apos;action.</Empty>}
            </>
          )}
        </Section>
      )}

      {d.prevention && (
        <Section n={n()} title="Prévention des entreprises extérieures">
          {!!d.prevention.kpis?.length && (
            <div className="rd-kpis">
              {d.prevention.kpis.map((k) => <Kpi key={k.label} label={k.label} value={k.value} tone={k.tone} note={[k.sub, k.note].filter(Boolean).join(' · ')} />)}
            </div>
          )}
          <h3 className="rd-h3">Écarts et échéances</h3>
          {d.prevention.gaps?.length ? (
            <ul className="rd-list">
              {d.prevention.gaps.map((g) => (
                <li key={`${g.href}|${g.title}`}>
                  <Dot color={TONE[g.tone].dot} />
                  <span><Ref href={g.href} role={role}>{g.title}</Ref></span>
                  <span className="rd-muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(g.date)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty>Aucun écart ni échéance de prévention.</Empty>}
        </Section>
      )}

      {d.documents && (
        <Section n={n()} title="Maîtrise documentaire">
          {!!d.documents.kpis?.length && (
            <div className="rd-kpis">
              {d.documents.kpis.map((k) => <Kpi key={k.key} label={k.label} value={String(k.value)} tone={k.key === 'retard' && k.value ? 'danger' : undefined} note={[k.sub, k.note].filter(Boolean).join(' · ')} />)}
            </div>
          )}
          <h3 className="rd-h3">Revues périodiques en retard</h3>
          {d.documents.overdue?.length ? (
            <table className="table rd-table">
              <thead><tr><th>Réf.</th><th>Document</th><th>Propriétaire</th><th>Revue prévue le</th></tr></thead>
              <tbody>
                {d.documents.overdue.map((x) => (
                  <tr key={x.id}>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}><Ref href={x.href} role={role}>{x.id}</Ref></td>
                    <td>{x.title}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{x.owner}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{x.nextReviewOn ? fmtDate(x.nextReviewOn) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>Aucune revue documentaire dépassée.</Empty>}
          <h3 className="rd-h3">Versions en attente d&apos;approbation</h3>
          {d.documents.pending?.length ? (
            <table className="table rd-table">
              <thead><tr><th>Réf.</th><th>Version</th><th>Document</th><th>Soumise le</th></tr></thead>
              <tbody>
                {d.documents.pending.map((x) => (
                  <tr key={`${x.docId}-${x.version}`}>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}><Ref href={x.href} role={role}>{x.docId}</Ref></td>
                    <td>{x.version}</td>
                    <td>{x.title}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{x.submittedOn ? fmtDate(x.submittedOn) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>Aucune version en revue.</Empty>}
        </Section>
      )}

      {d.environment && (
        <Section n={n()} title="Performance environnementale" aside={`Année ${d.environment.year}`}>
          {d.environment.certification && (
            <p className="rd-summary">
              {d.environment.certification.standard} {d.environment.certification.engaged ? `· ${d.environment.certification.status}` : 'non engagé · suivi réglementaire'}
              {d.environment.certification.note && <span className="rd-muted"> · {d.environment.certification.note}</span>}
            </p>
          )}
          {d.environment.kpis && (
            <div className="rd-kpis">
              <Kpi label="Déchets évacués" value={`${fmtNum(d.environment.kpis.tonnes)} t`}
                note={`${plural(d.environment.kpis.entries, 'enlèvement', 'enlèvements')}${d.environment.kpis.prevTonnes != null ? ` · ${fmtNum(d.environment.kpis.prevTonnes)} t l'an dernier` : ''}`} />
              <Kpi label="Part de déchets dangereux" value={fmtPct(d.environment.kpis.hazardousShare)} />
              <Kpi label="Taux de valorisation" value={fmtPct(d.environment.kpis.recoveryShare)} />
              <Kpi label="BSD manquants" value={String(d.environment.kpis.missingBsd)} tone={d.environment.kpis.missingBsd ? 'danger' : undefined} note="Déchets dangereux sans bordereau Trackdéchets" />
              <Kpi label="Électricité" value={`${fmtNum(d.environment.kpis.electricity.current, 0)} kWh`}
                note={[d.environment.kpis.electricity.period, d.environment.kpis.electricity.delta != null ? `${d.environment.kpis.electricity.delta > 0 ? '+' : ''}${fmtNum(d.environment.kpis.electricity.delta * 100)} % sur un an` : null].filter(Boolean).join(' · ')} />
            </div>
          )}
          <p className="rd-summary">
            {plural(d.environment.openEvents ?? 0, 'événement environnemental ouvert', 'événements environnementaux ouverts')} · {d.environment.envClosed12 ?? 0} clôturé{(d.environment.envClosed12 ?? 0) > 1 ? 's' : ''} sur 12 mois
          </p>
        </Section>
      )}

      {d.skills && (
        <Section n={n()} title="Ressources et compétences">
          {d.skills.counts && (
            <p className="rd-summary">
              {d.skills.counts.people} salarié{d.skills.counts.people > 1 ? 's' : ''} suivi{d.skills.counts.people > 1 ? 's' : ''} dans la <Ref href={d.skills.href} role={role}>matrice</Ref> · {d.skills.counts.expired} titre{d.skills.counts.expired > 1 ? 's' : ''} expiré{d.skills.counts.expired > 1 ? 's' : ''} · {d.skills.counts.soon} expirant sous 60 jours · {d.skills.counts.never} requis jamais suivi{d.skills.counts.never > 1 ? 's' : ''}
            </p>
          )}
          <h3 className="rd-h3">Alertes d&apos;habilitation sur les affectations Keystone</h3>
          {d.skills.alerts?.length ? (
            <table className="table rd-table">
              <thead><tr><th>Salarié</th><th>Titre</th><th>État</th><th>Affectation</th><th>Période</th></tr></thead>
              <tbody>
                {d.skills.alerts.map((a) => (
                  <tr key={`${a.person}-${a.title}-${a.assignment}-${a.startOn}`}>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}><Ref href={a.href} role={role}>{a.person}</Ref></td>
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
          <RecordText text={r.resourceNeeds} held={held} placeholder="effectifs, équipements, budget, formations à programmer" />
        </Section>
      )}

      <Section n={n()} title="Préparation, décisions et objectifs" aside={d.checklist.length ? `${done}/${d.checklist.length} éléments fournis` : undefined}>
        <h3 className="rd-h3">Éléments d&apos;entrée de la revue</h3>
        {d.checklist.length ? (
          <div>
            {d.checklist.map((c) => (
              <div key={c.id} className="rd-check">
                <i className={`ph ${c.done ? 'ph-check-square' : 'ph-square'}`} style={{ fontSize: 15, color: c.done ? TONE.ok.dot : 'var(--color-neutral-500)' }} aria-label={c.done ? 'Fourni' : 'À fournir'} />
                <span>{c.label}</span>
                <span className="rd-muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap', color: c.late ? TONE.danger.fg : undefined }}>{c.done ? 'Fourni' : 'À fournir'} · {c.ownerLabel}</span>
              </div>
            ))}
          </div>
        ) : <Empty>Aucun élément de préparation saisi.</Empty>}

        {(r.minutes || page.mode === 'record') && (
          <>
            <h3 className="rd-h3">Compte rendu et conclusions</h3>
            <RecordText text={r.minutes} held={held} placeholder="conclusions de la séance" />
            {page.mode === 'record' && (
              <>
                <h3 className="rd-h3">Perception des clients</h3>
                <RecordText text={r.customerPerception} held={held} placeholder="" />
                <h3 className="rd-h3">Besoins en ressources</h3>
                <RecordText text={r.resourceNeeds} held={held} placeholder="" />
              </>
            )}
          </>
        )}

        <h3 className="rd-h3">Décisions et objectifs</h3>
        <table className="table rd-table">
          <thead><tr><th>Nature</th><th style={{ width: '46%' }}>Décision, objectif ou besoin en ressources</th><th>Pilote</th><th>Échéance</th><th>Action</th></tr></thead>
          <tbody>
            {d.decisions.map((x) => (
              <tr key={x.id}>
                <td><ToneTag tone={x.tone} style={{ whiteSpace: 'nowrap' }}>{x.kindLabel}</ToneTag></td>
                <td>{x.text}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{x.pilot}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{x.dueOn ? fmtDate(x.dueOn) : '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{x.action ? <><Ref href={`/actions?action=${encodeURIComponent(x.action.id)}`} role={role}>{x.action.id}</Ref> · <ActionStatus a={x.action} plain /></> : x.actionId ?? '—'}</td>
              </tr>
            ))}
            {h.status === 'planifiee' && Array.from({ length: BLANK_DECISIONS }, (_, i) => (
              <tr key={`blank-${i}`} className="rd-blank-row"><td /><td /><td /><td /><td /></tr>
            ))}
          </tbody>
        </table>
        {!d.decisions.length && h.status !== 'planifiee' && <Empty>Aucune décision enregistrée.</Empty>}
        {d.extraActions.length > 0 && (
          <>
            <h3 className="rd-h3">Autres actions issues de la revue</h3>
            <ActionTable rows={d.extraActions} role={role} />
          </>
        )}
        <p className="rd-empty rd-muted" style={{ marginTop: 4 }}>Les décisions retenues sont suivies dans le plan d&apos;actions unique avec l&apos;origine « Revue de direction ».</p>
        <div className="rd-sign">
          <div>Date de la prochaine revue{r.nextReviewOn && <div className="rd-sign-value">{fmtDate(r.nextReviewOn)}</div>}</div>
          <div>Visa de la direction{r.closedOn && <div className="rd-sign-value">{r.closedBy ?? '—'} le {fmtDate(r.closedOn)}</div>}</div>
        </div>
      </Section>

      <div className="rd-foot">
        {page.mode === 'live' && `Document généré par Vigie le ${fmtDate(page.now)} · indicateurs calculés à cette date${asOf < page.now ? `, arrêtés à la séance du ${fmtDate(asOf)}` : ''}, à valider en séance.`}
        {page.mode === 'seance' && `Dossier de séance figé par Vigie le ${page.takenOn ? fmtDate(page.takenOn) : '—'} · ${stopped} · compte rendu modifiable jusqu'au visa de la direction.`}
        {page.mode === 'snapshot' && `Dossier figé par Vigie le ${page.takenOn ? fmtDate(page.takenOn) : '—'} au visa de la direction · ${stopped}.`}
        {page.mode === 'record' && `Compte rendu enregistré dans Vigie · consulté le ${fmtDate(page.now)}.`}
      </div>
    </main>
  );
}
