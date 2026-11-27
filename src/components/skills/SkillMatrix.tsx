'use client';

import { useEffect, useOptimistic, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Dialog } from '@/components/Dialog';
import { Input, Select } from '@/components/form';
import { ReasonButton } from '@/components/ReasonDialog';
import { Icon } from '@/components/ui';
import { fileIcon } from '@/lib/attachments';
import { fmtDate } from '@/lib/dates';
import { legacySkillFilters, parseSkillFilters, parseSkillTitle, searchWith, skillFiltersParams, type SkillFilters, type SkillScope } from '@/lib/url-state';
import { SKILL_FILTERS, SKILL_STATES, type SkillFilter, type SkillState } from '@/lib/domain';
import type { FormOptions, Option } from '@/lib/data/options';
import type { ArchivedRecord, SkillCell, SkillRow, SkillVersions, TrainingTitle } from '@/lib/data/skills';
import type { Person } from '@/lib/queries';
import { reinstatePerson, setRequirement } from '@/server/skills';
import { ArchiveTable, Fact, PlannedMark, RenewalLink, SkillDot, lcfirst, period, plannedLabel, renewalNoun, stateDetail, validityLabel } from './common';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { PersonForm } from './PersonForm';
import { CursusRefreshButton } from './PeoplePanel';
import { lapseFor } from '@/lib/rules/skills';
import { TitlesButton } from './TitlesManager';
import { useI18n } from '@/i18n/client';
import { fill, type T } from '@/i18n/translate';

/** Sites des formulaires du personnel (aucune liste du formulaire d'action : l'écran ne crée pas d'action QSE). */
type Opts = Pick<FormOptions, 'sites'>;

type Props = {
  titles: TrainingTitle[];
  /** QUA-12 : versions des fiches (salarié, titre, formation en cours) à l'ouverture de la page. */
  versions?: SkillVersions;
  /** Titres archivés (liste « Titres suivis », restauration). */
  archivedTitles: TrainingTitle[];
  rows: SkillRow[];
  /** Personnel du site non suivi dans la matrice. */
  others: Person[];
  /** Salariés sortis de l'effectif (filtre « Sortis », encadrement). */
  departed: Person[];
  /** Titres conservés des salariés sortis et des titres qui ne sont plus suivis (consultation seule). */
  archive: ArchivedRecord[];
  /** Sites archivés, pour la fiche d'un salarié qui y est encore rattaché (vue « Tous les sites »). */
  archivedSites: readonly Option[];
  /** Vue Salarié : sa seule ligne, sans filtres ni personnel. */
  self: boolean;
  canManage: boolean;
  /** Titres suivis (communs à tous les sites) : suivre, attributs propres, ne plus suivre — service QHSE et direction (HAB-12). */
  canManageTitles: boolean;
  /** Catalogue de Cursus : titres que Vigie ne suit pas encore (choix « Suivre un titre »), message si indisponible. */
  catalog: { choices: readonly Option[]; message: string | null };
  options: Opts;
  today: string;
  /** Lien profond ?salarie=…&titre=… : case ouverte (titre donné) ou ligne mise en évidence. */
  initialSel?: { personId: string; titleId?: string };
  /** URL rétablie à la fermeture d'une case ouverte par lien profond. */
  closeHref: string;
  /** HAB-16 : libellé du site de rattachement de chaque salarié, sous « Tous les sites » (sinon null : site implicite). */
  siteLabels?: Record<string, string> | null;
};

type Chip = 'tous' | SkillFilter;

const clean = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Filtres de la matrice portés par l'URL (UX-12) : ?etat=a-traiter|sortis, ?service=, ?q= (src/lib/url-state.ts), appliqués
// côté navigateur et écrits par history.replaceState (pas d'entrée d'historique ni d'aller-retour serveur par frappe).
// Ancien filtre mémorisé dans le navigateur (clé vigie.skills.filter) : repris une fois dans l'URL, puis effacé.
const LEGACY_FILTER_KEY = 'vigie.skills.filter';
const CHIP_OF: Record<SkillScope, Chip> = { tous: 'tous', 'a-traiter': 'a_traiter', sortis: 'sortis' };
const SCOPE_OF: Record<Chip, SkillScope> = { tous: 'tous', a_traiter: 'a-traiter', sortis: 'sortis' };
function replaceFilters(patch: Partial<SkillFilters> & { habilitation?: string }) {
  const { habilitation, ...rest } = patch;
  const params = skillFiltersParams({ ...parseSkillFilters(new URLSearchParams(window.location.search)), ...rest });
  const search = searchWith(window.location.search, habilitation === undefined ? params : { ...params, habilitation: habilitation || undefined });
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`);
}

/** HAB-16 : case du titre filtré à afficher pour le salarié (titre requis ou détenu d'après Cursus). */
const followsTitle = (r: SkillRow, titleId: string) => r.cells.some((c) => c.title.id === titleId && (c.required || c.cursusRef != null));

/** Ligne « à traiter » : titre requis à échéance proche, expiré ou jamais suivi, ou manque pendant une affectation. */
const toTreat = (r: SkillRow, today: string) =>
  r.cells.some((c) => c.state === 's' || c.state === 'x' || c.state === 'r' || c.state === 'p' || r.assignments.some((a) => lapseFor(c.state, c.expiresOn, a, today) !== null));

/** Ligne affichée par les filtres de l'URL (vue Matrice) : même règle que la liste `shown` ci-dessous. */
function rowShown(r: SkillRow, f: SkillFilters, today: string, titleId = '') {
  if (f.etat === 'sortis') return false;
  if (f.etat === 'a-traiter' && !toTreat(r, today)) return false;
  if (titleId && !followsTitle(r, titleId)) return false;
  const q = clean(f.q.trim());
  return (!f.service || r.person.service === f.service) && (!q || clean(`${r.person.name} ${r.person.job} ${r.person.service}`).includes(q));
}

const LEGEND: SkillState[] = ['v', 's', 'x', 'r', 'p', 'n'];
const LEGEND_UNAVAILABLE: SkillState[] = ['u', 'n'];
const sub = (text: string) => <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{text}</span>;

/** Recyclage planifié par une action reprise encore à réaliser (ni close ni Terminée). */
const plannedOf = (c: SkillCell) => (c.renewal?.planned ? c.renewal : null);

function cellTip(c: SkillCell, t: T) {
  const s = SKILL_STATES[c.state];
  const r = c.renewal;
  // Action reprise rattachée : « recyclage planifié (A-xxx) », ou son avancement quand elle n'est plus à réaliser (Terminée).
  const action = !r ? '' : r.planned
    ? fill(c.state === 'r' ? t(' · training planned ({id})') : t(' · renewal planned ({id})'), { id: r.id })
    : fill(t(' · {kind} action {id} ({status})'), { kind: renewalNoun(c.state, t), id: r.id, status: lcfirst(r.statusLabel) });
  return `${c.title.label} — ${s.label}${c.expiresOn && c.state !== 'n' ? fill(t(' · expiry {date}'), { date: fmtDate(c.expiresOn) }) : ''}${action}`;
}


/** Attestations jointes dans Vigie avant la bascule vers Cursus (migration 0025) : liens, consultation seule. */
function LegacyFiles({ files }: { files: SkillCell['files'] }) {
  const { t } = useI18n();
  if (!files.length) return null;
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <h6 className="vg-h6">{t('Certificates taken over from Vigie')}</h6>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 12.5 }}>
        {files.map((f) => (
          <a key={f.id} href={f.url} target="_blank" rel="noopener" className="vg-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name={fileIcon(f.mime)} size={14} />{f.name}
          </a>
        ))}
      </span>
      <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{t('Attached before Cursus held the trainings; new certificates are filed in Cursus.')}</span>
    </div>
  );
}

/** Contenu de la fenêtre d'une case : état d'après Cursus, dates, organisme, recyclage repris, exigence, journal. */
function CellView({ row, cell, canManage, today }: { row: SkillRow; cell: SkillCell; canManage: boolean; today: string }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [required, setRequired] = useOptimistic(cell.required);
  const [error, setError] = useState<string | null>(null);
  const s = SKILL_STATES[cell.state];
  const next = row.assignments[0];
  // Une action de recyclage reprise non close est rattachée à l'exigence : on ne peut pas la retirer (le service QHSE la
  // clôt ou l'abandonne d'abord dans le plan d'actions).
  const locked = required && !!cell.renewal;
  const toggle = () => start(async () => {
    setRequired(!required);
    const r = await setRequirement(row.person.id, cell.title.id, !required);
    setError(r.error ?? null);
  });
  const requiredHint = !canManage
    ? t('Change reserved for management and QHSE coordination.')
    : locked
      ? fill(t('Removing the requirement means the QHSE department first closes or abandons the action {id}.'), { id: cell.renewal!.id })
      : required
        ? t('The title is followed for this employee (alerts and deadlines).')
        : t('The title is not required for this employee.');
  const switchOff = !canManage || locked;
  const held = cell.cursusRef !== null;
  const suspension = cell.measure
    ? `${cell.measure.kind === 'retrait' ? t('Withdrawal') : t('Suspension')}${cell.measure.on ? fill(t(' on {date}'), { date: fmtDate(cell.measure.on) }) : ''}${t(' (reason held by Cursus)')}`
    : cell.prerequisiteMissing ? t('Prerequisite missing in Cursus (CACES or required training): title unusable.') : null;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="vg-inset" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
        <SkillDot state={cell.state} size={28} />
        <div style={{ display: 'grid', gap: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 500 }}>{s.label}</span>
          <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{stateDetail(cell, today, t)}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px 16px' }}>
        <Fact label={t('Employee')}>{row.person.name}{sub(row.person.job)}</Fact>
        <Fact label={t('Title#qualification')}>{cell.title.label}{sub(validityLabel(cell.title, t))}</Fact>
        <Fact label={t('Obtained on')}>{cell.obtainedOn ? fmtDate(cell.obtainedOn) : '—'}</Fact>
        <Fact label={t('Expiry')}>{cell.titleExpiresOn ? fmtDate(cell.titleExpiresOn) : held ? t('No expiry') : '—'}</Fact>
        <Fact label={t('Provider or signatory')}>{cell.provider ?? '—'}</Fact>
        {cell.sessionOn && <Fact label={t('Session planned (Cursus)')}>{fmtDate(cell.sessionOn)}</Fact>}
        {suspension && (
          <Fact label={t('Title suspended')} wide><span style={{ color: 'var(--tone-danger-fg)' }}>{suspension}</span></Fact>
        )}
        <Fact label={t('Next Keystone assignment')}>
          {next ? <>{next.project}{sub(`${next.activity} · ${period(next.startOn, next.endOn)}`)}</> : '—'}
        </Fact>
        {cell.renewal && (
          <Fact label={cell.renewal.planned ? plannedLabel(cell.state, t) : fill(t('{kind} action'), { kind: renewalNoun(cell.state, t) })} wide>
            <RenewalLink renewal={cell.renewal} />
          </Fact>
        )}
        {cell.pastRenewals.length > 0 && (
          // HAB-04 : les anciens recyclages repris gardent leur lien vers la case.
          <Fact label={t('Previous renewal actions')} wide>
            <span style={{ display: 'grid', gap: 4 }}>
              {cell.pastRenewals.map((r) => <RenewalLink key={r.id} renewal={r} showDue={false} />)}
            </span>
          </Fact>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <button type="button" role="switch" aria-checked={required} aria-label={t('Required for this employee')} className={`vg-switch${required ? ' is-on' : ''}`}
          disabled={switchOff || pending} onClick={toggle} style={{ padding: 0, cursor: switchOff ? 'not-allowed' : 'pointer', opacity: switchOff ? 0.6 : 1 }}>
          <span />
        </button>
        <div style={{ display: 'grid', gap: 1 }}>
          <span style={{ fontSize: 12.5 }}>{t('Required for this employee')}</span>
          <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>{requiredHint}</span>
        </div>
      </div>
      {error && <div role="alert" className="vg-form-error">{error}</div>}

      <LegacyFiles files={cell.files} />
      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
        {t('Trainings, qualifications, sessions and certificates are entered in Cursus (HR); Vigie views them.')}
      </p>
      {/* Journal de la case (HAB-03) : exigence et formations saisies avant la bascule — à la saisie seulement. */}
      {canManage && <LazyChangeLog entity="skill_cell" id={`${row.person.id}|${cell.title.id}`} title={t('Change history')} />}
    </div>
  );
}

/** Titres conservés d'un salarié sorti, titre par titre (consultation seule). */
function DepartedHistory({ records }: { records: ArchivedRecord[] }) {
  const { t } = useI18n();
  if (records.length === 0) return <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{t('No title held according to Cursus.')}</div>;
  return <ArchiveTable records={records} first="title" />;
}

/** Salariés sortis de l'effectif (filtre « Sortis ») : date, motif, titres conservés et réintégration. */
function DepartedList({ people, archive }: { people: Person[]; archive: ArchivedRecord[] }) {
  const { t } = useI18n();
  const [viewed, setViewed] = useState<Person | null>(null);
  const recordsOf = (id: string) => archive.filter((r) => r.person.id === id);
  return (
    <div className="card" style={{ padding: '6px 14px 10px' }}>
      <table className="table" style={{ fontSize: 12.5 }}>
        <tbody>
          {people.length === 0 && (
            <tr><td style={{ padding: '14px 8px', fontSize: 12, color: 'var(--color-neutral-500)' }}>{t('No employee matches the filters.')}</td></tr>
          )}
          {people.map((p) => (
            <tr key={p.id}>
              <td>
                <span style={{ display: 'block' }}>{p.name}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--color-neutral-500)' }}>{[p.job, p.service].filter(Boolean).join(' · ')}</span>
              </td>
              <td style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{fill(t('Left on {date}#male'), { date: fmtDate(p.leftOn!) })}{p.leftReason ? ` · ${p.leftReason}` : ''}</td>
              <td style={{ textAlign: 'right', width: 1, whiteSpace: 'nowrap' }}>
                <span style={{ display: 'inline-flex', gap: 10 }}>
                  <button type="button" className="vg-text-btn" onClick={() => setViewed(p)}>{fill(t('Titles ({n})'), { n: recordsOf(p.id).length })}</button>
                  <ReasonButton action={reinstatePerson} hidden={{ id: p.id }} label={t('Reinstate')} className="vg-text-btn" title={t('Reinstate the employee')}
                    kicker={p.name} submitLabel={t('Reinstate')} message={t('The employee comes back in the matrix, the deadlines and the lists; the reinstatement is written to their history.')}
                    placeholder={t('E.g. return after the end of an assignment')} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog open={!!viewed} onClose={() => setViewed(null)} width={600} kicker={t('Employee who left · view only')} title={viewed ? fill(t('Titles of {name}'), { name: viewed.name }) : ''}>
        {viewed && <DepartedHistory records={recordsOf(viewed.id)} />}
      </Dialog>
    </div>
  );
}

/** Matrice salariés × titres, légende, filtres, barre d'outils et fenêtres associées. */
export function SkillMatrix({ titles, versions, archivedTitles, rows, others, departed, archive, archivedSites, self, canManage, canManageTitles, catalog, options, today, initialSel, closeHref, siteLabels = null }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [sel, setSel] = useState<{ personId: string; titleId: string } | null>(initialSel?.titleId ? { personId: initialSel.personId, titleId: initialSel.titleId } : null);
  const [editId, setEditId] = useState<string | null>(null);
  // Lien profond en cours : l'URL est rétablie à la fermeture de la case ; sans titre, la ligne est mise en évidence.
  const [linked, setLinked] = useState(!!initialSel);
  const [highlight, setHighlight] = useState(initialSel && !initialSel.titleId ? initialSel.personId : null);
  const searchParams = useSearchParams();
  const filters = parseSkillFilters(searchParams);
  // HAB-16 : filtre par titre suivi (?habilitation=), une seule colonne ; sans objet pour la vue Salarié.
  const urlTitle = self ? '' : parseSkillTitle(searchParams, titles.map((x) => x.id));
  // Lien profond : la ligne visée est-elle cachée par les filtres de l'URL (HAB-17) ? Seulement alors ils sont remis à zéro.
  const linkTarget = initialSel ? rows.find((r) => r.person.id === initialSel.personId) : undefined;
  const linkHidden = !!linkTarget && !rowShown(linkTarget, filters, today, urlTitle);
  // Choix local recopié dans l'URL (comme la recherche) : l'URL écrite par history.replaceState n'est relue qu'au chargement.
  const [titleChoice, setTitleChoice] = useState(linkHidden ? '' : urlTitle);
  const titleFilter = self || !titles.some((x) => x.id === titleChoice) ? '' : titleChoice;
  // Recherche : saisie locale (pas de rendu à chaque frappe depuis l'URL), recopiée dans l'URL.
  const [query, setQueryState] = useState(linkHidden ? '' : filters.q);
  const setQuery = (q: string) => { setQueryState(q); replaceFilters({ q: q.trim() }); };
  // Vue Salarié : pas de filtres ; « Sortis » réservé à l'encadrement.
  const chip: Chip = self || (filters.etat === 'sortis' && !canManage) ? 'tous' : CHIP_OF[filters.etat];
  // Reprise unique de l'ancien filtre mémorisé (sans filtre dans l'URL ni lien profond).
  useEffect(() => {
    let raw: string | null = null;
    try { raw = localStorage.getItem(LEGACY_FILTER_KEY); localStorage.removeItem(LEGACY_FILTER_KEY); } catch { /* stockage indisponible */ }
    const legacy = legacySkillFilters(raw);
    const params = new URLSearchParams(window.location.search);
    if (legacy && !self && !params.has('etat') && !params.has('service') && !params.has('q') && !params.has('salarie')) replaceFilters(legacy);
  }, [self]);

  // Nouveau lien profond pendant que l'écran est ouvert (notification, « À faire ») : on ouvre la case visée.
  const linkKey = initialSel ? `${initialSel.personId}:${initialSel.titleId ?? ''}` : '';
  const [seenLink, setSeenLink] = useState(linkKey);
  if (linkKey !== seenLink) {
    setSeenLink(linkKey);
    if (initialSel) {
      setLinked(true);
      setSel(initialSel.titleId ? { personId: initialSel.personId, titleId: initialSel.titleId } : null);
      setHighlight(initialSel.titleId ? null : initialSel.personId);
      if (linkHidden) { setQueryState(''); setTitleChoice(''); }
    }
  }
  // Un lien profond ne touche aux filtres de l'URL que s'ils cachent la ligne visée (HAB-17) : ils sont alors remis à zéro ;
  // sinon les filtres choisis sont gardés.
  useEffect(() => {
    if (linkHidden) replaceFilters({ etat: 'tous', service: '', q: '', habilitation: '' });
  }, [linkKey, linkHidden]);
  const hlRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => { if (highlight) hlRef.current?.scrollIntoView({ block: 'center' }); }, [highlight]);

  const row = sel ? rows.find((r) => r.person.id === sel.personId) : undefined;
  const cell = sel ? row?.cells.find((c) => c.title.id === sel.titleId) : undefined;
  const editPerson = editId ? rows.find((r) => r.person.id === editId)?.person ?? others.find((p) => p.id === editId) : undefined;

  const openCell = (personId: string, titleId: string) => setSel({ personId, titleId });
  const closeCell = () => {
    setSel(null);
    if (linked) { setLinked(false); router.replace(closeHref, { scroll: false }); }
  };
  const closeEdit = () => setEditId(null);
  const onKey = (id: string) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditId(id); }
  };

  // Filtres (côté client) : recherche nom / poste / service, service, « À traiter », « Sortis ».
  const services = [...new Set([...rows.map((r) => r.person.service), ...others.map((p) => p.service), ...departed.map((p) => p.service)].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'fr'));
  const service = !self && services.includes(filters.service) ? filters.service : '';
  const q = clean(query.trim());
  const matches = (p: Person) => (!service || p.service === service) && (!q || clean(`${p.name} ${p.job} ${p.service}`).includes(q));
  const treat = rows.filter((r) => toTreat(r, today) && (!titleFilter || followsTitle(r, titleFilter)));
  const shown = (chip === 'a_traiter' ? treat : rows).filter((r) => matches(r.person) && (!titleFilter || followsTitle(r, titleFilter)));
  const shownTitles = titleFilter ? titles.filter((x) => x.id === titleFilter) : titles;
  const setTitleFilter = (v: string) => { setTitleChoice(v); replaceFilters({ habilitation: v }); };
  const shownDeparted = departed.filter(matches);
  const setChip = (c: Chip) => replaceFilters({ etat: SCOPE_OF[c] });
  const setService = (v: string) => replaceFilters({ service: v });
  const chipCount: Record<Chip, number | null> = { tous: null, a_traiter: treat.length, sortis: departed.length };
  const chips: { key: Chip; label: string }[] = [{ key: 'tous', label: t('All#mplural') }, ...SKILL_FILTERS.filter((f) => f.key !== 'sortis' || canManage)];

  const cellName = row && cell ? `${cell.title.label} — ${row.person.name}` : '';
  const unavailable = rows.some((r) => r.cells.some((c) => c.state === 'u'));

  return (
    <>
      {/* Légende à gauche, boutons poussés à droite sur la même ligne (cf. maquette). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--color-neutral-400)' }}>
        {(unavailable ? LEGEND_UNAVAILABLE : LEGEND).map((k) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <SkillDot state={k} size={18} />{SKILL_STATES[k].label}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 18, display: 'inline-grid', placeItems: 'center' }}><PlannedMark /></span>{t('Training or renewal planned')}
        </span>
        {!self && (
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {/* D01 (décision CV-10) : personnes lues dans Cursus, plus de création ni d'import dans Vigie (IMP-02 caduc). */}
            {canManageTitles && <CursusRefreshButton />}
            <TitlesButton titles={titles} archivedTitles={archivedTitles} archive={archive} canManage={canManageTitles} versions={versions?.title} catalog={catalog} />
          </span>
        )}
      </div>

      {!self && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
            <Input name="skills-search" type="search" placeholder={t('Search an employee, a job, a department…')} aria-label={t('Search an employee')}
              value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {services.length > 0 && (
            <div style={{ flex: '0 1 200px' }}>
              <Select name="skills-service" aria-label={t('Department#service')} options={services.map((x) => [x, x] as const)} placeholder={t('All departments')}
                value={service} onChange={(e) => setService(e.target.value)} />
            </div>
          )}
          {titles.length > 1 && (
            <div style={{ flex: '0 1 220px' }}>
              <Select name="skills-title" aria-label={t('Title followed')} options={titles.map((x) => [x.id, x.label] as const)} placeholder={t('All titles')}
                value={titleFilter} onChange={(e) => setTitleFilter(e.target.value)} />
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
            {/* HAB-16 : colonne « Salarié » figée au défilement horizontal (vg-sticky-col). */}
            <table className="table vg-sticky-table" style={{ fontSize: 12.5, minWidth: titleFilter ? undefined : 880 }}>
              <thead>
                <tr>
                  <th className="vg-sticky-col">{t('Employee')}</th>
                  {shownTitles.map((ti) => <th key={ti.id} style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{ti.label}<span className="vg-sr-only"> · {validityLabel(ti, t)}</span></th>)}
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={shownTitles.length + 1} style={{ padding: '14px 8px', fontSize: 12, color: 'var(--color-neutral-500)' }}>
                      {rows.length === 0 ? t('No employee followed in the matrix for this site.') : t('No employee matches the filters.')}
                    </td>
                  </tr>
                )}
                {shown.map((r) => {
                  const hl = highlight === r.person.id;
                  const meta = (
                    <>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--color-neutral-500)' }}>{r.person.job}</span>
                      {r.person.service && <span style={{ display: 'block', fontSize: 11, color: 'var(--vg-text-muted)' }}>{r.person.service}</span>}
                      {siteLabels && r.person.siteId && siteLabels[r.person.siteId] && (
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--vg-text-muted)' }}>
                          <i className="ph ph-factory" style={{ fontSize: 11, marginRight: 3 }} aria-hidden /><span className="vg-sr-only">{t('Site: ')}</span>{siteLabels[r.person.siteId]}
                        </span>
                      )}
                      {r.leavingOn && <span style={{ display: 'block', fontSize: 11, color: 'var(--tone-warn-fg)' }}>{fill(t('Departure on {date}'), { date: fmtDate(r.leavingOn) })}</span>}
                    </>
                  );
                  return (
                    <tr key={r.person.id} ref={hl ? hlRef : undefined}
                      style={hl ? { background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)', outline: '1px solid var(--color-accent)', outlineOffset: -1 } : undefined}>
                      <td className="vg-sticky-col" style={{ whiteSpace: 'nowrap' }}>
                        {canManage ? (
                          <div role="button" tabIndex={0} className="vg-row" title={t('Edit the employee record')} style={{ gap: 0, padding: '3px 8px', margin: '-3px -8px' }}
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
                      {r.cells.filter((c) => !titleFilter || c.title.id === titleFilter).map((c) => {
                        const tip = cellTip(c, t);
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
          <span>{t('Not followed in the matrix:')}</span>
          {others.map((p) => (
            <button key={p.id} type="button" className="vg-chip" title={t('Edit the employee record')} onClick={() => setEditId(p.id)}>
              {p.name}{p.job && <span style={{ opacity: 0.6 }}>{p.job}</span>}
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!(row && cell)} onClose={closeCell} width={600} kicker={t('Qualifications and training')} title={cellName}>
        {row && cell && <CellView key={`${row.person.id}:${cell.title.id}`} row={row} cell={cell} canManage={canManage} today={today} />}
      </Dialog>

      <Dialog open={!!editPerson} onClose={closeEdit} title={editPerson ? fill(t('Edit {name}'), { name: editPerson.name }) : ''} kicker={t('Staff')} width={540}>
        {editPerson && <PersonForm key={editPerson.id} person={editPerson} version={versions?.person[editPerson.id]} sites={options.sites} archivedSites={archivedSites} services={services} today={today} onDone={closeEdit} onCancel={closeEdit} />}
      </Dialog>
    </>
  );
}
