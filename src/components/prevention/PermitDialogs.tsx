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
  FIRE_WATCH_HOURS, PERMIT_TYPES, PERMIT_TYPE_KEYS, addHoursLocal, fmtLocalLong, lcfirst, missingPresets, permitNeedsSignedPlan, planCovers, ruleBasis,
  type ChecklistItem, type PermitType,
} from '@/lib/rules/prevention';
import {
  ConfirmButton, ErrorLine, Facts, LinkedEvents, Notice, ProcedureNote, SITE_LOCK_HINT, SectionTitle,
  contractorChoices, contractorHref, dropUrlParam, muted, rowOpener, ruleOf, useRun, type PreventionOptions,
} from './parts';
import { withCurrent } from '@/lib/form-options';

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

const planLabel = (p: PlanChoice, withContractor: boolean) =>
  `${p.id} · ${withContractor ? `${p.contractor} — ` : ''}${p.title} · ${p.period} · ${p.signed ? 'signé' : 'non signé'}`;

const contractorName = (options: PreventionOptions, id: string) => options.contractors.find(([v]) => v === id)?.[1].split(' — ')[0] ?? id;

// ─── Formulaire ─────────────────────────────────────────────────────────────

function PermitForm({ permit, options, onDone, onCancel }: { permit?: PermitView; options: PreventionOptions; onDone: (id?: string) => void; onCancel: () => void }) {
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
  const projects = withCurrent(options.projects, permit?.keystoneProject, null, 'start');

  // Plan de prévention : plans de l'entreprise couvrant la validité, selon la règle du site.
  const rule = ruleOf(options, siteId);
  const firstMinute = !!rule?.ppFromFirstMinute;
  // Plan signé exigé pour délivrer : entreprise extérieure sur un site « dès la première minute », ou permis de feu d'une entreprise extérieure.
  const planRequired = permitNeedsSignedPlan({ type, contractorId: contractorId || null }, rule);
  const requiredWhy = firstMinute ? `${lcfirst(ruleBasis(rule))}, plan dès la première minute` : 'permis de feu : travaux dangereux, arrêté du 19 mars 1993';
  const fromDay = validFrom.slice(0, 10), toDay = validTo.slice(0, 10);
  const candidates = planCandidates(options.plans, siteId, contractorId, fromDay, toDay);
  const selected = options.plans.find((p) => p.id === planId);
  const stale = !!planId && !candidates.some((p) => p.id === planId);
  const planOptions = [
    ...(stale ? [[planId, `${selected ? planLabel(selected, !contractorId) : planId} — ne convient pas`] as const] : []),
    ...candidates.map((p) => [p.id, planLabel(p, !contractorId)] as const),
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

  const switchType = (t: PermitType) => {
    setType(t);
    setItems(preset(t));
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
    <ActionForm action={savePermit} onDone={(s) => onDone(s.id)} onCancel={onCancel} submitLabel={permit ? 'Enregistrer' : 'Enregistrer la demande'} hidden={{ id: permit?.id, version: permit?.version }}>
      <Field name="type" label="Type de permis">
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
        <Field name="siteId" label="Site" hint={options.siteLocked ? SITE_LOCK_HINT : undefined}>
          <Select name="siteId" options={options.recordSites} value={siteId} onChange={(e) => { setSiteId(e.target.value); repick({ site: e.target.value }); }} />
        </Field>
        <Field name="location" label="Lieu">
          <Input name="location" defaultValue={permit?.location} placeholder={type === 'feu' ? 'Ex. Atelier montage · poste M3' : "Ex. Zone d'essais · banc BE-1 (zone ATEX 2)"} />
        </Field>
      </FormRow>
      <Field name="description" label="Travaux">
        <Input name="description" defaultValue={permit?.description}
          placeholder={type === 'feu' ? 'Ex. Soudure de reprise sur le bâti du poste de retournement' : "Ex. Essais d'endurance avec produit inerte simulant l'émulsion"} />
      </Field>
      <FormRow>
        <Field name="contractorId" label="Entreprise" hint="Laisser vide pour une intervention du personnel interne.">
          <Select name="contractorId" options={contractorChoices(options, permit && { id: permit.contractorId, name: permit.contractor })} value={contractorId} placeholder="Intervention interne"
            onChange={(e) => { setContractorId(e.target.value); repick({ contractor: e.target.value }); }} />
        </Field>
        <Field name="performer" label="Intervenant(s)">
          <Input name="performer" defaultValue={permit?.performer} placeholder="Ex. [T. Nguyen]" />
        </Field>
      </FormRow>
      <FormRow cols={type === 'feu' ? 3 : 2}>
        <Field name="validFrom" label="Valide du">
          <Input name="validFrom" type="datetime-local" value={validFrom} onChange={(e) => { setValidFrom(e.target.value); repick({ from: e.target.value }); }} />
        </Field>
        <Field name="validTo" label="Au (fin des travaux)">
          <Input name="validTo" type="datetime-local" value={validTo} onChange={(e) => changeValidTo(e.target.value)} />
        </Field>
        {type === 'feu' && (
          <Field name="watchUntil" label="Surveillance jusqu'à" hint={`${FIRE_WATCH_HOURS} h après la fin des travaux.`}>
            <Input name="watchUntil" type="datetime-local" value={watch} onChange={(e) => { setWatch(e.target.value); setWatchTouched(true); }} />
          </Field>
        )}
      </FormRow>

      <FormRow>
        <Field name="preventionPlanId" label="Plan de prévention"
          hint={firstMinute ? 'Entreprise extérieure : plan signé couvrant la validité exigé pour délivrer.'
            : type === 'feu' ? 'Permis de feu d\'une entreprise extérieure : plan signé couvrant la validité exigé pour délivrer.'
              : 'Pour une entreprise extérieure : la délivrance exige le plan obligatoire signé.'}>
          <Select name="preventionPlanId" options={planOptions} value={planId} onChange={(e) => choosePlan(e.target.value)}
            placeholder={contractorId && !candidates.length ? 'Aucun plan couvrant ces dates' : 'Aucun'} />
        </Field>
        <Field name="keystoneProject" label="Projet Keystone">
          <Select name="keystoneProject" options={projects} defaultValue={permit?.keystoneProject ?? ''} placeholder="Aucun projet" />
        </Field>
      </FormRow>
      {stale && (
        <Notice tone="danger">
          Le plan {planId} ne convient pas à ce permis (clos, autre site ou autre entreprise, ou période ne couvrant pas la validité) : choisissez un plan couvrant les dates du permis.
        </Notice>
      )}
      {!stale && contractorId && !candidates.length && (
        planRequired
          ? (
            <Notice tone="danger">
              Aucun plan de prévention de {who} ne couvre ces dates sur ce site : le permis ne pourra pas être délivré sans plan signé couvrant sa validité ({requiredWhy}). Créez le plan dans l&apos;onglet « Plans de prévention ».
              {firstMinute && ' La demande est comptée comme un écart tant que ce plan n\'est pas signé.'}
            </Notice>
          )
          : <Notice tone="neutral" icon="ph-info">Aucun plan de prévention de {who} ne couvre ces dates sur ce site : rattachez-en un si le plan écrit est obligatoire (R. 4512-7 : 400 h sur 12 mois ou travaux dangereux).</Notice>
      )}
      {!stale && planRequired && !planId && candidates.length > 0 && (
        <Notice tone="warn">Rattachez le plan de prévention de {who} couvrant ces dates : la délivrance est impossible sans plan signé ({requiredWhy}).</Notice>
      )}
      {!stale && selected && (selected.mandatory || planRequired) && !selected.signed && (
        <Notice tone="warn" icon="ph-pen-nib">
          Le plan {selected.id} n&apos;est pas encore signé par les deux entreprises : la délivrance restera bloquée jusqu&apos;aux signatures{firstMinute ? ', et la demande comptée comme un écart' : ''}.
        </Notice>
      )}

      <Field name="checklist" label={<>Vérifications préalables <span style={{ color: 'var(--color-neutral-500)' }}>· {checkedCount}/{items.length}</span></>}
        hint="Tous les points doivent être vérifiés pour délivrer le permis.">
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
                <button type="button" className="btn btn-ghost btn-icon" aria-label={`Retirer « ${item.label} »`} style={{ width: 24, height: 24, color: 'var(--color-neutral-500)' }}
                  onClick={() => setItems(items.filter((_, j) => j !== i))}>
                  <Icon name="ph-x" size={12} />
                </button>
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
            <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ajouter un point de contrôle propre à l'intervention…" maxLength={200}
              aria-label="Nouveau point de contrôle" style={{ fontSize: 12.5 }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }} />
            <button type="button" className="btn btn-secondary vg-btn-sm" disabled={!draft.trim()} onClick={addItem}><Icon name="ph-plus" size={13} />Ajouter</button>
          </div>
        </div>
      </Field>
    </ActionForm>
  );
}

// ─── Fiche ──────────────────────────────────────────────────────────────────

function PermitChecklist({ permit, editable }: { permit: PermitView; editable: boolean }) {
  const [items, setItem] = useOptimistic(permit.checklist, (cur: ChecklistItem[], [i, v]: [number, boolean]) => cur.map((c, j) => (j === i ? { ...c, checked: v } : c)));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const done = items.filter((i) => i.checked).length;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <SectionTitle aside={<span style={{ ...muted, display: 'inline-flex', gap: 8, alignItems: 'center' }}><SaveStatus pending={pending} />{done}/{items.length} vérifiés</span>}>Vérifications préalables</SectionTitle>
      <div className="vg-inset" style={{ display: 'grid', gap: 7, padding: '10px 12px' }}>
        {items.length === 0 && <span style={muted}>Aucun point de contrôle.</span>}
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
        Aucun autre plan {delivered ? 'signé ' : ''}de {permit.contractor ?? "l'entreprise"} ne couvre la validité du permis : {delivered ? 'recueillez les signatures du plan' : "établissez-le dans l'onglet « Plans de prévention »"}{delivered ? ', ou annulez le permis si les travaux sont arrêtés' : ''}.
      </span>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="input" value={planId} onChange={(e) => setPlanId(e.target.value)} aria-label="Plan de prévention à rattacher"
          style={{ flex: 1, minWidth: 220, fontSize: 12.5, padding: '5px 8px' }}>
          {list.map((p) => <option key={p.id} value={p.id}>{planLabel(p, false)}</option>)}
        </select>
        <button type="button" className="btn btn-secondary vg-btn-sm" disabled={pending || !planId} onClick={() => run(() => linkPermitPlan(permit.id, planId))}>
          <Icon name="ph-link" size={13} />Rattacher le plan
        </button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

function PermitSheet({ permit, options, canManage, onEdit, onCancelPermit, onLeave }: {
  permit: PermitView; options: PreventionOptions; canManage: boolean; onEdit: () => void; onCancelPermit: () => void; onLeave: () => void;
}) {
  const { pending, error, run } = useRun();
  const requested = permit.status === 'demande';
  const delivered = permit.status === 'delivre';
  const ended = permit.status === 'clos' || permit.status === 'annule';
  const expired = permit.state === 'expire';
  const deliverBlock = !permit.allChecked ? 'Tous les points de la check-list doivent être vérifiés.'
    : permit.planBlocker ? permit.planBlocker
      : expired ? 'La période de validité est dépassée.' : null;
  const closeQuestion = permit.type === 'feu' ? 'Surveillance de 2 h après la fin des travaux assurée ?' : 'Essais terminés et zone remise en sécurité ?';

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <ToneTag tone={permit.tone}>{permit.stateLabel}{permit.watching ? ' · surveillance' : ''}</ToneTag>
        <span className="tag tag-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name={permit.icon} size={12} />{permit.typeLabel}</span>
        {permit.planGap && <ToneTag tone="danger">{permit.status === 'demande' ? 'Demande' : 'Entreprise extérieure'} sans plan signé · écart</ToneTag>}
        {permit.planGapWith && <span style={muted}>compté avec le plan {permit.planGapWith}, en écart</span>}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {/* Fiche à afficher sur le lieu des travaux : lien HTML simple (nouvel onglet), la feuille d'impression ne reste pas chargée. */}
          <a href={`/prevention/imprimer/permis/${encodeURIComponent(permit.id)}`} target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm">
            <Icon name="ph-printer" size={13} />Imprimer
          </a>
          {!ended && (
            <Link href={`/prevention/carte?permis=${encodeURIComponent(permit.id)}`} className="btn btn-ghost vg-btn-sm">
              <Icon name="ph-map-trifold" size={13} />Voir sur la carte
            </Link>
          )}
        </span>
      </div>

      {expired && delivered && <Notice tone="danger">Validité dépassée sans clôture : vérifiez la fin des travaux{permit.type === 'feu' ? ' et la ronde de surveillance' : ' et la remise en sécurité de la zone'}, puis clôturez le permis.</Notice>}
      {expired && requested && <Notice tone="danger">Permis jamais délivré et période de validité échue : modifiez les dates ou annulez la demande.</Notice>}
      {permit.planIssue && (permit.planGap || permit.planBlocker) && (
        <Notice tone="danger">
          <div style={{ display: 'grid', gap: 6 }}>
            <span>
              {permit.planGap && <strong style={{ fontWeight: 500 }}>Intervention d&apos;une entreprise extérieure sans plan de prévention signé. </strong>}
              {permit.planIssue}{' '}
              {requested
                ? (permit.ruleReason ? `Délivrance impossible (${lcfirst(permit.ruleReason)}).` : "Délivrance impossible tant que le plan n'est pas en règle.")
                : permit.ruleReason ? `${permit.ruleReason}.` : ''}
            </span>
            {permit.plan && permit.planIssueKind === 'unsigned' && (
              <Link href={`/prevention?plan=${encodeURIComponent(permit.plan.id)}`} scroll={false} onClick={onLeave} className="vg-link" style={{ justifySelf: 'start' }}>
                Ouvrir le plan {permit.plan.id} pour recueillir les signatures
              </Link>
            )}
            {canManage && permit.contractorId && <PermitPlanLink key={permit.preventionPlanId ?? 'aucun'} permit={permit} options={options} />}
          </div>
        </Notice>
      )}
      {permit.watching && <Notice tone="warn" icon="ph-eye">Travaux terminés : surveillance du lieu jusqu&apos;à {permit.watchLabel}.</Notice>}

      <Facts items={[
        ['Travaux', permit.description],
        ['Lieu', permit.location],
        ['Site', permit.site],
        ['Entreprise', permit.contractorId && permit.contractor
          ? <Link href={contractorHref(permit.contractorId)} className="vg-link" style={{ fontSize: 12.5 }}>{permit.contractor}</Link>
          : permit.contractor ?? 'Intervention interne'],
        ['Intervenant(s)', permit.performer],
        ['Plan de prévention', permit.plan
          ? <>{permit.plan.id}<span style={{ display: 'block', ...muted, color: permit.plan.signed ? 'var(--color-neutral-500)' : 'var(--tone-warn-fg)' }}>{permit.plan.signed ? 'Signé' : 'Non signé'} · {permit.plan.period}</span></>
          : permit.planRequired ? <span style={{ color: 'var(--tone-danger-fg)' }}>Aucun</span> : '—'],
        ['Projet Keystone', permit.keystoneProject ?? '—'],
        ['Valide du', fmtLocalLong(permit.validFrom)],
        ['Au', fmtLocalLong(permit.validTo)],
        permit.watchUntil ? ["Surveillance jusqu'à", fmtLocalLong(permit.watchUntil)] : null,
        ['Délivré par', permit.issuer ?? (requested ? 'Non délivré' : '—')],
        permit.closedLabel ? [permit.status === 'annule' ? 'Annulé le' : 'Clos le', permit.status === 'annule'
          ? <>{permit.closedLabel}{permit.cancelledBy ? ` par ${permit.cancelledBy}` : ''}{permit.cancelReason && <span style={{ display: 'block', ...muted }}>{permit.cancelReason}</span>}</>
          : permit.closedLabel] : null,
      ]} />

      <PermitChecklist permit={permit} editable={canManage && requested} />

      {/* Actions reprises seulement (consultation) : la Prévention ne crée plus d'action QSE (15/10/2026). */}
      {(permit.actions.length > 0 || (permit.plan && permit.planActions > 0)) && (
        <div style={{ display: 'grid', gap: 6 }}>
          <SectionTitle>Actions reprises du plan d&apos;actions</SectionTitle>
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
              {permit.planActions > 1 ? `${permit.planActions} actions` : '1 action'} sur le plan {permit.plan.id}
            </Link>
          )}
        </div>
      )}

      <LinkedEvents events={permit.events} emptyLabel="Aucun événement rattaché à ce permis."
        reportHref={canManage ? newEventHref('permis', permit.id) : null} />

      <ChangeLogList entries={permit.history} />

      <ErrorLine error={error} />
      {canManage && (
        <div className="dialog-actions" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          {requested && <button type="button" className="btn btn-secondary vg-btn-sm" onClick={onEdit}><Icon name="ph-pencil-simple" size={13} />Modifier</button>}
          {(requested || delivered) && (
            <button type="button" className="btn btn-secondary vg-btn-sm" onClick={onCancelPermit}>
              <Icon name="ph-prohibit" size={13} />{requested ? 'Annuler la demande' : 'Annuler le permis'}
            </button>
          )}
          {delivered && (
            <ConfirmButton label="Clore" confirmLabel="Oui, clore" question={closeQuestion} icon="ph-check-square" pending={pending}
              disabled={permit.state === 'delivre'} tooltip={permit.state === 'delivre' ? "Les travaux n'ont pas commencé : annulez le permis s'ils n'ont pas lieu." : undefined}
              className="btn btn-primary vg-btn-sm" onConfirm={() => run(() => closePermit(permit.id))} />
          )}
          {requested && (
            <ConfirmButton label="Délivrer" confirmLabel="Délivrer" question="Délivrer le permis sous votre responsabilité ?" icon="ph-seal-check" pending={pending}
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
  const [mode, setMode] = useState<Mode>('view');
  const back = () => setMode('view');
  const close = () => { setMode('view'); onClose(); };
  const requested = permit?.status === 'demande';
  const kicker = !permit ? ''
    : mode === 'edit' ? `Modifier la demande ${permit.id}`
      : mode === 'cancel' ? `${requested ? 'Annuler la demande' : 'Annuler le permis'} ${permit.id}` : permit.typeLabel;
  return (
    <Dialog open={open && !!permit} onClose={close} width={680} kicker={kicker}
      title={permit ? `${permit.id} · ${permit.location}` : ''}>
      {permit && mode === 'edit' && <PermitForm permit={permit} options={options} onDone={back} onCancel={back} />}
      {permit && mode === 'cancel' && (
        <ReasonForm action={cancelPermit} hidden={{ id: permit.id }} submitLabel={requested ? 'Annuler la demande' : 'Annuler le permis'} submitIcon="ph-prohibit"
          onDone={back} onCancel={back}
          placeholder={requested ? 'Ex. Soudure reportée en cabine de soudage : permis inutile' : 'Ex. Travaux arrêtés : intervention reportée'}
          message={requested ? 'La demande reste consultable dans le filtre « Annulés », avec le motif.' : 'Travaux arrêtés ou n’ayant pas lieu : le permis reste consultable dans le filtre « Annulés », avec le motif.'} />
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
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 6, flex: 'none', flexWrap: 'wrap' }}>
      <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setOpen(true)}><Icon name={permit.icon} size={13} />Ouvrir le permis</button>
      <PermitDialog permit={permit} open={open} onClose={() => setOpen(false)} options={options} canManage />
    </div>
  );
}

// ─── Bouton et tableau ──────────────────────────────────────────────────────

/** « Nouveau permis » : la demande créée s'ouvre pour la vérification de la check-list et la délivrance. */
export function NewPermitButton({ options }: { options: PreventionOptions }) {
  const router = useRouter();
  return (
    <DialogButton label="Nouveau permis" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Nouveau permis" kicker="Permis de feu · permis d'essai" width={680}>
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
              <tr><th>Réf.</th><th>Type</th><th>Lieu</th><th>Travaux</th><th>Intervenant</th><th>Plan de prévention</th><th>Validité</th><th>Surveillance jusqu&apos;à</th><th>Check-list</th><th>Statut</th></tr>
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
                      <span style={{ display: 'block' }}>{p.contractor ?? 'Interne'}</span>
                      <span style={{ display: 'block', ...muted }}>{p.performer}</span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }} title={p.planIssue ?? undefined}>
                      {p.plan
                        ? <><span style={{ display: 'block', color: 'var(--color-neutral-300)' }}>{p.plan.id}</span><span style={{ display: 'block', fontSize: 11, color: p.plan.signed ? 'var(--color-neutral-500)' : 'var(--tone-warn-fg)' }}>{p.plan.signed ? 'signé' : 'non signé'}</span></>
                        : p.contractorId
                          ? <span style={{ color: p.planRequired ? 'var(--tone-danger-fg)' : 'var(--color-neutral-500)' }}>Aucun</span>
                          : <span style={muted}>—</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{p.validity}</td>
                    <td style={{ whiteSpace: 'nowrap', color: p.watching ? 'var(--tone-warn-fg)' : 'var(--color-neutral-300)' }}>{p.watchLabel ?? <span style={muted}>—</span>}</td>
                    <td style={{ whiteSpace: 'nowrap', color: p.allChecked ? 'var(--color-neutral-300)' : 'var(--tone-warn-fg)' }}>{done}/{p.checklist.length}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <ToneTag tone={p.tone}>{p.stateLabel}{p.watching ? ' · surveillance' : ''}</ToneTag>
                      {p.planGap && (
                        <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--tone-danger-fg)' }}
                          title={p.planGapWith ? `Même intervention que le plan ${p.planGapWith}, en écart : comptée une seule fois.` : undefined}>
                          {p.planGapWith ? `Écart · compté avec ${p.planGapWith}` : 'Écart · sans plan signé'}
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
