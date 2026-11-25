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
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

const d = (iso: string | null | undefined) => (iso ? fmtDate(iso) : '—');
const csvHref = (version: string) => `/risques/export?version=${encodeURIComponent(version)}`;
/** Version imprimable (nouvel onglet, lien HTML simple : la feuille d'impression ne reste pas chargée dans l'application). */
const printHref = (version?: string) => (version ? `/risques/imprimer?version=${encodeURIComponent(version)}` : '/risques/imprimer');
function PrintLink({ version, className = 'vg-link', label }: { version?: string; className?: string; label?: string }) {
  const { t } = useI18n();
  return (
    <a href={printHref(version)} target="_blank" rel="noreferrer" className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <i className="ph ph-printer" style={{ fontSize: 12 }} aria-hidden />{label ?? t('Print')}
    </a>
  );
}

type View = { kind: 'list' } | { kind: 'snapshot'; version: string } | { kind: 'edit'; version: string };
type Loaded = { version: string; detail?: DuerpVersionDetail; error?: string };

/** Bouton « Versions archivées » : historique des versions, consultation et export des instantanés. */
export function VersionsButton({ versions, canApprove, people, history = false }: { versions: DuerpVersionView[]; canApprove: boolean; people: readonly Option[]; history?: boolean }) {
  const { t } = useI18n();
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
        setLoaded({ version, error: err instanceof Error && err.message ? err.message : t('The snapshot could not be loaded.') });
      });
  };

  const current = versions.find((v) => v.current);
  const archivedCount = versions.filter((v) => !v.current).length;
  const editing = view.kind === 'edit' ? versions.find((v) => v.version === view.version && v.current) : undefined;
  const title = view.kind === 'snapshot' ? fill(t('Version {v}'), { v: view.version }) : editing ? fill(t('Version {v}'), { v: editing.version }) : t('DUERP versions');
  const kicker = view.kind === 'snapshot' ? t('Archived snapshot · read-only') : editing ? t('Complete the version in force') : `${fill(archivedCount > 1 ? t('{n} archived versions') : t('{n} archived version'), { n: archivedCount })} · ${fill(t('retention {period}'), { period: current?.retention ?? t('40 years') })}`;

  return (
    <>
      <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setOpen(true)}>
        <i className="ph ph-clock-counter-clockwise" style={{ fontSize: 13 }} aria-hidden />{t('Archived versions')}
      </button>
      <Dialog open={open} onClose={close} title={title} kicker={kicker} width={view.kind === 'snapshot' ? 1080 : 820}>
        {view.kind !== 'list' && (
          <button type="button" className="vg-text-btn" style={{ justifySelf: 'start', alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => setView({ kind: 'list' })}>
            <i className="ph ph-arrow-left" style={{ fontSize: 12 }} aria-hidden />{t('All versions')}
          </button>
        )}
        {view.kind === 'list' && <VersionList versions={versions} canApprove={canApprove} onShow={showSnapshot} onEdit={(version) => setView({ kind: 'edit', version })} />}
        {/* DUE-09 : DUERP signé, joint à la version en vigueur ; figé une fois la version archivée. */}
        {view.kind === 'list' && versions.filter((v) => (v.current && canApprove) || v.files.length > 0).map((v) => (
          <EntityFiles key={`files-${v.version}`} kind="duerp_version" entityId={v.version} title={`${fill(t('Signed DUERP · version {v}'), { v: v.version })}${v.current ? t(' (in force)') : ''}`}
            kicker={fill(t('DUERP · version {v}'), { v: v.version })} files={v.files} canAdd={v.current && canApprove} emptyText={t('No signed document attached.')}
            hint={t('Single document dated and signed (PDF, scan) · 10 MB per file.')} />
        ))}
        {/* DUE-10 : commentaires ajoutés à une version (la version validée est figée, les commentaires restent possibles). */}
        {view.kind === 'list' && versions.filter((v) => v.comments.length > 0 || canApprove).map((v) => (
          <VersionComments key={`comments-${v.version}`} version={v} canAdd={canApprove} />
        ))}
        {/* Historique des versions (DUE-06) : ouverture, compléments, archivage — à la saisie seulement. */}
        {view.kind === 'list' && history && versions.map((v) => (
          <LazyChangeLog key={v.version} entity="duerp_version" id={v.version} title={fill(t('History of version {v}'), { v: v.version })} />
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
  const { t } = useI18n();
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
        {t('A version is frozen at its validation (CSE consultation) by a snapshot of all risks (all units, all sites); only comments are added afterwards. A version archived without validation is frozen at its archiving. Versions earlier than Vigie are kept outside the application.')}
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 720 }}>
          <thead><tr><th>{t('Version')}</th><th>{t('Update')}</th><th>{t('Archived on')}</th><th>{t('Validated by')}</th><th>{t('CSE consulted on')}</th><th>{t('Sent to the SPST')}</th><th>{t('Snapshot')}</th></tr></thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.version}>
                <td style={{ verticalAlign: 'top' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 500 }}>{v.version}</span>
                    {v.current && <ToneTag tone="accent" style={{ fontSize: 11, padding: '1px 7px' }}>{t('In force')}</ToneTag>}
                  </div>
                  {v.comment && <div style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', marginTop: 2, maxWidth: 260, textWrap: 'pretty' }}>{v.comment}</div>}
                </td>
                <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>{d(v.updatedOn)}</td>
                <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>{v.current ? '—' : d(v.archivedOn)}</td>
                <td style={{ verticalAlign: 'top' }}>{v.validatedBy || '—'}</td>
                <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap', color: v.current && !v.cseConsultedOn ? TONE.warn.fg : undefined }}>
                  {v.cseConsultedOn ? fmtDate(v.cseConsultedOn) : v.current ? t('To be entered') : '—'}
                </td>
                <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap', color: v.current && !v.spstSentOn ? TONE.warn.fg : undefined }}>
                  {v.spstSentOn ? fmtDate(v.spstSentOn) : v.current ? t('To be entered') : '—'}
                  {v.portalDepositedOn && <div style={{ fontSize: 11.5, color: 'var(--color-neutral-400)' }}>{fill(t('Portal: {date}'), { date: fmtDate(v.portalDepositedOn) })}</div>}
                </td>
                <td style={{ verticalAlign: 'top' }}>
                  {v.current && !v.hasSnapshot ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
                      <span style={{ color: 'var(--color-neutral-500)' }}>{t('Taken at validation')}</span>
                      {canApprove && <button type="button" className="vg-text-btn" onClick={() => onEdit(v.version)}>{t('Edit')}</button>}
                      <PrintLink />
                    </span>
                  ) : v.hasSnapshot ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
                      <span style={{ color: TONE.ok.fg }}>{t('Yes')}{v.riskCount != null && <span style={{ color: 'var(--color-neutral-500)' }}> · {fill(v.riskCount > 1 ? t('{n} risks') : t('{n} risk'), { n: v.riskCount })}</span>}</span>
                      {v.current && <span style={{ color: 'var(--color-neutral-500)' }}>{t('frozen at validation')}</span>}
                      <button type="button" className="vg-text-btn" onClick={() => onShow(v.version)}>{t('View')}</button>
                      {v.current && canApprove && <button type="button" className="vg-text-btn" onClick={() => onEdit(v.version)}>{t('Edit')}</button>}
                      <a href={csvHref(v.version)} download className="vg-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><i className="ph ph-download-simple" style={{ fontSize: 12 }} aria-hidden />CSV</a>
                      <PrintLink version={v.version} />
                    </span>
                  ) : (
                    <span style={{ color: 'var(--color-neutral-500)', whiteSpace: 'nowrap' }}>{t('Archived outside Vigie')}</span>
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
  const { t } = useI18n();
  const [unitId, setUnitId] = useState('');
  if (loaded.error) return <div role="alert" className="vg-form-error">{loaded.error}</div>;
  if (!loaded.detail) return <div style={{ fontSize: 12.5, color: 'var(--color-neutral-500)', padding: '12px 0' }}>{t('Loading the snapshot…')}</div>;
  const { detail } = loaded;
  const risks = detail.snapshot.risks;
  if (!risks) return <div style={{ fontSize: 12.5, color: 'var(--color-neutral-400)' }}>{t('Version archived outside Vigie: no snapshot available in the application.')}</div>;

  const units = detail.snapshot.units ?? [...new Map(risks.map((r) => [r.unitId, { id: r.unitId, label: r.unit, siteId: r.siteId, site: r.site }])).values()];
  // Les libellés d'unité ne sont uniques que par site : sur plusieurs sites, le site accompagne l'unité.
  const multiSite = new Set(units.map((u) => u.siteId)).size > 1;
  const rows: RiskRecord[] = unitId ? risks.filter((r) => r.unitId === unitId) : risks;
  const meta = [
    fill(t('Updated on {date}'), { date: d(detail.updatedOn) }),
    detail.archivedOn && fill(t('archived on {date}'), { date: fmtDate(detail.archivedOn) }),
    detail.validatedBy && fill(t('validated by {by}'), { by: detail.validatedBy }),
    detail.cseConsultedOn && fill(t('CSE consulted on {date}'), { date: fmtDate(detail.cseConsultedOn) }),
  ].filter(Boolean).join(' · ');

  return (
    <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{meta}</div>
      {detail.comment && <div style={{ fontSize: 12.5, textWrap: 'pretty' }}>{detail.comment}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <select className="input" aria-label={t('Work unit')} value={unitId} onChange={(e) => setUnitId(e.target.value)} style={{ width: 'auto', minWidth: 240, fontSize: 12.5, minHeight: 32, padding: '4px 28px 4px 10px' }}>
          <option value="">{fill(t('All units ({n})'), { n: units.length })}</option>
          {units.map((u) => <option key={u.id} value={u.id}>{multiSite ? `${u.label} · ${u.site}` : u.label}</option>)}
        </select>
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{fill(rows.length > 1 ? t('{n} risks') : t('{n} risk'), { n: rows.length })}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <PrintLink version={detail.version} className="btn btn-ghost vg-btn-sm" />
          <a href={csvHref(detail.version)} download className="btn btn-secondary vg-btn-sm">
            <i className="ph ph-download-simple" style={{ fontSize: 13 }} aria-hidden />{t('Download the CSV')}
          </a>
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 860 }}>
          <thead><tr>{!unitId && <th>{t('Unit')}</th>}<th>{t('Hazard')}</th><th>{t('Hazardous situation')}</th><th>{t('Gross rating')}</th><th>{t('Existing measures')}</th><th>{t('Residual risk')}</th><th>{t('Actions')}</th></tr></thead>
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
            {!rows.length && <tr><td colSpan={7} style={{ color: 'var(--color-neutral-500)' }}>{t('No risk in this unit on the archiving date.')}</td></tr>}
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
  const { t } = useI18n();
  const create = mode === 'create';
  // DUE-15 : à la modification, le validateur enregistré reste un choix même sorti de l'effectif (signalé, withCurrent) ;
  // jamais proposé pour une nouvelle version (le serveur refuse une personne sortie qui n'est pas déjà le validateur).
  const validators = create ? people : withCurrent(people, defaults.validatedById, `${defaults.validatedBy || defaults.validatedById}${LEFT_SUFFIX}`);
  return (
    <ActionForm action={create ? createDuerpVersion : updateCurrentDuerpVersion} onDone={onDone} onCancel={onCancel}
      submitLabel={create ? t('Archive and create the version') : t('Save')}
      hidden={create ? undefined : defaults.frozen
        ? { version: defaults.version, validatedById: defaults.validatedById ?? '', cseConsultedOn: defaults.cseConsultedOn ?? '', comment: defaults.comment ?? '' }
        : { version: defaults.version }}>
      {intro}
      {defaults.frozen ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
          {fill(t('Version validated by {by} · CSE consulted on {date}: its content is frozen. Only the transmissions can be completed; add a comment to the version if needed.'), { by: defaults.validatedBy || '—', date: d(defaults.cseConsultedOn) })}
        </p>
      ) : (
      <FormRow cols={create ? 3 : 2}>
        {create && (
          <Field name="version" label={t('Version number')} hint={t('Same year: YYYY.(n+1); new year: YYYY.1.')}>
            <Input name="version" defaultValue={defaults.version} maxLength={20} />
          </Field>
        )}
        <Field name="validatedById" label={t('Validated by')}>
          <Select name="validatedById" options={validators} defaultValue={defaults.validatedById ?? ''} placeholder={t('Choose…')} />
        </Field>
        <Field name="cseConsultedOn" label={t('CSE consultation')} hint={create ? t('Validates the version and freezes its content.') : t('Date of the meeting where the CSE was consulted: validates the version and freezes its content.')}>
          <Input name="cseConsultedOn" type="date" defaultValue={defaults.cseConsultedOn ?? ''} />
        </Field>
      </FormRow>
      )}
      <FormRow>
        <Field name="spstSentOn" label={t('Sent to the SPST on')} hint={t('Each update is sent to the occupational prevention and health service (R. 4121-4).')}>
          <Input name="spstSentOn" type="date" defaultValue={defaults.spstSentOn ?? ''} />
        </Field>
        <Field name="portalDepositedOn" label={t('Deposited on the digital portal on')} hint={t('Electronic deposit (L. 4121-3-1): as soon as the portal opens.')}>
          <Input name="portalDepositedOn" type="date" defaultValue={defaults.portalDepositedOn ?? ''} />
        </Field>
      </FormRow>
      {!defaults.frozen && (
        <Field name="comment" label={t('Comment')} hint={t('Purpose of the update: new units, risks reassessed, after an accident…')}>
          <TextArea name="comment" defaultValue={defaults.comment ?? ''} rows={3} maxLength={1000} />
        </Field>
      )}
    </ActionForm>
  );
}

/** DUE-10 : commentaires d'une version du DUERP (jamais modifiés ni retirés) et ajout (animateur QHSE et direction). */
function VersionComments({ version, canAdd }: { version: DuerpVersionView; canAdd: boolean }) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>{fill(t('Comments · version {v}'), { v: version.version })}{version.frozen ? t(' (frozen)') : ''}</span>
        {canAdd && !adding && <button type="button" className="vg-text-btn" style={{ marginLeft: 'auto' }} onClick={() => setAdding(true)}>{t('Add a comment')}</button>}
      </div>
      {version.comments.length === 0 && !adding && <span style={{ fontSize: 12, color: 'var(--vg-text-muted)' }}>{t('No comment.')}</span>}
      {version.comments.map((c) => (
        <div key={c.id} style={{ fontSize: 12.5, textWrap: 'pretty' }}>
          <span style={{ color: 'var(--vg-text-muted)' }}>{fmtDate(c.on)} · {c.author} — </span>{c.body}
        </div>
      ))}
      {adding && (
        <ActionForm action={addDuerpVersionComment} hidden={{ version: version.version }} submitLabel={t('Add')}
          onDone={() => setAdding(false)} onCancel={() => setAdding(false)}>
          <Field name="body" label={t('Comment')}>
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
  const { t } = useI18n();
  const intro = (
    <p className="dialog-body" style={{ margin: 0, fontSize: 12.5, textWrap: 'pretty' }}>
      {current
        ? <>{t('Version ')}<b style={{ fontWeight: 500 }}>{current}</b>{fill(t(' will be archived today with a snapshot of {risks} over {units} (all sites, linked actions included).'), { risks: fill(totals.risks > 1 ? t('{n} risks') : t('{n} risk'), { n: totals.risks }), units: fill(totals.units > 1 ? t('{n} work units') : t('{n} work unit'), { n: totals.units }) })}</>
        : <>{t('No version is in force: the new version opens the single document.')}</>}
      {' '}{fill(t('The new version takes effect today; next annual update on {date}. Retention: 40 years.'), { date: fmtDate(nextUpdateOn) })}
    </p>
  );
  return (
    <DialogButton label={t('New version')} className="btn btn-primary vg-btn-sm" disabled={!canApprove}
      tooltip={canApprove ? undefined : t('Reserved for the QHSE coordinator and senior management.')}
      title={t('New DUERP version')} kicker={t('Single document · update')} width={600}>
      {(close) => (
        <VersionFields mode="create" people={people} intro={intro} onDone={close} onCancel={close}
          defaults={{ version: nextVersion, validatedById: defaultValidatorId }} />
      )}
    </DialogButton>
  );
}
