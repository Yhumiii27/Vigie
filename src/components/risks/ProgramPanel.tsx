'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChangeLogList } from '@/components/ChangeLog';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { ReasonButton } from '@/components/ReasonDialog';
import { SegLinks, ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { PROGRAM_SHORT, PROGRAM_STATES, RISK_LEVELS, TONE, riskLevel } from '@/lib/domain';
import type { PreventionProgramData, ProgramLineView } from '@/lib/data/risks';
import {
  addProgramAction, createPreventionProgram, freezePreventionProgram, removeProgramAction, reopenPreventionProgram,
  saveProgramAction, updatePreventionProgram,
} from '@/server/risks';
import { fmtEuro } from './format';

const muted = { fontSize: 11.5, color: 'var(--color-neutral-500)' } as const;
const lineTone = (l: ProgramLineView) => (l.cancelled ? 'var(--color-neutral-500)' : TONE[l.tone].fg);

const costText = (n: number | null | undefined) => (n != null ? String(n).replace('.', ',') : '');

/**
 * Champs d'une ligne du programme : coût estimé, ressources, indicateur (optionnels). `cost` / `onCost` : coût contrôlé
 * (ligne ajoutée : proposé depuis l'action choisie) ; `costHint` remplace l'aide du coût.
 */
function LineFields({ line, cost, onCost, costHint }: { line?: ProgramLineView; cost?: string; onCost?: (v: string) => void; costHint?: string }) {
  return (
    <>
      <FormRow>
        <Field name="estimatedCost" label="Coût estimé (€ HT)" hint={costHint ?? 'Optionnel ; centimes admis (1250,50).'}>
          {onCost
            ? <Input name="estimatedCost" inputMode="decimal" value={cost ?? ''} onChange={(e) => onCost(e.target.value)} />
            : <Input name="estimatedCost" inputMode="decimal" defaultValue={costText(line?.estimatedCost)} />}
        </Field>
        <Field name="indicator" label="Indicateur de résultat">
          <Input name="indicator" maxLength={300} defaultValue={line?.indicator ?? ''} placeholder="Ex. 100 % des monteurs habilités" />
        </Field>
      </FormRow>
      <Field name="resources" label="Ressources" hint="Moyens humains, prestataires, budget, délais.">
        <TextArea name="resources" rows={2} maxLength={500} defaultValue={line?.resources ?? ''} />
      </Field>
    </>
  );
}

/**
 * Ajout d'une ligne (DUE-02, spec § 11) : le choix de l'action propose son coût estimé (saisi dans le plan d'actions,
 * modifiable ici) ; le coût de la ligne reste ensuite figé avec le programme à l'arrêt.
 */
function AddLineFields({ candidates, costs }: { candidates: PreventionProgramData['candidates']; costs: PreventionProgramData['candidateCosts'] }) {
  const [picked, setPicked] = useState('');
  const [cost, setCost] = useState('');
  const proposed = picked && Object.hasOwn(costs, picked) ? costs[picked] : null;
  return (
    <>
      <Field name="actionId" label="Action du plan" hint="Actions rattachées à un risque du DUERP en vigueur, non closes ou vérifiées dans l'année.">
        <Select name="actionId" options={candidates} placeholder="Choisir…" value={picked}
          onChange={(e) => { const id = e.target.value; setPicked(id); setCost(costText(Object.hasOwn(costs, id) ? costs[id] : null)); }} />
      </Field>
      <LineFields cost={cost} onCost={setCost}
        costHint={proposed != null ? `Proposé : coût estimé de l'action (TTC), ${fmtEuro(proposed)} ; modifiable.` : undefined} />
    </>
  );
}

/**
 * Programme annuel de prévention des risques professionnels et d'amélioration des conditions de travail (PAPRIPACT,
 * L. 4121-3-1, DUE-02) : actions du plan rattachées aux risques du DUERP, avec coût estimé, ressources et indicateur.
 * Consultable par tous les rôles ; préparation, arrêt après consultation du CSE et réouverture motivée réservés à
 * l'animateur QHSE et à la direction.
 */
export function ProgramPanel({ data, yearLinks, canApprove, showPilot, showHistory }: {
  data: PreventionProgramData;
  /** Années proposées (lien vers ?programme=<année>). */
  yearLinks: { year: number; href: string }[];
  canApprove: boolean;
  /** Pilotes des actions (masqués pour le Salarié). */
  showPilot: boolean;
  /** Historique du programme (rôles qui modifient le DUERP). */
  showHistory: boolean;
}) {
  const { year, program, lines, totals, hiddenCount, candidates, candidateCosts } = data;
  const draft = program?.state === 'draft';
  const frozen = program?.state === 'frozen';
  const editLines = canApprove && draft;
  const printHref = `/risques/imprimer/programme?annee=${year}`;
  const cols = 7 + (showPilot ? 1 : 0) + (editLines ? 1 : 0);
  const multiSite = new Set(lines.map((l) => l.siteId)).size > 1;
  const meta = program && [
    `DUERP ${program.duerpVersion}`,
    program.cseConsultedOn ? `CSE consulté le ${fmtDate(program.cseConsultedOn)}` : null,
    program.frozenOn ? `arrêté le ${fmtDate(program.frozenOn)}${program.frozenBy ? ` par ${program.frozenBy}` : ''}` : null,
    program.createdBy && !frozen ? `préparé par ${program.createdBy}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
      <div className="card" style={{ gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 2 }}>
            <div className="card-kicker">Programme annuel de prévention · L. 4121-3-1</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="card-title" style={{ fontSize: 15 }}>{PROGRAM_SHORT} {year}</span>
              {program
                ? <ToneTag tone={PROGRAM_STATES[program.state].tone}>{PROGRAM_STATES[program.state].label}</ToneTag>
                : <ToneTag tone="neutral">Non établi</ToneTag>}
            </div>
          </div>
          {yearLinks.length > 1 && (
            <SegLinks size={11.5} pad="3px 9px" options={yearLinks.map((y) => ({ href: y.href, label: String(y.year), on: y.year === year }))} />
          )}
        </div>

        {program ? (
          <>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>
              {meta}
              {!program.cseConsultedOn && <span style={{ color: TONE.warn.fg }}> · consultation du CSE à renseigner</span>}
            </div>
            {program.comment && <div style={{ fontSize: 12.5, textWrap: 'pretty' }}>{program.comment}</div>}
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              {[
                { v: String(totals.count), k: totals.count > 1 ? 'actions' : 'action' },
                { v: String(totals.done), k: totals.done > 1 ? 'vérifiées' : 'vérifiée' },
                { v: fmtEuro(totals.cost), k: 'coût estimé (HT)' },
              ].map((k) => (
                <div key={k.k} style={{ display: 'grid', gap: 1 }}>
                  <span style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-.02em' }}>{k.v}</span>
                  <span style={muted}>{k.k}</span>
                </div>
              ))}
              {totals.count > totals.costed && (
                <div style={{ display: 'grid', gap: 1 }}>
                  <span style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-.02em', color: TONE.warn.fg }}>{totals.count - totals.costed}</span>
                  <span style={muted}>sans coût</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', fontSize: 12.5, textWrap: 'pretty', margin: 0 }}>
            Aucun programme établi pour {year}. Le programme reprend les actions du plan d&apos;actions rattachées aux risques du DUERP,
            avec leur coût estimé, les ressources et un indicateur, puis il est arrêté après la consultation du CSE.
          </p>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {editLines && (
            <>
              <DialogButton label="Ajouter une action" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Ajouter une action" kicker={`${PROGRAM_SHORT} ${year}`} width={600}
                disabled={!candidates.length} tooltip={candidates.length ? undefined : 'Aucune autre action rattachée à un risque du DUERP en vigueur.'}>
                {(close) => (
                  <ActionForm action={addProgramAction} hidden={{ year }} onDone={close} onCancel={close} submitLabel="Ajouter au programme">
                    <AddLineFields candidates={candidates} costs={candidateCosts} />
                  </ActionForm>
                )}
              </DialogButton>
              <DialogButton label="Arrêter le programme" icon="ph-seal-check" className="btn btn-secondary vg-btn-sm" title={`Arrêter le programme ${year}`} kicker="Après consultation du CSE" width={520}
                disabled={!lines.length && !hiddenCount} tooltip={lines.length || hiddenCount ? undefined : 'Programme vide : ajoutez au moins une action.'}>
                {(close) => (
                  <ActionForm action={freezePreventionProgram} hidden={{ year }} onDone={close} onCancel={close} submitLabel="Arrêter le programme" submitIcon="ph-seal-check">
                    <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
                      Les lignes du programme (tous sites) seront figées à la date de la consultation ; il ne sera plus modifiable, sauf réouverture motivée.
                    </p>
                    <Field name="cseConsultedOn" label="Consultation du CSE" hint="Date de la réunion où le CSE a été consulté.">
                      <Input name="cseConsultedOn" type="date" />
                    </Field>
                  </ActionForm>
                )}
              </DialogButton>
              <DialogButton label="Modifier l'objet" icon="ph-pencil-simple" className="btn btn-ghost vg-btn-sm" title={`Programme ${year}`} kicker="Objet du programme" width={520}>
                {(close) => (
                  <ActionForm action={updatePreventionProgram} hidden={{ year }} onDone={close} onCancel={close}>
                    <Field name="comment" label="Objet">
                      <TextArea name="comment" rows={3} maxLength={1000} defaultValue={program?.comment ?? ''} />
                    </Field>
                  </ActionForm>
                )}
              </DialogButton>
            </>
          )}
          {canApprove && frozen && (
            <ReasonButton label="Rouvrir" icon="ph-lock-open" title={`Rouvrir le programme ${year}`} kicker="Programme arrêté"
              action={reopenPreventionProgram} hidden={{ year }} submitLabel="Rouvrir le programme" submitIcon="ph-lock-open"
              placeholder="Ex. action ajoutée à la demande du CSE, erreur de chiffrage…"
              message="L'instantané et la date de consultation du CSE sont effacés : le programme repasse en préparation et devra être de nouveau arrêté après consultation." />
          )}
          {data.creatable && (
            <DialogButton label={`Créer le programme ${year}`} icon="ph-plus" className="btn btn-primary vg-btn-sm" title={`Programme ${year}`} kicker={`${PROGRAM_SHORT} · DUERP ${data.currentVersion}`} width={560}>
              {(close) => (
                <ActionForm action={createPreventionProgram} hidden={{ year }} onDone={close} onCancel={close} submitLabel="Créer le programme">
                  <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
                    {data.prefillCount
                      ? `${data.prefillCount} action${data.prefillCount > 1 ? 's' : ''} du plan rattachée${data.prefillCount > 1 ? 's' : ''} aux risques du DUERP ${data.currentVersion} (échéance en ${year} ou report d'une année antérieure) ${data.prefillCount > 1 ? 'seront reprises' : 'sera reprise'}, tous sites.`
                      : `Aucune action rattachée aux risques du DUERP ${data.currentVersion} n'est à reprendre : le programme sera créé vide.`}
                  </p>
                  <Field name="comment" label="Objet" hint="Optionnel : priorités de l'année, mise à jour du DUERP d'origine…">
                    <TextArea name="comment" rows={3} maxLength={1000} />
                  </Field>
                </ActionForm>
              )}
            </DialogButton>
          )}
          {canApprove && !program && !data.creatable && !data.currentVersion && (
            <span style={{ fontSize: 12, color: TONE.warn.fg }}>Aucune version du DUERP en vigueur : ouvrez d&apos;abord une version.</span>
          )}
          {program && (
            <a href={printHref} target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm" style={{ marginLeft: 'auto' }}>
              <i className="ph ph-printer" style={{ fontSize: 13 }} />Imprimer
            </a>
          )}
        </div>
      </div>

      {program && (
        <div className="card" style={{ padding: '6px 14px 10px', gap: 8 }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: 12.5, minWidth: 900 }}>
              <thead>
                <tr>
                  <th>Action</th><th>Risques</th><th>Date cible</th><th>Avancement</th>{showPilot && <th>Responsable</th>}
                  <th style={{ textAlign: 'right' }}>Coût</th><th>Ressources</th><th>Indicateur</th>{editLines && <th />}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.actionId} style={l.cancelled ? { opacity: 0.6 } : undefined}>
                    <td style={{ verticalAlign: 'top', minWidth: 200 }}>
                      <Link href={`/actions?action=${encodeURIComponent(l.actionId)}`} className="vg-link"
                        style={{ fontSize: 12.5, color: lineTone(l), textDecoration: l.cancelled ? 'line-through' : undefined }}>{l.actionId}</Link>
                      <div style={{ textWrap: 'pretty' }}>{l.title}</div>
                      {multiSite && <div style={muted}>{l.site}</div>}
                    </td>
                    <td style={{ verticalAlign: 'top', minWidth: 160 }}>
                      {l.risks.length ? l.risks.map((r, i) => (
                        <div key={`${r.id ?? i}`} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                          <span className="vg-dot" style={{ width: 7, height: 7, flex: 'none', background: RISK_LEVELS[riskLevel(r.cotation)].dot }} />
                          {r.id != null
                            ? <Link href={`/risques?risque=${r.id}`} className="vg-link" style={{ fontSize: 12 }}>{r.label}</Link>
                            : <span style={{ fontSize: 12 }}>{r.label}</span>}
                          <span style={muted}>{r.cotation}</span>
                        </div>
                      )) : <span style={muted}>Plus rattachée à un risque en vigueur</span>}
                    </td>
                    <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>{l.dueOn ? fmtDate(l.dueOn) : '—'}</td>
                    <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      <span style={{ color: lineTone(l) }}>{l.status}</span>
                      {l.frozenStatus != null && l.frozenStatus !== l.status && <div style={muted}>à l&apos;arrêt : {l.frozenStatus}</div>}
                    </td>
                    {showPilot && <td style={{ verticalAlign: 'top', color: 'var(--color-neutral-300)' }}>{l.pilot || '—'}</td>}
                    <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap', textAlign: 'right' }}>{l.estimatedCost != null ? fmtEuro(l.estimatedCost) : <span style={{ color: 'var(--color-neutral-600)' }}>—</span>}</td>
                    <td style={{ verticalAlign: 'top', color: 'var(--color-neutral-300)', maxWidth: 220, textWrap: 'pretty' }}>{l.resources || '—'}</td>
                    <td style={{ verticalAlign: 'top', color: 'var(--color-neutral-300)', maxWidth: 220, textWrap: 'pretty' }}>{l.indicator || '—'}</td>
                    {editLines && (
                      <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', gap: 10 }}>
                          <DialogButton label="Modifier" className="vg-text-btn" title={`${l.actionId} · ${l.title}`} kicker={`${PROGRAM_SHORT} ${year}`} width={600}>
                            {(close) => (
                              <ActionForm action={saveProgramAction} hidden={{ year, actionId: l.actionId }} onDone={close} onCancel={close}>
                                <LineFields line={l} />
                              </ActionForm>
                            )}
                          </DialogButton>
                          <DialogButton label="Retirer" className="vg-text-btn" title={`${l.actionId} · ${l.title}`} kicker={`Retirer du ${PROGRAM_SHORT} ${year}`} width={480}>
                            {(close) => (
                              <ActionForm action={removeProgramAction} hidden={{ year, actionId: l.actionId }} onDone={close} onCancel={close} submitLabel="Retirer du programme">
                                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
                                  L&apos;action reste au plan d&apos;actions ; son coût, ses ressources et son indicateur sont retirés du programme en préparation (retrait noté dans l&apos;historique).
                                </p>
                              </ActionForm>
                            )}
                          </DialogButton>
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
                {!lines.length && (
                  <tr><td colSpan={cols} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>
                    {hiddenCount ? 'Aucune action du programme sur ce site.' : `Aucune action au programme${editLines ? ' : utilisez « Ajouter une action ».' : '.'}`}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {hiddenCount > 0 && (
            <div style={muted}>
              {hiddenCount} action{hiddenCount > 1 ? 's' : ''} du programme sur d&apos;autres sites {hiddenCount > 1 ? 'ne sont pas affichées' : "n'est pas affichée"} (site sélectionné) ; le programme est commun à tous les sites.
            </div>
          )}
        </div>
      )}

      {showHistory && program && <ChangeLogList entries={data.history} />}
    </div>
  );
}
