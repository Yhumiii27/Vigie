'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { DialogButton, Dialog } from '@/components/Dialog';
import { MissingNotice, ToneTag, hrefWith } from '@/components/ui';
import { muted, rowOpener } from '@/components/watch/parts';
import type { ActionFormOptions } from '@/lib/action-view';
import { fmtDate } from '@/lib/dates';
import type { EcoView, EcrView } from '@/lib/data/engineering';
import { ECO_FLOW, ECO_STATUSES, ECR_STATUSES, ECR_TAB, ENGINEERING_PATH, engineeringKind } from '@/lib/rules/engineering';
import { searchWith } from '@/lib/url-state';
import { EcoDetail, EcoForm, EcrDetail, EcrForm, type EngineeringOptions } from './EngineeringPanels';

// Registre des modifications techniques (D12, lot 5 de M-02) : onglets « Ordres de modification » et « Demandes de
// modification », tableau filtré par état, fiche en fenêtre modale portée par l'URL (?sel=<numéro>, lien profond de Codex
// et de Keystone) ; création réservée au QHSE.

type Props = {
  tab: 'eco' | 'ecr';
  ecos: EcoView[];
  ecrs: EcrView[];
  versions: Record<string, string>;
  today: string;
  qhse: boolean;
  showSite: boolean;
  filter: { part: string | null; project: string | null };
  options: EngineeringOptions | null;
  actionOptions: ActionFormOptions;
  defaultSite: string;
  /** Nouvel ordre prérempli (« Raise ECO » de Keystone) ; null sinon. */
  create: { part: string; project: string; title: string; source: 'vigie' | 'keystone' } | null;
};

type EcoFilter = 'ouverts' | 'approbation' | 'liberes' | 'tous';
type EcrFilter = 'a_decider' | 'acceptees' | 'toutes';
const ECO_FILTERS: [EcoFilter, string][] = [['ouverts', 'Ouverts'], ['approbation', 'En approbation'], ['liberes', 'Libérés'], ['tous', 'Tous']];
const ECR_FILTERS: [EcrFilter, string][] = [['a_decider', 'À décider'], ['acceptees', 'Acceptées'], ['toutes', 'Toutes']];

const ecoMatch = (e: EcoView, f: EcoFilter) =>
  f === 'tous' || (f === 'ouverts' ? e.status !== 'released' && e.status !== 'rejected' : f === 'approbation' ? e.status === 'in_approval' : e.status === 'released');
const ecrMatch = (r: EcrView, f: EcrFilter) => f === 'toutes' || (f === 'a_decider' ? r.status === 'submitted' : r.status === 'accepted');

export function EngineeringRegister({ tab, ecos, ecrs, versions, today, qhse, showSite, filter, options, actionOptions, defaultSite, create }: Props) {
  const asked = useSearchParams().get('sel');
  const open = (id: string | null) => {
    const search = searchWith(window.location.search, { sel: id ?? undefined, nouveau: undefined, article: undefined, projet: undefined, titre: undefined, source: undefined });
    const href = `${window.location.pathname}${search}`;
    if (id) window.history.pushState(null, '', href);
    else window.history.replaceState(null, '', href);
  };
  const [ecoFilter, setEcoFilter] = useState<EcoFilter>('ouverts');
  const [ecrFilter, setEcrFilter] = useState<EcrFilter>('a_decider');
  const [creating, setCreating] = useState(!!create);
  const eco = asked ? ecos.find((e) => e.id === asked) ?? null : null;
  const ecr = asked ? ecrs.find((r) => r.id === asked) ?? null : null;
  const missing = !!asked && !eco && !ecr;
  const params = { part: filter.part ?? undefined, project: filter.project ?? undefined };
  const shownEcos = ecos.filter((e) => ecoMatch(e, ecoFilter));
  const shownEcrs = ecrs.filter((r) => ecrMatch(r, ecrFilter));
  const tabLink = (key: 'eco' | 'ecr', label: string, n: number) => (
    <Link href={hrefWith(ENGINEERING_PATH, params, { onglet: key === 'ecr' ? ECR_TAB : undefined })} scroll={false}
      className={`vg-chip${tab === key ? ' is-on' : ''}`} aria-current={tab === key ? 'page' : undefined}>
      {label}<span style={{ opacity: 0.6 }}>{n}</span>
    </Link>
  );
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <nav aria-label="Onglets" style={{ display: 'flex', gap: 6 }}>
          {tabLink('eco', 'Ordres de modification', ecos.length)}
          {tabLink('ecr', 'Demandes de modification', ecrs.length)}
        </nav>
        {(filter.part || filter.project) && (
          <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
            {filter.part && <ToneTag tone="accent">Article {filter.part}</ToneTag>}
            {filter.project && <ToneTag tone="accent">Projet {filter.project}</ToneTag>}
            <Link href={hrefWith(ENGINEERING_PATH, {}, { onglet: tab === 'ecr' ? ECR_TAB : undefined })} className="vg-link" scroll={false}>Retirer le filtre</Link>
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {qhse && options && tab === 'eco' && (
            <button type="button" className="btn btn-primary vg-btn-sm" onClick={() => setCreating(true)}>
              <i className="ph ph-plus" style={{ fontSize: 13 }} aria-hidden />Nouvel ordre
            </button>
          )}
          {qhse && options && tab === 'ecr' && (
            <DialogButton label="Nouvelle demande" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Nouvelle demande de modification" kicker="Modifications techniques" width={680}>
              {(done) => <EcrForm options={options} defaultSite={defaultSite} onDone={done} onCancel={done} />}
            </DialogButton>
          )}
        </span>
      </div>

      {missing && <MissingNotice text="Modification technique introuvable ou hors du site sélectionné." onClose={() => open(null)} />}

      <div className="card" style={{ padding: '8px 14px 10px', gap: 8 }}>
        <div role="group" aria-label="Filtrer par état" style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {tab === 'eco'
            ? ECO_FILTERS.map(([k, label]) => (
              <button key={k} type="button" className={`vg-chip${ecoFilter === k ? ' is-on' : ''}`} aria-pressed={ecoFilter === k} onClick={() => setEcoFilter(k)}>
                {label}<span style={{ opacity: 0.6 }}>{ecos.filter((e) => ecoMatch(e, k)).length}</span>
              </button>
            ))
            : ECR_FILTERS.map(([k, label]) => (
              <button key={k} type="button" className={`vg-chip${ecrFilter === k ? ' is-on' : ''}`} aria-pressed={ecrFilter === k} onClick={() => setEcrFilter(k)}>
                {label}<span style={{ opacity: 0.6 }}>{ecrs.filter((r) => ecrMatch(r, k)).length}</span>
              </button>
            ))}
        </div>
        <div style={{ overflowX: 'auto' }}>
          {tab === 'eco' ? (
            <table className="table" style={{ fontSize: 12.5, minWidth: 820 }}>
              <thead><tr><th>Ordre</th><th>Intitulé</th><th>Type</th><th>Indices</th><th>Étape</th><th>Approbations</th><th>Effectivité</th></tr></thead>
              <tbody>
                {shownEcos.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--vg-text-muted)', padding: '14px 8px', fontSize: 12 }}>Aucun ordre de modification dans cette vue.</td></tr>}
                {shownEcos.map((e) => (
                  <tr key={e.id} {...rowOpener(() => open(e.id))} data-obsolete={e.cancelled ? true : undefined}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="vg-text-btn" style={{ fontSize: 12.5 }} onClick={() => open(e.id)}>{e.id}</button>
                      {showSite && <div style={{ ...muted, marginTop: 2 }}>{e.siteLabel}</div>}
                    </td>
                    <td style={{ minWidth: 220, textWrap: 'pretty' }}>{e.title}<div style={{ ...muted, marginTop: 2 }}>{e.sourceLabel} · {fmtDate(e.raisedOn)}</div></td>
                    <td style={{ color: 'var(--color-neutral-400)' }}>{e.typeLabel}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{e.fromRevision || '—'} → {e.toRevision || '—'}</td>
                    <td><ToneTag tone={e.tone}>{e.statusLabel}</ToneTag>{e.locked && <div style={{ ...muted, marginTop: 2 }}>Approuvé, dispositions à décider</div>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {e.approvals.map((a) => <span key={a.key} style={{ marginRight: 6 }}><ToneTag tone={a.tone} style={{ fontSize: 11 }}>{a.label.split(' ')[0]} · {a.decisionLabel}</ToneTag></span>)}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {e.targets.length ? `${e.targets.length} cible(s)` : '—'}
                      {e.pendingDispositions > 0 && <div style={{ fontSize: 11.5, color: 'var(--tone-warn-fg)' }}>{e.pendingDispositions} à décider</div>}
                      {e.targets.some((g) => g.late) && <div style={{ fontSize: 11.5, color: 'var(--tone-danger-fg)' }}>Réalisation en retard</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="table" style={{ fontSize: 12.5, minWidth: 820 }}>
              <thead><tr><th>Demande</th><th>Intitulé</th><th>Objet</th><th>Origine</th><th>État</th><th>Ordre</th></tr></thead>
              <tbody>
                {shownEcrs.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--vg-text-muted)', padding: '14px 8px', fontSize: 12 }}>Aucune demande de modification dans cette vue.</td></tr>}
                {shownEcrs.map((r) => (
                  <tr key={r.id} {...rowOpener(() => open(r.id))} data-obsolete={r.cancelled ? true : undefined}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="vg-text-btn" style={{ fontSize: 12.5 }} onClick={() => open(r.id)}>{r.id}</button>
                      {showSite && <div style={{ ...muted, marginTop: 2 }}>{r.siteLabel}</div>}
                    </td>
                    <td style={{ minWidth: 220, textWrap: 'pretty' }}>{r.title}<div style={{ ...muted, marginTop: 2 }}>{r.kindLabel}</div></td>
                    <td style={{ color: 'var(--color-neutral-400)' }}>{r.subjectLabel}<div style={{ ...muted, marginTop: 2 }}>{r.refLabel}</div></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.sourceLabel}<div style={{ ...muted, marginTop: 2 }}>{r.requester} · {fmtDate(r.createdOn)}</div></td>
                    <td>
                      <ToneTag tone={r.tone}>{r.statusLabel}</ToneTag>
                      {r.overdue && <div style={{ fontSize: 11.5, color: 'var(--tone-danger-fg)' }}>Décision attendue depuis le {fmtDate(r.dueOn)}</div>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.ecoId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
        Étapes d’un ordre : {ECO_FLOW.map((s) => ECO_STATUSES[s].label).join(' → ')} (libéré d’office
        quand les trois approbations et les dispositions sont acquises). États d’une demande : {Object.values(ECR_STATUSES).map((s) => s.label).join(', ')}.
      </p>

      <Dialog open={!!eco} onClose={() => open(null)} width={900} title={eco ? `${eco.id} · ${eco.title}` : ''} kicker={eco ? `Ordre de modification · ${eco.typeLabel}` : undefined}>
        {eco && <EcoDetail key={eco.id} e={eco} qhse={qhse} options={options} actionOptions={actionOptions} today={today} version={versions[eco.id]} onClose={() => open(null)} />}
      </Dialog>
      <Dialog open={!!ecr} onClose={() => open(null)} width={760} title={ecr ? `${ecr.id} · ${ecr.title}` : ''} kicker={ecr ? `Demande de modification · ${ecr.sourceLabel}` : undefined}>
        {ecr && <EcrDetail key={ecr.id} r={ecr} qhse={qhse} options={options} version={versions[ecr.id]} onOpen={(id) => open(engineeringKind(id) ? id : null)} onClose={() => open(null)} />}
      </Dialog>
      {qhse && options && (
        <Dialog open={creating} onClose={() => setCreating(false)} width={760} title="Nouvel ordre de modification" kicker={create?.source === 'keystone' ? 'Depuis Keystone' : 'Modifications techniques'}>
          {creating && (
            <EcoForm options={options} defaultSite={defaultSite} prefill={create ?? undefined}
              onDone={() => setCreating(false)} onCancel={() => setCreating(false)} />
          )}
        </Dialog>
      )}
    </>
  );
}
