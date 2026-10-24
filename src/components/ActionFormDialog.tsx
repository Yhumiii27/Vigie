'use client';

// Formulaire d'une action QSE (docs/specs/actions-qse.md § 4, § 12, § 13 ; plan du paquet 1, flux B) : création par le
// service QHSE (plan, écrans sources) et modification depuis la fiche. Champs dans l'ordre du formulaire Power Apps.
// Le serveur (saveAction, src/server/plan.ts) applique les règles ; ce formulaire ne fait que proposer : source et
// élément imposés par l'écran, éléments du plan filtrés par la source (D20), site proposé d'après l'élément (§ 13),
// avertissement d'une vérification planifiée avant la date cible calculé avec la date du jour du serveur.

import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  AT_HEALTH_WARNING, DOMAIN_OPTIONS, PRIORITY_OPTIONS, RISK_LEVEL_OPTIONS, creationSourceChoices, defaultSiteId,
  initialSource, linkStillAdmitted, lockedSource, numberField, planningWarnings, sourceHasElement, sourceHint, sourceOptions, targetChoices,
  targetSiteId,
} from '@/components/actions/detail/form-helpers';
import { DialogButton } from '@/components/Dialog';
import { mentionsInjury } from '@/components/events/shared';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { NON_QSE_LINK_MESSAGE } from '@/lib/action-rules';
import type { ActionDefaults, ActionFormOptions } from '@/lib/action-view';
import { fmtDate } from '@/lib/dates';
import { ACTION_SOURCES, ACTION_TEXT_MAX, AVANCEMENT, ORIGIN_REF_MAX, isAvancement } from '@/lib/domain';
import { ARCHIVED_SITE_SUFFIX, LEFT_SUFFIX, withCurrent } from '@/lib/form-options';
import type { FormState } from '@/lib/forms';
import { saveAction } from '@/server/plan';

export type { ActionDefaults } from '@/lib/action-view';

const NO_ELEMENT = '— Aucun : référence d’origine —';

/** Champ en lecture seule (date d'ouverture, avancement, source verrouillée, élément imposé). */
function ReadOnly({ id, value }: { id: string; value: ReactNode }) {
  return <div id={id} className="input vg-readonly" aria-readonly>{value}</div>;
}

/** Avertissement « aucune donnée de santé » : élément AT (§ 4), plus le texte qui semble décrire une lésion. */
function HealthWarning({ texts }: { texts: string[] }) {
  const injury = texts.some((t) => mentionsInjury(t));
  return (
    <div role="note" className="vg-warn-note">
      <i className="ph ph-first-aid" aria-hidden />
      <span>
        {AT_HEALTH_WARNING}
        {injury && <strong style={{ display: 'block', fontWeight: 500 }}>Ce texte semble décrire une lésion ou des soins : retirez-les, ils restent dans la fiche de l’accident (champs réservés).</strong>}
      </span>
    </div>
  );
}

/**
 * Champs du formulaire d'action (création, QHSE seulement ; modification), ordre du formulaire Power Apps (§ 4).
 * `legacyOriginLabel` : origine Vigie d'avant la reprise, rappelée sous une source « à compléter » (modification).
 * `onDone` reçoit la réponse du serveur (avertissements non bloquants) ; un appelant `() => void` reste admis.
 */
export function ActionFields({ options, defaults = {}, onDone, onCancel, legacyOriginLabel }: {
  options: ActionFormOptions; defaults?: ActionDefaults; onDone: (state: FormState) => void; onCancel?: () => void; legacyOriginLabel?: string | null;
}) {
  const editing = !!defaults.id;
  const status = defaults.status && isAvancement(defaults.status) ? defaults.status : 'a_faire';
  const openedOn = defaults.openedOn ?? options.today;

  // Source : imposée par l'écran (création), choisie, ou fixée (modification d'une action dont la source est posée).
  // Élément imposé sans indication de l'écran : sources que son type admet, jamais une source libre (D20 révisée).
  const sourceChoices = editing ? defaults.sourceChoices : creationSourceChoices(defaults);
  const choiceDefaults = { ...defaults, sourceChoices };
  const nonQse = !editing && !!defaults.link && sourceChoices?.length === 0;
  const locked = editing ? null : lockedSource(choiceDefaults);
  const sourceFixed = editing && defaults.source != null;
  const [source, setSource] = useState<string>(locked ?? (editing ? defaults.source ?? '' : initialSource(choiceDefaults)));

  // Élément : imposé par l'écran (champ caché), ou choisi dans le sélecteur du plan (filtré par la source, D20).
  const imposedLink = !editing && defaults.link ? defaults.link : null;
  const picker = !editing && !imposedLink && !!options.targets && sourceHasElement(source);
  const [link, setLink] = useState('');
  const choices = picker ? targetChoices(options.targets, source) : [];
  const pickedTarget = link ? options.targets?.find((t) => t.value === link) : undefined;
  const hasElement = !!imposedLink || !!pickedTarget;

  // Listes : la personne et le site encore portés par l'action restent des choix, signalés (withCurrent).
  const people = editing ? withCurrent(options.people, defaults.pilotId, `${defaults.pilotName ?? defaults.pilotId}${LEFT_SUFFIX}`) : options.people;
  // « Tous les sites » n'est jamais un choix : une action porte un seul site (§ 13).
  const writable = options.sites.filter(([v]) => v !== 'all');
  const sites = editing && defaults.siteId ? withCurrent(writable, defaults.siteId, `${defaults.siteId}${ARCHIVED_SITE_SUFFIX}`) : writable;
  const [siteId, setSiteId] = useState(editing ? defaults.siteId ?? '' : defaultSiteId(sites, { siteId: defaults.siteId }));

  const [dueOn, setDueOn] = useState(defaults.dueOn ?? '');
  const [verifyDueOn, setVerifyDueOn] = useState(defaults.verifyDueOn ?? '');
  const [texts, setTexts] = useState({ problem: defaults.problem ?? '', detail: defaults.detail ?? '' });
  const health = !!defaults.healthWarning || !!pickedTarget?.healthWarning;
  const warnings = planningWarnings({ openedOn, dueOn, verifyDueOn }, options.today);

  const verifyLocked = editing && status === 'verifiee';
  const showDone = editing && (status === 'terminee' || status === 'verifiee');
  const showVerification = editing && status === 'verifiee';

  const changeSource = (next: string) => {
    setSource(next);
    if (!linkStillAdmitted(options.targets, next, link)) setLink('');
  };
  const changeLink = (next: string) => {
    setLink(next);
    // Site proposé : celui de l'élément (§ 13), encore modifiable ; le serveur refuse un site différent de l'élément.
    const elementSite = targetSiteId(options.targets, next);
    if (elementSite) setSiteId(defaultSiteId(sites, { elementSiteId: elementSite, siteId }));
  };

  const sourceLabel = (k: string | null | undefined) => (k && k in ACTION_SOURCES ? ACTION_SOURCES[k as keyof typeof ACTION_SOURCES].label : k ?? '');
  const originHint = hasElement
    ? 'Facultative : par défaut, la référence de l’élément lié.'
    : sourceHasElement(source) && picker ? 'Obligatoire sans élément lié (ex. courrier, rapport, n° d’étude).' : 'Obligatoire : courrier, compte rendu, n° d’étude…';

  return (
    <ActionForm action={saveAction} onDone={onDone} onCancel={onCancel} submitLabel={editing ? 'Enregistrer' : 'Créer l’action'}
      submitIcon={editing ? undefined : 'ph-list-plus'}
      hidden={{
        id: defaults.id,
        from: editing ? status : undefined,
        version: editing ? defaults.version : undefined,
        link: imposedLink ?? undefined,
        source: locked ?? undefined,
        // Référence d'origine fixée à la création : renvoyée telle quelle (affichée en lecture seule).
        originRef: editing ? defaults.originRef ?? '' : undefined,
      }}>
      {nonQse && <div role="alert" className="vg-warn-note"><i className="ph ph-warning" aria-hidden /><span>{NON_QSE_LINK_MESSAGE}</span></div>}
      {health && <HealthWarning texts={[texts.problem, texts.detail]} />}

      <FormRow>
        <Field name="openedOn" label="Date d’ouverture" hint={editing ? undefined : 'Date du jour, posée par Vigie.'}>
          <ReadOnly id="openedOn" value={fmtDate(openedOn)} />
        </Field>
        <Field name="pilotId" label="Responsable" hint={editing && defaults.pilotId && !options.people.some(([v]) => v === defaults.pilotId) ? 'Sorti de l’effectif : désignez un nouveau responsable.' : undefined}>
          <Select name="pilotId" options={people} defaultValue={defaults.pilotId ?? ''} placeholder="Choisir…" required />
        </Field>
      </FormRow>

      <FormRow>
        <Field name="status" label="Avancement" hint={editing ? 'Se change par « Changer l’avancement ».' : undefined}>
          <ReadOnly id="status" value={AVANCEMENT[status].label} />
        </Field>
        <Field name="priority" label="Priorité">
          <Select name="priority" options={PRIORITY_OPTIONS} defaultValue={defaults.priority ?? ''} placeholder="Choisir…" required />
        </Field>
      </FormRow>

      <FormRow>
        <Field name="dueOn" label="Date cible" hint={editing ? undefined : 'Pas avant aujourd’hui.'}>
          <Input name="dueOn" type="date" value={dueOn} min={editing ? undefined : options.today} onChange={(e) => setDueOn(e.target.value)} required />
        </Field>
        {showDone ? (
          <Field name="doneOn" label="Date effective">
            <Input name="doneOn" type="date" defaultValue={defaults.doneOn ?? ''} min={openedOn} max={options.today} required />
          </Field>
        ) : <div />}
      </FormRow>

      <Field name="source" label="Source" hint={
        sourceFixed ? 'Fixée à la création (ACT-01) : elle ne se modifie pas.'
          : editing ? `À compléter (reprise).${legacyOriginLabel ? ` Origine Vigie avant reprise : ${legacyOriginLabel}.` : ''}${sourceHint(source) ? ` ${sourceHint(source)}` : ''}`
            : locked ? 'Imposée par l’élément lié.' : sourceHint(source)
      }>
        {sourceFixed || locked
          ? <ReadOnly id="source" value={sourceLabel(sourceFixed ? defaults.source : locked)} />
          : <Select name="source" options={sourceOptions(sourceChoices)} value={source} placeholder="Choisir…" required
              onChange={(e) => changeSource(e.target.value)} />}
      </Field>
      {(sourceFixed || locked) && sourceHint(sourceFixed ? defaults.source : locked) && (
        <span className="vg-field-hint" style={{ marginTop: -6 }}>{sourceHint(sourceFixed ? defaults.source : locked)}</span>
      )}

      {imposedLink && (
        <Field name="link" label="Élément lié" hint="Imposé par l’écran : il ne se modifie pas ensuite.">
          <ReadOnly id="link" value={defaults.linkLabel ?? imposedLink} />
        </Field>
      )}
      {picker && (
        <Field name="link" label="Élément lié" hint={choices.length ? 'Fixé à la création ; propose le site de l’élément.' : 'Aucun élément ouvert aux actions pour cette source.'}>
          <Select name="link" options={choices.map((t) => [t.value, t.label] as const)} value={link} placeholder={NO_ELEMENT}
            onChange={(e) => changeLink(e.target.value)} />
        </Field>
      )}

      <Field name="originRef" label="Référence d’origine" hint={editing ? 'Fixée à la création.' : originHint}>
        {editing
          ? <ReadOnly id="originRef" value={defaults.originRef || '—'} />
          : <Input name="originRef" defaultValue={defaults.originRef ?? ''} maxLength={ORIGIN_REF_MAX} required={!hasElement} />}
      </Field>

      <FormRow>
        <Field name="domain" label="Domaine">
          <Select name="domain" options={DOMAIN_OPTIONS} defaultValue={defaults.domain ?? ''} placeholder="Choisir…" required />
        </Field>
        <Field name="riskLevel" label="Niveau de risque" hint="Facultatif.">
          <Select name="riskLevel" options={RISK_LEVEL_OPTIONS} defaultValue={defaults.riskLevel == null ? '' : String(defaults.riskLevel)} placeholder="—" />
        </Field>
      </FormRow>

      <Field name="problem" label="Description du problème">
        <TextArea name="problem" rows={3} maxLength={ACTION_TEXT_MAX} defaultValue={defaults.problem ?? ''} required
          onChange={(e) => setTexts((t) => ({ ...t, problem: e.target.value }))} />
      </Field>
      <Field name="detail" label="Détail de l’action" hint="La première ligne sert de libellé court (90 caractères).">
        <TextArea name="detail" rows={4} maxLength={ACTION_TEXT_MAX} defaultValue={defaults.detail ?? ''} required
          placeholder="Verbe d’action + objet (ex. Remplacer les élingues textiles du poste 3…)"
          onChange={(e) => setTexts((t) => ({ ...t, detail: e.target.value }))} />
      </Field>

      <FormRow>
        <Field name="verifyDueOn" label="Vérification planifiée" hint={
          verifyLocked ? 'Fixée : l’action est vérifiée.' : warnings.length ? <span className="vg-warn-text">{warnings.join(' ')}</span> : 'Vérification de l’efficacité par le QHSE.'
        }>
          {verifyLocked
            ? <ReadOnly id="verifyDueOn" value={defaults.verifyDueOn ? fmtDate(defaults.verifyDueOn) : '—'} />
            : <Input name="verifyDueOn" type="date" value={verifyDueOn} min={editing ? undefined : options.today} onChange={(e) => setVerifyDueOn(e.target.value)} required />}
        </Field>
        <Field name="siteId" label="Site" hint={pickedTarget?.siteId ? 'Site de l’élément lié.' : undefined}>
          <Select name="siteId" options={sites} value={siteId} placeholder="Choisir…" required onChange={(e) => setSiteId(e.target.value)} />
        </Field>
      </FormRow>

      <FormRow>
        <Field name="estimatedCost" label="Coût estimé (€ TTC)" hint="Facultatif, sans le temps passé.">
          <Input name="estimatedCost" type="number" inputMode="decimal" step="0.01" min="0" defaultValue={numberField(defaults.estimatedCost)} />
        </Field>
        <Field name="actualCost" label="Coût réel (€ TTC)" hint="Facultatif.">
          <Input name="actualCost" type="number" inputMode="decimal" step="0.01" min="0" defaultValue={numberField(defaults.actualCost)} />
        </Field>
      </FormRow>

      {showVerification && (
        <Field name="hours" label="Pointage (h)" hint="Temps réellement passé. Nature, constat, résultat et date de vérification se changent par « Rouvrir » puis une nouvelle vérification.">
          <Input name="hours" type="number" inputMode="decimal" step="0.01" min="0" defaultValue={numberField(defaults.hours)} />
        </Field>
      )}
    </ActionForm>
  );
}

/** Bouton « Nouvelle action » (ou libellé personnalisé) ouvrant le formulaire ; les écrans ne l'affichent qu'au QHSE (ACT-22). */
export function NewActionButton({ options, defaults, label = 'Nouvelle action', className = 'btn btn-primary vg-btn-sm', icon = 'ph-plus', style, disabled, tooltip }: {
  options: ActionFormOptions; defaults?: ActionDefaults; label?: string; className?: string; icon?: string; style?: CSSProperties; disabled?: boolean; tooltip?: string;
}) {
  return (
    <DialogButton label={label} icon={icon} className={className} style={style} disabled={disabled} tooltip={tooltip}
      title={defaults?.id ? `Modifier ${defaults.id}` : 'Nouvelle action QSE'} kicker="Plan d’actions QSE" width={640}>
      {(close) => <ActionFields options={options} defaults={defaults} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}
