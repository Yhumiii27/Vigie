'use client';

import { useOptimistic, useState, useTransition } from 'react';
import Link from 'next/link';
import { newEventHref } from '@/lib/event-prefill';
import { useRouter } from 'next/navigation';
import { ChangeLogList } from '@/components/ChangeLog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ReasonForm } from '@/components/ReasonDialog';
import { ActionForm, Field, FormRow, Input, Select } from '@/components/form';
import { Icon, ToneTag } from '@/components/ui';
import { actionHref } from '@/lib/action-rules';
import type { PermitView, PlanChoice } from '@/lib/data/prevention';
import { cancelPermit, closePermit, deliverPermit, linkPermitPlan, savePermit, setPermitCheck } from '@/server/permits';
import { SaveStatus, safeCall } from '@/components/feedback';
import {
  FIRE_WATCH_HOURS, PERMIT_MAX_DAYS, PERMIT_TYPES, PERMIT_TYPE_KEYS, addHoursLocal, fmtLocalLong, lcfirst, missingPresets, permitNeedsSignedPlan, planCovers, ruleBasis,
  type ChecklistItem, type PermitType,
} from '@/lib/rules/prevention';
import {
  ConfirmButton, ErrorLine, Facts, LinkedEvents, Notice, ProcedureNote, SITE_LOCK_HINT, SectionTitle,
  contractorChoices, contractorHref, dropUrlParam, muted, rowOpener, ruleOf, useRun, type PreventionOptions,
} from './parts';
import { withCurrent } from '@/lib/form-options';
import { PermitLockouts } from './PermitLockouts';
import { useI18n } from '@/i18n/client';
import { fill, type T } from '@/i18n/translate';

const preset = (type: PermitType): ChecklistItem[] => PERMIT_TYPES[type].checklist.map((label) => ({ label, checked: false }));

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Plans proposés au rattachement d'un permis : non clos, du site, de l'entreprise (toutes si aucune n'est choisie)
 * et couvrant les jours de validité ; les plans signés d'abord.
 */
function planCandidates(plans: PlanChoice[], siteId: string, contractorId: string, from: string, to: string) {
  const dated = DAY.test(from) && DAY.test(to) && from <= to;
  return plans
    .filter((p) => !p.closed && p.siteId === siteId && (!contractorId || p.contractorId === contractorId) && (!dated || planCovers(p, from, to)))
    .sort((a, b) => Number(b.signed) - Number(a.signed) || a.startOn.localeCompare(b.startOn));
}

const planLabel = (p: PlanChoice, withContractor: boolean, t: T) =>
  `${p.id} · ${withContractor ? `${p.contractor} — ` : ''}${p.title} · ${p.period} · ${p.signed ? t('signed') : t('not signed')}`;

const contractorName = (options: PreventionOptions, id: string) => options.contractors.find(([v]) => v === id)?.[1].split(' — ')[0] ?? id;

// ─── Formulaire ─────────────────────────────────────────────────────────────

function PermitForm({ permit, options, onDone, onCancel }: { permit?: PermitView; options: PreventionOptions; onDone: (id?: string) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [type, setType] = useState<PermitType>(permit?.type ?? 'feu');
  // Une demande antérieure à laquelle manquerait un point de la check-list type le retrouve (exigé à l'enregistrement).
  const [items, setItems] = useState<ChecklistItem[]>(() => (permit
    ? [...permit.checklist, ...missingPresets(permit.type, permit.checklist).map((label) => ({ label, checked: false }))]
    : preset('feu')));
  const [draft, setDraft] = useState('');
  const [siteId, setSiteId] = useState(permit?.siteId ?? options.defaultSiteId);
  const [contractorId, setContractorId] = useState(permit?.contractorId ?? '');
  const [planId, setPlanId] = useState(permit?.preventionPlanId ?? '');
  const [validFrom, setValidFrom] = useState(permit?.validFrom ?? `${options.today}T08:00`);
  const [validTo, setValidTo] = useState(permit?.validTo ?? `${options.today}T17:00`);
  const [watch, setWatch] = useState(permit?.watchUntil ?? addHoursLocal(`${options.today}T17:00`, FIRE_WATCH_HOURS));
  const [watchTouched, setWatchTouched] = useState(!!permit?.watchUntil);
  const presets = PERMIT_TYPES[type].checklist;
  const checkedCount = items.filter((i) => i.checked).length;
  // D02 : projet de la fiche absent de keystone.pub_projets (ou source indisponible) gardé comme choix.
  const projects = withCurrent(options.projects, permit?.keystoneProjectCode, permit?.keystoneProject, 'start');

  // Plan de prévention : plans de l'entreprise couvrant la validité, selon la règle du site.
  const rule = ruleOf(options, siteId);
  const firstMinute = !!rule?.ppFromFirstMinute;
  // Plan signé exigé pour délivrer : entreprise extérieure sur un site « dès la première minute », ou permis de feu d'une entreprise extérieure.
  const planRequired = permitNeedsSignedPlan({ type, contractorId: contractorId || null }, rule);
  const requiredWhy = firstMinute ? fill(t('{basis}, plan from the first minute'), { basis: lcfirst(ruleBasis(rule)) }) : t('fire permit: dangerous work, order of 19 March 1993');
  const fromDay = validFrom.slice(0, 10), toDay = validTo.slice(0, 10);
  const candidates = planCandidates(options.plans, siteId, contractorId, fromDay, toDay);
  const selected = options.plans.find((p) => p.id === planId);
  const stale = !!planId && !candidates.some((p) => p.id === planId);
  const planOptions = [
    ...(stale ? [[planId, `${selected ? planLabel(selected, !contractorId, t) : planId}${t(' — not suitable')}`] as const] : []),
    ...candidates.map((p) => [p.id, planLabel(p, !contractorId, t)] as const),
  ];
  /** Conserve le plan choisi s'il convient encore ; sinon propose le plan (signé de préférence) de l'entreprise couvrant les dates. */
  const repick = (next: { site?: string; contractor?: string; from?: string; to?: string }) => {
    // Intervention interne choisie : pas de plan de prévention.
    if (next.contractor === '') { setPlanId(''); return; }
    const list = planCandidates(options.plans, next.site ?? siteId, next.contractor ?? contractorId, (next.from ?? validFrom).slice(0, 10), (next.to ?? validTo).slice(0, 10));
    if (planId && list.some((p) => p.id === planId)) return;
    setPlanId((next.contractor ?? contractorId) ? list[0]?.id ?? '' : '');
  };
  const choosePlan = (id: string) => {
    setPlanId(id);
    const p = options.plans.find((x) => x.id === id);
    if (p && !contractorId) setContractorId(p.contractorId);
  };
  const who = contractorId ? contractorName(options, contractorId) : '';

  const switchType = (k: PermitType) => {
    setType(k);
    setItems(preset(k));
  };
  const addItem = () => {
    const label = draft.trim();
    if (!label || items.some((i) => i.label.toLocaleLowerCase('fr') === label.toLocaleLowerCase('fr'))) return;
    setItems([...items, { label, checked: false }]);
    setDraft('');
  };
  const changeValidTo = (v: string) => {
    setValidTo(v);
    if (!watchTouched && v) setWatch(addHoursLocal(v, FIRE_WATCH_HOURS));
    repick({ to: v });
  };

  return (
    <ActionForm action={savePermit} onDone={(s) => onDone(s.id)} onCancel={onCancel} submitLabel={permit ? t('Save') : t('Save the request')} hidden={{ id: permit?.id, version: permit?.version }}>
      <Field name="type" label={t('Permit type')}>
        <div className="seg" role="radiogroup" style={{ justifySelf: 'start' }}>
          {PERMIT_TYPE_KEYS.map((k) => (
            <label key={k} className="seg-opt" style={{ fontSize: 12, padding: '5px 11px', display: 'inline-flex', alignItems: 'center', gap: 6, opacity: permit && permit.type !== k ? 0.45 : 1 }}>
              <input type="radio" name="type" value={k} checked={type === k} disabled={!!permit && permit.type !== k} onChange={() => switchType(k)} />
              <Icon name={PERMIT_TYPES[k].icon} size={13} />{PERMIT_TYPES[k].label}
            </label>
          ))}
        </div>
      </Field>
      <FormRow>
        <Field name="siteId" label={t('Site')} hint={options.siteLocked ? t(SITE_LOCK_HINT) : undefined}>
          <Select name="siteId" options={options.recordSites} value={siteId} onChange={(e) => { setSiteId(e.target.value); repick({ site: e.target.value }); }} />
        </Field>
        <Field name="location" label={t('Location')}>
          <Input name="location" defaultValue={permit?.location} placeholder={type === 'feu' ? t('E.g. Assembly workshop · station M3') : t('E.g. Test area · bench BE-1 (ATEX zone 2)')} />
        </Field>
      </FormRow>
      <Field name="description" label={t('Work')}>
        <Input name="description" defaultValue={permit?.description}
          placeholder={type === 'feu' ? t('E.g. Repair welding on the frame of the turning station') : t('E.g. Endurance tests with an inert product simulating the emulsion')} />
      </Field>
      <FormRow>
        <Field name="contractorId" label={t('Company')} hint={t('Leave empty for an intervention by internal staff.')}>
          <Select name="contractorId" options={contractorChoices(options, t, permit && { id: permit.contractorId, name: permit.contractor })} value={contractorId} placeholder={t('Internal intervention')}
            onChange={(e) => { setContractorId(e.target.value); repick({ contractor: e.target.value }); }} />
        </Field>
        <Field name="performer" label={t('Worker(s)')}>
          <Input name="performer" defaultValue={permit?.performer} placeholder={t('E.g. [T. Nguyen]')} />
        </Field>
      </FormRow>
      <FormRow cols={type === 'feu' ? 3 : 2}>
        <Field name="validFrom" label={t('Valid from')}>
          <Input name="validFrom" type="datetime-local" value={validFrom} onChange={(e) => { setValidFrom(e.target.value); repick({ from: e.target.value }); }} />
        </Field>
        <Field name="validTo" label={t('To (end of the work)')} hint={fill(t('Validity of {n} days at most.'), { n: PERMIT_MAX_DAYS })}>
          <Input name="validTo" type="datetime-local" value={validTo} onChange={(e) => changeValidTo(e.target.value)} />
        </Field>
        {type === 'feu' && (
          <Field name="watchUntil" label={t('Watch until')} hint={fill(t('{n} h after the end of the work.'), { n: FIRE_WATCH_HOURS })}>
            <Input name="watchUntil" type="datetime-local" value={watch} onChange={(e) => { setWatch(e.target.value); setWatchTouched(true); }} />
          </Field>
        )}
      </FormRow>

      <FormRow>
        <Field name="preventionPlanId" label={t('Prevention plan')}
          hint={firstMinute ? t('External company: signed plan covering the validity required to issue.')
            : type === 'feu' ? t('Fire permit of an external company: signed plan covering the validity required to issue.')
              : t('For an external company: issuing requires the signed mandatory plan.')}>
          <Select name="preventionPlanId" options={planOptions} value={planId} onChange={(e) => choosePlan(e.target.value)}
            placeholder={contractorId && !candidates.length ? t('No plan covering these dates') : t('None')} />
        </Field>
        <Field name="keystoneProjectCode" label={t('Keystone project')} hint={options.projectsMessage ?? (permit?.keystoneProject && !permit.keystoneProjectCode ? fill(t('Former label: {label}'), { label: permit.keystoneProject }) : undefined)}>
          <Select name="keystoneProjectCode" options={projects} defaultValue={permit?.keystoneProjectCode ?? ''} placeholder={t('No project')} />
        </Field>
      </FormRow>
      {stale && (
        <Notice tone="danger">
          {fill(t('The plan {id} does not suit this permit (closed, other site or other company, or period not covering the validity): choose a plan covering the permit’s dates.'), { id: planId })}
        </Notice>
      )}
      {!stale && contractorId && !candidates.length && (
        planRequired
          ? (
            <Notice tone="danger">
              {fill(t('No prevention plan of {company} covers these dates on this site: the permit cannot be issued without a signed plan covering its validity ({why}). Create the plan in the “Prevention plans” tab.'), { company: who, why: requiredWhy })}
              {firstMinute && t(' The request is counted as a gap as long as this plan is not signed.')}
            </Notice>
          )
          : <Notice tone="neutral" icon="ph-info">{fill(t('No prevention plan of {company} covers these dates on this site: link one if the written plan is required (R. 4512-7: 400 h over 12 months or dangerous work).'), { company: who })}</Notice>
      )}
      {!stale && planRequired && !planId && candidates.length > 0 && (
        <Notice tone="warn">{fill(t('Link the prevention plan of {company} covering these dates: issuing is impossible without a signed plan ({why}).'), { company: who, why: requiredWhy })}</Notice>
      )}
      {!stale && selected && (selected.mandatory || planRequired) && !selected.signed && (
        <Notice tone="warn" icon="ph-pen-nib">
          {fill(t('The plan {id} is not yet signed by both companies: issuing will stay blocked until the signatures'), { id: selected.id })}{firstMinute ? t(', and the request counted as a gap') : ''}.
        </Notice>
      )}

      <Field name="checklist" label={<>{t('Prior checks')} <span style={{ color: 'var(--color-neutral-500)' }}>· {checkedCount}/{items.length}</span></>}
        hint={t('Every point must be checked to issue the permit.')}>
        <input type="hidden" name="checklist" value={JSON.stringify(items)} />
        <div className="vg-inset" style={{ display: 'grid', gap: 7, padding: '10px 12px' }}>
          {items.map((item, i) => (
            <div key={`${i}-${item.label}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label className="vg-check" style={{ flex: 1 }}>
                <input type="checkbox" checked={item.checked} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)))} />
                <span className="vg-check-box"><i className="ph ph-check" aria-hidden /></span>
                <span>{item.label}</span>
              </label>
              {!presets.includes(item.label) && (
                <button type="button" className="btn btn-ghost btn-icon" aria-label={fill(t('Remove “{item}”'), { item: item.label })} style={{ width: 24, height: 24, color: 'var(--color-neutral-500)' }}
                  onClick={() => setItems(items.filter((_, j) => j !== i))}>
                  <Icon name="ph-x" size={12} />
                </button>
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
            <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('Add a check point specific to the intervention…')} maxLength={200}
              aria-label={t('New check point')} style={{ fontSize: 12.5 }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }} />
            <button type="button" className="btn btn-secondary vg-btn-sm" disabled={!draft.trim()} onClick={addItem}><Icon name="ph-plus" size={13} />{t('Add')}</button>
          </div>
        </div>
      </Field>
    </ActionForm>
  );
}

// ─── Fiche ──────────────────────────────────────────────────────────────────

function PermitChecklist({ permit, editable }: { permit: PermitView; editable: boolean }) {
  const { t } = useI18n();
  const [items, setItem] = useOptimistic(permit.checklist, (cur: ChecklistItem[], [i, v]: [number, boolean]) => cur.map((c, j) => (j === i ? { ...c, checked: v } : c)));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const done = items.filter((i) => i.checked).length;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <SectionTitle aside={<span style={{ ...muted, display: 'inline-flex', gap: 8, alignItems: 'center' }}><SaveStatus pending={pending} />{fill(t('{done}/{total} checked'), { done, total: items.length })}</span>}>{t('Prior checks')}</SectionTitle>
      <div className="vg-inset" style={{ display: 'grid', gap: 7, padding: '10px 12px' }}>
        {items.length === 0 && <span style={muted}>{t('No check point.')}</span>}
        {items.map((item, i) => editable ? (
          <label key={`${i}-${item.label}`} className="vg-check">
            <input type="checkbox" checked={item.checked}
              onChange={(e) => { const v = e.target.checked; start(async () => { setItem([i, v]); const r = await safeCall(() => setPermitCheck(permit.id, i, v)); setError(r.error ?? null); }); }} />
            <span className="vg-check-box"><i className="ph ph-check" aria-hidden /></span>
            <span>{item.label}</span>
          </label>
        ) : (
          <div key={`${i}-${item.label}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <Icon name={item.checked ? 'ph-check-circle' : 'ph-circle-dashed'} size={15} style={{ color: item.checked ? 'var(--tone-ok-dot)' : 'var(--tone-danger-dot)' }} />
            <span style={{ color: item.checked ? 'var(--color-text)' : 'var(--color-neutral-400)' }}>{item.label}</span>
          </div>
        ))}
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

/**
 * Rattachement rapide d'un plan couvrant la validité (régularisation d'un permis sans plan en règle).
 * Permis délivré : seuls les plans en règle (signés s'ils sont exigés) sont proposés, comme le vérifie le serveur.
 */
function PermitPlanLink({ permit, options }: { permit: PermitView; options: PreventionOptions }) {
  const { t } = useI18n();
  const delivered = permit.status === 'delivre';
  const list = planCandidates(options.plans, permit.siteId, permit.contractorId ?? '', permit.validFrom.slice(0, 10), permit.validTo.slice(0, 10))
    .filter((p) => p.id !== permit.preventionPlanId && (!delivered || p.signed || (!p.mandatory && !permit.planRequired)));
  const [planId, setPlanId] = useState(list[0]?.id ?? '');
  const { pending, error, run } = useRun();
  if (!list.length) {
    // Plan rattaché couvrant la validité mais non signé : la régularisation passe par les signatures.
    if (permit.planIssueKind === 'unsigned') return null;
    return (
      <span style={{ fontSize: 11.5, color: 'var(--color-neutral-400)' }}>
        {fill(delivered
          ? t('No other signed plan of {company} covers the permit’s validity: collect the plan’s signatures, or cancel the permit if the work is stopped.')
          : t('No other plan of {company} covers the permit’s validity: draw it up in the “Prevention plans” tab.'), { company: permit.contractor ?? t('the company') })}
      </span>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="input" value={planId} onChange={(e) => setPlanId(e.target.value)} aria-label={t('Prevention plan to link')}
          style={{ flex: 1, minWidth: 220, fontSize: 12.5, padding: '5px 8px' }}>
          {list.map((p) => <option key={p.id} value={p.id}>{planLabel(p, false, t)}</option>)}
        </select>
        <button type="button" className="btn btn-secondary vg-btn-sm" disabled={pending || !planId} onClick={() => run(() => linkPermitPlan(permit.id, planId))}>
          <Icon name="ph-link" size={13} />{t('Link the plan')}
        </button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

function PermitSheet({ permit, options, canManage, onEdit, onCancelPermit, onLeave }: {
  permit: PermitView; options: PreventionOptions; canManage: boolean; onEdit: () => void; onCancelPermit: () => void; onLeave: () => void;
}) {
  const { t } = useI18n();
  const { pending, error, run } = useRun();
  const requested = permit.status === 'demande';
  const delivered = permit.status === 'delivre';
  const ended = permit.status === 'clos' || permit.status === 'annule';
  const expired = permit.state === 'expire';
  const deliverBlock = !permit.allChecked ? t('Every point of the checklist must be checked.')
    : permit.planBlocker ? permit.planBlocker
      : expired ? t('The validity period is exceeded.')
        : permit.lockoutDeliverBlock;
  const closeQuestion = permit.type === 'feu' ? t('Watch after work finished and zone checked?') : t('Tests finished and zone made safe again?');

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <ToneTag tone={permit.tone}>{permit.stateLabel}{permit.watching ? t(' · watch') : ''}</ToneTag>
        <span className="tag tag-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name={permit.icon} size={12} />{permit.typeLabel}</span>
        {permit.planGap && <ToneTag tone="danger">{permit.status === 'demande' ? t('Request without a signed plan · gap') : t('External company without a signed plan · gap')}</ToneTag>}
        {permit.planGapWith && <span style={muted}>{fill(t('counted with the plan {id}, in gap'), { id: permit.planGapWith })}</span>}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {/* Fiche à afficher sur le lieu des travaux : lien HTML simple (nouvel onglet), la feuille d'impression ne reste pas chargée. */}
          <a href={`/prevention/imprimer/permis/${encodeURIComponent(permit.id)}`} target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm">
            <Icon name="ph-printer" size={13} />{t('Print')}
          </a>
          {!ended && (
            <Link href={`/prevention/carte?permis=${encodeURIComponent(permit.id)}`} className="btn btn-ghost vg-btn-sm">
              <Icon name="ph-map-trifold" size={13} />{t('See on the map')}
            </Link>
          )}
        </span>
      </div>

      {expired && delivered && <Notice tone="danger">{permit.type === 'feu' ? t('Validity exceeded without closure: check the end of the work and the watch round, then close the permit.') : t('Validity exceeded without closure: check the end of the work and that the zone is made safe again, then close the permit.')}</Notice>}
      {expired && requested && <Notice tone="danger">{t('Permit never issued and validity period over: change the dates or cancel the request.')}</Notice>}
      {permit.planIssue && (permit.planGap || permit.planBlocker) && (
        <Notice tone="danger">
          <div style={{ display: 'grid', gap: 6 }}>
            <span>
              {permit.planGap && <strong style={{ fontWeight: 500 }}>{t('Intervention of an external company without a signed prevention plan.')} </strong>}
              {permit.planIssue}{' '}
              {requested
                ? (permit.ruleReason ? fill(t('Issue impossible ({reason}).'), { reason: lcfirst(permit.ruleReason) }) : t('Issue impossible as long as the plan is not in order.'))
                : permit.ruleReason ? `${permit.ruleReason}.` : ''}
            </span>
            {permit.plan && permit.planIssueKind === 'unsigned' && (
              <Link href={`/prevention?plan=${encodeURIComponent(permit.plan.id)}`} scroll={false} onClick={onLeave} className="vg-link" style={{ justifySelf: 'start' }}>
                {fill(t('Open the plan {id} to collect the signatures'), { id: permit.plan.id })}
              </Link>
            )}
            {canManage && permit.contractorId && <PermitPlanLink key={permit.preventionPlanId ?? 'aucun'} permit={permit} options={options} />}
          </div>
        </Notice>
      )}
      {permit.watching && <Notice tone="warn" icon="ph-eye">{fill(t('Work finished: watch of the place until {time}.'), { time: permit.watchLabel ?? '' })}</Notice>}

      <Facts items={[
        [t('Work'), permit.description],
        [t('Location'), permit.location],
        [t('Site'), permit.site],
        [t('Company'), permit.contractorId && permit.contractor
          ? <Link href={contractorHref(permit.contractorId)} className="vg-link" style={{ fontSize: 12.5 }}>{permit.contractor}</Link>
          : permit.contractor ?? t('Internal intervention')],
        [t('Worker(s)'), permit.performer],
        [t('Prevention plan'), permit.plan
          ? <>{permit.plan.id}<span style={{ display: 'block', ...muted, color: permit.plan.signed ? 'var(--color-neutral-500)' : 'var(--tone-warn-fg)' }}>{permit.plan.signed ? t('Signed') : t('Not signed')} · {permit.plan.period}</span></>
          : permit.planRequired ? <span style={{ color: 'var(--tone-danger-fg)' }}>{t('None')}</span> : '—'],
        [t('Keystone project'), permit.keystoneProject ?? '—'],
        [t('Valid from'), fmtLocalLong(permit.validFrom)],
        [t('To#date'), fmtLocalLong(permit.validTo)],
        permit.watchUntil ? [t('Watch until'), fmtLocalLong(permit.watchUntil)] : null,
        [t('Issued by'), permit.issuer ?? (requested ? t('Not issued') : '—')],
        permit.closedLabel ? [permit.status === 'annule' ? t('Cancelled on') : t('Closed on'), permit.status === 'annule'
          ? <>{permit.closedLabel}{permit.cancelledBy ? fill(t(' by {name}'), { name: permit.cancelledBy }) : ''}{permit.cancelReason && <span style={{ display: 'block', ...muted }}>{permit.cancelReason}</span>}</>
          : permit.closedLabel] : null,
      ]} />

      <PermitChecklist permit={permit} editable={canManage && requested} />

      {/* PRV-22 : consignations et isolations du permis. */}
      <PermitLockouts permit={permit} canManage={canManage} options={options} />

      {/* Actions reprises seulement (consultation) : la Prévention ne crée plus d'action QSE (15/10/2026). */}
      {(permit.actions.length > 0 || (permit.plan && permit.planActions > 0)) && (
        <div style={{ display: 'grid', gap: 6 }}>
          <SectionTitle>{t('Actions taken over from the action plan')}</SectionTitle>
          {permit.actions.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
              <Link href={actionHref(a.id)} className="vg-link" style={{ fontSize: 12.5 }}>{a.id}</Link>
              <span style={{ flex: 1, minWidth: 180 }}>{a.label}</span>
              <span style={muted}>{a.pilot} · {a.due}</span>
              <ToneTag tone={a.tone}>{a.statusLabel}</ToneTag>
            </div>
          ))}
          {permit.plan && permit.planActions > 0 && (
            <Link href={`/prevention?plan=${encodeURIComponent(permit.plan.id)}`} scroll={false} onClick={onLeave} className="vg-link" style={{ fontSize: 11.5, justifySelf: 'start' }}>
              {fill(permit.planActions > 1 ? t('{n} actions on the plan {id}') : t('1 action on the plan {id}'), { n: permit.planActions, id: permit.plan.id })}
            </Link>
          )}
        </div>
      )}

      <LinkedEvents events={permit.events} emptyLabel={t('No event linked to this permit.')}
        reportHref={canManage ? newEventHref('permis', permit.id) : null} />

      <ChangeLogList entries={permit.history} />

      <ErrorLine error={error} />
      {canManage && (
        <div className="dialog-actions" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          {requested && <button type="button" className="btn btn-secondary vg-btn-sm" onClick={onEdit}><Icon name="ph-pencil-simple" size={13} />{t('Edit')}</button>}
          {(requested || delivered) && (
            <button type="button" className="btn btn-secondary vg-btn-sm" onClick={onCancelPermit}>
              <Icon name="ph-prohibit" size={13} />{requested ? t('Cancel the request') : t('Cancel the permit')}
            </button>
          )}
          {delivered && (
            <ConfirmButton label={t('Close#verb')} confirmLabel={t('Yes, close')} question={closeQuestion} icon="ph-check-square" pending={pending}
              disabled={permit.state === 'delivre' || !!permit.closeBlock || !!permit.lockoutCloseBlock}
              tooltip={permit.state === 'delivre' ? t('The work has not started: cancel the permit if it does not take place.') : permit.closeBlock ?? permit.lockoutCloseBlock ?? undefined}
              className="btn btn-primary vg-btn-sm" onConfirm={() => run(() => closePermit(permit.id))} />
          )}
          {requested && (
            <ConfirmButton label={t('Issue')} confirmLabel={t('Issue')} question={t('Issue the permit under your responsibility?')} icon="ph-seal-check" pending={pending}
              disabled={!!deliverBlock} tooltip={deliverBlock ?? undefined} className="btn btn-primary vg-btn-sm" onConfirm={() => run(() => deliverPermit(permit.id))} />
          )}
        </div>
      )}
      {options.procedure && <div style={{ display: 'flex', justifyContent: 'flex-end' }}><ProcedureNote procedure={options.procedure} /></div>}
    </div>
  );
}

type Mode = 'view' | 'edit' | 'cancel';

/** Fiche d'un permis (check-list, délivrance, clôture, annulation avec motif). */
export function PermitDialog({ permit, open, onClose, options, canManage }: { permit: PermitView | null; open: boolean; onClose: () => void; options: PreventionOptions; canManage: boolean }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('view');
  const back = () => setMode('view');
  const close = () => { setMode('view'); onClose(); };
  const requested = permit?.status === 'demande';
  const kicker = !permit ? ''
    : mode === 'edit' ? fill(t('Edit the request {id}'), { id: permit.id })
      : mode === 'cancel' ? `${requested ? t('Cancel the request') : t('Cancel the permit')} ${permit.id}` : permit.typeLabel;
  return (
    <Dialog open={open && !!permit} onClose={close} width={680} kicker={kicker}
      title={permit ? `${permit.id} · ${permit.location}` : ''}>
      {permit && mode === 'edit' && <PermitForm permit={permit} options={options} onDone={back} onCancel={back} />}
      {permit && mode === 'cancel' && (
        <ReasonForm action={cancelPermit} hidden={{ id: permit.id }} submitLabel={requested ? t('Cancel the request') : t('Cancel the permit')} submitIcon="ph-prohibit"
          onDone={back} onCancel={back}
          placeholder={requested ? t('E.g. Welding moved to the welding booth: permit not needed') : t('E.g. Work stopped: intervention postponed')}
          message={requested ? t('The request stays readable in the “Cancelled” filter, with the reason.') : t('Work stopped or not taking place: the permit stays readable in the “Cancelled” filter, with the reason.')} />
      )}
      {permit && mode === 'view' && (
        <PermitSheet permit={permit} options={options} canManage={canManage} onEdit={() => setMode('edit')}
          onCancelPermit={() => setMode('cancel')} onLeave={close} />
      )}
    </Dialog>
  );
}

/** Bouton de l'alerte « entreprise extérieure sans plan signé » pour un permis : ouvrir la fiche (aucune action QSE, 15/10/2026). */
export function PermitAlertActions({ permit, options }: { permit: PermitView; options: PreventionOptions }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 6, flex: 'none', flexWrap: 'wrap' }}>
      <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setOpen(true)}><Icon name={permit.icon} size={13} />{t('Open the permit')}</button>
      <PermitDialog permit={permit} open={open} onClose={() => setOpen(false)} options={options} canManage />
    </div>
  );
}

// ─── Bouton et tableau ──────────────────────────────────────────────────────

/** « Nouveau permis » : la demande créée s'ouvre pour la vérification de la check-list et la délivrance. */
export function NewPermitButton({ options }: { options: PreventionOptions }) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <DialogButton label={t('New permit')} icon="ph-plus" className="btn btn-primary vg-btn-sm" title={t('New permit')} kicker={t('Fire permit · test permit')} width={680}>
      {(close) => (
        <PermitForm options={options} onCancel={close} onDone={(id) => {
          close();
          if (id) router.push(`/prevention?onglet=permis&permis=${id}`, { scroll: false });
        }} />
      )}
    </DialogButton>
  );
}

/** Tableau des permis ; un clic ouvre la fiche. */
export function PermitsTable({ permits, options, canManage, openId, emptyLabel }: { permits: PermitView[]; options: PreventionOptions; canManage: boolean; openId?: string; emptyLabel: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [selId, setSelId] = useState<string | null>(openId ?? null);
  const sel = permits.find((p) => p.id === selId) ?? null;
  const close = () => { setSelId(null); dropUrlParam((href, o) => router.replace(href, o), 'permis'); };

  return (
    <>
      <div className="card" style={{ padding: '6px 14px 10px' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 12.5, minWidth: 1160 }}>
            <thead>
              <tr><th>{t('Ref.')}</th><th>{t('Type')}</th><th>{t('Location')}</th><th>{t('Work')}</th><th>{t('Worker')}</th><th>{t('Prevention plan')}</th><th>{t('Validity')}</th><th>{t('Watch until')}</th><th>{t('Checklist')}</th><th>{t('Status')}</th></tr>
            </thead>
            <tbody>
              {permits.length === 0 && <tr><td colSpan={10} style={{ ...muted, fontSize: 12, padding: '14px 8px' }}>{emptyLabel}</td></tr>}
              {permits.map((p) => {
                const done = p.checklist.filter((c) => c.checked).length;
                return (
                  <tr key={p.id} {...rowOpener(() => setSelId(p.id))}>
                    <td style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{p.id}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Icon name={p.icon} size={14} style={{ color: p.type === 'feu' ? 'var(--tone-warn-dot)' : 'var(--color-accent)' }} />{PERMIT_TYPES[p.type].short}
                      </span>
                    </td>
                    <td style={{ color: 'var(--color-neutral-400)', minWidth: 150, maxWidth: 220, textWrap: 'pretty' }}>{p.location}</td>
                    <td style={{ minWidth: 220, maxWidth: 320, textWrap: 'pretty' }}>{p.description}</td>
                    <td style={{ minWidth: 150 }}>
                      <span style={{ display: 'block' }}>{p.contractor ?? t('Internal')}</span>
                      <span style={{ display: 'block', ...muted }}>{p.performer}</span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }} title={p.planIssue ?? undefined}>
                      {p.plan
                        ? <><span style={{ display: 'block', color: 'var(--color-neutral-300)' }}>{p.plan.id}</span><span style={{ display: 'block', fontSize: 11, color: p.plan.signed ? 'var(--color-neutral-500)' : 'var(--tone-warn-fg)' }}>{p.plan.signed ? t('signed') : t('not signed')}</span></>
                        : p.contractorId
                          ? <span style={{ color: p.planRequired ? 'var(--tone-danger-fg)' : 'var(--color-neutral-500)' }}>{t('None')}</span>
                          : <span style={muted}>—</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{p.validity}</td>
                    <td style={{ whiteSpace: 'nowrap', color: p.watching ? 'var(--tone-warn-fg)' : 'var(--color-neutral-300)' }}>{p.watchLabel ?? <span style={muted}>—</span>}</td>
                    <td style={{ whiteSpace: 'nowrap', color: p.allChecked ? 'var(--color-neutral-300)' : 'var(--tone-warn-fg)' }}>{done}/{p.checklist.length}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <ToneTag tone={p.tone}>{p.stateLabel}{p.watching ? t(' · watch') : ''}</ToneTag>
                      {p.planGap && (
                        <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--tone-danger-fg)' }}
                          title={p.planGapWith ? fill(t('Same intervention as the plan {id}, in gap: counted only once.'), { id: p.planGapWith }) : undefined}>
                          {p.planGapWith ? fill(t('Gap · counted with {id}'), { id: p.planGapWith }) : t('Gap · without a signed plan')}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <PermitDialog permit={sel} open={!!sel} onClose={close} options={options} canManage={canManage} />
    </>
  );
}
