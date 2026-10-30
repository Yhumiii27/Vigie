'use client';

import { useId, useState, type CSSProperties } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Checkbox, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { RISK_ACTION_THRESHOLD, RISK_LEVELS, SEVERITY, riskLevel } from '@/lib/domain';
import type { RiskView, WorkUnitView } from '@/lib/data/risks';
import { saveRisk } from '@/server/risks';
import { hazardSuggestions } from '@/lib/hazard-families';

const GRAVITY: [string, string][] = [1, 2, 3, 4].map((n) => [String(n), SEVERITY[n]]);
const PROBABILITY: [string, string][] = [['1', 'P1 · improbable'], ['2', 'P2 · possible'], ['3', 'P3 · probable'], ['4', 'P4 · très probable']];

/** Cotation G × P sur la couleur de son niveau (même rendu que le tableau des risques). */
export function Cotation({ g, p, style }: { g: number; p: number; style?: CSSProperties }) {
  const n = g * p;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px', borderRadius: 6, whiteSpace: 'nowrap', background: RISK_LEVELS[riskLevel(n)].bg, ...style }}>
      G{g} × P{p} = {n}
    </span>
  );
}

/** Cotation calculée en direct dans le formulaire, avec le libellé du niveau. */
function LiveCotation({ label, g, p, hint }: { label: string; g: number; p: number; hint?: string }) {
  const id = useId();
  const level = RISK_LEVELS[riskLevel(g * p)];
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <output id={id} aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '0 10px', borderRadius: 'var(--radius-md)', background: level.bg, fontSize: 13 }}>
        <span style={{ fontWeight: 500 }}>G{g} × P{p} = {g * p}</span>
        <span style={{ color: 'var(--color-neutral-300)', fontSize: 12 }}>{level.label.replace(/\s.*$/, '')}</span>
      </output>
      {hint && <span className="vg-field-hint" style={{ color: 'var(--tone-danger-fg)' }}>{hint}</span>}
    </div>
  );
}

/** Valeurs initiales du formulaire (une RiskView convient : ses autres champs, dont residualReviewedOn, sont ignorés). */
export type RiskFormDefaults = Partial<Pick<RiskView, 'id' | 'unitId' | 'hazard' | 'situation' | 'gravity' | 'probability' | 'existingMeasures' | 'residualGravity' | 'residualProbability' | 'version'>>;

/**
 * Formulaire d'ajout / de modification d'un risque, avec cotation brute et résiduelle calculées en direct.
 * `reviewPrompt` : actions vérifiées, résiduel à recoter — la case enregistre la recotation même sans changement de cotation.
 */
export function RiskFields({ units, defaults = {}, reviewPrompt, hazards, onDone, onCancel }: {
  units: Pick<WorkUnitView, 'id' | 'label' | 'site'>[];
  /** Libellés de danger déjà employés (suggestions, DUE-18). */
  hazards?: readonly string[];
  defaults?: RiskFormDefaults;
  reviewPrompt?: boolean;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const listId = useId();
  const [g, setG] = useState(defaults.gravity ?? 2);
  const [p, setP] = useState(defaults.probability ?? 2);
  const [rg, setRg] = useState(defaults.residualGravity ?? defaults.gravity ?? 2);
  const [rp, setRp] = useState(defaults.residualProbability ?? 1);
  const sites = new Set(units.map((u) => u.site));
  const unitOptions = units.map((u) => [u.id, sites.size > 1 ? `${u.label} · ${u.site}` : u.label] as const);
  const editing = defaults.id != null;
  return (
    <ActionForm action={saveRisk} onDone={onDone} onCancel={onCancel} submitLabel={editing ? 'Enregistrer' : 'Ajouter le risque'} hidden={{ id: defaults.id, version: defaults.version }}>
      <Field name="unitId" label="Unité de travail">
        <Select name="unitId" options={unitOptions} defaultValue={defaults.unitId} />
      </Field>
      {/* DUE-18 : familles de dangers usuelles (INRS ED 840) et libellés déjà employés, proposées sans être imposées. */}
      <Field name="hazard" label="Danger" hint="Famille de danger : choisissez une suggestion (familles INRS) ou saisissez un autre libellé.">
        <Input name="hazard" defaultValue={defaults.hazard} maxLength={120} autoFocus={!editing} list={listId} autoComplete="off" />
      </Field>
      <datalist id={listId}>{hazardSuggestions(hazards).map((h) => <option key={h} value={h} />)}</datalist>
      <Field name="situation" label="Situation dangereuse">
        <TextArea name="situation" defaultValue={defaults.situation} rows={2} maxLength={500} placeholder="Qui est exposé, à quoi, dans quelle activité…" />
      </Field>
      <FormRow cols={3}>
        <Field name="gravity" label="Gravité">
          <Select name="gravity" options={GRAVITY} value={String(g)} onChange={(e) => { const v = +e.target.value; setG(v); setRg((r) => Math.min(r, v)); }} />
        </Field>
        <Field name="probability" label="Probabilité">
          <Select name="probability" options={PROBABILITY} value={String(p)} onChange={(e) => { const v = +e.target.value; setP(v); setRp((r) => Math.min(r, v)); }} />
        </Field>
        <LiveCotation label="Cotation brute" g={g} p={p} hint={g * p >= RISK_ACTION_THRESHOLD ? 'Action de réduction obligatoire.' : undefined} />
      </FormRow>
      <Field name="existingMeasures" label="Mesures existantes">
        <TextArea name="existingMeasures" defaultValue={defaults.existingMeasures} rows={2} maxLength={1000} placeholder="Protections collectives, EPI, consignes, formations…" />
      </Field>
      <FormRow cols={3}>
        <Field name="residualGravity" label="Gravité résiduelle">
          <Select name="residualGravity" options={GRAVITY.slice(0, g)} value={String(rg)} onChange={(e) => setRg(+e.target.value)} />
        </Field>
        <Field name="residualProbability" label="Probabilité résiduelle">
          <Select name="residualProbability" options={PROBABILITY.slice(0, p)} value={String(rp)} onChange={(e) => setRp(+e.target.value)} />
        </Field>
        <LiveCotation label="Risque résiduel" g={rg} p={rp} hint={rg * rp >= RISK_ACTION_THRESHOLD ? `Résiduel ≥ ${RISK_ACTION_THRESHOLD} : réduction encore nécessaire.` : undefined} />
      </FormRow>
      {reviewPrompt && <Checkbox name="residualReviewed" label="Résiduel recoté après vérification d'efficacité" defaultChecked />}
    </ActionForm>
  );
}

/** Bouton « Ajouter un risque » : l'unité sélectionnée est proposée par défaut. */
export function AddRiskButton({ units, unitId, hazards }: { units: Pick<WorkUnitView, 'id' | 'label' | 'site'>[]; unitId?: string; hazards?: readonly string[] }) {
  return (
    <DialogButton label="Ajouter un risque" icon="ph-plus" title="Ajouter un risque" kicker="Document unique" width={600}>
      {(close) => <RiskFields units={units} defaults={{ unitId }} hazards={hazards} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}
