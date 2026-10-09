'use client';

import { useOptimistic, useState, useTransition, type KeyboardEvent } from 'react';
import { ActionFields } from '@/components/ActionFormDialog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { Icon } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { SKILL_STATES, type SkillState } from '@/lib/domain';
import type { FormOptions } from '@/lib/data/options';
import type { SkillCell, SkillRow, TrainingTitle } from '@/lib/data/skills';
import type { Person } from '@/lib/queries';
import { setRequirement } from '@/server/skills';
import { Fact, PlannedMark, RenewalLink, SkillDot, canPlanRenewal, lcfirst, period, planLabel, plannedLabel, renewalDefaults, renewalNoun, stateDetail, validityLabel } from './common';
import { PersonForm } from './PersonForm';
import { heldState } from './rules';
import { TitlesButton } from './TitlesManager';
import { TrainingForm } from './TrainingForm';

type Opts = Pick<FormOptions, 'people' | 'origins' | 'sites'>;

type Props = {
  titles: TrainingTitle[];
  rows: SkillRow[];
  /** Personnel du site non suivi dans la matrice. */
  others: Person[];
  canManage: boolean;
  options: Opts;
  today: string;
  defaultSiteId: string;
};

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

/** Contenu de la fenêtre d'une case : état, dates, organisme, recyclage, exigence. */
function CellView({ row, cell, canManage, today, onRecord, onPlan }: {
  row: SkillRow; cell: SkillCell; canManage: boolean; today: string; onRecord: () => void; onPlan: () => void;
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

      {canManage && (
        <div className="dialog-actions" style={{ marginTop: 0, flexWrap: 'wrap' }}>
          {canPlanRenewal(cell) && (
            <button type="button" className="btn btn-secondary" onClick={onPlan}><Icon name="ph-calendar-plus" size={14} />{planLabel(cell.state)}</button>
          )}
          <button type="button" className="btn btn-primary" onClick={onRecord}><Icon name="ph-certificate" size={14} />Enregistrer / renouveler</button>
        </div>
      )}
    </div>
  );
}

/** Matrice salariés × titres, légende, barre d'outils et fenêtres associées. */
export function SkillMatrix({ titles, rows, others, canManage, options, today, defaultSiteId }: Props) {
  const [sel, setSel] = useState<{ personId: string; titleId: string } | null>(null);
  const [mode, setMode] = useState<'view' | 'record' | 'plan'>('view');
  const [editId, setEditId] = useState<string | null>(null);

  const row = sel ? rows.find((r) => r.person.id === sel.personId) : undefined;
  const cell = sel ? row?.cells.find((c) => c.title.id === sel.titleId) : undefined;
  const editPerson = editId ? rows.find((r) => r.person.id === editId)?.person ?? others.find((p) => p.id === editId) : undefined;

  const openCell = (personId: string, titleId: string) => { setSel({ personId, titleId }); setMode('view'); };
  const closeCell = () => setSel(null);
  const back = () => setMode('view');
  const closeEdit = () => setEditId(null);
  const onKey = (id: string) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditId(id); }
  };

  const cellName = row && cell ? `${cell.title.label} — ${row.person.name}` : '';
  // Correction d'une formation encore valide (au-delà de 60 jours) sans recyclage à prévoir ;
  // sinon renouvellement daté du jour (formation expirée, proche de l'échéance, ou ne couvrant pas une affectation).
  const initial = cell?.obtainedOn && !cell.renewalDueOn && heldState(cell.expiresOn, today) === 'v'
    ? { obtainedOn: cell.obtainedOn, expiresOn: cell.expiresOn, provider: cell.provider }
    : undefined;

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
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Soon label="Importer le personnel (Lucca · CSV)" icon="ph-upload-simple" tip="Import à venir" />
          <Soon label="Connecteur Cursus · à venir" icon="ph-plugs-connected" tip="Cursus est propriétaire des données personnelles des salariés" />
          <TitlesButton titles={titles} canManage={canManage} />
          {canManage && (
            <DialogButton label="Ajouter un salarié" icon="ph-user-plus" title="Ajouter un salarié" kicker="Personnel" width={540}>
              {(close) => <PersonForm sites={options.sites} defaultSiteId={defaultSiteId} onDone={close} onCancel={close} />}
            </DialogButton>
          )}
          {canManage && (
            <DialogButton label="Enregistrer une formation" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Enregistrer une formation" kicker="Habilitations et formations" width={560}>
              {(close) => <TrainingForm rows={rows} titles={titles} today={today} onDone={close} onCancel={close} />}
            </DialogButton>
          )}
        </span>
      </div>

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
              {rows.length === 0 && (
                <tr><td colSpan={titles.length + 1} style={{ padding: '14px 8px', fontSize: 12, color: 'var(--color-neutral-500)' }}>Aucun salarié suivi dans la matrice pour ce site.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.person.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {canManage ? (
                      <div role="button" tabIndex={0} className="vg-row" title="Modifier la fiche du salarié" style={{ gap: 0, padding: '3px 8px', margin: '-3px -8px' }}
                        onClick={() => setEditId(r.person.id)} onKeyDown={onKey(r.person.id)}>
                        <span>{r.person.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{r.person.job}</span>
                      </div>
                    ) : (
                      <>
                        <span style={{ display: 'block' }}>{r.person.name}</span>
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--color-neutral-500)' }}>{r.person.job}</span>
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
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {canManage && others.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
          <span>Non suivis dans la matrice :</span>
          {others.map((p) => (
            <button key={p.id} type="button" className="vg-chip" title="Modifier la fiche du salarié" onClick={() => setEditId(p.id)}>
              {p.name}{p.job && <span style={{ opacity: 0.6 }}>{p.job}</span>}
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!(row && cell)} onClose={closeCell} width={mode === 'plan' ? 560 : 540}
        kicker={mode === 'view' ? 'Habilitations et formations' : mode === 'record' ? cellName : "Plan d'actions unique"}
        title={mode === 'view' ? cellName : mode === 'record' ? 'Enregistrer une formation' : cell ? planLabel(cell.state) : ''}>
        {row && cell && mode === 'view' && (
          <CellView key={`${row.person.id}:${cell.title.id}`} row={row} cell={cell} canManage={canManage} today={today} onRecord={() => setMode('record')} onPlan={() => setMode('plan')} />
        )}
        {row && cell && mode === 'record' && (
          <TrainingForm rows={rows} titles={titles} today={today} fixed={{ personId: row.person.id, titleId: cell.title.id }} initial={initial} onDone={back} onCancel={back} />
        )}
        {row && cell && mode === 'plan' && (
          <ActionFields options={options} defaults={renewalDefaults(row.person, cell.title, cell.state, cell.renewalDueOn)} onDone={back} onCancel={back} />
        )}
      </Dialog>

      <Dialog open={!!editPerson} onClose={closeEdit} title={editPerson ? `Modifier ${editPerson.name}` : ''} kicker="Personnel" width={540}>
        {editPerson && <PersonForm key={editPerson.id} person={editPerson} sites={options.sites} defaultSiteId={defaultSiteId} onDone={closeEdit} onCancel={closeEdit} />}
      </Dialog>
    </>
  );
}
