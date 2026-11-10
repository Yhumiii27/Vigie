'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Dialog, DialogButton } from '@/components/Dialog';
import { EntityFiles } from '@/components/EntityFiles';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import { LEFT_SUFFIX, withCurrent, type Option } from '@/lib/form-options';
import type { DuerpVersionDetail, DuerpVersionView, RiskRecord } from '@/lib/data/risks';
import { addDuerpVersionComment, createDuerpVersion, updateCurrentDuerpVersion } from '@/server/risks';
import { DUERP_COMMENT_MAX } from '@/lib/rules/duerp';
import { Cotation } from './RiskForm';

const d = (iso: string | null | undefined) => (iso ? fmtDate(iso) : '—');
/** « 0 risque », « 1 risque », « 12 risques ». */
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
const csvHref = (version: string) => `/risques/export?version=${encodeURIComponent(version)}`;
/** Version imprimable (nouvel onglet, lien HTML simple : la feuille d'impression ne reste pas chargée dans l'application). */
const printHref = (version?: string) => (version ? `/risques/imprimer?version=${encodeURIComponent(version)}` : '/risques/imprimer');
function PrintLink({ version, className = 'vg-link', label = 'Imprimer' }: { version?: string; className?: string; label?: string }) {
  return (
    <a href={printHref(version)} target="_blank" rel="noreferrer" className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <i className="ph ph-printer" style={{ fontSize: 12 }} aria-hidden />{label}
    </a>
  );
}

type View = { kind: 'list' } | { kind: 'snapshot'; version: string } | { kind: 'edit'; version: string };
type Loaded = { version: string; detail?: DuerpVersionDetail; error?: string };

/** Bouton « Versions archivées » : historique des versions, consultation et export des instantanés. */
export function VersionsButton({ versions, canApprove, people, history = false }: { versions: DuerpVersionView[]; canApprove: boolean; people: readonly Option[]; history?: boolean }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const request = useRef<AbortController | null>(null);

  const close = () => { request.current?.abort(); setOpen(false); setView({ kind: 'list' }); };
  const showSnapshot = (version: string) => {
    setView({ kind: 'snapshot', version });
    if (loaded?.version === version && loaded.detail) return;
    request.current?.abort();
    const ctrl = new AbortController();
    request.current = ctrl;
    setLoaded({ version });
    fetch(`${csvHref(version)}&format=json`, { signal: ctrl.signal, cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return (await res.json()) as DuerpVersionDetail;
      })
      .then((detail) => setLoaded({ version, detail }))
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setLoaded({ version, error: err instanceof Error && err.message ? err.message : "Impossible de charger l'instantané." });
      });
  };

  const current = versions.find((v) => v.current);
  const archivedCount = versions.filter((v) => !v.current).length;
  const editing = view.kind === 'edit' ? versions.find((v) => v.version === view.version && v.current) : undefined;
  const title = view.kind === 'snapshot' ? `Version ${view.version}` : editing ? `Version ${editing.version}` : 'Versions du DUERP';
  const kicker = view.kind === 'snapshot' ? 'Instantané archivé · lecture seule' : editing ? 'Compléter la version en vigueur' : `${archivedCount} version${archivedCount > 1 ? 's' : ''} archivée${archivedCount > 1 ? 's' : ''} · conservation ${current?.retention ?? '40 ans'}`;

  return (
    <>
      <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setOpen(true)}>
        <i className="ph ph-clock-counter-clockwise" style={{ fontSize: 13 }} aria-hidden />Versions archivées
      </button>
      <Dialog open={open} onClose={close} title={title} kicker={kicker} width={view.kind === 'snapshot' ? 1080 : 820}>
        {view.kind !== 'list' && (
          <button type="button" className="vg-text-btn" style={{ justifySelf: 'start', alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => setView({ kind: 'list' })}>
            <i className="ph ph-arrow-left" style={{ fontSize: 12 }} aria-hidden />Toutes les versions
          </button>
        )}
        {view.kind === 'list' && <VersionList versions={versions} canApprove={canApprove} onShow={showSnapshot} onEdit={(version) => setView({ kind: 'edit', version })} />}
        {/* DUE-09 : DUERP signé, joint à la version en vigueur ; figé une fois la version archivée. */}
        {view.kind === 'list' && versions.filter((v) => (v.current && canApprove) || v.files.length > 0).map((v) => (
          <EntityFiles key={`files-${v.version}`} kind="duerp_version" entityId={v.version} title={`DUERP signé · version ${v.version}${v.current ? ' (en vigueur)' : ''}`}
            kicker={`DUERP · version ${v.version}`} files={v.files} canAdd={v.current && canApprove} emptyText="Aucun document signé joint."
            hint="Document unique daté et signé (PDF, scan) · 10 Mo par fichier." />
        ))}
        {/* DUE-10 : commentaires ajoutés à une version (la version validée est figée, les commentaires restent possibles). */}
        {view.kind === 'list' && versions.filter((v) => v.comments.length > 0 || canApprove).map((v) => (
          <VersionComments key={`comments-${v.version}`} version={v} canAdd={canApprove} />
        ))}
        {/* Historique des versions (DUE-06) : ouverture, compléments, archivage — à la saisie seulement. */}
        {view.kind === 'list' && history && versions.map((v) => (
          <LazyChangeLog key={v.version} entity="duerp_version" id={v.version} title={`Historique de la version ${v.version}`} />
        ))}
        {view.kind === 'snapshot' && <SnapshotView key={view.version} loaded={loaded?.version === view.version ? loaded : { version: view.version }} />}
        {editing && (
          <VersionFields mode="edit" people={people} defaults={editing}
            onDone={() => setView({ kind: 'list' })} onCancel={() => setView({ kind: 'list' })} />
        )}
      </Dialog>
    </>
  );
}

function VersionList({ versions, canApprove, onShow, onEdit }: { versions: DuerpVersionView[]; canApprove: boolean; onShow: (v: string) => void; onEdit: (v: string) => void }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
        Une version est figée à sa validation (consultation du CSE) par un instantané de tous les risques (toutes unités, tous sites) ; seuls des commentaires s&apos;y ajoutent ensuite. Une version archivée sans validation est figée à son archivage. Les versions antérieures à Vigie sont conservées hors de l&apos;application.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 720 }}>
          <thead><tr><th>Version</th><th>Mise à jour</th><th>Archivée le</th><th>Validée par</th><th>CSE consulté le</th><th>Transmise au SPST</th><th>Instantané</th></tr></thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.version}>
                <td style={{ verticalAlign: 'top' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 500 }}>{v.version}</span>
                    {v.current && <ToneTag tone="accent" style={{ fontSize: 11, padding: '1px 7px' }}>En vigueur</ToneTag>}
                  </div>
                  {v.comment && <div style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', marginTop: 2, maxWidth: 260, textWrap: 'pretty' }}>{v.comment}</div>}
                </td>
                <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>{d(v.updatedOn)}</td>
                <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>{v.current ? '—' : d(v.archivedOn)}</td>
                <td style={{ verticalAlign: 'top' }}>{v.validatedBy || '—'}</td>
                <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap', color: v.current && !v.cseConsultedOn ? TONE.warn.fg : undefined }}>
                  {v.cseConsultedOn ? fmtDate(v.cseConsultedOn) : v.current ? 'À renseigner' : '—'}
                </td>
                <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap', color: v.current && !v.spstSentOn ? TONE.warn.fg : undefined }}>
                  {v.spstSentOn ? fmtDate(v.spstSentOn) : v.current ? 'À renseigner' : '—'}
                  {v.portalDepositedOn && <div style={{ fontSize: 11.5, color: 'var(--color-neutral-400)' }}>Portail : {fmtDate(v.portalDepositedOn)}</div>}
                </td>
                <td style={{ verticalAlign: 'top' }}>
                  {v.current && !v.hasSnapshot ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
                      <span style={{ color: 'var(--color-neutral-500)' }}>Pris à la validation</span>
                      {canApprove && <button type="button" className="vg-text-btn" onClick={() => onEdit(v.version)}>Modifier</button>}
                      <PrintLink />
                    </span>
                  ) : v.hasSnapshot ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
                      <span style={{ color: TONE.ok.fg }}>Oui{v.riskCount != null && <span style={{ color: 'var(--color-neutral-500)' }}> · {v.riskCount} risque{v.riskCount > 1 ? 's' : ''}</span>}</span>
                      {v.current && <span style={{ color: 'var(--color-neutral-500)' }}>figé à la validation</span>}
                      <button type="button" className="vg-text-btn" onClick={() => onShow(v.version)}>Consulter</button>
                      {v.current && canApprove && <button type="button" className="vg-text-btn" onClick={() => onEdit(v.version)}>Modifier</button>}
                      <a href={csvHref(v.version)} download className="vg-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><i className="ph ph-download-simple" style={{ fontSize: 12 }} aria-hidden />CSV</a>
                      <PrintLink version={v.version} />
                    </span>
                  ) : (
                    <span style={{ color: 'var(--color-neutral-500)', whiteSpace: 'nowrap' }}>Archivée hors Vigie</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Instantané d'une version archivée, en lecture seule, filtrable par unité. */
function SnapshotView({ loaded }: { loaded: Loaded }) {
  const [unitId, setUnitId] = useState('');
  if (loaded.error) return <div role="alert" className="vg-form-error">{loaded.error}</div>;
  if (!loaded.detail) return <div style={{ fontSize: 12.5, color: 'var(--color-neutral-500)', padding: '12px 0' }}>Chargement de l&apos;instantané…</div>;
  const { detail } = loaded;
  const risks = detail.snapshot.risks;
  if (!risks) return <div style={{ fontSize: 12.5, color: 'var(--color-neutral-400)' }}>Version archivée hors Vigie : aucun instantané disponible dans l&apos;application.</div>;

  const units = detail.snapshot.units ?? [...new Map(risks.map((r) => [r.unitId, { id: r.unitId, label: r.unit, siteId: r.siteId, site: r.site }])).values()];
  // Les libellés d'unité ne sont uniques que par site : sur plusieurs sites, le site accompagne l'unité.
  const multiSite = new Set(units.map((u) => u.siteId)).size > 1;
  const rows: RiskRecord[] = unitId ? risks.filter((r) => r.unitId === unitId) : risks;
  const meta = [
    `Mise à jour le ${d(detail.updatedOn)}`,
    detail.archivedOn && `archivée le ${fmtDate(detail.archivedOn)}`,
    detail.validatedBy && `validée par ${detail.validatedBy}`,
    detail.cseConsultedOn && `CSE consulté le ${fmtDate(detail.cseConsultedOn)}`,
  ].filter(Boolean).join(' · ');

  return (
    <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{meta}</div>
      {detail.comment && <div style={{ fontSize: 12.5, textWrap: 'pretty' }}>{detail.comment}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <select className="input" aria-label="Unité de travail" value={unitId} onChange={(e) => setUnitId(e.target.value)} style={{ width: 'auto', minWidth: 240, fontSize: 12.5, minHeight: 32, padding: '4px 28px 4px 10px' }}>
          <option value="">Toutes les unités ({units.length})</option>
          {units.map((u) => <option key={u.id} value={u.id}>{multiSite ? `${u.label} · ${u.site}` : u.label}</option>)}
        </select>
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{rows.length} risque{rows.length > 1 ? 's' : ''}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <PrintLink version={detail.version} className="btn btn-ghost vg-btn-sm" />
          <a href={csvHref(detail.version)} download className="btn btn-secondary vg-btn-sm">
            <i className="ph ph-download-simple" style={{ fontSize: 13 }} aria-hidden />Télécharger le CSV
          </a>
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 860 }}>
          <thead><tr>{!unitId && <th>Unité</th>}<th>Danger</th><th>Situation dangereuse</th><th>Cotation brute</th><th>Mesures existantes</th><th>Risque résiduel</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.unitId}-${i}`}>
                {!unitId && <td style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{multiSite ? `${r.unit} · ${r.site}` : r.unit}</td>}
                <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{r.hazard}</td>
                <td style={{ color: 'var(--color-neutral-300)' }}>{r.situation}</td>
                <td><Cotation g={r.gravity} p={r.probability} /></td>
                <td style={{ color: 'var(--color-neutral-300)' }}>{r.existingMeasures || '—'}</td>
                <td><Cotation g={r.residualGravity} p={r.residualProbability} /></td>
                <td style={{ whiteSpace: 'nowrap', color: r.actions.length ? 'var(--color-neutral-300)' : 'var(--vg-text-muted)' }}>{r.actions.length ? r.actions.join(', ') : '—'}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} style={{ color: 'var(--color-neutral-500)' }}>Aucun risque dans cette unité à la date d&apos;archivage.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type VersionDefaults = {
  /** DUE-10 : version validée par le CSE : validateur, consultation et objet figés (envoyés tels quels). */
  frozen?: boolean;
  version: string; validatedById?: string | null; validatedBy?: string; cseConsultedOn?: string | null; spstSentOn?: string | null; portalDepositedOn?: string | null; comment?: string | null;
};

/** Champs d'une version : création (numéro proposé) ou complément de la version en vigueur. */
function VersionFields({ mode, people, defaults, intro, onDone, onCancel }: {
  mode: 'create' | 'edit';
  people: readonly Option[];
  defaults: VersionDefaults;
  intro?: ReactNode;
  onDone: () => void;
  onCancel: () => void;
}) {
  const create = mode === 'create';
  // DUE-15 : à la modification, le validateur enregistré reste un choix même sorti de l'effectif (signalé, withCurrent) ;
  // jamais proposé pour une nouvelle version (le serveur refuse une personne sortie qui n'est pas déjà le validateur).
  const validators = create ? people : withCurrent(people, defaults.validatedById, `${defaults.validatedBy || defaults.validatedById}${LEFT_SUFFIX}`);
  return (
    <ActionForm action={create ? createDuerpVersion : updateCurrentDuerpVersion} onDone={onDone} onCancel={onCancel}
      submitLabel={create ? 'Archiver et créer la version' : 'Enregistrer'}
      hidden={create ? undefined : defaults.frozen
        ? { version: defaults.version, validatedById: defaults.validatedById ?? '', cseConsultedOn: defaults.cseConsultedOn ?? '', comment: defaults.comment ?? '' }
        : { version: defaults.version }}>
      {intro}
      {defaults.frozen ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
          Version validée par {defaults.validatedBy || '—'} · CSE consulté le {d(defaults.cseConsultedOn)} : son contenu est figé. Seules les transmissions se complètent ; ajoutez un commentaire à la version au besoin.
        </p>
      ) : (
      <FormRow cols={create ? 3 : 2}>
        {create && (
          <Field name="version" label="Numéro de version" hint="Même année : AAAA.(n+1) ; nouvelle année : AAAA.1.">
            <Input name="version" defaultValue={defaults.version} maxLength={20} />
          </Field>
        )}
        <Field name="validatedById" label="Validée par">
          <Select name="validatedById" options={validators} defaultValue={defaults.validatedById ?? ''} placeholder="Choisir…" />
        </Field>
        <Field name="cseConsultedOn" label="Consultation du CSE" hint={create ? 'Valide la version et fige son contenu.' : 'Date de la réunion où le CSE a été consulté : valide la version et fige son contenu.'}>
          <Input name="cseConsultedOn" type="date" defaultValue={defaults.cseConsultedOn ?? ''} />
        </Field>
      </FormRow>
      )}
      <FormRow>
        <Field name="spstSentOn" label="Transmise au SPST le" hint="Chaque mise à jour est transmise au service de prévention et de santé au travail (R. 4121-4).">
          <Input name="spstSentOn" type="date" defaultValue={defaults.spstSentOn ?? ''} />
        </Field>
        <Field name="portalDepositedOn" label="Déposée sur le portail numérique le" hint="Dépôt dématérialisé (L. 4121-3-1) : dès l'ouverture du portail.">
          <Input name="portalDepositedOn" type="date" defaultValue={defaults.portalDepositedOn ?? ''} />
        </Field>
      </FormRow>
      {!defaults.frozen && (
        <Field name="comment" label="Commentaire" hint="Objet de la mise à jour : nouvelles unités, risques réévalués, suite d'accident…">
          <TextArea name="comment" defaultValue={defaults.comment ?? ''} rows={3} maxLength={1000} />
        </Field>
      )}
    </ActionForm>
  );
}

/** DUE-10 : commentaires d'une version du DUERP (jamais modifiés ni retirés) et ajout (animateur QHSE et direction). */
function VersionComments({ version, canAdd }: { version: DuerpVersionView; canAdd: boolean }) {
  const [adding, setAdding] = useState(false);
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>Commentaires · version {version.version}{version.frozen ? ' (figée)' : ''}</span>
        {canAdd && !adding && <button type="button" className="vg-text-btn" style={{ marginLeft: 'auto' }} onClick={() => setAdding(true)}>Ajouter un commentaire</button>}
      </div>
      {version.comments.length === 0 && !adding && <span style={{ fontSize: 12, color: 'var(--vg-text-muted)' }}>Aucun commentaire.</span>}
      {version.comments.map((c) => (
        <div key={c.id} style={{ fontSize: 12.5, textWrap: 'pretty' }}>
          <span style={{ color: 'var(--vg-text-muted)' }}>{fmtDate(c.on)} · {c.author} — </span>{c.body}
        </div>
      ))}
      {adding && (
        <ActionForm action={addDuerpVersionComment} hidden={{ version: version.version }} submitLabel="Ajouter"
          onDone={() => setAdding(false)} onCancel={() => setAdding(false)}>
          <Field name="body" label="Commentaire">
            <TextArea name="body" rows={3} maxLength={DUERP_COMMENT_MAX} />
          </Field>
        </ActionForm>
      )}
    </div>
  );
}

/** Bouton « Nouvelle version » (animateur QHSE et direction). */
export function NewVersionButton({ canApprove, people, current, nextVersion, nextUpdateOn, defaultValidatorId, totals }: {
  canApprove: boolean;
  people: readonly Option[];
  current: string | null;
  nextVersion: string;
  nextUpdateOn: string;
  defaultValidatorId: string | null;
  totals: { units: number; risks: number };
}) {
  const intro = (
    <p className="dialog-body" style={{ margin: 0, fontSize: 12.5, textWrap: 'pretty' }}>
      {current
        ? <>La version <b style={{ fontWeight: 500 }}>{current}</b> sera archivée aujourd&apos;hui avec un instantané de {plural(totals.risks, 'risque')} sur {plural(totals.units, 'unité')} de travail (tous sites, actions liées comprises).</>
        : <>Aucune version n&apos;est en vigueur : la nouvelle version ouvre le document unique.</>}
      {' '}La nouvelle version prend effet aujourd&apos;hui ; prochaine mise à jour annuelle le {fmtDate(nextUpdateOn)}. Conservation : 40 ans.
    </p>
  );
  return (
    <DialogButton label="Nouvelle version" className="btn btn-primary vg-btn-sm" disabled={!canApprove}
      tooltip={canApprove ? undefined : "Réservé à l'animateur QHSE et à la direction."}
      title="Nouvelle version du DUERP" kicker="Document unique · mise à jour" width={600}>
      {(close) => (
        <VersionFields mode="create" people={people} intro={intro} onDone={close} onCancel={close}
          defaults={{ version: nextVersion, validatedById: defaultValidatorId }} />
      )}
    </DialogButton>
  );
}
