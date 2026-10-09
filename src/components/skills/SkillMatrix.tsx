'use client';

import { useEffect, useOptimistic, useRef, useState, useSyncExternalStore, useTransition, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ActionFields } from '@/components/ActionFormDialog';
import { Attachments } from '@/components/Attachments';
import { Dialog, DialogButton } from '@/components/Dialog';
import { Input, Select } from '@/components/form';
import { ReasonForm } from '@/components/ReasonDialog';
import { Icon } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { SKILL_FILTERS, SKILL_STATES, type SkillFilter, type SkillState } from '@/lib/domain';
import type { FormOptions, Option } from '@/lib/data/options';
import type { ArchivedRecord, SkillCell, SkillRow, TrainingTitle } from '@/lib/data/skills';
import type { Person } from '@/lib/queries';
import { addQualificationFiles, cancelQualification, reinstatePerson, removeQualificationFile, setRequirement } from '@/server/skills';
import { Fact, HistoryTable, PlannedMark, RenewalLink, SkillDot, canPlanRenewal, lcfirst, period, planLabel, plannedLabel, renewalDefaults, renewalNoun, stateDetail, validityLabel } from './common';
import { PersonForm } from './PersonForm';
import { lapseFor } from './rules';
import { TitlesButton } from './TitlesManager';
import { TrainingForm } from './TrainingForm';

type Opts = Pick<FormOptions, 'people' | 'origins' | 'sites'>;

type Props = {
  titles: TrainingTitle[];
  /** Titres archivés (liste « Titres suivis », restauration). */
  archivedTitles: TrainingTitle[];
  rows: SkillRow[];
  /** Personnel du site non suivi dans la matrice. */
  others: Person[];
  /** Salariés sortis de l'effectif (filtre « Sortis », encadrement). */
  departed: Person[];
  /** Formations conservées des salariés sortis et des titres archivés (consultation seule). */
  archive: ArchivedRecord[];
  /** Sites archivés, pour la fiche d'un salarié qui y est encore rattaché (vue « Tous les sites »). */
  archivedSites: readonly Option[];
  /** Vue Salarié : sa seule ligne, sans filtres ni personnel. */
  self: boolean;
  canManage: boolean;
  options: Opts;
  today: string;
  defaultSiteId: string;
  /** Lien profond ?salarie=…&titre=… : case ouverte (titre donné) ou ligne mise en évidence. */
  initialSel?: { personId: string; titleId?: string };
  /** URL rétablie à la fermeture d'une case ouverte par lien profond. */
  closeHref: string;
};

type Chip = 'tous' | SkillFilter;
type Saved = { chip: Chip; service: string };

const clean = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Filtres mémorisés par navigateur (puce et service) : préférence d'affichage, la page fonctionne sans.
const FILTER_KEY = 'vigie.skills.filter';
const DEFAULT_FILTER = JSON.stringify({ chip: 'tous', service: '' } satisfies Saved);
let savedFilter: string | null = null;
const filterListeners = new Set<() => void>();
const filterSnapshot = () => {
  if (savedFilter === null) {
    try { savedFilter = localStorage.getItem(FILTER_KEY) ?? DEFAULT_FILTER; } catch { savedFilter = DEFAULT_FILTER; }
  }
  return savedFilter;
};
const subscribeFilter = (fn: () => void) => { filterListeners.add(fn); return () => { filterListeners.delete(fn); }; };
function writeFilter(next: Saved) {
  savedFilter = JSON.stringify(next);
  try { localStorage.setItem(FILTER_KEY, savedFilter); } catch { /* stockage indisponible : filtre conservé pour la page */ }
  filterListeners.forEach((fn) => fn());
}
function parseFilter(raw: string): Saved {
  try {
    const v = JSON.parse(raw) as Partial<Saved>;
    const chip = v.chip === 'a_traiter' || v.chip === 'sortis' ? v.chip : 'tous';
    return { chip, service: typeof v.service === 'string' ? v.service : '' };
  } catch {
    return { chip: 'tous', service: '' };
  }
}

/** Ligne « à traiter » : titre requis à échéance proche, expiré ou jamais suivi, ou manque pendant une affectation. */
const toTreat = (r: SkillRow, today: string) =>
  r.cells.some((c) => c.state === 's' || c.state === 'x' || c.state === 'r' || r.assignments.some((a) => lapseFor(c.state, c.expiresOn, a, today) !== null));

const LEGEND: SkillState[] = ['v', 's', 'x', 'r', 'n'];
const sub = (text: string) => <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{text}</span>;

/** Recyclage planifié et pas encore réalisé (action à lancer ou en cours). */
const plannedOf = (c: SkillCell) => (c.renewal?.planned ? c.renewal : null);

function cellTip(c: SkillCell) {
  const s = SKILL_STATES[c.state];
  const r = c.renewal;
  // Action rattachée : « recyclage planifié (A-xxx) », ou son statut quand elle n'est plus à réaliser (efficacité à vérifier).
  const action = !r ? '' : r.planned
    ? ` · ${renewalNoun(c.state)} ${c.state === 'r' ? 'planifiée' : 'planifié'} (${r.id})`
    : ` · action de ${renewalNoun(c.state)} ${r.id} (${lcfirst(r.statusLabel)})`;
  return `${c.title.label} — ${s.label}${c.expiresOn && c.state !== 'n' ? ` · échéance ${fmtDate(c.expiresOn)}` : ''}${action}`;
}

/** Bouton désactivé d'une fonction à venir (l'infobulle reste lisible sur le bouton inactif). */
function Soon({ label, icon, tip }: { label: string; icon: string; tip: string }) {
  return (
    <span title={tip} style={{ display: 'inline-flex' }}>
      <button type="button" className="btn btn-secondary vg-btn-sm" disabled title={tip}><Icon name={icon} size={13} />{label}</button>
    </span>
  );
}

/** Contenu de la fenêtre d'une case : état, dates, organisme, recyclage, exigence, attestations, historique. */
function CellView({ row, cell, canManage, today, onRecord, onCorrect, onCancelTraining, onPlan }: {
  row: SkillRow; cell: SkillCell; canManage: boolean; today: string;
  onRecord: () => void; onCorrect: () => void; onPlan: () => void;
  /** Annulation d'une formation de l'historique (la formation en cours ou une plus ancienne saisie par erreur). */
  onCancelTraining: (id: number) => void;
}) {
  const [pending, start] = useTransition();
  const [required, setRequired] = useOptimistic(cell.required);
  const [error, setError] = useState<string | null>(null);
  const s = SKILL_STATES[cell.state];
  const next = row.assignments[0];
  // Une action de recyclage ouverte (non clôturée) est rattachée à l'exigence : on ne peut pas la retirer.
  const locked = required && !!cell.renewal;
  const toggle = () => start(async () => {
    setRequired(!required);
    const r = await setRequirement(row.person.id, cell.title.id, !required);
    setError(r.error ?? null);
  });
  const requiredHint = !canManage
    ? "Modification réservée à l'encadrement et à l'animation QHSE."
    : locked
      ? `Retirer l'exigence suppose de clôturer d'abord l'action ${cell.renewal!.id}.`
      : required
        ? 'Le titre est suivi pour ce salarié (alertes et échéances).'
        : "Le titre n'est pas exigé pour ce salarié ; les formations enregistrées sont conservées.";
  const switchOff = !canManage || locked;
  const qid = cell.qualificationId;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="vg-inset" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
        <SkillDot state={cell.state} size={28} />
        <div style={{ display: 'grid', gap: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 500 }}>{s.label}</span>
          <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{stateDetail(cell, today)}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px 16px' }}>
        <Fact label="Salarié">{row.person.name}{sub(row.person.job)}</Fact>
        <Fact label="Titre">{cell.title.label}{sub(validityLabel(cell.title))}</Fact>
        <Fact label="Obtenu le">{cell.obtainedOn ? fmtDate(cell.obtainedOn) : '—'}</Fact>
        <Fact label="Échéance">{cell.expiresOn ? fmtDate(cell.expiresOn) : cell.obtainedOn ? 'Sans échéance' : '—'}</Fact>
        <Fact label="Organisme de formation">{cell.provider ?? '—'}</Fact>
        <Fact label="Prochaine affectation Keystone">
          {next ? <>{next.project}{sub(`${next.activity} · ${period(next.startOn, next.endOn)}`)}</> : '—'}
        </Fact>
        <Fact label={cell.renewal && !cell.renewal.planned ? `Action de ${renewalNoun(cell.state)}` : plannedLabel(cell.state)} wide>
          {cell.renewal ? <RenewalLink renewal={cell.renewal} /> : <span style={{ color: 'var(--color-neutral-500)' }}>{cell.state === 'r' ? 'Aucune' : 'Aucun'}</span>}
        </Fact>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <button type="button" role="switch" aria-checked={required} aria-label="Requis pour ce salarié" className={`vg-switch${required ? ' is-on' : ''}`}
          disabled={switchOff || pending} onClick={toggle} style={{ padding: 0, cursor: switchOff ? 'not-allowed' : 'pointer', opacity: switchOff ? 0.6 : 1 }}>
          <span />
        </button>
        <div style={{ display: 'grid', gap: 1 }}>
          <span style={{ fontSize: 12.5 }}>Requis pour ce salarié</span>
          <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>{requiredHint}</span>
        </div>
      </div>
      {error && <div role="alert" className="vg-form-error">{error}</div>}

      {qid !== null && (
        <Attachments title="Attestations" kicker={`${cell.title.label} — ${row.person.name}`} files={cell.files} canAdd={canManage}
          emptyText="Aucune attestation jointe." hint="Attestation de la formation en cours · PDF ou photo"
          onAdd={(picked) => {
            const fd = new FormData();
            fd.set('qualificationId', String(qid));
            picked.forEach((f) => fd.append('files', f));
            return addQualificationFiles(fd);
          }}
          onRemove={removeQualificationFile} />
      )}

      <HistoryTable entries={cell.history} onCancel={canManage ? (e) => onCancelTraining(e.id) : undefined} />

      {canManage && (
        <div className="dialog-actions" style={{ marginTop: 0, flexWrap: 'wrap' }}>
          {qid !== null && (
            <button type="button" className="btn btn-ghost" onClick={() => onCancelTraining(qid)} style={{ marginRight: 'auto' }}>
              <Icon name="ph-prohibit" size={14} />Annuler cette formation
            </button>
          )}
          {qid !== null && (
            <button type="button" className="btn btn-secondary" onClick={onCorrect}><Icon name="ph-pencil-simple" size={14} />Corriger</button>
          )}
          {canPlanRenewal(cell) && (
            <button type="button" className="btn btn-secondary" onClick={onPlan}><Icon name="ph-calendar-plus" size={14} />{planLabel(cell.state)}</button>
          )}
          <button type="button" className="btn btn-primary" onClick={onRecord}><Icon name="ph-certificate" size={14} />Enregistrer / renouveler</button>
        </div>
      )}
    </div>
  );
}

/** Formations conservées d'un salarié sorti, titre par titre (consultation seule, attestations comprises). */
function DepartedHistory({ records }: { records: ArchivedRecord[] }) {
  if (records.length === 0) return <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>Aucune formation enregistrée.</div>;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {records.map((r) => (
        <HistoryTable key={r.title.id} entries={r.entries}
          title={<>{r.title.label}{r.title.archivedAt && <span style={{ color: 'var(--color-neutral-600)', fontWeight: 400 }}> · titre archivé</span>}</>} />
      ))}
    </div>
  );
}

/** Salariés sortis de l'effectif (filtre « Sortis ») : date, motif, formations conservées et réintégration. */
function DepartedList({ people, archive }: { people: Person[]; archive: ArchivedRecord[] }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewed, setViewed] = useState<Person | null>(null);
  const reinstate = (id: string) => {
    setBusy(id);
    start(async () => { setError((await reinstatePerson(id)).error ?? null); setBusy(null); });
  };
  const recordsOf = (id: string) => archive.filter((r) => r.person.id === id);
  return (
    <div className="card" style={{ padding: '6px 14px 10px' }}>
      <table className="table" style={{ fontSize: 12.5 }}>
        <tbody>
          {people.length === 0 && (
            <tr><td style={{ padding: '14px 8px', fontSize: 12, color: 'var(--color-neutral-500)' }}>Aucun salarié ne correspond aux filtres.</td></tr>
          )}
          {people.map((p) => (
            <tr key={p.id}>
              <td>
                <span style={{ display: 'block' }}>{p.name}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--color-neutral-500)' }}>{[p.job, p.service].filter(Boolean).join(' · ')}</span>
              </td>
              <td style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>Sorti le {fmtDate(p.leftOn!)}{p.leftReason ? ` · ${p.leftReason}` : ''}</td>
              <td style={{ textAlign: 'right', width: 1, whiteSpace: 'nowrap' }}>
                <span style={{ display: 'inline-flex', gap: 10 }}>
                  <button type="button" className="vg-text-btn" onClick={() => setViewed(p)}>Formations ({recordsOf(p.id).reduce((n, r) => n + r.entries.length, 0)})</button>
                  <button type="button" className="vg-text-btn" disabled={pending} onClick={() => reinstate(p.id)}>{busy === p.id ? 'Réintégration…' : 'Réintégrer'}</button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <div role="alert" className="vg-form-error">{error}</div>}
      <Dialog open={!!viewed} onClose={() => setViewed(null)} width={600} kicker="Salarié sorti · consultation seule" title={viewed ? `Formations de ${viewed.name}` : ''}>
        {viewed && <DepartedHistory records={recordsOf(viewed.id)} />}
      </Dialog>
    </div>
  );
}

/** Matrice salariés × titres, légende, filtres, barre d'outils et fenêtres associées. */
export function SkillMatrix({ titles, archivedTitles, rows, others, departed, archive, archivedSites, self, canManage, options, today, defaultSiteId, initialSel, closeHref }: Props) {
  const router = useRouter();
  const [sel, setSel] = useState<{ personId: string; titleId: string } | null>(initialSel?.titleId ? { personId: initialSel.personId, titleId: initialSel.titleId } : null);
  const [mode, setMode] = useState<'view' | 'record' | 'correct' | 'cancel' | 'plan'>('view');
  // Formation de l'historique à annuler (mode 'cancel').
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  // Lien profond en cours : l'URL est rétablie à la fermeture de la case ; sans titre, la ligne est mise en évidence.
  const [linked, setLinked] = useState(!!initialSel);
  const [highlight, setHighlight] = useState(initialSel && !initialSel.titleId ? initialSel.personId : null);
  const [query, setQuery] = useState('');
  const saved = parseFilter(useSyncExternalStore(subscribeFilter, filterSnapshot, () => DEFAULT_FILTER));
  // Vue Salarié : pas de filtres ; « Sortis » réservé à l'encadrement.
  const chip: Chip = self || (saved.chip === 'sortis' && !canManage) ? 'tous' : saved.chip;

  // Nouveau lien profond pendant que l'écran est ouvert (notification, « À faire ») : on ouvre la case visée.
  const linkKey = initialSel ? `${initialSel.personId}:${initialSel.titleId ?? ''}` : '';
  const [seenLink, setSeenLink] = useState(linkKey);
  if (linkKey !== seenLink) {
    setSeenLink(linkKey);
    if (initialSel) {
      setLinked(true);
      setSel(initialSel.titleId ? { personId: initialSel.personId, titleId: initialSel.titleId } : null);
      setMode('view');
      setHighlight(initialSel.titleId ? null : initialSel.personId);
      setQuery('');
    }
  }
  // Un lien profond remet les filtres à zéro pour que la ligne visée soit visible.
  useEffect(() => {
    if (linkKey) writeFilter({ chip: 'tous', service: '' });
  }, [linkKey]);
  const hlRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => { if (highlight) hlRef.current?.scrollIntoView({ block: 'center' }); }, [highlight]);

  const row = sel ? rows.find((r) => r.person.id === sel.personId) : undefined;
  const cell = sel ? row?.cells.find((c) => c.title.id === sel.titleId) : undefined;
  const editPerson = editId ? rows.find((r) => r.person.id === editId)?.person ?? others.find((p) => p.id === editId) : undefined;

  const openCell = (personId: string, titleId: string) => { setSel({ personId, titleId }); setMode('view'); };
  const closeCell = () => {
    setSel(null);
    if (linked) { setLinked(false); router.replace(closeHref, { scroll: false }); }
  };
  const back = () => setMode('view');
  const closeEdit = () => setEditId(null);
  const onKey = (id: string) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditId(id); }
  };

  // Filtres (côté client) : recherche nom / poste / service, service, « À traiter », « Sortis ».
  const services = [...new Set([...rows.map((r) => r.person.service), ...others.map((p) => p.service), ...departed.map((p) => p.service)].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'fr'));
  const service = !self && services.includes(saved.service) ? saved.service : '';
  const q = clean(query.trim());
  const matches = (p: Person) => (!service || p.service === service) && (!q || clean(`${p.name} ${p.job} ${p.service}`).includes(q));
  const treat = rows.filter((r) => toTreat(r, today));
  const shown = (chip === 'a_traiter' ? treat : rows).filter((r) => matches(r.person));
  const shownDeparted = departed.filter(matches);
  const setChip = (c: Chip) => writeFilter({ chip: c, service });
  const setService = (v: string) => writeFilter({ chip, service: v });
  const chipCount: Record<Chip, number | null> = { tous: null, a_traiter: treat.length, sortis: departed.length };
  const chips: { key: Chip; label: string }[] = [{ key: 'tous', label: 'Tous' }, ...SKILL_FILTERS.filter((f) => f.key !== 'sortis' || canManage)];

  const cellName = row && cell ? `${cell.title.label} — ${row.person.name}` : '';
  // Correction de la formation en cours (même ligne de l'historique) ; sinon nouvelle formation datée du jour.
  const initial = cell?.qualificationId && cell.obtainedOn
    ? { qualificationId: cell.qualificationId, obtainedOn: cell.obtainedOn, expiresOn: cell.expiresOn, provider: cell.provider }
    : undefined;
  // Recherchée même annulée : la fenêtre reste montée le temps que l'annulation réussie la referme.
  const toCancel = cell?.history.find((e) => e.id === cancelId);
  const KICKER = { view: 'Habilitations et formations', record: cellName, correct: cellName, cancel: cellName, plan: "Plan d'actions unique" } as const;
  const TITLE = { view: cellName, record: 'Enregistrer une formation', correct: 'Corriger la formation', cancel: 'Annuler cette formation', plan: cell ? planLabel(cell.state) : '' } as const;

  return (
    <>
      {/* Légende à gauche, boutons poussés à droite sur la même ligne (cf. maquette). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--color-neutral-400)' }}>
        {LEGEND.map((k) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <SkillDot state={k} size={18} />{SKILL_STATES[k].label}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 18, display: 'inline-grid', placeItems: 'center' }}><PlannedMark /></span>Formation ou recyclage planifié
        </span>
        {!self && (
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Soon label="Importer le personnel (Lucca · CSV)" icon="ph-upload-simple" tip="Import à venir" />
            <Soon label="Connecteur Cursus · à venir" icon="ph-plugs-connected" tip="Cursus est propriétaire des données personnelles des salariés" />
            <TitlesButton titles={titles} archivedTitles={archivedTitles} archive={archive} canManage={canManage} />
            {canManage && (
              <DialogButton label="Ajouter un salarié" icon="ph-user-plus" title="Ajouter un salarié" kicker="Personnel" width={540}>
                {(close) => <PersonForm sites={options.sites} archivedSites={archivedSites} services={services} defaultSiteId={defaultSiteId} today={today} onDone={close} onCancel={close} />}
              </DialogButton>
            )}
            {canManage && (
              <DialogButton label="Enregistrer une formation" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Enregistrer une formation" kicker="Habilitations et formations" width={560}>
                {(close) => <TrainingForm rows={rows} titles={titles} today={today} onDone={close} onCancel={close} />}
              </DialogButton>
            )}
          </span>
        )}
      </div>

      {!self && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
            <Input name="skills-search" type="search" placeholder="Rechercher un salarié, un poste, un service…" aria-label="Rechercher un salarié"
              value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {services.length > 0 && (
            <div style={{ flex: '0 1 200px' }}>
              <Select name="skills-service" aria-label="Service" options={services.map((x) => [x, x] as const)} placeholder="Tous les services"
                value={service} onChange={(e) => setService(e.target.value)} />
            </div>
          )}
          <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            {chips.map((c) => (
              <button key={c.key} type="button" className={`vg-chip${chip === c.key ? ' is-on' : ''}`} aria-pressed={chip === c.key} onClick={() => setChip(c.key)}>
                {c.label}{chipCount[c.key] !== null && ` (${chipCount[c.key]})`}
              </button>
            ))}
          </span>
        </div>
      )}

      {chip === 'sortis' ? <DepartedList people={shownDeparted} archive={archive} /> : (
        <div className="card" style={{ padding: '6px 14px 10px' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: 12.5, minWidth: 880 }}>
              <thead>
                <tr>
                  <th>Salarié</th>
                  {titles.map((t) => <th key={t.id} title={validityLabel(t)} style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{t.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={titles.length + 1} style={{ padding: '14px 8px', fontSize: 12, color: 'var(--color-neutral-500)' }}>
                      {rows.length === 0 ? 'Aucun salarié suivi dans la matrice pour ce site.' : 'Aucun salarié ne correspond aux filtres.'}
                    </td>
                  </tr>
                )}
                {shown.map((r) => {
                  const hl = highlight === r.person.id;
                  const meta = (
                    <>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--color-neutral-500)' }}>{r.person.job}</span>
                      {r.person.service && <span style={{ display: 'block', fontSize: 11, color: 'var(--color-neutral-600)' }}>{r.person.service}</span>}
                      {r.leavingOn && <span style={{ display: 'block', fontSize: 11, color: 'var(--tone-warn-fg)' }}>Sortie le {fmtDate(r.leavingOn)}</span>}
                    </>
                  );
                  return (
                    <tr key={r.person.id} ref={hl ? hlRef : undefined}
                      style={hl ? { background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)', outline: '1px solid var(--color-accent)', outlineOffset: -1 } : undefined}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {canManage ? (
                          <div role="button" tabIndex={0} className="vg-row" title="Modifier la fiche du salarié" style={{ gap: 0, padding: '3px 8px', margin: '-3px -8px' }}
                            onClick={() => setEditId(r.person.id)} onKeyDown={onKey(r.person.id)}>
                            <span>{r.person.name}</span>
                            {meta}
                          </div>
                        ) : (
                          <>
                            <span style={{ display: 'block' }}>{r.person.name}</span>
                            {meta}
                          </>
                        )}
                      </td>
                      {r.cells.map((c) => {
                        const tip = cellTip(c);
                        return (
                          <td key={c.title.id} style={{ textAlign: 'center' }}>
                            <button type="button" className="btn btn-ghost btn-icon" title={tip} aria-label={`${r.person.name} · ${tip}`} onClick={() => openCell(r.person.id, c.title.id)}
                              style={{ width: 28, height: 28, margin: '-3px 0', borderRadius: '50%', position: 'relative', verticalAlign: 'middle' }}>
                              <SkillDot state={c.state} />
                              {plannedOf(c) && <PlannedMark style={{ position: 'absolute', top: 1, right: 1 }} />}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {canManage && chip !== 'sortis' && others.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
          <span>Non suivis dans la matrice :</span>
          {others.map((p) => (
            <button key={p.id} type="button" className="vg-chip" title="Modifier la fiche du salarié" onClick={() => setEditId(p.id)}>
              {p.name}{p.job && <span style={{ opacity: 0.6 }}>{p.job}</span>}
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!(row && cell)} onClose={closeCell} width={mode === 'plan' ? 560 : mode === 'view' ? 600 : 540} kicker={KICKER[mode]} title={TITLE[mode]}>
        {row && cell && mode === 'view' && (
          <CellView key={`${row.person.id}:${cell.title.id}`} row={row} cell={cell} canManage={canManage} today={today}
            onRecord={() => setMode('record')} onCorrect={() => setMode('correct')} onPlan={() => setMode('plan')}
            onCancelTraining={(id) => { setCancelId(id); setMode('cancel'); }} />
        )}
        {row && cell && mode === 'record' && (
          <TrainingForm rows={rows} titles={titles} today={today} fixed={{ personId: row.person.id, titleId: cell.title.id }} onDone={back} onCancel={back} />
        )}
        {row && cell && mode === 'correct' && initial && (
          <TrainingForm rows={rows} titles={titles} today={today} fixed={{ personId: row.person.id, titleId: cell.title.id }} initial={initial} onDone={back} onCancel={back} />
        )}
        {row && cell && mode === 'cancel' && toCancel && (
          <ReasonForm action={cancelQualification} hidden={{ id: toCancel.id }} onDone={back} onCancel={back}
            submitLabel="Annuler la formation" submitIcon="ph-prohibit" placeholder="Ex. saisie sur le mauvais salarié"
            message={<>La formation du {fmtDate(toCancel.obtainedOn)} sort du calcul de l&apos;état ; elle reste visible, barrée, dans l&apos;historique avec ce motif. Aucune suppression.</>} />
        )}
        {row && cell && mode === 'plan' && (
          <ActionFields options={options} defaults={renewalDefaults(row.person, cell.title, cell.state, cell.renewalDueOn)} onDone={back} onCancel={back} />
        )}
      </Dialog>

      <Dialog open={!!editPerson} onClose={closeEdit} title={editPerson ? `Modifier ${editPerson.name}` : ''} kicker="Personnel" width={540}>
        {editPerson && <PersonForm key={editPerson.id} person={editPerson} sites={options.sites} archivedSites={archivedSites} services={services} defaultSiteId={defaultSiteId} today={today} onDone={closeEdit} onCancel={closeEdit} />}
      </Dialog>
    </>
  );
}
